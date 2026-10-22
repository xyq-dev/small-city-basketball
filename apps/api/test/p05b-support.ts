import type {
  EventStandingsData,
  PublicViewingCommandInput,
  StandingsRules,
} from '@small-city-basketball/contracts';
import { call, data } from './support.js';
import type { User } from './support.js';
import { act, finish, liveMatch } from './p05-support.js';
import type { Harness, PublishedFixture } from './p05-support.js';

export {
  acquire,
  act,
  assign,
  closeHarness,
  createScoringHarness,
  envelope,
  finish,
  liveMatch,
  prepare,
  published,
  release,
  sendCommand,
  workbench,
} from './p05-support.js';
export type { Harness, PublishedFixture } from './p05-support.js';

export const standingsPath = (orgId: string, eventId: string) =>
  `/v1/orgs/${orgId}/events/${eventId}/standings`;
export const standingsRulesPath = (orgId: string, eventId: string) =>
  `/v1/orgs/${orgId}/events/${eventId}/standings-rules`;
export const standingsCommandsPath = (orgId: string, eventId: string) =>
  `/v1/orgs/${orgId}/events/${eventId}/standings-rule-commands`;
export const viewingCommandsPath = (orgId: string, eventId: string) =>
  `/v1/orgs/${orgId}/events/${eventId}/public-viewing-commands`;
export const publicEventPath = (publicEventId: string) => `/v1/public/events/${publicEventId}`;
export const publicSchedulePath = (publicEventId: string) =>
  `${publicEventPath(publicEventId)}/schedule`;
export const publicStandingsPath = (publicEventId: string) =>
  `${publicEventPath(publicEventId)}/standings`;
export const publicMatchPath = (publicEventId: string, publicMatchId: string) =>
  `${publicEventPath(publicEventId)}/matches/${publicMatchId}`;

export const defaultStandingsRules = (overrides: Partial<StandingsRules> = {}): StandingsRules => ({
  winPoints: 3,
  lossPoints: 0,
  drawPoints: 1,
  tiebreakers: [],
  ...overrides,
});

export async function privateStandings(h: Harness, eventId: string, actor: User = h.owner) {
  return data<EventStandingsData>(
    await call(h.api, 'get', standingsPath(h.owner.orgId, eventId), { cookie: actor.cookie }),
  );
}

export async function saveRules(
  h: Harness,
  eventId: string,
  overrides: Partial<StandingsRules> = {},
  expectedEventVersion?: number,
): Promise<EventStandingsData> {
  const version = expectedEventVersion ?? (await privateStandings(h, eventId)).event.version;
  return data<EventStandingsData>(
    await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
      cookie: h.owner.cookie,
      body: { expectedEventVersion: version, ...defaultStandingsRules(overrides) },
    }),
  );
}

export async function publishRules(h: Harness, eventId: string): Promise<EventStandingsData> {
  const current = await privateStandings(h, eventId);
  return data<EventStandingsData>(
    await call(h.api, 'post', standingsCommandsPath(h.owner.orgId, eventId), {
      cookie: h.owner.cookie,
      body: {
        type: 'PUBLISH_STANDINGS_RULES',
        rulesetId: current.rules!.id,
        expectedEventVersion: current.event.version,
      },
    }),
  );
}

export async function savePublishRules(
  h: Harness,
  eventId: string,
  overrides: Partial<StandingsRules> = {},
): Promise<EventStandingsData> {
  await saveRules(h, eventId, overrides);
  return publishRules(h, eventId);
}

export async function viewingCommand(
  h: Harness,
  eventId: string,
  type: PublicViewingCommandInput['type'],
  expectedEventVersion?: number,
  actor: User = h.owner,
) {
  const version = expectedEventVersion ?? (await privateStandings(h, eventId)).event.version;
  return call(h.api, 'post', viewingCommandsPath(h.owner.orgId, eventId), {
    cookie: actor.cookie,
    body: { type, expectedEventVersion: version },
  });
}

export async function enable(h: Harness, eventId: string) {
  return data<EventStandingsData>(await viewingCommand(h, eventId, 'ENABLE'));
}
export async function disable(h: Harness, eventId: string, expectedEventVersion?: number) {
  return data<EventStandingsData>(
    await viewingCommand(h, eventId, 'DISABLE', expectedEventVersion),
  );
}

// Deliberately anonymous by default: callers must opt in when comparing cookie independence.
export const anonymous = (h: Harness, path: string, cookie?: string) =>
  call(h.api, 'get', path, cookie === undefined ? {} : { cookie });

export async function confirmMatch(
  h: Harness,
  fixture: PublishedFixture,
  index = 0,
  homeScore = 1,
  awayScore = 0,
) {
  const live = await liveMatch(h, fixture, index);
  for (const [side, score] of [
    ['HOME', homeScore],
    ['AWAY', awayScore],
  ] as const) {
    for (let remaining = score; remaining > 0; remaining -= Math.min(3, remaining)) {
      await act(
        h,
        live.matchId,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: { kind: 'SCORE', side, value: Math.min(3, remaining) },
        },
        live.lease,
      );
    }
  }
  for (let period = 1; period < fixture.event.rules!.regulationPeriods; period++) {
    await act(
      h,
      live.matchId,
      h.otherOwner,
      {
        type: 'CLOCK_SET',
        payload: { remainingMs: 0, reason: '完成本节进入下一规定节次' },
      },
      live.lease,
    );
    await act(h, live.matchId, h.otherOwner, { type: 'NEXT_PERIOD', payload: {} }, live.lease);
  }
  const pending = await finish(h, live.matchId, h.otherOwner, live.lease);
  const confirmed = await act(h, live.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
  return { ...live, pending, confirmed };
}

export async function reopen(h: Harness, matchId: string) {
  return act(h, matchId, h.owner, {
    type: 'REOPEN_RESULT',
    payload: { reason: '独立复核正式结果' },
  });
}

type Track = <T>(pending: Promise<T>) => Promise<T>;

export async function withRowsLocked(
  h: Harness,
  sql: string,
  values: unknown[],
  expectedRows: number,
  run: (pid: number, unlock: () => Promise<void>, track: Track) => Promise<void>,
): Promise<void> {
  const blocker = await h.api.pool.connect();
  const pending: Promise<unknown>[] = [];
  let released = false;
  const track: Track = (request) => {
    pending.push(request);
    void request.catch(() => undefined);
    return request;
  };
  try {
    await blocker.query('BEGIN');
    const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    if ((await blocker.query(sql, values)).rowCount !== expectedRows) {
      throw new Error('The PostgreSQL lock fixture did not find its exact synthetic rows');
    }
    await run(
      pid,
      async () => {
        await blocker.query('COMMIT');
        released = true;
      },
      track,
    );
  } finally {
    try {
      if (!released) await blocker.query('ROLLBACK');
    } finally {
      blocker.release();
      await Promise.allSettled(pending);
    }
  }
}

import { randomUUID } from 'node:crypto';
import type {
  CourtData,
  EventKnockoutData,
  EventScoringData,
  EventSchedulingData,
  PublishKnockoutRoundInput,
  SchedulePolicy,
  ScheduleRevisionData,
  ScheduledMatchData,
  ScoringControl,
} from '@small-city-basketball/contracts';
import { call, data, eventPath } from './support.js';
import type { User } from './support.js';
import {
  allocate,
  court,
  frozen,
  fullAllocations,
  matchesPath,
  plusMinutes,
  policyFor,
  publish,
  revisionsPath,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
import {
  acquire,
  act,
  assign,
  defaultRules,
  finish,
  scoringRulesPath,
  start,
  workbench,
} from './p05-support.js';

export const knockoutPath = (org: string, event: string) => `${eventPath(org, event)}/knockout`;
export const roundCommandsPath = (org: string, event: string) =>
  `${eventPath(org, event)}/knockout-round-commands`;
export const lifecyclePath = (org: string, event: string) => `${eventPath(org, event)}/lifecycle`;
export const lifecycleCommandsPath = (org: string, event: string) =>
  `${eventPath(org, event)}/lifecycle-commands`;
export const publicKnockoutPath = (publicEventId: string) =>
  `/v1/public/events/${publicEventId}/knockout`;
export const playerSummaryPath = (org: string, event: string) =>
  `${eventPath(org, event)}/player-statistics`;

export interface KnockoutFixture {
  event: EventScoringData;
  publication: EventSchedulingData;
  schedule: ScheduleRevisionData;
  matches: ScheduledMatchData[];
  court: CourtData;
}

export async function readKnockout(h: Harness, event: string, actor: User = h.owner) {
  return data<EventKnockoutData>(
    await call(h.api, 'get', knockoutPath(h.owner.orgId, event), { cookie: actor.cookie }),
  );
}

export async function currentMatches(h: Harness, event: string) {
  return data<ScheduledMatchData[]>(
    await call(h.api, 'get', matchesPath(h.owner.orgId, event), {
      cookie: h.owner.cookie,
    }),
  );
}

/** Only real public commands create the registration, first schedule and scoring rules. */
export async function knockoutFixture(
  h: Harness,
  count = 3,
  overrides: Partial<SchedulePolicy> = {},
): Promise<KnockoutFixture> {
  const registration = await frozen(h, h.owner, h.teams.slice(0, count), {
    format: 'SINGLE_ELIMINATION',
  });
  const resource = await court(h.api, h.owner, '合成单淘汰场地');
  let schedule = data<ScheduleRevisionData>(
    await call(h.api, 'post', revisionsPath(h.owner.orgId, registration.event.id), {
      cookie: h.owner.cookie,
      body: {
        expectedEventVersion: registration.event.version,
        freezeId: registration.freeze!.id,
        algorithmVersion: 'SE_SEEDED_V1',
        policy: policyFor(registration, [resource], overrides),
      },
    }),
    201,
  );
  schedule = await allocate(
    h.api,
    h.owner,
    schedule,
    fullAllocations(schedule, resource, `${registration.event.startDate}T09:00:00+08:00`, 120),
  );
  const publication = data<EventSchedulingData>(await publish(h.api, h.owner, schedule));
  const event = data<EventScoringData>(
    await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
      cookie: h.owner.cookie,
      body: {
        expectedEventVersion: publication.event.version,
        ...defaultRules({ tiePolicy: 'OVERTIME', overtimeDurationSeconds: 1 }),
      },
    }),
  );
  return {
    event,
    publication,
    schedule,
    court: resource,
    matches: await currentMatches(h, registration.event.id),
  };
}

/** Defaults leave a full hour of rest after every already published match. */
export async function roundInput(
  h: Harness,
  current: EventKnockoutData,
  resource: CourtData,
  startsAt?: string,
): Promise<PublishKnockoutRoundInput> {
  const next = current.bracket?.nextRound;
  if (!next) throw new Error('A round input requires a currently confirmed next round');
  const matches = await currentMatches(h, current.event.id);
  const lastEnd = matches
    .map((m) => m.endsAt)
    .sort()
    .at(-1)!;
  const firstStart = startsAt ?? plusMinutes(lastEnd, 60);
  return {
    type: 'PUBLISH_ROUND',
    expectedEventVersion: current.event.version,
    expectedSourceHash: next.sourceHash,
    roundNo: next.roundNo,
    reason: '合成赛事独立确认后发布下一轮',
    allocations: next.fixtures.map((fixture, index) => ({
      fixtureKey: fixture.fixtureKey,
      courtId: resource.id,
      startsAt: plusMinutes(firstStart, index * 120),
    })),
  };
}

export const publishRound = (
  h: Harness,
  event: string,
  input: PublishKnockoutRoundInput,
  actor: User = h.owner,
) =>
  call(h.api, 'post', roundCommandsPath(h.owner.orgId, event), {
    cookie: actor.cookie,
    body: input,
  });

/** Reuses the original authoritative scoring command stream and independent reviewer. */
export async function confirmKnockoutMatch(
  h: Harness,
  matchId: string,
  personal = false,
): Promise<{ matchId: string; lease: ScoringControl }> {
  await assign(h, matchId, h.otherOwner);
  const before = await workbench(h, matchId);
  await act(h, matchId, h.owner, {
    type: 'PREPARE_MATCH',
    payload: {
      expectedEventVersion: before.event.version,
      collectionMode: personal ? 'PLAYER_BASIC' : 'TEAM_ONLY',
    },
  });
  const lease = await acquire(h, matchId, h.otherOwner);
  await start(h, matchId, h.otherOwner, lease);
  await act(
    h,
    matchId,
    h.otherOwner,
    {
      type: 'RECORD_STAT',
      payload: {
        kind: 'SCORE',
        side: 'HOME',
        value: 2,
        ...(personal ? { memberId: before.playerRoster.home[0]!.memberId } : {}),
      },
    },
    lease,
  );
  await finish(h, matchId, h.otherOwner, lease);
  await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
  return { matchId, lease };
}

export async function knockoutFacts(h: Harness, event: string) {
  const statements: Record<string, string> = {
    event: 'SELECT * FROM events WHERE org_id=$1 AND id=$2',
    revisions: 'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2',
    fixtures: 'SELECT * FROM schedule_fixtures WHERE org_id=$1 AND event_id=$2',
    publications: 'SELECT * FROM schedule_publications WHERE org_id=$1 AND event_id=$2',
    matches: 'SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2',
    rounds: 'SELECT * FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2',
    publicViewing: 'SELECT * FROM public_event_publications WHERE org_id=$1 AND event_id=$2',
    links: 'SELECT * FROM public_match_links WHERE org_id=$1 AND event_id=$2',
    courtReservations:
      'SELECT r.* FROM court_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    teamReservations:
      'SELECT r.* FROM team_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    audit: 'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id=$2',
  };
  const facts: Record<string, unknown[]> = {};
  for (const [key, query] of Object.entries(statements))
    facts[key] = (
      await h.api.pool.query<{ value: unknown }>(
        `SELECT to_jsonb(record_row) AS value FROM (${query}) record_row ORDER BY to_jsonb(record_row)::text`,
        [h.owner.orgId, event],
      )
    ).rows.map((row) => row.value);
  return facts;
}

/** A legitimate, complete candidate proof; callers deliberately omit its accompanying writes. */
export function proofFixtures(
  fixture: KnockoutFixture,
  current: EventKnockoutData,
  input: PublishKnockoutRoundInput,
) {
  const entries = new Map(fixture.schedule.source.entries.map((entry) => [entry.entryId, entry]));
  const byKey = new Map(input.allocations.map((allocation) => [allocation.fixtureKey, allocation]));
  return current.bracket!.nextRound!.fixtures.map((next) => {
    const home = entries.get(next.homeEntryId)!;
    const away = entries.get(next.awayEntryId)!;
    const allocation = byKey.get(next.fixtureKey)!;
    return {
      matchId: randomUUID(),
      fixtureKey: next.fixtureKey,
      roundNo: next.roundNo,
      positionNo: next.positionNo,
      homeEntryId: home.entryId,
      awayEntryId: away.entryId,
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeTeamName: home.teamName,
      awayTeamName: away.teamName,
      homeRosterRevisionId: home.rosterRevisionId,
      awayRosterRevisionId: away.rosterRevisionId,
      courtId: allocation.courtId,
      courtName: fixture.court.name,
      startsAt: allocation.startsAt,
      endsAt: plusMinutes(allocation.startsAt, fixture.schedule.policy.slotDurationMinutes),
    };
  });
}

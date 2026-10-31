import { rescheduling, reschedule } from './p04-rescheduling-support.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventData,
  EventRegistrationData,
  EventSchedulingData,
  EventScoringData,
  ScheduleRevisionData,
  ScheduledMatchData,
  MatchExceptionWorkbench,
  EventLifecycleData,
} from '@small-city-basketball/contracts';
import { call, data, error, eventInput, eventsPath, staff, login, tokenHash } from './support.js';
import type { User } from './support.js';
import { command, entry, registrationCommand, roster, rules, rulesPath } from './p03-support.js';
import {
  allocate,
  court,
  fullAllocations,
  matchesPath,
  policyFor,
  publish,
  revisionsPath,
} from './p04-support.js';
import {
  assign,
  closeHarness,
  createScoringHarness,
  defaultRules,
  prepare,
  scoringRulesPath,
  workbenchPath,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import { privateStandings, savePublishRules, enable } from './p05b-support.js';
import { lifecyclePath, readKnockout, publishRound, roundInput } from './c04-support.js';
const rulesUrl = (h: Harness, event: string) =>
  `/v1/orgs/${h.owner.orgId}/events/${event}/exception-rules`;
const url = (h: Harness, match: string) => `/v1/orgs/${h.owner.orgId}/matches/${match}/exceptions`;
const read = async (h: Harness, match: string, reviewer = false) =>
  data<MatchExceptionWorkbench>(
    await call(h.api, 'get', url(h, match), {
      cookie: reviewer ? h.otherOwner.cookie : h.owner.cookie,
    }),
  );
async function fixture(
  h: Harness,
  format: 'ROUND_ROBIN' | 'SINGLE_ELIMINATION' = 'ROUND_ROBIN',
  count = 2,
) {
  const event = data<EventData>(
    await call(h.api, 'post', eventsPath(h.owner.orgId), {
      cookie: h.owner.cookie,
      body: eventInput('合成X02裁定' + randomUUID().slice(0, 8), {
        format,
        startDate: `${new Date().getUTCFullYear() + 3}-01-${String(1 + h.nextDate++ * 3).padStart(2, '0')}`,
        endDate: `${new Date().getUTCFullYear() + 3}-01-31`,
      }),
    }),
    201,
  );
  const saved = data<{ eventVersion: number }>(
    await call(h.api, 'put', rulesUrl(h, event.id), {
      cookie: h.owner.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedEventVersion: event.version,
        expectedVersion: 0,
        forfeitWinPoints: 2,
        forfeitLossPoints: 0,
        cancellationPolicy: 'EXCLUDE_FROM_TABLE',
      },
    }),
  );
  let current = data<EventRegistrationData>(
    await call(h.api, 'put', rulesPath(h.owner.orgId, event.id), {
      cookie: h.owner.cookie,
      body: rules(saved.eventVersion, { minPlayers: 2, maxPlayers: 2 }),
    }),
  );
  current = await registrationCommand(h.api, h.owner, current, 'OPEN_REGISTRATION');
  for (const t of h.teams.slice(0, count)) {
    let d = await entry(h.api, h.owner, event.id, t, h.leader);
    d = await roster(h.api, h.owner, d, h.leader, t.members);
    d = await command(h.api, h.owner, d, h.leader, 'SUBMIT');
    await command(h.api, h.owner, d, h.owner, 'APPROVE');
  }
  current = await registrationCommand(h.api, h.owner, current, 'CLOSE_REGISTRATION');
  current = await registrationCommand(h.api, h.owner, current, 'FREEZE_REGISTRATION');
  if (format === 'ROUND_ROBIN') {
    const published = await savePublishRules(h, event.id, {
      winPoints: 3,
      lossPoints: 1,
      drawPoints: 0,
      tiebreakers: ['WINS'],
    });
    current = { ...current, event: { ...current.event, version: published.event.version } };
  }
  const resource = await court(h.api, h.owner, '合成X02场地');
  let schedule = data<ScheduleRevisionData>(
    await call(h.api, 'post', revisionsPath(h.owner.orgId, event.id), {
      cookie: h.owner.cookie,
      body: {
        expectedEventVersion: current.event.version,
        freezeId: current.freeze!.id,
        algorithmVersion: format === 'ROUND_ROBIN' ? 'RR_CIRCLE_V1' : 'SE_SEEDED_V1',
        policy: policyFor(
          current,
          [resource],
          format === 'SINGLE_ELIMINATION' && count >= 4 ? { thirdPlaceMatch: true } : {},
        ),
      },
    }),
    201,
  );
  schedule = await allocate(
    h.api,
    h.owner,
    schedule,
    fullAllocations(schedule, resource, `${event.startDate}T09:00:00+08:00`),
  );
  const publication = data<EventSchedulingData>(await publish(h.api, h.owner, schedule));
  data<EventScoringData>(
    await call(h.api, 'put', scoringRulesPath(h.owner.orgId, event.id), {
      cookie: h.owner.cookie,
      body: {
        expectedEventVersion: publication.event.version,
        ...defaultRules(
          format === 'SINGLE_ELIMINATION'
            ? { tiePolicy: 'OVERTIME', overtimeDurationSeconds: 1 }
            : {},
        ),
      },
    }),
  );
  const matches = data<ScheduledMatchData[]>(
    await call(h.api, 'get', matchesPath(h.owner.orgId, event.id), { cookie: h.owner.cookie }),
  );
  for (const m of matches) await assign(h, m.id, h.otherOwner, 'RESULT_REVIEWER');
  return { event, schedule, matches, resource };
}
async function propose(
  h: Harness,
  match: string,
  kind: 'FORFEIT' | 'CANCELLED' = 'FORFEIT',
  revoke = false,
) {
  const v = await read(h, match);
  const body = {
    clientRequestId: randomUUID(),
    expectedEventVersion: v.event.version,
    expectedMatchVersion: v.match.version,
    operation: revoke ? 'REVOKE' : 'DECLARE',
    kind,
    forfeitingSide: kind === 'FORFEIT' ? 'HOME' : null,
    ...(revoke ? { targetAdjudicationId: v.active!.id } : {}),
    reason: '合成行政裁定提议原因',
  };
  const r = data<{ requestId: string }>(
    await call(h.api, 'post', url(h, match) + '/proposals', { cookie: h.owner.cookie, body }),
  );
  return { r, body };
}
async function approve(h: Harness, match: string, request: string, type = 'APPROVE') {
  const v = await read(h, match, true);
  return call(h.api, 'post', url(h, match) + '/' + request + '/review', {
    cookie: h.otherOwner.cookie,
    body: {
      clientRequestId: randomUUID(),
      expectedEventVersion: v.event.version,
      expectedMatchVersion: v.match.version,
      expectedRequestVersion: v.requests.find((r) => r.id === request)!.version,
      type,
      reason: '合成独立复核决定原因',
    },
  });
}

describe('X02 real PostgreSQL administrative adjudication workflow', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(4);
  }, 120000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  });
  test('draft-only rules, independent approval, replay, distinct table outcome and revoke', async () => {
    const f = await fixture(h),
      m = f.matches[0]!;
    const p = await propose(h, m.id);
    expect((await read(h, m.id)).active).toBeNull();
    const replay = data<{ requestId: string }>(
      await call(h.api, 'post', url(h, m.id) + '/proposals', {
        cookie: h.owner.cookie,
        body: p.body,
      }),
    );
    expect(replay).toEqual(p.r);
    let v = await read(h, m.id);
    const same = await call(h.api, 'post', url(h, m.id) + '/' + p.r.requestId + '/review', {
      cookie: h.owner.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedEventVersion: v.event.version,
        expectedMatchVersion: v.match.version,
        expectedRequestVersion: 1,
        type: 'APPROVE',
        reason: '合成提议人不能审核自己',
      },
    });
    error(same, 409);
    expect(same.body.error.code).toBe('INDEPENDENT_REVIEW_REQUIRED');
    data(await approve(h, m.id, p.r.requestId));
    v = await read(h, m.id);
    expect(v.active).toMatchObject({
      id: p.r.requestId,
      status: 'APPROVED',
      kind: 'FORFEIT',
      forfeitingSide: 'HOME',
    });
    expect(v.capabilities.canPropose).toBe(false);
    const listed = data<Record<string, any>[]>(
      await call(h.api, 'get', matchesPath(h.owner.orgId, f.event.id), { cookie: h.owner.cookie }),
    );
    expect(listed.find((x) => x.id === m.id)?.adjudication).toEqual({ kind: 'FORFEIT' });
    const blockedPlan = await rescheduling(h, m.id);
    const blocked = await reschedule(h, blockedPlan, {
      startsAt: new Date(Date.parse(m.startsAt) + 120 * 60000).toISOString(),
      courtId: m.courtId,
      reason: '合成裁定生效不得改期',
    });
    error(blocked, 409);
    expect(blocked.body.error.code).toBe('MATCH_ADJUDICATED');
    const table = (await privateStandings(h, f.event.id)).standings!;
    expect(table).toMatchObject({
      confirmedMatchCount: 0,
      adjudicatedMatchCount: 1,
      resolvedMatchCount: 1,
      isComplete: true,
    });
    expect(table.rows[0]).toMatchObject({
      wins: 1,
      leaguePoints: 2,
      pointsFor: 0,
      pointsAgainst: 0,
    });
    const counts = (
      await h.api.pool.query(
        'SELECT (SELECT count(*) FROM scoring_events WHERE match_id=$1)::int AS events,(SELECT count(*) FROM result_confirmations WHERE match_id=$1)::int AS confirmations',
        [m.id],
      )
    ).rows[0];
    expect(counts).toEqual({ events: 0, confirmations: 0 });
    const locked = await call(h.api, 'put', rulesUrl(h, f.event.id), {
      cookie: h.owner.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedEventVersion: v.event.version,
        expectedVersion: 1,
        forfeitWinPoints: 9,
        forfeitLossPoints: 0,
        cancellationPolicy: 'EXCLUDE_FROM_TABLE',
      },
    });
    error(locked, 409);
    expect(locked.body.error.code).toBe('EXCEPTION_RULES_LOCKED');
    const lifecycle = data<EventLifecycleData>(
      await call(h.api, 'get', lifecyclePath(h.owner.orgId, f.event.id), {
        cookie: h.owner.cookie,
      }),
    );
    expect(lifecycle.completion.ready).toBe(true);
    const revoke = await propose(h, m.id, 'FORFEIT', true);
    data(await approve(h, m.id, revoke.r.requestId));
    expect((await read(h, m.id)).active).toBeNull();
    const resumedList = data<Record<string, any>[]>(
      await call(h.api, 'get', matchesPath(h.owner.orgId, f.event.id), { cookie: h.owner.cookie }),
    );
    expect(
      Object.hasOwn(
        resumedList.find((x) => x.id === m.id)!,
        'adjudication',
      ),
    ).toBe(false);
    const resumed = await rescheduling(h, m.id);
    data(
      await reschedule(h, resumed, {
        startsAt: new Date(Date.parse(m.startsAt) + 120 * 60000).toISOString(),
        courtId: m.courtId,
        reason: '合成独立撤回后恢复改期',
      }),
    );
    expect((await privateStandings(h, f.event.id)).standings!.isComplete).toBe(false);
  }, 120000);
  test('cancelled knockout blocks advancement, remains scoreless, and only independent revoke restores readiness', async () => {
    const f = await fixture(h, 'SINGLE_ELIMINATION'),
      m = f.matches[0]!,
      p = await propose(h, m.id, 'CANCELLED');
    data(await approve(h, m.id, p.r.requestId));
    const b = (await readKnockout(h, f.event.id)).bracket!;
    expect(b.isComplete).toBe(false);
    expect(b.nextRound).toBeNull();
    expect(b.rounds[0]!.slots[0]!.winnerEntryId).toBeNull();
    const life = data<EventLifecycleData>(
      await call(h.api, 'get', lifecyclePath(h.owner.orgId, f.event.id), {
        cookie: h.owner.cookie,
      }),
    );
    expect(life.completion.ready).toBe(false);
    const r = await propose(h, m.id, 'CANCELLED', true);
    data(await approve(h, m.id, r.r.requestId));
    expect((await read(h, m.id)).active).toBeNull();
  }, 120000);
  test('forfeit semifinals create exact winner and loser fixtures; consumed administrative result cannot revoke', async () => {
    const f = await fixture(h, 'SINGLE_ELIMINATION', 4);
    for (const m of f.matches) {
      const p = await propose(h, m.id);
      data(await approve(h, m.id, p.r.requestId));
    }
    const b = await readKnockout(h, f.event.id);
    expect(
      b.bracket!.nextRound!.sources.every(
        (s) => 'kind' in s && s.kind === 'ADJUDICATION' && !('confirmationId' in s),
      ),
    ).toBe(true);
    expect(b.bracket!.nextRound!.fixtures).toHaveLength(2);
    await publishRound(h, f.event.id, await roundInput(h, b, f.resource));
    const technical = data<{ summary: Record<string, any> }>(
      await call(h.api, 'get', `/v1/orgs/${h.owner.orgId}/events/${f.event.id}/player-statistics`, {
        cookie: h.owner.cookie,
      }),
    );
    expect(technical.summary).toMatchObject({
      excludedAdministrativeMatchCount: 2,
      recordableMatchCount: 2,
    });
    const current = await read(h, f.matches[0]!.id);
    expect(current.capabilities.canRevoke).toBe(false);
    const bad = await call(h.api, 'post', url(h, f.matches[0]!.id) + '/proposals', {
      cookie: h.owner.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedEventVersion: current.event.version,
        expectedMatchVersion: current.match.version,
        operation: 'REVOKE',
        kind: 'FORFEIT',
        forfeitingSide: 'HOME',
        targetAdjudicationId: current.active!.id,
        reason: '合成已消费来源不得直接撤回',
      },
    });
    error(bad, 409);
    expect(bad.body.error.code).toBe('KNOCKOUT_RESULT_CONSUMED');
  }, 120000);
  test('scope and direct-SQL head mutations cannot bypass independent approval', async () => {
    const f = await fixture(h),
      m = f.matches[0]!,
      p = await propose(h, m.id);
    const scope = await call(
      h.api,
      'get',
      `/v1/orgs/${h.otherOwner.orgId}/matches/${m.id}/exceptions`,
      { cookie: h.otherOwner.cookie },
    );
    error(scope, 404);
    const c = await h.api.pool.connect();
    try {
      await c.query('BEGIN');
      await expect(
        c.query(
          'UPDATE match_exception_heads SET active_request_id=$3,version=version+1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, m.id, p.r.requestId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect((await read(h, m.id)).active).toBeNull();
    data(await approve(h, m.id, p.r.requestId, 'REJECT'));
    expect((await read(h, m.id)).requests[0]!.status).toBe('REJECTED');
  }, 120000);
  test.each(['FORFEIT', 'CANCELLED'] as const)(
    '%s invalidates old matchup export and prevents new or replayed promotional previews',
    async (kind) => {
      const f = await fixture(h),
        m = f.matches[0]!;
      await enable(h, f.event.id);
      const base = `/v1/orgs/${h.owner.orgId}/events/${f.event.id}/posters`;
      const version = (await read(h, m.id)).event.version;
      const body = {
        clientRequestId: randomUUID(),
        expectedEventVersion: version,
        kind: 'MATCHUP',
        matchId: m.id,
      };
      const exported = data<{ poster: { id: string } }>(
        await call(h.api, 'post', base, { cookie: h.owner.cookie, body }),
        201,
      );
      const content = base + '/' + exported.poster.id + '/content';
      const initial = await call(h.api, 'get', content, { cookie: h.owner.cookie });
      expect(initial.status).toBe(200);
      expect(initial.headers['content-type']).toMatch(/^image\/png/);
      const p = await propose(h, m.id, kind);
      data(await approve(h, m.id, p.r.requestId));
      const stale = await call(h.api, 'get', content, { cookie: h.owner.cookie });
      error(stale, 410);
      expect(stale.body.error.code).toBe('POSTER_SOURCE_UNAVAILABLE');
      const replay = await call(h.api, 'post', base, { cookie: h.owner.cookie, body });
      error(replay, 410);
      expect(replay.body.error.code).toBe('POSTER_SOURCE_UNAVAILABLE');
      const fresh = await call(h.api, 'post', base, {
        cookie: h.owner.cookie,
        body: {
          ...body,
          clientRequestId: randomUUID(),
          expectedEventVersion: (await read(h, m.id)).event.version,
        },
      });
      error(fresh, 410);
      expect(fresh.body.error.code).toBe('POSTER_SOURCE_UNAVAILABLE');
    },
    120000,
  );
  test.each(['FORFEIT', 'CANCELLED'] as const)(
    'prepared %s stays readable and can be independently revoked without changing scoring facts',
    async (kind) => {
      const f = await fixture(h),
        m = f.matches[0]!;
      await assign(h, m.id, h.owner, 'SCORER');
      const prepared = await prepare(h, m.id);
      expect(prepared.snapshot.status).toBe('READY');
      const scoringFacts = async () =>
        (
          await h.api.pool.query(
            `SELECT to_jsonb(s) AS state,
            (SELECT count(*)::int FROM scoring_events WHERE org_id=$1 AND match_id=$2) AS events,
            (SELECT count(*)::int FROM result_confirmations WHERE org_id=$1 AND match_id=$2) AS confirmations
            FROM scoring_states s WHERE org_id=$1 AND match_id=$2`,
            [h.owner.orgId, m.id],
          )
        ).rows[0];
      const originalFacts = await scoringFacts();
      const p = await propose(h, m.id, kind);
      data(await approve(h, m.id, p.r.requestId));
      for (const reviewer of [false, true]) {
        const v = await read(h, m.id, reviewer);
        expect(v.match.status).toBe('READY');
        expect(v.active).toMatchObject({ id: p.r.requestId, kind, status: 'APPROVED' });
        expect(v.capabilities).toMatchObject({ canPropose: false, canRevoke: true });
      }
      const revoke = await propose(h, m.id, kind, true);
      data(await approve(h, m.id, revoke.r.requestId));
      for (const reviewer of [false, true]) {
        const v = await read(h, m.id, reviewer);
        expect(v.match.status).toBe('READY');
        expect(v.active).toBeNull();
        expect(v.capabilities).toMatchObject({ canPropose: true, canRevoke: false });
      }
      expect(await scoringFacts()).toEqual(originalFacts);
    },
    120000,
  );
  test('natural session expiry during actual event/team lock waits rejects reads, writes and receipt replay', async () => {
    const f = await fixture(h),
      m = f.matches[0]!;
    const applicationName = new URL(h.databaseUrl).searchParams.get('application_name');
    expect(applicationName).toEqual(expect.any(String));
    async function eventually(check: () => Promise<boolean>, description: string, timeout = 15000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(description);
    }
    async function expiredAfterWait(
      actor: User,
      scope: 'EVENT' | 'TEAM',
      operation: (cookie: string) => ReturnType<typeof call>,
      eventId = f.event.id,
    ) {
      const cookie = await login(h.api, actor);
      const hash = tokenHash(cookie);
      const blocker = await h.api.pool.connect();
      let held = false,
        pending: ReturnType<typeof call> | undefined;
      try {
        await blocker.query('BEGIN');
        held = true;
        if (scope === 'EVENT')
          await blocker.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
            h.owner.orgId,
            eventId,
          ]);
        else
          await blocker.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR UPDATE', [
            h.owner.orgId,
            m.home.teamId,
          ]);
        await h.api.pool.query(
          "UPDATE sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1",
          [hash],
        );
        pending = operation(cookie);
        const pattern =
          scope === 'EVENT'
            ? '% FROM events e WHERE org_id=$1 AND id=$2 FOR % OF e'
            : 'SELECT id FROM teams WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE';
        await eventually(
          async () =>
            Number(
              (
                await h.api.pool.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND state='active' AND query LIKE $2",
                  [applicationName, pattern],
                )
              ).rows[0]!.n,
            ) > 0,
          'Expected actual adjudication request to reach its row-lock barrier',
        );
        await eventually(
          async () =>
            (
              await h.api.pool.query(
                'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE token_hash=$1',
                [hash],
              )
            ).rows[0]?.expired === true,
          'Expected natural session expiry while the request retained its session SHARE lock',
        );
        await blocker.query('ROLLBACK');
        held = false;
        const result = await pending;
        error(result, 401);
        expect(result.body.error.code).toBe('UNAUTHENTICATED');
      } finally {
        if (held) await blocker.query('ROLLBACK');
        blocker.release();
        if (pending) await pending.catch(() => {});
      }
    }
    const before = await read(h, m.id);
    const body = {
      clientRequestId: randomUUID(),
      expectedEventVersion: before.event.version,
      expectedMatchVersion: before.match.version,
      operation: 'DECLARE',
      kind: 'FORFEIT',
      forfeitingSide: 'HOME',
      reason: '合成自然到期提案回滚',
    };
    await expiredAfterWait(h.owner, 'EVENT', (cookie) =>
      call(h.api, 'post', url(h, m.id) + '/proposals', { cookie, body }),
    );
    expect((await read(h, m.id)).requests).toHaveLength(0);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM match_exception_receipts WHERE user_id=$1 AND client_request_id=$2',
          [h.owner.id, body.clientRequestId],
        )
      ).rows[0]!.n,
    ).toBe(0);

    const proposal = await propose(h, m.id),
      current = await read(h, m.id, true);
    const reviewBody = {
      clientRequestId: randomUUID(),
      expectedEventVersion: current.event.version,
      expectedMatchVersion: current.match.version,
      expectedRequestVersion: 1,
      type: 'APPROVE',
      reason: '合成自然到期复核回滚',
    };
    await expiredAfterWait(h.otherOwner, 'TEAM', (cookie) =>
      call(h.api, 'post', url(h, m.id) + '/' + proposal.r.requestId + '/review', {
        cookie,
        body: reviewBody,
      }),
    );
    const after = await read(h, m.id);
    expect(after.event.version).toBe(current.event.version);
    expect(after.active).toBeNull();
    expect(after.requests[0]!.status).toBe('PENDING');
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM match_exception_receipts WHERE user_id=$1 AND client_request_id=$2',
          [h.otherOwner.id, reviewBody.clientRequestId],
        )
      ).rows[0]!.n,
    ).toBe(0);

    await expiredAfterWait(h.owner, 'EVENT', (cookie) =>
      call(h.api, 'post', url(h, m.id) + '/proposals', { cookie, body: proposal.body }),
    );
    await expiredAfterWait(h.owner, 'EVENT', (cookie) =>
      call(h.api, 'get', url(h, m.id), { cookie }),
    );
    await expiredAfterWait(h.owner, 'EVENT', (cookie) =>
      call(h.api, 'get', rulesUrl(h, f.event.id), { cookie }),
    );
    expect((await read(h, m.id)).requests).toHaveLength(1);

    // A separate DRAFT proves rule writes roll back, not only proposals/reviews.
    const draft = data<EventData>(
      await call(h.api, 'post', eventsPath(h.owner.orgId), {
        cookie: h.owner.cookie,
        body: eventInput('合成自然到期草稿' + randomUUID().slice(0, 8)),
      }),
      201,
    );
    const rulesBody = {
      clientRequestId: randomUUID(),
      expectedEventVersion: draft.version,
      expectedVersion: 0,
      forfeitWinPoints: 2,
      forfeitLossPoints: 0,
      cancellationPolicy: 'EXCLUDE_FROM_TABLE',
    };
    await expiredAfterWait(
      h.owner,
      'EVENT',
      (cookie) => call(h.api, 'put', rulesUrl(h, draft.id), { cookie, body: rulesBody }),
      draft.id,
    );

    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM match_exception_rules WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, draft.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await h.api.pool.query('SELECT version FROM events WHERE org_id=$1 AND id=$2', [
          h.owner.orgId,
          draft.id,
        ])
      ).rows[0]!.version,
    ).toBe(draft.version);
  }, 120000);
});

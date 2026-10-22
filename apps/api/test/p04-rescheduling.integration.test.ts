import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  MatchReschedulingData,
  OverlayCommandResponse,
  OverlaySnapshotData,
  PublicScheduleMatchData,
  ScheduledMatchData,
  ScoringCommandResponse,
} from '@small-city-basketball/contracts';
import { call, data, membership, staffPath } from './support.js';
import {
  closeHarness,
  court,
  courtPath,
  createHarness,
  matchesPath,
  plusDays,
  plusMinutes,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
import {
  acquire,
  act,
  assign,
  envelope,
  finish,
  liveMatch,
  prepare,
  published,
  receiptPath,
  sendCommand,
  workbench,
} from './p05-support.js';
import { enable, publicSchedulePath, reopen, savePublishRules } from './p05b-support.js';
import {
  bootstrap,
  issue,
  overlayCookie,
  overlayData,
  overlaySnapshot,
  overlayWorkbench,
} from './p06-support.js';
import {
  assertReservations,
  conflicts,
  currentFacts,
  failingAudit,
  input,
  insertProof,
  originalFacts,
  rejected,
  reschedule,
  rescheduleCommandsPath,
  rescheduling,
  reschedulingPath,
  rows,
  scheduled,
} from './p04-rescheduling-support.js';

describe('P04-B current scheduling and immutable history on real PostgreSQL', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);

  test('one controlled change advances current versions and all reservations while preserving the original publication', async () => {
    const fixture = await scheduled(h);
    const match = fixture.matches[0]!;
    const original = await originalFacts(h, match.eventId);
    const current = await rescheduling(h, match.id);
    expect(current).toMatchObject({
      match,
      policy: fixture.schedule.policy,
      history: [],
      historyLimit: 20,
      historyTruncated: false,
      capabilities: { canReschedule: true },
    });
    const startsAt = plusMinutes(match.startsAt, 120);
    const response = await reschedule(h, current, {
      courtId: fixture.courts[1]!.id,
      startsAt,
      reason: '  合成场馆时间调整  ',
    });
    const changed = data<MatchReschedulingData>(response);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(changed.event.version).toBe(current.event.version + 1);
    expect(changed.match).toEqual({
      ...match,
      courtId: fixture.courts[1]!.id,
      courtName: fixture.courts[1]!.name,
      startsAt,
      endsAt: plusMinutes(startsAt, 60),
      version: match.version + 1,
    });
    expect(changed.history).toHaveLength(1);
    const history = changed.history[0]!;
    expect(Object.keys(history).sort()).toEqual(
      ['id', 'fromMatchVersion', 'toMatchVersion', 'from', 'to', 'reason', 'createdAt'].sort(),
    );
    expect(history).toMatchObject({
      fromMatchVersion: match.version,
      toMatchVersion: changed.match.version,
      from: {
        courtId: match.courtId,
        courtName: match.courtName,
        startsAt: match.startsAt,
        endsAt: match.endsAt,
      },
      to: {
        courtId: changed.match.courtId,
        courtName: changed.match.courtName,
        startsAt: changed.match.startsAt,
        endsAt: changed.match.endsAt,
      },
      reason: '合成场馆时间调整',
    });
    expect(await originalFacts(h, match.eventId)).toEqual(original);
    await assertReservations(h, changed);
    expect(await rescheduling(h, match.id)).toEqual(changed);
    expect(
      data<ScheduledMatchData[]>(
        await call(h.api, 'get', matchesPath(h.owner.orgId, match.eventId), {
          cookie: h.owner.cookie,
        }),
      ),
    ).toEqual([changed.match]);
    const audits = await h.api.pool.query(
      "SELECT actor_id,resource_id,metadata FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action='MATCH_RESCHEDULED'",
      [h.owner.orgId, match.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]).toMatchObject({ actor_id: h.owner.id, resource_id: match.id });
  });

  test('subsequent changes use the latest current arrangements rather than the original fixtures', async () => {
    const fixture = await scheduled(h, { teams: h.teams.slice(0, 3) });
    const [first, second] = fixture.matches;
    let current = await rescheduling(h, first!.id);
    current = data<MatchReschedulingData>(
      await reschedule(h, current, { startsAt: plusMinutes(first!.startsAt, 300) }),
    );
    const other = await rescheduling(h, second!.id);
    // This was free in the original publication, but the first change now occupies it.
    conflicts(await reschedule(h, other, { startsAt: current.match.startsAt }), 'COURT_OVERLAP');
    const changedOther = data<MatchReschedulingData>(
      await reschedule(h, other, { startsAt: first!.startsAt }),
    );
    const fresh = await rescheduling(h, first!.id);
    conflicts(
      await reschedule(h, fresh, { courtId: fixture.courts[1]!.id, startsAt: first!.startsAt }),
      'TEAM_OVERLAP',
    );
    expect(changedOther.match.startsAt).toBe(first!.startsAt);
    expect((await rescheduling(h, first!.id)).history).toHaveLength(1);
  });

  test('a rename does not silently rewrite the same-court snapshot and no-op does not create history', async () => {
    const fixture = await scheduled(h);
    const match = fixture.matches[0]!;
    data(
      await call(h.api, 'patch', courtPath(h.owner.orgId, match.courtId), {
        cookie: h.owner.cookie,
        body: {
          expectedVersion: fixture.courts[0]!.version,
          name: '改名后的原场地',
          status: 'ACTIVE',
        },
      }),
    );
    let current = await rescheduling(h, match.id);
    const before = await currentFacts(h, match.eventId, match.id);
    rejected(
      await reschedule(h, current, { startsAt: current.match.startsAt }),
      409,
      'RESCHEDULE_UNCHANGED',
    );
    expect(await currentFacts(h, match.eventId, match.id)).toEqual(before);
    current = data<MatchReschedulingData>(await reschedule(h, current));
    expect(current.match.courtName).toBe(match.courtName);
    expect(current.history[0]!.to.courtName).toBe(match.courtName);
    const renamed = data<{ name: string }>(
      await call(h.api, 'patch', courtPath(h.owner.orgId, fixture.courts[1]!.id), {
        cookie: h.owner.cookie,
        body: {
          expectedVersion: fixture.courts[1]!.version,
          name: '改名后的目标场地',
          status: 'ACTIVE',
        },
      }),
    );
    current = data<MatchReschedulingData>(
      await reschedule(h, current, { courtId: fixture.courts[1]!.id }),
    );
    expect(current.match.courtName).toBe(renamed.name);
  });

  test('recent history is bounded to twenty records with an explicit truncation flag', async () => {
    const fixture = await scheduled(h);
    let current = await rescheduling(h, fixture.matches[0]!.id);
    for (let index = 0; index < 21; index++)
      current = data<MatchReschedulingData>(
        await reschedule(h, current, {
          startsAt: plusMinutes(fixture.matches[0]!.startsAt, index % 2 ? 60 : 120),
          reason: `合成改期历史 ${index + 1}`,
        }),
      );
    expect(current.history).toHaveLength(20);
    expect(current.historyLimit).toBe(20);
    expect(current.historyTruncated).toBe(true);
    expect(current.history[0]!.reason).toBe('合成改期历史 21');
    expect(current.history.at(-1)!.reason).toBe('合成改期历史 2');
    expect(
      (
        await h.api.pool.query('SELECT id FROM match_reschedules WHERE org_id=$1 AND match_id=$2', [
          h.owner.orgId,
          current.match.id,
        ])
      ).rowCount,
    ).toBe(21);
  });

  test('strict input rejects invalid dates, missing offsets, versions, reasons and unexpected fields without mutations', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const before = await currentFacts(h, current.event.id, current.match.id);
    for (const changes of [
      { type: 'CANCEL' },
      { expectedEventVersion: 0 },
      { expectedMatchVersion: 1.5 },
      { startsAt: '2028-02-30T09:00:00+08:00' },
      { startsAt: '2028-01-01T09:00:00' },
      { reason: '   ' },
      { reason: 'x'.repeat(501) },
      { endsAt: current.match.endsAt },
      { homeTeamId: randomUUID() },
    ])
      rejected(
        await call(h.api, 'post', rescheduleCommandsPath(h.owner.orgId, current.match.id), {
          cookie: h.owner.cookie,
          body: { ...input(current), ...changes },
        }),
        422,
        'VALIDATION_ERROR',
      );
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
  });

  test('window, event date, disabled and foreign courts remain hard constraints', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const before = await currentFacts(h, current.event.id, current.match.id);
    const outsideWindow = await court(h.api, h.owner, '不在原发布策略内的场地');
    conflicts(await reschedule(h, current, { courtId: outsideWindow.id }), 'OUTSIDE_WINDOW');
    conflicts(
      await reschedule(h, current, {
        startsAt: `${plusDays(current.event.endDate, 1)}T00:01:00+08:00`,
      }),
      'OUTSIDE_EVENT_DATES',
    );
    data(
      await call(h.api, 'patch', courtPath(h.owner.orgId, fixture.courts[1]!.id), {
        cookie: h.owner.cookie,
        body: {
          expectedVersion: fixture.courts[1]!.version,
          name: fixture.courts[1]!.name,
          status: 'DISABLED',
        },
      }),
    );
    conflicts(await reschedule(h, current, { courtId: fixture.courts[1]!.id }), 'COURT_DISABLED');
    const foreign = await court(h.api, h.otherOwner);
    rejected(await reschedule(h, current, { courtId: foreign.id }), 404, 'RESOURCE_NOT_FOUND');
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
  });

  test('current sibling matches enforce both court and canonical team overlap', async () => {
    const fixture = await scheduled(h, { teams: h.teams.slice(0, 3) });
    const [first, second] = fixture.matches;
    const current = await rescheduling(h, first!.id);
    conflicts(await reschedule(h, current, { startsAt: second!.startsAt }), 'COURT_OVERLAP');
    conflicts(
      await reschedule(h, current, {
        courtId: fixture.courts[1]!.id,
        startsAt: second!.startsAt,
      }),
      'TEAM_OVERLAP',
    );
    expect((await rescheduling(h, current.match.id)).history).toEqual([]);
  });

  test('half-open adjacency, exact rest and local-date separation use the unchanged policy', async () => {
    const adjacency = await scheduled(h, { teams: h.teams.slice(0, 3) });
    const [first, second, third] = adjacency.matches;
    let current = await rescheduling(h, first!.id);
    current = data<MatchReschedulingData>(
      await reschedule(h, current, { startsAt: third!.endsAt }),
    );
    expect(current.match.startsAt).toBe(third!.endsAt);
    const rest = await scheduled(h, {
      teams: h.teams.slice(0, 3),
      stepMinutes: 120,
      policy: { minRestMinutes: 30 },
    });
    const target = await rescheduling(h, rest.matches[0]!.id);
    conflicts(
      await reschedule(h, target, { startsAt: plusMinutes(rest.matches[1]!.startsAt, -89) }),
      'MIN_REST',
    );
    data<MatchReschedulingData>(
      await reschedule(h, target, { startsAt: plusMinutes(rest.matches[1]!.startsAt, -90) }),
    );
    const gap = await scheduled(h, {
      teams: h.teams.slice(0, 3),
      stepMinutes: 2 * 24 * 60,
      policy: { minLocalDayGap: 2 },
    });
    const gapTarget = await rescheduling(h, gap.matches[0]!.id);
    // 23:30 in Shanghai is still the preceding local date, regardless of UTC midnight.
    conflicts(
      await reschedule(h, gapTarget, {
        courtId: gap.courts[1]!.id,
        startsAt: `${plusDays(gap.registration.event.startDate, 1)}T23:30:00+08:00`,
      }),
      'MIN_LOCAL_DAY_GAP',
    );
    expect(second!.endsAt).toBe(third!.startsAt);
  });

  test('actual event assignment determines write capability and revocation is checked with the old cookie', async () => {
    const fixture = await scheduled(h);
    const id = fixture.matches[0]!.id;
    const path = staffPath(h.owner.orgId, fixture.registration.event.id, h.otherOwner.id);
    data(
      await call(h.api, 'put', path, {
        cookie: h.owner.cookie,
        body: { role: 'SCORER', status: 'ACTIVE' },
      }),
    );
    let current = await rescheduling(h, id, h.otherOwner);
    expect(current.capabilities.canReschedule).toBe(false);
    rejected(await reschedule(h, current, {}, h.otherOwner), 403, 'FORBIDDEN');
    await membership(h.api, h.owner, h.otherOwner, 'SCORER');
    try {
      data(
        await call(h.api, 'put', path, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      current = await rescheduling(h, id, h.otherOwner);
      expect(current.capabilities.canReschedule).toBe(true);
      data(await reschedule(h, current, {}, h.otherOwner));
      data(
        await call(h.api, 'put', path, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      rejected(
        await call(h.api, 'get', reschedulingPath(h.owner.orgId, id), {
          cookie: h.otherOwner.cookie,
        }),
        404,
        'RESOURCE_NOT_FOUND',
      );
      rejected(
        await call(h.api, 'get', reschedulingPath(h.owner.orgId, id), { cookie: h.leader.cookie }),
        404,
        'RESOURCE_NOT_FOUND',
      );
    } finally {
      await membership(h.api, h.owner, h.otherOwner, 'EVENT_MANAGER');
    }
  });

  test('anonymous, cross-organization, unknown and untrusted-origin requests do not expose or mutate matches', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const before = await currentFacts(h, current.event.id, current.match.id);
    rejected(await call(h.api, 'get', reschedulingPath(h.owner.orgId, current.match.id)), 401);
    rejected(
      await call(h.api, 'get', reschedulingPath(h.otherOwner.orgId, current.match.id), {
        cookie: h.otherOwner.cookie,
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    rejected(
      await call(h.api, 'get', reschedulingPath(h.owner.orgId, randomUUID()), {
        cookie: h.owner.cookie,
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    for (const origin of [null, 'https://untrusted.example.test'])
      rejected(
        await call(h.api, 'post', rescheduleCommandsPath(h.owner.orgId, current.match.id), {
          cookie: h.owner.cookie,
          origin,
          body: input(current),
        }),
        403,
        'ORIGIN_REJECTED',
      );
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
  });

  test('stale event or match versions reject and identical concurrent commands apply only once', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    rejected(
      await reschedule(h, current, { expectedEventVersion: current.event.version - 1 }),
      409,
      'VERSION_CONFLICT',
    );
    rejected(
      await reschedule(h, current, { expectedMatchVersion: current.match.version + 1 }),
      409,
      'VERSION_CONFLICT',
    );
    const responses = await Promise.all([reschedule(h, current), reschedule(h, current)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rejectedResponse = responses.find((response) => response.status === 409)!;
    rejected(rejectedResponse, 409, 'VERSION_CONFLICT');
    const fresh = await rescheduling(h, current.match.id);
    expect(fresh.history).toHaveLength(1);
    expect(fresh.match.version).toBe(current.match.version + 1);
    expect(fresh.event.version).toBe(current.event.version + 1);
    await assertReservations(h, fresh);
  });

  test('closed events and explicitly postponed or cancelled matches are not rescheduled', async () => {
    for (const state of ['POSTPONED', 'CANCELLED'] as const) {
      const fixture = await scheduled(h);
      const id = fixture.matches[0]!.id;
      await h.api.pool.query(
        'UPDATE published_matches SET status=$3,version=version+1 WHERE org_id=$1 AND id=$2',
        [h.owner.orgId, id, state],
      );
      const current = await rescheduling(h, id);
      expect(current.capabilities.canReschedule).toBe(false);
      rejected(await reschedule(h, current), 409, 'MATCH_CANNOT_RESCHEDULE');
      expect(current.history).toEqual([]);
    }
    const fixture = await scheduled(h);
    await h.api.pool.query(
      "UPDATE events SET status='ARCHIVED',version=version+1 WHERE org_id=$1 AND id=$2",
      [h.owner.orgId, fixture.registration.event.id],
    );
    const current = await rescheduling(h, fixture.matches[0]!.id);
    expect(current.capabilities.canReschedule).toBe(false);
    rejected(await reschedule(h, current), 409, 'INVALID_EVENT_STATE');
  });

  test('READY keeps raw score, clocks, rules, events and lease while invalidating an old-version scoring command', async () => {
    const fixture = await published(h, h.teams.slice(0, 2), { periodDurationSeconds: 600 });
    const id = fixture.matches[0]!.id;
    await assign(h, id, h.otherOwner);
    const prepared = await prepare(h, id);
    const lease = await acquire(h, id);
    const prior = await workbench(h, id, h.otherOwner);
    const scoringBefore = await rows(
      h,
      "SELECT to_jsonb(s)-'source_version'-'updated_at' AS state FROM scoring_states s WHERE org_id=$1 AND match_id=$2",
      [h.owner.orgId, id],
    );
    const leaseBefore = await rows(
      h,
      'SELECT * FROM scoring_leases WHERE org_id=$1 AND match_id=$2',
      [h.owner.orgId, id],
    );
    const eventsBefore = await rows(
      h,
      'SELECT * FROM scoring_events WHERE org_id=$1 AND match_id=$2',
      [h.owner.orgId, id],
    );
    const commandsBefore = await rows(
      h,
      'SELECT * FROM scoring_commands WHERE org_id=$1 AND match_id=$2',
      [h.owner.orgId, id],
    );
    const current = await rescheduling(h, id);
    const changed = data<MatchReschedulingData>(await reschedule(h, current));
    expect(changed.match.status).toBe('READY');
    expect(
      await rows(
        h,
        "SELECT to_jsonb(s)-'source_version'-'updated_at' AS state FROM scoring_states s WHERE org_id=$1 AND match_id=$2",
        [h.owner.orgId, id],
      ),
    ).toEqual(scoringBefore);
    expect(
      await rows(h, 'SELECT * FROM scoring_leases WHERE org_id=$1 AND match_id=$2', [
        h.owner.orgId,
        id,
      ]),
    ).toEqual(leaseBefore);
    expect(
      await rows(h, 'SELECT * FROM scoring_events WHERE org_id=$1 AND match_id=$2', [
        h.owner.orgId,
        id,
      ]),
    ).toEqual(eventsBefore);
    expect(
      await rows(h, 'SELECT * FROM scoring_commands WHERE org_id=$1 AND match_id=$2', [
        h.owner.orgId,
        id,
      ]),
    ).toEqual(commandsBefore);
    rejected(
      await sendCommand(
        h,
        id,
        h.otherOwner,
        envelope(
          prior.match.version,
          { type: 'START_MATCH', payload: { expectedEventVersion: prior.event.version } },
          lease,
        ),
      ),
      409,
      'VERSION_CONFLICT',
    );
    const fresh = await workbench(h, id, h.otherOwner);
    expect(fresh.snapshot!.version).toBe(changed.match.version);
    const acceptedPrepare = data<ScoringCommandResponse>(
      await call(h.api, 'get', receiptPath(h.owner.orgId, id, prepared.receipt.commandId), {
        cookie: h.owner.cookie,
      }),
    );
    expect(acceptedPrepare.receipt).toEqual(prepared.receipt);
    expect(acceptedPrepare.snapshot.version).toBe(changed.match.version);
    const started = data<ScoringCommandResponse>(
      await sendCommand(
        h,
        id,
        h.otherOwner,
        envelope(
          fresh.match.version,
          { type: 'START_MATCH', payload: { expectedEventVersion: fresh.event.version } },
          lease,
        ),
      ),
    );
    expect(started.snapshot.status).toBe('LIVE');
    // START_MATCH admits scoring; CLOCK_START is the separate authoritative timer action.
    expect(started.snapshot.clock).toEqual(fresh.snapshot!.clock);
    expect(started.snapshot.version).toBe(fresh.match.version + 1);
    expect(started.snapshot.lastEventSeq).toBe(fresh.snapshot!.lastEventSeq + 1);
    expect(started.receipt).toMatchObject({
      type: 'START_MATCH',
      appliedVersion: fresh.match.version + 1,
    });
  });

  test('LIVE, pending, final and reopened results cannot change the plan', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const live = await liveMatch(h, fixture);
    const unchanged = await originalFacts(h, fixture.event.event.id);
    for (const advance of [
      async () => undefined,
      () => finish(h, live.matchId, h.otherOwner, live.lease),
      () => act(h, live.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} }),
      () => reopen(h, live.matchId),
    ]) {
      await advance();
      const current = await rescheduling(h, live.matchId);
      expect(current.capabilities.canReschedule).toBe(false);
      rejected(await reschedule(h, current), 409, 'MATCH_CANNOT_RESCHEDULE');
      expect(current.history).toEqual([]);
      expect(await originalFacts(h, current.event.id)).toEqual(unchanged);
    }
  });

  test('a prior START_MATCH remains a prohibition even if a corrupted row is labelled READY again', async () => {
    const fixture = await published(h, h.teams.slice(0, 2), { periodDurationSeconds: 600 });
    const live = await liveMatch(h, fixture);
    expect(live.snapshot.clock.running).toBe(false);
    expect(
      (
        await h.api.pool.query(
          "SELECT type FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND type='START_MATCH'",
          [h.owner.orgId, live.matchId],
        )
      ).rows,
    ).toEqual([{ type: 'START_MATCH' }]);
    const client = await h.api.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE published_matches SET status='READY',version=version+1 WHERE org_id=$1 AND id=$2",
        [h.owner.orgId, live.matchId],
      );
      await client.query(
        'UPDATE scoring_states SET source_version=source_version+1 WHERE org_id=$1 AND match_id=$2',
        [h.owner.orgId, live.matchId],
      );
      await client.query('COMMIT');
    } catch (failure) {
      await client.query('ROLLBACK');
      throw failure;
    } finally {
      client.release();
    }
    const current = await rescheduling(h, live.matchId);
    expect(current.match.status).toBe('READY');
    expect(current.capabilities.canReschedule).toBe(false);
    rejected(await reschedule(h, current), 409, 'MATCH_CANNOT_RESCHEDULE');
  });

  test('audit failure rolls back the entire current plan, versions, history and reservations', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const before = await currentFacts(h, current.event.id, current.match.id);
    await failingAudit(h, current.event.id, current.match.id, async () => {
      const response = await reschedule(h, current);
      rejected(response, 500);
      expect(JSON.stringify(response.body)).not.toMatch(
        /synthetic rescheduling|audit_logs|SQLSTATE|postgres/i,
      );
    });
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
    await assertReservations(h, current);
  });

  test('deferred reservation completeness rejects COMMIT and rolls back the plan and proof', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const before = await currentFacts(h, current.event.id, current.match.id);
    const client = await h.api.pool.connect();
    try {
      await client.query('BEGIN');
      expect((await insertProof(client, h, current)).rowCount).toBe(1);
      expect(
        (
          await client.query(
            "UPDATE published_matches SET starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours',version=version+1 WHERE org_id=$1 AND id=$2",
            [h.owner.orgId, current.match.id],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await client.query(
            "UPDATE court_reservations SET starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours' WHERE org_id=$1 AND match_id=$2",
            [h.owner.orgId, current.match.id],
          )
        ).rowCount,
      ).toBe(1);
      await client.query('UPDATE events SET version=version+1 WHERE org_id=$1 AND id=$2', [
        h.owner.orgId,
        current.event.id,
      ]);
      // Deliberately leave both team reservations at the old time. The INSERT and
      // UPDATE statements succeed; the actual deferred constraint must reject COMMIT.
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
  });

  test('SQL cannot alter a plan without a current proof, delete reservations or mutate immutable history', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const changed = data<MatchReschedulingData>(await reschedule(h, current));
    const before = await currentFacts(h, current.event.id, current.match.id);
    for (const sql of [
      "UPDATE published_matches SET starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute',version=version+1 WHERE org_id=$1 AND id=$2",
      "UPDATE court_reservations SET starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' WHERE org_id=$1 AND match_id=$2",
      "UPDATE team_reservations SET starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' WHERE org_id=$1 AND match_id=$2",
      'DELETE FROM court_reservations WHERE org_id=$1 AND match_id=$2',
      'DELETE FROM team_reservations WHERE org_id=$1 AND match_id=$2',
      "UPDATE match_reschedules SET reason='覆盖历史' WHERE org_id=$1 AND match_id=$2",
      'DELETE FROM match_reschedules WHERE org_id=$1 AND match_id=$2',
    ])
      await expect(h.api.pool.query(sql, [h.owner.orgId, current.match.id])).rejects.toMatchObject({
        code: '23514',
      });
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
    await assertReservations(h, changed);
  });

  test('an otherwise valid isolated history insert cannot commit without its exact plan and version changes', async () => {
    const fixture = await scheduled(h);
    const current = await rescheduling(h, fixture.matches[0]!.id);
    const before = await currentFacts(h, current.event.id, current.match.id);
    const client = await h.api.pool.connect();
    try {
      await client.query('BEGIN');
      expect((await insertProof(client, h, current)).rowCount).toBe(1);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
  });

  test('public identity and overlay authorization survive a new current time while both old schedule cursors expire', async () => {
    const fixture = await scheduled(h, { teams: h.teams.slice(0, 3) });
    const target = fixture.matches[0]!;
    await savePublishRules(h, target.eventId);
    const viewing = await enable(h, target.eventId);
    const publicId = viewing.publication!.publicEventId;
    const issued = await issue(h, target.id);
    const key = (issued as OverlayCommandResponse).credential!;
    const bootstrapped = await bootstrap(h, key.overlayId, key.token);
    overlayData(bootstrapped);
    const sourceCookie = overlayCookie(bootstrapped);
    const sourceBefore = data<OverlaySnapshotData>(
      await overlaySnapshot(h, key.overlayId, sourceCookie),
    );
    const grantBefore = await overlayWorkbench(h, target.id);
    const publicBefore = data<PublicScheduleMatchData[]>(
      await call(h.api, 'get', publicSchedulePath(publicId)),
    );
    const publicMatchId = publicBefore.find(
      (match) =>
        match.home.teamName === target.home.teamName &&
        match.away.teamName === target.away.teamName,
    )!.publicMatchId;
    const privatePage = await call(
      h.api,
      'get',
      `${matchesPath(h.owner.orgId, target.eventId)}?limit=1`,
      { cookie: h.owner.cookie },
    );
    const publicPage = await call(h.api, 'get', `${publicSchedulePath(publicId)}?limit=1`);
    data(privatePage);
    data(publicPage);
    expect(privatePage.body.meta.nextCursor).toEqual(expect.any(String));
    expect(publicPage.body.meta.nextCursor).toEqual(expect.any(String));
    const current = await rescheduling(h, target.id);
    const changed = data<MatchReschedulingData>(
      await reschedule(h, current, { startsAt: plusMinutes(fixture.matches.at(-1)!.endsAt, 60) }),
    );
    const publicAfter = data<PublicScheduleMatchData[]>(
      await call(h.api, 'get', publicSchedulePath(publicId)),
    );
    expect(publicAfter.find((match) => match.publicMatchId === publicMatchId)).toMatchObject({
      startsAt: changed.match.startsAt,
      endsAt: changed.match.endsAt,
      version: changed.match.version,
    });
    const sourceAfter = data<OverlaySnapshotData>(
      await overlaySnapshot(h, key.overlayId, sourceCookie),
    );
    expect(sourceAfter).toMatchObject({
      overlayId: key.overlayId,
      matchVersion: changed.match.version,
      score: sourceBefore.score,
      clock: sourceBefore.clock,
      status: sourceBefore.status,
      expiresAt: sourceBefore.expiresAt,
    });
    expect((await overlayWorkbench(h, target.id)).currentGrant).toEqual(grantBefore.currentGrant);
    const privateStale = await call(
      h.api,
      'get',
      `${matchesPath(h.owner.orgId, target.eventId)}?limit=1&cursor=${encodeURIComponent(privatePage.body.meta.nextCursor)}`,
      { cookie: h.owner.cookie },
    );
    const publicStale = await call(
      h.api,
      'get',
      `${publicSchedulePath(publicId)}?limit=1&cursor=${encodeURIComponent(publicPage.body.meta.nextCursor)}`,
    );
    rejected(privateStale, 422);
    rejected(publicStale, 422);
  });
});

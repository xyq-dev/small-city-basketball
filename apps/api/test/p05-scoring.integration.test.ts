import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventScoringData,
  ResultConfirmationData,
  ScoringCommandPayload,
  ScoringCommandResponse,
  ScoringEventData,
  ScoringMatchSummary,
  ScoreSnapshot,
} from '@small-city-basketball/contracts';
import { call, data, error, eventually } from './support.js';
import { allPages } from './p03-support.js';
import { blockedPid, matchesPath } from './p04-support.js';
import { grant, grantPath } from './p03-support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  commandsPath,
  confirmationsPath,
  createScoringHarness,
  defaultRules,
  envelope,
  eventScoringPath,
  finish,
  leasePath,
  liveMatch,
  prepare,
  published,
  release,
  scoringEventsPath,
  scoringMatchesPath,
  scoringRulesPath,
  sendCommand,
  snapshotPath,
  start,
  workbench,
  workbenchPath,
} from './p05-support.js';
import type { Harness } from './p05-support.js';

async function planFacts(h: Harness, eventId: string) {
  const facts: Record<string, unknown> = {};
  for (const [name, sql] of Object.entries({
    revisions:
      'SELECT to_jsonb(r) AS data FROM schedule_revisions r WHERE org_id=$1 AND event_id=$2',
    fixtures: 'SELECT to_jsonb(f) AS data FROM schedule_fixtures f WHERE org_id=$1 AND event_id=$2',
    publication:
      'SELECT to_jsonb(p) AS data FROM schedule_publications p WHERE org_id=$1 AND event_id=$2',
    matches:
      "SELECT to_jsonb(m)-'status'-'version' AS data FROM published_matches m WHERE org_id=$1 AND event_id=$2",
    courtReservations:
      'SELECT to_jsonb(r) AS data FROM court_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    teamReservations:
      'SELECT to_jsonb(r) AS data FROM team_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
  }))
    facts[name] = (
      await h.api.pool.query<{ data: unknown }>(`SELECT data FROM (${sql}) q ORDER BY data::text`, [
        h.owner.orgId,
        eventId,
      ])
    ).rows.map((row) => row.data);
  return facts;
}

describe(
  'P05 scoring rules, least privilege and append-only statistics on PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 60000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('a match-only scorer reads and writes just its assigned match while the private snapshot and P04 plan stay consistent', async () => {
      const fixture = await published(h);
      const matchId = fixture.matches[0]!.id;
      const hiddenId = fixture.matches[1]!.id;
      const originalPlan = await planFacts(h, fixture.event.event.id);
      expect((await workbench(h, matchId)).snapshot).toBeNull();
      const unprepared = await call(h.api, 'get', snapshotPath(h.owner.orgId, matchId), {
        cookie: h.owner.cookie,
      });
      error(unprepared, 409);
      expect(unprepared.body.error.code).toBe('MATCH_NOT_PREPARED');
      error(
        await call(h.api, 'post', leasePath(h.owner.orgId, matchId), {
          cookie: h.owner.cookie,
          body: { clientInstanceId: randomUUID() },
        }),
        403,
      );
      await assign(h, matchId, h.otherOwner);
      const staff = await h.api.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3',
        [h.owner.orgId, fixture.event.event.id, h.otherOwner.id],
      );
      expect(staff.rows[0]!.count).toBe(0);
      expect((await workbench(h, matchId, h.otherOwner)).staff).toContainEqual(
        expect.objectContaining({ userId: h.otherOwner.id, role: 'SCORER', status: 'ACTIVE' }),
      );
      for (const path of [
        workbenchPath(h.owner.orgId, hiddenId),
        eventScoringPath(h.owner.orgId, fixture.event.event.id),
        matchesPath(h.owner.orgId, fixture.event.event.id),
      ])
        error(await call(h.api, 'get', path, { cookie: h.otherOwner.cookie }), 404);
      error(
        await call(h.api, 'get', workbenchPath(h.otherOwner.orgId, matchId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      error(
        await call(h.api, 'get', workbenchPath(h.owner.orgId, matchId), {
          cookie: h.leader.cookie,
        }),
        404,
      );
      const ready = await prepare(h, matchId);
      expect(ready.snapshot).toMatchObject({
        status: 'READY',
        clock: { period: 1, remainingMs: 1000, running: false },
      });
      expect((await workbench(h, matchId, h.otherOwner)).capabilities.canAcquireControl).toBe(true);
      const lease = await acquire(h, matchId);
      const started = await start(h, matchId, h.otherOwner, lease);
      expect(started.snapshot).toMatchObject({
        status: 'LIVE',
        totals: {
          home: { score: 0, fouls: 0, timeouts: 0 },
          away: { score: 0, fouls: 0, timeouts: 0 },
        },
        clock: { running: false },
      });
      const snapshot = data<ScoreSnapshot>(
        await call(h.api, 'get', snapshotPath(h.owner.orgId, matchId), {
          cookie: h.otherOwner.cookie,
        }),
      );
      expect(snapshot.version).toBe((await workbench(h, matchId)).match.version);
      expect((await workbench(h, matchId)).match).toMatchObject({
        fixtureKey: fixture.matches[0]!.fixtureKey,
        roundNo: fixture.matches[0]!.roundNo,
        positionNo: fixture.matches[0]!.positionNo,
      });
      error(await call(h.api, 'get', snapshotPath(h.owner.orgId, matchId)), 401);
      expect(snapshot.collected).toEqual({
        teamScore: true,
        teamFouls: true,
        teamTimeouts: true,
        playerStatistics: false,
      });
      expect(JSON.stringify(snapshot)).not.toMatch(
        /"(?:leaseId|fencingToken|clientInstanceId|session|control|phone|idNumber|insurance)"/,
      );
      expect(JSON.stringify(snapshot)).not.toContain(lease.leaseId);
      const listed = await allPages<ScoringMatchSummary>(
        h.api,
        `${scoringMatchesPath(h.owner.orgId)}?limit=1`,
        h.otherOwner,
      );
      expect(listed.items.map((item) => item.matchId)).toEqual([matchId]);
      const planned = data<import('@small-city-basketball/contracts').ScheduledMatchData[]>(
        await call(h.api, 'get', matchesPath(h.owner.orgId, fixture.event.event.id), {
          cookie: h.owner.cookie,
        }),
      );
      expect(planned.find((match) => match.id === matchId)).toMatchObject({
        status: 'LIVE',
        version: snapshot.version,
      });
      expect(planned.find((match) => match.id === hiddenId)!.status).toBe('SCHEDULED');
      expect(await planFacts(h, fixture.event.event.id)).toEqual(originalPlan);
    });

    test('valid score/foul/timeout operations and correction replacements preserve the original events and period', async () => {
      const fixture = await published(h);
      const live = await liveMatch(h, fixture);
      const score = await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        live.lease,
      );
      await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'FOUL', side: 'HOME', value: 1 } },
        live.lease,
      );
      const timeout = await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'TIMEOUT', side: 'AWAY', value: 1 } },
        live.lease,
      );
      expect(timeout.snapshot.totals).toEqual({
        home: { score: 1, fouls: 1, timeouts: 0 },
        away: { score: 0, fouls: 0, timeouts: 1 },
      });
      const before = await allPages<ScoringEventData>(
        h.api,
        `${scoringEventsPath(h.owner.orgId, live.matchId)}?limit=2`,
        h.otherOwner,
      );
      const original = before.items.find((item) => item.seq === score.receipt.lastEventSeq)!;
      expect(original).toMatchObject({
        type: 'STAT_RECORDED',
        payload: { kind: 'SCORE', side: 'HOME', value: 1, period: 1 },
      });
      const replaced = await act(
        h,
        live.matchId,
        h.otherOwner,
        {
          type: 'REPLACE_STAT',
          payload: {
            targetEventId: original.id,
            side: 'AWAY',
            value: 3,
            reason: '原记录队伍和分值有误',
          },
        },
        live.lease,
      );
      expect(replaced.snapshot.version).toBe(timeout.snapshot.version + 1);
      expect(replaced.receipt.lastEventSeq! - replaced.receipt.firstEventSeq!).toBe(1);
      expect(replaced.snapshot.totals).toEqual({
        home: { score: 0, fouls: 1, timeouts: 0 },
        away: { score: 3, fouls: 0, timeouts: 1 },
      });
      const history = await allPages<ScoringEventData>(
        h.api,
        `${scoringEventsPath(h.owner.orgId, live.matchId)}?limit=2`,
        h.otherOwner,
      );
      expect(history.items.find((item) => item.id === original.id)).toEqual(original);
      const replacement = history.items.find((item) => item.seq === replaced.receipt.lastEventSeq)!;
      expect(replacement).toMatchObject({
        type: 'STAT_RECORDED',
        payload: { kind: 'SCORE', side: 'AWAY', value: 3, period: 1 },
      });
      expect(
        history.items.find((item) => item.seq === replaced.receipt.firstEventSeq),
      ).toMatchObject({ type: 'STAT_VOIDED', targetEventId: original.id });
      const voided = await act(
        h,
        live.matchId,
        h.otherOwner,
        {
          type: 'VOID_STAT',
          payload: { targetEventId: replacement.id, reason: '重复记入，保留撤销记录' },
        },
        live.lease,
      );
      expect(voided.snapshot.totals.away.score).toBe(0);
      const corrected = await act(
        h,
        live.matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: { kind: 'FOUL', side: 'HOME', value: 1, period: 1, reason: '补录本节犯规' },
        },
        live.lease,
      );
      expect(corrected.snapshot.totals.home.fouls).toBe(2);
      expect(corrected.snapshot.periods).toContainEqual({
        period: 1,
        home: { score: 0, fouls: 2, timeouts: 0 },
        away: { score: 0, fouls: 0, timeouts: 1 },
      });
      const finalEvents = await allPages<ScoringEventData>(
        h.api,
        `${scoringEventsPath(h.owner.orgId, live.matchId)}?limit=2`,
        h.otherOwner,
      );
      expect(finalEvents.items.map((item) => item.seq)).toEqual(
        Array.from({ length: finalEvents.items.length }, (_, index) => index + 1),
      );
      expect(new Set(finalEvents.items.map((item) => item.id)).size).toBe(finalEvents.items.length);
    });

    test('rules use explicit validation and Event CAS, and first READY permanently locks the chosen ruleset', async () => {
      const fixture = await published(h);
      const matchId = fixture.matches[0]!.id;
      const current = await workbench(h, matchId);
      const missing = await sendCommand(
        h,
        matchId,
        h.owner,
        envelope(current.match.version, {
          type: 'PREPARE_MATCH',
          payload: { expectedEventVersion: current.event.version },
        }),
      );
      error(missing, 409);
      expect(missing.body.error.code).toBe('SCORER_REQUIRED');
      for (const invalid of [
        { regulationPeriods: 0 },
        { regulationPeriods: 9 },
        { periodDurationSeconds: 0 },
        { allowedScoreValues: [] },
        { allowedScoreValues: [1, 1] },
        { allowedScoreValues: [4] },
        { tiePolicy: 'ALLOW_DRAW', overtimeDurationSeconds: 1 },
        { tiePolicy: 'OVERTIME', overtimeDurationSeconds: null },
        { actorId: h.otherOwner.id },
      ])
        error(
          await call(h.api, 'put', scoringRulesPath(h.owner.orgId, fixture.event.event.id), {
            cookie: h.owner.cookie,
            body: {
              ...defaultRules(),
              expectedEventVersion: fixture.event.event.version,
              ...invalid,
            },
          }),
          422,
        );
      const updated = data<EventScoringData>(
        await call(h.api, 'put', scoringRulesPath(h.owner.orgId, fixture.event.event.id), {
          cookie: h.owner.cookie,
          body: {
            ...defaultRules({ allowedScoreValues: [1, 3] }),
            expectedEventVersion: fixture.event.event.version,
          },
        }),
      );
      expect(updated.rules!.version).toBe(fixture.event.rules!.version + 1);
      error(
        await call(h.api, 'put', scoringRulesPath(h.owner.orgId, fixture.event.event.id), {
          cookie: h.owner.cookie,
          body: { ...defaultRules(), expectedEventVersion: fixture.event.event.version },
        }),
        409,
      );
      await assign(h, matchId, h.otherOwner);
      await prepare(h, matchId);
      const locked = data<EventScoringData>(
        await call(h.api, 'get', eventScoringPath(h.owner.orgId, fixture.event.event.id), {
          cookie: h.owner.cookie,
        }),
      );
      expect(locked).toMatchObject({
        locked: true,
        rules: { id: updated.rules!.id },
        capabilities: { canManageRules: false },
      });
      const refused = await call(
        h.api,
        'put',
        scoringRulesPath(h.owner.orgId, fixture.event.event.id),
        {
          cookie: h.owner.cookie,
          body: { ...defaultRules(), expectedEventVersion: locked.event.version },
        },
      );
      error(refused, 409);
      expect(refused.body.error.code).toBe('SCORING_RULES_LOCKED');
      expect((await workbench(h, fixture.matches[1]!.id)).rules!.id).toBe(updated.rules!.id);
    });

    test('the database clock anchors elapsed time, reaching zero without automatic pause, events or finalization', async () => {
      const fixture = await published(h);
      const live = await liveMatch(h, fixture);
      const before = await workbench(h, live.matchId, h.otherOwner);
      const input = envelope(
        before.match.version,
        { type: 'CLOCK_START', payload: {} },
        live.lease,
      );
      input.capturedAt = '2099-12-31T23:59:59.000Z';
      const started = data<ScoringCommandResponse>(
        await sendCommand(h, live.matchId, h.otherOwner, input),
      );
      const dbTime = (
        await h.api.pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')
      ).rows[0]!.now.getTime();
      expect(Math.abs(Date.parse(started.snapshot.clock.anchorServerTime) - dbTime)).toBeLessThan(
        5000,
      );
      expect(Date.parse(started.snapshot.clock.anchorServerTime)).toBeLessThan(
        Date.parse(input.capturedAt),
      );
      const elapsed = await eventually(
        async () =>
          data<ScoreSnapshot>(
            await call(h.api, 'get', snapshotPath(h.owner.orgId, live.matchId), {
              cookie: h.otherOwner.cookie,
            }),
          ),
        (snapshot) =>
          Date.parse(snapshot.serverTime) - Date.parse(snapshot.clock.anchorServerTime) >= 1000,
        'The one-second DB clock never elapsed',
        5000,
      );
      expect(elapsed).toMatchObject({
        status: 'LIVE',
        version: started.snapshot.version,
        lastEventSeq: started.snapshot.lastEventSeq,
        clock: { running: true, clockVersion: started.snapshot.clock.clockVersion },
        latestConfirmation: null,
      });
      expect(
        Math.max(
          0,
          elapsed.clock.remainingMs -
            (Date.parse(elapsed.serverTime) - Date.parse(elapsed.clock.anchorServerTime)),
        ),
      ).toBe(0);
      const paused = await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'CLOCK_PAUSE', payload: {} },
        live.lease,
      );
      expect(paused.snapshot.clock).toMatchObject({ running: false, remainingMs: 0 });
      expect(paused.snapshot.version).toBe(started.snapshot.version + 1);
      expect(paused.snapshot.clock.clockVersion).toBe(started.snapshot.clock.clockVersion + 1);
    }, 15000);

    test('regulation periods, overtime and paused-zero ending follow explicit rules instead of implicit shortcuts', async () => {
      const fixture = await published(h, h.teams.slice(0, 4), {
        regulationPeriods: 2,
        tiePolicy: 'OVERTIME',
        overtimeDurationSeconds: 1,
      });
      const live = await liveMatch(h, fixture);
      const invalidState = async (type: 'NEXT_PERIOD' | 'END_MATCH' | 'START_OVERTIME') => {
        const current = await workbench(h, live.matchId, h.otherOwner);
        const failed = await sendCommand(
          h,
          live.matchId,
          h.otherOwner,
          envelope(current.match.version, { type, payload: {} }, live.lease),
        );
        error(failed, 409);
        expect(failed.body.error.code).toBe('INVALID_MATCH_STATE');
      };
      await invalidState('END_MATCH');
      await invalidState('NEXT_PERIOD');
      await invalidState('START_OVERTIME');
      await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '第一节到时' } },
        live.lease,
      );
      const second = await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'NEXT_PERIOD', payload: {} },
        live.lease,
      );
      expect(second.snapshot.clock).toMatchObject({ period: 2, remainingMs: 1000, running: false });
      await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '第二节到时' } },
        live.lease,
      );
      const tied = await workbench(h, live.matchId, h.otherOwner);
      const premature = await sendCommand(
        h,
        live.matchId,
        h.otherOwner,
        envelope(tied.match.version, { type: 'END_MATCH', payload: {} }, live.lease),
      );
      error(premature, 422);
      expect(premature.body.error.code).toBe('RULE_CONFLICT');
      const overtime = await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'START_OVERTIME', payload: {} },
        live.lease,
      );
      expect(overtime.snapshot.clock).toMatchObject({
        period: 3,
        remainingMs: 1000,
        running: false,
      });
      await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
        live.lease,
      );
      const pending = await finish(h, live.matchId, h.otherOwner, live.lease);
      expect(pending.snapshot).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        clock: { running: false, remainingMs: 0 },
        totals: { home: { score: 2 } },
      });
    });

    test('invalid values, foreign targets and repeated voids cannot change the scoring projection', async () => {
      const fixture = await published(h);
      const first = await liveMatch(h, fixture);
      const second = await liveMatch(h, fixture, 1);
      const foreignScore = await act(
        h,
        second.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
        second.lease,
      );
      const foreignEvents = await allPages<ScoringEventData>(
        h.api,
        `${scoringEventsPath(h.owner.orgId, second.matchId)}?limit=100`,
        h.otherOwner,
      );
      const foreignId = foreignEvents.items.find(
        (item) => item.seq === foreignScore.receipt.lastEventSeq,
      )!.id;
      const original = data<ScoreSnapshot>(
        await call(h.api, 'get', snapshotPath(h.owner.orgId, first.matchId), {
          cookie: h.otherOwner.cookie,
        }),
      );
      const invalidCommands = [
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 4 } },
        { type: 'RECORD_STAT', payload: { kind: 'FOUL', side: 'HOME', value: 2 } },
        { type: 'RECORD_STAT', payload: { kind: 'TIMEOUT', side: 'AWAY', value: 2 } },
        {
          type: 'ADD_CORRECTION',
          payload: { kind: 'SCORE', side: 'HOME', value: 1, period: 2, reason: '未来节次' },
        },
        { type: 'VOID_STAT', payload: { targetEventId: foreignId, reason: '不能跨场撤销' } },
        {
          type: 'REPLACE_STAT',
          payload: { targetEventId: foreignId, side: 'HOME', value: 1, reason: '不能跨场替换' },
        },
      ] as const;
      for (const invalid of invalidCommands)
        error(
          await sendCommand(
            h,
            first.matchId,
            h.otherOwner,
            envelope(original.version, invalid, first.lease),
          ),
          422,
        );
      const forged = {
        ...envelope(
          original.version,
          { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
          first.lease,
        ),
        actorId: h.owner.id,
      };
      error(
        await call(h.api, 'post', commandsPath(h.owner.orgId, first.matchId), {
          cookie: h.otherOwner.cookie,
          body: forged,
        }),
        422,
      );
      const unchanged = data<ScoreSnapshot>(
        await call(h.api, 'get', snapshotPath(h.owner.orgId, first.matchId), {
          cookie: h.otherOwner.cookie,
        }),
      );
      expect(unchanged).toMatchObject({
        version: original.version,
        totals: original.totals,
        lastEventSeq: original.lastEventSeq,
      });
      const score = await act(
        h,
        first.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        first.lease,
      );
      const events = await allPages<ScoringEventData>(
        h.api,
        `${scoringEventsPath(h.owner.orgId, first.matchId)}?limit=100`,
        h.otherOwner,
      );
      const target = events.items.find((item) => item.seq === score.receipt.lastEventSeq)!;
      const voided = await act(
        h,
        first.matchId,
        h.otherOwner,
        { type: 'VOID_STAT', payload: { targetEventId: target.id, reason: '撤销错误得分' } },
        first.lease,
      );
      const repeat = await sendCommand(
        h,
        first.matchId,
        h.otherOwner,
        envelope(
          voided.snapshot.version,
          { type: 'VOID_STAT', payload: { targetEventId: target.id, reason: '不能重复撤销' } },
          first.lease,
        ),
      );
      error(repeat, 409);
      expect(repeat.body.error.code).toBe('INVALID_MATCH_STATE');
    });

    test('historical scorer participation survives stat voiding and staff revocation; OWNER cannot confirm itself', async () => {
      const fixture = await published(h);
      const live = await liveMatch(h, fixture, 0, h.owner);
      const score = await act(
        h,
        live.matchId,
        h.owner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        live.lease,
      );
      const events = await allPages<ScoringEventData>(
        h.api,
        `${scoringEventsPath(h.owner.orgId, live.matchId)}?limit=100`,
        h.owner,
      );
      const target = events.items.find((item) => item.seq === score.receipt.lastEventSeq)!;
      await act(
        h,
        live.matchId,
        h.owner,
        {
          type: 'VOID_STAT',
          payload: { targetEventId: target.id, reason: '本次得分无效，但不能洗掉历史参与' },
        },
        live.lease,
      );
      await finish(h, live.matchId, h.owner, live.lease);
      await assign(h, live.matchId, h.owner, 'SCORER', 'DISABLED');
      const current = await workbench(h, live.matchId);
      expect(current.capabilities.canConfirm).toBe(false);
      error(
        await sendCommand(
          h,
          live.matchId,
          h.owner,
          envelope(current.match.version, { type: 'CONFIRM_RESULT', payload: {} }),
        ),
        403,
      );
      await assign(h, live.matchId, h.otherOwner, 'RESULT_REVIEWER');
      const confirmed = await act(h, live.matchId, h.otherOwner, {
        type: 'CONFIRM_RESULT',
        payload: {},
      });
      expect(confirmed.snapshot.status).toBe('FINAL');
      expect(confirmed.snapshot.latestConfirmation!.confirmingUserId).toBe(h.otherOwner.id);
    });

    test('a Team grant activated before confirmation makes the waiting OWNER ineligible', async () => {
      const fixture = await published(h);
      const live = await liveMatch(h, fixture);
      const pending = await finish(h, live.matchId, h.otherOwner, live.lease);
      const match = fixture.matches[0]!;
      const selected = [match.home.teamId, match.away.teamId].sort()[0]!;
      const target = h.teams.find((item) => item.id === selected)!;
      await grant(h.api, h.owner, target, h.owner, 'DISABLED');
      expect((await workbench(h, live.matchId)).capabilities.canConfirm).toBe(true);
      const blocker = await h.api.pool.connect();
      let activating: ReturnType<typeof call> | undefined;
      let confirming: ReturnType<typeof call> | undefined;
      let released = false;
      try {
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query(
          'SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 FOR UPDATE',
          [h.owner.orgId, selected, h.owner.id],
        );
        activating = call(h.api, 'put', grantPath(h.owner.orgId, selected, h.owner.id), {
          cookie: h.owner.cookie,
          body: { status: 'ACTIVE' },
        });
        const activationPid = await blockedPid(
          h.api.pool,
          pid,
          'Team grant activation never waited on its externally locked grant',
        );
        confirming = sendCommand(
          h,
          live.matchId,
          h.owner,
          envelope(pending.snapshot.version, { type: 'CONFIRM_RESULT', payload: {} }),
        );
        await blockedPid(
          h.api.pool,
          activationPid,
          'Confirmation failed to wait for Team grant activation',
        );
        await blocker.query('COMMIT');
        released = true;
        data(await activating);
        error(await confirming, 403);
        const current = await workbench(h, live.matchId);
        expect(current.snapshot).toMatchObject({
          status: 'PENDING_CONFIRMATION',
          version: pending.snapshot.version,
          latestConfirmation: null,
        });
        expect(current.capabilities.canConfirm).toBe(false);
        expect(
          (
            await allPages<ResultConfirmationData>(
              h.api,
              `${confirmationsPath(h.owner.orgId, live.matchId)}?limit=100`,
              h.owner,
            )
          ).items,
        ).toEqual([]);
      } finally {
        if (!released) await blocker.query('ROLLBACK');
        blocker.release();
        await Promise.allSettled([activating, confirming].filter((item) => item !== undefined));
        await grant(h.api, h.owner, target, h.owner, 'DISABLED');
      }
    }, 30000);

    test('confirmation requires the exact current version and reopening preserves the old result without returning LIVE', async () => {
      const fixture = await published(h);
      const originalPlan = await planFacts(h, fixture.event.event.id);
      const live = await liveMatch(h, fixture);
      const pending = await finish(h, live.matchId, h.otherOwner, live.lease);
      const blockedCommands: ScoringCommandPayload[] = [
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        { type: 'CLOCK_START', payload: {} },
        { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '待确认禁止改时钟' } },
      ];
      for (const command of blockedCommands) {
        const invalid = await sendCommand(
          h,
          live.matchId,
          h.otherOwner,
          envelope(pending.snapshot.version, command, live.lease),
        );
        error(invalid, 409);
        expect(invalid.body.error.code).toBe('INVALID_MATCH_STATE');
      }
      const corrected = await act(
        h,
        live.matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: { kind: 'SCORE', side: 'HOME', value: 2, period: 1, reason: '核对补录得分' },
        },
        live.lease,
      );
      const stale = await sendCommand(
        h,
        live.matchId,
        h.owner,
        envelope(pending.snapshot.version, { type: 'CONFIRM_RESULT', payload: {} }),
      );
      error(stale, 409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      data(await release(h, live.matchId, h.otherOwner, live.lease));
      await assign(h, live.matchId, h.owner);
      const ownerControl = await acquire(h, live.matchId, h.owner);
      const held = await workbench(h, live.matchId);
      expect(held.capabilities.canConfirm).toBe(false);
      error(
        await sendCommand(
          h,
          live.matchId,
          h.owner,
          envelope(held.match.version, { type: 'CONFIRM_RESULT', payload: {} }),
        ),
        403,
      );
      data(await release(h, live.matchId, h.owner, ownerControl));
      const beforeConfirmation = await workbench(h, live.matchId);
      expect(beforeConfirmation.capabilities.canConfirm).toBe(true);
      const confirmed = await act(h, live.matchId, h.owner, {
        type: 'CONFIRM_RESULT',
        payload: {},
      });
      const firstResult = confirmed.snapshot.latestConfirmation!;
      expect(firstResult).toMatchObject({
        confirmingUserId: h.owner.id,
        sourceMatchVersion: beforeConfirmation.match.version,
        lastEventSeq: corrected.snapshot.lastEventSeq,
        home: { score: 2 },
        away: { score: 0 },
      });
      expect(confirmed.snapshot).toMatchObject({ status: 'FINAL', requiresReconfirmation: false });
      const reopened = await act(h, live.matchId, h.owner, {
        type: 'REOPEN_RESULT',
        payload: { reason: '独立核对后重新确认' },
      });
      expect(reopened.snapshot).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        latestConfirmation: firstResult,
        requiresReconfirmation: true,
        clock: { running: false, remainingMs: 0 },
      });
      const again = await act(h, live.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      expect(again.snapshot).toMatchObject({ status: 'FINAL', requiresReconfirmation: false });
      expect(again.snapshot.latestConfirmation!.id).not.toBe(firstResult.id);
      expect(again.snapshot.latestConfirmation!.sourceMatchVersion).toBe(reopened.snapshot.version);
      const history = await allPages<ResultConfirmationData>(
        h.api,
        `${confirmationsPath(h.owner.orgId, live.matchId)}?limit=1`,
        h.owner,
      );
      expect(history.items).toHaveLength(2);
      expect(history.items[0]).toEqual(firstResult);
      expect(history.items[1]).toEqual(again.snapshot.latestConfirmation);
      expect(await planFacts(h, fixture.event.event.id)).toEqual(originalPlan);
      const planned = data<import('@small-city-basketball/contracts').ScheduledMatchData[]>(
        await call(h.api, 'get', matchesPath(h.owner.orgId, fixture.event.event.id), {
          cookie: h.owner.cookie,
        }),
      );
      expect(planned.find((item) => item.id === live.matchId)!.status).toBe('FINAL');
      expect((await workbench(h, live.matchId)).event.status).toBe('RUNNING');
    });

    test('database history, projection versions and tenant foreign keys reject destructive or inconsistent writes', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      await finish(h, live.matchId, h.otherOwner, live.lease);
      await act(h, live.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const original = (await workbench(h, live.matchId)).snapshot!;
      const mutations = [
        [
          'UPDATE scoring_rulesets SET regulation_periods=regulation_periods WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, fixture.event.event.id],
        ],
        [
          'DELETE FROM scoring_rulesets WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, fixture.event.event.id],
        ],
        [
          "UPDATE scoring_commands SET request_hash=repeat('0',64) WHERE org_id=$1 AND match_id=$2",
          [h.owner.orgId, live.matchId],
        ],
        [
          'DELETE FROM scoring_commands WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          "UPDATE scoring_events SET payload='{}'::jsonb WHERE org_id=$1 AND match_id=$2",
          [h.owner.orgId, live.matchId],
        ],
        [
          'DELETE FROM scoring_events WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'UPDATE result_confirmations SET home_score=home_score+1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'DELETE FROM result_confirmations WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'UPDATE events SET locked_scoring_ruleset_id=NULL WHERE org_id=$1 AND id=$2',
          [h.owner.orgId, fixture.event.event.id],
        ],
        [
          'UPDATE scoring_states SET source_version=source_version+1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'UPDATE published_matches SET version=version+1 WHERE org_id=$1 AND id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'DELETE FROM scoring_states WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'UPDATE scoring_leases SET fencing_token=fencing_token-1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'DELETE FROM scoring_leases WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, live.matchId],
        ],
        [
          'INSERT INTO scoring_events(id,org_id,event_id,match_id,seq,type,payload,actor_id,command_id,captured_at,server_time,target_event_id) SELECT $3::uuid,org_id,event_id,match_id,seq+100,type,payload,actor_id,command_id,captured_at,server_time,target_event_id FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND seq=1',
          [h.owner.orgId, live.matchId, randomUUID()],
        ],
      ] satisfies [string, string[]][];
      for (const [sql, values] of mutations)
        await expect(h.api.pool.query(sql, values), sql).rejects.toMatchObject({ code: '23514' });
      await expect(
        h.api.pool.query(
          "INSERT INTO match_staff(org_id,event_id,match_id,user_id,role) VALUES($1,$2,$3,$4,'RESULT_REVIEWER')",
          [h.otherOwner.orgId, fixture.event.event.id, live.matchId, h.otherOwner.id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      const current = (await workbench(h, live.matchId)).snapshot!;
      expect(current).toMatchObject({
        version: original.version,
        status: 'FINAL',
        totals: original.totals,
        latestConfirmation: original.latestConfirmation,
        lastEventSeq: original.lastEventSeq,
      });
    });
  },
);

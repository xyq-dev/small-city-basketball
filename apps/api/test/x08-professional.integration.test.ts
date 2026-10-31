import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ScoringCommandResponse } from '@small-city-basketball/contracts';
import { call, data } from './support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  createScoringHarness,
  envelope,
  finish,
  published,
  sendCommand,
  start,
  workbench,
  snapshotPath,
} from './p05-support.js';
import type { Harness } from './p05-support.js';

describe(
  'X08 explicit professional acquisition and lineup on PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(4);
    });
    afterAll(async () => {
      if (h) await closeHarness(h);
    });
    async function fixture() {
      const f = await published(h, undefined, { periodDurationSeconds: 60 });
      const matchId = f.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      const ready = await workbench(h, matchId);
      await act(h, matchId, h.owner, {
        type: 'PREPARE_MATCH',
        payload: {
          expectedEventVersion: ready.event.version,
          collectionMode: 'PLAYER_BASIC',
          technicalCollection: true,
        },
      });
      const lease = await acquire(h, matchId, h.otherOwner);
      const roster = (await workbench(h, matchId, h.otherOwner)).playerRoster;
      await act(
        h,
        matchId,
        h.otherOwner,
        { type: 'SET_LINEUP', payload: { side: 'HOME', memberIds: [roster.home[0]!.memberId] } },
        lease,
      );
      await act(
        h,
        matchId,
        h.otherOwner,
        { type: 'SET_LINEUP', payload: { side: 'AWAY', memberIds: [roster.away[0]!.memberId] } },
        lease,
      );
      await start(h, matchId, h.otherOwner, lease);
      return { matchId, lease, roster };
    }
    test('one made-shot command atomically updates score and shooting counters, with exact idempotent replay', async () => {
      const f = await fixture();
      const before = await workbench(h, f.matchId, h.otherOwner);
      const body = envelope(
        before.match.version,
        {
          type: 'RECORD_SHOT',
          payload: { side: 'HOME', memberId: f.roster.home[0]!.memberId, shotValue: 3, made: true },
        },
        f.lease,
      );
      const responses = await Promise.all([
        sendCommand(h, f.matchId, h.otherOwner, body),
        sendCommand(h, f.matchId, h.otherOwner, body),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const values = responses.map((r) => data<ScoringCommandResponse>(r));
      expect(values[0]!.receipt).toEqual(values[1]!.receipt);
      expect(values[0]!.snapshot.totals.home.score).toBe(3);
      expect(values[0]!.snapshot.professionalStatistics!.home.players[0]).toMatchObject({
        fieldGoalsMade: 1,
        fieldGoalsAttempted: 1,
        threePointersMade: 1,
      });
      await act(
        h,
        f.matchId,
        h.otherOwner,
        {
          type: 'RECORD_TECHNICAL',
          payload: { side: 'HOME', memberId: f.roster.home[0]!.memberId, kind: 'ASSIST' },
        },
        f.lease,
      );
      const after = await workbench(h, f.matchId, h.otherOwner);
      expect(after.snapshot!.totals.home.score).toBe(3);
      expect(after.snapshot!.professionalStatistics!.home.players[0]!.assists).toBe(1);
      const events = await h.api.pool.query(
        'SELECT * FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND command_id=$3',
        [h.owner.orgId, f.matchId, body.commandId],
      );
      expect(events.rowCount).toBe(1);
    });
    test('bench, wrong side, basic score and unauthorized writes fail without advancing the match', async () => {
      const f = await fixture();
      const current = await workbench(h, f.matchId, h.otherOwner);
      for (const payload of [
        {
          type: 'RECORD_SHOT' as const,
          payload: {
            side: 'HOME' as const,
            memberId: f.roster.home[1]!.memberId,
            shotValue: 2 as const,
            made: true,
          },
        },
        {
          type: 'RECORD_TECHNICAL' as const,
          payload: {
            side: 'HOME' as const,
            memberId: f.roster.away[0]!.memberId,
            kind: 'REBOUND' as const,
          },
        },
        {
          type: 'RECORD_STAT' as const,
          payload: {
            side: 'HOME' as const,
            memberId: f.roster.home[0]!.memberId,
            kind: 'SCORE' as const,
            value: 2,
          },
        },
      ])
        expect(
          (
            await sendCommand(
              h,
              f.matchId,
              h.otherOwner,
              envelope(current.match.version, payload, f.lease),
            )
          ).status,
        ).toBe(422);
      expect(
        (
          await sendCommand(
            h,
            f.matchId,
            h.owner,
            envelope(
              current.match.version,
              {
                type: 'RECORD_SHOT',
                payload: {
                  side: 'HOME',
                  memberId: f.roster.home[0]!.memberId,
                  shotValue: 2,
                  made: true,
                },
              },
              f.lease,
            ),
          )
        ).status,
      ).toBe(403);
      expect((await workbench(h, f.matchId, h.otherOwner)).match.version).toBe(
        current.match.version,
      );
    });
    test('actual clock running creates time while clock correction does not, and substitutions require pause', async () => {
      const f = await fixture();
      await act(h, f.matchId, h.otherOwner, { type: 'CLOCK_START', payload: {} }, f.lease);
      const current = await workbench(h, f.matchId, h.otherOwner);
      const sub = {
        type: 'SUBSTITUTE_PLAYER' as const,
        payload: {
          side: 'HOME' as const,
          outMemberId: f.roster.home[0]!.memberId,
          inMemberId: f.roster.home[1]!.memberId,
        },
      };
      expect(
        (
          await sendCommand(
            h,
            f.matchId,
            h.otherOwner,
            envelope(current.match.version, sub, f.lease),
          )
        ).status,
      ).toBe(409);
      await h.api.pool.query('SELECT pg_sleep(0.03)');
      const paused = await act(
        h,
        f.matchId,
        h.otherOwner,
        { type: 'CLOCK_PAUSE', payload: {} },
        f.lease,
      );
      const time = paused.snapshot.professionalStatistics!.home.players[0]!.playingMs;
      expect(time).toBeGreaterThan(0);
      const corrected = await act(
        h,
        f.matchId,
        h.otherOwner,
        {
          type: 'CLOCK_SET',
          payload: { remainingMs: 60000, reason: '合成测试校时，不增加上场时间' },
        },
        f.lease,
      );
      expect(corrected.snapshot.professionalStatistics!.home.players[0]!.playingMs).toBe(time);
      const changed = await act(h, f.matchId, h.otherOwner, sub, f.lease);
      expect(changed.snapshot.professionalStatistics!.home.players[0]!.onCourt).toBe(false);
      expect(changed.snapshot.professionalStatistics!.home.players[1]).toMatchObject({
        onCourt: true,
        appeared: true,
        starter: false,
        playingMs: 0,
      });
    });
    test('void/reconfirmation preserves one authoritative score and professional confirmation snapshot', async () => {
      const f = await fixture();
      const shot = await act(
        h,
        f.matchId,
        h.otherOwner,
        {
          type: 'RECORD_SHOT',
          payload: { side: 'HOME', memberId: f.roster.home[0]!.memberId, shotValue: 2, made: true },
        },
        f.lease,
      );
      const row = (
        await h.api.pool.query(
          'SELECT id FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND command_id=$3',
          [h.owner.orgId, f.matchId, shot.receipt.commandId],
        )
      ).rows[0]!;
      const undone = await act(
        h,
        f.matchId,
        h.otherOwner,
        { type: 'VOID_STAT', payload: { targetEventId: row.id, reason: '合成错误投篮撤销' } },
        f.lease,
      );
      expect(undone.snapshot.totals.home.score).toBe(0);
      expect(undone.snapshot.professionalStatistics!.home.players[0]!.fieldGoalsAttempted).toBe(0);
      await act(
        h,
        f.matchId,
        h.otherOwner,
        {
          type: 'RECORD_SHOT',
          payload: { side: 'HOME', memberId: f.roster.home[0]!.memberId, shotValue: 1, made: true },
        },
        f.lease,
      );
      await finish(h, f.matchId, h.otherOwner, f.lease);
      const confirmed = await act(h, f.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      expect(confirmed.snapshot.latestConfirmation!.professionalStatistics).toEqual(
        confirmed.snapshot.professionalStatistics,
      );
      expect(confirmed.snapshot.latestConfirmation!.home.score).toBe(1);
      const stored = (
        await h.api.pool.query(
          'SELECT technical_collection,professional_stats FROM result_confirmations WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, f.matchId],
        )
      ).rows[0]!;
      expect(stored.technical_collection).toBe(true);
      expect(stored.professional_stats).toEqual(confirmed.snapshot.professionalStatistics);
      expect(
        (
          await call(h.api, 'get', snapshotPath(h.owner.orgId, f.matchId), {
            cookie: h.owner.cookie,
          })
        ).status,
      ).toBe(200);
    });
    test('historical lineup correction is append-only and recalculates authoritative time', async () => {
      const f = await fixture();
      const original = (
        await h.api.pool.query(
          "SELECT * FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND type='SET_LINEUP' AND payload->>'side'='HOME'",
          [h.owner.orgId, f.matchId],
        )
      ).rows[0];
      await act(h, f.matchId, h.otherOwner, { type: 'CLOCK_START', payload: {} }, f.lease);
      await h.api.pool.query('SELECT pg_sleep(0.03)');
      const paused = await act(
        h,
        f.matchId,
        h.otherOwner,
        { type: 'CLOCK_PAUSE', payload: {} },
        f.lease,
      );
      const played = paused.snapshot.professionalStatistics!.home.players[0]!.playingMs;
      const corrected = await act(
        h,
        f.matchId,
        h.otherOwner,
        {
          type: 'CORRECT_LINEUP',
          payload: {
            targetEventId: original.id,
            memberIds: [f.roster.home[1]!.memberId],
            reason: '合成首发名单录入错误',
          },
        },
        f.lease,
      );
      expect(corrected.snapshot.professionalStatistics!.home.players[0]!.playingMs).toBe(0);
      expect(corrected.snapshot.professionalStatistics!.home.players[1]!.playingMs).toBe(played);
      expect(
        (await h.api.pool.query('SELECT * FROM scoring_events WHERE id=$1', [original.id])).rows[0],
      ).toEqual(original);
    });
  },
);

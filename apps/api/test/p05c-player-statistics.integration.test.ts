import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  ResultConfirmationData,
  ScoringCommandResponse,
  ScoringControl,
  ScoringEventData,
} from '@small-city-basketball/contracts';
import { call, data, error } from './support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  commandsPath,
  confirmationsPath,
  createScoringHarness,
  envelope,
  finish,
  prepare,
  published,
  scoringEventsPath,
  sendCommand,
  start,
  workbench,
  workbenchPath,
} from './p05-support.js';
import type { Harness } from './p05-support.js';

describe(
  'P05-C basic individual attribution on isolated real PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 60000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    async function live() {
      const fixture = await published(h, h.teams.slice(0, 2));
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      const before = await workbench(h, matchId);
      const ready = await act(h, matchId, h.owner, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: before.event.version, collectionMode: 'PLAYER_BASIC' },
      });
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      return { matchId, lease, roster: before.playerRoster, ready };
    }
    async function record(
      matchId: string,
      lease: ScoringControl,
      memberId?: string | null,
      value = 2,
    ) {
      return act(
        h,
        matchId,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: {
            kind: 'SCORE',
            side: 'HOME',
            value,
            ...(memberId === undefined ? {} : { memberId }),
          },
        },
        lease,
      );
    }

    test('one command atomically advances team score, frozen-player score and authoritative version; replay does not double count', async () => {
      const { matchId, lease, roster, ready } = await live();
      expect(ready.snapshot.collected.playerStatistics).toBe(true);
      expect(ready.snapshot.playerStatistics!.home.players).toEqual(
        roster.home.map((p) => ({ ...p, score: 0, fouls: 0 })),
      );
      const current = await workbench(h, matchId, h.otherOwner);
      const cmd = envelope(
        current.match.version,
        {
          type: 'RECORD_STAT',
          payload: { kind: 'SCORE', side: 'HOME', value: 2, memberId: roster.home[0]!.memberId },
        },
        lease,
      );
      const first = data<ScoringCommandResponse>(await sendCommand(h, matchId, h.otherOwner, cmd));
      const replay = data<ScoringCommandResponse>(await sendCommand(h, matchId, h.otherOwner, cmd));
      expect(replay.receipt).toEqual(first.receipt);
      expect(replay.snapshot.totals.home.score).toBe(2);
      expect(replay.snapshot.playerStatistics!.home.players[0]!.score).toBe(2);
      const unassigned = await record(matchId, lease, null, 3);
      expect(unassigned.snapshot.playerStatistics!.home.unassigned.score).toBe(3);
      expect(unassigned.snapshot.totals.home.score).toBe(5);
      const row = await h.api.pool.query(
        'SELECT collection_mode,player_stats,home_score FROM scoring_states WHERE org_id=$1 AND match_id=$2',
        [h.owner.orgId, matchId],
      );
      expect(row.rows[0]).toMatchObject({
        collection_mode: 'PLAYER_BASIC',
        home_score: 5,
        player_stats: unassigned.snapshot.playerStatistics,
      });
      const count = await h.api.pool.query(
        'SELECT count(*)::int n FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND command_id=$3',
        [h.owner.orgId, matchId, cmd.commandId],
      );
      expect(count.rows[0].n).toBe(1);
    });

    test('wrong-side or unknown players fail without any event, receipt or score changes', async () => {
      const { matchId, lease, roster } = await live();
      const before = await workbench(h, matchId, h.otherOwner);
      for (const memberId of [roster.away[0]!.memberId, randomUUID()]) {
        const cmd = envelope(
          before.match.version,
          { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2, memberId } },
          lease,
        );
        const response = await sendCommand(h, matchId, h.otherOwner, cmd);
        error(response, 422);
        expect(response.body.error.code).toBe('PLAYER_NOT_IN_MATCH_ROSTER');
        const receipt = await h.api.pool.query(
          'SELECT command_id FROM scoring_commands WHERE org_id=$1 AND match_id=$2 AND command_id=$3',
          [h.owner.orgId, matchId, cmd.commandId],
        );
        expect(receipt.rowCount).toBe(0);
      }
      const after = await workbench(h, matchId, h.otherOwner);
      expect(after.match.version).toBe(before.match.version);
      expect(after.snapshot!.totals).toEqual(before.snapshot!.totals);
      expect(after.snapshot!.lastEventSeq).toBe(before.snapshot!.lastEventSeq);
    });

    test('void and replace use original append-only events for both personal and team projections', async () => {
      const { matchId, lease, roster } = await live();
      await record(matchId, lease, roster.home[0]!.memberId);
      const history = data<ScoringEventData[]>(
        await call(h.api, 'get', scoringEventsPath(h.owner.orgId, matchId), {
          cookie: h.otherOwner.cookie,
        }),
      );
      const original = history.find((e) => e.type === 'STAT_RECORDED')!;
      const replaced = await act(
        h,
        matchId,
        h.otherOwner,
        {
          type: 'REPLACE_STAT',
          payload: { targetEventId: original.id, side: 'HOME', value: 3, reason: '合成三分修正' },
        },
        lease,
      );
      expect(replaced.snapshot.totals.home.score).toBe(3);
      expect(replaced.snapshot.playerStatistics!.home.players[0]!.score).toBe(3);
      const after = data<ScoringEventData[]>(
        await call(h.api, 'get', scoringEventsPath(h.owner.orgId, matchId), {
          cookie: h.otherOwner.cookie,
        }),
      );
      const active = after.find((e) => e.type === 'STAT_RECORDED' && e.id !== original.id)!;
      const voided = await act(
        h,
        matchId,
        h.otherOwner,
        { type: 'VOID_STAT', payload: { targetEventId: active.id, reason: '合成撤销' } },
        lease,
      );
      expect(voided.snapshot.totals.home.score).toBe(0);
      expect(voided.snapshot.playerStatistics!.home.players[0]!.score).toBe(0);
      const originalRow = await h.api.pool.query('SELECT payload FROM scoring_events WHERE id=$1', [
        original.id,
      ]);
      expect(originalRow.rows[0].payload).toEqual(original.payload);
    });

    test('independent confirmations freeze personal results and reopening retains the immutable earlier result', async () => {
      const { matchId, lease, roster } = await live();
      await record(matchId, lease, roster.home[0]!.memberId);
      await finish(h, matchId, h.otherOwner, lease);
      const current = await workbench(h, matchId, h.otherOwner);
      error(
        await sendCommand(
          h,
          matchId,
          h.otherOwner,
          envelope(current.match.version, { type: 'CONFIRM_RESULT', payload: {} }),
        ),
        403,
      );
      const first = await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      expect(first.snapshot.latestConfirmation!.playerStatistics!.home.players[0]!.score).toBe(2);
      const oldId = first.snapshot.latestConfirmation!.id;
      await act(h, matchId, h.owner, {
        type: 'REOPEN_RESULT',
        payload: { reason: '合成赛后更正' },
      });
      const corrected = await act(
        h,
        matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: {
            kind: 'SCORE',
            side: 'HOME',
            value: 1,
            period: 1,
            reason: '合成补记',
            memberId: roster.home[0]!.memberId,
          },
        },
        lease,
      );
      expect(corrected.snapshot.requiresReconfirmation).toBe(true);
      const second = await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      expect(second.snapshot.latestConfirmation!.id).not.toBe(oldId);
      expect(second.snapshot.latestConfirmation!.playerStatistics!.home.players[0]!.score).toBe(3);
      const confirmations = data<ResultConfirmationData[]>(
        await call(h.api, 'get', confirmationsPath(h.owner.orgId, matchId), {
          cookie: h.owner.cookie,
        }),
      );
      expect(
        confirmations.find((c) => c.id === oldId)!.playerStatistics!.home.players[0]!.score,
      ).toBe(2);
    });

    test('legacy prepare remains team-only and an attributed command cannot silently upgrade an old match', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      const ready = await prepare(h, matchId);
      expect(ready.snapshot.playerStatistics).toBeNull();
      expect(ready.snapshot.collected.playerStatistics).toBe(false);
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      const member = (await workbench(h, matchId)).playerRoster.home[0]!.memberId;
      const before = await workbench(h, matchId, h.otherOwner);
      const invalid = await sendCommand(
        h,
        matchId,
        h.otherOwner,
        envelope(
          before.match.version,
          {
            type: 'RECORD_STAT',
            payload: { kind: 'SCORE', side: 'HOME', value: 2, memberId: member },
          },
          lease,
        ),
      );
      error(invalid, 422);
      expect(invalid.body.error.code).toBe('PLAYER_ATTRIBUTION_NOT_ALLOWED');
      expect((await record(matchId, lease)).snapshot.totals.home.score).toBe(2);
    });

    test('frozen roster and statistics remain match-scoped and mode cannot be rewritten after prepare', async () => {
      const { matchId, roster } = await live();
      error(await call(h.api, 'get', workbenchPath(h.owner.orgId, matchId)), 401);
      error(
        await call(h.api, 'get', workbenchPath(h.otherOwner.orgId, matchId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      const response = await call(h.api, 'post', commandsPath(h.otherOwner.orgId, matchId), {
        cookie: h.otherOwner.cookie,
        body: envelope(1, {
          type: 'PREPARE_MATCH',
          payload: { expectedEventVersion: 1, collectionMode: 'PLAYER_BASIC' },
        }),
      });
      error(response, 404);
      const modeUpdate = await h.api.pool.connect();
      try {
        await modeUpdate.query('BEGIN');
        await expect(
          modeUpdate.query(
            "UPDATE scoring_states SET collection_mode='TEAM_ONLY',player_stats=NULL WHERE org_id=$1 AND match_id=$2",
            [h.owner.orgId, matchId],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await modeUpdate.query('ROLLBACK');
        modeUpdate.release();
      }
      expect((await workbench(h, matchId)).playerRoster).toEqual(roster);
    });
    test('a mismatched stored player projection fails closed without accepting a new command', async () => {
      const { matchId, lease, roster } = await live();
      const accepted = await record(matchId, lease, roster.home[0]!.memberId);
      const original = accepted.snapshot.playerStatistics!;
      const damaged = structuredClone(original);
      damaged.home.players[0]!.score++;
      try {
        await h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, matchId, JSON.stringify(damaged)],
        );
        const read = await call(h.api, 'get', workbenchPath(h.owner.orgId, matchId), {
          cookie: h.owner.cookie,
        });
        error(read, 409);
        expect(read.body.error.code).toBe('PROJECTION_MISMATCH');
        const cmd = envelope(
          accepted.snapshot.version,
          {
            type: 'RECORD_STAT',
            payload: { kind: 'SCORE', side: 'HOME', value: 1, memberId: roster.home[0]!.memberId },
          },
          lease,
        );
        const write = await sendCommand(h, matchId, h.otherOwner, cmd);
        error(write, 409);
        expect(write.body.error.code).toBe('PROJECTION_MISMATCH');
        const receipt = await h.api.pool.query(
          'SELECT command_id FROM scoring_commands WHERE org_id=$1 AND match_id=$2 AND command_id=$3',
          [h.owner.orgId, matchId, cmd.commandId],
        );
        expect(receipt.rowCount).toBe(0);
      } finally {
        await h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, matchId, JSON.stringify(original)],
        );
      }
    });
  },
);

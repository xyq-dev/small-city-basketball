import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventPlayerStatisticsData,
  MatchPlayerRoster,
} from '@small-city-basketball/contracts';
import { call, data, error, staffPath } from './support.js';
import type { User } from './support.js';
import { blockedPid, frozen } from './p04-support.js';
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
} from './p05-support.js';
import type { Harness, PublishedFixture } from './p05-support.js';
import { confirmMatch, withRowsLocked } from './p05b-support.js';

const path = (org: string, event: string) => `/v1/orgs/${org}/events/${event}/player-statistics`;

describe(
  'C03 private player leaderboard on isolated real PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(3);
    }, 60000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    const read = async (event: string, actor: User = h.owner) =>
      data<EventPlayerStatisticsData>(
        await call(h.api, 'get', path(h.owner.orgId, event), { cookie: actor.cookie }),
      );

    async function personal(fixture: PublishedFixture, index = 0, unassigned = true) {
      const matchId = fixture.matches[index]!.id;
      await assign(h, matchId, h.otherOwner);
      const before = await workbench(h, matchId);
      const roster: MatchPlayerRoster = before.playerRoster;
      await act(h, matchId, h.owner, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: before.event.version, collectionMode: 'PLAYER_BASIC' },
      });
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      await act(
        h,
        matchId,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: { kind: 'SCORE', side: 'HOME', value: 2, memberId: roster.home[0]!.memberId },
        },
        lease,
      );
      await act(
        h,
        matchId,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: { kind: 'FOUL', side: 'AWAY', value: 1, memberId: roster.away[0]!.memberId },
        },
        lease,
      );
      if (unassigned)
        await act(
          h,
          matchId,
          h.otherOwner,
          { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'AWAY', value: 1 } },
          lease,
        );
      await finish(h, matchId, h.otherOwner, lease);
      await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      return { matchId, roster, lease };
    }

    test('an authorized unpublished event has no summary; anonymous and cross-organization reads are rejected', async () => {
      const registration = await frozen(h, h.owner, h.teams.slice(0, 2));
      expect((await read(registration.event.id)).summary).toBeNull();
      error(await call(h.api, 'get', path(h.owner.orgId, registration.event.id)), 401);
      error(
        await call(h.api, 'get', path(h.otherOwner.orgId, registration.event.id), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      error(
        await call(h.api, 'get', path(h.owner.orgId, registration.event.id), {
          cookie: h.leader.cookie,
        }),
        404,
      );
    });

    test('pending and TEAM_ONLY publications preserve all teams while distinguishing absent collection from complete attribution', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const pending = (await read(eventId)).summary!;
      expect(pending).toMatchObject({
        totalMatchCount: 1,
        includedMatchCount: 0,
        pendingMatchCount: 1,
        teamOnlyConfirmedMatchCount: 0,
        coverageComplete: false,
        attributionComplete: false,
        rows: [],
      });
      expect(pending.teams).toHaveLength(2);
      await confirmMatch(h, fixture, 0, 3, 1);
      const teamOnly = (await read(eventId)).summary!;
      expect(teamOnly).toMatchObject({
        totalMatchCount: 1,
        includedMatchCount: 0,
        pendingMatchCount: 0,
        teamOnlyConfirmedMatchCount: 1,
        coverageComplete: false,
        attributionComplete: false,
        rows: [],
      });
      expect(teamOnly.teams).toEqual(pending.teams);
      expect(teamOnly.sourceHash).not.toBe(pending.sourceHash);
    });

    test('mixed collection only aggregates current confirmed personal snapshots, including zero-score roster samples', async () => {
      const fixture = await published(h, h.teams);
      const eventId = fixture.event.event.id;
      const first = await personal(fixture);
      await confirmMatch(h, fixture, 1, 3, 1);
      const summary = (await read(eventId)).summary!;
      expect(summary).toMatchObject({
        totalMatchCount: 3,
        includedMatchCount: 1,
        teamOnlyConfirmedMatchCount: 1,
        pendingMatchCount: 1,
        coverageComplete: false,
        attributionComplete: false,
      });
      expect(summary.rows).toHaveLength(first.roster.home.length + first.roster.away.length);
      expect(summary.rows.every((r) => r.rosterSampleMatchCount === 1)).toBe(true);
      const home = summary.rows.find((p) => p.memberId === first.roster.home[0]!.memberId)!;
      expect(home).toMatchObject({ score: 2, fouls: 0, rank: 1, tied: false });
      expect(summary.rows.filter((r) => r.score === 0).every((r) => r.rank === 2 && r.tied)).toBe(
        true,
      );
      expect(summary.teams.reduce((sum, t) => sum + t.attributedScore, 0)).toBe(2);
      expect(summary.teams.reduce((sum, t) => sum + t.unassignedScore, 0)).toBe(1);
      expect(summary.teams.reduce((sum, t) => sum + t.attributedFouls, 0)).toBe(1);
      expect(summary.teams).toHaveLength(3);
      const again = (await read(eventId)).summary!;
      expect(again.sourceHash).toBe(summary.sourceHash);
      expect(again.rows).toEqual(summary.rows);
      const text = JSON.stringify(summary);
      for (const privateValue of [h.owner.email, h.owner.cookie, h.otherOwner.email])
        expect(text).not.toContain(privateValue);
      for (const r of summary.rows)
        expect(Object.keys(r).sort()).toEqual(
          [
            'entryId',
            'rosterRevisionId',
            'memberId',
            'teamName',
            'name',
            'jerseyNo',
            'score',
            'fouls',
            'rosterSampleMatchCount',
            'rank',
            'tied',
          ].sort(),
        );
    });

    test('a match-only staff grant does not reveal event-wide rosters; an actual event grant and its revocation apply immediately', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      await personal(fixture);
      error(
        await call(h.api, 'get', path(h.owner.orgId, eventId), { cookie: h.otherOwner.cookie }),
        404,
      );
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'SCORER', status: 'ACTIVE' },
        }),
      );
      const granted = await read(eventId, h.otherOwner);
      expect(granted.summary!.includedMatchCount).toBe(1);
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'SCORER', status: 'DISABLED' },
        }),
      );
      error(
        await call(h.api, 'get', path(h.owner.orgId, eventId), { cookie: h.otherOwner.cookie }),
        404,
      );
      expect((await read(eventId)).summary!.rows).toEqual(granted.summary!.rows);
    });

    test('reopening drops a complete sample, and correction plus independent reconfirmation uses only the new result', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const match = await personal(fixture, 0, false);
      const before = (await read(eventId)).summary!;
      expect(before).toMatchObject({ coverageComplete: true, attributionComplete: true });
      await act(h, match.matchId, h.owner, {
        type: 'REOPEN_RESULT',
        payload: { reason: '合成整届球员榜更正核验' },
      });
      expect((await read(eventId)).summary).toMatchObject({
        includedMatchCount: 0,
        pendingMatchCount: 1,
        rows: [],
        attributionComplete: false,
      });
      await act(
        h,
        match.matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: {
            kind: 'SCORE',
            side: 'HOME',
            value: 1,
            period: 1,
            reason: '合成补记一分',
            memberId: match.roster.home[0]!.memberId,
          },
        },
        match.lease,
      );
      expect((await read(eventId)).summary!.rows).toEqual([]);
      await act(h, match.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const after = (await read(eventId)).summary!;
      expect(after.includedMatchCount).toBe(1);
      expect(after.rows.find((r) => r.memberId === match.roster.home[0]!.memberId)!.score).toBe(3);
      expect(after.rows.every((r) => r.rosterSampleMatchCount === 1)).toBe(true);
      expect(after.sourceHash).not.toBe(before.sourceHash);
    });

    test('mismatched current stored personal results fail closed with a generic source error', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const match = await personal(fixture);
      const original = (
        await h.api.pool.query(
          'SELECT player_stats FROM scoring_states WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId],
        )
      ).rows[0]!.player_stats;
      const before = (await read(eventId)).summary!;
      const damaged = structuredClone(original);
      damaged.home.players[0].name = '冒充冻结名单姓名';
      try {
        await h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId, JSON.stringify(damaged)],
        );
        const response = await call(h.api, 'get', path(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
        });
        error(response, 409);
        expect(response.body.error.code).toBe('RESULT_SOURCE_INVALID');
        expect(response.body.error).not.toHaveProperty('details');
        for (const value of [match.matchId, eventId, h.owner.orgId, damaged.home.players[0].name])
          expect(JSON.stringify(response.body)).not.toContain(value);
      } finally {
        await h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId, JSON.stringify(original)],
        );
      }
      expect((await read(eventId)).summary!.sourceHash).toBe(before.sourceHash);
    });

    test('a concurrent reopening yields complete old or new statement snapshots without hybrid confirmation or roster data', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const match = await personal(fixture);
      const before = (await read(eventId)).summary!;
      const current = await workbench(h, match.matchId);
      await withRowsLocked(
        h,
        'SELECT id FROM published_matches WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, match.matchId],
        1,
        async (pid, unlock, track) => {
          const reopening = track(
            sendCommand(
              h,
              match.matchId,
              h.owner,
              envelope(current.match.version, {
                type: 'REOPEN_RESULT',
                payload: { reason: '核对私有统计statement原子性' },
              }),
            ),
          );
          await blockedPid(h.api.pool, pid, 'Reopen did not wait for the held published match');
          const during = await Promise.all(Array.from({ length: 3 }, () => read(eventId)));
          for (const item of during) {
            expect(item.summary!.sourceHash).toBe(before.sourceHash);
            expect(item.summary!.rows).toEqual(before.rows);
          }
          await unlock();
          data(await reopening);
        },
      );
      const after = (await read(eventId)).summary!;
      expect(after).toMatchObject({ pendingMatchCount: 1, includedMatchCount: 0, rows: [] });
      expect(after.sourceHash).not.toBe(before.sourceHash);
    });
  },
);

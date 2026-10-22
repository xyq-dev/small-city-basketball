import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventData,
  EventStandingsData,
  PublicStandingsData,
  ResultConfirmationData,
  StandingsData,
} from '@small-city-basketball/contracts';
import {
  call,
  data,
  error,
  eventually,
  eventInput,
  eventsPath,
  membership,
  staffPath as eventStaffPath,
} from './support.js';
import { APPLICATION_NAME, blockedPid } from './p04-support.js';
import { allPages } from './p03-support.js';
import { confirmationsPath } from './p05-support.js';
import {
  act,
  anonymous,
  assign,
  closeHarness,
  confirmMatch,
  createScoringHarness,
  defaultStandingsRules,
  disable,
  enable,
  envelope,
  privateStandings,
  publicStandingsPath,
  published,
  publishRules,
  reopen,
  savePublishRules,
  saveRules,
  sendCommand,
  standingsCommandsPath,
  standingsPath,
  standingsRulesPath,
  withRowsLocked,
  workbench,
} from './p05b-support.js';
import type { Harness } from './p05b-support.js';

function rejected(response: Response, status: number, code: string): void {
  error(response, status);
  expect(response.body.error.code).toBe(code);
}

function totalsConserved(standings: StandingsData): void {
  const sum = (key: 'played' | 'wins' | 'draws' | 'losses' | 'pointsFor' | 'pointsAgainst') =>
    standings.rows.reduce((total, row) => total + row[key], 0);
  expect(sum('played')).toBe(standings.confirmedMatchCount * 2);
  expect(sum('wins')).toBe(sum('losses'));
  expect(sum('draws') % 2).toBe(0);
  expect(sum('pointsFor')).toBe(sum('pointsAgainst'));
  for (const row of standings.rows) {
    expect(row.played).toBe(row.wins + row.draws + row.losses);
    expect(row.scoreDifference).toBe(row.pointsFor - row.pointsAgainst);
  }
}

describe(
  'P05-B explicit standings and authoritative result sources on PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('rules require every explicit value, preserve immutable drafts and permanently lock only the current published ruleset', async () => {
      for (const format of ['GROUP_KNOCKOUT', 'SINGLE_ELIMINATION']) {
        const unsupported = data<EventData>(
          await call(h.api, 'post', eventsPath(h.owner.orgId), {
            cookie: h.owner.cookie,
            body: eventInput(`不支持的排名赛制 ${randomUUID().slice(0, 8)}`, { format }),
          }),
          201,
        );
        rejected(
          await call(h.api, 'get', standingsPath(h.owner.orgId, unsupported.id), {
            cookie: h.owner.cookie,
          }),
          422,
          'UNSUPPORTED_STANDINGS_FORMAT',
        );
        rejected(
          await call(h.api, 'put', standingsRulesPath(h.owner.orgId, unsupported.id), {
            cookie: h.owner.cookie,
            body: { expectedEventVersion: unsupported.version, ...defaultStandingsRules() },
          }),
          422,
          'UNSUPPORTED_STANDINGS_FORMAT',
        );
      }
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const initial = await privateStandings(h, eventId);
      expect(initial).toMatchObject({
        rules: null,
        locked: false,
        standings: null,
        publication: null,
      });
      rejected(
        await call(h.api, 'post', standingsCommandsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: {
            type: 'PUBLISH_STANDINGS_RULES',
            rulesetId: randomUUID(),
            expectedEventVersion: initial.event.version,
          },
        }),
        422,
        'STANDINGS_RULES_REQUIRED',
      );
      const base = defaultStandingsRules();
      const invalid: Record<string, unknown>[] = [
        { lossPoints: 0, drawPoints: 1, tiebreakers: [] },
        { winPoints: 3, drawPoints: 1, tiebreakers: [] },
        { winPoints: 3, lossPoints: 0, tiebreakers: [] },
        { ...base, winPoints: -1 },
        { ...base, lossPoints: 1001 },
        { ...base, drawPoints: 1.5 },
        { ...base, winPoints: '3' },
        { ...base, tiebreakers: null },
        { ...base, tiebreakers: ['HEAD_TO_HEAD'] },
        { ...base, tiebreakers: ['POINTS_FOR', 'POINTS_FOR'] },
        { ...base, tiebreakers: ['WINS', 'SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'] },
        { ...base, orgId: h.otherOwner.orgId },
        { ...base, status: 'PUBLISHED' },
      ];
      for (const rule of invalid) {
        rejected(
          await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
            cookie: h.owner.cookie,
            body: { expectedEventVersion: initial.event.version, ...rule },
          }),
          422,
          'VALIDATION_ERROR',
        );
      }
      expect((await privateStandings(h, eventId)).event.version).toBe(initial.event.version);
      const first = await saveRules(h, eventId, {
        winPoints: 0,
        lossPoints: 1000,
        drawPoints: 1000,
      });
      expect(first.rules).toMatchObject({
        version: 1,
        winPoints: 0,
        lossPoints: 1000,
        drawPoints: 1000,
        tiebreakers: [],
      });
      expect(first.standings).toMatchObject({
        mode: 'DRAFT_PREVIEW',
        confirmedMatchCount: 0,
        isComplete: false,
      });
      expect(first.standings!.rows.every((row) => row.rank === null && !row.tied)).toBe(true);
      rejected(
        await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: { expectedEventVersion: initial.event.version, ...base },
        }),
        409,
        'VERSION_CONFLICT',
      );
      const second = await saveRules(h, eventId, {
        winPoints: 1000,
        lossPoints: 0,
        drawPoints: 0,
        tiebreakers: ['WINS', 'SCORE_DIFFERENCE', 'POINTS_FOR'],
      });
      expect(second.rules!.version).toBe(2);
      expect(second.rules!.id).not.toBe(first.rules!.id);
      rejected(
        await call(h.api, 'post', standingsCommandsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: {
            type: 'PUBLISH_STANDINGS_RULES',
            rulesetId: randomUUID(),
            expectedEventVersion: second.event.version,
          },
        }),
        404,
        'RESOURCE_NOT_FOUND',
      );
      rejected(
        await call(h.api, 'post', standingsCommandsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: {
            type: 'PUBLISH_STANDINGS_RULES',
            rulesetId: first.rules!.id,
            expectedEventVersion: second.event.version,
          },
        }),
        409,
        'STANDINGS_RULESET_NOT_CURRENT',
      );
      const locked = await publishRules(h, eventId);
      expect(locked).toMatchObject({
        locked: true,
        rules: { id: second.rules!.id },
        standings: { mode: 'PUBLISHED', rulesetVersion: 2 },
      });
      for (const response of [
        await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: { expectedEventVersion: locked.event.version, ...base },
        }),
        await call(h.api, 'post', standingsCommandsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: {
            type: 'PUBLISH_STANDINGS_RULES',
            rulesetId: second.rules!.id,
            expectedEventVersion: locked.event.version,
          },
        }),
      ])
        rejected(response, 409, 'STANDINGS_RULES_LOCKED');
      const stored = await h.api.pool.query<{ version: number; win_points: number }>(
        'SELECT version,win_points FROM standings_rulesets WHERE org_id=$1 AND event_id=$2 ORDER BY version',
        [h.owner.orgId, eventId],
      );
      expect(stored.rows).toEqual([
        { version: 1, win_points: 0 },
        { version: 2, win_points: 1000 },
      ]);
      for (const sql of [
        'UPDATE standings_rulesets SET win_points=999 WHERE org_id=$1 AND event_id=$2',
        'DELETE FROM standings_rulesets WHERE org_id=$1 AND event_id=$2',
        'UPDATE events SET locked_standings_ruleset_id=NULL WHERE org_id=$1 AND id=$2',
      ])
        await expect(h.api.pool.query(sql, [h.owner.orgId, eventId])).rejects.toMatchObject({
          code: '23514',
        });
      expect((await privateStandings(h, eventId)).event.version).toBe(locked.event.version);
    });

    test('concurrent rule drafts and publication serialize on Event with exactly one CAS winner and one audit', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      let current = await privateStandings(h, eventId);
      const compete = async (method: 'put' | 'post', path: string, body: object) => {
        let responses: Response[] = [];
        await withRowsLocked(
          h,
          'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [h.owner.orgId, eventId],
          1,
          async (pid, unlock, track) => {
            const first = track(call(h.api, method, path, { cookie: h.owner.cookie, body }));
            const firstWriterPid = await blockedPid(
              h.api.pool,
              pid,
              'The first standings writer did not wait for Event',
            );
            const second = track(call(h.api, method, path, { cookie: h.owner.cookie, body }));
            await eventually(
              async () =>
                (
                  await h.api.pool.query<{ pid: number }>(
                    'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>$3::int AND ($2::int=ANY(pg_blocking_pids(pid)) OR $3::int=ANY(pg_blocking_pids(pid)))',
                    [APPLICATION_NAME, pid, firstWriterPid],
                  )
                ).rows,
              (rows) => rows.length === 1,
              'The second standings writer did not queue behind the held Event or first writer',
            );
            await unlock();
            responses = await Promise.all([first, second]);
          },
        );
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        rejected(
          responses.find((response) => response.status === 409)!,
          409,
          'VERSION_CONFLICT',
        );
      };
      await compete('put', standingsRulesPath(h.owner.orgId, eventId), {
        expectedEventVersion: current.event.version,
        ...defaultStandingsRules(),
      });
      const draft = await privateStandings(h, eventId);
      expect(draft.event.version).toBe(current.event.version + 1);
      expect(
        (
          await h.api.pool.query(
            'SELECT id FROM standings_rulesets WHERE org_id=$1 AND event_id=$2',
            [h.owner.orgId, eventId],
          )
        ).rowCount,
      ).toBe(1);
      current = draft;
      await compete('post', standingsCommandsPath(h.owner.orgId, eventId), {
        type: 'PUBLISH_STANDINGS_RULES',
        rulesetId: current.rules!.id,
        expectedEventVersion: current.event.version,
      });
      const locked = await privateStandings(h, eventId);
      expect(locked.event.version).toBe(current.event.version + 1);
      expect(locked.locked).toBe(true);
      const audits = await h.api.pool.query<{ action: string; count: number }>(
        "SELECT action,count(*)::int AS count FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action LIKE 'standings.%' GROUP BY action ORDER BY action",
        [h.owner.orgId, eventId],
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows.map((row) => row.count)).toEqual([1, 1]);
    });

    test('zero confirmed matches have no ranks and a partial draw gives shared competition ranks 1,1,3 without compensating an unplayed team', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id;
      const locked = await savePublishRules(h, eventId);
      expect(locked.standings).toMatchObject({
        confirmedMatchCount: 0,
        totalMatchCount: 3,
        isComplete: false,
        hasSharedRanks: false,
      });
      expect(locked.standings!.rows).toHaveLength(3);
      for (const row of locked.standings!.rows)
        expect(row).toMatchObject({ rank: null, tied: false, played: 0, leaguePoints: 0 });
      const draw = await confirmMatch(h, fixture, 0, 1, 1);
      const standings = (await privateStandings(h, eventId)).standings!;
      expect(standings).toMatchObject({
        confirmedMatchCount: 1,
        totalMatchCount: 3,
        isComplete: false,
        hasSharedRanks: true,
      });
      expect(standings.rows.map((row) => row.rank)).toEqual([1, 1, 3]);
      const participants = [fixture.matches[0]!.home.teamId, fixture.matches[0]!.away.teamId];
      for (const row of standings.rows) {
        if (participants.includes(row.teamId))
          expect(row).toMatchObject({
            rank: 1,
            tied: true,
            played: 1,
            wins: 0,
            draws: 1,
            losses: 0,
            pointsFor: 1,
            pointsAgainst: 1,
            leaguePoints: 1,
          });
        else
          expect(row).toMatchObject({
            rank: 3,
            tied: false,
            played: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            leaguePoints: 0,
          });
      }
      expect(draw.confirmed.snapshot.status).toBe('FINAL');
      totalsConserved(standings);
      expect((await privateStandings(h, eventId)).standings!.sourceHash).toBe(standings.sourceHash);
    });

    test('a three-team win cycle shares first place in frozen order when every explicit tiebreaker is equal', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId, {
        tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'],
      });
      const teams = fixture.schedule.source.entries.map((entry) => entry.teamId);
      for (const [index, match] of fixture.matches.entries()) {
        const homeIndex = teams.indexOf(match.home.teamId);
        const awayIndex = teams.indexOf(match.away.teamId);
        const homeWins = (homeIndex + 1) % teams.length === awayIndex;
        await confirmMatch(h, fixture, index, homeWins ? 1 : 0, homeWins ? 0 : 1);
      }
      const result = await privateStandings(h, eventId);
      const standings = result.standings!;
      expect(standings).toMatchObject({
        confirmedMatchCount: 3,
        totalMatchCount: 3,
        isComplete: true,
        hasSharedRanks: true,
      });
      expect(standings.rows.map((row) => row.teamId)).toEqual(teams);
      for (const row of standings.rows)
        expect(row).toMatchObject({
          rank: 1,
          tied: true,
          played: 2,
          wins: 1,
          draws: 0,
          losses: 1,
          pointsFor: 1,
          pointsAgainst: 1,
          scoreDifference: 0,
          leaguePoints: 3,
        });
      expect(result.event.status).toBe('RUNNING');
      totalsConserved(standings);
      expect((await privateStandings(h, eventId)).standings!.sourceHash).toBe(standings.sourceHash);
    }, 60000);

    test('FINAL staff metadata does not invalidate a result, reopen removes it immediately and reconfirm counts only the latest immutable history', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      const match = await confirmMatch(h, fixture, 0, 2, 0);
      const first = (await privateStandings(h, eventId)).standings!;
      expect(first).toMatchObject({ confirmedMatchCount: 1, totalMatchCount: 1, isComplete: true });
      const firstConfirmation = match.confirmed.snapshot.latestConfirmation!;
      const metadata = await assign(h, match.matchId, h.otherOwner, 'SCORER', 'DISABLED');
      expect(metadata.match.version).toBeGreaterThan(firstConfirmation.sourceMatchVersion + 1);
      const afterMetadata = (await privateStandings(h, eventId)).standings!;
      expect(afterMetadata.sourceHash).toBe(first.sourceHash);
      expect(afterMetadata.rows).toEqual(first.rows);
      const opened = await reopen(h, match.matchId);
      expect(opened.snapshot).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        requiresReconfirmation: true,
        latestConfirmation: { id: firstConfirmation.id },
      });
      const withdrawn = (await privateStandings(h, eventId)).standings!;
      expect(withdrawn).toMatchObject({ confirmedMatchCount: 0, isComplete: false });
      for (const row of withdrawn.rows)
        expect(row).toMatchObject({
          rank: null,
          played: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          leaguePoints: 0,
        });
      expect(withdrawn.sourceHash).not.toBe(first.sourceHash);
      const reconfirmed = await act(h, match.matchId, h.owner, {
        type: 'CONFIRM_RESULT',
        payload: {},
      });
      const restored = (await privateStandings(h, eventId)).standings!;
      expect(restored).toMatchObject({ confirmedMatchCount: 1, isComplete: true });
      expect(restored.rows).toEqual(first.rows);
      expect(restored.sourceHash).not.toBe(first.sourceHash);
      const history = (
        await allPages<ResultConfirmationData>(
          h.api,
          `${confirmationsPath(h.owner.orgId, match.matchId)}?limit=1`,
          h.owner,
        )
      ).items;
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(firstConfirmation);
      expect(history[1]).toEqual(reconfirmed.snapshot.latestConfirmation);
      for (let read = 0; read < 3; read++) {
        const repeat = (await privateStandings(h, eventId)).standings!;
        expect(repeat.sourceHash).toBe(restored.sourceHash);
        expect(repeat.confirmedMatchCount).toBe(1);
        totalsConserved(repeat);
      }
    });

    test('FINAL source corruption is rejected instead of publishing stale totals, pointers or a hidden reconfirmation flag', async () => {
      const fixture = await published(h, h.teams.slice(0, 2), { regulationPeriods: 2 });
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      const match = await confirmMatch(h, fixture, 0, 2, 1);
      const oldConfirmationId = match.confirmed.snapshot.latestConfirmation!.id;
      await reopen(h, match.matchId);
      const reconfirmed = await act(h, match.matchId, h.owner, {
        type: 'CONFIRM_RESULT',
        payload: {},
      });
      const currentId = reconfirmed.snapshot.latestConfirmation!.id;
      const publication = await enable(h, eventId);
      const publicPath = publicStandingsPath(publication.publication!.publicEventId);
      const valid = (await privateStandings(h, eventId)).standings!;
      const corruptions = [
        { sql: 'home_score=home_score+1', restore: 'home_score=$3::int', value: 2 },
        {
          sql: 'latest_confirmation_id=NULL',
          restore: 'latest_confirmation_id=$3::uuid',
          value: currentId,
        },
        {
          sql: 'latest_confirmation_id=$3::uuid',
          parameters: [oldConfirmationId],
          restore: 'latest_confirmation_id=$3::uuid',
          value: currentId,
        },
        {
          sql: 'requires_reconfirmation=true',
          restore: 'requires_reconfirmation=$3::boolean',
          value: false,
        },
        { sql: 'clock_running=true', restore: 'clock_running=$3::boolean', value: false },
        { sql: 'remaining_ms=1', restore: 'remaining_ms=$3::int', value: 0 },
        { sql: 'period=1', restore: 'period=$3::int', value: 2 },
      ];
      for (const corruption of corruptions) {
        try {
          await h.api.pool.query(
            `UPDATE scoring_states SET ${corruption.sql} WHERE org_id=$1 AND match_id=$2`,
            [h.owner.orgId, match.matchId, ...(corruption.parameters ?? [])],
          );
          rejected(
            await call(h.api, 'get', standingsPath(h.owner.orgId, eventId), {
              cookie: h.owner.cookie,
            }),
            409,
            'RESULT_SOURCE_INVALID',
          );
          const publicResponse = await anonymous(h, publicPath);
          rejected(publicResponse, 409, 'RESULT_SOURCE_INVALID');
          expect(publicResponse.body.error).not.toHaveProperty('details');
          const message = JSON.stringify(publicResponse.body);
          for (const privateValue of [
            h.owner.orgId,
            eventId,
            match.matchId,
            oldConfirmationId,
            currentId,
            h.otherOwner.email,
            h.owner.cookie,
          ])
            expect(message).not.toContain(privateValue);
        } finally {
          await h.api.pool.query(
            `UPDATE scoring_states SET ${corruption.restore} WHERE org_id=$1 AND match_id=$2`,
            [h.owner.orgId, match.matchId, corruption.value],
          );
        }
        expect((await privateStandings(h, eventId)).standings!.sourceHash).toBe(valid.sourceHash);
        const publicResult = data<PublicStandingsData>(await anonymous(h, publicPath));
        expect(publicResult.confirmedMatchCount).toBe(1);
        expect(publicResult.sourceHash).toBe(valid.sourceHash);
      }
      // Revocation remains available when result data cannot safely be shown.
      const versionBeforeCorruption = (await privateStandings(h, eventId)).event.version;
      try {
        await h.api.pool.query(
          'UPDATE scoring_states SET home_score=home_score+1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId],
        );
        const revoked = await disable(h, eventId, versionBeforeCorruption);
        expect(revoked.publication!.status).toBe('REVOKED');
        expect(revoked.standings).toBeNull();
        rejected(await anonymous(h, publicPath), 404, 'RESOURCE_NOT_FOUND');
      } finally {
        await h.api.pool.query(
          'UPDATE scoring_states SET home_score=$3 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId, 2],
        );
      }
      expect((await privateStandings(h, eventId)).standings!.sourceHash).toBe(valid.sourceHash);
    });

    test('an in-flight reopen exposes coherent old standings before commit and no historical result after commit', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      const match = await confirmMatch(h, fixture, 0, 2, 0);
      const before = (await privateStandings(h, eventId)).standings!;
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
                payload: { reason: '核对正式来源快照原子性' },
              }),
            ),
          );
          await blockedPid(h.api.pool, pid, 'Reopen did not wait for the held official match');
          const reads = await Promise.all(
            Array.from({ length: 3 }, () => privateStandings(h, eventId)),
          );
          for (const read of reads) {
            expect(read.standings!.sourceHash).toBe(before.sourceHash);
            expect(read.standings!.rows).toEqual(before.rows);
            expect(read.standings!.confirmedMatchCount).toBe(1);
            totalsConserved(read.standings!);
          }
          await unlock();
          data(await reopening);
        },
      );
      const after = (await privateStandings(h, eventId)).standings!;
      expect(after.confirmedMatchCount).toBe(0);
      expect(after.rows.every((row) => row.rank === null && row.played === 0)).toBe(true);
      totalsConserved(after);
    });

    test('a failed audit rolls back both rule creation and permanent publication and the same CAS can safely be retried', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const fingerprint = async () => {
        const results: Record<string, unknown> = {};
        for (const [name, sql] of Object.entries({
          event: 'SELECT * FROM events WHERE org_id=$1 AND id=$2',
          rules: 'SELECT * FROM standings_rulesets WHERE org_id=$1 AND event_id=$2',
          audit: 'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id=$2',
        }))
          results[name] = (
            await h.api.pool.query<{ rows: unknown }>(
              `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM (${sql}) t`,
              [h.owner.orgId, eventId],
            )
          ).rows[0]!.rows;
        return results;
      };
      for (const operation of ['SAVE', 'PUBLISH'] as const) {
        const current = await privateStandings(h, eventId);
        const method = operation === 'SAVE' ? 'put' : 'post';
        const path =
          operation === 'SAVE'
            ? standingsRulesPath(h.owner.orgId, eventId)
            : standingsCommandsPath(h.owner.orgId, eventId);
        const body =
          operation === 'SAVE'
            ? { expectedEventVersion: current.event.version, ...defaultStandingsRules() }
            : {
                type: 'PUBLISH_STANDINGS_RULES',
                rulesetId: current.rules!.id,
                expectedEventVersion: current.event.version,
              };
        const original = await fingerprint();
        const identifier = `scb_p05b_rules_audit_${randomUUID().replaceAll('-', '')}`;
        for (const id of [h.owner.orgId, eventId]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
        await h.api.pool.query(
          `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.resource_id::text=TG_ARGV[1] AND NEW.action LIKE 'standings.%' THEN RAISE EXCEPTION 'p05b rules audit failure'; END IF; RETURN NEW; END $$`,
        );
        try {
          await h.api.pool.query(
            `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${eventId}')`,
          );
          const response = await call(h.api, method, path, { cookie: h.owner.cookie, body });
          error(response, 500);
          expect(JSON.stringify(response.body)).not.toMatch(
            /p05b rules audit|audit_logs|SQLSTATE|postgres/i,
          );
          expect(await fingerprint()).toEqual(original);
        } finally {
          try {
            await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
          } finally {
            await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
          }
        }
        const retried = data<EventStandingsData>(
          await call(h.api, method, path, { cookie: h.owner.cookie, body }),
        );
        expect(retried.event.version).toBe(current.event.version + 1);
        expect(retried.rules!.version).toBe(1);
        expect(retried.locked).toBe(operation === 'PUBLISH');
      }
    });

    test('private standings require event authority and recheck role and membership with the existing cookie', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const setStaff = async (role: 'REVIEWER' | 'EVENT_MANAGER', status = 'ACTIVE') =>
        data(
          await call(h.api, 'put', eventStaffPath(h.owner.orgId, eventId, h.otherOwner.id), {
            cookie: h.owner.cookie,
            body: { role, status },
          }),
        );
      await saveRules(h, eventId);
      await assign(h, fixture.matches[0]!.id, h.otherOwner);
      rejected(
        await call(h.api, 'get', standingsPath(h.owner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
        'RESOURCE_NOT_FOUND',
      );
      rejected(
        await call(h.api, 'get', standingsPath(h.otherOwner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
        'RESOURCE_NOT_FOUND',
      );
      await setStaff('REVIEWER');
      const reader = await privateStandings(h, eventId, h.otherOwner);
      expect(reader.capabilities).toMatchObject({ canManageRules: false, canPublishRules: false });
      rejected(
        await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
          body: { expectedEventVersion: reader.event.version, ...defaultStandingsRules() },
        }),
        403,
        'FORBIDDEN',
      );
      await setStaff('EVENT_MANAGER');
      const manager = await privateStandings(h, eventId, h.otherOwner);
      expect(manager.capabilities).toMatchObject({ canManageRules: true, canPublishRules: true });
      data<EventStandingsData>(
        await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
          body: {
            expectedEventVersion: manager.event.version,
            ...defaultStandingsRules({ winPoints: 7 }),
          },
        }),
      );
      await setStaff('EVENT_MANAGER', 'DISABLED');
      rejected(
        await call(h.api, 'get', standingsPath(h.owner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
        'RESOURCE_NOT_FOUND',
      );
      await setStaff('EVENT_MANAGER');
      await membership(h.api, h.owner, h.otherOwner, 'EVENT_MANAGER', 'DISABLED');
      try {
        rejected(
          await call(h.api, 'get', standingsPath(h.owner.orgId, eventId), {
            cookie: h.otherOwner.cookie,
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
      } finally {
        await membership(h.api, h.owner, h.otherOwner, 'EVENT_MANAGER');
      }
    });
  },
);

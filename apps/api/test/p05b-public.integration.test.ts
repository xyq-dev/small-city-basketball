import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventStandingsData,
  PublicEventData,
  PublicScheduleMatchData,
  PublicStandingsData,
} from '@small-city-basketball/contracts';
import { call, data, error, eventually, PASSWORD, staffPath } from './support.js';
import { APPLICATION_NAME, blockedPid, frozen } from './p04-support.js';
import {
  act,
  anonymous,
  assign,
  closeHarness,
  confirmMatch,
  createScoringHarness,
  disable,
  enable,
  liveMatch,
  prepare,
  privateStandings,
  publicEventPath,
  publicMatchPath,
  publicSchedulePath,
  publicStandingsPath,
  published,
  reopen,
  savePublishRules,
  viewingCommand,
  viewingCommandsPath,
  withRowsLocked,
} from './p05b-support.js';
import type { Harness, PublishedFixture } from './p05b-support.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as JsonObject;
}

function exact(value: unknown, keys: string[]): JsonObject {
  const result = object(value);
  expect(Object.keys(result).sort()).toEqual([...keys].sort());
  return result;
}

function publicRules(value: unknown): void {
  const rules = exact(value, [
    'winPoints',
    'lossPoints',
    'drawPoints',
    'tiebreakers',
    'version',
    'algorithmVersion',
  ]);
  expect(rules.algorithmVersion).toBe('RR_STANDINGS_V1');
  expect(Array.isArray(rules.tiebreakers)).toBe(true);
  for (const criterion of rules.tiebreakers as unknown[])
    expect(['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS']).toContain(criterion);
  for (const key of ['winPoints', 'lossPoints', 'drawPoints', 'version'])
    expect(rules[key]).toEqual(expect.any(Number));
}

function publicTeam(value: unknown): void {
  const team = exact(value, ['teamKey', 'teamName']);
  expect(team.teamKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(team.teamName).toEqual(expect.any(String));
}

function totals(value: unknown): void {
  const result = exact(value, ['score', 'fouls', 'timeouts']);
  for (const metric of Object.values(result)) expect(metric).toEqual(expect.any(Number));
}

const scheduleKeys = [
  'publicMatchId',
  'roundNo',
  'positionNo',
  'home',
  'away',
  'courtName',
  'startsAt',
  'endsAt',
  'status',
  'version',
  'score',
  'resultStatus',
];

function publicScheduleMatch(value: unknown, additionalKeys: string[] = []): void {
  const match = exact(value, [...scheduleKeys, ...additionalKeys]);
  expect(match.publicMatchId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  publicTeam(match.home);
  publicTeam(match.away);
  for (const key of ['roundNo', 'positionNo', 'version'])
    expect(match[key]).toEqual(expect.any(Number));
  for (const key of ['courtName', 'startsAt', 'endsAt', 'status', 'resultStatus'])
    expect(match[key]).toEqual(expect.any(String));
  if (match.score !== null) {
    const score = exact(match.score, ['home', 'away']);
    expect(score.home).toEqual(expect.any(Number));
    expect(score.away).toEqual(expect.any(Number));
  }
}

function publicMatch(value: unknown): void {
  publicScheduleMatch(value, [
    'publicEventId',
    'eventName',
    'totals',
    'periods',
    'rules',
    'clock',
    'collected',
    'serverTime',
  ]);
  const match = object(value);
  expect(match.publicEventId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  if (match.totals !== null) {
    const both = exact(match.totals, ['home', 'away']);
    totals(both.home);
    totals(both.away);
  }
  if (match.periods !== null) {
    expect(Array.isArray(match.periods)).toBe(true);
    for (const period of match.periods as unknown[]) {
      const both = exact(period, ['period', 'home', 'away']);
      expect(both.period).toEqual(expect.any(Number));
      totals(both.home);
      totals(both.away);
    }
  }
  if (match.rules !== null) {
    const rules = exact(match.rules, [
      'regulationPeriods',
      'periodDurationSeconds',
      'allowedScoreValues',
      'tiePolicy',
      'overtimeDurationSeconds',
      'version',
    ]);
    expect(Array.isArray(rules.allowedScoreValues)).toBe(true);
    for (const point of rules.allowedScoreValues as unknown[]) expect([1, 2, 3]).toContain(point);
    for (const key of ['version', 'regulationPeriods', 'periodDurationSeconds'])
      expect(rules[key]).toEqual(expect.any(Number));
    expect(['ALLOW_DRAW', 'OVERTIME']).toContain(rules.tiePolicy);
    expect(
      rules.overtimeDurationSeconds === null || typeof rules.overtimeDurationSeconds === 'number',
    ).toBe(true);
  }
  if (match.clock !== null) {
    const clock = exact(match.clock, [
      'period',
      'remainingMs',
      'running',
      'anchorServerTime',
      'clockVersion',
    ]);
    for (const key of ['period', 'remainingMs', 'clockVersion'])
      expect(clock[key]).toEqual(expect.any(Number));
    expect(clock.running).toEqual(expect.any(Boolean));
    expect(clock.anchorServerTime).toEqual(expect.any(String));
  }
  for (const key of ['eventName', 'serverTime']) expect(match[key]).toEqual(expect.any(String));
  const collected = exact(match.collected, [
    'teamScore',
    'teamFouls',
    'teamTimeouts',
    'playerStatistics',
  ]);
  for (const flag of Object.values(collected)) expect(flag).toEqual(expect.any(Boolean));
  expect(object(match.collected).playerStatistics).toBe(false);
}

function publicEvent(value: unknown): void {
  const event = exact(value, [
    'publicEventId',
    'name',
    'startDate',
    'endDate',
    'timezone',
    'venueName',
    'status',
    'rules',
    'confirmedMatchCount',
    'totalMatchCount',
    'isComplete',
    'serverTime',
  ]);
  expect(event.publicEventId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  for (const key of ['name', 'startDate', 'endDate', 'timezone', 'status', 'serverTime'])
    expect(event[key]).toEqual(expect.any(String));
  expect(event.venueName === null || typeof event.venueName === 'string').toBe(true);
  for (const key of ['confirmedMatchCount', 'totalMatchCount'])
    expect(event[key]).toEqual(expect.any(Number));
  expect(event.isComplete).toEqual(expect.any(Boolean));
  publicRules(event.rules);
}

function publicStandings(value: unknown): void {
  const standings = exact(value, [
    'publicEventId',
    'rules',
    'sourceHash',
    'asOf',
    'confirmedMatchCount',
    'totalMatchCount',
    'isComplete',
    'hasSharedRanks',
    'rows',
  ]);
  publicRules(standings.rules);
  expect(standings.publicEventId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  for (const key of ['sourceHash', 'asOf']) expect(standings[key]).toEqual(expect.any(String));
  for (const key of ['confirmedMatchCount', 'totalMatchCount'])
    expect(standings[key]).toEqual(expect.any(Number));
  for (const key of ['isComplete', 'hasSharedRanks'])
    expect(standings[key]).toEqual(expect.any(Boolean));
  expect(Array.isArray(standings.rows)).toBe(true);
  for (const row of standings.rows as unknown[]) {
    const item = exact(row, [
      'teamKey',
      'teamName',
      'rank',
      'tied',
      'played',
      'wins',
      'draws',
      'losses',
      'pointsFor',
      'pointsAgainst',
      'scoreDifference',
      'leaguePoints',
    ]);
    expect(item.teamKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(item.teamName).toEqual(expect.any(String));
    expect(item.rank === null || typeof item.rank === 'number').toBe(true);
    expect(item.tied).toEqual(expect.any(Boolean));
    for (const key of [
      'played',
      'wins',
      'draws',
      'losses',
      'pointsFor',
      'pointsAgainst',
      'scoreDifference',
      'leaguePoints',
    ])
      expect(item[key]).toEqual(expect.any(Number));
  }
}

function publicEnvelope(response: Response, paged = false): void {
  data(response);
  exact(response.body, ['data', 'meta']);
  const meta = object(response.body.meta);
  const keys = ['requestId'];
  if (paged && Object.hasOwn(meta, 'nextCursor')) keys.push('nextCursor');
  exact(meta, keys);
  expect(response.headers['set-cookie']).toBeUndefined();
}

function notFound(response: Response): void {
  error(response, 404);
  expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['serverTime', 'asOf', 'requestId'].includes(key))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  return value;
}

async function schedule(h: Harness, publicEventId: string): Promise<PublicScheduleMatchData[]> {
  const response = await anonymous(h, `${publicSchedulePath(publicEventId)}?limit=100`);
  publicEnvelope(response, true);
  const rows = data<PublicScheduleMatchData[]>(response);
  for (const row of rows) publicScheduleMatch(row);
  return rows;
}

async function endpoints(
  h: Harness,
  publicEventId: string,
  publicMatchId: string,
): Promise<Response[]> {
  return Promise.all(
    [
      publicEventPath(publicEventId),
      publicSchedulePath(publicEventId),
      publicStandingsPath(publicEventId),
      publicMatchPath(publicEventId, publicMatchId),
    ].map((path) => anonymous(h, path)),
  );
}

async function privateMarkers(h: Harness, fixture: PublishedFixture): Promise<string[]> {
  const actors = [h.owner, h.otherOwner, h.leader];
  const serialized = JSON.stringify([actors, h.teams, h.otherTeams, fixture]);
  const ids =
    serialized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
  const records = await h.api.pool.query<{
    display_name: string;
    email: string;
    password_hash: string;
  }>('SELECT display_name,email,password_hash FROM users WHERE id=ANY($1::uuid[])', [
    actors.map((actor) => actor.id),
  ]);
  const privateRecords: unknown[] = [];
  for (const table of [
    'scoring_rulesets',
    'match_staff',
    'scoring_leases',
    'scoring_events',
    'scoring_commands',
    'result_confirmations',
    'standings_rulesets',
    'public_event_publications',
    'public_match_links',
  ])
    privateRecords.push(
      ...(
        await h.api.pool.query(`SELECT * FROM ${table} WHERE org_id=$1 AND event_id=$2`, [
          h.owner.orgId,
          fixture.event.event.id,
        ])
      ).rows,
    );
  const sessions = await h.api.pool.query<{ id: string; token_hash: string }>(
    'SELECT id,token_hash FROM sessions WHERE user_id=ANY($1::uuid[])',
    [actors.map((actor) => actor.id)],
  );
  const laterIds =
    JSON.stringify(privateRecords).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    ) ?? [];
  return [
    ...new Set([
      ...ids,
      ...laterIds,
      PASSWORD,
      ...sessions.rows.flatMap((row) => Object.values(row)),
      ...actors.flatMap((actor) => [
        actor.email,
        actor.cookie,
        actor.cookie.slice('scb.sid='.length),
      ]),
      ...h.teams.flatMap((team) => team.members.map((member) => member.name)),
      ...records.rows.flatMap((row) => Object.values(row)),
    ]),
  ];
}

async function rejectedSql(
  h: Harness,
  expectedCode: string,
  run: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await h.api.pool.connect();
  try {
    await client.query('BEGIN');
    let failure: unknown;
    try {
      await run(client);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toMatchObject({ code: expectedCode });
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

function noPrivateValues(value: unknown, markers: string[]): void {
  const serialized = JSON.stringify(value);
  for (const marker of markers) {
    expect(marker.length).toBeGreaterThan(0);
    expect(serialized).not.toContain(marker);
  }
}

async function fingerprint(h: Harness, eventId: string): Promise<Record<string, unknown>> {
  const sources = {
    event: 'SELECT * FROM events WHERE org_id=$1 AND id=$2',
    rules: 'SELECT * FROM standings_rulesets WHERE org_id=$1 AND event_id=$2',
    publications: 'SELECT * FROM public_event_publications WHERE org_id=$1 AND event_id=$2',
    links: 'SELECT * FROM public_match_links WHERE org_id=$1 AND event_id=$2',
    audit: 'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id=$2',
  };
  const result: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(sources))
    result[name] = (
      await h.api.pool.query<{ rows: unknown }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(scoped) ORDER BY to_jsonb(scoped)::text),'[]'::jsonb) AS rows FROM (${query}) scoped`,
        [h.owner.orgId, eventId],
      )
    ).rows[0]!.rows;
  return result;
}

describe(
  'P05-B revocable public viewing on real PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('all anonymous responses use exact recursive public fields, keep unprepared values null, and never expose private identifiers or credentials', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      await savePublishRules(h, fixture.event.event.id);
      const enabled = await enable(h, fixture.event.event.id);
      const key = enabled.publication!.publicEventId;
      const markers = await privateMarkers(h, fixture);
      const initial = await schedule(h, key);
      expect(initial).toHaveLength(3);
      for (const row of initial) {
        expect(row).toMatchObject({
          status: 'SCHEDULED',
          score: null,
          resultStatus: 'UNCONFIRMED',
        });
        const response = await anonymous(h, publicMatchPath(key, row.publicMatchId));
        publicEnvelope(response);
        publicMatch(response.body.data);
        expect(response.body.data).toMatchObject({
          totals: null,
          periods: null,
          rules: null,
          clock: null,
        });
        expect(response.body.data.collected).toEqual({
          teamScore: false,
          teamFouls: false,
          teamTimeouts: false,
          playerStatistics: false,
        });
        noPrivateValues(response.body, markers);
      }
      const first = fixture.matches[0]!;
      await assign(h, first.id, h.otherOwner);
      await prepare(h, first.id);
      const second = await liveMatch(h, fixture, 1);
      await act(
        h,
        second.matchId,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: { kind: 'FOUL', side: 'AWAY', value: 1 },
        },
        second.lease,
      );
      const third = await confirmMatch(h, fixture, 2, 2, 1);
      markers.push(...(await privateMarkers(h, fixture)));
      const rows = await schedule(h, key);
      expect(rows.map((row) => row.status).sort()).toEqual(['FINAL', 'LIVE', 'READY']);
      for (const row of rows) {
        const response = await anonymous(h, publicMatchPath(key, row.publicMatchId));
        publicEnvelope(response);
        publicMatch(response.body.data);
        noPrivateValues(response.body, markers);
        expect(response.body.data.collected).toEqual({
          teamScore: true,
          teamFouls: true,
          teamTimeouts: true,
          playerStatistics: false,
        });
        if (row.status === 'READY') {
          expect(row.score).toEqual({ home: 0, away: 0 });
          expect(response.body.data).toMatchObject({
            totals: { home: { score: 0 }, away: { score: 0 } },
            clock: { running: false },
          });
          expect(response.body.data.rules).not.toBeNull();
        }
        if (row.status === 'FINAL') {
          expect(row.score).toEqual({ home: 2, away: 1 });
          expect(row.resultStatus).toBe('CONFIRMED');
        }
      }
      const responses = await endpoints(h, key, rows[0]!.publicMatchId);
      for (const response of responses) noPrivateValues(response.body, markers);
      publicEvent(data<PublicEventData>(responses[0]!));
      publicStandings(data<PublicStandingsData>(responses[2]!));
      expect(responses[2]!.body.data).toMatchObject({
        confirmedMatchCount: 1,
        totalMatchCount: 3,
        isComplete: false,
      });
      await reopen(h, third.matchId);
      const reopened = await schedule(h, key);
      expect(reopened.find((row) => row.status === 'PENDING_CONFIRMATION')!.resultStatus).toBe(
        'REQUIRES_RECONFIRMATION',
      );
      markers.push(...(await privateMarkers(h, fixture)));
      for (const response of await endpoints(h, key, rows[0]!.publicMatchId))
        noPrivateValues(response.body, markers);
    });

    test('public viewing requires a formal schedule and locked standings rules, and concurrent enable creates one complete publication', async () => {
      const unscheduled = await frozen(h);
      await savePublishRules(h, unscheduled.event.id);
      const noSchedule = await viewingCommand(h, unscheduled.event.id, 'ENABLE');
      error(noSchedule, 422);
      expect(noSchedule.body.error.code).toBe('SCHEDULE_REQUIRED');
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id;
      const noRules = await viewingCommand(h, eventId, 'ENABLE');
      error(noRules, 422);
      expect(noRules.body.error.code).toBe('STANDINGS_RULES_REQUIRED');
      const ready = await savePublishRules(h, eventId);
      const results = await Promise.all([
        viewingCommand(h, eventId, 'ENABLE', ready.event.version),
        viewingCommand(h, eventId, 'ENABLE', ready.event.version),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      const loser = results.find((response) => response.status === 409)!;
      error(loser, 409);
      expect(loser.body.error.code).toBe('VERSION_CONFLICT');
      const success = data<EventStandingsData>(
        results.find((response) => response.status === 200)!,
      );
      expect(success.event.version).toBe(ready.event.version + 1);
      const ids = (await schedule(h, success.publication!.publicEventId)).map(
        (row) => row.publicMatchId,
      );
      expect(ids).toHaveLength(fixture.matches.length);
      expect(new Set(ids).size).toBe(fixture.matches.length);
      const counts = (
        await h.api.pool.query<{ publications: number; links: number }>(
          `SELECT (SELECT count(*)::int FROM public_event_publications WHERE org_id=$1 AND event_id=$2 AND revoked_at IS NULL) AS publications,
       (SELECT count(*)::int FROM public_match_links WHERE org_id=$1 AND event_id=$2) AS links`,
          [h.owner.orgId, eventId],
        )
      ).rows[0]!;
      expect(counts).toEqual({ publications: 1, links: fixture.matches.length });
      const beforeDuplicate = await fingerprint(h, eventId);
      const duplicate = await viewingCommand(h, eventId, 'ENABLE');
      error(duplicate, 409);
      expect(duplicate.body.error.code).toBe('PUBLIC_VIEWING_ALREADY_ENABLED');
      expect(await fingerprint(h, eventId)).toEqual(beforeDuplicate);
    });

    test('revocation is permanent for every old endpoint, re-enable rotates all public identities, and match keys cannot cross publications', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      const first = await enable(h, eventId);
      const oldKey = first.publication!.publicEventId;
      const oldRows = await schedule(h, oldKey);
      const beforeDisable = await privateStandings(h, eventId);
      const revoked = await disable(h, eventId);
      expect(revoked.event.version).toBe(beforeDisable.event.version + 1);
      expect(revoked.publication).toMatchObject({
        publicEventId: oldKey,
        status: 'REVOKED',
        revokedAt: expect.any(String),
      });
      for (const response of await endpoints(h, oldKey, oldRows[0]!.publicMatchId))
        notFound(response);
      const snapshot = await fingerprint(h, eventId);
      const duplicate = await viewingCommand(h, eventId, 'DISABLE');
      error(duplicate, 409);
      expect(duplicate.body.error.code).toBe('PUBLIC_VIEWING_NOT_ENABLED');
      expect(await fingerprint(h, eventId)).toEqual(snapshot);
      const second = await enable(h, eventId);
      const nextKey = second.publication!.publicEventId;
      expect(nextKey).not.toBe(oldKey);
      const nextRows = await schedule(h, nextKey);
      const oldMatches = new Set(oldRows.map((row) => row.publicMatchId));
      const oldTeams = new Set(oldRows.flatMap((row) => [row.home.teamKey, row.away.teamKey]));
      for (const row of nextRows) {
        expect(oldMatches.has(row.publicMatchId)).toBe(false);
        expect(oldTeams.has(row.home.teamKey)).toBe(false);
        expect(oldTeams.has(row.away.teamKey)).toBe(false);
      }
      notFound(await anonymous(h, publicMatchPath(nextKey, oldRows[0]!.publicMatchId)));
      notFound(await anonymous(h, publicMatchPath(oldKey, nextRows[0]!.publicMatchId)));
      for (const response of await endpoints(h, oldKey, oldRows[0]!.publicMatchId))
        notFound(response);
      const another = await published(h, h.teams.slice(0, 2));
      await savePublishRules(h, another.event.event.id);
      const anotherKey = (await enable(h, another.event.event.id)).publication!.publicEventId;
      const anotherRows = await schedule(h, anotherKey);
      const currentTeams = new Set(nextRows.flatMap((row) => [row.home.teamKey, row.away.teamKey]));
      for (const row of anotherRows) {
        expect(currentTeams.has(row.home.teamKey)).toBe(false);
        expect(currentTeams.has(row.away.teamKey)).toBe(false);
      }
      notFound(await anonymous(h, publicMatchPath(nextKey, anotherRows[0]!.publicMatchId)));
      notFound(await anonymous(h, publicMatchPath(anotherKey, nextRows[0]!.publicMatchId)));
      const historic = await h.api.pool.query<{ public_event_id: string; revoked: boolean }>(
        'SELECT public_event_id,revoked_at IS NOT NULL AS revoked FROM public_event_publications WHERE org_id=$1 AND event_id=$2 ORDER BY created_at,id',
        [h.owner.orgId, eventId],
      );
      expect(historic.rows).toEqual([
        { public_event_id: oldKey, revoked: true },
        { public_event_id: nextKey, revoked: false },
      ]);
    });

    test('public schedule pagination is complete and stable, exposes only public cursor fields, and rejects another publication scope', async () => {
      const fixture = await published(h);
      await savePublishRules(h, fixture.event.event.id);
      const key = (await enable(h, fixture.event.event.id)).publication!.publicEventId;
      const all = await schedule(h, key);
      const seen: PublicScheduleMatchData[] = [];
      let cursor: string | null = null;
      let firstCursor: string | undefined;
      const markers = await privateMarkers(h, fixture);
      do {
        const path = `${publicSchedulePath(key)}?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
        const response = await anonymous(h, path);
        publicEnvelope(response, true);
        const page = data<PublicScheduleMatchData[]>(response);
        expect(page.length).toBeGreaterThan(0);
        expect(page.length).toBeLessThanOrEqual(2);
        for (const row of page) publicScheduleMatch(row);
        seen.push(...page);
        const next = response.body.meta.nextCursor as string | null;
        expect(next === null || typeof next === 'string').toBe(true);
        cursor = next;
        if (cursor !== null) {
          firstCursor ??= cursor;
          const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
          const boundary = exact(decoded, ['scope', 'time', 'publicMatchId']);
          // P04-B binds the public cursor to this event's rescheduling history version.
          // This fixture has no reschedules; the scope still contains no private identity.
          expect(boundary.scope).toBe(`public-schedule:${key}::0`);
          expect(boundary.time).toEqual(expect.any(String));
          expect(all.some((match) => match.publicMatchId === boundary.publicMatchId)).toBe(true);
          noPrivateValues(decoded, markers);
        }
        expect(seen.length).toBeLessThanOrEqual(all.length);
      } while (cursor !== null);
      expect(seen).toEqual(all);
      expect(new Set(seen.map((row) => row.publicMatchId)).size).toBe(6);
      expect(firstCursor).toBeDefined();
      const repeated = await anonymous(
        h,
        `${publicSchedulePath(key)}?limit=2&cursor=${encodeURIComponent(firstCursor!)}`,
      );
      expect(data<PublicScheduleMatchData[]>(repeated)).toEqual(all.slice(2, 4));
      const wrongFilter = await anonymous(
        h,
        `${publicSchedulePath(key)}?limit=2&status=SCHEDULED&cursor=${encodeURIComponent(firstCursor!)}`,
      );
      error(wrongFilter, 422);
      expect(wrongFilter.body.error.code).toBe('VALIDATION_ERROR');
      await disable(h, fixture.event.event.id);
      const nextKey = (await enable(h, fixture.event.event.id)).publication!.publicEventId;
      const wrongScope = await anonymous(
        h,
        `${publicSchedulePath(nextKey)}?limit=2&cursor=${encodeURIComponent(firstCursor!)}`,
      );
      error(wrongScope, 422);
      expect(wrongScope.body.error.code).toBe('VALIDATION_ERROR');
      const changed = Buffer.from('{"scope":').toString('base64url');
      const tampered = await anonymous(
        h,
        `${publicSchedulePath(nextKey)}?limit=2&cursor=${encodeURIComponent(changed)}`,
      );
      error(tampered, 422);
    });

    test('anonymous results ignore cookies and all public routes fail closed while the owning organization is inactive', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      await savePublishRules(h, fixture.event.event.id);
      const key = (await enable(h, fixture.event.event.id)).publication!.publicEventId;
      const row = (await schedule(h, key))[0]!;
      const paths = [
        publicEventPath(key),
        publicSchedulePath(key),
        publicStandingsPath(key),
        publicMatchPath(key, row.publicMatchId),
      ];
      for (const path of paths) {
        const anonymousResponse = await anonymous(h, path);
        for (const cookie of [h.owner.cookie, h.otherOwner.cookie, 'scb.sid=invalid-or-expired']) {
          const loggedIn = await anonymous(h, path, cookie);
          publicEnvelope(loggedIn, path === publicSchedulePath(key));
          expect(stable(loggedIn.body.data)).toEqual(stable(anonymousResponse.body.data));
        }
      }
      await h.api.pool.query("UPDATE organizations SET status='DISABLED' WHERE id=$1", [
        h.owner.orgId,
      ]);
      try {
        for (const path of paths) notFound(await anonymous(h, path));
      } finally {
        await h.api.pool.query("UPDATE organizations SET status='ACTIVE' WHERE id=$1", [
          h.owner.orgId,
        ]);
      }
      publicEvent(data(await anonymous(h, publicEventPath(key))));
      for (const response of await endpoints(
        h,
        randomBytes(32).toString('base64url'),
        row.publicMatchId,
      ))
        notFound(response);
      notFound(await anonymous(h, publicMatchPath(key, fixture.matches[0]!.id)));
    });

    test('public management requires the current actual event role, Origin and the strict command body', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const ready = await savePublishRules(h, eventId);
      const before = await fingerprint(h, eventId);
      const globalOnly = await viewingCommand(
        h,
        eventId,
        'ENABLE',
        ready.event.version,
        h.otherOwner,
      );
      notFound(globalOnly);
      await assign(h, fixture.matches[0]!.id, h.otherOwner);
      notFound(await viewingCommand(h, eventId, 'ENABLE', ready.event.version, h.otherOwner));
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
      const reviewer = await viewingCommand(h, eventId, 'ENABLE', undefined, h.otherOwner);
      error(reviewer, 403);
      expect(reviewer.body.error.code).toBe('FORBIDDEN');
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      const current = await privateStandings(h, eventId);
      for (const origin of [null, 'https://malicious.example.test']) {
        const invalidOrigin = await call(
          h.api,
          'post',
          viewingCommandsPath(h.owner.orgId, eventId),
          {
            cookie: h.otherOwner.cookie,
            origin,
            body: { type: 'ENABLE', expectedEventVersion: current.event.version },
          },
        );
        error(invalidOrigin, 403);
      }
      const invalidBody = await call(h.api, 'post', viewingCommandsPath(h.owner.orgId, eventId), {
        cookie: h.otherOwner.cookie,
        body: {
          type: 'ENABLE',
          expectedEventVersion: current.event.version,
          orgId: h.otherOwner.orgId,
        },
      });
      error(invalidBody, 422);
      expect(invalidBody.body.error.code).toBe('VALIDATION_ERROR');
      const authorized = data<EventStandingsData>(
        await viewingCommand(h, eventId, 'ENABLE', current.event.version, h.otherOwner),
      );
      expect(authorized.publication!.status).toBe('ACTIVE');
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      notFound(await viewingCommand(h, eventId, 'DISABLE', undefined, h.otherOwner));
      expect((await privateStandings(h, eventId)).publication).toEqual(authorized.publication);
      expect(before.publications).toEqual([]);
      expect(before.links).toEqual([]);
    });

    test('audit failures roll back enabling and revoking links with their complete maps and Event CAS', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      let activeKey: string | undefined;
      let activeMatch: string | undefined;
      for (const type of ['ENABLE', 'DISABLE'] as const) {
        const current = await privateStandings(h, eventId);
        const before = await fingerprint(h, eventId);
        const identifier = `scb_p05b_audit_${randomUUID().replaceAll('-', '')}`;
        for (const id of [h.owner.orgId, eventId]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
        await h.api.pool.query(
          `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.resource_id::text=TG_ARGV[1] THEN RAISE EXCEPTION 'p05b synthetic audit failure'; END IF; RETURN NEW; END $$`,
        );
        try {
          await h.api.pool.query(
            `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${eventId}')`,
          );
          const failed = await viewingCommand(h, eventId, type, current.event.version);
          error(failed, 500);
          expect(JSON.stringify(failed.body)).not.toMatch(
            /p05b synthetic|audit_logs|SQLSTATE|postgres/i,
          );
          expect(await fingerprint(h, eventId)).toEqual(before);
          if (type === 'DISABLE')
            for (const response of await endpoints(h, activeKey!, activeMatch!)) data(response);
        } finally {
          try {
            await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
          } finally {
            await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
          }
        }
        // The exact CAS from the failed transaction must remain usable after recovery.
        const retried = data<EventStandingsData>(
          await viewingCommand(h, eventId, type, current.event.version),
        );
        expect(retried.event.version).toBe(current.event.version + 1);
        if (type === 'ENABLE') {
          activeKey = retried.publication!.publicEventId;
          const rows = await schedule(h, activeKey);
          expect(rows).toHaveLength(fixture.matches.length);
          activeMatch = rows[0]!.publicMatchId;
        } else {
          for (const response of await endpoints(h, activeKey!, activeMatch!)) notFound(response);
        }
      }
      const audits = await h.api.pool.query<{ action: string }>(
        "SELECT action FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action LIKE '%public%' ORDER BY created_at,id",
        [h.owner.orgId, eventId],
      );
      expect(audits.rows).toEqual([
        { action: 'public_viewing.enabled' },
        { action: 'public_viewing.disabled' },
      ]);
    });

    test('public reads serialize with revocation in either lock order and recheck validity after waiting', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      const firstKey = (await enable(h, eventId)).publication!.publicEventId;
      const firstMatch = (await schedule(h, firstKey))[0]!.publicMatchId;
      await withRowsLocked(
        h,
        'SELECT id FROM public_event_publications WHERE org_id=$1 AND event_id=$2 AND public_event_id=$3 FOR UPDATE',
        [h.owner.orgId, eventId, firstKey],
        1,
        async (pid, unlock, track) => {
          const reading = track(anonymous(h, publicMatchPath(firstKey, firstMatch)));
          const readerPid = await blockedPid(
            h.api.pool,
            pid,
            'Public read did not wait on its publication while retaining the Event read lock',
          );
          const revoking = track(viewingCommand(h, eventId, 'DISABLE'));
          await blockedPid(
            h.api.pool,
            readerPid,
            'Revocation did not wait on the earlier public read',
          );
          await unlock();
          publicMatch(data(await reading));
          data(await revoking);
        },
      );
      for (const response of await endpoints(h, firstKey, firstMatch)) notFound(response);
      const secondKey = (await enable(h, eventId)).publication!.publicEventId;
      const secondMatch = (await schedule(h, secondKey))[0]!.publicMatchId;
      const current = await privateStandings(h, eventId);
      await withRowsLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, eventId],
        1,
        async (pid, unlock, track) => {
          const revoking = track(viewingCommand(h, eventId, 'DISABLE', current.event.version));
          const writerPid = await blockedPid(
            h.api.pool,
            pid,
            'Revocation did not reach the Event lock before the later public read',
          );
          const reading = track(anonymous(h, publicMatchPath(secondKey, secondMatch)));
          await eventually(
            async () =>
              (
                await h.api.pool.query<{ waiting: boolean }>(
                  `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>$2 AND $3=ANY(pg_blocking_pids(pid))) AS waiting`,
                  [APPLICATION_NAME, pid, writerPid],
                )
              ).rows[0]!.waiting,
            (waiting) => waiting,
            'Later public read did not queue behind the earlier revocation',
          );
          await unlock();
          data(await revoking);
          notFound(await reading);
        },
      );
      for (const response of await endpoints(h, secondKey, secondMatch)) notFound(response);
    }, 30000);

    test('public identity rows enforce complete maps, composite source foreign keys, and irreversible immutable history in PostgreSQL', async () => {
      const first = await published(h, h.teams.slice(0, 3));
      const second = await published(h, h.teams.slice(0, 2));
      const eventId = first.event.event.id;
      await savePublishRules(h, eventId);
      await savePublishRules(h, second.event.event.id);
      const enabled = await enable(h, eventId);
      const key = enabled.publication!.publicEventId;
      const rows = await schedule(h, key);
      const original = (
        await h.api.pool.query<{
          id: string;
          schedule_publication_id: string;
          ruleset_id: string;
          team_keys: Record<string, string>;
        }>(
          'SELECT id,schedule_publication_id,ruleset_id,team_keys FROM public_event_publications WHERE org_id=$1 AND event_id=$2 AND public_event_id=$3',
          [h.owner.orgId, eventId, key],
        )
      ).rows[0]!;
      const links = await h.api.pool.query<{ match_id: string }>(
        'SELECT match_id FROM public_match_links WHERE org_id=$1 AND event_id=$2 AND publication_id=$3 ORDER BY match_id',
        [h.owner.orgId, eventId, original.id],
      );
      expect(links.rows.map((row) => row.match_id).sort()).toEqual(
        first.matches.map((match) => match.id).sort(),
      );
      const teamEntries = first.schedule.source.entries.map((entry) => entry.entryId).sort();
      expect(Object.keys(original.team_keys).sort()).toEqual(teamEntries);
      expect(new Set(Object.values(original.team_keys)).size).toBe(teamEntries.length);
      const foreignKeys = await h.api.pool.query<{ definition: string }>(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public_match_links'::regclass AND contype='f' ORDER BY conname",
      );
      expect(foreignKeys.rows.map((row) => row.definition).sort()).toEqual(
        [
          'FOREIGN KEY (org_id, event_id, publication_id, schedule_publication_id) REFERENCES public_event_publications(org_id, event_id, id, schedule_publication_id)',
          'FOREIGN KEY (org_id, event_id, match_id) REFERENCES published_matches(org_id, event_id, id)',
          'FOREIGN KEY (org_id, schedule_publication_id, match_id) REFERENCES published_matches(org_id, publication_id, id)',
        ].sort(),
      );
      const beforeMutations = await fingerprint(h, eventId);
      for (const [sql, values] of [
        [
          'UPDATE public_match_links SET public_match_id=$4 WHERE org_id=$1 AND event_id=$2 AND publication_id=$3',
          [h.owner.orgId, eventId, original.id, randomBytes(32).toString('base64url')],
        ],
        [
          'DELETE FROM public_match_links WHERE org_id=$1 AND event_id=$2 AND publication_id=$3',
          [h.owner.orgId, eventId, original.id],
        ],
        [
          'UPDATE public_event_publications SET public_event_id=$3 WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, eventId, randomBytes(32).toString('base64url')],
        ],
        [
          'UPDATE public_event_publications SET team_keys=$3 WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, eventId, JSON.stringify({})],
        ],
        [
          'DELETE FROM public_event_publications WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, eventId],
        ],
      ] as const)
        await rejectedSql(h, '23514', async (client) => {
          await client.query(sql, [...values]);
        });
      await rejectedSql(h, '23514', async (client) => {
        await client.query(
          'INSERT INTO public_match_links(org_id,event_id,publication_id,schedule_publication_id,match_id,public_match_id) VALUES($1,$2,$3,$4,$5,$6)',
          [
            h.owner.orgId,
            eventId,
            original.id,
            original.schedule_publication_id,
            randomUUID(),
            randomBytes(32).toString('base64url'),
          ],
        );
      });
      expect(await fingerprint(h, eventId)).toEqual(beforeMutations);
      await disable(h, eventId);
      const afterRevocation = await fingerprint(h, eventId);
      for (const sql of [
        'UPDATE public_event_publications SET revoked_at=NULL,revoked_by=NULL WHERE org_id=$1 AND event_id=$2',
        "UPDATE public_event_publications SET revoked_at=revoked_at+interval '1 second' WHERE org_id=$1 AND event_id=$2",
        'DELETE FROM public_event_publications WHERE org_id=$1 AND event_id=$2',
      ])
        await rejectedSql(h, '23514', async (client) => {
          await client.query(sql, [h.owner.orgId, eventId]);
        });

      const newPublication = async (
        client: PoolClient,
        teamKeys = original.team_keys,
        scheduleId = original.schedule_publication_id,
      ) => {
        const id = randomUUID();
        await client.query(
          'INSERT INTO public_event_publications(id,org_id,event_id,schedule_publication_id,ruleset_id,public_event_id,team_keys,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            h.owner.orgId,
            eventId,
            scheduleId,
            original.ruleset_id,
            randomBytes(32).toString('base64url'),
            JSON.stringify(teamKeys),
            h.owner.id,
          ],
        );
        return id;
      };
      const copyLinks = async (
        client: PoolClient,
        publicationId: string,
        count = first.matches.length,
      ) => {
        for (const match of first.matches.slice(0, count))
          await client.query(
            'INSERT INTO public_match_links(org_id,event_id,publication_id,schedule_publication_id,match_id,public_match_id) VALUES($1,$2,$3,$4,$5,$6)',
            [
              h.owner.orgId,
              eventId,
              publicationId,
              original.schedule_publication_id,
              match.id,
              randomBytes(32).toString('base64url'),
            ],
          );
      };
      // Prove the SQL constructor itself satisfies every deferred guard before using it
      // as the baseline for deliberately incomplete or mismatched transactions.
      const valid = await h.api.pool.connect();
      try {
        await valid.query('BEGIN');
        await copyLinks(valid, await newPublication(valid));
        await valid.query('SET CONSTRAINTS ALL IMMEDIATE');
      } finally {
        try {
          await valid.query('ROLLBACK');
        } finally {
          valid.release();
        }
      }
      await rejectedSql(h, '23514', async (client) => {
        await newPublication(client);
      });
      await rejectedSql(h, '23514', async (client) => {
        await copyLinks(client, await newPublication(client), first.matches.length - 1);
      });
      const entries = Object.entries(original.team_keys);
      const malformedMaps = [
        Object.fromEntries(entries.slice(1)),
        { ...original.team_keys, [randomUUID()]: randomBytes(16).toString('base64url') },
        Object.fromEntries(
          entries.map(([entry], index) => [
            entry,
            index === 1 ? entries[0]![1] : original.team_keys[entry]!,
          ]),
        ),
        { ...original.team_keys, [entries[0]![0]]: 'not-a-public-team-key' },
      ];
      for (const invalid of malformedMaps)
        await rejectedSql(h, '23514', async (client) => {
          await copyLinks(client, await newPublication(client, invalid));
        });
      await rejectedSql(h, '23503', async (client) => {
        await newPublication(client, original.team_keys, second.matches[0]!.publicationId);
      });
      await rejectedSql(h, '23503', async (client) => {
        const publicationId = await newPublication(client);
        await client.query(
          'INSERT INTO public_match_links(org_id,event_id,publication_id,schedule_publication_id,match_id,public_match_id) VALUES($1,$2,$3,$4,$5,$6)',
          [
            h.owner.orgId,
            eventId,
            publicationId,
            original.schedule_publication_id,
            second.matches[0]!.id,
            randomBytes(32).toString('base64url'),
          ],
        );
      });
      expect(await fingerprint(h, eventId)).toEqual(afterRevocation);
      for (const response of await endpoints(h, key, rows[0]!.publicMatchId)) notFound(response);
    }, 45000);
  },
);

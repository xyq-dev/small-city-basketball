import { randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  OverlayCommandInput,
  OverlayCommandResponse,
  OverlaySnapshotData,
} from '@small-city-basketball/contracts';
import { hashToken } from '../src/security.js';
import {
  call,
  data,
  eventually,
  login,
  membership,
  staffPath as eventStaffPath,
} from './support.js';
import { start } from './p05-support.js';
import { anonymous, disable, enable, publicEventPath, savePublishRules } from './p05b-support.js';
import {
  acquire,
  act,
  APPLICATION_NAME,
  assign,
  blockedPid,
  bootstrap,
  closeHarness,
  confirmMatch,
  createScoringHarness,
  finish,
  issue,
  overlayCommand,
  overlayCommandsPath,
  overlayCookie,
  overlayData,
  overlaySnapshot,
  overlayWorkbench,
  overlayWorkbenchPath,
  prepare,
  published,
  reopen,
  revoke,
  rotate,
  withRowsLocked,
} from './p06-support.js';
import type { Harness, PublishedFixture } from './p06-support.js';

function rejected(response: Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error?.code).toBe(code);
  expect(response.body.error?.requestId).toEqual(expect.any(String));
  expect(Object.hasOwn(response.body, 'data')).toBe(false);
}

function credential(response: OverlayCommandResponse) {
  if (!response.credential)
    throw new Error('The successful synthetic command must issue a credential');
  expect(/^[A-Za-z0-9_-]{43}$/.test(response.credential.overlayId)).toBe(true);
  expect(/^[A-Za-z0-9_-]{43}$/.test(response.credential.token)).toBe(true);
  return response.credential;
}

async function rows(h: Harness, sql: string, values: unknown[]) {
  return (
    await h.api.pool.query<{ data: unknown }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS data FROM (${sql}) r`,
      values,
    )
  ).rows[0]!.data;
}

async function scoringFacts(h: Harness, eventId: string, matchId: string) {
  const facts: Record<string, unknown> = {};
  for (const table of [
    'published_matches',
    'scoring_states',
    'scoring_leases',
    'scoring_events',
    'scoring_commands',
    'result_confirmations',
  ]) {
    const key = table === 'published_matches' ? 'id' : 'match_id';
    facts[table] = await rows(
      h,
      `SELECT * FROM ${table} WHERE org_id=$1 AND event_id=$2 AND ${key}=$3`,
      [h.owner.orgId, eventId, matchId],
    );
  }
  facts.schedule = await rows(
    h,
    'SELECT * FROM schedule_publications WHERE org_id=$1 AND event_id=$2',
    [h.owner.orgId, eventId],
  );
  facts.mutex = await rows(h, 'SELECT * FROM org_schedule_mutex WHERE org_id=$1', [h.owner.orgId]);
  return facts;
}

async function authorizationFacts(h: Harness, eventId: string, matchId: string) {
  return {
    event: await rows(h, 'SELECT * FROM events WHERE org_id=$1 AND id=$2', [
      h.owner.orgId,
      eventId,
    ]),
    grants: await rows(
      h,
      'SELECT * FROM overlay_grants WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
      [h.owner.orgId, eventId, matchId],
    ),
    sessions: await rows(
      h,
      'SELECT * FROM overlay_sessions WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
      [h.owner.orgId, eventId, matchId],
    ),
    audit: await rows(h, 'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id=$2', [
      h.owner.orgId,
      matchId,
    ]),
    scoring: await scoringFacts(h, eventId, matchId),
  };
}

async function eventStaff(h: Harness, eventId: string, role: string, status = 'ACTIVE') {
  data(
    await call(h.api, 'put', eventStaffPath(h.owner.orgId, eventId, h.otherOwner.id), {
      cookie: h.owner.cookie,
      body: { role, status },
    }),
  );
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  const object = value as Record<string, unknown>;
  expect(Object.keys(object).sort()).toEqual([...keys].sort());
  return object;
}

function finite(value: unknown): void {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(finite);
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(finite);
}

function projection(value: unknown, snapshot = false): void {
  const preview = exact(value, [
    'eventName',
    'home',
    'away',
    'status',
    'matchVersion',
    'score',
    'totals',
    'periods',
    'rules',
    'clock',
    'collected',
    'resultStatus',
    'serverTime',
    ...(snapshot ? ['overlayId', 'template', 'expiresAt'] : []),
  ]);
  for (const side of ['home', 'away']) exact(preview[side], ['teamName']);
  if (preview.score !== null) exact(preview.score, ['home', 'away']);
  const total = (value: unknown) => exact(value, ['score', 'fouls', 'timeouts']);
  if (preview.totals !== null) {
    const totals = exact(preview.totals, ['home', 'away']);
    total(totals.home);
    total(totals.away);
  }
  if (preview.periods !== null) {
    expect(Array.isArray(preview.periods)).toBe(true);
    for (const period of preview.periods as unknown[]) {
      const item = exact(period, ['period', 'home', 'away']);
      total(item.home);
      total(item.away);
    }
  }
  if (preview.rules !== null)
    exact(preview.rules, [
      'regulationPeriods',
      'periodDurationSeconds',
      'allowedScoreValues',
      'tiePolicy',
      'overtimeDurationSeconds',
      'version',
    ]);
  if (preview.clock !== null)
    exact(preview.clock, ['period', 'remainingMs', 'running', 'anchorServerTime', 'clockVersion']);
  const collected = exact(preview.collected, [
    'teamScore',
    'teamFouls',
    'teamTimeouts',
    'playerStatistics',
  ]);
  expect(collected.playerStatistics).toBe(false);
  expect(typeof preview.eventName).toBe('string');
  expect(Number.isNaN(Date.parse(String(preview.serverTime)))).toBe(false);
  finite(value);
}

async function privateMarkers(h: Harness, fixture: PublishedFixture, secrets: string[]) {
  const markers = new Set(
    JSON.stringify([h.owner, h.otherOwner, h.leader, h.teams, fixture]).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    ) ?? [],
  );
  const actors = await h.api.pool.query(
    'SELECT display_name,email,password_hash FROM users WHERE id=ANY($1::uuid[])',
    [[h.owner.id, h.otherOwner.id, h.leader.id]],
  );
  for (const actor of actors.rows)
    for (const value of Object.values(actor)) markers.add(String(value));
  for (const table of [
    'overlay_grants',
    'overlay_sessions',
    'scoring_leases',
    'scoring_events',
    'scoring_commands',
    'result_confirmations',
  ]) {
    const values = await h.api.pool.query(
      `SELECT * FROM ${table} WHERE org_id=$1 AND event_id=$2`,
      [h.owner.orgId, fixture.event.event.id],
    );
    for (const id of JSON.stringify(values.rows).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    ) ?? [])
      markers.add(id);
  }
  for (const team of h.teams) for (const member of team.members) markers.add(member.name);
  for (const secret of [...secrets, h.owner.cookie, h.otherOwner.cookie, h.leader.cookie])
    markers.add(secret);
  return [...markers];
}

describe(
  'P06 independent overlay grants, projection and management on PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('only actual event managers and streamers can manage grants; global and match-only roles cannot acquire event authority', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id,
        matchId = fixture.matches[0]!.id;
      await membership(h.api, h.owner, h.otherOwner, 'STREAMER');
      try {
        const body: OverlayCommandInput = {
          type: 'ISSUE',
          expectedEventVersion: fixture.event.event.version,
          expiresInMinutes: 60,
        };
        rejected(
          await call(h.api, 'get', overlayWorkbenchPath(h.owner.orgId, matchId), {
            cookie: h.otherOwner.cookie,
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
        rejected(await overlayCommand(h, matchId, body, h.otherOwner), 404, 'RESOURCE_NOT_FOUND');
        await assign(h, matchId, h.otherOwner);
        rejected(
          await call(h.api, 'get', overlayWorkbenchPath(h.owner.orgId, matchId), {
            cookie: h.otherOwner.cookie,
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
        rejected(
          await call(h.api, 'get', overlayWorkbenchPath(h.owner.orgId, matchId), {
            cookie: h.leader.cookie,
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
        rejected(
          await call(h.api, 'get', overlayWorkbenchPath(h.otherOwner.orgId, matchId), {
            cookie: h.otherOwner.cookie,
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
        await eventStaff(h, eventId, 'REVIEWER');
        const reader = await overlayWorkbench(h, matchId, h.otherOwner);
        expect(reader.capabilities).toEqual({
          canIssue: false,
          canRotate: false,
          canRevoke: false,
        });
        rejected(
          await overlayCommand(
            h,
            matchId,
            { ...body, expectedEventVersion: reader.event.version },
            h.otherOwner,
          ),
          403,
          'FORBIDDEN',
        );
        await eventStaff(h, eventId, 'STREAMER');
        const issued = await issue(h, matchId, 60, h.otherOwner);
        const oneTime = credential(issued);
        const management = await overlayWorkbench(h, matchId);
        expect(Object.hasOwn(management, 'credential')).toBe(false);
        expect(JSON.stringify(management).includes(oneTime.token)).toBe(false);
        expect(management.currentGrant!.overlayId === oneTime.overlayId).toBe(true);
        await eventStaff(h, eventId, 'STREAMER', 'DISABLED');
        rejected(
          await call(h.api, 'get', overlayWorkbenchPath(h.owner.orgId, matchId), {
            cookie: h.otherOwner.cookie,
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
        rejected(
          await overlayCommand(
            h,
            matchId,
            {
              type: 'REVOKE',
              expectedEventVersion: management.event.version,
              overlayId: oneTime.overlayId,
              expectedGrantVersion: 1,
              reason: '已失去实际赛事角色',
            },
            h.otherOwner,
          ),
          404,
          'RESOURCE_NOT_FOUND',
        );
        expect((await overlayWorkbench(h, matchId)).currentGrant!.version).toBe(1);
      } finally {
        await membership(h.api, h.owner, h.otherOwner, 'EVENT_MANAGER');
      }
    });

    test('command schemas, Origin, TTL, grant scope and both CAS values are validated without any side effects', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id,
        matchId = fixture.matches[0]!.id;
      const initial = await overlayWorkbench(h, matchId);
      const beforeInvalid = await authorizationFacts(h, eventId, matchId);
      const issueBody = {
        type: 'ISSUE',
        expectedEventVersion: initial.event.version,
        expiresInMinutes: 60,
      };
      for (const body of [
        { type: 'ISSUE', expectedEventVersion: initial.event.version },
        ...[0, 10081, 1.5, '60', null].map((expiresInMinutes) => ({
          ...issueBody,
          expiresInMinutes,
        })),
        ...[
          { actorId: h.owner.id },
          { orgId: h.otherOwner.orgId },
          { overlayId: randomBytes(32).toString('base64url') },
          { expectedGrantVersion: 1 },
          { reason: '多余字段' },
          { template: 'SCOREBAR_1080P_V1' },
        ].map((extra) => ({ ...issueBody, ...extra })),
      ])
        rejected(
          await call(h.api, 'post', overlayCommandsPath(h.owner.orgId, matchId), {
            cookie: h.owner.cookie,
            body,
          }),
          422,
          'VALIDATION_ERROR',
        );
      for (const origin of [null, 'https://malicious.example.test'])
        rejected(
          await call(h.api, 'post', overlayCommandsPath(h.owner.orgId, matchId), {
            cookie: h.owner.cookie,
            body: issueBody,
            origin,
          }),
          403,
          'ORIGIN_REJECTED',
        );
      expect(await authorizationFacts(h, eventId, matchId)).toEqual(beforeInvalid);
      const issued = await issue(h, matchId, 1);
      const current = issued.currentGrant!;
      const other = await issue(h, fixture.matches[1]!.id, 10080);
      const fresh = await overlayWorkbench(h, matchId);
      const rotateBody = {
        type: 'ROTATE',
        expectedEventVersion: fresh.event.version,
        overlayId: current.overlayId,
        expectedGrantVersion: current.version,
        expiresInMinutes: 60,
        reason: '合法理由',
      };
      const baseline = await authorizationFacts(h, eventId, matchId);
      for (const body of [
        { ...rotateBody, reason: '' },
        { ...rotateBody, reason: '   ' },
        { ...rotateBody, reason: '理'.repeat(201) },
        { ...rotateBody, expiresInMinutes: 0 },
        { ...rotateBody, actorId: h.owner.id },
        {
          type: 'REVOKE',
          expectedEventVersion: fresh.event.version,
          overlayId: current.overlayId,
          expectedGrantVersion: 1,
          reason: '撤权',
          expiresInMinutes: 60,
        },
      ])
        rejected(
          await call(h.api, 'post', overlayCommandsPath(h.owner.orgId, matchId), {
            cookie: h.owner.cookie,
            body,
          }),
          422,
          'VALIDATION_ERROR',
        );
      rejected(
        await overlayCommand(h, matchId, {
          ...rotateBody,
          type: 'ROTATE',
          expectedEventVersion: fresh.event.version - 1,
        }),
        409,
        'VERSION_CONFLICT',
      );
      rejected(
        await overlayCommand(h, matchId, {
          ...rotateBody,
          type: 'ROTATE',
          expectedGrantVersion: 2,
        }),
        409,
        'OVERLAY_GRANT_VERSION_CONFLICT',
      );
      for (const overlayId of [
        other.currentGrant!.overlayId,
        randomBytes(32).toString('base64url'),
      ])
        rejected(
          await overlayCommand(h, matchId, {
            type: 'REVOKE',
            expectedEventVersion: fresh.event.version,
            overlayId,
            expectedGrantVersion: 1,
            reason: '不属于本场',
          }),
          404,
          'RESOURCE_NOT_FOUND',
        );
      expect(await authorizationFacts(h, eventId, matchId)).toEqual(baseline);
    });

    test('concurrent ISSUE has one winner; rotation permanently retires credentials and bounded history never deletes records', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id,
        matchId = fixture.matches[0]!.id;
      const originalScoring = await scoringFacts(h, eventId, matchId);
      const initial = await overlayWorkbench(h, matchId);
      const body: OverlayCommandInput = {
        type: 'ISSUE',
        expectedEventVersion: initial.event.version,
        expiresInMinutes: 60,
      };
      let responses: Response[] = [];
      await withRowsLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, eventId],
        1,
        async (pid, unlock, track) => {
          const first = track(overlayCommand(h, matchId, body));
          const firstPid = await blockedPid(
            h.api.pool,
            pid,
            'The overlay issuer did not wait for Event',
          );
          const second = track(overlayCommand(h, matchId, body));
          await eventually(
            async () =>
              (
                await h.api.pool.query<{ pid: number }>(
                  'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>$3::int AND ($2::int=ANY(pg_blocking_pids(pid)) OR $3::int=ANY(pg_blocking_pids(pid)))',
                  [APPLICATION_NAME, pid, firstPid],
                )
              ).rows,
            (waiting) => waiting.length === 1,
            'The second issuer did not enter the Event lock queue',
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
      let current = overlayData<OverlayCommandResponse>(
        responses.find((response) => response.status === 200)!,
      );
      const firstCredential = credential(current);
      const firstCookie = overlayCookie(
        await bootstrap(h, firstCredential.overlayId, firstCredential.token),
      );
      const metadata = await overlayWorkbench(h, matchId);
      expect(Object.hasOwn(metadata, 'credential')).toBe(false);
      rejected(
        await overlayCommand(h, matchId, {
          type: 'ISSUE',
          expectedEventVersion: metadata.event.version,
          expiresInMinutes: 60,
        }),
        409,
        'OVERLAY_ALREADY_ISSUED',
      );
      current = await rotate(h, matchId, 60, '理'.repeat(200));
      expect(credential(current).overlayId !== firstCredential.overlayId).toBe(true);
      expect(credential(current).token !== firstCredential.token).toBe(true);
      rejected(
        await bootstrap(h, firstCredential.overlayId, firstCredential.token),
        404,
        'RESOURCE_NOT_FOUND',
      );
      rejected(
        await overlaySnapshot(h, firstCredential.overlayId, firstCookie),
        404,
        'RESOURCE_NOT_FOUND',
      );
      rejected(
        await overlayCommand(h, matchId, {
          type: 'REVOKE',
          expectedEventVersion: current.event.version,
          overlayId: firstCredential.overlayId,
          expectedGrantVersion: 2,
          reason: '旧身份不能再操作',
        }),
        409,
        'OVERLAY_GRANT_NOT_CURRENT',
      );
      for (let index = 0; index < 21; index++)
        current = await rotate(h, matchId, 60, `历史轮换 ${index}`);
      const bounded = await overlayWorkbench(h, matchId);
      expect(bounded.historyLimit).toBe(20);
      expect(bounded.historyTruncated).toBe(true);
      expect(bounded.history).toHaveLength(20);
      expect(bounded.currentGrant!.version).toBe(1);
      expect(
        bounded.history.every(
          (grant) =>
            grant.status === 'REVOKED' &&
            grant.version === 2 &&
            grant.overlayId !== bounded.currentGrant!.overlayId,
        ),
      ).toBe(true);
      const stored = await h.api.pool.query<{
        overlay_id: string;
        version: number;
        secret_hash: string;
      }>(
        'SELECT overlay_id,version,secret_hash FROM overlay_grants WHERE org_id=$1 AND match_id=$2 ORDER BY created_at DESC,overlay_id DESC',
        [h.owner.orgId, matchId],
      );
      expect(stored.rowCount).toBe(23);
      expect(bounded.history.map((grant) => grant.overlayId)).toEqual(
        stored.rows.slice(1, 21).map((row) => row.overlay_id),
      );
      expect(stored.rows.every((row) => /^[0-9a-f]{64}$/.test(row.secret_hash))).toBe(true);
      expect(
        stored.rows.find((row) => row.overlay_id === firstCredential.overlayId)!.secret_hash ===
          hashToken(firstCredential.token),
      ).toBe(true);
      const lastCredential = credential(current);
      const lastCookie = overlayCookie(
        await bootstrap(h, lastCredential.overlayId, lastCredential.token),
      );
      const revoked = await revoke(h, matchId);
      expect(revoked.credential).toBeNull();
      expect(revoked.currentGrant).toBeNull();
      expect(revoked.historyLimit).toBe(20);
      expect(revoked.historyTruncated).toBe(true);
      rejected(
        await overlaySnapshot(h, lastCredential.overlayId, lastCookie),
        404,
        'RESOURCE_NOT_FOUND',
      );
      rejected(
        await bootstrap(h, lastCredential.overlayId, lastCredential.token),
        404,
        'RESOURCE_NOT_FOUND',
      );
      expect(
        (
          await h.api.pool.query('SELECT id FROM overlay_grants WHERE org_id=$1 AND match_id=$2', [
            h.owner.orgId,
            matchId,
          ])
        ).rowCount,
      ).toBe(23);
      expect(await scoringFacts(h, eventId, matchId)).toEqual(originalScoring);
    }, 60000);

    test('an expired unrevoked grant is visible as current and ISSUE atomically supersedes it without reviving its old session', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id,
        matchId = fixture.matches[0]!.id;
      const grantId = randomUUID(),
        overlayId = randomBytes(32).toString('base64url'),
        token = randomBytes(32).toString('base64url'),
        sessionToken = randomBytes(32).toString('base64url');
      await h.api.pool.query(
        `WITH t AS (SELECT clock_timestamp()-interval '1 minute' AS expires) INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,t.expires-interval '1 minute',t.expires FROM t`,
        [grantId, h.owner.orgId, eventId, matchId, overlayId, hashToken(token), h.owner.id],
      );
      await h.api.pool.query(
        `INSERT INTO overlay_sessions(id,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at) SELECT $1,org_id,event_id,match_id,id,$2,created_at+interval '1 second',expires_at FROM overlay_grants WHERE id=$3`,
        [randomUUID(), hashToken(sessionToken), grantId],
      );
      const current = await overlayWorkbench(h, matchId);
      expect(current.currentGrant).toMatchObject({ overlayId, status: 'EXPIRED', version: 1 });
      expect(current.history).toEqual([]);
      rejected(await bootstrap(h, overlayId, token), 404, 'RESOURCE_NOT_FOUND');
      rejected(
        await overlaySnapshot(h, overlayId, `scb.overlay=${sessionToken}`),
        404,
        'RESOURCE_NOT_FOUND',
      );
      const next = await issue(h, matchId);
      expect(next.event.version).toBe(current.event.version + 1);
      expect(next.currentGrant!.overlayId !== overlayId).toBe(true);
      expect(next.history).toHaveLength(1);
      expect(next.history[0]).toMatchObject({
        overlayId,
        status: 'REVOKED',
        version: 2,
        expiresAt: current.currentGrant!.expiresAt,
        revocationReason: 'SUPERSEDED_AFTER_EXPIRY',
      });
      rejected(await bootstrap(h, overlayId, token), 404, 'RESOURCE_NOT_FOUND');
      rejected(
        await overlaySnapshot(h, overlayId, `scb.overlay=${sessionToken}`),
        404,
        'RESOURCE_NOT_FOUND',
      );
      const audits = await h.api.pool.query<{ action: string }>(
        "SELECT action FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action LIKE 'OVERLAY_%'",
        [h.owner.orgId, matchId],
      );
      expect(audits.rows).toEqual([{ action: 'OVERLAY_ISSUE' }]);
    });

    test('grants survive issuer logout and personal revocation while public viewing and organization availability remain independent', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id,
        matchId = fixture.matches[0]!.id;
      await eventStaff(h, eventId, 'STREAMER');
      const issued = await issue(h, matchId, 60, h.otherOwner);
      const key = credential(issued);
      const cookie = overlayCookie(await bootstrap(h, key.overlayId, key.token));
      expect(
        (
          await h.api.pool.query(
            'SELECT id FROM standings_rulesets WHERE org_id=$1 AND event_id=$2',
            [h.owner.orgId, eventId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await h.api.pool.query(
            'SELECT id FROM public_event_publications WHERE org_id=$1 AND event_id=$2',
            [h.owner.orgId, eventId],
          )
        ).rowCount,
      ).toBe(0);
      data<OverlaySnapshotData>(await overlaySnapshot(h, key.overlayId, cookie));
      try {
        data(
          await call(h.api, 'post', '/v1/auth/logout', { cookie: h.otherOwner.cookie, body: {} }),
        );
        await eventStaff(h, eventId, 'STREAMER', 'DISABLED');
        await membership(h.api, h.owner, h.otherOwner, 'EVENT_MANAGER', 'DISABLED');
        data<OverlaySnapshotData>(await overlaySnapshot(h, key.overlayId, cookie));
        await savePublishRules(h, eventId);
        const publicOne = (await enable(h, eventId)).publication!.publicEventId;
        data(await anonymous(h, publicEventPath(publicOne)));
        await disable(h, eventId);
        rejected(await anonymous(h, publicEventPath(publicOne)), 404, 'RESOURCE_NOT_FOUND');
        data(await overlaySnapshot(h, key.overlayId, cookie));
        const publicTwo = (await enable(h, eventId)).publication!.publicEventId;
        await h.api.pool.query("UPDATE organizations SET status='DISABLED' WHERE id=$1", [
          h.owner.orgId,
        ]);
        rejected(await overlaySnapshot(h, key.overlayId, cookie), 404, 'RESOURCE_NOT_FOUND');
        rejected(await bootstrap(h, key.overlayId, key.token), 404, 'RESOURCE_NOT_FOUND');
        await h.api.pool.query("UPDATE organizations SET status='ACTIVE' WHERE id=$1", [
          h.owner.orgId,
        ]);
        const recovered = data<OverlaySnapshotData>(
          await overlaySnapshot(h, key.overlayId, cookie),
        );
        expect(recovered.expiresAt).toBe(issued.currentGrant!.expiresAt);
        await revoke(h, matchId);
        rejected(await overlaySnapshot(h, key.overlayId, cookie), 404, 'RESOURCE_NOT_FOUND');
        data(await anonymous(h, publicEventPath(publicTwo)));
      } finally {
        await h.api.pool.query("UPDATE organizations SET status='ACTIVE' WHERE id=$1", [
          h.owner.orgId,
        ]);
        await membership(h.api, h.owner, h.otherOwner, 'EVENT_MANAGER');
        h.otherOwner.cookie = await login(h.api, h.otherOwner);
      }
    });

    test('ISSUE, ROTATE and REVOKE audit failure rolls back the entire authorization change without touching scoring facts', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id,
        matchId = fixture.matches[0]!.id;
      const originalScoring = await scoringFacts(h, eventId, matchId);
      let prior: { overlayId: string; token: string; cookie: string } | undefined;
      for (const type of ['ISSUE', 'ROTATE', 'REVOKE'] as const) {
        const current = await overlayWorkbench(h, matchId);
        const input: OverlayCommandInput =
          type === 'ISSUE'
            ? { type, expectedEventVersion: current.event.version, expiresInMinutes: 60 }
            : type === 'ROTATE'
              ? {
                  type,
                  expectedEventVersion: current.event.version,
                  overlayId: current.currentGrant!.overlayId,
                  expectedGrantVersion: current.currentGrant!.version,
                  expiresInMinutes: 60,
                  reason: '故障后相同CAS重试',
                }
              : {
                  type,
                  expectedEventVersion: current.event.version,
                  overlayId: current.currentGrant!.overlayId,
                  expectedGrantVersion: current.currentGrant!.version,
                  reason: '故障后相同CAS重试',
                };
        const before = await authorizationFacts(h, eventId, matchId);
        const identifier = `scb_p06_audit_${randomUUID().replaceAll('-', '')}`;
        for (const id of [h.owner.orgId, matchId]) expect(/^[0-9a-f-]{36}$/.test(id)).toBe(true);
        await h.api.pool.query(
          `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.resource_id::text=TG_ARGV[1] AND NEW.action IN ('OVERLAY_ISSUE','OVERLAY_ROTATE','OVERLAY_REVOKE') THEN RAISE EXCEPTION 'p06 synthetic audit failure'; END IF; RETURN NEW; END $$`,
        );
        try {
          await h.api.pool.query(
            `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${matchId}')`,
          );
          const response = await overlayCommand(h, matchId, input);
          expect(response.status).toBe(500);
          expect(response.body.error?.requestId).toEqual(expect.any(String));
          expect(
            /p06 synthetic|audit_logs|SQLSTATE|postgres/i.test(JSON.stringify(response.body)),
          ).toBe(false);
          expect(await authorizationFacts(h, eventId, matchId)).toEqual(before);
          if (prior) data(await overlaySnapshot(h, prior.overlayId, prior.cookie));
        } finally {
          try {
            await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
          } finally {
            await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
          }
        }
        const retried = overlayData<OverlayCommandResponse>(
          await overlayCommand(h, matchId, input),
        );
        expect(retried.event.version).toBe(current.event.version + 1);
        if (prior)
          rejected(
            await overlaySnapshot(h, prior.overlayId, prior.cookie),
            404,
            'RESOURCE_NOT_FOUND',
          );
        if (type !== 'REVOKE') {
          const key = credential(retried);
          prior = { ...key, cookie: overlayCookie(await bootstrap(h, key.overlayId, key.token)) };
        } else expect(retried.credential).toBeNull();
      }
      expect(await scoringFacts(h, eventId, matchId)).toEqual(originalScoring);
      const audits = await h.api.pool.query<{ action: string; metadata: unknown }>(
        "SELECT action,metadata FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action LIKE 'OVERLAY_%' ORDER BY created_at,id",
        [h.owner.orgId, matchId],
      );
      expect(audits.rows.map((row) => row.action)).toEqual([
        'OVERLAY_ISSUE',
        'OVERLAY_ROTATE',
        'OVERLAY_REVOKE',
      ]);
      if (prior) expect(JSON.stringify(audits.rows).includes(prior.token)).toBe(false);
    });

    test('the finite independent projection tracks real scoring states without exposing private identities, staff, receipts or lease credentials', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const matchId = fixture.matches[0]!.id;
      const issued = await issue(h, matchId);
      const key = credential(issued),
        cookie = overlayCookie(await bootstrap(h, key.overlayId, key.token));
      const read = async () => {
        const response = await overlaySnapshot(h, key.overlayId, cookie);
        const value = data<OverlaySnapshotData>(response);
        projection(value, true);
        exact(response.body, ['data', 'meta']);
        exact(response.body.meta, ['requestId']);
        expect(response.headers['set-cookie']).toBeUndefined();
        const serialized = JSON.stringify(value);
        for (const marker of await privateMarkers(h, fixture, [
          key.token,
          cookie,
          cookie.slice('scb.overlay='.length),
        ]))
          expect(serialized.includes(marker)).toBe(false);
        const management = await overlayWorkbench(h, matchId);
        projection(management.preview);
        return value;
      };
      expect(await read()).toMatchObject({
        status: 'SCHEDULED',
        score: null,
        totals: null,
        periods: null,
        rules: null,
        clock: null,
        collected: {
          teamScore: false,
          teamFouls: false,
          teamTimeouts: false,
          playerStatistics: false,
        },
      });
      await assign(h, matchId, h.otherOwner);
      await prepare(h, matchId);
      expect(await read()).toMatchObject({
        status: 'READY',
        score: { home: 0, away: 0 },
        clock: { running: false },
        collected: { teamScore: true, teamFouls: true, teamTimeouts: true },
      });
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      for (const payload of [
        { kind: 'SCORE', side: 'HOME', value: 2 },
        { kind: 'FOUL', side: 'AWAY', value: 1 },
        { kind: 'TIMEOUT', side: 'HOME', value: 1 },
      ] as const)
        await act(h, matchId, h.otherOwner, { type: 'RECORD_STAT', payload }, lease);
      await act(h, matchId, h.otherOwner, { type: 'CLOCK_START', payload: {} }, lease);
      expect(await read()).toMatchObject({
        status: 'LIVE',
        score: { home: 2, away: 0 },
        totals: { home: { timeouts: 1 }, away: { fouls: 1 } },
        clock: { running: true },
      });
      await act(h, matchId, h.otherOwner, { type: 'CLOCK_PAUSE', payload: {} }, lease);
      await finish(h, matchId, h.otherOwner, lease);
      expect(await read()).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        resultStatus: 'UNCONFIRMED',
        clock: { running: false, remainingMs: 0 },
      });
      await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const final = await read();
      expect(final).toMatchObject({
        status: 'FINAL',
        resultStatus: 'CONFIRMED',
        score: { home: 2, away: 0 },
      });
      await assign(h, matchId, h.otherOwner, 'SCORER', 'DISABLED');
      const metadata = await read();
      expect(metadata.matchVersion).toBe(final.matchVersion + 1);
      expect(metadata.resultStatus).toBe('CONFIRMED');
      expect(metadata.totals).toEqual(final.totals);
      await reopen(h, matchId);
      expect(await read()).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        resultStatus: 'REQUIRES_RECONFIRMATION',
        score: { home: 2, away: 0 },
      });
    });

    test('bad FINAL proof returns a private-free 409 snapshot while fresh management metadata and every authorization command remain available', async () => {
      const fixture = await published(h, h.teams.slice(0, 2), { regulationPeriods: 2 });
      const eventId = fixture.event.event.id;
      const match = await confirmMatch(h, fixture, 0, 2, 1);
      const oldId = match.confirmed.snapshot.latestConfirmation!.id;
      await reopen(h, match.matchId);
      const reconfirmed = await act(h, match.matchId, h.owner, {
        type: 'CONFIRM_RESULT',
        payload: {},
      });
      const currentId = reconfirmed.snapshot.latestConfirmation!.id;
      const originalScoring = await scoringFacts(h, eventId, match.matchId);
      let active: { overlayId: string; token: string; cookie: string } | undefined;
      try {
        await h.api.pool.query(
          'UPDATE scoring_states SET home_score=home_score+1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId],
        );
        const work = await overlayWorkbench(h, match.matchId);
        expect(work.preview).toBeNull();
        expect(work.previewError?.code).toBe('RESULT_SOURCE_INVALID');
        const first = await issue(h, match.matchId);
        expect(first.preview).toBeNull();
        expect(first.previewError?.code).toBe('RESULT_SOURCE_INVALID');
        const firstKey = credential(first),
          firstCookie = overlayCookie(await bootstrap(h, firstKey.overlayId, firstKey.token));
        rejected(
          await overlaySnapshot(h, firstKey.overlayId, firstCookie),
          409,
          'RESULT_SOURCE_INVALID',
        );
        const second = await rotate(h, match.matchId);
        expect(second.previewError?.code).toBe('RESULT_SOURCE_INVALID');
        rejected(
          await overlaySnapshot(h, firstKey.overlayId, firstCookie),
          404,
          'RESOURCE_NOT_FOUND',
        );
        const revoked = await revoke(h, match.matchId);
        expect(revoked.currentGrant).toBeNull();
        expect(revoked.previewError?.code).toBe('RESULT_SOURCE_INVALID');
        const third = await issue(h, match.matchId);
        const key = credential(third);
        active = { ...key, cookie: overlayCookie(await bootstrap(h, key.overlayId, key.token)) };
      } finally {
        await h.api.pool.query(
          'UPDATE scoring_states SET home_score=2 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, match.matchId],
        );
      }
      if (!active) throw new Error('Expected the last synthetic overlay credential');
      const variants = [
        {
          sql: 'latest_confirmation_id=NULL',
          restore: 'latest_confirmation_id=$3::uuid',
          value: currentId,
        },
        {
          sql: 'latest_confirmation_id=$3::uuid',
          parameters: [oldId],
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
      for (const variant of variants) {
        try {
          await h.api.pool.query(
            `UPDATE scoring_states SET ${variant.sql} WHERE org_id=$1 AND match_id=$2`,
            [h.owner.orgId, match.matchId, ...(variant.parameters ?? [])],
          );
          const management = await overlayWorkbench(h, match.matchId);
          expect(management.preview).toBeNull();
          expect(management.previewError?.code).toBe('RESULT_SOURCE_INVALID');
          const failed = await overlaySnapshot(h, active.overlayId, active.cookie);
          rejected(failed, 409, 'RESULT_SOURCE_INVALID');
          expect(Object.hasOwn(failed.body.error, 'details')).toBe(false);
          const serialized = JSON.stringify(failed.body);
          for (const marker of [
            h.owner.orgId,
            eventId,
            match.matchId,
            currentId,
            oldId,
            active.token,
            active.cookie,
          ])
            expect(serialized.includes(marker)).toBe(false);
        } finally {
          await h.api.pool.query(
            `UPDATE scoring_states SET ${variant.restore} WHERE org_id=$1 AND match_id=$2`,
            [h.owner.orgId, match.matchId, variant.value],
          );
        }
        expect(
          data<OverlaySnapshotData>(await overlaySnapshot(h, active.overlayId, active.cookie))
            .resultStatus,
        ).toBe('CONFIRMED');
      }
      expect(await scoringFacts(h, eventId, match.matchId)).toEqual(originalScoring);
    });
  },
);

import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applyRuntimePrivileges, loadManifest } from '../../../ops/db/privileges.mjs';
import { createApi } from '../src/app.js';
import { bootstrapOwner } from '../src/bootstrap-owner.js';
import { assertRuntimeReadiness } from '../src/readiness.js';
import { hashPassword, verifyPassword } from '../src/security.js';
import { call, data, eventually, login, PASSWORD } from './support.js';
import type { User } from './support.js';
import { createOwnedRestoreDatabase, p07DatabaseUrls } from './p07-support.js';
import { participant, team } from './p03-support.js';
import { published } from './p05-support.js';
import type { Harness } from './p05-support.js';
import { enable, savePublishRules, viewingCommand } from './p05b-support.js';
import { syntheticPng } from './media-fixtures.js';
import type {
  MatchMediaData,
  MediaFileReceiptData,
  UploadSessionData,
} from '@small-city-basketball/contracts';

type Target = Awaited<ReturnType<typeof createOwnedRestoreDatabase>>;
const input = () => ({
  email: `p07-owner-${randomUUID()}@example.test`,
  password: PASSWORD,
  displayName: '隔离初始化负责人',
  organizationName: '隔离初始化机构',
});

async function rolePool(target: Target, role: 'runtime' | 'backup') {
  const urls = await p07DatabaseUrls();
  const url = new URL(urls[role]);
  url.pathname = `/${target.ownership.databaseName}`;
  return new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
}

async function counts(pool: Pool) {
  return (
    await pool.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM organization_memberships) AS memberships,
      (SELECT count(*)::int FROM sessions) AS sessions,
      (SELECT count(*)::int FROM audit_logs) AS audits`)
  ).rows[0];
}

async function withTarget(action: (target: Target) => Promise<void>) {
  const target = await createOwnedRestoreDatabase();
  try {
    await action(target);
  } finally {
    await target.close();
  }
}

describe('P07 real PostgreSQL first-owner initialization', () => {
  test('owned cleanup waits for remaining client sockets instead of force-terminating them', async () => {
    const target = await createOwnedRestoreDatabase();
    const lingering = await rolePool(target, 'runtime');
    const urls = await p07DatabaseUrls();
    const control = new Pool({
      connectionString: urls.admin.toString(),
      connectionTimeoutMillis: 5000,
    });
    let closing: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    let finished = false;
    try {
      try {
        await lingering.query('SELECT 1');
        closing = target.close().then(
          () => {
            finished = true;
            return { ok: true };
          },
          (error: unknown) => {
            finished = true;
            return { ok: false, error };
          },
        );
        await eventually(
          async () =>
            (
              await target.adminPool.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM pg_stat_activity
               WHERE datname=$1 AND backend_type='client backend'`,
                [target.ownership.databaseName],
              )
            ).rows[0]!.n,
          (n) => n === 1,
          'Only the explicitly held client must remain while owned cleanup drains',
          3000,
        );
        expect(finished).toBe(false);
        expect((await lingering.query('SELECT 42 AS value')).rows).toEqual([{ value: 42 }]);
      } finally {
        await lingering.end();
        if (closing) {
          const result = await closing;
          if (!result.ok) throw result.error;
        } else await target.close();
      }
      expect(
        (
          await control.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            target.ownership.databaseName,
          ])
        ).rowCount,
      ).toBe(0);
      expect((await control.query('SELECT current_database() AS name')).rows[0]!.name).toMatch(
        /^scb_test_production_/,
      );
    } finally {
      await control.end();
    }
  });

  test('owned cleanup rejects a leaked client without terminating it or removing the control database', async () => {
    const target = await createOwnedRestoreDatabase();
    const lingering = await rolePool(target, 'runtime');
    const urls = await p07DatabaseUrls();
    const control = new Pool({
      connectionString: urls.admin.toString(),
      connectionTimeoutMillis: 5000,
    });
    let closingStarted = false;
    try {
      await lingering.query('SELECT 1');
      closingStarted = true;
      await expect(target.close()).rejects.toThrow(
        'Refused P07 cleanup because restore target connections remain',
      );
      expect((await lingering.query('SELECT 42 AS value')).rows).toEqual([{ value: 42 }]);
      expect(
        (
          await control.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            target.ownership.databaseName,
          ])
        ).rowCount,
      ).toBe(1);
      expect((await control.query('SELECT current_database() AS name')).rows[0]!.name).toMatch(
        /^scb_test_production_/,
      );
    } finally {
      await lingering.end();
      try {
        if (!closingStarted) await target.close();
        else {
          await eventually(
            async () =>
              (
                await control.query<{ n: number }>(
                  `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname=$1 AND backend_type='client backend'`,
                  [target.ownership.databaseName],
                )
              ).rows[0]!.n,
            (n) => n === 0,
            'Explicitly held client must disconnect before owned negative-test cleanup',
            5000,
          );
          const owned = (
            await control.query<{ oid: number; comment: string }>(
              "SELECT oid::int AS oid,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
              [target.ownership.databaseName],
            )
          ).rows[0];
          if (
            owned?.oid !== target.ownership.databaseOid ||
            owned.comment !== `scb_restore_owner:${target.ownership.nonce}`
          )
            throw new Error(
              'Refused negative-test cleanup because restore target ownership changed',
            );
          await control.query(`DROP DATABASE "${target.ownership.databaseName}"`);
          expect(
            (
              await control.query('SELECT 1 FROM pg_database WHERE datname=$1', [
                target.ownership.databaseName,
              ])
            ).rowCount,
          ).toBe(0);
        }
      } finally {
        await control.end();
      }
    }
  });

  test('two actually blocked initializers create exactly one owner and no HTTP session', async () => {
    await withTarget(async (target) => {
      const blocker = await target.pool.connect();
      const attempts: ReturnType<typeof bootstrapOwner>[] = [];
      let outcomes: PromiseSettledResult<Awaited<ReturnType<typeof bootstrapOwner>>>[] = [];
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE users,organizations IN ACCESS EXCLUSIVE MODE');
        attempts.push(bootstrapOwner(target.pool, input()), bootstrapOwner(target.pool, input()));
        // Observe real lock contention; a pair of promises alone can serialize
        // during password calculation without ever exercising the table mutex.
        await eventually(
          async () =>
            (
              await target.adminPool.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM pg_stat_activity
                 WHERE datname=$1 AND wait_event_type='Lock'
                   AND query LIKE 'LOCK TABLE users,organizations IN SHARE ROW EXCLUSIVE MODE%'`,
                [target.ownership.databaseName],
              )
            ).rows[0]!.n,
          (n) => n === 2,
          'Both first-owner initializers must reach the PostgreSQL lock',
          15000,
        );
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        outcomes = await Promise.allSettled(attempts);
      }
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('BOOTSTRAP_NOT_EMPTY');
      expect(await counts(target.pool)).toEqual({
        users: 1,
        organizations: 1,
        memberships: 1,
        sessions: 0,
        audits: 1,
      });
      expect(
        (await target.pool.query('SELECT role,status FROM organization_memberships')).rows,
      ).toEqual([{ role: 'ORG_OWNER', status: 'ACTIVE' }]);
      expect((await target.pool.query('SELECT action FROM audit_logs')).rows).toEqual([
        { action: 'BOOTSTRAP_OWNER' },
      ]);
    });
  });

  test('an existing participant is never promoted or assigned a replacement password', async () => {
    await withTarget(async (target) => {
      const owner = input();
      const existing = await hashPassword('Existing synthetic participant password 2026');
      await target.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [randomUUID(), owner.email, '既有个人账号', existing],
      );
      await expect(bootstrapOwner(target.pool, owner)).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_EXISTS',
      });
      expect(await counts(target.pool)).toEqual({
        users: 1,
        organizations: 0,
        memberships: 0,
        sessions: 0,
        audits: 0,
      });
      const saved = (await target.pool.query('SELECT password_hash FROM users')).rows[0]!
        .password_hash as string;
      expect(saved === existing).toBe(true);
      expect(await verifyPassword(owner.password, saved)).toBe(false);
    });
  });

  test('a rejected initialization audit rolls back every newly created identity and membership', async () => {
    await withTarget(async (target) => {
      await target.pool.query(`CREATE FUNCTION p07_reject_owner_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.action='BOOTSTRAP_OWNER' THEN RAISE EXCEPTION 'Synthetic initialization audit rejection'; END IF;
          RETURN NEW; END; $$`);
      await target.pool.query(`CREATE TRIGGER p07_reject_owner_audit BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION p07_reject_owner_audit()`);
      await expect(bootstrapOwner(target.pool, input())).rejects.toThrow(
        'Unable to initialize the first owner',
      );
      expect(await counts(target.pool)).toEqual({
        users: 0,
        organizations: 0,
        memberships: 0,
        sessions: 0,
        audits: 0,
      });
    });
  });
});

describe('P07 real PostgreSQL audited runtime and backup identities', () => {
  let target: Target;
  let runtime: Pool;
  let backup: Pool;

  beforeAll(async () => {
    target = await createOwnedRestoreDatabase();
    runtime = await rolePool(target, 'runtime');
    backup = await rolePool(target, 'backup');
  });
  afterAll(async () => {
    await runtime?.end();
    await backup?.end();
    await target?.close();
  });

  test('accepts the exact manifest and denies DDL, TRUNCATE, TEMP, audit reads and role escalation', async () => {
    await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
    for (const sql of [
      'CREATE TABLE public.p07_forbidden(id int)',
      'CREATE TEMP TABLE p07_forbidden(id int)',
      'TRUNCATE public.events',
      'ALTER TABLE public.events ADD COLUMN p07_forbidden int',
      'SELECT * FROM public.audit_logs',
      'DELETE FROM public.users',
      'UPDATE public.events SET created_by=created_by',
      'UPDATE public.published_matches SET home_team_name=home_team_name',
      'UPDATE public.match_reschedules SET reason=reason',
      'DELETE FROM public.match_reschedules',
      'DELETE FROM public.court_reservations',
      'UPDATE public.team_reservations SET team_id=team_id',
      'UPDATE public.event_directory_listings SET region_id=region_id',
      'UPDATE public.event_directory_listings SET region_catalog_version=region_catalog_version',
      'UPDATE public.region_catalog_nodes SET name=name',
      'INSERT INTO public.region_catalog_nodes SELECT * FROM public.region_catalog_nodes LIMIT 1',
      'DELETE FROM public.region_catalog_versions',
      'TRUNCATE public.region_legacy_aliases',
      'SELECT region_id FROM public.region_catalog_nodes FOR SHARE',
      'SET ROLE scb_migrator',
      'CREATE ROLE p07_forbidden',
      'ALTER ROLE scb_runtime SUPERUSER',
    ]) {
      await expect(runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    // FOR SHARE requires UPDATE on at least one column. This succeeds on the
    // immutable session table because only id is granted for row locking.
    await expect(
      runtime.query('SELECT id FROM public.overlay_sessions FOR SHARE'),
    ).resolves.toMatchObject({
      rowCount: 0,
    });
    await expect(assertRuntimeReadiness(target.pool)).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  test('the backup identity reads every exact manifest table but cannot lock, write or change schema', async () => {
    const manifest = await loadManifest();
    for (const name of Object.keys(manifest.tables)) {
      await expect(backup.query(`SELECT 1 FROM public."${name}" LIMIT 1`)).resolves.toBeDefined();
    }
    for (const sql of [
      'SELECT id FROM public.overlay_sessions FOR SHARE',
      'SELECT region_id FROM public.region_catalog_nodes FOR SHARE',
      'UPDATE public.region_legacy_aliases SET label=label',
      'DELETE FROM public.region_catalog_nodes',
      "INSERT INTO public.auth_rate_limits(key,window_start,attempts) VALUES('p07-forbidden',clock_timestamp(),1)",
      'DELETE FROM public.auth_rate_limits',
      'CREATE TABLE public.p07_forbidden(id int)',
      'CREATE TEMP TABLE p07_forbidden(id int)',
      'SET ROLE scb_migrator',
    ]) {
      await expect(backup.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
  });

  test('only reviewed runtime helpers execute and PUBLIC, backup or trigger grants fail readiness', async () => {
    await expect(runtime.query('SELECT x12_calendar_lock()')).resolves.toBeDefined();
    await expect(runtime.query('SELECT x12_release_expired()')).resolves.toBeDefined();
    await expect(backup.query('SELECT x12_calendar_lock()')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query('SELECT x17_staff_receipt_immutable()')).rejects.toMatchObject({
      code: '42501',
    });
    for (const grant of [
      'GRANT EXECUTE ON FUNCTION x12_calendar_lock() TO PUBLIC',
      'GRANT EXECUTE ON FUNCTION x12_calendar_lock() TO scb_backup',
      'GRANT EXECUTE ON FUNCTION x17_staff_receipt_immutable() TO scb_runtime',
    ]) {
      try {
        await target.pool.query(grant);
        await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
        });
      } finally {
        await applyRuntimePrivileges(target.pool);
      }
      await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
    }
    for (const [table, column] of [
      ['event_template_versions', 'id'],
      ['recruitment_request_receipts', 'actor_id'],
      ['event_team_import_previews', 'id'],
      ['scoring_offline_intents', 'intent_id'],
      ['public_archive_operations', 'actor_id'],
      ['staff_configuration_receipts', 'id'],
    ]) {
      await expect(
        runtime.query(`SELECT "${column}" FROM public."${table}" FOR SHARE`),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query(`UPDATE public."${table}" SET "${column}"="${column}" WHERE false`),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  test('missing lock-column access and overbroad table grants fail readiness until exact reapplication', async () => {
    try {
      await target.pool.query('REVOKE UPDATE(id) ON public.overlay_sessions FROM scb_runtime');
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      await applyRuntimePrivileges(target.pool);
      await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
      await target.pool.query('GRANT UPDATE ON public.events TO scb_runtime');
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    } finally {
      await applyRuntimePrivileges(target.pool);
    }
    await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
  });

  test('a dangerous role attribute or owner-role membership closes runtime readiness', async () => {
    try {
      await target.adminPool.query('ALTER ROLE scb_runtime CREATEDB');
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    } finally {
      await target.adminPool.query('ALTER ROLE scb_runtime NOCREATEDB');
    }
    try {
      await target.adminPool.query('GRANT scb_migrator TO scb_runtime');
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    } finally {
      await target.adminPool.query('REVOKE scb_migrator FROM scb_runtime');
    }
    await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
  });

  test('missing, extra and drifted migration records all fail closed without repairing the database', async () => {
    const last = (
      await target.pool.query('SELECT * FROM schema_migrations ORDER BY name DESC LIMIT 1')
    ).rows[0]!;
    try {
      await target.pool.query('DELETE FROM schema_migrations WHERE name=$1', [last.name]);
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    } finally {
      await target.pool.query(
        'INSERT INTO schema_migrations(name,checksum,applied_at) VALUES($1,$2,$3)',
        [last.name, last.checksum, last.applied_at],
      );
    }
    try {
      await target.pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        '999_p07_unexpected.sql',
        'a'.repeat(64),
      ]);
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    } finally {
      await target.pool.query('DELETE FROM schema_migrations WHERE name=$1', [
        '999_p07_unexpected.sql',
      ]);
    }
    try {
      await target.pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', [
        '0'.repeat(64),
        last.name,
      ]);
      await expect(assertRuntimeReadiness(runtime)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(
        (
          await target.pool.query('SELECT checksum FROM schema_migrations WHERE name=$1', [
            last.name,
          ])
        ).rows[0]!.checksum,
      ).toBe('0'.repeat(64));
    } finally {
      await target.pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', [
        last.checksum,
        last.name,
      ]);
    }
    await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
  });

  test('the real readiness endpoint exposes only a fixed failure when runtime access drifts', async () => {
    const urls = await p07DatabaseUrls();
    const url = new URL(urls.runtime);
    url.pathname = `/${target.ownership.databaseName}`;
    const api = await createApi({
      databaseUrl: url.toString(),
      appOrigin: 'http://localhost:5173',
    });
    try {
      expect(data<{ status: string }>(await call(api, 'get', '/ready'))).toEqual({
        status: 'ready',
      });
      await target.pool.query('REVOKE SELECT ON public.events FROM scb_runtime');
      const response = await call(api, 'get', '/ready');
      expect(response.status).toBe(503);
      expect(response.body.error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: '服务尚未就绪',
      });
      expect(
        /scb_runtime|postgres(?:ql)?:|permission denied|SELECT|events/.test(
          JSON.stringify(response.body),
        ),
      ).toBe(false);
      // Basic liveness remains separate from full schema/privilege readiness.
      expect(data<{ status: string }>(await call(api, 'get', '/health'))).toEqual({ status: 'ok' });
    } finally {
      await applyRuntimePrivileges(target.pool);
      await api.app.close();
      await api.pool.end();
    }
  });

  test('a missing btree_gist extension cannot pass with an otherwise current migration ledger', async () => {
    await withTarget(async (isolated) => {
      const isolatedRuntime = await rolePool(isolated, 'runtime');
      try {
        await isolated.pool.query('DROP EXTENSION btree_gist CASCADE');
        await expect(assertRuntimeReadiness(isolatedRuntime)).rejects.toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
        });
      } finally {
        await isolatedRuntime.end();
      }
    });
  });
});

test('C19 HTTP writes and invoker triggers work with the exact runtime grants', async () => {
  await withTarget(async (isolated) => {
    const ownerInput = input();
    const first = await bootstrapOwner(isolated.pool, ownerInput);
    const urls = await p07DatabaseUrls();
    const runtimeUrl = new URL(urls.runtime);
    runtimeUrl.pathname = `/${isolated.ownership.databaseName}`;
    const api = await createApi({
      databaseUrl: runtimeUrl.toString(),
      appOrigin: 'http://localhost:5173',
      participantRegistrationEnabled: true,
    });
    try {
      expect((await api.pool.query('SELECT current_user AS role')).rows[0]!.role).toBe(
        'scb_runtime',
      );
      await assertRuntimeReadiness(api.pool);
      const owner: User = {
        id: first.userId,
        orgId: first.organizationId,
        email: ownerInput.email,
        cookie: '',
      };
      owner.cookie = await login(api, owner);
      const leader = { ...(await participant(api, 'c19-runtime-leader')), orgId: '' };
      const player = { ...(await participant(api, 'c19-runtime-player')), orgId: '' };
      const root = `/v1/orgs/${owner.orgId}`;
      const post = async <T = any>(
        route: string,
        body: object,
        actor: User = owner,
        status = 200,
      ) => data<T>(await call(api, 'post', route, { cookie: actor.cookie, body }), status);
      const get = async (route: string, actor: User = owner) =>
        data<any>(await call(api, 'get', route, { cookie: actor.cookie }));

      // Approval writes a request, a team, its manager grant and audit as the runtime identity.
      const link = await post(
        `${root}/team-request-links`,
        {
          expiresInHours: 24,
          maxUses: 2,
          reason: '隔离运行权限验证入口',
        },
        owner,
        201,
      );
      const request = await post(
        '/v1/team-requests',
        {
          token: link.token,
          clientRequestId: randomUUID(),
          teamName: '隔离运行权限申请队',
        },
        leader,
        201,
      );
      const approved = await post(`${root}/team-requests/${request.id}/review`, {
        decision: 'APPROVE',
        expectedVersion: request.version,
        reason: '隔离运行权限批准建队',
      });
      expect(approved.status).toBe('APPROVED');
      expect((await get(`${root}/teams/${approved.teamId}`, leader)).capabilities.canManage).toBe(
        true,
      );

      // A regular member joins a different team without inheriting any management grant.
      let home = await team(api, owner, '运行权限主队', leader, ['既有成员']);
      const away = await team(api, owner, '运行权限客队', leader, ['合成丙', '合成丁']);
      const issued = await post(`${root}/teams/${home.id}/join-codes`, {}, owner, 201);
      const membership = await post(
        '/v1/team-joins',
        {
          code: issued.code,
          displayName: '运行权限球员',
        },
        player,
        201,
      );
      expect(membership.status).toBe('ACTIVE');
      expect((await get('/v1/auth/session', player)).teamContexts).toEqual([]);
      home = await get(`${root}/teams/${home.id}`);
      const h: Harness = {
        api,
        owner,
        otherOwner: owner,
        leader,
        teams: [home, away],
        otherTeams: [],
        databaseUrl: runtimeUrl.toString(),
        nextDate: 0,
      };
      const fixture = await published(h);
      const eventId = fixture.event.event.id;
      const matchPath = `${root}/matches/${fixture.matches[0]!.id}`;

      // Chunk acceptance/completion exercises session, chunk, file and receipt column grants
      // plus the file quota and receipt guards under an ordinary runtime connection.
      const fileInput = {
        clientRequestId: randomUUID(),
        purpose: 'MATCH_IMAGE',
        fileName: 'runtime.png',
        contentType: 'image/png',
        byteLength: syntheticPng.length,
        contentSha256: createHash('sha256').update(syntheticPng).digest('hex'),
      };
      const session = await post<UploadSessionData>(
        `${matchPath}/media-upload-sessions`,
        fileInput,
        owner,
        201,
      );
      const chunk = data<any>(
        await call(api, 'put', `${matchPath}/media-upload-sessions/${session.id}/chunks/0`, {
          cookie: owner.cookie,
          body: {
            byteLength: syntheticPng.length,
            sha256: fileInput.contentSha256,
            contentBase64: syntheticPng.toString('base64'),
          },
        }),
      );
      expect(chunk.receivedBytes).toBe(syntheticPng.length);
      const completed = await post<MediaFileReceiptData>(
        `${matchPath}/media-upload-sessions/${session.id}/complete`,
        {},
      );
      expect(completed.state).toBe('FILE');
      if (completed.state !== 'FILE')
        throw new Error('Upload completion did not return a file receipt');
      expect(await get(`${matchPath}/media-file-requests/${fileInput.clientRequestId}`)).toEqual(
        completed,
      );
      const media = await post<MatchMediaData>(
        `${matchPath}/media-requests`,
        {
          clientRequestId: randomUUID(),
          kind: 'IMAGE',
          title: '隔离权限图片',
          fileId: completed.file.id,
          rightsDeclaration: '合成图片仅用于隔离测试',
        },
        owner,
        201,
      );
      expect(media.status).toBe('DRAFT');
      expect(media.fileId).toBe(completed.file.id);
      const cancelled = await post<UploadSessionData>(
        `${matchPath}/media-upload-sessions`,
        {
          ...fileInput,
          clientRequestId: randomUUID(),
        },
        owner,
        201,
      );
      expect(
        (await post(`${matchPath}/media-upload-sessions/${cancelled.id}/cancel`, {})).status,
      ).toBe('CANCELLED');

      // A consented source, then leaving the binding, exercises read-side joins and the new
      // cross-module invalidation trigger as scb_runtime (not the schema owner).
      const season = await post(
        `${root}/seasons`,
        {
          clientRequestId: randomUUID(),
          name: '隔离运行权限赛季',
          startDate: fixture.event.event.startDate,
          endDate: fixture.event.event.endDate,
        },
        owner,
        201,
      );
      const attached = await post(`${root}/seasons/${season.id}/commands`, {
        type: 'ATTACH_EVENT',
        eventId,
        expectedVersion: season.version,
      });
      await post(`${root}/seasons/${season.id}/commands`, {
        type: 'ACTIVATE',
        expectedVersion: attached.version,
      });
      const pending = await post(
        `${root}/events/${eventId}/season-data-grants`,
        {
          clientRequestId: randomUUID(),
          teamId: home.id,
          memberId: membership.memberId,
          targetUserId: player.id,
          reason: '运行权限私有赛季提名',
        },
        owner,
        201,
      );
      expect(
        (
          await post(
            `/v1/me/season-data-grants/${pending.id}/commands`,
            {
              type: 'CONSENT',
              expectedVersion: pending.version,
            },
            player,
          )
        ).status,
      ).toBe('ACTIVE');
      expect(
        (await get(`${root}/seasons/${season.id}/player-statistics`)).summary.effectiveGrantCount,
      ).toBe(1);
      await post(`/v1/me/memberships/${membership.bindingId}/leave`, {}, player);
      expect(
        (await get(`${root}/seasons/${season.id}/player-statistics`)).summary.effectiveGrantCount,
      ).toBe(0);

      await savePublishRules(h, eventId);
      const viewing = await enable(h, eventId);
      const followed = await post(
        '/v1/me/follows',
        {
          publicEventId: viewing.publication!.publicEventId,
        },
        player,
        201,
      );
      expect(followed.status).toBe('ACTIVE');
      expect(await get('/v1/me/follows', player)).toHaveLength(1);
      await post(`${root}/events/${eventId}/directory-commands`, {
        type: 'LIST',
        expectedEventVersion: viewing.event.version,
        reason: '隔离运行权限目录发布',
      });
      data(await viewingCommand(h, eventId, 'DISABLE'));
      expect((await get('/v1/me/follows', player))[0]).toMatchObject({
        status: 'INVALID',
        event: null,
      });
      expect((await post(`/v1/me/follows/${followed.followId}/cancel`, {}, player)).status).toBe(
        'CANCELLED',
      );
      await assertRuntimeReadiness(api.pool);
      await expect(api.pool.query('SELECT * FROM audit_logs')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await api.app.close();
      await api.pool.end();
    }
  });
}, 120000);

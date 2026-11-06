import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, test } from 'vitest';
import {
  applyRuntimePrivileges,
  assertManifestSchema,
  loadManifest,
} from '../../../ops/db/privileges.mjs';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { issueInitializationLink } from '../src/first-run-setup.js';
import { call, data, eventually, sessionCookie, setCookies, testDatabaseUrl } from './support.js';

const ORIGIN = 'https://localhost:5173';
const privatePassword = () => randomBytes(24).toString('base64url');
async function failureCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const SERVICE_ROLES = ['scb_admin', 'scb_migrator', 'scb_runtime', 'scb_backup'] as const;
interface RoleSnapshot {
  oid: number;
  rolname: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  migrator_password_absent: boolean | null;
  rolconnlimit: number;
  rolvaliduntil: string | null;
  rolconfig: string[] | null;
}
const quotedIdentifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const quotedLiteral = (value: string) => "'" + value.replaceAll("'", "''") + "'";
async function roleSnapshots(pool: Pick<Pool, 'query'>): Promise<RoleSnapshot[]> {
  return (
    await pool.query<RoleSnapshot>(
      `SELECT oid::int AS oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
      rolcanlogin,rolreplication,rolbypassrls,
      CASE WHEN rolname='scb_migrator' THEN rolpassword IS NULL END AS migrator_password_absent,rolconnlimit,
      rolvaliduntil::text AS rolvaliduntil,s.setconfig AS rolconfig
     FROM pg_authid LEFT JOIN pg_db_role_setting s ON s.setrole=oid AND s.setdatabase=0 WHERE rolname=ANY($1::name[]) ORDER BY rolname`,
      [SERVICE_ROLES],
    )
  ).rows;
}

/** Fixed role names exercise the real provisioner/readiness rules only inside
 * the disposable CI service. Adopt only its known NOLOGIN/null-password migrator
 * baseline, restore its original attributes, and drop OID-tracked fixture roles.
 * Existing control-admin credentials are neither read nor changed.
 */
async function withRuntimeFixture<T>(
  work: (fixture: { api: Awaited<ReturnType<typeof createApi>>; migrator: Pool }) => Promise<T>,
): Promise<T> {
  const base = new URL(testDatabaseUrl());
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
    throw new Error('Runtime fixture requires the isolated loopback PostgreSQL service');
  const name = `scb_test_runtime_identity_${randomUUID().replaceAll('-', '')}`;
  const control = new Pool({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
  const lock = await control.connect();
  let locked = false;
  let baseline: RoleSnapshot[] | undefined;
  let baselineAccepted = false;
  const createdRoles = new Map<string, number>();
  let databaseOid: number | undefined;
  let migrator: Pool | undefined;
  let api: Awaited<ReturnType<typeof createApi>> | undefined;
  let result: T | undefined;
  let primaryError: unknown;
  let failed = false;
  let cleanupFailed = false;
  const clean = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      cleanupFailed = true;
    }
  };
  const readRoleOid = async (role: string) =>
    (
      await control.query<{ oid: number }>(
        'SELECT oid::int AS oid FROM pg_roles WHERE rolname=$1',
        [role],
      )
    ).rows[0]?.oid;
  try {
    const actor = (
      await lock.query(
        'SELECT current_user AS name,rolsuper FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    if (!actor?.rolsuper) throw new Error('Runtime fixture requires its isolated test superuser');
    // Vitest files run sequentially; this session lock also serializes any
    // competing invocation of this fixture without colliding with provisioner's
    // separate transaction lock.
    await lock.query('SELECT pg_advisory_lock($1)', [7240202649]);
    locked = true;
    baseline = await roleSnapshots(control);
    for (const original of baseline) {
      if (original.rolname === 'scb_admin') {
        if (actor.name !== 'scb_admin')
          throw new Error('Runtime fixture cannot adopt an existing maintenance identity');
        continue;
      }
      if (
        original.rolname !== 'scb_migrator' ||
        original.rolcanlogin ||
        original.rolsuper ||
        original.rolcreaterole ||
        original.rolcreatedb ||
        original.rolreplication ||
        original.rolbypassrls ||
        original.migrator_password_absent !== true ||
        original.rolconnlimit !== -1 ||
        original.rolvaliduntil !== null ||
        original.rolconfig !== null
      )
        throw new Error('Runtime fixture refuses an unexpected provisioned service-role baseline');
      const membership = await control.query(
        'SELECT 1 FROM pg_auth_members WHERE roleid=$1 OR member=$1 LIMIT 1',
        [original.oid],
      );
      if (membership.rowCount)
        throw new Error('Runtime fixture refuses unexpected service-role memberships');
    }
    baselineAccepted = true;
    const roleUrl = (role: string) => {
      const u = new URL(base);
      u.pathname = `/${name}`;
      u.search = '';
      u.username = role;
      u.password = privatePassword();
      return u.toString();
    };
    const urls = {
      adminUrl: roleUrl('scb_admin'),
      migratorUrl: roleUrl('scb_migrator'),
      runtimeUrl: roleUrl('scb_runtime'),
      backupUrl: roleUrl('scb_backup'),
    };
    if (!baseline.some((role) => role.rolname === 'scb_admin')) {
      await control.query(
        `CREATE ROLE scb_admin LOGIN SUPERUSER PASSWORD ${quotedLiteral(new URL(urls.adminUrl).password)}`,
      );
      createdRoles.set('scb_admin', (await readRoleOid('scb_admin'))!);
    } else {
      // Do not guess or overwrite the credentials of an unrelated admin role.
      if (actor.name !== 'scb_admin')
        throw new Error('Runtime fixture cannot adopt an existing maintenance identity');
      if (base.password) {
        const authenticated = new URL(urls.adminUrl);
        authenticated.password = base.password;
        urls.adminUrl = authenticated.toString();
      }
    }
    await control.query(`CREATE DATABASE ${quotedIdentifier(name)} TEMPLATE template0`);
    databaseOid = (
      await control.query<{ oid: number }>(
        'SELECT oid::int AS oid FROM pg_database WHERE datname=$1',
        [name],
      )
    ).rows[0]!.oid;
    const moduleUrl = new URL('../../../ops/db/provision.mjs', import.meta.url).href;
    const { provisionDatabase } = (await import(moduleUrl)) as {
      provisionDatabase(input: typeof urls): Promise<{ status: string }>;
    };
    const provisioned = await provisionDatabase(urls);
    for (const role of SERVICE_ROLES)
      if (!baseline.some((original) => original.rolname === role) && !createdRoles.has(role))
        createdRoles.set(role, (await readRoleOid(role))!);
    expect(provisioned.status).toBe('provisioned');
    migrator = new Pool({ connectionString: urls.migratorUrl, connectionTimeoutMillis: 5000 });
    await migrate(migrator);
    await assertManifestSchema(migrator, await loadManifest());
    await applyRuntimePrivileges(migrator);
    api = await createApi({
      databaseUrl: urls.runtimeUrl,
      appOrigin: ORIGIN,
      secureCookies: true,
      firstRunSetupEnabled: true,
      organizationRegistrationEnabled: true,
      participantRegistrationEnabled: true,
      backgroundWorkersEnabled: false,
    });
    result = await work({ api, migrator });
  } catch (error) {
    failed = true;
    primaryError = error;
  } finally {
    if (api) {
      await clean(() => api!.app.close());
      await clean(() => api!.pool.end());
    }
    if (migrator) await clean(() => migrator!.end());
    if (databaseOid !== undefined)
      await clean(async () => {
        await eventually(
          async () =>
            (
              await control.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND backend_type='client backend'",
                [name],
              )
            ).rows[0]!.n,
          (n) => n === 0,
          'Runtime fixture sockets must disconnect before owned database cleanup',
        );
        const currentOid = (
          await control.query<{ oid: number }>(
            'SELECT oid::int AS oid FROM pg_database WHERE datname=$1',
            [name],
          )
        ).rows[0]?.oid;
        if (currentOid !== databaseOid)
          throw new Error('Runtime fixture database ownership changed');
        await control.query(`DROP DATABASE ${quotedIdentifier(name)}`);
      });
    if (baseline) {
      for (const original of baseline.filter(
        (role) => baselineAccepted && role.rolname === 'scb_migrator',
      ))
        await clean(async () => {
          if ((await readRoleOid(original.rolname)) !== original.oid)
            throw new Error('Runtime fixture role ownership changed');
          const flags = [
            ['rolsuper', 'SUPERUSER', 'NOSUPERUSER'],
            ['rolinherit', 'INHERIT', 'NOINHERIT'],
            ['rolcreaterole', 'CREATEROLE', 'NOCREATEROLE'],
            ['rolcreatedb', 'CREATEDB', 'NOCREATEDB'],
            ['rolcanlogin', 'LOGIN', 'NOLOGIN'],
            ['rolreplication', 'REPLICATION', 'NOREPLICATION'],
            ['rolbypassrls', 'BYPASSRLS', 'NOBYPASSRLS'],
          ] as const;
          await control.query(
            `ALTER ROLE ${quotedIdentifier(original.rolname)} ${flags.map(([field, yes, no]) => (original[field] ? yes : no)).join(' ')} PASSWORD NULL`,
          );
        });
      for (const [role, oid] of [...createdRoles].reverse())
        await clean(async () => {
          if ((await readRoleOid(role)) !== oid)
            throw new Error('Runtime fixture role ownership changed');
          await control.query(`DROP ROLE ${quotedIdentifier(role)}`);
        });
      await clean(async () => {
        // Only compare a boolean: failure diagnostics must never dump pg_authid.
        if (JSON.stringify(await roleSnapshots(control)) !== JSON.stringify(baseline))
          throw new Error('Runtime fixture did not restore the original service-role baseline');
      });
    }
    if (locked) await clean(() => lock.query('SELECT pg_advisory_unlock($1)', [7240202649]));
    lock.release();
    await clean(() => control.end());
  }
  if (cleanupFailed) {
    const cleanupError = new Error(
      'Runtime fixture role/database cleanup failed; no credential details retained',
    );
    if (failed)
      throw new AggregateError(
        [primaryError, cleanupError],
        'Runtime fixture assertion and cleanup both failed',
      );
    throw cleanupError;
  }
  if (failed) throw primaryError;
  return result!;
}

describe('account security through actual PostgreSQL runtime identity', () => {
  test('readiness remains healthy before/after setup and password change uses only runtime credentials', async () => {
    await withRuntimeFixture(async ({ api, migrator }) => {
      await api.app.init();
      expect((await api.pool.query('SELECT current_user AS name')).rows).toEqual([
        { name: 'scb_runtime' },
      ]);
      const powers = (
        await api.pool.query(
          'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user',
        )
      ).rows[0];
      expect(Object.values(powers).every((v) => v === false)).toBe(true);
      data(await call(api, 'get', '/ready'));
      expect(
        await failureCode(issueInitializationLink(api.pool, { enabled: true, appOrigin: ORIGIN })),
      ).toBe('MAINTENANCE_ROLE_REQUIRED');
      for (const sql of [
        "UPDATE first_run_setup SET token_hash=repeat('0',64),token_expires_at=clock_timestamp()+interval '1 hour' WHERE singleton=true",
        'UPDATE first_run_setup SET token_hash=NULL,token_expires_at=NULL WHERE singleton=true',
        'DELETE FROM first_run_setup',
        'CREATE TABLE setup_forbidden_ddl(id integer)',
        'CREATE ROLE setup_forbidden_role',
      ])
        expect(await failureCode(api.pool.query(sql))).toBe('42501');
      const before = await call(api, 'post', '/v1/auth/register', {
        origin: ORIGIN,
        body: {
          email: 'before-setup@example.test',
          password: privatePassword(),
          displayName: '初始化前测试',
          organizationName: '初始化前机构',
        },
      });
      expect(before.status).toBe(409);
      expect(before.body.error.code).toBe('SETUP_REQUIRED');
      const link = await issueInitializationLink(migrator, { enabled: true, appOrigin: ORIGIN });
      const token = new URLSearchParams(new URL(link.link).hash.slice(1)).get('token');
      const password = privatePassword(),
        email = `runtime-owner-${randomUUID()}@example.test`;
      const setupBody = {
        token,
        email,
        password,
        confirmPassword: password,
        displayName: '真实runtime隔离负责人',
        organizationName: '真实runtime隔离机构',
      };
      for (const origin of [null, 'https://untrusted.example.test']) {
        const rejected = await call(api, 'post', '/v1/setup/initialize', {
          origin,
          body: setupBody,
        });
        expect(rejected.status).toBe(403);
        expect(rejected.body.error.code).toBe('ORIGIN_REJECTED');
      }
      expect(
        (
          await migrator.query(
            'SELECT initialized_at IS NULL AND token_used_at IS NULL AS untouched FROM first_run_setup WHERE singleton=true',
          )
        ).rows[0].untouched,
      ).toBe(true);
      data(await call(api, 'post', '/v1/setup/initialize', { origin: ORIGIN, body: setupBody }));
      data(await call(api, 'get', '/ready'));
      const owner = (
        await migrator.query(
          'SELECT id,email,login_name,email_verified_at FROM users WHERE email=$1',
          [email],
        )
      ).rows[0];
      expect(owner.login_name).toBeNull();
      expect(owner.email_verified_at).toBeNull();
      expect(
        (
          await migrator.query('SELECT role FROM organization_memberships WHERE user_id=$1', [
            owner.id,
          ])
        ).rows,
      ).toEqual([{ role: 'ORG_OWNER' }]);
      expect(
        (await migrator.query('SELECT 1 FROM platform_operators WHERE user_id=$1', [owner.id]))
          .rowCount,
      ).toBe(0);
      const login = (value: string) =>
        call(api!, 'post', '/v1/auth/login', { origin: ORIGIN, body: { email, password: value } });
      const first = await login(password),
        second = await login(password);
      data(first);
      data(second);
      const cookies = [sessionCookie(first), sessionCookie(second)],
        replacement = privatePassword();
      const changed = await call(api, 'post', '/v1/auth/change-password', {
        origin: ORIGIN,
        cookie: cookies[0],
        body: { currentPassword: password, newPassword: replacement, confirmPassword: replacement },
      });
      data(changed);
      expect(setCookies(changed).some((v) => v.includes('Max-Age=0'))).toBe(true);
      for (const cookie of cookies)
        expect((await call(api, 'get', '/v1/auth/session', { cookie })).status).toBe(401);
      expect((await login(password)).status).toBe(401);
      const session = data<{ user: { id: string }; organizations: { role: string }[] }>(
        await login(replacement),
      );
      expect(session.user.id).toBe(owner.id);
      expect(session.organizations[0]?.role).toBe('ORG_OWNER');
      expect(
        (await migrator.query('SELECT id,email,login_name FROM users WHERE id=$1', [owner.id]))
          .rows[0],
      ).toEqual({ id: owner.id, email, login_name: null });
      expect(
        await failureCode(
          api.pool.query('UPDATE first_run_setup SET initialized_at=NULL WHERE singleton=true'),
        ),
      ).toBe('23514');
      expect(
        await failureCode(issueInitializationLink(migrator, { enabled: true, appOrigin: ORIGIN })),
      ).toBe('SETUP_CLOSED');
      data(await call(api, 'get', '/ready'));
    });
  }, 120000);

  test('failed assertions still restore original service roles without retaining fixture roles', async () => {
    const expected = new Error('Deliberate isolated fixture failure');
    let failure: unknown;
    try {
      await withRuntimeFixture(async () => {
        throw expected;
      });
    } catch (error) {
      failure = error;
    }
    // Exact original-error preservation also proves cleanup passed its private
    // full-baseline comparison; cleanup failure returns a distinct aggregate.
    expect(failure === expected).toBe(true);
  }, 120000);

  test('unexpected existing runtime roles are rejected without changing their credentials or attributes', async () => {
    const base = new URL(testDatabaseUrl());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
      throw new Error('Runtime fixture requires the isolated loopback PostgreSQL service');
    const control = new Pool({ connectionString: base.toString() });
    let ownedOid: number | undefined;
    try {
      const existing = await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
        'scb_runtime',
      ]);
      expect(existing.rowCount === 0).toBe(true);
      await control.query(
        `CREATE ROLE scb_runtime LOGIN CREATEDB INHERIT PASSWORD ${quotedLiteral(privatePassword())}`,
      );
      const read = async () =>
        (
          await control.query(
            "SELECT oid::int AS oid,rolcanlogin,rolcreatedb,rolinherit,rolpassword IS NOT NULL AS has_password FROM pg_authid WHERE rolname='scb_runtime'",
          )
        ).rows[0];
      const original = await read();
      ownedOid = original.oid;
      let rejected = false;
      try {
        await withRuntimeFixture(async () => undefined);
      } catch (error) {
        rejected =
          (error as Error).message ===
          'Runtime fixture refuses an unexpected provisioned service-role baseline';
      }
      expect(rejected).toBe(true);
      // Compare only non-secret role facts; neither passwords nor their hashes
      // leave PostgreSQL in this negative baseline test.
      expect(JSON.stringify(await read()) === JSON.stringify(original)).toBe(true);
    } finally {
      if (ownedOid !== undefined) {
        const current = (
          await control.query<{ oid: number }>(
            'SELECT oid::int AS oid FROM pg_roles WHERE rolname=$1',
            ['scb_runtime'],
          )
        ).rows[0]?.oid;
        if (current !== ownedOid) throw new Error('Negative fixture role ownership changed');
        await control.query('DROP ROLE scb_runtime');
      }
      await control.end();
    }
  }, 120000);
});

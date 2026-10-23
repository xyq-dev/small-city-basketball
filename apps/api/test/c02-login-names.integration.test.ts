import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { maintainAccount } from '../src/account-maintenance.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  data,
  error,
  eventually,
  login,
  sessionCookie,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

const databaseUrl = testDatabaseUrl();
const newPassword = 'Account-maintenance-isolated-password-2026';
const prefix = `c02_${RUN_ID.slice(0, 12)}`;
const maintenance = (user: User, loginName: string, reason = 'Synthetic isolated acceptance') => ({
  email: user.email,
  loginName,
  password: newPassword,
  reason,
});

describe(
  'C02 login names and offline credential maintenance with real PostgreSQL',
  { concurrent: false },
  () => {
    let api: Api;
    beforeAll(async () => {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      api = await createApi({ databaseUrl, appOrigin: ORIGIN });
    });
    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    });

    async function fixtureUser(label: string): Promise<User> {
      // This suite tests login and maintenance, not registration. Seed only
      // synthetic identities so unrelated files cannot exhaust the shared
      // loopback registration budget; authentication still uses real HTTP.
      const user = {
        id: randomUUID(),
        orgId: randomUUID(),
        email: `${label}-${RUN_ID}@example.test`,
        cookie: '',
      };
      const passwordHash = await hashPassword(PASSWORD);
      const client = await api.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
          [user.id, user.email, `账号维护 ${label}`, passwordHash],
        );
        await client.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          user.orgId,
          `账号维护机构 ${label}`,
        ]);
        await client.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [user.orgId, user.id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      user.cookie = await login(api, user);
      return user;
    }

    test('maintains only the selected account, revokes every old session, and accepts username and unchanged email', async () => {
      const user = await fixtureUser(`${prefix}-owner`);
      const other = await fixtureUser(`${prefix}-unaffected`);
      const oldCookie = await login(api, user);
      const before = (await api.pool.query('SELECT count(*)::int AS count FROM organizations'))
        .rows[0]!.count;
      const result = await maintainAccount(api.pool, maintenance(user, `${prefix}_owner`));
      expect(result).toMatchObject({ status: 'updated', userId: user.id });
      expect(result.sessionsRevoked).toBe(2);
      for (const cookie of [user.cookie, oldCookie])
        error(await call(api, 'get', '/v1/auth/session', { cookie }), 401);
      data(await call(api, 'get', '/v1/auth/session', { cookie: other.cookie }));
      error(
        await call(api, 'post', '/v1/auth/login', {
          body: { email: user.email, password: PASSWORD },
        }),
        401,
      );
      for (const identifier of [user.email.toUpperCase(), ` ${prefix.toUpperCase()}_OWNER `]) {
        const response = await call(api, 'post', '/v1/auth/login', {
          body: { email: identifier, password: newPassword },
        });
        expect(data<{ user: { id: string; email: string } }>(response).user).toMatchObject({
          id: user.id,
          email: user.email,
        });
        data(await call(api, 'get', '/v1/auth/session', { cookie: sessionCookie(response) }));
      }
      expect(
        (await api.pool.query('SELECT count(*)::int AS count FROM organizations')).rows[0]!.count,
      ).toBe(before);
      expect(
        (
          await api.pool.query(
            'SELECT role FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
            [user.orgId, user.id],
          )
        ).rows[0]!.role,
      ).toBe('ORG_OWNER');
      const actor = (
        await api.pool.query('SELECT status,password_hash,login_name FROM users WHERE id=$1', [
          result.maintenanceActorId,
        ])
      ).rows[0]!;
      expect(actor).toMatchObject({ status: 'DISABLED', login_name: null });
      expect(actor.password_hash).toMatch(/^!SCB_DISABLED_MAINTENANCE_ACTOR!/);
      expect(
        (
          await api.pool.query('SELECT 1 FROM organization_memberships WHERE user_id=$1', [
            result.maintenanceActorId,
          ])
        ).rows,
      ).toEqual([]);
      const audit = (
        await api.pool.query(
          'SELECT actor_id,metadata FROM audit_logs WHERE resource_id=$1 AND action=$2',
          [user.id, 'ACCOUNT_CREDENTIALS_RESET'],
        )
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_id).toBe(result.maintenanceActorId);
      expect(audit[0]!.metadata).toMatchObject({
        source: 'offline-account-maintenance',
        sessionsRevoked: 2,
      });
      expect(JSON.stringify(audit)).not.toContain(newPassword);
      expect(JSON.stringify(audit)).not.toContain('scrypt$');
    });

    test('cannot reuse the current password or partially assign an alias on that rejected request', async () => {
      const user = await fixtureUser(`${prefix}-same-password`);
      await expect(
        maintainAccount(api.pool, { ...maintenance(user, `${prefix}_same`), password: PASSWORD }),
      ).rejects.toMatchObject({ status: 422, code: 'PASSWORD_REUSE_NOT_ALLOWED' });
      expect(
        (await api.pool.query('SELECT login_name FROM users WHERE id=$1', [user.id])).rows[0]!
          .login_name,
      ).toBeNull();
      data(await call(api, 'get', '/v1/auth/session', { cookie: user.cookie }));
    });

    test('unknown names and disabled users share the same non-disclosing credential failure', async () => {
      const user = await fixtureUser(`${prefix}-disabled`);
      await maintainAccount(api.pool, maintenance(user, `${prefix}_disabled`));
      await api.pool.query("UPDATE users SET status='DISABLED' WHERE id=$1", [user.id]);
      const responses = [];
      for (const identifier of [`${prefix}_missing`, `${prefix}_disabled`, user.email]) {
        const response = await call(api, 'post', '/v1/auth/login', {
          body: { email: identifier, password: newPassword },
        });
        error(response, 401);
        responses.push(response.body.error);
      }
      for (const response of responses)
        expect(response).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: '账号或密码不正确',
        });
    });

    test('alternating email and alias cannot bypass the account/IP password-attempt budget', async () => {
      const user = await fixtureUser(`${prefix}-limit`);
      const alias = `${prefix}_limit`;
      await maintainAccount(api.pool, maintenance(user, alias));
      for (let attempt = 0; attempt < 10; attempt++) {
        error(
          await call(api, 'post', '/v1/auth/login', {
            body: {
              email: attempt % 2 ? user.email : alias,
              password: 'Wrong-isolated-password-2026',
            },
          }),
          401,
        );
      }
      error(
        await call(api, 'post', '/v1/auth/login', {
          body: { email: alias, password: newPassword },
        }),
        429,
      );
    }, 30000);

    test('a concurrent duplicate alias has one winner and cannot partially reset the losing account', async () => {
      const first = await fixtureUser(`${prefix}-race-a`);
      const second = await fixtureUser(`${prefix}-race-b`);
      const sharedAlias = `${prefix}_shared`;
      const results = await Promise.allSettled([
        maintainAccount(api.pool, maintenance(first, sharedAlias)),
        maintainAccount(api.pool, maintenance(second, sharedAlias)),
      ]);
      expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((value) => value.status === 'rejected')).toHaveLength(1);
      const loser = results[0]!.status === 'rejected' ? first : second;
      expect(
        (await api.pool.query('SELECT login_name FROM users WHERE id=$1', [loser.id])).rows[0]!
          .login_name,
      ).toBeNull();
      data(await call(api, 'get', '/v1/auth/session', { cookie: loser.cookie }));
      data(
        await call(api, 'post', '/v1/auth/login', {
          body: { email: loser.email, password: PASSWORD },
        }),
      );
    });

    test('an audit failure rolls back the password, alias, sessions and system actor together', async () => {
      const user = await fixtureUser(`${prefix}-rollback`);
      const before = (
        await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id])
      ).rows[0]!.password_hash;
      const usersBefore = (await api.pool.query('SELECT count(*)::int AS count FROM users'))
        .rows[0]!.count;
      const trigger = `scb_test_c02_audit_${randomUUID().replaceAll('-', '')}`;
      await api.pool.query(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACCOUNT_CREDENTIALS_RESET' AND NEW.resource_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'isolated maintenance audit failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await api.pool.query(
          `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}('${user.id}')`,
        );
        await expect(
          maintainAccount(api.pool, maintenance(user, `${prefix}_rollback`)),
        ).rejects.toThrow('Account maintenance failed');
        expect(
          (
            await api.pool.query('SELECT password_hash,login_name FROM users WHERE id=$1', [
              user.id,
            ])
          ).rows[0],
        ).toEqual({ password_hash: before, login_name: null });
        expect(
          (await api.pool.query('SELECT count(*)::int AS count FROM users')).rows[0]!.count,
        ).toBe(usersBefore);
        data(await call(api, 'get', '/v1/auth/session', { cookie: user.cookie }));
      } finally {
        await api.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs`);
        await api.pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
      }
    });

    test('maintenance, an old-password login and its new-session request cannot form a lock cycle', async () => {
      const user = await fixtureUser(`${prefix}-inflight`);
      const blocker = await api.pool.connect();
      const gate = await api.pool.connect();
      const trigger = `scb_test_c02_gate_${randomUUID().replaceAll('-', '')}`;
      const gateNumber = Math.floor(Math.random() * 1_000_000_000);
      let pendingLogin: ReturnType<typeof call> | undefined;
      let pendingRequest: ReturnType<typeof call> | undefined;
      let pendingReset: ReturnType<typeof maintainAccount> | undefined;
      let blockerReleased = false;
      let gateReleased = false;
      await api.pool.query(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id::text=TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(72502026,TG_ARGV[1]::int); END IF; RETURN NEW; END $$`,
      );
      try {
        await api.pool.query(
          `CREATE TRIGGER ${trigger} BEFORE UPDATE OF login_name,password_hash ON users FOR EACH ROW EXECUTE FUNCTION ${trigger}('${user.id}','${gateNumber}')`,
        );
        await gate.query('BEGIN');
        const gatePid = (await gate.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await gate.query('SELECT pg_advisory_xact_lock(72502026,$1::int)', [gateNumber]);
        await blocker.query('BEGIN');
        const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
        pendingLogin = call(api, 'post', '/v1/auth/login', {
          body: { email: user.email, password: PASSWORD },
        });
        const loginWaiter = await eventually(
          async () =>
            (
              await api.pool.query(
                'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))',
                [blockerPid],
              )
            ).rows,
          (rows) => rows.length === 1,
          'Old-password login did not reach the user lock',
        );
        pendingReset = maintainAccount(api.pool, maintenance(user, `${prefix}_inflight`));
        await eventually(
          async () =>
            (
              await api.pool.query(
                'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))',
                [loginWaiter[0]!.pid],
              )
            ).rows,
          (rows) => rows.length >= 1,
          'Maintenance did not wait for the preceding login',
        );
        await blocker.query('COMMIT');
        blockerReleased = true;
        const loginResponse = await pendingLogin;
        data(loginResponse);
        const maintenanceWaiter = await eventually(
          async () =>
            (
              await api.pool.query(
                'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))',
                [gatePid],
              )
            ).rows,
          (rows) => rows.length === 1,
          'Maintenance did not reach its user-update barrier',
        );
        pendingRequest = call(api, 'get', '/v1/auth/session', {
          cookie: sessionCookie(loginResponse),
        });
        await eventually(
          async () =>
            (
              await api.pool.query(
                'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))',
                [maintenanceWaiter[0]!.pid],
              )
            ).rows,
          (rows) => rows.length >= 1,
          'New-session request did not wait for maintenance',
        );
        await gate.query('COMMIT');
        gateReleased = true;
        await pendingReset;
        error(await pendingRequest, 401);
        error(
          await call(api, 'post', '/v1/auth/login', {
            body: { email: user.email, password: PASSWORD },
          }),
          401,
        );
        data(
          await call(api, 'post', '/v1/auth/login', {
            body: { email: `${prefix}_inflight`, password: newPassword },
          }),
        );
      } finally {
        if (!blockerReleased) await blocker.query('ROLLBACK');
        if (!gateReleased) await gate.query('ROLLBACK');
        blocker.release();
        gate.release();
        await Promise.allSettled(
          [pendingLogin, pendingReset, pendingRequest].filter((value) => value !== undefined),
        );
        await api.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON users`);
        await api.pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
      }
    }, 30000);

    test('migration constraints reject invalid or case-conflicting stored names and repeated migrate is a no-op', async () => {
      const user = await fixtureUser(`${prefix}-constraints`);
      for (const loginName of ['AB', '1admin', 'bad-name', 'x'.repeat(33)])
        await expect(
          api.pool.query('UPDATE users SET login_name=$1 WHERE id=$2', [loginName, user.id]),
        ).rejects.toMatchObject({ code: '23514' });
      expect(await migrate(api.pool)).toEqual([]);
      expect(
        (await api.pool.query('SELECT login_name FROM users WHERE id=$1', [user.id])).rows[0]!
          .login_name,
      ).toBeNull();
    });
  },
);

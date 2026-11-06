import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { bootstrapOwner } from '../src/bootstrap-owner.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword, hashToken } from '../src/security.js';
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
  setCookies,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

const databaseUrl = testDatabaseUrl();
const newPassword = 'Self-service synthetic new password 2026 🏀';
const endpoint = '/v1/auth/change-password';
const body = (currentPassword = PASSWORD, next = newPassword) => ({
  currentPassword,
  newPassword: next,
  confirmPassword: next,
});

describe('self-service password change with real PostgreSQL', { concurrent: false }, () => {
  let api: Api;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(pool);
      const setup = await pool.query(
        'SELECT initialized_at FROM first_run_setup WHERE singleton=true',
      );
      if (!setup.rows[0]?.initialized_at)
        await bootstrapOwner(pool, {
          email: `change-bootstrap-${randomUUID()}@example.test`,
          password: PASSWORD,
          displayName: '合成改密验收初始化负责人',
          organizationName: '合成改密验收初始化机构',
        });
    } finally {
      await pool.end();
    }
    api = await createApi({
      databaseUrl,
      appOrigin: ORIGIN,
      accountRecovery: {
        encryptionKey: Buffer.alloc(32, 0x22).toString('base64'),
        provider: {
          async send() {
            return { state: 'ACCEPTED' as const };
          },
        },
        autoDispatch: false,
      },
    });
  }, 120000);
  afterAll(async () => {
    if (api) {
      await api.app.close();
      await api.pool.end();
    }
  });
  async function fixture(label: string): Promise<User> {
    const u: User = {
      id: randomUUID(),
      orgId: randomUUID(),
      email: `change-${label}-${RUN_ID}@example.test`,
      cookie: '',
    };
    await api.pool.query(
      'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [u.id, u.email, '合成密码变更', await hashPassword(PASSWORD)],
    );
    await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      u.orgId,
      '合成密码变更机构',
    ]);
    await api.pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [u.orgId, u.id],
    );
    u.cookie = await login(api, u);
    return u;
  }
  async function recoveryToken(u: User) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await api.pool.query(
      `INSERT INTO account_action_tokens(id,user_id,purpose,token_hash,email_snapshot,credential_fingerprint,expires_at)
       SELECT $1,id,'RESET_PASSWORD',$3,email,$4,clock_timestamp()+interval '15 minutes' FROM users WHERE id=$2`,
      [
        id,
        u.id,
        hashToken(token),
        hashToken(
          (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id])).rows[0]!
            .password_hash,
        ),
      ],
    );
    return { token, id };
  }
  async function unchanged(u: User, originalHash: string) {
    const state = (
      await api.pool.query(
        'SELECT password_hash=$2 AS unchanged,credential_reset_at IS NULL AS barrier_unchanged FROM users WHERE id=$1',
        [u.id, originalHash],
      )
    ).rows[0]!;
    expect(state).toEqual({ unchanged: true, barrier_unchanged: true });
    data(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }));
  }
  test('nullable login_name keeps identity and role, revokes every old session and recovery token', async () => {
    const u = await fixture('success'),
      other = await fixture('unaffected');
    const second = await login(api, u),
      token = await recoveryToken(u);
    const response = await call(api, 'post', endpoint, { cookie: u.cookie, body: body() });
    expect(data(response)).toEqual({ completed: true });
    expect(
      setCookies(response).some(
        (cookie) => cookie.startsWith('scb.sid=;') && cookie.includes('Max-Age=0'),
      ),
    ).toBe(true);
    for (const cookie of [u.cookie, second])
      error(await call(api, 'get', '/v1/auth/session', { cookie }), 401);
    data(await call(api, 'get', '/v1/auth/session', { cookie: other.cookie }));
    expect(
      (
        await api.pool.query(
          'SELECT email,login_name,credential_reset_at IS NOT NULL AS reset FROM users WHERE id=$1',
          [u.id],
        )
      ).rows[0],
    ).toEqual({ email: u.email, login_name: null, reset: true });
    expect(
      (
        await api.pool.query(
          'SELECT role,status FROM organization_memberships WHERE user_id=$1 AND org_id=$2',
          [u.id, u.orgId],
        )
      ).rows[0],
    ).toEqual({ role: 'ORG_OWNER', status: 'ACTIVE' });
    expect(
      (
        await api.pool.query(
          'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',
          [u.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await api.pool.query(
          'SELECT revoked_at IS NOT NULL AS revoked FROM account_action_tokens WHERE id=$1',
          [token.id],
        )
      ).rows[0]!.revoked,
    ).toBe(true);
    error(
      await call(api, 'post', '/v1/account-recovery/consume', {
        body: {
          token: token.token,
          clientRequestId: randomUUID(),
          newPassword: 'Synthetic stale recovery password 2026',
        },
      }),
      422,
    );
    error(
      await call(api, 'post', '/v1/auth/login', { body: { email: u.email, password: PASSWORD } }),
      401,
    );
    data(await call(api, 'get', '/v1/auth/session', { cookie: await login(api, u, newPassword) }));
    const audit = (
      await api.pool.query(
        "SELECT metadata FROM audit_logs WHERE actor_id=$1 AND action='AUTH_PASSWORD_CHANGED'",
        [u.id],
      )
    ).rows;
    expect(audit).toEqual([{ metadata: { sessionsRevoked: 2 } }]);
  });
  test('wrong password, reuse, confirmation, target injection, missing session and foreign/missing Origin do not mutate credentials', async () => {
    const u = await fixture('invalid');
    const oldHash = (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id]))
      .rows[0]!.password_hash;
    for (const item of [
      { options: { cookie: u.cookie, body: body('Synthetic wrong password 2026') }, status: 422 },
      { options: { cookie: u.cookie, body: body(PASSWORD, PASSWORD) }, status: 422 },
      {
        options: {
          cookie: u.cookie,
          body: { ...body(), confirmPassword: 'Synthetic mismatch password 2026' },
        },
        status: 422,
      },
      { options: { cookie: u.cookie, body: { ...body(), userId: randomUUID() } }, status: 422 },
      { options: { body: body() }, status: 401 },
      {
        options: { cookie: u.cookie, body: body(), origin: 'https://untrusted.example.test' },
        status: 403,
      },
      { options: { cookie: u.cookie, body: body(), origin: null }, status: 403 },
    ]) {
      error(await call(api, 'post', endpoint, item.options), item.status);
      await unchanged(u, oldHash);
    }
    expect(
      (
        await api.pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE actor_id=$1 AND action='AUTH_PASSWORD_CHANGED'",
          [u.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  test('audit failure rolls back password, credential barrier, session revocation and token revocation together', async () => {
    const u = await fixture('rollback'),
      token = await recoveryToken(u);
    const oldHash = (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id]))
      .rows[0]!.password_hash;
    const name = `change_rollback_${RUN_ID.slice(0, 16)}`;
    await api.pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${u.id}'::uuid AND NEW.action='AUTH_PASSWORD_CHANGED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await api.pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      error(await call(api, 'post', endpoint, { cookie: u.cookie, body: body() }), 500);
    } finally {
      await api.pool.query(`DROP TRIGGER ${name} ON audit_logs`);
      await api.pool.query(`DROP FUNCTION ${name}()`);
    }
    await unchanged(u, oldHash);
    expect(
      (
        await api.pool.query(
          'SELECT revoked_at IS NULL AS usable FROM account_action_tokens WHERE id=$1',
          [token.id],
        )
      ).rows[0]!.usable,
    ).toBe(true);
    data(await call(api, 'post', endpoint, { cookie: u.cookie, body: body() }));
  });
  test('disabled accounts and expired sessions cannot update credentials or revoke sessions', async () => {
    for (const state of ['disabled', 'expired']) {
      const u = await fixture(state);
      const original = (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id]))
        .rows[0]!.password_hash;
      if (state === 'disabled')
        await api.pool.query("UPDATE users SET status='DISABLED' WHERE id=$1", [u.id]);
      else
        await api.pool.query(
          "UPDATE sessions SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
          [u.id],
        );
      error(await call(api, 'post', endpoint, { cookie: u.cookie, body: body() }), 401);
      expect(
        (
          await api.pool.query(
            'SELECT password_hash=$2 AS same,credential_reset_at IS NULL AS untouched FROM users WHERE id=$1',
            [u.id, original],
          )
        ).rows[0],
      ).toEqual({ same: true, untouched: true });
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NOT NULL',
            [u.id],
          )
        ).rows[0]!.n,
      ).toBe(0);
    }
  });
  test('account-wide password attempts are limited across valid sessions without changing state', async () => {
    const u = await fixture('rate-limit'),
      second = await login(api, u);
    const original = (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id]))
      .rows[0]!.password_hash;
    for (let i = 0; i < 5; i++)
      error(
        await call(api, 'post', endpoint, {
          cookie: i % 2 ? second : u.cookie,
          body: body('Synthetic incorrect attempt 2026'),
        }),
        422,
      );
    const limited = await call(api, 'post', endpoint, { cookie: second, body: body() });
    error(limited, 429);
    expect(limited.headers['retry-after']).toBe('900');
    await unchanged(u, original);
  });
  test('concurrent password changes serialize and exactly one succeeds', async () => {
    const u = await fixture('parallel'),
      second = await login(api, u);
    const responses = await Promise.all([
      call(api, 'post', endpoint, { cookie: u.cookie, body: body() }),
      call(api, 'post', endpoint, {
        cookie: second,
        body: body(PASSWORD, 'Synthetic competing password 2026'),
      }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(
      (
        await api.pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE actor_id=$1 AND action='AUTH_PASSWORD_CHANGED'",
          [u.id],
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await api.pool.query(
          'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',
          [u.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  test('a recovery reset that wins the user lock invalidates a waiting change and all old sessions', async () => {
    const u = await fixture('recovery-race'),
      token = await recoveryToken(u);
    const c = await api.pool.connect(),
      key = `scb-account-maintenance:${u.id}`;
    let changing: ReturnType<typeof call> | undefined;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      changing = call(api, 'post', endpoint, { cookie: u.cookie, body: body() });
      await eventually(
        async () =>
          (
            await api.pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT pg_advisory_xact_lock(hashtextextended($1,0))'",
            )
          ).rows[0]!.n,
        (n) => n > 0,
        'Password change reaches its actual advisory lock',
        15000,
      );
      data(
        await call(api, 'post', '/v1/account-recovery/consume', {
          body: {
            token: token.token,
            clientRequestId: randomUUID(),
            newPassword: 'Synthetic winning recovery password 2026',
          },
        }),
      );
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      error(await changing, 401);
      error(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }), 401);
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      if (changing) await changing.catch(() => {});
      c.release();
    }
  });
  test('an in-flight old-password login cannot leave a valid old session after password change', async () => {
    const u = await fixture('login-race');
    const c = await api.pool.connect(),
      key = `scb-account-maintenance:${u.id}`;
    let logging: ReturnType<typeof call> | undefined, changing: ReturnType<typeof call> | undefined;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      logging = call(api, 'post', '/v1/auth/login', {
        body: { email: u.email, password: PASSWORD },
      });
      await eventually(
        async () =>
          (
            await api.pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))'",
            )
          ).rows[0]!.n,
        (n) => n > 0,
        'Login reaches its shared credential lock',
        15000,
      );
      changing = call(api, 'post', endpoint, { cookie: u.cookie, body: body() });
      await eventually(
        async () =>
          (
            await api.pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT pg_advisory_xact_lock(hashtextextended($1,0))'",
            )
          ).rows[0]!.n,
        (n) => n > 0,
        'Password change reaches its exclusive credential lock',
        15000,
      );
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      const logged = await logging;
      data(await changing);
      if (logged.status === 200)
        error(await call(api, 'get', '/v1/auth/session', { cookie: sessionCookie(logged) }), 401);
      else error(logged, 401);
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',
            [u.id],
          )
        ).rows[0]!.n,
      ).toBe(0);
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      if (logging) await logging.catch(() => {});
      if (changing) await changing.catch(() => {});
      c.release();
    }
  });
  test('a recovery consume already in flight loses to a committed password change', async () => {
    const u = await fixture('change-wins'),
      token = await recoveryToken(u);
    const c = await api.pool.connect(),
      key = `password-update-gate:${u.id}`;
    const name = `password_gate_${RUN_ID.slice(0, 16)}`;
    let changing: ReturnType<typeof call> | undefined,
      recovering: ReturnType<typeof call> | undefined;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      await api.pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${u.id}'::uuid AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0)); END IF; RETURN NEW; END; $$`,
      );
      await api.pool.query(
        `CREATE TRIGGER ${name} BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      changing = call(api, 'post', endpoint, { cookie: u.cookie, body: body() });
      await eventually(
        async () =>
          (
            await api.pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE users SET password_hash=%'",
            )
          ).rows[0]!.n,
        (n) => n > 0,
        'Password change owns the real user UPDATE lock',
        15000,
      );
      recovering = call(api, 'post', '/v1/account-recovery/consume', {
        body: {
          token: token.token,
          clientRequestId: randomUUID(),
          newPassword: 'Synthetic losing recovery password 2026',
        },
      });
      await eventually(
        async () =>
          (
            await api.pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT id,email,display_name,password_hash,status FROM users WHERE id=$1 FOR UPDATE'",
            )
          ).rows[0]!.n,
        (n) => n > 0,
        'Recovery consume waits for password change user lock',
        15000,
      );
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      data(await changing);
      error(await recovering, 422);
      data(
        await call(api, 'get', '/v1/auth/session', { cookie: await login(api, u, newPassword) }),
      );
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      if (changing) await changing.catch(() => {});
      if (recovering) await recovering.catch(() => {});
      await api.pool.query(`DROP TRIGGER IF EXISTS ${name} ON users`);
      await api.pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
      c.release();
    }
  });
  test('a session that expires after password verification is rejected before writes', async () => {
    const u = await fixture('expires-in-flight');
    const original = (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id]))
      .rows[0]!.password_hash;
    const c = await api.pool.connect(),
      key = `scb-account-maintenance:${u.id}`;
    let changing: ReturnType<typeof call> | undefined;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      changing = call(api, 'post', endpoint, { cookie: u.cookie, body: body() });
      await eventually(
        async () =>
          (
            await api.pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT pg_advisory_xact_lock(hashtextextended($1,0))'",
            )
          ).rows[0]!.n,
        (n) => n > 0,
        'Verified change waits at mutation boundary',
        15000,
      );
      await api.pool.query(
        "UPDATE sessions SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        [u.id],
      );
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      error(await changing, 401);
      expect(
        (
          await api.pool.query(
            'SELECT password_hash=$2 AS same,credential_reset_at IS NULL AS untouched FROM users WHERE id=$1',
            [u.id, original],
          )
        ).rows[0],
      ).toEqual({ same: true, untouched: true });
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NOT NULL',
            [u.id],
          )
        ).rows[0]!.n,
      ).toBe(0);
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      if (changing) await changing.catch(() => {});
      c.release();
    }
  });
});

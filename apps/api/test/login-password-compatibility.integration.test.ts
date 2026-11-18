import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword, hashToken } from '../src/security.js';
import type { WechatExchange } from '../src/wechat-provider.js';
import { ORIGIN, RUN_ID, call, data, error, sessionCookie, testDatabaseUrl } from './support.js';
import type { Api } from './support.js';

const databaseUrl = testDatabaseUrl();
const password = ' Ab 密🔒 ';
const replacement = 'Synthetic new password 2026';
const alias = `u${RUN_ID.slice(0, 10)}`;
const appId = 'wx0000000000000001';
let wechatExchanges = 0;
const exchange: WechatExchange = {
  async exchange() {
    wechatExchanges += 1;
    throw new Error('synthetic transport must not be called while checking an existing password');
  },
};

describe('login accepts an existing short credential without lowering new-password policy', () => {
  let api: Api;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(pool);
    } finally {
      await pool.end();
    }
    api = await createApi({
      databaseUrl,
      appOrigin: ORIGIN,
      backgroundWorkersEnabled: false,
      accountClosure: { enabled: true, autoDispatch: false },
      wechat: {
        configuration: { enabled: true, appId, appSecret: 'SYNTHETIC_WECHAT_SECRET_2026' },
        exchange,
      },
    });
  });

  afterAll(async () => {
    if (api) {
      await api.app.close();
      await api.pool.end();
    }
  });

  async function seed(label: string, loginName: string | null, status = 'ACTIVE') {
    const user = {
      id: randomUUID(),
      orgId: randomUUID(),
      email: `${label}-${RUN_ID}@example.test`,
    };
    const passwordHash = await hashPassword(password);
    await api.pool.query(
      'INSERT INTO users(id,email,login_name,display_name,password_hash,status) VALUES($1,$2,$3,$4,$5,$6)',
      [user.id, user.email, loginName, `合成账号 ${label}`, passwordHash, status],
    );
    await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      user.orgId,
      `合成机构 ${label}`,
    ]);
    await api.pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [user.orgId, user.id],
    );
    return user;
  }

  test('rejects empty, non-string and overlong login passwords before credential lookup', async () => {
    for (const value of ['', 'x'.repeat(129), 12, null]) {
      const response = await call(api, 'post', '/v1/auth/login', {
        body: { email: `unused-${RUN_ID}@example.test`, password: value },
      });
      error(response, 422);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { fieldErrors: { password: '密码需为1–128个字符' } },
      });
    }
    const before = (await api.pool.query('SELECT count(*)::int AS count FROM users')).rows[0]!
      .count;
    const registered = await call(api, 'post', '/v1/auth/register', {
      body: {
        email: `new-${RUN_ID}@example.test`,
        password: 'short-pass1',
        displayName: '合成注册',
        organizationName: '合成注册机构',
      },
    });
    error(registered, 422);
    expect(registered.body.error.details.fieldErrors.password).toBe('密码需为12–128个字符');
    expect((await api.pool.query('SELECT count(*)::int AS count FROM users')).rows[0]!.count).toBe(
      before,
    );
  });

  test('matches the stored short secret exactly and keeps the same user, organization and role', async () => {
    const user = await seed('exact', alias);
    for (const identifier of [user.email, alias.toUpperCase(), ` ${alias} `]) {
      const response = await call(api, 'post', '/v1/auth/login', {
        body: { email: identifier, password },
      });
      const session = data<{
        user: { id: string; email: string };
        organizations: { id: string; role: string }[];
      }>(response);
      expect(session.user).toMatchObject({ id: user.id, email: user.email });
      expect(session.organizations).toEqual([
        { id: user.orgId, name: '合成机构 exact', role: 'ORG_OWNER' },
      ]);
      const loaded = data<{ user: { id: string }; organizations: { role: string }[] }>(
        await call(api, 'get', '/v1/auth/session', { cookie: sessionCookie(response) }),
      );
      expect(loaded.user.id).toBe(user.id);
      expect(loaded.organizations[0]?.role).toBe('ORG_OWNER');
    }
    for (const altered of [password.toLowerCase(), password.trim(), `${password} `]) {
      error(
        await call(api, 'post', '/v1/auth/login', {
          body: { email: user.email, password: altered },
        }),
        401,
      );
    }
  }, 30000);

  test('wrong, unknown and disabled short credentials share one non-disclosing failure', async () => {
    const active = await seed('active', null);
    const disabled = await seed('disabled', null, 'DISABLED');
    const responses = [];
    for (const body of [
      { email: active.email, password: 'wrong 密🔒' },
      { email: `missing-${RUN_ID}@example.test`, password },
      { email: disabled.email, password },
    ]) {
      const response = await call(api, 'post', '/v1/auth/login', { body });
      error(response, 401);
      responses.push(response.body.error);
    }
    for (const failure of responses) {
      const { requestId, ...rest } = failure;
      expect(requestId).toEqual(expect.any(String));
      expect(rest).toEqual({ code: 'INVALID_CREDENTIALS', message: '账号或密码不正确' });
      expect(JSON.stringify(rest)).not.toMatch(/不存在|DISABLED|password_hash/);
    }
    expect(
      (await api.pool.query('SELECT status FROM users WHERE id=$1', [disabled.id])).rows[0]!.status,
    ).toBe('DISABLED');
  }, 30000);

  test('email and username share one password-attempt budget', async () => {
    const user = await seed('budget', `b${RUN_ID.slice(0, 10)}`);
    for (let attempt = 0; attempt < 10; attempt++) {
      error(
        await call(api, 'post', '/v1/auth/login', {
          body: {
            email: attempt % 2 ? user.email : `b${RUN_ID.slice(0, 10)}`,
            password: 'wrong 密🔒',
          },
        }),
        401,
      );
    }
    error(
      await call(api, 'post', '/v1/auth/login', { body: { email: user.email, password } }),
      429,
    );
  }, 60000);

  test('a short current password can be replaced and a rejected change leaves the account untouched', async () => {
    const user = await seed('change', null);
    const loggedIn = await call(api, 'post', '/v1/auth/login', {
      body: { email: user.email, password },
    });
    const cookie = sessionCookie(loggedIn);
    const before = (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id]))
      .rows[0]!.password_hash;
    const rejected = await call(api, 'post', '/v1/auth/change-password', {
      cookie,
      body: {
        currentPassword: password,
        newPassword: 'short-pass1',
        confirmPassword: 'short-pass1',
      },
    });
    error(rejected, 422);
    expect(rejected.body.error.details.fieldErrors.password).toBe('密码需为12–128个字符');
    const wrong = await call(api, 'post', '/v1/auth/change-password', {
      cookie,
      body: {
        currentPassword: 'wrong 密🔒',
        newPassword: replacement,
        confirmPassword: replacement,
      },
    });
    error(wrong, 422);
    expect(
      (await api.pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0]!
        .password_hash,
    ).toBe(before);
    data(await call(api, 'get', '/v1/auth/session', { cookie }));
    const changed = await call(api, 'post', '/v1/auth/change-password', {
      cookie,
      body: { currentPassword: password, newPassword: replacement, confirmPassword: replacement },
    });
    expect(data(changed)).toEqual({ completed: true });
    error(await call(api, 'get', '/v1/auth/session', { cookie }), 401);
    error(
      await call(api, 'post', '/v1/auth/login', { body: { email: user.email, password } }),
      401,
    );
    const next = data<{ user: { id: string }; organizations: { id: string; role: string }[] }>(
      await call(api, 'post', '/v1/auth/login', {
        body: { email: user.email, password: replacement },
      }),
    );
    expect(next.user.id).toBe(user.id);
    expect(next.organizations).toEqual([
      { id: user.orgId, name: '合成机构 change', role: 'ORG_OWNER' },
    ]);
  }, 30000);

  test('WeChat bind and unbind check the existing password without calling WeChat', async () => {
    const user = await seed('wechat', null);
    const loggedIn = await call(api, 'post', '/v1/auth/login', {
      body: { email: user.email, password },
    });
    const cookie = sessionCookie(loggedIn);
    wechatExchanges = 0;
    const tooLong = await call(api, 'post', '/v1/auth/wechat/challenges', {
      cookie,
      body: { purpose: 'BIND', password: 'x'.repeat(129), consent: true },
    });
    error(tooLong, 422);
    expect(tooLong.body.error.details.fieldErrors.password).toBe('密码需为1–128个字符');
    error(
      await call(api, 'post', '/v1/auth/wechat/challenges', {
        cookie,
        body: { purpose: 'BIND', password: 'wrong 密🔒', consent: true },
      }),
      401,
    );
    const challenge = data<{ purpose: string }>(
      await call(api, 'post', '/v1/auth/wechat/challenges', {
        cookie,
        body: { purpose: 'BIND', password, consent: true },
      }),
    );
    expect(challenge.purpose).toBe('BIND');
    expect(wechatExchanges).toBe(0);
    await api.pool.query(
      'INSERT INTO wechat_identities(id,user_id,app_id,openid_hash) VALUES($1,$2,$3,$4)',
      [randomUUID(), user.id, appId, hashToken(`synthetic-openid-${user.id}`)],
    );
    error(
      await call(api, 'post', '/v1/auth/wechat/unbind', {
        cookie,
        body: { password: 'wrong 密🔒', expectedVersion: 1, consent: true },
      }),
      401,
    );
    expect(
      (await api.pool.query('SELECT status FROM wechat_identities WHERE user_id=$1', [user.id]))
        .rows[0]!.status,
    ).toBe('ACTIVE');
    data(
      await call(api, 'post', '/v1/auth/wechat/unbind', {
        cookie,
        body: { password, expectedVersion: 1, consent: true },
      }),
    );
    error(await call(api, 'get', '/v1/auth/session', { cookie }), 401);
    expect(
      (await api.pool.query('SELECT status FROM wechat_identities WHERE user_id=$1', [user.id]))
        .rows[0]!.status,
    ).toBe('REVOKED');
    expect(
      (
        await api.pool.query('SELECT role FROM organization_memberships WHERE user_id=$1', [
          user.id,
        ])
      ).rows[0]!.role,
    ).toBe('ORG_OWNER');
    expect(wechatExchanges).toBe(0);
  }, 30000);

  test('account closure checks the existing short password and does not partially apply a rejected attempt', async () => {
    const user = await seed('closure', null);
    const loggedIn = await call(api, 'post', '/v1/auth/login', {
      body: { email: user.email, password },
    });
    const cookie = sessionCookie(loggedIn);
    for (const value of ['', 'x'.repeat(129), 12, null]) {
      const rejected = await call(api, 'post', '/v1/account-closure/requests', {
        cookie,
        body: { clientRequestId: randomUUID(), password: value, coolingOffDays: 0 },
      });
      error(rejected, 422);
      expect(rejected.body.error.details.fieldErrors.password).toBe('密码需为1–128个字符');
    }
    const wrong = await call(api, 'post', '/v1/account-closure/requests', {
      cookie,
      body: { clientRequestId: randomUUID(), password: 'wrong 密🔒', coolingOffDays: 0 },
    });
    error(wrong, 401);
    expect(wrong.body.error.code).toBe('ACCOUNT_REAUTH_REQUIRED');
    expect(JSON.stringify(wrong.body.error)).not.toMatch(/password_hash|不存在/);
    expect(
      (
        await api.pool.query(
          'SELECT count(*)::int AS count FROM account_closure_requests WHERE user_id=$1',
          [user.id],
        )
      ).rows[0]!.count,
    ).toBe(0);
    const requested = data<{ id: string; version: number; status: string }>(
      await call(api, 'post', '/v1/account-closure/requests', {
        cookie,
        body: { clientRequestId: randomUUID(), password, coolingOffDays: 0 },
      }),
    );
    expect(requested).toMatchObject({ status: 'PENDING', version: 1 });
    expect(
      (await api.pool.query('SELECT status FROM users WHERE id=$1', [user.id])).rows[0]!.status,
    ).toBe('ACTIVE');
    expect(
      (
        await api.pool.query('SELECT role FROM organization_memberships WHERE user_id=$1', [
          user.id,
        ])
      ).rows[0]!.role,
    ).toBe('ORG_OWNER');
    data(await call(api, 'get', '/v1/auth/session', { cookie }));
    const staleCancel = await call(api, 'post', '/v1/account-closure/cancel', {
      cookie,
      body: {
        clientRequestId: randomUUID(),
        requestId: requested.id,
        expectedVersion: requested.version,
        password: 'wrong 密🔒',
      },
    });
    error(staleCancel, 401);
    expect(
      (
        await api.pool.query('SELECT status,version FROM account_closure_requests WHERE id=$1', [
          requested.id,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'PENDING', version: 1 });
    const cancelled = data<{ status: string }>(
      await call(api, 'post', '/v1/account-closure/cancel', {
        cookie,
        body: {
          clientRequestId: randomUUID(),
          requestId: requested.id,
          expectedVersion: requested.version,
          password,
        },
      }),
    );
    expect(cancelled.status).toBe('CANCELLED');
    data(await call(api, 'get', '/v1/auth/session', { cookie }));
  }, 30000);
});

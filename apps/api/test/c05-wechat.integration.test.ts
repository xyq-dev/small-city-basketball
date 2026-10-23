import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword, hashToken } from '../src/security.js';
import type { WechatConfiguration, WechatExchange } from '../src/wechat-provider.js';
import type { WechatBindingData, WechatChallengeData } from '../../../packages/contracts/wechat.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  data,
  error,
  login,
  sessionCookie,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';
const databaseUrl = testDatabaseUrl();
const configuration: WechatConfiguration = {
  enabled: true,
  appId: 'wx0000000000000001',
  appSecret: 'SYNTHETIC_WECHAT_SECRET_2026',
};
const prefix = `wx_${RUN_ID}`;
describe(
  'C05 WeChat real PostgreSQL and HTTP with explicitly injected transport, not real WeChat',
  { concurrent: false },
  () => {
    let api: Api;
    let passwordHash: string;
    let serial = 0;
    let exchanges = 0;
    const codes = new Map<string, string | Error>();
    const transport: WechatExchange = {
      async exchange(code) {
        exchanges++;
        const value = codes.get(code);
        if (value instanceof Error) throw value;
        if (!value) throw new Error('Unexpected synthetic code');
        return { appId: configuration.appId!, openid: value };
      },
    };
    const code = (openid: string) => {
      const value = `${prefix}_${++serial}`;
      codes.set(value, openid);
      return value;
    };
    beforeAll(async () => {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      passwordHash = await hashPassword(PASSWORD);
      const options = {
        databaseUrl,
        appOrigin: ORIGIN,
        wechat: { configuration, exchange: transport },
      };
      api = await createApi(options);
    });
    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    });
    async function user(label: string, org = true): Promise<User> {
      const value = {
        id: randomUUID(),
        orgId: org ? randomUUID() : '',
        email: `${label}-${prefix}-${++serial}@example.test`,
        cookie: '',
      };
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [value.id, value.email, `合成微信${label}`, passwordHash],
      );
      if (org) {
        await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          value.orgId,
          `合成微信机构${serial}`,
        ]);
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [value.orgId, value.id],
        );
      }
      value.cookie = await login(api, value);
      return value;
    }
    const challenge = async (purpose: 'LOGIN' | 'BIND', actor?: User, instance = api) =>
      data<WechatChallengeData>(
        await call(instance, 'post', '/v1/auth/wechat/challenges', {
          cookie: actor?.cookie,
          body: { purpose, consent: true, ...(purpose === 'BIND' ? { password: PASSWORD } : {}) },
        }),
      );
    const finish = (
      path: 'login' | 'bind',
      attempt: WechatChallengeData,
      jsCode: string,
      actor?: User,
      instance = api,
    ) =>
      call(instance, 'post', `/v1/auth/wechat/${path}`, {
        cookie: actor?.cookie,
        body: {
          challengeId: attempt.challengeId,
          state: attempt.state,
          code: jsCode,
          consent: true,
        },
      });
    async function bound(actor: User, openid: string) {
      return data<WechatBindingData>(
        await finish('bind', await challenge('BIND', actor), code(openid), actor),
      );
    }
    test('default disabled does not call a provider and every private/write request keeps original Origin/session guards', async () => {
      const options = {
        databaseUrl,
        appOrigin: ORIGIN,
        wechat: { configuration: { enabled: false } },
      };
      const disabled = await createApi(options);
      try {
        expect(data(await call(disabled, 'get', '/v1/auth/wechat/capabilities'))).toMatchObject({
          enabled: false,
          canRegister: false,
        });
        const before = exchanges;
        error(
          await call(disabled, 'post', '/v1/auth/wechat/challenges', {
            body: { purpose: 'LOGIN', consent: true },
          }),
          503,
        );
        expect(exchanges).toBe(before);
        error(await call(disabled, 'get', '/v1/auth/wechat/binding'), 401);
        error(
          await call(disabled, 'post', '/v1/auth/wechat/login', { origin: null, body: {} }),
          403,
        );
      } finally {
        await disabled.app.close();
        await disabled.pool.end();
      }
    });
    test('binding requires the current account password and explicit consent, not a caller user/org id', async () => {
      const actor = await user('proof');
      const before = exchanges;
      error(
        await call(api, 'post', '/v1/auth/wechat/challenges', {
          body: { purpose: 'BIND', password: PASSWORD, consent: true },
        }),
        401,
      );
      error(
        await call(api, 'post', '/v1/auth/wechat/challenges', {
          cookie: actor.cookie,
          body: { purpose: 'BIND', password: 'Incorrect synthetic password 2026', consent: true },
        }),
        401,
      );
      error(
        await call(api, 'post', '/v1/auth/wechat/challenges', {
          cookie: actor.cookie,
          body: { purpose: 'BIND', password: PASSWORD, consent: false },
        }),
        422,
      );
      error(
        await call(api, 'post', '/v1/auth/wechat/challenges', {
          cookie: actor.cookie,
          body: { purpose: 'BIND', password: PASSWORD, consent: true, userId: actor.id },
        }),
        422,
      );
      expect(exchanges).toBe(before);
    });
    test('binds then logs into the same existing participant with no new organizations or authority and no persisted raw identity/key/code', async () => {
      const actor = await user('participant', false);
      const other = await user('other');
      const openid = `SENSITIVE_OPENID_${serial}`;
      const binding = await bound(actor, openid);
      expect(binding.connected).toBe(true);
      const jsCode = code(openid);
      const response = await finish('login', await challenge('LOGIN'), jsCode);
      expect(
        data<{ user: { id: string }; organizations: unknown[]; teamContexts: unknown[] }>(response),
      ).toMatchObject({ user: { id: actor.id }, organizations: [], teamContexts: [] });
      const cookie = sessionCookie(response);
      data(await call(api, 'get', '/v1/auth/session', { cookie }));
      error(await call(api, 'get', `/v1/orgs/${other.orgId}/events`, { cookie }), 404);
      const stored = await api.pool.query(
        'SELECT to_jsonb(i) AS body FROM wechat_identities i WHERE user_id=$1',
        [actor.id],
      );
      expect(JSON.stringify(stored.rows)).not.toContain(openid);
      const attempts = await api.pool.query(
        'SELECT to_jsonb(a) AS body FROM wechat_auth_attempts a WHERE code_hash=$1',
        [hashToken(`${configuration.appId}\n${jsCode}`)],
      );
      expect(JSON.stringify(attempts.rows)).not.toContain(jsCode);
      expect(JSON.stringify(attempts.rows)).not.toContain('session_key');
    });
    test('rejects unknown identity without creating a fake user and burns a successfully claimed challenge before transport', async () => {
      const count = Number((await api.pool.query('SELECT count(*) FROM users')).rows[0].count);
      const attempt = await challenge('LOGIN');
      const before = exchanges;
      error(await finish('login', attempt, code('unbound_synthetic_openid')), 401);
      expect(exchanges).toBe(before + 1);
      error(await finish('login', attempt, code('another_openid')), 401);
      expect(exchanges).toBe(before + 1);
      expect(Number((await api.pool.query('SELECT count(*) FROM users')).rows[0].count)).toBe(
        count,
      );
      expect(
        (
          await api.pool.query('SELECT status FROM wechat_auth_attempts WHERE id=$1', [
            attempt.challengeId,
          ])
        ).rows[0].status,
      ).toBe('FAILED');
    });
    test('one challenge yields one provider call under concurrent replay; the same code cannot be exchanged with another challenge', async () => {
      const actor = await user('replay');
      const openid = `replay_${serial}`;
      await bound(actor, openid);
      const attempt = await challenge('LOGIN');
      const jsCode = code(openid);
      const before = exchanges;
      const replies = await Promise.all([
        finish('login', attempt, jsCode),
        finish('login', attempt, jsCode),
      ]);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(exchanges).toBe(before + 1);
      error(await finish('login', await challenge('LOGIN'), jsCode), 401);
      expect(exchanges).toBe(before + 1);
    });
    test('challenge is tied to purpose, session, credential fingerprint and expiry', async () => {
      const a = await user('state-a');
      const b = await user('state-b');
      const attempt = await challenge('BIND', a);
      const before = exchanges;
      error(await finish('bind', attempt, code('state_identity'), b), 401);
      const alternate = { ...a, cookie: await login(api, a) };
      error(await finish('bind', attempt, code('state_identity'), alternate), 401);
      error(await finish('login', attempt, code('state_identity')), 401);
      const expired = {
        challengeId: randomUUID(),
        state: 'E'.repeat(43),
        purpose: 'LOGIN' as const,
        expiresAt: '2020-01-01T00:00:00Z',
      };
      await api.pool.query(
        "INSERT INTO wechat_auth_attempts(id,app_id,state_hash,purpose,created_at,expires_at) VALUES($1,$2,$3,'LOGIN',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '6 minutes')",
        [expired.challengeId, configuration.appId, hashToken(expired.state)],
      );
      error(await finish('login', expired, code('state_identity')), 401);
      expect(exchanges).toBe(before);
      const fresh = await challenge('BIND', a);
      await api.pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
        a.id,
        await hashPassword('Updated synthetic password 2026'),
      ]);
      error(await finish('bind', fresh, code('state_identity'), a), 401);
      expect(exchanges).toBe(before);
    });
    test('cannot take another user identity or use AppID changes to merge accounts', async () => {
      const a = await user('unique-a');
      const b = await user('unique-b');
      const openid = `same_${serial}`;
      await bound(a, openid);
      error(await finish('bind', await challenge('BIND', b), code(openid), b), 409);
      const secondConfig = { ...configuration, appId: 'wx0000000000000002' };
      const options = {
        databaseUrl,
        appOrigin: ORIGIN,
        wechat: {
          configuration: secondConfig,
          exchange: {
            async exchange() {
              return { appId: secondConfig.appId, openid };
            },
          },
        },
      };
      const second = await createApi(options);
      try {
        error(
          await finish(
            'login',
            await challenge('LOGIN', undefined, second),
            code(openid),
            undefined,
            second,
          ),
          401,
        );
      } finally {
        await second.app.close();
        await second.pool.end();
      }
    });
    test('unbind requires current version and password, revokes all sessions and prevents old identity logins', async () => {
      const actor = await user('unlink');
      const openid = `unlink_${serial}`;
      const binding = await bound(actor, openid);
      const response = await finish('login', await challenge('LOGIN'), code(openid));
      const wxCookie = sessionCookie(response);
      const body = { password: PASSWORD, expectedVersion: binding.version, consent: true };
      error(
        await call(api, 'post', '/v1/auth/wechat/unbind', {
          cookie: actor.cookie,
          body: { ...body, expectedVersion: 999 },
        }),
        409,
      );
      data(await call(api, 'post', '/v1/auth/wechat/unbind', { cookie: actor.cookie, body }));
      for (const cookie of [actor.cookie, wxCookie])
        error(await call(api, 'get', '/v1/auth/session', { cookie }), 401);
      error(await finish('login', await challenge('LOGIN'), code(openid)), 401);
      const row = (
        await api.pool.query('SELECT * FROM wechat_identities WHERE user_id=$1', [actor.id])
      ).rows[0];
      expect(row).toMatchObject({ status: 'REVOKED', version: 2 });
      await expect(
        api.pool.query(
          "UPDATE wechat_identities SET user_id=$2,version=version+1,status='ACTIVE',revoked_at=NULL WHERE id=$1",
          [row.id, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    test('identity and audit writes roll back together while the claimed challenge remains burned', async () => {
      const actor = await user('rollback');
      const attempt = await challenge('BIND', actor);
      const functionName = `wx_fail_${RUN_ID.slice(0, 12)}`;
      await api.pool.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit rollback'; END; $$`,
      );
      await api.pool.query(
        `CREATE TRIGGER ${functionName} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='AUTH_WECHAT_BOUND' AND NEW.actor_id='${actor.id}'::uuid) EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        error(await finish('bind', attempt, code(`rollback_${serial}`), actor), 500);
        expect(
          (
            await api.pool.query(
              'SELECT count(*)::int AS count FROM wechat_identities WHERE user_id=$1',
              [actor.id],
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await api.pool.query('SELECT status FROM wechat_auth_attempts WHERE id=$1', [
              attempt.challengeId,
            ])
          ).rows[0].status,
        ).toBe('FAILED');
      } finally {
        await api.pool.query(`DROP TRIGGER ${functionName} ON audit_logs`);
        await api.pool.query(`DROP FUNCTION ${functionName}()`);
      }
    });
    test('concurrent users cannot claim one AppID-scoped identity and a mismatched provider AppID fails closed', async () => {
      const a = await user('race-a');
      const b = await user('race-b');
      const ca = await challenge('BIND', a);
      const cb = await challenge('BIND', b);
      const openid = `race_${serial}`;
      const replies = await Promise.all([
        finish('bind', ca, code(openid), a),
        finish('bind', cb, code(openid), b),
      ]);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      const options = {
        databaseUrl,
        appOrigin: ORIGIN,
        wechat: {
          configuration: { ...configuration, appId: 'wx0000000000000003' },
          exchange: transport,
        },
      };
      const mismatch = await createApi(options);
      try {
        error(
          await finish(
            'login',
            await challenge('LOGIN', undefined, mismatch),
            code(openid),
            undefined,
            mismatch,
          ),
          503,
        );
      } finally {
        await mismatch.app.close();
        await mismatch.pool.end();
      }
    });
    test('transport failure cannot be retried with the same challenge', async () => {
      const attempt = await challenge('LOGIN');
      const jsCode = code('network_failure');
      codes.set(jsCode, new Error('synthetic provider failure'));
      error(await finish('login', attempt, jsCode), 503);
      const before = exchanges;
      error(await finish('login', attempt, code('new_code')), 401);
      expect(exchanges).toBe(before);
    });
  },
);

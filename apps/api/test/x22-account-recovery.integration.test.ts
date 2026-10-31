import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { SCB_ACCOUNT_RECOVERY } from '../src/account-recovery-controller.js';
import type { AccountRecoveryService } from '../src/account-recovery-service.js';
import type {
  AccountMail,
  AccountMailProvider,
  AccountMailResult,
} from '../src/account-mail-provider.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  data,
  error,
  eventually,
  login,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

// Synthetic mailbox only. No request contacts an external mail service or real account.
const syntheticKey = Buffer.alloc(32, 0x22).toString('base64');
const applicationName = `scb_x22_${RUN_ID}`;
const url = new URL(testDatabaseUrl());
url.searchParams.set('application_name', applicationName);
const databaseUrl = url.toString();
const endpoint = (action: string) => `/v1/account-recovery/${action}`;
const resetPassword = 'X22 synthetic recovered password 2026 🏀';
const tokenFrom = (mail: AccountMail) => {
  const token = mail.text.split('\n').find((line) => /^[A-Za-z0-9_-]{43}$/.test(line));
  if (!token) throw new Error('Synthetic mailbox omitted action code');
  return token;
};
class Mailbox implements AccountMailProvider {
  sent: { id: string; mail: AccountMail }[] = [];
  state: AccountMailResult['state'] = 'ACCEPTED';
  async send(id: string, mail: AccountMail): Promise<AccountMailResult> {
    this.sent.push({ id, mail: structuredClone(mail) });
    return { state: this.state, ...(this.state === 'ACCEPTED' ? { providerId: id } : {}) };
  }
}

describe(
  'X22 real PostgreSQL recovery, cancellation and session timestamp barrier',
  { concurrent: false },
  () => {
    let api: Api, service: AccountRecoveryService;
    const mailbox = new Mailbox();
    let sequence = 0;
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
        accountRecovery: { provider: mailbox, encryptionKey: syntheticKey, autoDispatch: false },
      });
      service = api.app.get<AccountRecoveryService>(SCB_ACCOUNT_RECOVERY);
    }, 120000);
    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    }, 30000);
    async function user(label: string): Promise<User> {
      const u = {
        id: randomUUID(),
        orgId: '',
        email: `x22-${label}-${RUN_ID}@example.test`,
        cookie: '',
      };
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [u.id, u.email, '合成账号恢复 ' + label, await hashPassword(PASSWORD)],
      );
      u.cookie = await login(api, u);
      return u;
    }
    async function issue(u: User) {
      const requestId = randomUUID();
      data(
        await call(api, 'post', endpoint('reset-requests'), {
          body: { clientRequestId: requestId, email: u.email },
        }),
      );
      await service.drain();
      const mail = mailbox.sent.filter((x) => x.mail.to === u.email).at(-1);
      if (!mail) throw new Error('Synthetic mailbox not dispatched');
      return { token: tokenFrom(mail.mail), jobId: mail.id, requestId };
    }
    async function issueVerification(u: User) {
      data(
        await call(api, 'post', endpoint('verification-requests'), {
          cookie: u.cookie,
          body: { clientRequestId: randomUUID() },
        }),
      );
      await service.drain();
      const mail = mailbox.sent.filter((x) => x.mail.to === u.email).at(-1);
      if (!mail) throw new Error('Verification fixture not dispatched');
      return { token: tokenFrom(mail.mail), jobId: mail.id };
    }
    const consume = (token: string, clientRequestId = randomUUID(), newPassword = resetPassword) =>
      call(api, 'post', endpoint('consume'), { body: { clientRequestId, token, newPassword } });
    const cancel = (token: string, clientRequestId: string) =>
      call(api, 'post', endpoint('cancel'), { body: { clientRequestId, token } });
    const receipt = (token: string, clientRequestId: string) =>
      call(api, 'post', endpoint('receipts'), { body: { clientRequestId, token } });
    async function waitFor(pattern: string, count = 1) {
      return eventually(
        async () =>
          Number(
            (
              await api.pool.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND state='active' AND query LIKE $2",
                [applicationName, pattern],
              )
            ).rows[0]!.n,
          ),
        (n) => n >= count,
        'Expected the actual recovery request to reach its PostgreSQL lock barrier',
        15000,
      );
    }
    async function blockUser(u: User) {
      const c = await api.pool.connect();
      await c.query('BEGIN');
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
      return c;
    }
    async function release(c: PoolClient) {
      await c.query('ROLLBACK');
      c.release();
    }
    async function resetAtGate(
      u: User,
      token: string,
      observer: () => Promise<unknown>,
      observerPattern: string,
    ) {
      const n = sequence++,
        name = `x22_gate_${RUN_ID.slice(0, 16)}_${n}`,
        key = `x22_gate:${RUN_ID}:${n}`;
      const lock = await api.pool.connect();
      let resetting: ReturnType<typeof consume> | undefined,
        observing: Promise<unknown> | undefined;
      try {
        await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
        // A test-owned trigger pauses the real password UPDATE after the real service has the user row lock.
        await api.pool.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${u.id}'::uuid AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0));END IF;RETURN NEW;END;$$`,
        );
        await api.pool.query(
          `CREATE TRIGGER ${name} BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        resetting = consume(token);
        await waitFor('UPDATE users SET password_hash=%');
        observing = observer();
        await waitFor(observerPattern);
        await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
        data(await resetting);
        return await observing;
      } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
        if (resetting) await resetting.catch(() => {});
        if (observing) await observing.catch(() => {});
        await api.pool.query(`DROP TRIGGER IF EXISTS ${name} ON users`);
        await api.pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
        lock.release();
      }
    }
    test('successful reset is one-use, exact-body idempotent and rejects other operation IDs/tokens', async () => {
      const a = await user('one-use'),
        b = await user('wrong-user'),
        t = await issue(a),
        other = await issue(b),
        id = randomUUID();
      expect(data(await consume(t.token, id))).toEqual({
        completed: true,
        purpose: 'RESET_PASSWORD',
      });
      expect(data(await consume(t.token, id))).toEqual({
        completed: true,
        purpose: 'RESET_PASSWORD',
      });
      const wrongBody = await consume(t.token, id, 'X22 different synthetic password 2026');
      error(wrongBody, 422);
      expect(wrongBody.body.error.code).toBe('ACCOUNT_CODE_INVALID');
      error(await consume(t.token, randomUUID()), 422);
      const crossToken = await consume(other.token, id);
      error(crossToken, 409);
      expect(crossToken.body.error.code).toBe('ACCOUNT_REQUEST_CONFLICT');
      expect(data(await receipt(other.token, id))).toEqual({ completed: false, cancelled: false });
      error(await call(api, 'get', '/v1/auth/session', { cookie: a.cookie }), 401);
      const current = await login(api, a, resetPassword);
      data(await call(api, 'get', '/v1/auth/session', { cookie: current }));
    }, 120000);
    test('old-cookie lockActor waiting behind reset is rejected after the timestamp barrier commits', async () => {
      const u = await user('cookie-barrier'),
        t = await issue(u);
      const observed = await resetAtGate(
        u,
        t.token,
        () => call(api, 'get', '/v1/auth/session', { cookie: u.cookie }),
        'SELECT u.id,u.email,u.display_name,u.password_hash,u.status FROM users u WHERE%',
      );
      error(observed as Awaited<ReturnType<typeof call>>, 401);
    }, 120000);
    test('old-password login read before reset must recheck current hash after waiting on the user lock', async () => {
      const u = await user('login-barrier'),
        t = await issue(u);
      const observed = await resetAtGate(
        u,
        t.token,
        () => call(api, 'post', '/v1/auth/login', { body: { email: u.email, password: PASSWORD } }),
        'SELECT id,email,login_name,display_name,password_hash,status FROM users WHERE id=%',
      );
      const r = observed as Awaited<ReturnType<typeof call>>;
      error(r, 401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }, 120000);
    test('cancellation that acquires the operation fence first defeats a concurrent late consume', async () => {
      const u = await user('cancel-first'),
        t = await issue(u),
        id = randomUUID(),
        lock = await blockUser(u);
      let cancelling: ReturnType<typeof cancel> | undefined,
        consuming: ReturnType<typeof consume> | undefined;
      let released = false;
      try {
        cancelling = cancel(t.token, id);
        await waitFor('SELECT id,email,display_name,password_hash,status FROM users WHERE id=%');
        consuming = consume(t.token, id);
        await waitFor('SELECT pg_advisory_xact_lock(hashtextextended($1,0))');
        await release(lock);
        released = true;
        expect(data(await cancelling)).toEqual({ completed: false, cancelled: true });
        const r = await consuming;
        error(r, 410);
        expect(r.body.error.code).toBe('ACCOUNT_REQUEST_CANCELLED');
        expect(data(await receipt(t.token, id))).toEqual({ completed: false, cancelled: true });
        data(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }));
      } finally {
        if (!released) await release(lock);
        if (cancelling) await cancelling.catch(() => {});
        if (consuming) await consuming.catch(() => {});
      }
    }, 120000);
    test('consume that acquires the operation fence first leaves cancellation as a completed receipt', async () => {
      const u = await user('consume-first'),
        t = await issue(u),
        id = randomUUID(),
        lock = await blockUser(u);
      let consuming: ReturnType<typeof consume> | undefined,
        cancelling: ReturnType<typeof cancel> | undefined;
      let released = false;
      try {
        consuming = consume(t.token, id);
        await waitFor('SELECT id,email,display_name,password_hash,status FROM users WHERE id=%');
        cancelling = cancel(t.token, id);
        await waitFor('SELECT pg_advisory_xact_lock(hashtextextended($1,0))');
        await release(lock);
        released = true;
        data(await consuming);
        expect(data(await cancelling)).toEqual({ completed: true, cancelled: false });
        expect(data(await receipt(t.token, id))).toEqual({ completed: true, cancelled: false });
      } finally {
        if (!released) await release(lock);
        if (cancelling) await cancelling.catch(() => {});
        if (consuming) await consuming.catch(() => {});
      }
    }, 120000);
    test.each(['expired', 'revoked'] as const)(
      'a fresh same-account code cancels an unknown request with an %s code before a new reset',
      async (terminal) => {
        const u = await user(`unknown-${terminal}`),
          original = await issue(u),
          unknownId = randomUUID();
        // The device saved an operation ID, but its consume request never reached the API.
        expect(data(await receipt(original.token, unknownId))).toEqual({
          completed: false,
          cancelled: false,
        });
        if (terminal === 'expired') {
          await api.pool.query(
            "UPDATE account_action_tokens SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=(SELECT token_id FROM account_mail_jobs WHERE id=$1)",
            [original.jobId],
          );
          error(await cancel(original.token, unknownId), 422);
        }
        const fresh = await issue(u);
        // Fresh issuance revokes the original code; expiry/revocation still cannot authorize cancel.
        error(await cancel(original.token, unknownId), 422);
        expect(data(await cancel(fresh.token, unknownId))).toEqual({
          completed: false,
          cancelled: true,
        });
        expect(data(await receipt(fresh.token, unknownId))).toEqual({
          completed: false,
          cancelled: true,
        });
        // The tombstone wins even if the lost original request arrives after cancellation.
        const delayed = await consume(original.token, unknownId);
        error(delayed, 410);
        expect(delayed.body.error.code).toBe('ACCOUNT_REQUEST_CANCELLED');
        const reusedId = await consume(fresh.token, unknownId);
        error(reusedId, 410);
        expect(reusedId.body.error.code).toBe('ACCOUNT_REQUEST_CANCELLED');
        // Cancellation neither consumes the fresh code nor resets credentials.
        data(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }));
        const newId = randomUUID();
        expect(data(await consume(fresh.token, newId))).toEqual({
          completed: true,
          purpose: 'RESET_PASSWORD',
        });
        expect(data(await receipt(original.token, newId))).toEqual({
          completed: true,
          cancelled: false,
        });
        expect(data(await cancel(fresh.token, newId))).toEqual({
          completed: true,
          cancelled: false,
        });
        error(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }), 401);
      },
      120000,
    );
    test('UNKNOWN provider outcomes are not resent and new requests revoke and erase the old pending envelope', async () => {
      const u = await user('unknown-worker');
      mailbox.state = 'UNKNOWN';
      const first = await issue(u),
        before = mailbox.sent.length;
      await service.drain();
      expect(mailbox.sent).toHaveLength(before);
      const pending = (
        await api.pool.query('SELECT status,envelope FROM account_mail_jobs WHERE id=$1', [
          first.jobId,
        ])
      ).rows[0];
      expect(pending.status).toBe('UNKNOWN');
      expect(Buffer.isBuffer(pending.envelope)).toBe(true);
      mailbox.state = 'ACCEPTED';
      const second = await issue(u);
      expect(second.token).not.toBe(first.token);
      expect(mailbox.sent.filter((x) => x.id === first.jobId)).toHaveLength(1);
      const old = (
        await api.pool.query('SELECT status,envelope FROM account_mail_jobs WHERE id=$1', [
          first.jobId,
        ])
      ).rows[0];
      expect(old).toEqual({ status: 'EXPIRED', envelope: null });
      error(await consume(first.token), 422);
      const fresh = (
        await api.pool.query('SELECT status,envelope FROM account_mail_jobs WHERE id=$1', [
          second.jobId,
        ])
      ).rows[0];
      expect(fresh).toEqual({ status: 'ACCEPTED', envelope: null });
    }, 120000);
    test('email verification rejects reset payloads, expiry and revoked codes while preserving valid sessions', async () => {
      const u = await user('verify-purpose');
      expect(data(await call(api, 'get', endpoint('me'), { cookie: u.cookie }))).toMatchObject({
        emailVerified: false,
      });
      const first = await issueVerification(u);
      const wrongPurpose = await consume(first.token);
      error(wrongPurpose, 422);
      expect(wrongPurpose.body.error.code).toBe('ACCOUNT_CODE_INVALID');
      const operation = randomUUID();
      expect(
        data(
          await call(api, 'post', endpoint('consume'), {
            body: { clientRequestId: operation, token: first.token },
          }),
        ),
      ).toEqual({ completed: true, purpose: 'VERIFY_EMAIL' });
      expect(data(await call(api, 'get', endpoint('me'), { cookie: u.cookie }))).toMatchObject({
        emailVerified: true,
      });
      data(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }));
      expect(
        (await api.pool.query('SELECT credential_reset_at FROM users WHERE id=$1', [u.id])).rows[0]
          .credential_reset_at,
      ).toBeNull();
      const expired = await issueVerification(u);
      await api.pool.query(
        "UPDATE account_action_tokens SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=(SELECT token_id FROM account_mail_jobs WHERE id=$1)",
        [expired.jobId],
      );
      error(
        await call(api, 'post', endpoint('consume'), {
          body: { clientRequestId: randomUUID(), token: expired.token },
        }),
        422,
      );
      const old = await issueVerification(u),
        latest = await issueVerification(u);
      error(
        await call(api, 'post', endpoint('consume'), {
          body: { clientRequestId: randomUUID(), token: old.token },
        }),
        422,
      );
      expect(
        data(
          await call(api, 'post', endpoint('consume'), {
            body: { clientRequestId: randomUUID(), token: latest.token },
          }),
        ),
      ).toEqual({ completed: true, purpose: 'VERIFY_EMAIL' });
    }, 120000);
    test('wrong mail encryption key fails startup closed with a nonempty encrypted job and does not send or mutate it', async () => {
      const u = await user('wrong-encryption');
      mailbox.state = 'UNKNOWN';
      const t = await issue(u);
      mailbox.state = 'ACCEPTED';
      const before = (
        await api.pool.query('SELECT status,envelope FROM account_mail_jobs WHERE id=$1', [t.jobId])
      ).rows[0];
      expect(before.status).toBe('UNKNOWN');
      expect(Buffer.isBuffer(before.envelope)).toBe(true);
      const keyBefore = (
        await api.pool.query('SELECT key_id FROM account_mail_configuration WHERE singleton=true')
      ).rows[0].key_id;
      const countBefore = mailbox.sent.length;
      await expect(
        createApi({
          databaseUrl,
          appOrigin: ORIGIN,
          accountRecovery: {
            provider: mailbox,
            encryptionKey: Buffer.alloc(32, 0x33).toString('base64'),
            autoDispatch: false,
          },
        }),
      ).rejects.toThrow('Account mail key does not match stored configuration');
      expect(mailbox.sent).toHaveLength(countBefore);
      expect(
        (await api.pool.query('SELECT key_id FROM account_mail_configuration WHERE singleton=true'))
          .rows[0].key_id,
      ).toBe(keyBefore);
      const after = (
        await api.pool.query('SELECT status,envelope FROM account_mail_jobs WHERE id=$1', [t.jobId])
      ).rows[0];
      expect(after.status).toBe(before.status);
      expect(Buffer.from(after.envelope).equals(before.envelope)).toBe(true);
      data(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }));
    }, 120000);
  },
);

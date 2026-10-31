import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { AccountClosureService } from '../src/account-closure-service.js';
import type { AccountClosureHooks } from '../src/account-closure-service.js';
import { ACCOUNT_CLOSURE_DOMAINS } from '../src/account-closure-domain.js';
import { createAccountClosureHooks } from '../src/account-closure-hooks.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  data,
  error,
  login,
  register,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

// Real PostgreSQL tests for E07 orchestration. Other domains' provider-specific hooks
// are integration-owned and covered by their own suites, never simulated as money settled.
const databaseUrl = testDatabaseUrl();
describe(
  'E07 PostgreSQL closure authorization, fencing and atomic finalization',
  { concurrent: false },
  () => {
    let api: Api;
    const hooks = createAccountClosureHooks({
      streaming: { inspect: async () => [], revoke: async () => {} },
      insurance: { inspect: async () => [], revoke: async () => {} },
      trade: { assertSafe: async () => {} },
      notifications: { revoke: async () => {} },
      guardians: { revoke: async () => {} },
    })!;
    const make = (override: Partial<AccountClosureHooks> = {}) =>
      new AccountClosureService(
        api.pool,
        { databaseUrl, appOrigin: ORIGIN },
        { enabled: true, autoDispatch: false, hooks: { ...hooks, ...override } },
      );
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
        accountClosure: { autoDispatch: false },
      });
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
        email: `e07-${label}-${RUN_ID}@example.test`,
        cookie: '',
      };
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [u.id, u.email, '合成注销账号 ' + label, await hashPassword(PASSWORD)],
      );
      u.cookie = await login(api, u);
      return u;
    }
    const requestInput = (days = 0, id = randomUUID()) => ({
      clientRequestId: id,
      password: PASSWORD,
      coolingOffDays: days,
    });
    test('default zero closes only after worker checks; preserves row/history and revokes old session by barrier', async () => {
      const u = await user('close'),
        service = make();
      const r = await service.request(u.cookie, {
        clientRequestId: randomUUID(),
        password: PASSWORD,
      });
      expect(r).toMatchObject({ status: 'PENDING', coolingOffDays: 0 });
      expect(
        (await api.pool.query('SELECT status FROM users WHERE id=$1', [u.id])).rows[0].status,
      ).toBe('ACTIVE');
      expect(await service.processOne(r.id)).toBe('CLOSED');
      const closed = (await api.pool.query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
      expect(closed).toMatchObject({
        id: u.id,
        status: 'DISABLED',
        email: `${u.id}@closed.invalid`,
        display_name: '已注销用户',
      });
      expect(closed.credential_reset_at).toBeTruthy();
      expect(
        (await api.pool.query('SELECT * FROM account_closure_tombstones WHERE user_id=$1', [u.id]))
          .rowCount,
      ).toBe(1);
      expect(
        (
          await api.pool.query('SELECT revoked_at FROM sessions WHERE user_id=$1', [u.id])
        ).rows.every((s) => s.revoked_at === null),
      ).toBe(true);
      error(await call(api, 'get', '/v1/auth/session', { cookie: u.cookie }), 401);
      error(
        await call(api, 'post', '/v1/auth/login', { body: { email: u.email, password: PASSWORD } }),
        401,
      );
      await expect(
        api.pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [u.id]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await service.processOne(r.id)).toBe('SKIPPED');
      await expect(
        api.pool.query('DELETE FROM account_closure_tombstones WHERE user_id=$1', [u.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    test('concurrent identical commands yield one request and one immutable receipt; changed payload conflicts', async () => {
      const u = await user('idempotency'),
        service = make(),
        input = requestInput(7);
      const [a, b] = await Promise.all([
        service.request(u.cookie, input),
        service.request(u.cookie, input),
      ]);
      expect(a.id).toBe(b.id);
      expect(
        (await api.pool.query('SELECT * FROM account_closure_requests WHERE user_id=$1', [u.id]))
          .rowCount,
      ).toBe(1);
      await expect(
        service.request(u.cookie, { ...input, coolingOffDays: 6 }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(await service.processOne(a.id)).toBe('SKIPPED');
    });
    test('current password is required and cooling cancellation is idempotent with a permanent receipt', async () => {
      const u = await user('cancel'),
        service = make();
      await expect(
        service.request(u.cookie, { ...requestInput(), password: 'incorrect synthetic password' }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_REAUTH_REQUIRED' });
      const r = await service.request(u.cookie, requestInput(7));
      const input = {
        clientRequestId: randomUUID(),
        requestId: r.id,
        expectedVersion: r.version,
        password: PASSWORD,
      };
      await expect(
        service.cancel(u.cookie, { ...input, expectedVersion: 99 }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await service.cancel(u.cookie, input)).status).toBe('CANCELLED');
      expect((await service.cancel(u.cookie, input)).status).toBe('CANCELLED');
      expect(await service.processOne(r.id)).toBe('SKIPPED');
      const disabled = new AccountClosureService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      expect(disabled.capabilities().enabled).toBe(false);
      expect((await disabled.cancel(u.cookie, input)).status).toBe('CANCELLED');
    });
    test('credential maintenance expires prior confirmation even before its requested execution date', async () => {
      const u = await user('security'),
        service = make();
      const r = await service.request(u.cookie, requestInput(7));
      // Fixture emulates the committed credential-reset barrier; no closure outcome is forged.
      await api.pool.query(
        'UPDATE users SET credential_reset_at=clock_timestamp(),password_hash=$2 WHERE id=$1',
        [u.id, await hashPassword(PASSWORD)],
      );
      expect(await service.processOne(r.id)).toBe('EXPIRED_AUTH');
      expect(
        (await api.pool.query('SELECT status FROM users WHERE id=$1', [u.id])).rows[0].status,
      ).toBe('ACTIVE');
      expect(
        (await api.pool.query('SELECT * FROM account_closure_tombstones WHERE user_id=$1', [u.id]))
          .rowCount,
      ).toBe(0);
    });
    test('a sole operating organization owner remains blocked with its rights intact', async () => {
      const u = await register(api, 'e07-owner'),
        service = make();
      const r = await service.request(u.cookie, requestInput());
      expect(await service.processOne(r.id)).toBe('BLOCKED');
      const current = (await service.workspace(u.cookie)).request!;
      expect(current.blockers).toContain('OWNER_TRANSFER_REQUIRED');
      expect(
        (
          await api.pool.query(
            'SELECT status FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
            [u.orgId, u.id],
          )
        ).rows[0].status,
      ).toBe('ACTIVE');
    });
    test('unresolved external-domain facts block and can be reevaluated without clearing history', async () => {
      const u = await user('blocked');
      let unsettled = true;
      const service = make({
        lockAndInspect: async () => (unsettled ? ['TRADE_MONEY_UNRESOLVED'] : []),
      });
      const r = await service.request(u.cookie, requestInput());
      expect(await service.processOne(r.id)).toBe('BLOCKED');
      expect((await service.workspace(u.cookie)).request?.blockers).toEqual([
        'TRADE_MONEY_UNRESOLVED',
      ]);
      unsettled = false;
      expect(await service.processOne(r.id)).toBe('CLOSED');
    });
    test('busy cross-resource locks return retry and roll back before any closure mutation', async () => {
      const u = await user('lock'),
        held = await api.pool.connect();
      const key = `e07-resource-${u.id}`;
      try {
        await held.query('BEGIN');
        await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
        const service = make({
          lockAndInspect: async (c) => {
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
            return [];
          },
        });
        const r = await service.request(u.cookie, requestInput());
        expect(await service.processOne(r.id)).toBe('RETRY');
        expect((await service.workspace(u.cookie)).request?.status).toBe('PENDING');
        expect(
          (
            await api.pool.query('SELECT * FROM account_closure_tombstones WHERE user_id=$1', [
              u.id,
            ])
          ).rowCount,
        ).toBe(0);
        await held.query('ROLLBACK');
        expect(await service.processOne(r.id)).toBe('CLOSED');
      } finally {
        await held.query('ROLLBACK');
        held.release();
      }
    });
    test('revoke failure rolls back all business changes and leaves account usable', async () => {
      const u = await user('rollback');
      const service = make({
        revoke: async (c) => {
          await c.query("UPDATE users SET display_name='should roll back' WHERE id=$1", [u.id]);
          throw new Error('synthetic hook failure');
        },
      });
      const r = await service.request(u.cookie, requestInput());
      await expect(service.processOne(r.id)).rejects.toThrow('synthetic hook failure');
      const current = (
        await api.pool.query('SELECT status,display_name FROM users WHERE id=$1', [u.id])
      ).rows[0];
      expect(current).toEqual({ status: 'ACTIVE', display_name: '合成注销账号 rollback' });
      expect(
        (await api.pool.query('SELECT * FROM account_closure_tombstones WHERE user_id=$1', [u.id]))
          .rowCount,
      ).toBe(0);
      expect((await service.workspace(u.cookie)).request?.status).toBe('PENDING');
    });
    test('expiry during revocation rolls back deidentification and never commits a late lease', async () => {
      const u = await user('expired-lease');
      const service = make({
        revoke: async (c) => {
          // Controlled lease expiry tests the final database-clock predicate, not a terminal result fixture.
          await c.query(
            "UPDATE account_closure_requests SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND lease_id IS NOT NULL",
            [u.id],
          );
        },
      });
      const r = await service.request(u.cookie, requestInput());
      expect(await service.processOne(r.id)).toBe('RETRY');
      expect(
        (await api.pool.query('SELECT status,email FROM users WHERE id=$1', [u.id])).rows[0],
      ).toEqual({ status: 'ACTIVE', email: u.email });
      expect(
        (await api.pool.query('SELECT * FROM account_closure_tombstones WHERE user_id=$1', [u.id]))
          .rowCount,
      ).toBe(0);
      expect((await service.workspace(u.cookie)).request?.status).toBe('PENDING');
    });
    test('closure revokes an actual independently published personal archive without deleting its history', async () => {
      const u = await user('archive'),
        service = make();
      const profile = data<{ id: string; version: number }>(
        await call(api, 'post', '/v1/me/public-archives', {
          cookie: u.cookie,
          body: { commandId: randomUUID(), kind: 'PLAYER', displayName: '合成公开档案' },
        }),
      );
      const published = data<{ publicKey: string }>(
        await call(api, 'post', `/v1/me/public-archives/${profile.id}/commands`, {
          cookie: u.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: profile.version,
            type: 'PUBLISH',
            publicConsent: true,
          },
        }),
      );
      const r = await service.request(u.cookie, requestInput());
      expect(await service.processOne(r.id)).toBe('CLOSED');
      expect(
        (
          await api.pool.query(
            'SELECT status,public_key FROM public_archive_profiles WHERE id=$1',
            [profile.id],
          )
        ).rows[0],
      ).toEqual({ status: 'REVOKED', public_key: null });
      expect(
        (
          await api.pool.query(
            'SELECT status FROM public_archive_publications WHERE public_key=$1',
            [published.publicKey],
          )
        ).rows[0].status,
      ).toBe('REVOKED');
      error(await call(api, 'get', `/v1/public/archives/${published.publicKey}`), 404);
    });
    test('missing one required domain closes capability and prevents any new request', async () => {
      const u = await user('closed-config');
      const service = make({ domains: ACCOUNT_CLOSURE_DOMAINS.filter((x) => x !== 'STREAMING') });
      expect(service.capabilities().enabled).toBe(false);
      await expect(service.request(u.cookie, requestInput())).rejects.toMatchObject({
        code: 'ACCOUNT_CLOSURE_DISABLED',
      });
      expect(
        (await api.pool.query('SELECT * FROM account_closure_requests WHERE user_id=$1', [u.id]))
          .rowCount,
      ).toBe(0);
    });
  },
);

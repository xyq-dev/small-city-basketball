import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { CommerceService } from '../src/commerce/service.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { activateEventCommerce } from '../src/commerce/activation.js';
import { makeQuote } from '../src/commerce/domain.js';
import type { CommerceCommandResult } from '@small-city-basketball/contracts';
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
  createEvent,
  data,
  error,
  eventually,
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
    test('a paid software order blocks until that exact entitlement is activated; another event activation does not clear it', async () => {
      const buyer = await register(api, 'e07-software-buyer'),
        submitter = await user('software-submitter'),
        reviewer = await user('software-reviewer');
      const commerce = new CommerceService(api.pool, {
        databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED',
      });
      for (const actor of [submitter, reviewer])
        await maintainPlatformOperator(api.pool, {
          email: actor.email,
          status: 'ACTIVE',
          reason: '合成注销软件订单独立复核',
        });
      const plan = (
        await commerce.createPlan(submitter.cookie, {
          commandId: randomUUID(),
          code: 'e07_' + RUN_ID.slice(0, 12),
          name: '合成注销软件套餐',
          currency: 'CNY',
          amountFen: 9900,
          maxTeams: 32,
          maxMatches: 1024,
          validDays: 365,
          reason: '合成注销资格核验',
        })
      ).plan;
      async function paidEvent(label: string) {
        const event = await createEvent(api, buyer, label);
        const created = (
          (await commerce.createOrder(buyer.cookie, buyer.orgId, {
            commandId: randomUUID(),
            eventId: event.id,
            planId: plan.id,
            expectedEventVersion: event.version,
          })) as CommerceCommandResult
        ).order;
        const submitted = await commerce.platformCommand(submitter.cookie, created.id, {
          commandId: randomUUID(),
          type: 'SUBMIT_PAYMENT',
          expectedOrderVersion: created.version,
          externalReference: 'e07-synthetic-' + randomUUID(),
          reason: '合成离线收款提交',
        });
        const confirmed = await commerce.platformCommand(reviewer.cookie, created.id, {
          commandId: randomUUID(),
          type: 'CONFIRM_PAYMENT',
          expectedOrderVersion: submitted.order.version,
          reason: '合成独立核对到账',
        });
        expect(confirmed.order.status).toBe('PAID');
        const entitlement = (
          await api.pool.query('SELECT id,order_id FROM event_entitlements WHERE order_id=$1', [
            created.id,
          ])
        ).rows[0];
        expect(entitlement.order_id).toBe(created.id);
        return { event, order: confirmed.order, entitlement };
      }
      async function activate(target: Awaited<ReturnType<typeof paidEvent>>) {
        const c = await api.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [buyer.orgId]);
          await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
            buyer.orgId,
            target.event.id,
          ]);
          await activateEventCommerce(c, {
            orgId: buyer.orgId,
            eventId: target.event.id,
            participantCount: 2,
            expectedMatchCount: 1,
            mode: 'ENFORCED',
            actorId: buyer.id,
          });
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        } finally {
          c.release();
        }
        expect(
          (
            await api.pool.query(
              'SELECT source,entitlement_id FROM event_commercial_activations WHERE org_id=$1 AND event_id=$2',
              [buyer.orgId, target.event.id],
            )
          ).rows[0],
        ).toEqual({ source: 'PAID', entitlement_id: target.entitlement.id });
      }
      const service = make(),
        first = await paidEvent('合成待激活软件赛事');
      const request = await service.request(buyer.cookie, requestInput());
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toEqual([
        'OWNER_TRANSFER_REQUIRED',
        'SOFTWARE_MONEY_UNRESOLVED',
      ]);
      await activate(first);
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toEqual([
        'OWNER_TRANSFER_REQUIRED',
      ]);
      const second = await paidEvent('合成另一待激活软件赛事');
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toContain(
        'SOFTWARE_MONEY_UNRESOLVED',
      );
      await activate(second);
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toEqual([
        'OWNER_TRANSFER_REQUIRED',
      ]);
      expect(
        (
          await api.pool.query(
            'SELECT id,status FROM billing_orders WHERE id=ANY($1::uuid[]) ORDER BY id',
            [[first.order.id, second.order.id]],
          )
        ).rows,
      ).toEqual(
        [first.order, second.order]
          .map((o) => ({ id: o.id, status: 'PAID' }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    }, 30000);
    test('an unresolved manual payment claim blocks after quote expiry and replacement; independent rejection clears only that claim', async () => {
      const buyer = await register(api, 'e07-review-buyer'),
        submitter = await user('review-submitter'),
        reviewer = await user('review-reviewer');
      const commerce = new CommerceService(api.pool, {
        databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED',
      });
      for (const actor of [submitter, reviewer])
        await maintainPlatformOperator(api.pool, {
          email: actor.email,
          status: 'ACTIVE',
          reason: '合成过期到账申明独立复核',
        });
      const plan = (
        await commerce.createPlan(submitter.cookie, {
          commandId: randomUUID(),
          code: 'e07_review_' + RUN_ID.slice(0, 12),
          name: '合成到账申明核对套餐',
          currency: 'CNY',
          amountFen: 9900,
          maxTeams: 32,
          maxMatches: 1024,
          validDays: 365,
          reason: '合成注销待核到账测试',
        })
      ).plan;
      const event = await createEvent(api, buyer, '合成报价过期待核到账赛事'),
        orderId = randomUUID();
      const planRow = (
        await api.pool.query('SELECT * FROM billing_plan_versions WHERE id=$1', [plan.id])
      ).rows[0];
      // Only initial historical pending data is seeded. All payment-review and order
      // transitions below use real commands, with immutable quote/expiry guards intact.
      await api.pool.query(
        `INSERT INTO billing_orders(id,org_id,event_id,plan_id,quote,amount_fen,currency,out_trade_no,created_by,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,'CNY',$7,$8,
           statement_timestamp()-interval '24 hours'+interval '8 seconds',statement_timestamp()+interval '8 seconds')`,
        [
          orderId,
          buyer.orgId,
          event.id,
          plan.id,
          JSON.stringify(makeQuote(planRow)),
          planRow.amount_fen,
          orderId.replaceAll('-', ''),
          buyer.id,
        ],
      );
      const submitted = await commerce.platformCommand(submitter.cookie, orderId, {
        commandId: randomUUID(),
        type: 'SUBMIT_PAYMENT',
        expectedOrderVersion: 1,
        externalReference: 'e07-review-synthetic-' + randomUUID(),
        reason: '合成到账申明提交待独立核对',
      });
      expect(submitted.order.status).toBe('PENDING_PAYMENT');
      await eventually(
        async () =>
          (
            await api.pool.query(
              'SELECT expires_at<=clock_timestamp() AS expired FROM billing_orders WHERE id=$1',
              [orderId],
            )
          ).rows[0].expired as boolean,
        (expired) => expired,
        'Synthetic quote did not expire under the database clock',
        15000,
      );
      const service = make(),
        request = await service.request(buyer.cookie, requestInput());
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toEqual([
        'OWNER_TRANSFER_REQUIRED',
        'SOFTWARE_MONEY_UNRESOLVED',
      ]);
      const replacement = (
        (await commerce.createOrder(buyer.cookie, buyer.orgId, {
          commandId: randomUUID(),
          eventId: event.id,
          planId: plan.id,
          expectedEventVersion: event.version,
        })) as CommerceCommandResult
      ).order;
      expect(replacement.id).not.toBe(orderId);
      await commerce.buyerCommand(buyer.cookie, buyer.orgId, replacement.id, {
        commandId: randomUUID(),
        type: 'CANCEL',
        expectedOrderVersion: replacement.version,
        reason: '合成取消新报价以单独核验旧到账申明',
      });
      const expired = (
        await api.pool.query('SELECT status,version,channel FROM billing_orders WHERE id=$1', [
          orderId,
        ])
      ).rows[0];
      expect(expired).toMatchObject({ status: 'EXPIRED', channel: null });
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toContain(
        'SOFTWARE_MONEY_UNRESOLVED',
      );
      await expect(
        commerce.platformCommand(submitter.cookie, orderId, {
          commandId: randomUUID(),
          type: 'REJECT_PAYMENT',
          expectedOrderVersion: expired.version,
          reason: '合成提交人不能自行终结申明',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        commerce.platformCommand(reviewer.cookie, orderId, {
          commandId: randomUUID(),
          type: 'CONFIRM_PAYMENT',
          expectedOrderVersion: expired.version,
          reason: '合成过期报价不能确认到账',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ORDER_STATE' });
      const rejected = await commerce.platformCommand(reviewer.cookie, orderId, {
        commandId: randomUUID(),
        type: 'REJECT_PAYMENT',
        expectedOrderVersion: expired.version,
        reason: '合成独立核对未到账并终结本次申明',
      });
      expect(rejected.order.status).toBe('EXPIRED');
      expect(
        (
          await api.pool.query(
            'SELECT status,submitted_by,reviewed_by FROM billing_payment_reviews WHERE order_id=$1',
            [orderId],
          )
        ).rows,
      ).toEqual([{ status: 'REJECTED', submitted_by: submitter.id, reviewed_by: reviewer.id }]);
      expect(await service.processOne(request.id)).toBe('BLOCKED');
      expect((await service.workspace(buyer.cookie)).request?.blockers).toEqual([
        'OWNER_TRANSFER_REQUIRED',
      ]);
    }, 30000);
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

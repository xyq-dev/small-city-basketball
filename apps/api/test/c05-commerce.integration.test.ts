import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  CommerceCommandResult,
  CommercePlanData,
  CommerceWorkspaceData,
  EventSchedulingData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { CommerceService } from '../src/commerce/service.js';
import { activateEventCommerce } from '../src/commerce/activation.js';
import { createCommerceSystemActor } from '../src/commerce/system-actor.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  createEvent,
  data,
  error,
  login,
  membership,
} from './support.js';
import type { User } from './support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  publish,
  revision,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
const root = '/v1/platform/commerce';
const org = (id: string) => `/v1/orgs/${id}/commerce`;
const why = '合成隔离商业核验记录';
const head = 'order_id,transaction_reference,amount,currency,status';
describe(
  'C05 per-event commercial ledger on real isolated PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    let reviewer: User;
    let plan: CommercePlanData;
    beforeAll(async () => {
      h = await createHarness(2);
      await h.api.app.close();
      await h.api.pool.end();
      h.api = await createApi({
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED',
      });
      reviewer = {
        id: randomUUID(),
        orgId: '',
        email: `c05-reviewer-${RUN_ID}@example.test`,
        cookie: '',
      };
      await h.api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [reviewer.id, reviewer.email, '合成独立财务复核', await hashPassword(PASSWORD)],
      );
      reviewer.cookie = await login(h.api, reviewer);
      for (const user of [h.otherOwner, reviewer])
        await maintainPlatformOperator(h.api.pool, {
          email: user.email,
          status: 'ACTIVE',
          reason: why,
        });
      plan = data<{ plan: CommercePlanData }>(
        await call(h.api, 'post', `${root}/plans`, {
          cookie: h.otherOwner.cookie,
          body: {
            commandId: randomUUID(),
            code: `c05_${RUN_ID.slice(0, 12)}`,
            name: '合成按届软件',
            currency: 'CNY',
            amountFen: 9900,
            maxTeams: 32,
            maxMatches: 1024,
            validDays: 365,
            reason: why,
          },
        }),
      ).plan;
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);
    async function workspace(user = h.owner, platform = false) {
      return data<CommerceWorkspaceData>(
        await call(h.api, 'get', platform ? root : org(user.orgId), { cookie: user.cookie }),
      );
    }
    async function fresh(id: string) {
      return (await workspace(h.otherOwner, true)).orders.find((o) => o.id === id)!;
    }
    test('offline operator grants persist a real disabled non-login audit actor without granting it application permissions', async () => {
      for (const user of [h.otherOwner, reviewer]) {
        const row = (
          await h.api.pool.query(
            `SELECT u.id,u.status,u.password_hash,u.login_name,a.actor_id,
            (SELECT count(*)::int FROM organization_memberships WHERE user_id=u.id) AS memberships,
            (SELECT count(*)::int FROM sessions WHERE user_id=u.id) AS sessions,
            (SELECT count(*)::int FROM platform_operators WHERE user_id=u.id) AS platform_roles
            FROM platform_operators p JOIN users u ON u.id=p.maintenance_actor_id
            JOIN audit_logs a ON a.actor_id=u.id AND a.resource_id=p.user_id
            WHERE p.user_id=$1 AND a.action='commerce.platform_operator.granted'`,
            [user.id],
          )
        ).rows[0]!;
        expect(row).toMatchObject({
          status: 'DISABLED',
          login_name: null,
          memberships: 0,
          sessions: 0,
          platform_roles: 0,
        });
        expect(row.actor_id).toBe(row.id);
        expect(row.id).not.toBe(user.id);
        expect(row.password_hash).not.toMatch(/^scrypt\$/);
      }
    });
    test('an audit constraint failure rolls back its system identity without leaving an orphan user', async () => {
      const client = await h.api.pool.connect();
      let actorId = '';
      try {
        await client.query('BEGIN');
        actorId = await createCommerceSystemActor(client, 'LEDGER');
        await expect(
          client.query(
            `INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata)
          VALUES($1,NULL,$2,$3,'user',$4,'{}'::jsonb)`,
            [randomUUID(), actorId, 'x'.repeat(81), h.owner.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect((await h.api.pool.query('SELECT id FROM users WHERE id=$1', [actorId])).rowCount).toBe(
        0,
      );
    });
    async function order(eventId?: string) {
      const e = eventId
        ? (await h.api.pool.query('SELECT id,version FROM events WHERE id=$1', [eventId])).rows[0]!
        : await createEvent(h.api, h.owner, `合成商业${randomUUID().slice(0, 8)}`);
      return data<CommerceCommandResult>(
        await call(h.api, 'post', `${org(h.owner.orgId)}/orders`, {
          cookie: h.owner.cookie,
          body: {
            commandId: randomUUID(),
            eventId: e.id,
            planId: plan.id,
            expectedEventVersion: e.version,
          },
        }),
      ).order;
    }
    async function platform(
      id: string,
      type: string,
      user = h.otherOwner,
      extra: Record<string, unknown> = {},
    ) {
      const current = await fresh(id);
      return call(h.api, 'post', `${root}/orders/${id}/commands`, {
        cookie: user.cookie,
        body: {
          commandId: randomUUID(),
          type,
          expectedOrderVersion: current.version,
          reason: why,
          ...extra,
        },
      });
    }
    async function paid(eventId?: string) {
      let o = await order(eventId);
      data(
        await platform(o.id, 'SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `bank-pay-${randomUUID()}`,
        }),
      );
      o = data<CommerceCommandResult>(await platform(o.id, 'CONFIRM_PAYMENT', reviewer)).order;
      return o;
    }
    test('platform rights are independent from organization ownership and every financial endpoint is tenant checked', async () => {
      expect(
        (
          await h.api.pool.query(
            'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
            [h.owner.orgId, h.otherOwner.id],
          )
        ).rows,
      ).toEqual([{ role: 'EVENT_MANAGER', status: 'ACTIVE' }]);
      expect(
        (
          await h.api.pool.query(
            'SELECT user_id FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
            [h.owner.orgId, reviewer.id],
          )
        ).rowCount,
      ).toBe(0);
      error(await call(h.api, 'get', root, { cookie: h.owner.cookie }), 403);
      error(await call(h.api, 'get', org(h.owner.orgId), { cookie: h.otherOwner.cookie }), 403);
      error(await call(h.api, 'get', org(h.owner.orgId), { cookie: reviewer.cookie }), 404);
      error(await call(h.api, 'get', org(h.owner.orgId)), 401);
      const o = await order();
      error(
        await call(h.api, 'post', `${org(h.otherOwner.orgId)}/orders/${o.id}/commands`, {
          cookie: h.otherOwner.cookie,
          body: {
            commandId: randomUUID(),
            type: 'CANCEL',
            expectedOrderVersion: o.version,
            reason: why,
          },
        }),
        404,
      );
      expect((await fresh(o.id)).status).toBe('PENDING_PAYMENT');
    });
    test('freezes integer CNY quotes, requires two distinct operators, excludes the purchasing organization and makes settlement idempotent', async () => {
      const o = await order();
      const submitted = data<CommerceCommandResult>(
        await platform(o.id, 'SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `bank-pay-${randomUUID()}`,
        }),
      );
      error(await platform(o.id, 'CONFIRM_PAYMENT', h.otherOwner), 403);
      await membership(h.api, h.owner, reviewer, 'EVENT_MANAGER');
      error(await platform(o.id, 'CONFIRM_PAYMENT', reviewer), 403);
      await membership(h.api, h.owner, reviewer, 'EVENT_MANAGER', 'DISABLED');
      const command = {
        commandId: randomUUID(),
        type: 'CONFIRM_PAYMENT',
        expectedOrderVersion: submitted.order.version,
        reason: why,
      };
      const response = await call(h.api, 'post', `${root}/orders/${o.id}/commands`, {
        cookie: reviewer.cookie,
        body: command,
      });
      expect(data<CommerceCommandResult>(response).order).toMatchObject({
        status: 'PAID',
        quote: { amountFen: 9900, currency: 'CNY' },
        channel: 'MANUAL',
      });
      data(
        await call(h.api, 'post', `${root}/orders/${o.id}/commands`, {
          cookie: reviewer.cookie,
          body: command,
        }),
      );
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM event_entitlements WHERE order_id=$1',
            [o.id],
          )
        ).rows[0]!.n,
      ).toBe(1);
      const audits = (
        await h.api.pool.query(
          `SELECT a.actor_id,u.status,u.password_hash FROM audit_logs a JOIN users u ON u.id=a.actor_id
          WHERE a.resource_id=$1 AND a.action='commerce.order.paid'`,
          [o.id],
        )
      ).rows;
      expect(audits).toHaveLength(1);
      expect(audits[0]!.status).toBe('DISABLED');
      expect(audits[0]!.actor_id).not.toBe(h.owner.id);
      expect(audits[0]!.actor_id).not.toBe(reviewer.id);
      expect(audits[0]!.password_hash).not.toMatch(/^scrypt\$/);
      await expect(
        h.api.pool.query('UPDATE billing_orders SET amount_fen=1,version=version+1 WHERE id=$1', [
          o.id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        h.api.pool.query(
          'UPDATE billing_plan_versions SET amount_fen=1,catalog_version=catalog_version+1 WHERE id=$1',
          [plan.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    test('concurrent approvals serialize one settlement, rejecting the stale CAS without duplicate entitlements', async () => {
      const o = await order();
      data(
        await platform(o.id, 'SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `bank-race-${randomUUID()}`,
        }),
      );
      const current = await fresh(o.id);
      const replies = await Promise.all(
        [1, 2].map(() =>
          call(h.api, 'post', `${root}/orders/${o.id}/commands`, {
            cookie: reviewer.cookie,
            body: {
              commandId: randomUUID(),
              type: 'CONFIRM_PAYMENT',
              expectedOrderVersion: current.version,
              reason: why,
            },
          }),
        ),
      );
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM event_entitlements WHERE order_id=$1',
            [o.id],
          )
        ).rows[0]!.n,
      ).toBe(1);
    });
    test('blocks first formal publication without software rights and atomically activates exactly this paid event', async () => {
      const registration = await frozen(h);
      const resource = await court(h.api, h.owner, '合成收费赛事场地');
      let draft = await revision(h.api, h.owner, registration, [resource]);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        fullAllocations(draft, resource, `${registration.event.startDate}T09:00:00+08:00`),
      );
      const blocked = await publish(h.api, h.owner, draft);
      error(blocked, 402);
      expect(blocked.body.error.code).toBe('EVENT_ENTITLEMENT_REQUIRED');
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM schedule_publications WHERE event_id=$1',
            [registration.event.id],
          )
        ).rows[0]!.n,
      ).toBe(0);
      const o = await paid(registration.event.id);
      data<EventSchedulingData>(await publish(h.api, h.owner, draft));
      const activation = (
        await h.api.pool.query('SELECT * FROM event_commercial_activations WHERE event_id=$1', [
          o.eventId,
        ])
      ).rows[0]!;
      expect(activation).toMatchObject({
        source: 'PAID',
        participant_count: 2,
        expected_match_count: 1,
      });
      // Existing activation is authoritative for later rounds even if no current sale is available.
      const c = await h.api.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [o.eventId]);
        await activateEventCommerce(c, {
          orgId: o.orgId,
          eventId: o.eventId,
          participantCount: 2,
          expectedMatchCount: 1,
          mode: 'ENFORCED',
          actorId: h.owner.id,
        });
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
      const result = data<CommerceCommandResult>(
        await call(h.api, 'post', `${org(h.owner.orgId)}/orders/${o.id}/commands`, {
          cookie: h.owner.cookie,
          body: {
            commandId: randomUUID(),
            type: 'REQUEST_REFUND',
            expectedOrderVersion: o.version,
            reason: '已激活履约争议合成记录',
          },
        }),
      );
      expect(result.notice).toContain('争议已记录');
      expect(result.order.status).toBe('PAID');
      expect(result.order.refund).toBeNull();
    });
    test('full unused manual refund requires independent review and revokes only its unactivated entitlement', async () => {
      const o = await paid();
      data(
        await call(h.api, 'post', `${org(h.owner.orgId)}/orders/${o.id}/commands`, {
          cookie: h.owner.cookie,
          body: {
            commandId: randomUUID(),
            type: 'REQUEST_REFUND',
            expectedOrderVersion: o.version,
            reason: why,
          },
        }),
      );
      data(
        await platform(o.id, 'SUBMIT_REFUND', h.otherOwner, {
          externalReference: `bank-refund-${randomUUID()}`,
        }),
      );
      error(await platform(o.id, 'CONFIRM_REFUND', h.otherOwner), 403);
      const result = data<CommerceCommandResult>(await platform(o.id, 'CONFIRM_REFUND', reviewer));
      expect(result.order).toMatchObject({
        status: 'REFUNDED',
        refund: { status: 'SUCCEEDED', amountFen: 9900 },
      });
      expect(
        (
          await h.api.pool.query('SELECT revoked_at FROM event_entitlements WHERE order_id=$1', [
            o.id,
          ])
        ).rows[0]!.revoked_at,
      ).not.toBeNull();
      error(await platform(o.id, 'CONFIRM_REFUND', reviewer), 403);
    });
    test('manual reconciliation checks the requested Shanghai accounting day in both directions and never repairs payment status', async () => {
      const o = await paid();
      const cash = (
        await h.api.pool.query(
          "SELECT r.external_reference,to_char(o.paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day FROM billing_orders o JOIN billing_payment_reviews r ON r.order_id=o.id AND r.status='CONFIRMED' WHERE o.id=$1",
          [o.id],
        )
      ).rows[0]!;
      const correct = `${head}\n${o.id},${cash.external_reference},99.00,CNY,PAID`;
      const report = async (csv: string, date: string) =>
        data<{ reconciliation: { matchedCount: number; issues: { code: string }[] } }>(
          await call(h.api, 'post', `${root}/reconciliations`, {
            cookie: reviewer.cookie,
            body: { commandId: randomUUID(), billDate: date, source: 'MANUAL', csv, reason: why },
          }),
        ).reconciliation;
      expect((await report(correct, cash.day)).matchedCount).toBe(1);
      expect((await report(head, cash.day)).issues.some((i) => i.code === 'LOCAL_ONLY')).toBe(true);
      const wrong = await report(correct, '2001-01-01');
      expect(wrong.matchedCount).toBe(0);
      expect(wrong.issues.length).toBeGreaterThan(0);
      const under = await report(correct.replace('99.00', '49.00'), cash.day);
      expect(under.matchedCount).toBe(0);
      expect(under.issues.some((i) => i.code === 'BILL_MISMATCH')).toBe(true);
      expect((await fresh(o.id)).status).toBe('PAID');
    });
    test('disabled real gateway makes no payment or entitlement from browser commands or unsigned notifications', async () => {
      const o = await order();
      const native = await call(h.api, 'post', `${org(h.owner.orgId)}/orders/${o.id}/commands`, {
        cookie: h.owner.cookie,
        body: { commandId: randomUUID(), type: 'CREATE_NATIVE', expectedOrderVersion: o.version },
      });
      error(native, 503);
      const notify = await call(h.api, 'post', '/v1/payments/wechat/notifications', {
        origin: null,
        body: { event_type: 'TRANSACTION.SUCCESS' },
      });
      error(notify, 503);
      expect((await fresh(o.id)).status).toBe('PENDING_PAYMENT');
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM event_entitlements WHERE order_id=$1',
            [o.id],
          )
        ).rows[0]!.n,
      ).toBe(0);
    });
    test('runtime-style SELECT-only platform role supports authorization reads and cannot grant itself rights', async () => {
      const role = `scb_c05_${RUN_ID.slice(0, 12)}`;
      await h.api.pool.query(`CREATE ROLE ${role} NOLOGIN`);
      let scoped: Pool | undefined;
      try {
        await h.api.pool.query(`GRANT SELECT ON platform_operators,users,sessions TO ${role}`);
        await h.api.pool.query(`GRANT UPDATE(id) ON users TO ${role}`);
        await h.api.pool.query(`GRANT UPDATE(revoked_at) ON sessions TO ${role}`);
        scoped = new Pool({ connectionString: h.databaseUrl, options: `-c role=${role}` });
        const service = new CommerceService(scoped, {
          databaseUrl: h.databaseUrl,
          appOrigin: ORIGIN,
          commerceMode: 'ENFORCED',
        });
        expect(await service.capabilities(reviewer.cookie)).toMatchObject({
          platformOperator: true,
        });
        await expect(
          scoped.query(
            "INSERT INTO platform_operators(user_id,status,maintenance_actor_id,reason) VALUES($1,'ACTIVE',$2,$3)",
            [h.owner.id, randomUUID(), why],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          maintainPlatformOperator(scoped, { email: h.owner.email, status: 'ACTIVE', reason: why }),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        if (scoped) await scoped.end();
        await h.api.pool.query(`DROP OWNED BY ${role}`);
        await h.api.pool.query(`DROP ROLE ${role}`);
      }
    });
    test('offline revoke drains current actor authorization and old authenticated sessions lose platform rights', async () => {
      await maintainPlatformOperator(h.api.pool, {
        email: reviewer.email,
        status: 'DISABLED',
        reason: why,
      });
      error(await call(h.api, 'get', root, { cookie: reviewer.cookie }), 403);
      await maintainPlatformOperator(h.api.pool, {
        email: reviewer.email,
        status: 'ACTIVE',
        reason: why,
      });
      data(await call(h.api, 'get', root, { cookie: reviewer.cookie }));
    });
  },
);

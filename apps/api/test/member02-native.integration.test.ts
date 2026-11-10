import { createCipheriv, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest';
import type {
  CommerceCommandResult,
  CommerceOrderData,
  CommercePlanData,
  CommerceWorkspaceData,
} from '@small-city-basketball/contracts';
import type {
  SoftwareMembershipCommandResult,
  SoftwareMembershipOrderData,
  SoftwareMembershipPlanData,
  SoftwareMembershipWorkspaceData,
} from '../../../packages/contracts/membership.js';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { activateEventCommerce } from '../src/commerce/activation.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { makeMembershipQuote } from '../src/commerce/membership-domain.js';
import { WechatPayClient } from '../src/commerce/wechatpay.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  createEvent,
  data,
  error,
  login,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

type Json = Record<string, unknown>;
type Kind = 'MEMBER' | 'EVENT';
type Order = SoftwareMembershipOrderData | CommerceOrderData;
interface Fixture {
  actor: User;
  kind: Kind;
  order: Order;
}
interface Scenario {
  value: Json | Error;
  afterClose?: Json;
  closeError?: Error;
}
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const platformSerial = 'PUB_KEY_ID_SYNTHETIC_MEMBER02';
const appid = 'wx1234567890abcdef';
const mchid = '1900000109';
const aesKey = '0123456789abcdef0123456789abcdef';
const reason = '合成Native会员付款与闭单隔离验证';
const memberPath = (orgId: string) => `/v1/orgs/${orgId}/software-membership`;
const commercePath = (orgId: string) => `/v1/orgs/${orgId}/commerce`;
const platformMember = '/v1/platform/software-membership';
const platformCommerce = '/v1/platform/commerce';
const tradeNo = (f: Fixture) => f.order.id.replaceAll('-', '');
const signed = (raw: string) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'synthetic-member02-response';
  return {
    'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Nonce': nonce,
    'Wechatpay-Serial': platformSerial,
    'Wechatpay-Signature': sign(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
      privateKey,
    ).toString('base64'),
  };
};
function notification(value: Json, eventType = 'TRANSACTION.SUCCESS', id = randomUUID()) {
  const aad = eventType.startsWith('REFUND.') ? 'refund' : 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(aesKey), Buffer.from('0123456789ab'));
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const raw = JSON.stringify({
    id,
    event_type: eventType,
    resource_type: 'encrypt-resource',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      original_type: aad,
      nonce: '0123456789ab',
      associated_data: aad,
      ciphertext,
    },
  });
  return { id, raw, headers: signed(raw) };
}
function providerPayment(f: Fixture, state = 'NOTPAY'): Json {
  return {
    appid,
    mchid,
    trade_type: 'NATIVE',
    out_trade_no: tradeNo(f),
    trade_state: state,
    amount: { total: f.order.quote.amountFen, currency: 'CNY' },
    ...(state === 'SUCCESS'
      ? {
          transaction_id: `m02tx-${tradeNo(f)}`,
          // The provider reports seconds, not the database creation timestamp's milliseconds.
          success_time: new Date(Math.floor(Date.parse(f.order.createdAt) / 1000) * 1000)
            .toISOString()
            .replace('.000Z', 'Z'),
        }
      : {}),
  };
}

/** Real isolated PostgreSQL and HTTP. The signed provider is a synthetic protocol fixture, not WeChat acceptance. */
describe(
  'MEMBER02 Native membership settlement and verified original closure with synthetic cryptography',
  { concurrent: false },
  () => {
    let api: Api;
    let maker: User;
    let checker: User;
    let memberPlan: SoftwareMembershipPlanData;
    let eventPlan: CommercePlanData;
    let passwordHash: string;
    const scenarios = new Map<string, Scenario>();
    const refunds = new Map<string, Json>();
    const requests: { method: string; path: string; body: Json | null }[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.mch.weixin.qq.com');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
      requests.push({ method, path: url.pathname, body });
      if (method === 'POST' && url.pathname === '/v3/pay/transactions/native') {
        expect(body).toMatchObject({ appid, mchid });
        const raw = JSON.stringify({
          code_url: `weixin://wxpay/bizpayurl?pr=${String(body!.out_trade_no)}`,
        });
        return new Response(raw, { status: 200, headers: signed(raw) });
      }
      const original = /^\/v3\/pay\/transactions\/out-trade-no\/([A-Za-z0-9]+)(\/close)?$/.exec(
        url.pathname,
      );
      if (original) {
        const state = scenarios.get(original[1]!);
        if (!state) throw new Error('Missing synthetic original-order scenario');
        if (original[2]) {
          expect(method).toBe('POST');
          expect(body).toEqual({ mchid });
          if (state.closeError) throw state.closeError;
          if (state.afterClose) state.value = state.afterClose;
          return new Response(null, { status: 204, headers: signed('') });
        }
        expect(method).toBe('GET');
        expect(url.searchParams.get('mchid')).toBe(mchid);
        if (state.value instanceof Error) throw state.value;
        const raw = JSON.stringify(state.value);
        return new Response(raw, { status: 200, headers: signed(raw) });
      }
      if (method === 'POST' && url.pathname === '/v3/refund/domestic/refunds') {
        const amount = body!.amount as Json;
        const no = String(body!.out_refund_no);
        const value: Json = {
          mchid,
          out_trade_no: body!.out_trade_no,
          out_refund_no: no,
          transaction_id: `m02tx-${String(body!.out_trade_no)}`,
          refund_id: `m02refund-${no}`,
          status: 'PROCESSING',
          create_time: new Date().toISOString(),
          amount: { total: amount.total, refund: amount.refund, currency: 'CNY' },
        };
        refunds.set(no, value);
        const raw = JSON.stringify(value);
        return new Response(raw, { status: 200, headers: signed(raw) });
      }
      const refundQuery = /^\/v3\/refund\/domestic\/refunds\/([A-Za-z0-9]+)$/.exec(url.pathname);
      if (refundQuery && method === 'GET') {
        const value = refunds.get(refundQuery[1]!);
        if (!value) throw new Error('Missing synthetic original refund');
        const raw = JSON.stringify(value);
        return new Response(raw, { status: 200, headers: signed(raw) });
      }
      throw new Error('Unexpected synthetic merchant request');
    });
    const gateway = new WechatPayClient(
      {
        enabled: true,
        appId: appid,
        merchantId: mchid,
        serialNo: 'MERCHANT_SYNTHETIC_MEMBER02',
        privateKeyPem: privateKey,
        apiV3Key: aesKey,
        platformKeys: { [platformSerial]: publicKey },
        notifyUrl: 'https://basketball.example.test/v1/payments/wechat/notifications',
      },
      { fetch: transport },
    );

    beforeAll(async () => {
      const databaseUrl = testDatabaseUrl();
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      api = await createApi({
        databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED',
        commercePayments: gateway,
        backgroundWorkersEnabled: false,
      });
      passwordHash = await hashPassword(PASSWORD);
      maker = await user('maker');
      checker = await user('checker');
      for (const actor of [maker, checker])
        await maintainPlatformOperator(api.pool, { email: actor.email, status: 'ACTIVE', reason });
      memberPlan = data<{ plan: SoftwareMembershipPlanData }>(
        await call(api, 'post', `${platformMember}/plans`, {
          cookie: maker.cookie,
          body: {
            commandId: randomUUID(),
            code: `m02_native_${RUN_ID.slice(0, 12)}`,
            name: '合成Native专业月费',
            currency: 'CNY',
            amountFen: 19900,
            tier: 'PRO',
            durationDays: 30,
            reason,
          },
        }),
      ).plan;
      eventPlan = data<{ plan: CommercePlanData }>(
        await call(api, 'post', `${platformCommerce}/plans`, {
          cookie: maker.cookie,
          body: {
            commandId: randomUUID(),
            code: `m02_native_event_${RUN_ID.slice(0, 8)}`,
            name: '合成Native旧按届',
            currency: 'CNY',
            amountFen: 100,
            maxTeams: 2,
            maxMatches: 1,
            validDays: 30,
            reason,
          },
        }),
      ).plan;
    }, 90000);
    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    });

    async function user(label: string, orgId = ''): Promise<User> {
      const id = randomUUID();
      const actor = { id, orgId, email: `m02-native-${label}-${id}@example.test`, cookie: '' };
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, actor.email, `合成Native${label}`, passwordHash],
      );
      if (orgId)
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [orgId, id],
        );
      actor.cookie = await login(api, actor);
      return actor;
    }
    async function owner(label: string) {
      const id = randomUUID();
      await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
        id,
        `合成Native机构${label}`,
      ]);
      return user(label, id);
    }
    async function memberWorkspace(actor: User) {
      return data<SoftwareMembershipWorkspaceData>(
        await call(api, 'get', memberPath(actor.orgId), { cookie: actor.cookie }),
      );
    }
    async function purchase(actor: User, kind: Kind = 'MEMBER'): Promise<Fixture> {
      if (kind === 'MEMBER') {
        const state = await memberWorkspace(actor);
        const order = data<SoftwareMembershipCommandResult>(
          await call(api, 'post', `${memberPath(actor.orgId)}/orders`, {
            cookie: actor.cookie,
            body: {
              commandId: randomUUID(),
              planId: memberPlan.id,
              expectedMembershipVersion: state.membershipVersion,
            },
          }),
        ).order;
        return { actor, kind, order };
      }
      const event = await createEvent(api, actor, `合成Native原赛事-${randomUUID().slice(0, 8)}`);
      const order = data<CommerceCommandResult>(
        await call(api, 'post', `${commercePath(actor.orgId)}/orders`, {
          cookie: actor.cookie,
          body: {
            commandId: randomUUID(),
            eventId: event.id,
            planId: eventPlan.id,
            expectedEventVersion: event.version,
          },
        }),
      ).order;
      return { actor, kind, order };
    }
    const base = (f: Fixture) =>
      f.kind === 'MEMBER' ? memberPath(f.actor.orgId) : commercePath(f.actor.orgId);
    async function fresh(f: Fixture): Promise<Order> {
      const state =
        f.kind === 'MEMBER'
          ? await memberWorkspace(f.actor)
          : data<CommerceWorkspaceData>(
              await call(api, 'get', commercePath(f.actor.orgId), { cookie: f.actor.cookie }),
            );
      const order = state.orders.find((o) => o.id === f.order.id);
      expect(order).toBeDefined();
      f.order = order!;
      return order!;
    }
    async function buyer(f: Fixture, type: string, commandId = randomUUID()) {
      return call(api, 'post', `${base(f)}/orders/${f.order.id}/commands`, {
        cookie: f.actor.cookie,
        body: {
          commandId,
          type,
          expectedOrderVersion: (await fresh(f)).version,
          ...(['CANCEL', 'REQUEST_REFUND', 'CLOSE_NATIVE'].includes(type) ? { reason } : {}),
        },
      });
    }
    async function native(f: Fixture) {
      scenarios.set(tradeNo(f), { value: providerPayment(f) });
      const result = data<CommerceCommandResult | SoftwareMembershipCommandResult>(
        await buyer(f, 'CREATE_NATIVE'),
      );
      expect(result.nativePayment?.codeUrl).toBe(`weixin://wxpay/bizpayurl?pr=${tradeNo(f)}`);
      expect(result.order).toMatchObject({
        status: 'PENDING_PAYMENT',
        channel: 'WECHAT_NATIVE',
        paidAt: null,
      });
      f.order = result.order;
      return f;
    }
    async function fixture(label: string, kind: Kind = 'MEMBER') {
      return native(await purchase(await owner(label), kind));
    }
    const notify = (n: ReturnType<typeof notification>) =>
      request(api.app.getHttpServer())
        .post('/v1/payments/wechat/notifications')
        .set(n.headers)
        .set('Content-Type', 'application/json')
        .send(n.raw);
    const closeRequests = (f: Fixture) =>
      requests.filter(
        (r) =>
          r.method === 'POST' && r.path === `/v3/pay/transactions/out-trade-no/${tradeNo(f)}/close`,
      );
    async function proofRows(f: Fixture) {
      return (
        await api.pool.query(
          "SELECT * FROM payment_notifications WHERE order_id=$1 AND notification_id LIKE 'query-payment-closed:%'",
          [f.order.id],
        )
      ).rows;
    }
    async function assertNoMemberGrant(f: Fixture) {
      expect(
        (
          await api.pool.query('SELECT id FROM software_membership_periods WHERE order_id=$1', [
            f.order.id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (await api.pool.query('SELECT id FROM event_entitlements WHERE order_id=$1', [f.order.id]))
          .rowCount,
      ).toBe(0);
    }
    async function blockedPurchase(actor: User) {
      const state = await memberWorkspace(actor);
      expect(state.canPurchase).toBe(false);
      const response = await call(api, 'post', `${memberPath(actor.orgId)}/orders`, {
        cookie: actor.cookie,
        body: {
          commandId: randomUUID(),
          planId: memberPlan.id,
          expectedMembershipVersion: state.membershipVersion,
        },
      });
      error(response, 409);
      expect(response.body.error.code).toBe('MEMBERSHIP_PURCHASE_BLOCKED');
    }
    async function activate(actor: User, eventId: string) {
      const c = await api.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [actor.orgId]);
        expect(
          (
            await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
              actor.orgId,
              eventId,
            ])
          ).rowCount,
        ).toBe(1);
        await activateEventCommerce(c, {
          orgId: actor.orgId,
          eventId,
          participantCount: 2,
          expectedMatchCount: 1,
          actorId: actor.id,
          mode: 'ENFORCED',
        });
        await c.query('COMMIT');
      } catch (failure) {
        await c.query('ROLLBACK');
        throw failure;
      } finally {
        c.release();
      }
    }

    test('signed Native initiation is unpaid; wrong amount and merchant identity cannot grant, and creation-second success grants one exact member period', async () => {
      const actor = await owner('same-second');
      let f = await purchase(actor);
      for (let retry = 0; Date.parse(f.order.createdAt) % 1000 === 0 && retry < 3; retry++) {
        data(await buyer(f, 'CANCEL'));
        f = await purchase(actor);
      }
      expect(Date.parse(f.order.createdAt) % 1000).toBeGreaterThan(0);
      await native(f);
      await assertNoMemberGrant(f);
      const valid = providerPayment(f, 'SUCCESS');
      expect(Date.parse(String(valid.success_time))).toBeLessThan(Date.parse(f.order.createdAt));
      const wrongAmount = notification({
        ...valid,
        amount: { total: f.order.quote.amountFen - 1, currency: 'CNY' },
      });
      expect((await notify(wrongAmount)).status).toBe(409);
      const wrongIdentity = notification({ ...valid, mchid: '1900000199' });
      expect((await notify(wrongIdentity)).status).toBe(502);
      await assertNoMemberGrant(f);
      expect((await fresh(f)).paidAt).toBeNull();
      const accepted = notification(valid);
      expect((await notify(accepted)).status).toBe(204);
      expect((await notify(accepted)).status).toBe(204);
      scenarios.get(tradeNo(f))!.value = valid;
      expect(
        data<SoftwareMembershipCommandResult>(await buyer(f, 'QUERY_PAYMENT')).order.status,
      ).toBe('PAID');
      const state = await memberWorkspace(actor);
      const periods = state.periods.filter((p) => p.orderId === f.order.id);
      expect(periods).toHaveLength(1);
      expect(periods[0]!.startsAt).toBe(f.order.createdAt);
      expect((await fresh(f)).paidAt).toBe(new Date(String(valid.success_time)).toISOString());
      expect(Date.parse(periods[0]!.endsAt) - Date.parse(periods[0]!.startsAt)).toBe(
        30 * 86400_000,
      );
      expect(periods[0]!).toMatchObject({
        eventLimit: 3,
        usedEvents: 0,
        remainingEvents: 3,
        state: 'ACTIVE',
      });
      expect(
        (await api.pool.query('SELECT id FROM event_entitlements WHERE order_id=$1', [f.order.id]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await api.pool.query(
            'SELECT notification_id FROM payment_notifications WHERE notification_id=$1',
            [accepted.id],
          )
        ).rowCount,
      ).toBe(1);
    });

    test('adjacent historical Native purchases and renewals preserve database microseconds without overlapping periods or rewriting payment proof', async () => {
      const actor = await owner('adjacent-microseconds');
      const plan = (
        await api.pool.query('SELECT * FROM billing_plan_versions WHERE id=$1', [memberPlan.id])
      ).rows[0];
      // Only initial unpaid historical sources are synthesized. HTTP signature verification
      // and the original settlement/period guards create both paid periods below.
      async function historicalPending(createdAt: string): Promise<Fixture> {
        const id = randomUUID();
        await api.pool.query(
          `INSERT INTO billing_orders(id,org_id,event_id,plan_id,quote,amount_fen,currency,out_trade_no,created_by,created_at,expires_at,target_kind)
           VALUES($1,$2,NULL,$3,$4::jsonb,$5,'CNY',$6,$7,$8::timestamptz,$8::timestamptz+interval '24 hours','ORG_MEMBERSHIP')`,
          [
            id,
            actor.orgId,
            memberPlan.id,
            JSON.stringify(makeMembershipQuote(plan, null)),
            memberPlan.amountFen,
            id.replaceAll('-', ''),
            actor.id,
            createdAt,
          ],
        );
        const order = (await memberWorkspace(actor)).orders.find((o) => o.id === id)!;
        expect(order).toBeDefined();
        return { actor, kind: 'MEMBER', order };
      }
      const historicalStart = (
        await api.pool.query(
          "SELECT (date_trunc('second',clock_timestamp())-2592002::double precision*interval '1 second'+interval '0.500123 seconds')::text AS value",
        )
      ).rows[0].value as string;
      const previous = await historicalPending(historicalStart);
      // Reconstruct only the original pre-payment Native initiation; no paid fact is seeded.
      await api.pool.query(
        "UPDATE billing_orders SET channel='WECHAT_NATIVE',provider_started_at=created_at,native_code_url=$2,version=version+1 WHERE id=$1",
        [previous.order.id, `weixin://wxpay/bizpayurl?pr=${tradeNo(previous)}`],
      );
      await fresh(previous);
      const previousPayment = providerPayment(previous, 'SUCCESS');
      expect((await notify(notification(previousPayment))).status).toBe(204);
      const previousState = await memberWorkspace(actor);
      const previousPeriod = previousState.periods.find((p) => p.orderId === previous.order.id)!;
      expect(previousPeriod.state).toBe('EXPIRED');
      expect(previousPeriod.usedEvents).toBe(0);
      const event = await createEvent(api, actor, '合成历史过期会员不能消费');
      await expect(activate(actor, event.id)).rejects.toMatchObject({ status: 402 });
      const nextCreatedAt = (
        await api.pool.query(
          "SELECT (ends_at+interval '0.2 seconds')::text AS value FROM software_membership_periods WHERE id=$1",
          [previousPeriod.id],
        )
      ).rows[0].value as string;
      const next = await native(await historicalPending(nextCreatedAt));
      const payment = providerPayment(next, 'SUCCESS');
      const callback = notification(payment);
      expect((await notify(callback)).status).toBe(204);
      expect((await notify(callback)).status).toBe(204);
      scenarios.get(tradeNo(next))!.value = payment;
      expect(
        data<SoftwareMembershipCommandResult>(await buyer(next, 'QUERY_PAYMENT')).order.status,
      ).toBe('PAID');
      const boundaries = (
        await api.pool.query(
          `SELECT n.starts_at=o.created_at AS exact_start,
            n.starts_at=GREATEST(o.paid_at,o.created_at) AS canonical_start,
            o.paid_at<old.ends_at AND old.ends_at<o.created_at AS adjacent,
            NOT(tstzrange(old.starts_at,old.ends_at,'[)') && tstzrange(n.starts_at,n.ends_at,'[)')) AS no_overlap,
            mod(extract(microseconds FROM o.created_at)::bigint,1000)>0 AS has_submillisecond,
            old.ends_at<clock_timestamp() AS previous_expired,
            n.ends_at=n.starts_at+2592000::double precision*interval '1 second' AS exact_duration,
            o.paid_at::text AS paid_at
           FROM software_membership_periods n JOIN billing_orders o ON o.id=n.order_id
           JOIN software_membership_periods old ON old.id=$2 WHERE n.order_id=$1`,
          [next.order.id, previousPeriod.id],
        )
      ).rows;
      expect(boundaries).toHaveLength(1);
      expect(boundaries[0]).toMatchObject({
        exact_start: true,
        canonical_start: true,
        adjacent: true,
        no_overlap: true,
        has_submillisecond: true,
        previous_expired: true,
        exact_duration: true,
      });
      expect(new Date(boundaries[0].paid_at).toISOString()).toBe(
        new Date(String(payment.success_time)).toISOString(),
      );
      expect(
        (await memberWorkspace(actor)).periods.filter((p) => p.orderId === next.order.id),
      ).toHaveLength(1);
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::integer AS count FROM event_commercial_activations WHERE org_id=$1',
            [actor.orgId],
          )
        ).rows[0].count,
      ).toBe(0);
      // A real same-tier renewal must also retain the predecessor's full PostgreSQL precision.
      const renewal = await native(await purchase(actor));
      const renewalPayment = providerPayment(renewal, 'SUCCESS');
      expect((await notify(notification(renewalPayment))).status).toBe(204);
      const renewalPeriod = (await memberWorkspace(actor)).periods.find(
        (p) => p.orderId === renewal.order.id,
      )!;
      expect(renewalPeriod.state).toBe('SCHEDULED');
      expect(
        (
          await api.pool.query(
            `SELECT child.starts_at=parent.ends_at AS exact_start,
              child.ends_at=child.starts_at+2592000::double precision*interval '1 second' AS exact_duration,
              mod(extract(microseconds FROM child.starts_at)::bigint,1000)>0 AS has_submillisecond
             FROM software_membership_periods child JOIN billing_orders o ON o.id=child.order_id
             JOIN software_membership_periods parent ON parent.id=o.membership_previous_period_id WHERE child.id=$1`,
            [renewalPeriod.id],
          )
        ).rows[0],
      ).toEqual({ exact_start: true, exact_duration: true, has_submillisecond: true });
    });

    test('unknown, PAYERROR and REVOKED remain blocked until a signed original CLOSED query, with idempotent proof and no terminal revival', async () => {
      const f = await fixture('unknown-and-close');
      const scenario = scenarios.get(tradeNo(f))!;
      scenario.value = new Error('Synthetic unknown payment outcome');
      const unknown = await buyer(f, 'QUERY_PAYMENT');
      error(unknown, 503);
      expect(unknown.body.error.code).toBe('PAYMENT_PROVIDER_RESULT_UNKNOWN');
      await blockedPurchase(f.actor);
      for (const state of ['PAYERROR', 'REVOKED']) {
        scenario.value = providerPayment(f, state);
        expect(
          data<SoftwareMembershipCommandResult>(await buyer(f, 'QUERY_PAYMENT')).order,
        ).toMatchObject({ status: 'EXPIRED', channel: 'WECHAT_NATIVE', paidAt: null });
        await blockedPurchase(f.actor);
        expect(await proofRows(f)).toHaveLength(0);
      }
      scenario.value = providerPayment(f, 'CLOSED');
      const command = {
        commandId: randomUUID(),
        type: 'QUERY_PAYMENT',
        expectedOrderVersion: (await fresh(f)).version,
      };
      const url = `${base(f)}/orders/${f.order.id}/commands`;
      const closed = data<SoftwareMembershipCommandResult>(
        await call(api, 'post', url, { cookie: f.actor.cookie, body: command }),
      );
      expect(closed.order).toMatchObject({
        status: 'CANCELLED',
        channel: 'WECHAT_NATIVE',
        paidAt: null,
      });
      const count = transport.mock.calls.length;
      expect(
        data<SoftwareMembershipCommandResult>(
          await call(api, 'post', url, { cookie: f.actor.cookie, body: command }),
        ),
      ).toEqual(closed);
      expect(transport.mock.calls.length).toBe(count);
      expect(await proofRows(f)).toHaveLength(1);
      expect(closeRequests(f)).toHaveLength(0);
      expect(
        data<SoftwareMembershipCommandResult>(await buyer(f, 'QUERY_PAYMENT')).order.status,
      ).toBe('CANCELLED');
      expect(await proofRows(f)).toHaveLength(1);
      const inconsistent = notification(providerPayment(f, 'SUCCESS'));
      expect((await notify(inconsistent)).status).toBe(409);
      expect(
        (
          await api.pool.query(
            'SELECT notification_id FROM payment_notifications WHERE notification_id=$1',
            [inconsistent.id],
          )
        ).rowCount,
      ).toBe(0);
      await assertNoMemberGrant(f);
      expect((await fresh(f)).status).toBe('CANCELLED');
      const next = await purchase(f.actor);
      expect(next.order.id).not.toBe(f.order.id);
    });

    test('CLOSE_NATIVE first queries provider success and settles without sending any close dispatch', async () => {
      const f = await fixture('already-provider-paid');
      scenarios.get(tradeNo(f))!.value = providerPayment(f, 'SUCCESS');
      const result = data<SoftwareMembershipCommandResult>(await buyer(f, 'CLOSE_NATIVE'));
      expect(result.order.status).toBe('PAID');
      expect(result.notice).toContain('已核实付款');
      expect(closeRequests(f)).toHaveLength(0);
      expect(await proofRows(f)).toHaveLength(0);
      expect(
        (await memberWorkspace(f.actor)).periods.filter((p) => p.orderId === f.order.id),
      ).toHaveLength(1);
    });

    test('NOTPAY requires signed close acknowledgement followed by a signed CLOSED query of exactly the original trade', async () => {
      const f = await fixture('notpay-close');
      scenarios.get(tradeNo(f))!.afterClose = providerPayment(f, 'CLOSED');
      const result = data<SoftwareMembershipCommandResult>(await buyer(f, 'CLOSE_NATIVE'));
      expect(result.order).toMatchObject({
        status: 'CANCELLED',
        channel: 'WECHAT_NATIVE',
        paidAt: null,
      });
      expect(result.notice).toContain('核实关闭');
      expect(closeRequests(f)).toHaveLength(1);
      expect(closeRequests(f)[0]!.body).toEqual({ mchid });
      expect(await proofRows(f)).toHaveLength(1);
      await assertNoMemberGrant(f);
      expect((await purchase(f.actor)).order.status).toBe('PENDING_PAYMENT');
    });

    test('signed close 204 alone and close transport failure do not release admission; later query recovers without re-closing', async () => {
      const f = await fixture('ack-is-not-closed');
      const scenario = scenarios.get(tradeNo(f))!;
      const ackOnly = await buyer(f, 'CLOSE_NATIVE');
      error(ackOnly, 409);
      expect(ackOnly.body.error.code).toBe('PAYMENT_PROVIDER_RESULT_UNKNOWN');
      expect((await fresh(f)).status).toBe('PENDING_PAYMENT');
      expect(await proofRows(f)).toHaveLength(0);
      await blockedPurchase(f.actor);
      scenario.closeError = new Error('Synthetic close response lost');
      const lost = await buyer(f, 'CLOSE_NATIVE');
      error(lost, 503);
      expect(lost.body.error.code).toBe('PAYMENT_PROVIDER_RESULT_UNKNOWN');
      await blockedPurchase(f.actor);
      const closeCount = closeRequests(f).length;
      scenario.value = providerPayment(f, 'CLOSED');
      expect(
        data<SoftwareMembershipCommandResult>(await buyer(f, 'QUERY_PAYMENT')).order.status,
      ).toBe('CANCELLED');
      expect(closeRequests(f)).toHaveLength(closeCount);
      expect(await proofRows(f)).toHaveLength(1);
      await assertNoMemberGrant(f);
      expect((await purchase(f.actor)).order.id).not.toBe(f.order.id);
    });

    test('an unresolved legacy EVENT Native order also blocks member usage until its own verified closure', async () => {
      const actor = await owner('event-close');
      const member = await native(await purchase(actor));
      scenarios.get(tradeNo(member))!.value = providerPayment(member, 'SUCCESS');
      expect((await notify(notification(providerPayment(member, 'SUCCESS')))).status).toBe(204);
      const f = await native(await purchase(actor, 'EVENT'));
      expect(f.order.quote).not.toHaveProperty('scope');
      expect(f.order.eventId).toEqual(expect.any(String));
      const scenario = scenarios.get(tradeNo(f))!;
      scenario.value = new Error('Synthetic legacy query unknown');
      error(await buyer(f, 'QUERY_PAYMENT'), 503);
      await expect(activate(actor, f.order.eventId!)).rejects.toMatchObject({
        status: 409,
        code: 'EVENT_PURCHASE_REVIEW_REQUIRED',
      });
      scenario.value = providerPayment(f);
      error(await buyer(f, 'CLOSE_NATIVE'), 409);
      expect((await fresh(f)).status).toBe('PENDING_PAYMENT');
      scenario.afterClose = providerPayment(f, 'CLOSED');
      expect(data<CommerceCommandResult>(await buyer(f, 'CLOSE_NATIVE')).order.status).toBe(
        'CANCELLED',
      );
      await activate(actor, f.order.eventId!);
      const activation = (
        await api.pool.query(
          'SELECT source,membership_period_id FROM event_commercial_activations WHERE event_id=$1',
          [f.order.eventId],
        )
      ).rows[0]!;
      expect(activation).toMatchObject({
        source: 'MEMBERSHIP',
        membership_period_id: expect.any(String),
      });
      expect((await memberWorkspace(actor)).periods[0]).toMatchObject({
        usedEvents: 1,
        remainingEvents: 2,
      });
      expect(await fresh(f)).toMatchObject({
        status: 'CANCELLED',
        channel: 'WECHAT_NATIVE',
        paidAt: null,
      });
    });

    test('database cancellation needs its own verified close proof, cannot borrow another order proof, and remains terminal after real closure', async () => {
      const first = await fixture('proof-source');
      const second = await fixture('proof-target');
      const cancelSql =
        "UPDATE billing_orders SET status='CANCELLED',version=version+1 WHERE id=$1";
      await expect(api.pool.query(cancelSql, [second.order.id])).rejects.toMatchObject({
        code: '23514',
      });
      scenarios.get(tradeNo(first))!.value = providerPayment(first, 'CLOSED');
      data(await buyer(first, 'QUERY_PAYMENT'));
      expect(await proofRows(first)).toHaveLength(1);
      const c = await api.pool.connect();
      try {
        await c.query('BEGIN');
        // Rollback-only cross-order proof fixture: the true source/hash remain tied to the other order.
        await c.query(
          `INSERT INTO payment_notifications(notification_id,kind,order_id,proof_hash)
        SELECT $1,kind,order_id,proof_hash FROM payment_notifications WHERE notification_id=$2`,
          [
            `query-payment-closed:${tradeNo(second)}:CLOSED`,
            `query-payment-closed:${tradeNo(first)}:CLOSED`,
          ],
        );
        await c.query('SAVEPOINT cross_order_close');
        await expect(c.query(cancelSql, [second.order.id])).rejects.toMatchObject({
          code: '23514',
        });
        await c.query('ROLLBACK TO SAVEPOINT cross_order_close');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      expect((await fresh(second)).status).toBe('PENDING_PAYMENT');
      expect(await proofRows(second)).toHaveLength(0);
      scenarios.get(tradeNo(second))!.value = providerPayment(second, 'CLOSED');
      data(await buyer(second, 'QUERY_PAYMENT'));
      await expect(
        api.pool.query(
          "UPDATE billing_orders SET status='PAID',version=version+1,paid_at=clock_timestamp(),provider_transaction_id=$2 WHERE id=$1",
          [second.order.id, `m02-forbidden-${randomUUID()}`],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect((await fresh(second)).status).toBe('CANCELLED');
      await assertNoMemberGrant(second);
    });

    test('member Native refunds still need two operators, remain pending until verified success, and revoke the unused original period once', async () => {
      const f = await fixture('native-refund');
      scenarios.get(tradeNo(f))!.value = providerPayment(f, 'SUCCESS');
      expect((await notify(notification(providerPayment(f, 'SUCCESS')))).status).toBe(204);
      data(await buyer(f, 'REQUEST_REFUND'));
      const platformCommand = async (type: string, actor: User) =>
        call(api, 'post', `${platformMember}/orders/${f.order.id}/commands`, {
          cookie: actor.cookie,
          body: {
            commandId: randomUUID(),
            type,
            expectedOrderVersion: (await fresh(f)).version,
            reason,
          },
        });
      data(await platformCommand('SUBMIT_REFUND', maker));
      error(await platformCommand('CONFIRM_REFUND', maker), 403);
      const accepted = data<SoftwareMembershipCommandResult>(
        await platformCommand('CONFIRM_REFUND', checker),
      );
      expect(accepted.order.status).toBe('REFUND_PENDING');
      expect(accepted.order.refund?.status).toBe('PROCESSING');
      expect((await memberWorkspace(f.actor)).periods[0]!.revokedAt).toBeNull();
      const refund = (
        await api.pool.query('SELECT * FROM billing_refunds WHERE order_id=$1', [f.order.id])
      ).rows[0]!;
      const value = refunds.get(refund.out_refund_no)!;
      value.status = 'SUCCESS';
      value.success_time = new Date().toISOString();
      const completed = data<SoftwareMembershipCommandResult>(
        await platformCommand('QUERY_REFUND', checker),
      );
      expect(completed.order).toMatchObject({
        status: 'REFUNDED',
        refund: { status: 'SUCCEEDED', amountFen: 19900 },
      });
      const callback = notification({ ...value, refund_status: 'SUCCESS' }, 'REFUND.SUCCESS');
      expect((await notify(callback)).status).toBe(204);
      expect((await notify(callback)).status).toBe(204);
      expect((await memberWorkspace(f.actor)).periods[0]).toMatchObject({
        state: 'REVOKED',
        usedEvents: 0,
        revokedAt: expect.any(String),
      });
      expect(
        (
          await api.pool.query('SELECT id FROM software_membership_periods WHERE order_id=$1', [
            f.order.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (await api.pool.query('SELECT id FROM billing_refunds WHERE order_id=$1', [f.order.id]))
          .rowCount,
      ).toBe(1);
      expect((await fresh(f)).status).toBe('REFUNDED');
    });
  },
);

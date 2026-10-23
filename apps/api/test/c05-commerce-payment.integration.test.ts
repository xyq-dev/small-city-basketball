import { createCipheriv, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type {
  CommerceCommandResult,
  CommerceOrderData,
  CommercePlanData,
  CommerceReconciliationData,
  CommerceWorkspaceData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { WechatPayClient } from '../src/commerce/wechatpay.js';
import type { WechatPayBillRow } from '../src/commerce/wechatpay.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  createEvent,
  data,
  login,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const serial = 'PUB_KEY_ID_SYNTHETIC_C05';
const appid = 'wx1234567890abcdef';
const mchid = '1900000109';
const aesKey = '0123456789abcdef0123456789abcdef';
const why = '合成密码学与真实隔离账本验收';
const signed = (raw: string) => {
  const ts = String(Math.floor(Date.now() / 1000)),
    nonce = 'signed-synthetic-nonce';
  return {
    'Wechatpay-Timestamp': ts,
    'Wechatpay-Nonce': nonce,
    'Wechatpay-Serial': serial,
    'Wechatpay-Signature': sign(
      'RSA-SHA256',
      Buffer.from(`${ts}\n${nonce}\n${raw}\n`),
      privateKey,
    ).toString('base64'),
  };
};
function notification(value: unknown, type = 'TRANSACTION.SUCCESS', id = randomUUID()) {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(aesKey), Buffer.from('0123456789ab'));
  const aad = type.startsWith('REFUND.') ? 'refund' : 'transaction';
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const raw = JSON.stringify({
    id,
    event_type: type,
    resource_type: 'encrypt-resource',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      original_type: aad,
      nonce: '0123456789ab',
      associated_data: aad,
      ciphertext,
    },
  });
  return { raw, headers: signed(raw) };
}
describe(
  'C05 real HTTP + PostgreSQL payment effects with synthetic RSA/AES and controlled transport',
  { concurrent: false },
  () => {
    let api: Api;
    let owner: User;
    let maker: User;
    let checker: User;
    let plan: CommercePlanData;
    let order: CommerceOrderData;
    let refundResponse: Record<string, unknown>;
    const transport = vi.fn<typeof fetch>();
    const gateway = new WechatPayClient(
      {
        enabled: true,
        appId: appid,
        merchantId: mchid,
        serialNo: 'MERCHANT_SYNTHETIC_C05',
        privateKeyPem: privateKey,
        apiV3Key: aesKey,
        platformKeys: { [serial]: publicKey },
        notifyUrl: 'https://basketball.example.test/v1/payments/wechat/notifications',
      },
      { fetch: transport },
    );
    const platform = '/v1/platform/commerce';
    beforeAll(async () => {
      const databaseUrl = testDatabaseUrl();
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      const input = {
        databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED' as const,
        commercePayments: gateway,
      };
      api = await createApi(input);
      const password = await hashPassword(PASSWORD);
      const users: User[] = [];
      for (const label of ['owner', 'maker', 'checker']) {
        const user = {
          id: randomUUID(),
          orgId: label === 'owner' ? randomUUID() : '',
          email: `c05-pay-${label}-${RUN_ID}@example.test`,
          cookie: '',
        };
        await api.pool.query(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
          [user.id, user.email, `合成支付${label}`, password],
        );
        if (user.orgId) {
          await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
            user.orgId,
            '合成支付机构',
          ]);
          await api.pool.query(
            "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
            [user.orgId, user.id],
          );
        }
        user.cookie = await login(api, user);
        users.push(user);
      }
      [owner, maker, checker] = users as [User, User, User];
      for (const u of [maker, checker])
        await maintainPlatformOperator(api.pool, { email: u.email, status: 'ACTIVE', reason: why });
      plan = data<{ plan: CommercePlanData }>(
        await call(api, 'post', `${platform}/plans`, {
          cookie: maker.cookie,
          body: {
            commandId: randomUUID(),
            code: `pay_${RUN_ID.slice(0, 12)}`,
            name: '合成Native按届软件',
            currency: 'CNY',
            amountFen: 100,
            maxTeams: 2,
            maxMatches: 1,
            validDays: 30,
            reason: why,
          },
        }),
      ).plan;
      const event = await createEvent(api, owner, '合成在线支付赛事');
      order = data<CommerceCommandResult>(
        await call(api, 'post', `/v1/orgs/${owner.orgId}/commerce/orders`, {
          cookie: owner.cookie,
          body: {
            commandId: randomUUID(),
            eventId: event.id,
            planId: plan.id,
            expectedEventVersion: event.version,
          },
        }),
      ).order;
      transport.mockImplementation(async (url) => {
        const path = String(url);
        let value: unknown;
        if (path.includes('/transactions/native'))
          value = { code_url: 'weixin://wxpay/bizpayurl?pr=synthetic-only' };
        else if (path.includes('/refund/domestic/refunds')) value = refundResponse;
        else if (path.includes('/transactions/out-trade-no/')) value = payment();
        else throw new Error('Unexpected synthetic transport request');
        const raw = JSON.stringify(value);
        return new Response(raw, { status: 200, headers: signed(raw) });
      });
    }, 90000);
    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    });
    let paymentTime: string;
    function payment() {
      paymentTime ??= new Date().toISOString();
      return {
        appid,
        mchid,
        trade_type: 'NATIVE',
        out_trade_no: order.id.replaceAll('-', ''),
        transaction_id: `wx-${order.id}`,
        trade_state: 'SUCCESS',
        success_time: paymentTime,
        amount: { total: 100, payer_total: 80, currency: 'CNY' },
      };
    }
    async function fresh() {
      const w = data<CommerceWorkspaceData>(
        await call(api, 'get', platform, { cookie: maker.cookie }),
      );
      order = w.orders.find((o) => o.id === order.id)!;
      return order;
    }
    const notify = async (n: ReturnType<typeof notification>) =>
      request(api.app.getHttpServer())
        .post('/v1/payments/wechat/notifications')
        .set(n.headers)
        .set('Content-Type', 'application/json')
        .send(n.raw);
    test('native dispatch is not payment and wrong signed money is rejected; duplicate valid notifications grant exactly once', async () => {
      const native = data<CommerceCommandResult>(
        await call(api, 'post', `/v1/orgs/${owner.orgId}/commerce/orders/${order.id}/commands`, {
          cookie: owner.cookie,
          body: {
            commandId: randomUUID(),
            type: 'CREATE_NATIVE',
            expectedOrderVersion: order.version,
          },
        }),
      );
      expect(native.nativePayment?.codeUrl).toContain('weixin://');
      expect(native.order.status).toBe('PENDING_PAYMENT');
      order = native.order;
      const wrong = notification({ ...payment(), amount: { total: 99, currency: 'CNY' } });
      expect((await notify(wrong)).status).toBe(409);
      expect((await fresh()).paidAt).toBeNull();
      const n = notification(payment());
      expect((await notify(n)).status).toBe(204);
      expect((await notify(n)).status).toBe(204);
      expect((await fresh()).status).toBe('PAID');
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::int AS n FROM event_entitlements WHERE order_id=$1',
            [order.id],
          )
        ).rows[0]!.n,
      ).toBe(1);
    });
    test('refund notification can precede the API response; later query only fills real acceptance time without regressing success, and long audit reason never breaks provider byte limit', async () => {
      const cmd = async (type: string, user: User, reason = why) => {
        await fresh();
        return call(api, 'post', `${platform}/orders/${order.id}/commands`, {
          cookie: user.cookie,
          body: { commandId: randomUUID(), type, expectedOrderVersion: order.version, reason },
        });
      };
      data(await cmd('SUBMIT_REFUND', maker));
      const f = (
        await api.pool.query('SELECT * FROM billing_refunds WHERE order_id=$1', [order.id])
      ).rows[0]!;
      const accepted = new Date().toISOString();
      const success = new Date(Date.now() + 1000).toISOString();
      const common = {
        mchid,
        out_trade_no: order.id.replaceAll('-', ''),
        out_refund_no: f.out_refund_no,
        transaction_id: `wx-${order.id}`,
        refund_id: `refund-${f.id}`,
        amount: { total: 100, refund: 100, currency: 'CNY' },
      };
      refundResponse = { ...common, create_time: accepted, status: 'PROCESSING' };
      transport.mockImplementation(async (url, init) => {
        if (String(url).endsWith('/v3/refund/domestic/refunds') && init?.method === 'POST') {
          const requestBody = JSON.parse(String(init.body));
          expect(Buffer.byteLength(requestBody.reason, 'utf8')).toBeLessThanOrEqual(80);
          expect(requestBody.out_refund_no).toBe(f.out_refund_no);
          const early = notification(
            { ...common, refund_status: 'SUCCESS', success_time: success },
            'REFUND.SUCCESS',
          );
          expect((await notify(early)).status).toBe(204);
        }
        const raw = JSON.stringify(
          String(url).includes('/transactions/out-trade-no/') ? payment() : refundResponse,
        );
        return new Response(raw, { status: 200, headers: signed(raw) });
      });
      const response = data<CommerceCommandResult>(
        await cmd('CONFIRM_REFUND', checker, '合成很长的独立审核原因'.repeat(10)),
      );
      expect(response.order.status).toBe('REFUNDED');
      expect(response.order.refund).toMatchObject({ status: 'SUCCEEDED', acceptedAt: accepted });
      const saved = (
        await api.pool.query('SELECT accepted_at,status FROM billing_refunds WHERE id=$1', [f.id])
      ).rows[0]!;
      expect(saved.status).toBe('SUCCEEDED');
      expect(saved.accepted_at.toISOString()).toBe(accepted);
      const mismatched = notification(
        {
          ...common,
          refund_id: 'a-different-provider-refund',
          refund_status: 'SUCCESS',
          success_time: success,
        },
        'REFUND.SUCCESS',
      );
      expect((await notify(mismatched)).status).toBe(409);
      const unchanged = (
        await api.pool.query(
          'SELECT provider_refund_id,accepted_at,status FROM billing_refunds WHERE id=$1',
          [f.id],
        )
      ).rows[0]!;
      expect(unchanged.provider_refund_id).toBe(common.refund_id);
      expect(unchanged.accepted_at.toISOString()).toBe(accepted);
      expect(unchanged.status).toBe('SUCCEEDED');
      const audits = (
        await api.pool.query(
          `SELECT a.actor_id,u.status,u.password_hash FROM audit_logs a JOIN users u ON u.id=a.actor_id
          WHERE a.resource_id=$1 AND a.action IN ('commerce.order.paid','commerce.order.refunded')`,
          [order.id],
        )
      ).rows;
      expect(audits).toHaveLength(2);
      expect(new Set(audits.map((a) => a.actor_id)).size).toBe(2);
      for (const audit of audits) {
        expect(audit.status).toBe('DISABLED');
        expect([owner.id, maker.id, checker.id]).not.toContain(audit.actor_id);
        expect(audit.password_hash).not.toMatch(/^scrypt\$/);
      }
    });
    test('real PostgreSQL reconciliation detects missing local rows and inconsistent refund identities, amounts and billing dates with a controlled bill provider', async () => {
      const local = (
        await api.pool.query(
          `SELECT o.out_trade_no,o.provider_transaction_id,o.amount_fen,
          to_char(o.paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS paid_day,
          f.out_refund_no,f.provider_refund_id,f.amount_fen AS refund_amount,
          to_char(f.accepted_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS accepted_day
          FROM billing_orders o JOIN billing_refunds f ON f.order_id=o.id WHERE o.id=$1`,
          [order.id],
        )
      ).rows[0]!;
      const day = local.accepted_day as string;
      const paymentRow: WechatPayBillRow = {
        outTradeNo: local.out_trade_no,
        transactionId: local.provider_transaction_id,
        totalFen: local.amount_fen,
        tradeState: 'SUCCESS',
        outRefundNo: null,
        refundId: null,
        refundFen: null,
        refundState: null,
      };
      const refundRow: WechatPayBillRow = {
        ...paymentRow,
        totalFen: null,
        tradeState: 'REFUND',
        outRefundNo: local.out_refund_no,
        refundId: local.provider_refund_id,
        refundFen: local.refund_amount,
        refundState: 'PROCESSING',
      };
      const dayRows = [...(local.paid_day === day ? [paymentRow] : []), refundRow];
      const download = vi.spyOn(gateway, 'downloadBill');
      const reconcile = async (rows: WechatPayBillRow[], billDate = day) => {
        download.mockResolvedValueOnce({
          date: billDate,
          hashType: 'SHA1',
          hashValue: 'a'.repeat(40),
          bodyHash: 'b'.repeat(64),
          rows,
        });
        return data<{ reconciliation: CommerceReconciliationData }>(
          await call(api, 'post', `${platform}/reconciliations`, {
            cookie: checker.cookie,
            body: { commandId: randomUUID(), source: 'WECHAT_NATIVE', billDate, reason: why },
          }),
        ).reconciliation;
      };
      const exact = await reconcile(dayRows);
      expect(exact.matchedCount).toBe(dayRows.length);
      expect(exact.issues).toEqual([]);
      const missing = await reconcile([]);
      expect(missing.issues.filter((i) => i.code === 'LOCAL_ONLY')).toHaveLength(dayRows.length);
      for (const delta of [
        { refundFen: 50 },
        { refundId: 'wrong-refund-id' },
        { outRefundNo: 'wrong-refund-number' },
      ]) {
        const wrong = await reconcile([
          ...dayRows.filter((r) => r.tradeState === 'SUCCESS'),
          { ...refundRow, ...delta },
        ]);
        expect(wrong.issues.length).toBeGreaterThan(0);
        expect(wrong.matchedCount).toBeLessThan(dayRows.length);
      }
      const wrongDay = await reconcile(dayRows, '2020-01-01');
      expect(wrongDay.matchedCount).toBe(0);
      expect(wrongDay.issues.every((i) => i.code === 'PROVIDER_ONLY')).toBe(true);
      expect((await fresh()).status).toBe('REFUNDED');
      download.mockRestore();
    });
  },
);

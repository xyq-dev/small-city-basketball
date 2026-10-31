import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EntryData, EventRegistrationData } from '@small-city-basketball/contracts';
import type { TradeSourceKind } from '../../../packages/contracts/trade.js';
import { RegistrationService } from '../src/registration-service.js';
import { TradeService } from '../src/trade-service.js';
import type { TradePayments } from '../src/trade-provider.js';
import type { WechatPayOrder, WechatPayRefund } from '../src/commerce/wechatpay.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { createHarness, closeHarness, type Harness } from './p04-support.js';
import {
  command,
  openRegistration,
  registration,
  registrationCommand,
  registrationCommandsPath,
  roster,
} from './p03-support.js';
import { ORIGIN, call } from './support.js';

type ChargeKind = Extract<TradeSourceKind, 'ENTRY_FEE' | 'ENTRY_DEPOSIT'>;
/** The provider is controlled; all source capture, authentication and money receipts use real PostgreSQL. */
function channel() {
  const orders = new Map<string, WechatPayOrder>();
  const refunds = new Map<string, WechatPayRefund>();
  const payments: TradePayments = {
    enabled: true,
    async native(input) {
      orders.set(input.outTradeNo, {
        outTradeNo: input.outTradeNo,
        transactionId: null,
        state: 'NOTPAY',
        totalFen: input.totalFen,
        currency: input.currency,
        successTime: null,
      });
      return { codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-freeze-only' };
    },
    async queryOrder(id) {
      const value = orders.get(id);
      if (!value) throw Error('Synthetic provider: original order missing');
      return { ...value };
    },
    async refund(input) {
      const original = orders.get(input.outTradeNo);
      if (!original?.transactionId) throw Error('Synthetic provider: original payment missing');
      if (refunds.has(input.outRefundNo)) throw Error('Synthetic provider: duplicate dispatch');
      const value: WechatPayRefund = {
        outTradeNo: input.outTradeNo,
        outRefundNo: input.outRefundNo,
        transactionId: original.transactionId,
        refundId: 'SYNTHETIC_REFUND_' + randomUUID(),
        state: 'PROCESSING',
        totalFen: input.totalFen,
        refundFen: input.refundFen,
        currency: input.currency,
        createdTime: new Date().toISOString(),
        successTime: null,
      };
      refunds.set(input.outRefundNo, value);
      return { ...value };
    },
    async queryRefund(id) {
      const value = refunds.get(id);
      if (!value) throw Error('Synthetic provider: original refund missing');
      return { ...value };
    },
    verifyNotification() {
      throw Error('No notification transport in this freeze regression');
    },
    async downloadBill() {
      throw Error('No reconciliation transport in this freeze regression');
    },
  };
  return {
    payments,
    completePayment(id: string) {
      const value = orders.get(id);
      if (!value) throw Error('Original accepted channel order required');
      value.state = 'SUCCESS';
      value.transactionId = 'SYNTHETIC_PAY_' + randomUUID();
      value.successTime = new Date().toISOString();
    },
    completeRefund(id: string) {
      const value = refunds.get(id);
      if (!value) throw Error('Original accepted channel refund required');
      value.state = 'SUCCESS';
      value.successTime = new Date().toISOString();
    },
  };
}

describe(
  'E04 charged registration freeze remains gated after refunds without participant-material requirements',
  { concurrent: false },
  () => {
    let h: Harness, trade: TradeService, source: RegistrationService;
    const provider = channel();
    beforeAll(async () => {
      h = await createHarness(2);
      await maintainPlatformOperator(h.api.pool, {
        email: h.otherOwner.email,
        status: 'ACTIVE',
        reason: 'E04冻结门槛独立资金复核隔离夹具',
      });
      const options = { databaseUrl: h.databaseUrl, appOrigin: ORIGIN };
      trade = new TradeService(h.api.pool, options, {
        encryptionKey: Buffer.alloc(32, 19),
        merchants: {
          [h.owner.orgId]: {
            key: 'synthetic-freeze-' + h.owner.orgId,
            merchantId: '1900000101',
            appId: 'wx1234567890abcdef',
            displayName: '合成冻结门槛收款主体',
            payments: provider.payments,
            receivers: {},
          },
        },
      });
      // Capture runs inside the real entry-creation transaction. The HTTP harness
      // deliberately retains its default-disabled runtime to verify existing bindings still gate.
      source = new RegistrationService(h.api.pool, options, trade);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    });

    async function prepare(kind?: ChargeKind) {
      const opened = await openRegistration(h.api, h.owner, '合成退款冻结回归');
      // The legacy DTO omits false rather than serializing this optional flag.
      expect(opened.rules).not.toBeNull();
      expect(opened.rules?.requireParticipantMaterials).not.toBe(true);
      const storedRules = await h.api.pool.query<{ require_participant_materials: boolean }>(
        'SELECT require_participant_materials FROM event_rulesets WHERE org_id=$1 AND event_id=$2 AND id=$3',
        [h.owner.orgId, opened.event.id, opened.rules!.id],
      );
      expect(storedRules.rows).toHaveLength(1);
      expect(storedRules.rows[0]!.require_participant_materials).toBe(false);
      const amountFen = kind === 'ENTRY_DEPOSIT' ? 5000 : 1200;
      let termsId: string | undefined;
      if (kind) {
        const proposed = await trade.createTerms(h.owner.cookie, h.owner.orgId, {
          clientRequestId: randomUUID(),
          kind,
          sourceId: opened.event.id,
          amountFen,
          terms: '合成条款：报名与付款独立，退款须独立核对，未退且已付资金才满足冻结门槛',
        });
        termsId = proposed.termsId;
        await trade.reviewTerms(h.otherOwner.cookie, h.owner.orgId, termsId!, {
          clientRequestId: randomUUID(),
          expectedVersion: 1,
          decision: 'APPROVE',
          reason: '独立核对合成赛事收费及退款条款',
        });
      }
      const entries: EntryData[] = [];
      const invoices: string[] = [];
      for (const team of h.teams) {
        if (kind) {
          const preview = await trade.preview(h.leader.cookie, {
            kind,
            sourceId: opened.event.id,
          });
          expect(preview).toMatchObject({ enabled: true, termsId, totalFen: amountFen });
        }
        let entry = await source.createEntry(h.leader.cookie, h.owner.orgId, opened.event.id, {
          teamId: team.id,
          ...(kind ? { acceptedTermsIds: { [kind]: termsId }, chargeConsent: true } : {}),
        });
        if (kind) {
          const binding = await trade.sourceOrder(h.leader.cookie, kind, entry.id);
          expect(binding.orderId).toEqual(expect.any(String));
          const id = binding.orderId!;
          invoices.push(id);
          const initial = await trade.get(h.leader.cookie, id);
          const intent = await trade.pay(h.leader.cookie, id, {
            clientRequestId: randomUUID(),
            expectedVersion: initial.version,
            channel: 'NATIVE',
          });
          expect((await trade.get(h.leader.cookie, id)).paidFen).toBe(0);
          const attempt = (
            await h.api.pool.query(
              'SELECT out_trade_no FROM trade_payment_attempts WHERE id=$1 AND order_id=$2',
              [intent.attemptId, id],
            )
          ).rows[0];
          provider.completePayment(attempt.out_trade_no);
          await trade.queryPayment(h.leader.cookie, id, intent.attemptId);
          expect((await trade.get(h.leader.cookie, id)).paidFen).toBe(amountFen);
        } else {
          for (const freeKind of ['ENTRY_FEE', 'ENTRY_DEPOSIT'])
            expect(await trade.sourceOrder(h.leader.cookie, freeKind, entry.id)).toEqual({
              orderId: null,
            });
        }
        entry = await roster(h.api, h.owner, entry, h.leader, team.members);
        entry = await command(h.api, h.owner, entry, h.leader, 'SUBMIT');
        entry = await command(h.api, h.owner, entry, h.owner, 'APPROVE', '独立核对合成名单');
        expect(entry.status).toBe('APPROVED');
        entries.push(entry);
      }
      return { opened, entries, invoices, amountFen };
    }

    async function assertFreezeRejected(eventId: string) {
      const closed = await registration(h.api, h.owner, eventId);
      expect(closed).toMatchObject({
        event: { status: 'REGISTRATION_CLOSED' },
        counts: { APPROVED: 2 },
        capabilities: { canFreeze: false },
        freeze: null,
      });
      const rejected = await call(h.api, 'post', registrationCommandsPath(h.owner.orgId, eventId), {
        cookie: h.owner.cookie,
        body: { type: 'FREEZE_REGISTRATION', expectedVersion: closed.event.version },
      });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
      expect(rejected.body.error.code).toBe('TRADE_PAYMENT_REQUIRED');
      const saved = await h.api.pool.query(
        'SELECT count(*)::int AS n FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
        [h.owner.orgId, eventId],
      );
      expect(saved.rows[0].n).toBe(0);
      const unchanged = await registration(h.api, h.owner, eventId);
      expect(unchanged.event.version).toBe(closed.event.version);
      expect(unchanged.freeze).toBeNull();
    }

    test.each(['ENTRY_FEE', 'ENTRY_DEPOSIT'] as const)(
      '%s: approved entry with pending or successful refund cannot freeze; GET stays readable with runtime disabled',
      async (kind) => {
        const prepared = await prepare(kind);
        let invoice = await trade.get(h.leader.cookie, prepared.invoices[0]!);
        const refund = await trade.requestRefund(h.leader.cookie, invoice.id, {
          clientRequestId: randomUUID(),
          expectedVersion: invoice.version,
          amountFen: prepared.amountFen,
          reason: '合成获批报名的全额退款核对',
        });
        expect((await trade.get(h.leader.cookie, invoice.id)).refundReservedFen).toBe(
          prepared.amountFen,
        );
        const closed = await registrationCommand(
          h.api,
          h.owner,
          await registration(h.api, h.owner, prepared.opened.event.id),
          'CLOSE_REGISTRATION',
        );
        expect(closed.capabilities.canFreeze).toBe(false);
        await assertFreezeRejected(prepared.opened.event.id);

        invoice = await trade.get(h.leader.cookie, invoice.id);
        await expect(
          trade.review(h.leader.cookie, invoice.id, 'REFUND', refund.refundId, {
            clientRequestId: randomUUID(),
            expectedVersion: invoice.version,
            decision: 'APPROVE',
            reason: '本人不能替代独立退款审核',
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await trade.review(h.otherOwner.cookie, invoice.id, 'REFUND', refund.refundId, {
          clientRequestId: randomUUID(),
          expectedVersion: invoice.version,
          decision: 'APPROVE',
          reason: '独立核对合成全额退款依据',
        });
        await trade.dispatchRefund(h.owner.cookie, invoice.id, refund.refundId, {
          clientRequestId: randomUUID(),
          expectedVersion: (await trade.get(h.leader.cookie, invoice.id)).version,
        });
        expect((await trade.get(h.leader.cookie, invoice.id)).refundedFen).toBe(0);
        await assertFreezeRejected(prepared.opened.event.id);
        const original = (
          await h.api.pool.query('SELECT out_refund_no FROM trade_refunds WHERE id=$1', [
            refund.refundId,
          ])
        ).rows[0];
        provider.completeRefund(original.out_refund_no);
        await trade.queryRefund(h.leader.cookie, invoice.id, refund.refundId);
        invoice = await trade.get(h.leader.cookie, invoice.id);
        expect(invoice).toMatchObject({
          paidFen: prepared.amountFen,
          refundedFen: prepared.amountFen,
          refundableFen: 0,
        });
        expect(invoice.refunds[0]?.status).toBe('SUCCEEDED');
        await assertFreezeRejected(prepared.opened.event.id);
      },
    );

    test('unbound legacy free entries still freeze without adding consent or inventing payment', async () => {
      const prepared = await prepare();
      const closed: EventRegistrationData = await registrationCommand(
        h.api,
        h.owner,
        await registration(h.api, h.owner, prepared.opened.event.id),
        'CLOSE_REGISTRATION',
      );
      expect(closed.capabilities.canFreeze).toBe(true);
      const frozen = await registrationCommand(h.api, h.owner, closed, 'FREEZE_REGISTRATION');
      expect(frozen.freeze?.entries).toHaveLength(2);
      expect(frozen.capabilities.canFreeze).toBe(false);
      const claimed = await h.api.pool.query(
        "SELECT count(*)::int AS n FROM trade_orders WHERE kind IN('ENTRY_FEE','ENTRY_DEPOSIT') AND source_id=ANY($1::uuid[])",
        [prepared.entries.map((entry) => entry.id)],
      );
      expect(claimed.rows[0].n).toBe(0);
      expect(provider.payments.enabled).toBe(true);
    });
  },
);

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { TradeService } from '../src/trade-service.js';
import type { TradeRuntime, TradePayments } from '../src/trade-provider.js';
import type {
  WechatPayOrder,
  WechatPayNotification,
  WechatPayRefund,
} from '../src/commerce/wechatpay.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { createHarness, closeHarness, type Harness } from './p04-support.js';
import { openRegistration } from './p03-support.js';
import { tradeHash } from '../src/trade-domain.js';
import { ORIGIN } from './support.js';

/** Real migrated PostgreSQL and real authentication/session locks; provider transport is synthetic only. */
describe(
  'E04 source-bound money persistence, unknown outcomes and concurrent budgets',
  { concurrent: false },
  () => {
    let h: Harness,
      service: TradeService,
      runtime: TradeRuntime,
      profile: string,
      serial = 0;
    const payments: TradePayments = {
      enabled: true,
      native: vi.fn(),
      queryOrder: vi.fn(),
      refund: vi.fn(),
      queryRefund: vi.fn(),
      verifyNotification: vi.fn(),
      downloadBill: vi.fn(),
    };
    const command = () => randomUUID();
    beforeAll(async () => {
      h = await createHarness(2);
      profile = randomUUID();
      await maintainPlatformOperator(h.api.pool, {
        email: h.otherOwner.email,
        status: 'ACTIVE',
        reason: 'E04独立保证金审核夹具',
      });
      await maintainPlatformOperator(h.api.pool, {
        email: h.leader.email,
        status: 'ACTIVE',
        reason: 'E04独立资金审核隔离夹具',
      });
      await h.api.pool.query(
        "INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,status,reviewed_by,reviewed_at) VALUES($1,$2,'合成收费球员','PG',180,'合成市','仅隔离验收',1000,'APPROVED',$3,clock_timestamp())",
        [profile, h.otherOwner.id, h.owner.id],
      );
      runtime = {
        encryptionKey: Buffer.alloc(32, 7),
        merchants: {
          [h.owner.orgId]: {
            key: 'e04-' + h.owner.orgId,
            merchantId: '1900000101',
            appId: 'wx1234567890abcdef',
            displayName: '合成独立业务商户',
            payments,
            playerFeesEnabled: true,
            receivers: {},
          },
        },
      };
      service = new TradeService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        runtime,
      );
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    });
    async function source(charged = true) {
      const preview = (await service.preview(h.owner.cookie, {
        kind: 'PLAYER_APPEARANCE',
        orgId: h.owner.orgId,
        teamId: h.teams[0]!.id,
        profileIds: [profile],
      })) as any;
      const appearance = command(),
        booking = command();
      let invoice: string | null = null;
      await (service as any).transaction(async (c: PoolClient) => {
        const actor = await (service as any).lockActor(c, h.owner.cookie);
        await (service as any).calendar(c, h.owner.orgId);
        const settings = (await c.query('SELECT * FROM booking_settings WHERE id FOR SHARE'))
          .rows[0];
        const fee = Math.round((1000 * settings.fee_bps) / 10000);
        const offset = 72 + ++serial * 4;
        await c.query(
          "INSERT INTO booking_orders(id,org_id,team_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version) VALUES($1,$2,$3,'合成资金场次',$4,$5,'SINGLE',$6,$7)",
          [
            booking,
            h.owner.orgId,
            h.teams[0]!.id,
            h.teams[0]!.name,
            h.owner.id,
            settings.fee_bps,
            settings.version,
          ],
        );
        await c.query(
          "INSERT INTO booking_appearances(id,order_id,profile_id,player_user_id,label,status,report_at,start_at,end_at,venue,service_fen,platform_fee_fen,total_fen,expires_at) VALUES($1,$2,$3,$4,'合成收费场次','REQUESTED',clock_timestamp()+($5::int*interval '1 hour'),clock_timestamp()+($5::int*interval '1 hour'),clock_timestamp()+(($5::int+1)*interval '1 hour'),'合成球馆',1000,$6,$7,clock_timestamp()+interval '10 minutes')",
          [appearance, booking, profile, h.otherOwner.id, offset, fee, 1000 + fee],
        );
        if (charged)
          invoice = await service.captureSourceCharge(c, actor, {
            kind: 'PLAYER_APPEARANCE',
            sourceId: appearance,
            acceptedTermsId: preview.quotes[0].termsId,
            chargeConsent: true,
          });
        else
          invoice = await new TradeService(h.api.pool, {
            databaseUrl: h.databaseUrl,
            appOrigin: ORIGIN,
          }).captureSourceCharge(c, actor, {
            kind: 'PLAYER_APPEARANCE',
            sourceId: appearance,
            chargeConsent: false,
          });
      });
      await h.api.pool.query(
        "UPDATE booking_appearances SET status='ACCEPTED',accepted_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [appearance],
      );
      return { appearance, invoice: invoice!, booking };
    }
    async function payment(id: string, unknown = false, cookie = h.owner.cookie) {
      vi.mocked(payments.native).mockImplementation(async () => {
        if (unknown) throw Error('synthetic lost result');
        return { codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-e04' };
      });
      const dto = await service.get(cookie, id),
        input = { clientRequestId: command(), expectedVersion: dto.version, channel: 'NATIVE' };
      if (unknown) await expect(service.pay(cookie, id, input)).rejects.toThrow('synthetic');
      else await service.pay(cookie, id, input);
      const attempt = (
        await h.api.pool.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1', [id])
      ).rows[0];
      return { attempt, input };
    }
    async function confirm(id: string, attempt: any) {
      const value: WechatPayOrder = {
        outTradeNo: attempt.out_trade_no,
        transactionId: 'T' + attempt.id,
        state: 'SUCCESS',
        totalFen: attempt.total_fen,
        currency: 'CNY',
        successTime: new Date().toISOString(),
      };
      vi.mocked(payments.queryOrder).mockResolvedValue(value);
      await service.queryPayment(h.owner.cookie, id, attempt.id);
      return value;
    }
    test('captures authoritative price once, remains payable after ACCEPT, and refuses retroactive/client-priced billing', async () => {
      const charged = await source();
      const dto = await service.get(h.owner.cookie, charged.invoice);
      expect(dto.currentSource).toMatchObject({ valid: true, payable: true });
      expect(dto.totalFen).toBeGreaterThanOrEqual(1000);
      await expect(
        service.create(h.owner.cookie, {
          clientRequestId: command(),
          kind: 'PLAYER_APPEARANCE',
          sourceId: charged.appearance,
          expectedSourceVersion: 2,
          sourceHash: 'x',
          amountFen: 1,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const free = await source(false);
      expect(
        await service.sourceOrder(h.owner.cookie, 'PLAYER_APPEARANCE', free.appearance),
      ).toEqual({ orderId: null });
      const quote = await service.quote(h.owner.cookie, {
        kind: 'PLAYER_APPEARANCE',
        sourceId: free.appearance,
      });
      await expect(
        service.create(h.owner.cookie, {
          clientRequestId: command(),
          kind: 'PLAYER_APPEARANCE',
          sourceId: free.appearance,
          expectedSourceVersion: quote.sourceVersion,
          sourceHash: quote.sourceHash,
        }),
      ).rejects.toMatchObject({ code: 'TRADE_SOURCE_NOT_CHARGED' });
      await expect(
        h.api.pool.query('UPDATE trade_orders SET total_fen=1 WHERE id=$1', [charged.invoice]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    test('UNKNOWN is permanent intent: replay never dispatches twice; expired/cancelled source payment remains real PAID plus conflict', async () => {
      const s = await source(),
        before = vi.mocked(payments.native).mock.calls.length,
        { attempt, input } = await payment(s.invoice, true);
      expect(attempt.status).toBe('UNKNOWN');
      expect((await service.receipt(h.owner.cookie, input.clientRequestId)).result.attemptId).toBe(
        attempt.id,
      );
      await service.pay(h.owner.cookie, s.invoice, input);
      expect(vi.mocked(payments.native).mock.calls.length).toBe(before + 1);
      const current = await service.get(h.owner.cookie, s.invoice);
      await expect(
        service.pay(h.owner.cookie, s.invoice, {
          ...input,
          clientRequestId: command(),
          expectedVersion: current.version,
        }),
      ).rejects.toMatchObject({ code: 'TRADE_PAYMENT_UNRESOLVED' });
      await h.api.pool.query(
        "UPDATE booking_appearances SET status='CANCELLED',version=version+1 WHERE id=$1",
        [s.appearance],
      );
      await confirm(s.invoice, attempt);
      const dto = await service.get(h.owner.cookie, s.invoice);
      expect(dto.paidFen).toBe(dto.totalFen);
      expect(dto.status).toBe('SOURCE_CONFLICT');
      expect(
        (
          await h.api.pool.query('SELECT status FROM booking_appearances WHERE id=$1', [
            s.appearance,
          ])
        ).rows[0].status,
      ).toBe('CANCELLED');
      const disabled = new TradeService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
      });
      await expect(
        (disabled as any).transaction((c: PoolClient) =>
          disabled.assertSourceFinancialGate(c, 'PLAYER_APPEARANCE', s.appearance),
        ),
      ).rejects.toMatchObject({ code: 'TRADE_PAYMENT_REQUIRED' });
    });
    test('partially refunds with independent review, unknown reservation and original-query recovery; concurrent requests cannot overspend', async () => {
      const s = await source(),
        { attempt } = await payment(s.invoice);
      await confirm(s.invoice, attempt);
      let dto = await service.get(h.owner.cookie, s.invoice);
      const requested = (await service.requestRefund(h.owner.cookie, s.invoice, {
        clientRequestId: command(),
        expectedVersion: dto.version,
        amountFen: 300,
        reason: '合成部分服务退款',
      })) as any;
      dto = await service.get(h.owner.cookie, s.invoice);
      await expect(
        service.review(h.owner.cookie, s.invoice, 'REFUND', requested.refundId, {
          clientRequestId: command(),
          expectedVersion: dto.version,
          decision: 'APPROVE',
          reason: '本人不得独立审核',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await service.review(h.leader.cookie, s.invoice, 'REFUND', requested.refundId, {
        clientRequestId: command(),
        expectedVersion: dto.version,
        decision: 'APPROVE',
        reason: '独立核对部分退款',
      });
      dto = await service.get(h.owner.cookie, s.invoice);
      vi.mocked(payments.refund).mockRejectedValue(Error('synthetic refund lost'));
      const dispatch = { clientRequestId: command(), expectedVersion: dto.version };
      await expect(
        service.dispatchRefund(h.owner.cookie, s.invoice, requested.refundId, dispatch),
      ).rejects.toThrow();
      const sends = vi.mocked(payments.refund).mock.calls.length;
      await service.dispatchRefund(h.owner.cookie, s.invoice, requested.refundId, dispatch);
      expect(vi.mocked(payments.refund).mock.calls.length).toBe(sends);
      dto = await service.get(h.owner.cookie, s.invoice);
      expect(dto.refundReservedFen).toBe(300);
      expect(dto.refundedFen).toBe(0);
      const refund = (
        await h.api.pool.query('SELECT * FROM trade_refunds WHERE id=$1', [requested.refundId])
      ).rows[0];
      vi.mocked(payments.queryRefund).mockResolvedValue({
        outTradeNo: attempt.out_trade_no,
        outRefundNo: refund.out_refund_no,
        transactionId: 'T' + attempt.id,
        refundId: 'R' + refund.id,
        state: 'SUCCESS',
        totalFen: attempt.total_fen,
        refundFen: 300,
        currency: 'CNY',
        createdTime: new Date().toISOString(),
        successTime: new Date().toISOString(),
      } satisfies WechatPayRefund);
      await service.queryRefund(h.owner.cookie, s.invoice, refund.id);
      dto = await service.get(h.owner.cookie, s.invoice);
      expect(dto.refundedFen).toBe(300);
      const amount = Math.floor(dto.refundableFen * 0.75),
        results = await Promise.allSettled(
          [1, 2].map(() =>
            service.requestRefund(h.owner.cookie, s.invoice, {
              clientRequestId: command(),
              expectedVersion: dto.version,
              amountFen: amount,
              reason: '并发可退预算检查',
            }),
          ),
        );
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const latest = await service.get(h.owner.cookie, s.invoice);
      expect(latest.refundReservedFen).toBe(300 + amount);
      expect(latest.refundableFen).toBe(latest.totalFen - 300 - amount);
      await expect(
        (service as any).transaction((c: PoolClient) =>
          service.assertAccountClosureSafe(c, h.owner.id),
        ),
      ).rejects.toMatchObject({ code: 'TRADE_MONEY_UNRESOLVED' });
    });
    test('verified callback event and money effects commit atomically and reject same-id mutation', async () => {
      const s = await source(),
        { attempt } = await payment(s.invoice);
      const value: WechatPayOrder = {
        outTradeNo: attempt.out_trade_no,
        transactionId: 'T' + attempt.id,
        state: 'SUCCESS',
        totalFen: attempt.total_fen,
        currency: 'CNY',
        successTime: new Date().toISOString(),
      };
      const event: WechatPayNotification = { id: command(), kind: 'PAYMENT', payment: value };
      vi.mocked(payments.verifyNotification).mockReturnValue(event);
      const key = runtime.merchants![h.owner.orgId]!.key;
      await Promise.all([
        service.notification(key, Buffer.from('synthetic'), {}),
        service.notification(key, Buffer.from('synthetic'), {}),
      ]);
      expect((await service.get(h.owner.cookie, s.invoice)).paidFen).toBe(attempt.total_fen);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM trade_provider_events WHERE merchant_key=$1 AND event_id=$2',
            [key, event.id],
          )
        ).rows[0].n,
      ).toBe(1);
      vi.mocked(payments.verifyNotification).mockReturnValue({
        ...event,
        payment: { ...value, totalFen: 1 },
      });
      await expect(service.notification(key, Buffer.from('mutated'), {})).rejects.toMatchObject({
        code: 'TRADE_NOTIFICATION_CONFLICT',
      });
    });
    async function reconcileAll() {
      const date = (
        await h.api.pool.query(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date",
        )
      ).rows[0].date;
      const paid = (
        await h.api.pool.query(
          "SELECT p.* FROM trade_payment_attempts p JOIN trade_orders o ON o.id=p.order_id WHERE o.org_id=$1 AND p.status='PAID' AND (p.paid_at AT TIME ZONE 'Asia/Shanghai')::date=$2::date",
          [h.owner.orgId, date],
        )
      ).rows;
      const refunds = (
        await h.api.pool.query(
          "SELECT r.*,p.out_trade_no,p.provider_transaction_id FROM trade_refunds r JOIN trade_payment_attempts p ON p.id=r.payment_id JOIN trade_orders o ON o.id=r.order_id WHERE o.org_id=$1 AND r.status='SUCCEEDED' AND (r.success_at AT TIME ZONE 'Asia/Shanghai')::date=$2::date",
          [h.owner.orgId, date],
        )
      ).rows;
      const rows = [
        ...paid.map((p) => ({
          outTradeNo: p.out_trade_no,
          transactionId: p.provider_transaction_id,
          totalFen: p.total_fen,
          tradeState: 'SUCCESS' as const,
          outRefundNo: null,
          refundId: null,
          refundFen: null,
          refundState: null,
        })),
        ...refunds.map((r) => ({
          outTradeNo: r.out_trade_no,
          transactionId: r.provider_transaction_id,
          totalFen: null,
          tradeState: 'REFUND' as const,
          outRefundNo: r.out_refund_no,
          refundId: r.provider_refund_id,
          refundFen: r.amount_fen,
          refundState: 'SUCCESS',
        })),
      ];
      const bodyHash = tradeHash({ date, rows });
      vi.mocked(payments.downloadBill).mockResolvedValue({
        date,
        hashType: 'SHA1',
        hashValue: 'a'.repeat(40),
        bodyHash,
        rows,
      });
      const result = (await service.reconcile(h.owner.cookie, h.owner.orgId, {
        clientRequestId: command(),
        date,
      })) as any;
      expect(result.reconciliation.issues).toEqual([]);
      return { date, bodyHash };
    }
    test('guarantee reversal preserves budget until split is cancelled or confirmed returned; stale approvals cannot dispatch', async () => {
      const m = runtime.merchants![h.owner.orgId]!;
      m.receivers[h.owner.id] = { merchantId: '1900000102', displayName: '合成赛事经营方' };
      m.settlements = {
        enabled: true,
        returnSupported: true,
        split: vi.fn(async (i) => ({
          transactionId: i.transactionId,
          outOrderNo: i.outOrderNo,
          orderId: 'S' + command(),
          state: 'FINISHED' as const,
          receiver: {
            merchantId: i.receiverMerchantId,
            amountFen: i.amountFen,
            result: 'SUCCESS' as const,
            detailId: 'D' + command(),
          },
        })),
        query: vi.fn(),
        returnFunds: vi.fn(async () => {
          throw Error('synthetic return lost');
        }),
        queryReturn: vi.fn(async (i) => ({
          outOrderNo: i.outOrderNo,
          outReturnNo: i.outReturnNo,
          returnId: 'R' + i.outReturnNo,
          merchantId: i.receiverMerchantId,
          amountFen: i.amountFen,
          state: 'SUCCESS' as const,
        })),
      };
      const reg = await openRegistration(h.api, h.owner, 'E04保证金更正');
      const term = (await service.createTerms(h.owner.cookie, h.owner.orgId, {
        clientRequestId: command(),
        kind: 'ENTRY_DEPOSIT',
        sourceId: reg.event.id,
        amountFen: 1000,
        terms: '合成保证金，赛后按真实证据独立审核扣减，其余原路退回',
      })) as any;
      await service.reviewTerms(h.otherOwner.cookie, h.owner.orgId, term.termsId, {
        clientRequestId: command(),
        expectedVersion: 1,
        decision: 'APPROVE',
        reason: '独立核对保证金退款约定',
      });
      const entryId = command();
      let invoice = '';
      await (service as any).transaction(async (c: PoolClient) => {
        const a = await (service as any).lockActor(c, h.leader.cookie);
        await (service as any).calendar(c, h.owner.orgId);
        await c.query(
          'INSERT INTO entries(id,org_id,event_id,team_id,team_name,ruleset_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            entryId,
            h.owner.orgId,
            reg.event.id,
            h.teams[0]!.id,
            h.teams[0]!.name,
            reg.rules!.id,
            h.leader.id,
          ],
        );
        invoice = (await service.captureSourceCharge(c, a, {
          kind: 'ENTRY_DEPOSIT',
          sourceId: entryId,
          acceptedTermsId: term.termsId,
          chargeConsent: true,
        }))!;
      });
      const { attempt } = await payment(invoice, false, h.leader.cookie);
      expect(attempt.profit_sharing).toBe(true);
      await confirm(invoice, attempt);
      await h.api.pool.query("UPDATE events SET status='COMPLETED',version=version+1 WHERE id=$1", [
        reg.event.id,
      ]);
      await reconcileAll();
      const version = async () => (await service.get(h.owner.cookie, invoice)).version;
      const review = async (kind: string, id: string, decision: string) =>
        service.review(h.otherOwner.cookie, invoice, kind, id, {
          clientRequestId: command(),
          expectedVersion: await version(),
          decision,
          reason: '独立核对资金更正与证据',
        });
      const deduction = async () => {
        const d = (await service.proposeDeduction(h.owner.cookie, invoice, {
          clientRequestId: command(),
          expectedVersion: await version(),
          amountFen: 100,
          reason: '合成履约证据支持扣减',
          evidenceReference: 'synthetic-evidence',
        })) as any;
        await review('DEDUCTION', d.deductionId, 'APPROVE');
        return d.deductionId;
      };
      const split = async () => {
        const r = (await service.proposeSettlement(h.owner.cookie, invoice, {
          clientRequestId: command(),
          expectedVersion: await version(),
        })) as any;
        await review('SETTLEMENT', r.settlementId, 'APPROVE');
        return r.settlementId;
      };
      const d1 = await deduction(),
        s1 = await split();
      await review('DEDUCTION', d1, 'REVERSE');
      let dto = await service.get(h.leader.cookie, invoice);
      expect(dto.deductions.find((d) => d.id === d1)?.status).toBe('REVERSAL_PENDING');
      expect(dto.refundableFen).toBe(900);
      await expect(
        service.dispatchSettlement(h.owner.cookie, invoice, s1, {
          clientRequestId: command(),
          expectedVersion: dto.version,
        }),
      ).rejects.toMatchObject({ code: 'TRADE_SETTLEMENT_UNRESOLVED' });
      expect(m.settlements.split).not.toHaveBeenCalled();
      await review('SETTLEMENT', s1, 'REJECT');
      await review('DEDUCTION', d1, 'REVERSE');
      expect((await service.get(h.leader.cookie, invoice)).refundableFen).toBe(1000);
      const d2 = await deduction(),
        s2 = await split();
      await service.dispatchSettlement(h.owner.cookie, invoice, s2, {
        clientRequestId: command(),
        expectedVersion: await version(),
      });
      expect((await service.get(h.leader.cookie, invoice)).settledFen).toBe(100);
      await review('DEDUCTION', d2, 'REVERSE');
      expect((await service.get(h.leader.cookie, invoice)).refundableFen).toBe(900);
      const ret = {
        clientRequestId: command(),
        expectedVersion: await version(),
        reason: '按独立批准保证金更正回退',
      };
      await expect(service.returnSettlement(h.owner.cookie, invoice, s2, ret)).rejects.toThrow(
        'synthetic return lost',
      );
      const sends = vi.mocked(m.settlements.returnFunds).mock.calls.length;
      await service.returnSettlement(h.owner.cookie, invoice, s2, ret);
      expect(vi.mocked(m.settlements.returnFunds).mock.calls.length).toBe(sends);
      await service.queryReturn(h.owner.cookie, invoice, s2);
      dto = await service.get(h.leader.cookie, invoice);
      expect(dto.settledFen).toBe(0);
      expect(dto.settlements.find((s) => s.id === s2)?.returnedFen).toBe(100);
      expect(dto.refundableFen).toBe(900);
      await review('DEDUCTION', d2, 'REVERSE');
      expect((await service.get(h.leader.cookie, invoice)).refundableFen).toBe(1000);
      const rr = (await service.requestRefund(h.leader.cookie, invoice, {
        clientRequestId: command(),
        expectedVersion: await version(),
        amountFen: 1000,
        reason: '保证金更正完成全额原路退回',
      })) as any;
      await review('REFUND', rr.refundId, 'APPROVE');
      vi.mocked(payments.refund).mockImplementation(async (i) => ({
        outTradeNo: i.outTradeNo,
        outRefundNo: i.outRefundNo,
        transactionId: 'T' + attempt.id,
        refundId: 'RF' + command(),
        state: 'SUCCESS',
        totalFen: i.totalFen,
        refundFen: i.refundFen,
        currency: 'CNY',
        createdTime: new Date().toISOString(),
        successTime: new Date().toISOString(),
      }));
      await service.dispatchRefund(h.owner.cookie, invoice, rr.refundId, {
        clientRequestId: command(),
        expectedVersion: await version(),
      });
      expect((await service.get(h.leader.cookie, invoice)).refundedFen).toBe(1000);
    });
    test('late channel refund success invalidates old reconciliation and blocks both stale proposal approval and dispatch', async () => {
      const m = runtime.merchants![h.owner.orgId]!;
      m.receivers[h.otherOwner.id] = { merchantId: '1900000103', displayName: '合成球员结算方' };
      for (const stage of ['APPROVE', 'DISPATCH']) {
        const s = await source(),
          { attempt } = await payment(s.invoice);
        await confirm(s.invoice, attempt);
        await h.api.pool.query(
          "UPDATE booking_appearances SET status='COMPLETED',arrived_at=clock_timestamp(),completed_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [s.appearance],
        );
        const version = async () => (await service.get(h.owner.cookie, s.invoice)).version;
        const rr = (await service.requestRefund(h.owner.cookie, s.invoice, {
          clientRequestId: command(),
          expectedVersion: await version(),
          amountFen: 300,
          reason: '合成渠道迟到纠正退款',
        })) as any;
        await service.review(h.leader.cookie, s.invoice, 'REFUND', rr.refundId, {
          clientRequestId: command(),
          expectedVersion: await version(),
          decision: 'APPROVE',
          reason: '独立批准部分退款',
        });
        const refundId = 'RF' + command();
        vi.mocked(payments.refund).mockImplementation(async (i) => ({
          outTradeNo: i.outTradeNo,
          outRefundNo: i.outRefundNo,
          transactionId: 'T' + attempt.id,
          refundId,
          state: 'CLOSED',
          totalFen: i.totalFen,
          refundFen: i.refundFen,
          currency: 'CNY',
          createdTime: new Date().toISOString(),
          successTime: null,
        }));
        await service.dispatchRefund(h.owner.cookie, s.invoice, rr.refundId, {
          clientRequestId: command(),
          expectedVersion: await version(),
        });
        // A same-day older successful reconciliation cannot cover this newly paid source.
        await expect(
          service.proposeSettlement(h.owner.cookie, s.invoice, {
            clientRequestId: command(),
            expectedVersion: await version(),
          }),
        ).rejects.toMatchObject({ code: 'TRADE_RECONCILIATION_REQUIRED' });
        await reconcileAll();
        const split = (await service.proposeSettlement(h.owner.cookie, s.invoice, {
          clientRequestId: command(),
          expectedVersion: await version(),
        })) as any;
        if (stage === 'DISPATCH')
          await service.review(h.leader.cookie, s.invoice, 'SETTLEMENT', split.settlementId, {
            clientRequestId: command(),
            expectedVersion: await version(),
            decision: 'APPROVE',
            reason: '独立批准当前可分账',
          });
        const r = (await h.api.pool.query('SELECT * FROM trade_refunds WHERE id=$1', [rr.refundId]))
          .rows[0];
        const before = (
          await h.api.pool.query('SELECT money_version FROM trade_orders WHERE id=$1', [s.invoice])
        ).rows[0].money_version;
        vi.mocked(payments.queryRefund).mockResolvedValue({
          outTradeNo: attempt.out_trade_no,
          outRefundNo: r.out_refund_no,
          transactionId: 'T' + attempt.id,
          refundId,
          state: 'SUCCESS',
          totalFen: attempt.total_fen,
          refundFen: 300,
          currency: 'CNY',
          createdTime: new Date().toISOString(),
          successTime: new Date().toISOString(),
        });
        await service.queryRefund(h.owner.cookie, s.invoice, r.id);
        await service.queryRefund(h.owner.cookie, s.invoice, r.id);
        expect(
          (
            await h.api.pool.query('SELECT money_version FROM trade_orders WHERE id=$1', [
              s.invoice,
            ])
          ).rows[0].money_version,
        ).toBe(before + 1);
        const count = (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM trade_reconciliations WHERE org_id=$1',
            [h.owner.orgId],
          )
        ).rows[0].n;
        const first = await reconcileAll(),
          second = await reconcileAll();
        expect(first.bodyHash).toBe(second.bodyHash);
        expect(
          (
            await h.api.pool.query(
              'SELECT count(*)::int AS n FROM trade_reconciliations WHERE org_id=$1',
              [h.owner.orgId],
            )
          ).rows[0].n,
        ).toBe(count + 2);
        if (stage === 'APPROVE')
          await expect(
            service.review(h.leader.cookie, s.invoice, 'SETTLEMENT', split.settlementId, {
              clientRequestId: command(),
              expectedVersion: await version(),
              decision: 'APPROVE',
              reason: '金额变化后必须重新提案',
            }),
          ).rejects.toMatchObject({ code: 'TRADE_SETTLEMENT_AMOUNT' });
        else
          await expect(
            service.dispatchSettlement(h.owner.cookie, s.invoice, split.settlementId, {
              clientRequestId: command(),
              expectedVersion: await version(),
            }),
          ).rejects.toMatchObject({ code: 'TRADE_SETTLEMENT_AMOUNT' });
      }
    });
    test('JSAPI dispatch revalidates identity in the final transaction and never calls channel after a revoked binding', async () => {
      const s = await source();
      let rechecks = 0;
      payments.jsapi = vi.fn(async () => ({
        timeStamp: '123',
        nonceStr: 'synthetic',
        package: 'prepay_id=synthetic',
        signType: 'RSA' as const,
        paySign: 'synthetic',
      }));
      runtime.resolvePayer = async () => ({
        openid: 'synthetic-openid-current',
        appId: runtime.merchants![h.owner.orgId]!.appId,
        assertCurrent: async () => {
          rechecks++;
          throw Error('synthetic binding was revoked');
        },
      });
      const dto = await service.get(h.owner.cookie, s.invoice);
      await expect(
        service.pay(h.owner.cookie, s.invoice, {
          clientRequestId: command(),
          expectedVersion: dto.version,
          channel: 'JSAPI',
          code: 'synthetic-onetime-code',
        }),
      ).rejects.toThrow('binding was revoked');
      expect(rechecks).toBe(1);
      expect(payments.jsapi).not.toHaveBeenCalled();
      const attempts = (await service.get(h.owner.cookie, s.invoice)).attempts;
      expect(attempts[0]?.status).toBe('FAILED');
      runtime.resolvePayer = async () => ({
        openid: 'synthetic-openid-current',
        appId: runtime.merchants![h.owner.orgId]!.appId,
        assertCurrent: async () => {
          rechecks++;
        },
      });
      await service.pay(h.owner.cookie, s.invoice, {
        clientRequestId: command(),
        expectedVersion: (await service.get(h.owner.cookie, s.invoice)).version,
        channel: 'JSAPI',
        code: 'synthetic-onetime-code-2',
      });
      expect(rechecks).toBe(2);
      expect(payments.jsapi).toHaveBeenCalledTimes(1);
      expect((await service.get(h.owner.cookie, s.invoice)).paidFen).toBe(0);
    });
  },
);

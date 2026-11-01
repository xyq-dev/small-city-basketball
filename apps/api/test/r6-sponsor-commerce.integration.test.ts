import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { beforeAll, afterAll, describe, test, expect, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import {
  SponsorCommerceService,
  type SponsorCommerceOptions,
} from '../src/sponsor-commerce-service.js';
import {
  claimSponsorRefundAllocation,
  assertSponsorRefundDispatch,
  readSponsorTradeSource,
  readSponsorClosureFunds,
} from '../src/sponsor-commerce-source.js';
import type { TradePayments } from '../src/trade-provider.js';
import type { SponsorSettlementProvider } from '../src/trade-wechat-multi-provider.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  testDatabaseUrl,
  login,
  type User,
  type Api,
} from './support.js';

/** Real PostgreSQL, real sessions, row locks and immutable triggers. All channel data is explicitly synthetic. */
describe(
  'R6 sponsor commercial contracts and shared-ledger allocation',
  { concurrent: false },
  () => {
    let api: Api,
      service: SponsorCommerceService,
      trade: any,
      options: SponsorCommerceOptions,
      owner: User,
      payer: User,
      finance1: User,
      finance2: User,
      receiver: User,
      stranger: User;
    let campaign: string, databaseUrl: string, startsAt: string, endsAt: string;
    const provider: SponsorSettlementProvider = {
      enabled: true,
      returnSupported: true,
      split: vi.fn(),
      querySplit: vi.fn(),
      returnFunds: vi.fn(),
      queryReturn: vi.fn(),
      finish: vi.fn(),
      queryFinish: vi.fn(),
    };
    const payments: TradePayments = {
      enabled: true,
      native: vi.fn(),
      queryOrder: vi.fn(),
      refund: vi.fn(),
      queryRefund: vi.fn(),
      verifyNotification: vi.fn(),
      downloadBill: vi.fn(),
    };
    beforeAll(async () => {
      databaseUrl = testDatabaseUrl();
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      api = await createApi({ databaseUrl, appOrigin: ORIGIN });
      const hash = await hashPassword(PASSWORD),
        actors: User[] = [];
      for (const label of ['owner', 'payer', 'finance1', 'finance2', 'receiver', 'stranger']) {
        const u = {
          id: randomUUID(),
          orgId: randomUUID(),
          email: `r6ads-${label}-${RUN_ID}@example.test`,
          cookie: '',
        };
        await api.pool.query(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
          [u.id, u.email, '合成广告' + label, hash],
        );
        await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          u.orgId,
          '合成广告机构' + label,
        ]);
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [u.orgId, u.id],
        );
        u.cookie = await login(api, u);
        actors.push(u);
      }
      [owner, payer, finance1, finance2, receiver, stranger] = actors as [
        User,
        User,
        User,
        User,
        User,
        User,
      ];
      await api.pool.query(
        "UPDATE organization_memberships SET status='DISABLED' WHERE org_id=$1 AND user_id=$2",
        [payer.orgId, payer.id],
      );
      for (const u of [finance1, finance2])
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN')",
          [owner.orgId, u.id],
        );
      const region = (
        await api.pool.query(
          "SELECT catalog_version,region_id FROM region_catalog_nodes WHERE level='COUNTY' ORDER BY region_id LIMIT 1",
        )
      ).rows[0];
      startsAt = new Date(Date.now() + 3600_000).toISOString();
      endsAt = new Date(Date.now() + 86_400_000).toISOString();
      campaign = randomUUID();
      await api.pool.query(
        "INSERT INTO sponsorship_campaigns(id,org_id,region_catalog_version,region_id,brand,title,body,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,'合成品牌','合成投放','隔离测试投放内容',$5,$6,$7)",
        [
          campaign,
          owner.orgId,
          region.catalog_version,
          region.region_id,
          startsAt,
          endsAt,
          owner.id,
        ],
      );
      options = {
        enabled: true,
        merchants: {
          [owner.orgId]: {
            key: 'synthetic-advertiser',
            merchantId: '1900000101',
            appId: 'syntheticApp',
            displayName: '合成平台商户',
            maximumSplitBps: 3500,
            financeActorIds: [finance1.id, finance2.id],
            provider,
            receivers: {
              [receiver.orgId]: {
                merchantId: '1900000102',
                displayName: '合成受益商户',
                authorizationVersion: 'v1',
                expiresAt: new Date(Date.now() + 86400_000 * 30).toISOString(),
                returnsEnabled: true,
              },
            },
          },
        },
        captureSourceCharge: (c, a, i) => trade.captureSourceCharge(c, a, i),
        captureSourceRefund: (c, a, i) => trade.captureSourceRefund(c, a, i),
      };
      // Root supplies this shared adapter in the integrated checkout; no ledger or source hook is stubbed.
      const commonTradeModule = '../src/trade-service.js',
        adapterModule = '../src/remaining-six-trade.js';
      const { TradeService: IntegratedTradeService } = await import(commonTradeModule);
      const { remainingSixTradeSources } = await import(adapterModule);
      trade = new IntegratedTradeService(
        api.pool,
        { databaseUrl, appOrigin: ORIGIN },
        {
          encryptionKey: Buffer.alloc(32, 7),
          sponsorCommerce: options,
          merchants: {
            [owner.orgId]: {
              key: 'synthetic-advertiser',
              merchantId: '1900000101',
              appId: 'syntheticApp',
              displayName: '合成平台商户',
              payments,
              receivers: {},
            },
          },
        },
        remainingSixTradeSources({ sponsorEnabled: true }),
      );
      service = new SponsorCommerceService(api.pool, { databaseUrl, appOrigin: ORIGIN }, options);
      const proposed = await service.beneficiary(finance1.cookie, owner.orgId, {
        commandId: randomUUID(),
        action: 'PROPOSE',
        beneficiaryOrgId: receiver.orgId,
        evidence: '隔离测试回退授权凭据',
      });
      await expect(
        service.beneficiary(finance1.cookie, owner.orgId, {
          commandId: randomUUID(),
          action: 'APPROVE',
          id: proposed.id,
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await service.beneficiary(finance2.cookie, owner.orgId, {
        commandId: randomUUID(),
        action: 'APPROVE',
        id: proposed.id,
        expectedVersion: 1,
      });
    }, 90000);
    afterAll(async () => {
      await api?.app.close();
      await api?.pool.end();
    });
    async function contract(
      totalFen = 10003,
      beforeOrder?: (signed: Record<string, any>) => Promise<void>,
    ) {
      const b = {
        commandId: randomUUID(),
        campaignId: campaign,
        payerUserId: payer.id,
        title: '合成固定价广告合同',
        totalFen,
        allowedFeeFen: 0,
        terms: '双方按固定价格和交付证据独立验收，退款依法走原支付通道。',
        startsAt,
        endsAt,
        shares: [
          { beneficiaryOrgId: owner.orgId, basisPoints: 7000 },
          { beneficiaryOrgId: receiver.orgId, basisPoints: 3000 },
        ],
      };
      const created = await service.createContract(owner.cookie, owner.orgId, b);
      await service.contractCommand(owner.cookie, owner.orgId, created.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        action: 'SUBMIT',
      });
      await service.contractCommand(finance1.cookie, owner.orgId, created.id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        action: 'APPROVE',
      });
      const signed = await service.contractCommand(owner.cookie, owner.orgId, created.id, {
        commandId: randomUUID(),
        expectedVersion: 3,
        action: 'OWNER_SIGN',
      });
      const final = await service.contractCommand(payer.cookie, owner.orgId, created.id, {
        commandId: randomUUID(),
        expectedVersion: 4,
        action: 'ADVERTISER_SIGN',
        acceptedContractHash: signed.contractHash,
      });
      if (beforeOrder) await beforeOrder(final);
      const order = await service.createOrder(payer.cookie, owner.orgId, {
        commandId: randomUUID(),
        contractId: created.id,
        expectedVersion: 5,
        acceptedContractHash: final.contractHash,
        chargeConsent: true,
      });
      return { order, contract: created };
    }
    async function paid(totalFen = 10003) {
      const f = await contract(totalFen),
        trade = f.order.tradeOrderId,
        payment = randomUUID();
      await api.pool.query(
        "INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,provider_transaction_id,paid_at,profit_sharing) VALUES($1,$2,$3,'NATIVE','PAID',$6,$4,clock_timestamp()+interval '1 hour',$5,clock_timestamp(),true)",
        [
          payment,
          trade,
          payment.replaceAll('-', ''),
          randomUUID(),
          'SYNTHETIC' + payment.replaceAll('-', ''),
          totalFen,
        ],
      );
      return { ...f, trade, payment };
    }
    async function act(
      user: User,
      id: string,
      action: string,
      extra: Record<string, unknown> = {},
    ) {
      const view = await service.get(user.cookie, owner.orgId, id);
      return service.orderCommand(user.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: view.order.version,
        action,
        ...extra,
      });
    }
    async function fulfilled(totalFen = 10003) {
      const f = await paid(totalFen);
      const d = await act(owner, f.order.id, 'DELIVERY', {
        evidence: '合成投放交付证据，不以曝光折算收入',
      });
      await act(payer, f.order.id, 'ACCEPT', { childId: d.deliveryId });
      await act(finance1, f.order.id, 'VERIFY_FEE', {
        amountFen: 0,
        evidence: '合成渠道账单核验实际手续费为零',
      });
      return f;
    }
    async function approved(totalFen = 10003) {
      const f = await fulfilled(totalFen);
      const p = await act(owner, f.order.id, 'PROPOSE_SETTLEMENT');
      await act(finance1, f.order.id, 'APPROVE_SETTLEMENT', { childId: p.batchId });
      await act(finance2, f.order.id, 'APPROVE_SETTLEMENT', { childId: p.batchId });
      return { ...f, batchId: p.batchId };
    }
    async function channel(id: string, action: string, childId: string) {
      const view = await service.get(finance1.cookie, owner.orgId, id);
      return service.channel(finance1.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: view.order.version,
        action,
        childId,
      });
    }
    async function refundResult(
      input: { outTradeNo: string; outRefundNo: string; totalFen: number; refundFen: number },
      state: 'SUCCESS' | 'CLOSED' | 'PROCESSING',
    ) {
      const pay = (
        await api.pool.query('SELECT * FROM trade_payment_attempts WHERE out_trade_no=$1', [
          input.outTradeNo,
        ])
      ).rows[0];
      return {
        outTradeNo: input.outTradeNo,
        outRefundNo: input.outRefundNo,
        transactionId: pay.provider_transaction_id,
        refundId: 'SYNTHETIC_RETRY_' + input.outRefundNo,
        state,
        totalFen: input.totalFen,
        refundFen: input.refundFen,
        currency: 'CNY' as const,
        successTime: state === 'SUCCESS' ? new Date().toISOString() : null,
        createdTime: new Date().toISOString(),
      };
    }
    async function refundWithReturn(state: 'CLOSED' | 'PROCESSING' = 'CLOSED') {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'retry-split-' + f.batchId,
        state: 'FINISHED',
        receivers: i.receivers.map((r) => ({
          merchantId: r.merchantId,
          amountFen: r.amountFen,
          result: 'SUCCESS',
          detailId: 'retry-detail-' + r.merchantId,
        })),
      }));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      const p = await act(payer, f.order.id, 'PROPOSE_REFUND', {
        amountFen: 10003,
        reason: '合成原退款恢复义务',
      });
      await act(finance1, f.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      const view = await service.get(owner.cookie, owner.orgId, f.order.id),
        external = view.returns.find((r) => r.status === 'PENDING')!;
      vi.mocked(provider.returnFunds).mockImplementationOnce(async (i) => ({
        outOrderNo: i.outOrderNo,
        outReturnNo: i.outReturnNo,
        merchantId: i.receiverMerchantId,
        amountFen: i.amountFen,
        returnId: 'retry-return-' + external.id,
        state: 'SUCCESS',
      }));
      await channel(f.order.id, 'SEND_RETURN', external.id);
      vi.mocked(provider.finish).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'retry-finish-' + f.batchId,
        state: 'FINISHED',
      }));
      await channel(f.order.id, 'REFUND_UNFREEZE', p.refundPlanId);
      const first = await act(finance1, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId });
      let dto = await trade.get(finance2.cookie, f.trade);
      await trade.review(finance2.cookie, f.trade, 'REFUND', first.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
        decision: 'APPROVE',
        reason: '独立审核原退款',
      });
      vi.mocked(payments.refund).mockImplementationOnce((i) => refundResult(i, state));
      dto = await trade.get(finance1.cookie, f.trade);
      await trade.dispatchRefund(finance1.cookie, f.trade, first.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
      });
      return { ...f, planId: p.refundPlanId, refundId: first.refundId };
    }
    test('explicit failed-refund recovery reuses original returns through rejected reviews and one successful replacement', async () => {
      const f = await refundWithReturn(),
        before = (
          await api.pool.query(
            'SELECT to_jsonb(r) AS row FROM sponsor_return_items r WHERE refund_plan_id=$1 ORDER BY id',
            [f.planId],
          )
        ).rows;
      await expect(act(finance1, f.order.id, 'CLOSE_ORDER')).rejects.toMatchObject({
        code: 'SPONSOR_OBLIGATION_OPEN',
      });
      const first = await act(finance1, f.order.id, 'PROPOSE_RETRY', {
        childId: f.planId,
        evidence: '原退款已由合成渠道确认关闭',
      });
      await expect(
        act(finance1, f.order.id, 'APPROVE_RETRY', { childId: first.retryId }),
      ).rejects.toMatchObject({ status: 403 });
      await act(finance2, f.order.id, 'REJECT_RETRY', { childId: first.retryId });
      const second = await act(finance1, f.order.id, 'PROPOSE_RETRY', {
        childId: f.planId,
        evidence: '重新核验原渠道关闭与已回退证据',
      });
      await act(finance2, f.order.id, 'APPROVE_RETRY', { childId: second.retryId });
      const rejected = await act(finance1, f.order.id, 'CLAIM_RETRY', { childId: second.retryId });
      let dto = await trade.get(finance2.cookie, f.trade);
      await trade.review(finance2.cookie, f.trade, 'REFUND', rejected.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
        decision: 'REJECT',
        reason: '拒绝本次共同退款恢复',
      });
      const third = await act(finance1, f.order.id, 'PROPOSE_RETRY', {
        childId: f.planId,
        evidence: '保留同一退款义务重新提交独立审核',
      });
      await act(finance2, f.order.id, 'APPROVE_RETRY', { childId: third.retryId });
      const view = await service.get(finance1.cookie, owner.orgId, f.order.id),
        command = {
          commandId: randomUUID(),
          expectedVersion: view.order.version,
          action: 'CLAIM_RETRY',
          childId: third.retryId,
        };
      const [claimed, replay] = await Promise.all([
        service.orderCommand(finance1.cookie, owner.orgId, f.order.id, command),
        service.orderCommand(finance1.cookie, owner.orgId, f.order.id, command),
      ]);
      expect(replay.refundId).toBe(claimed.refundId);
      dto = await trade.get(finance2.cookie, f.trade);
      await trade.review(finance2.cookie, f.trade, 'REFUND', claimed.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
        decision: 'APPROVE',
        reason: '核对确定失败前驱链后批准',
      });
      vi.mocked(payments.refund).mockImplementationOnce((i) => refundResult(i, 'SUCCESS'));
      dto = await trade.get(finance1.cookie, f.trade);
      await trade.dispatchRefund(finance1.cookie, f.trade, claimed.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
      });
      expect(
        (
          await api.pool.query(
            'SELECT to_jsonb(r) AS row FROM sponsor_return_items r WHERE refund_plan_id=$1 ORDER BY id',
            [f.planId],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await api.pool.query(
            'SELECT trade_refund_id,status FROM sponsor_refund_plans WHERE id=$1',
            [f.planId],
          )
        ).rows[0],
      ).toMatchObject({ trade_refund_id: f.refundId, status: 'CLAIMED' });
      expect(
        (
          await api.pool.query('SELECT * FROM r6_trade_refund_bindings WHERE source_id=$1', [
            f.order.id,
          ])
        ).rows,
      ).toHaveLength(3);
      await act(finance1, f.order.id, 'CLOSE_ORDER');
      const c = await api.pool.connect();
      try {
        expect(await readSponsorClosureFunds(c, f.order.id, f.trade)).toEqual({
          dischargedFen: 0,
          unresolved: false,
        });
      } finally {
        c.release();
      }
      const unknown = await refundWithReturn('PROCESSING');
      await expect(
        act(finance1, unknown.order.id, 'PROPOSE_RETRY', {
          childId: unknown.planId,
          evidence: '未知结果绝不能被当作失败',
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_RETRY_BLOCKED' });
    });
    test('restore quarantine stops retry writes and an unused approved source retry can be rejected after late success', async () => {
      const f = await refundWithReturn(),
        retry = await act(finance1, f.order.id, 'PROPOSE_RETRY', {
          childId: f.planId,
          evidence: '原退款关闭后提交可审核恢复',
        }),
        audit = randomUUID();
      await api.pool.query(
        "INSERT INTO audit_logs(id,actor_id,org_id,action,resource_type,resource_id) VALUES($1,$2,$3,'RESTORE_QUARANTINE','restore',$4)",
        [audit, owner.id, owner.orgId, randomUUID()],
      );
      try {
        for (const [actor, action, childId] of [
          [finance1, 'PROPOSE_RETRY', f.planId],
          [finance2, 'APPROVE_RETRY', retry.retryId],
          [finance1, 'CLAIM_RETRY', retry.retryId],
        ] as const)
          await expect(
            act(actor, f.order.id, action, { childId, evidence: '隔离状态不能重启资金请求' }),
          ).rejects.toMatchObject({ code: 'SPONSOR_RESTORE_QUARANTINED' });
        expect(
          (await service.get(finance1.cookie, owner.orgId, f.order.id)).refundRetries,
        ).toHaveLength(1);
      } finally {
        await api.pool.query('DELETE FROM audit_logs WHERE id=$1', [audit]);
      }
      await act(finance2, f.order.id, 'APPROVE_RETRY', { childId: retry.retryId });
      const old = (await api.pool.query('SELECT * FROM trade_refunds WHERE id=$1', [f.refundId]))
          .rows[0],
        pay = (
          await api.pool.query('SELECT * FROM trade_payment_attempts WHERE id=$1', [f.payment])
        ).rows[0];
      vi.mocked(payments.queryRefund).mockResolvedValueOnce(
        await refundResult(
          {
            outTradeNo: pay.out_trade_no,
            outRefundNo: old.out_refund_no,
            totalFen: pay.total_fen,
            refundFen: old.amount_fen,
          },
          'SUCCESS',
        ),
      );
      await trade.queryRefund(finance1.cookie, f.trade, f.refundId);
      await expect(
        act(finance1, f.order.id, 'CLAIM_RETRY', { childId: retry.retryId }),
      ).rejects.toMatchObject({ code: 'SPONSOR_RETRY_BLOCKED' });
      await act(finance2, f.order.id, 'REJECT_RETRY', { childId: retry.retryId });
      expect(
        (
          await api.pool.query(
            'SELECT status,reviewed_by FROM sponsor_refund_retries WHERE id=$1',
            [retry.retryId],
          )
        ).rows[0],
      ).toMatchObject({ status: 'REJECTED', reviewed_by: finance2.id });
      await act(finance1, f.order.id, 'CLOSE_ORDER');
    });
    test('late original success blocks approved replacement dispatch and permits explicit unused-refund revocation', async () => {
      const f = await refundWithReturn(),
        retry = await act(finance1, f.order.id, 'PROPOSE_RETRY', {
          childId: f.planId,
          evidence: '渠道先确认关闭的退款恢复',
        });
      await act(finance2, f.order.id, 'APPROVE_RETRY', { childId: retry.retryId });
      const replacement = await act(finance1, f.order.id, 'CLAIM_RETRY', {
        childId: retry.retryId,
      });
      let dto = await trade.get(finance2.cookie, f.trade);
      await trade.review(finance2.cookie, f.trade, 'REFUND', replacement.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
        decision: 'APPROVE',
        reason: '原失败状态下独立复核',
      });
      const old = (await api.pool.query('SELECT * FROM trade_refunds WHERE id=$1', [f.refundId]))
          .rows[0],
        pay = (
          await api.pool.query('SELECT * FROM trade_payment_attempts WHERE id=$1', [f.payment])
        ).rows[0];
      vi.mocked(payments.queryRefund).mockResolvedValueOnce(
        await refundResult(
          {
            outTradeNo: pay.out_trade_no,
            outRefundNo: old.out_refund_no,
            totalFen: pay.total_fen,
            refundFen: old.amount_fen,
          },
          'SUCCESS',
        ),
      );
      await trade.queryRefund(finance1.cookie, f.trade, f.refundId);
      const raw = (await api.pool.query('SELECT version FROM trade_orders WHERE id=$1', [f.trade]))
          .rows[0],
        before = vi.mocked(payments.refund).mock.calls.length;
      await expect(
        trade.dispatchRefund(finance1.cookie, f.trade, replacement.refundId, {
          clientRequestId: randomUUID(),
          expectedVersion: raw.version,
        }),
      ).rejects.toBeDefined();
      expect(vi.mocked(payments.refund).mock.calls.length).toBe(before);
      dto = await trade.get(finance2.cookie, f.trade);
      expect(dto.balanceConflict).toBe(true);
      await trade.review(finance2.cookie, f.trade, 'REFUND', replacement.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
        decision: 'REJECT',
        reason: '旧退款迟到成功，显式撤回未发送后继',
      });
      expect(
        (
          await api.pool.query(
            'SELECT status,fence,provider_refund_id FROM trade_refunds WHERE id=$1',
            [replacement.refundId],
          )
        ).rows[0],
      ).toMatchObject({ status: 'REJECTED', fence: null, provider_refund_id: null });
      expect((await trade.get(finance2.cookie, f.trade)).balanceConflict).toBe(false);
      expect(vi.mocked(payments.refund).mock.calls.length).toBe(before);
      await act(finance1, f.order.id, 'CLOSE_ORDER');
      const c = await api.pool.connect();
      try {
        expect(await readSponsorClosureFunds(c, f.order.id, f.trade)).toEqual({
          dischargedFen: 0,
          unresolved: false,
        });
      } finally {
        c.release();
      }
    });
    test('signed contracts can close before charging while keeping both signatures immutable', async () => {
      await expect(
        contract(10003, async (signed) => {
          await expect(
            service.contractCommand(payer.cookie, owner.orgId, signed.id, {
              commandId: randomUUID(),
              expectedVersion: signed.version,
              action: 'CLOSE_UNSTARTED',
            }),
          ).rejects.toMatchObject({ status: 403 });
          const closed = await service.contractCommand(finance1.cookie, owner.orgId, signed.id, {
            commandId: randomUUID(),
            expectedVersion: signed.version,
            action: 'CLOSE_UNSTARTED',
          });
          expect(closed).toMatchObject({
            status: 'CLOSED',
            owner_signed_by: signed.owner_signed_by,
            advertiser_signed_at: signed.advertiser_signed_at,
            contractHash: signed.contractHash,
          });
          expect(
            (
              await api.pool.query('SELECT id FROM sponsor_orders WHERE contract_id=$1', [
                signed.id,
              ])
            ).rows,
          ).toHaveLength(0);
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_VERSION_CONFLICT' });
      const f = await contract();
      await expect(
        service.contractCommand(finance1.cookie, owner.orgId, f.contract.id, {
          commandId: randomUUID(),
          expectedVersion: 5,
          action: 'CLOSE_UNSTARTED',
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_ORDER_EXISTS' });
    });
    test('never-paid closure proves an empty canonical ledger and rejects unresolved checkout attempts', async () => {
      const f = await contract();
      await act(finance1, f.order.id, 'CLOSE_ORDER');
      const client = await api.pool.connect();
      try {
        expect(await readSponsorClosureFunds(client, f.order.id, f.order.tradeOrderId)).toEqual({
          dischargedFen: 0,
          unresolved: false,
        });
        expect((await readSponsorTradeSource(client, f.order.id)).payable).toBe(false);
      } finally {
        client.release();
      }
      for (const status of ['UNKNOWN', 'NOTPAY', 'DISPATCHING', 'CLOSED']) {
        const pending = await contract(),
          attempt = randomUUID();
        await api.pool.query(
          "INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,profit_sharing) VALUES($1,$2,$3,'NATIVE',$4,10003,$5,clock_timestamp()+interval '1 hour',true)",
          [attempt, pending.order.tradeOrderId, attempt.replaceAll('-', ''), status, randomUUID()],
        );
        if (status === 'CLOSED') await act(finance1, pending.order.id, 'CLOSE_ORDER');
        else
          await expect(act(finance1, pending.order.id, 'CLOSE_ORDER')).rejects.toMatchObject({
            code: 'SPONSOR_PAYMENT_REQUIRED',
          });
      }
      const obligation = await contract();
      await api.pool.query(
        "INSERT INTO sponsor_deliveries(id,org_id,order_id,evidence,created_by) VALUES($1,$2,$3,'明确合成未履行义务',$4)",
        [randomUUID(), owner.orgId, obligation.order.id, owner.id],
      );
      await expect(act(finance1, obligation.order.id, 'CLOSE_ORDER')).rejects.toMatchObject({
        code: 'SPONSOR_OBLIGATION_OPEN',
      });
    });
    test('zero-fen external shares are no-obligation facts and still require real unfreeze confirmation', async () => {
      const f = await approved(1),
        before = vi.mocked(provider.split).mock.calls.length;
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      expect(vi.mocked(provider.split).mock.calls.length).toBe(before);
      let view = await service.get(owner.cookie, owner.orgId, f.order.id);
      expect(view.items.find((i) => !i.retained)).toMatchObject({
        amount_fen: 0,
        status: 'NOT_REQUIRED',
        provider_detail_id: null,
      });
      expect(view.batches[0]).toMatchObject({
        status: 'SUCCEEDED',
        provider_order_id: null,
        finished: false,
      });
      await expect(act(finance1, f.order.id, 'CLOSE_ORDER')).rejects.toMatchObject({
        code: 'SPONSOR_OBLIGATION_OPEN',
      });
      vi.mocked(provider.finish).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-zero-share-unfreeze',
        state: 'FINISHED',
      }));
      await channel(f.order.id, 'FINISH', f.batchId);
      await act(finance1, f.order.id, 'CLOSE_ORDER');
      const client = await api.pool.connect();
      try {
        expect(await readSponsorClosureFunds(client, f.order.id, f.trade)).toEqual({
          dischargedFen: 1,
          unresolved: false,
        });
      } finally {
        client.release();
      }
    });
    test('replacement settlement batches expose their own items and an explicit current batch', async () => {
      const f = await fulfilled(),
        first = await act(owner, f.order.id, 'PROPOSE_SETTLEMENT');
      await act(finance1, f.order.id, 'REJECT_SETTLEMENT', { childId: first.batchId });
      const second = await act(owner, f.order.id, 'PROPOSE_SETTLEMENT'),
        view = await service.get(owner.cookie, owner.orgId, f.order.id);
      expect(view.currentBatchId).toBe(second.batchId);
      expect(view.items.every((i) => i.batch_id === second.batchId)).toBe(true);
      expect(view.batches).toHaveLength(2);
      for (const batch of view.batches) {
        expect(batch.items).toHaveLength(2);
        expect(batch.items.every((i: { batch_id: string }) => i.batch_id === batch.id)).toBe(true);
      }
      expect(view.batches[1]).toMatchObject({ id: first.batchId, status: 'REJECTED' });
    });
    test('signed snapshots, source identity and tenant access remain immutable', async () => {
      const f = await contract();
      await expect(service.list(stranger.cookie, owner.orgId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.get(receiver.cookie, owner.orgId, f.order.id)).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
      await expect(
        api.pool.query('UPDATE sponsor_contracts SET total_fen=10004 WHERE id=$1', [f.contract.id]),
      ).rejects.toMatchObject({ code: '23514' });
      const c = await api.pool.connect();
      try {
        await c.query('BEGIN');
        const s = await readSponsorTradeSource(c, f.order.id);
        expect(s).toMatchObject({
          termsId: null,
          consentId: f.contract.id,
          totalFen: 10003,
          requiresProfitSharing: true,
        });
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
      const disabled = new SponsorCommerceService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      await expect(
        disabled.createContract(owner.cookie, owner.orgId, {
          commandId: randomUUID(),
          campaignId: campaign,
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_COMMERCE_DISABLED' });
    });
    test('concurrent batch proposals reserve once and dual independent approval is mandatory', async () => {
      const f = await fulfilled(),
        v = await service.get(owner.cookie, owner.orgId, f.order.id);
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          service.orderCommand(owner.cookie, owner.orgId, f.order.id, {
            commandId: randomUUID(),
            expectedVersion: v.order.version,
            action: 'PROPOSE_SETTLEMENT',
          }),
        ),
      );
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const view = await service.get(owner.cookie, owner.orgId, f.order.id),
        batch = view.batches[0]!;
      expect(view.items.map((x) => x.amount_fen).sort((a, b) => a - b)).toEqual([3001, 7002]);
      await expect(channel(f.order.id, 'SEND_SPLIT', batch.id)).rejects.toMatchObject({
        code: 'SPONSOR_STATE_CONFLICT',
      });
      await expect(
        act(owner, f.order.id, 'APPROVE_SETTLEMENT', { childId: batch.id }),
      ).rejects.toMatchObject({ status: 403 });
      await act(finance1, f.order.id, 'APPROVE_SETTLEMENT', { childId: batch.id });
      await expect(
        act(finance1, f.order.id, 'APPROVE_SETTLEMENT', { childId: batch.id }),
      ).rejects.toMatchObject({ status: 403 });
      await act(finance2, f.order.id, 'APPROVE_SETTLEMENT', { childId: batch.id });
    });
    test('unknown split is queried by original number, refund waits for actual return, common refund binds once', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockRejectedValueOnce(new Error('synthetic timeout'));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      let view = await service.get(owner.cookie, owner.orgId, f.order.id);
      expect(view.batches[0]!.status).toBe('UNKNOWN');
      await expect(
        act(payer, f.order.id, 'PROPOSE_REFUND', { amountFen: 10003, reason: '合成部分交付退款' }),
      ).rejects.toMatchObject({ code: 'SPONSOR_SPLIT_UNKNOWN' });
      vi.mocked(provider.querySplit).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-split',
        state: 'FINISHED',
        receivers: i.receivers.map((x) => ({
          merchantId: x.merchantId,
          amountFen: x.amountFen,
          result: 'SUCCESS',
          detailId: 'synthetic-detail',
        })),
      }));
      await channel(f.order.id, 'QUERY_SPLIT', f.batchId);
      const p = await act(payer, f.order.id, 'PROPOSE_REFUND', {
        amountFen: 10003,
        reason: '合成部分交付退款',
      });
      await act(finance1, f.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      await expect(
        act(finance2, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId }),
      ).rejects.toMatchObject({ code: 'SPONSOR_STATE_CONFLICT' });
      view = await service.get(owner.cookie, owner.orgId, f.order.id);
      const item = view.returns.find((x) => x.status === 'PENDING')!;
      expect(item.amount_fen).toBe(3001);
      vi.mocked(provider.returnFunds).mockImplementationOnce(async (i) => ({
        outOrderNo: i.outOrderNo,
        outReturnNo: i.outReturnNo,
        merchantId: i.receiverMerchantId,
        amountFen: i.amountFen,
        returnId: 'synthetic-return',
        state: 'SUCCESS',
      }));
      options.enabled = false;
      try {
        await channel(f.order.id, 'SEND_RETURN', item.id);
      } finally {
        options.enabled = true;
      }
      await expect(
        act(finance2, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId }),
      ).rejects.toMatchObject({ code: 'SPONSOR_UNFREEZE_REQUIRED' });
      vi.mocked(provider.finish).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-refund-unfreeze',
        state: 'FINISHED',
      }));
      await channel(f.order.id, 'REFUND_UNFREEZE', p.refundPlanId);
      const claimed = await act(finance2, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId });
      expect(claimed.status).toBe('PENDING');
      expect(
        (await api.pool.query('SELECT status FROM trade_refunds WHERE id=$1', [claimed.refundId]))
          .rows[0].status,
      ).toBe('PENDING_REVIEW');
      const c = await api.pool.connect();
      try {
        await c.query('BEGIN');
        await assertSponsorRefundDispatch(c, f.order.id, p.refundPlanId, 10003);
        await expect(
          assertSponsorRefundDispatch(c, f.order.id, p.refundPlanId, 10004),
        ).rejects.toMatchObject({ code: 'SPONSOR_REFUND_ALLOCATION_REQUIRED' });
        await expect(
          claimSponsorRefundAllocation(c, {
            sourceId: f.order.id,
            allocationId: p.refundPlanId,
            amountFen: 10003,
            refundId: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: 'SPONSOR_REFUND_ALLOCATION_REQUIRED' });
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
      const statement = await service.statements(receiver.cookie, receiver.orgId);
      expect(
        statement.items.find((x) => x.id === view.items.find((y) => !y.retained)!.id),
      ).toMatchObject({ amount_fen: 3001, returned_fen: 3001 });
      expect(statement.items[0]).not.toHaveProperty('payer_user_id');
    });
    test('return failure creates a recovery obligation and never fabricates refund success', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-split2',
        state: 'FINISHED',
        receivers: i.receivers.map((x) => ({
          merchantId: x.merchantId,
          amountFen: x.amountFen,
          result: 'SUCCESS',
          detailId: 'synthetic-detail2',
        })),
      }));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      const p = await act(payer, f.order.id, 'PROPOSE_REFUND', {
        amountFen: 500,
        reason: '合成退费与追偿',
      });
      await act(finance1, f.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      const view = await service.get(owner.cookie, owner.orgId, f.order.id),
        item = view.returns.find((x) => x.status === 'PENDING')!;
      vi.mocked(provider.returnFunds).mockImplementationOnce(async (i) => ({
        outOrderNo: i.outOrderNo,
        outReturnNo: i.outReturnNo,
        merchantId: i.receiverMerchantId,
        amountFen: i.amountFen,
        returnId: 'synthetic-failed-return',
        state: 'FAILED',
      }));
      await channel(f.order.id, 'SEND_RETURN', item.id);
      const after = await service.get(owner.cookie, owner.orgId, f.order.id);
      expect(after.refunds[0]!.status).toBe('RECOVERY_REQUIRED');
      expect(after.recovery[0]!.status).toBe('OPEN');
      expect(after.refunds[0]!.trade_refund_id).toBeNull();
      await expect(
        act(finance2, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId }),
      ).rejects.toMatchObject({ code: 'SPONSOR_STATE_CONFLICT' });
    });
    test('closure discharges only final split funds, full refunds and no unknown observations', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'closure-split',
        state: 'FINISHED',
        receivers: i.receivers.map((x) => ({
          merchantId: x.merchantId,
          amountFen: x.amountFen,
          result: 'SUCCESS',
          detailId: 'closure-detail',
        })),
      }));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      vi.mocked(provider.finish).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'closure-finish',
        state: 'FINISHED',
      }));
      await channel(f.order.id, 'FINISH', f.batchId);
      await act(finance1, f.order.id, 'CLOSE_ORDER');
      const read = async (source: string, trade: string) => {
        const c = await api.pool.connect();
        try {
          await c.query('BEGIN');
          const result = await readSponsorClosureFunds(c, source, trade);
          await c.query('ROLLBACK');
          return result;
        } finally {
          c.release();
        }
      };
      expect(await read(f.order.id, f.trade)).toEqual({ dischargedFen: 10003, unresolved: false });
      const full = await paid(),
        p = await act(payer, full.order.id, 'PROPOSE_REFUND', {
          amountFen: 10003,
          reason: '合成全额退款结清',
        });
      await act(finance1, full.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      const refund = await act(finance2, full.order.id, 'CLAIM_REFUND', {
        childId: p.refundPlanId,
      });
      await api.pool.query(
        "UPDATE trade_refunds SET status='SUCCEEDED',reviewed_by=$2,provider_refund_id=$3,success_at=clock_timestamp() WHERE id=$1",
        [refund.refundId, finance1.id, 'SYNTHETIC_FULL_' + refund.refundId],
      );
      await act(finance1, full.order.id, 'CLOSE_ORDER');
      expect(await read(full.order.id, full.trade)).toEqual({
        dischargedFen: 0,
        unresolved: false,
      });
      const unknown = await approved();
      vi.mocked(provider.split).mockRejectedValueOnce(new Error('synthetic unknown'));
      await channel(unknown.order.id, 'SEND_SPLIT', unknown.batchId);
      expect(await read(unknown.order.id, unknown.trade)).toEqual({
        dischargedFen: 0,
        unresolved: true,
      });
    });
    test('eleven external receivers cannot create a contract that the channel cannot send', async () => {
      await expect(
        service.createContract(owner.cookie, owner.orgId, {
          commandId: randomUUID(),
          campaignId: campaign,
          payerUserId: payer.id,
          title: '不允许的十一外部商户合同',
          totalFen: 10003,
          allowedFeeFen: 0,
          terms: '合成不可发送分配',
          startsAt,
          endsAt,
          shares: Array.from({ length: 11 }, (_, n) => ({
            beneficiaryOrgId: randomUUID(),
            basisPoints: n === 10 ? 1000 : 900,
          })),
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_CHANNEL_LIMIT' });
    });
    test('partial final split can unfreeze an approved refund before the actual refund is sent', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-partial',
        state: 'FINISHED',
        receivers: i.receivers.map((x) => ({
          merchantId: x.merchantId,
          amountFen: x.amountFen,
          result: 'CLOSED',
          detailId: null,
        })),
      }));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      const p = await act(payer, f.order.id, 'PROPOSE_REFUND', {
        amountFen: 10003,
        reason: '合成部分分账失败后全退',
      });
      await act(finance1, f.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      await expect(
        act(finance2, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId }),
      ).rejects.toMatchObject({ code: 'SPONSOR_UNFREEZE_REQUIRED' });
      vi.mocked(provider.finish).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-partial-unfreeze',
        state: 'FINISHED',
      }));
      options.enabled = false;
      try {
        await channel(f.order.id, 'REFUND_UNFREEZE', p.refundPlanId);
      } finally {
        options.enabled = true;
      }
      const claimed = await act(finance2, f.order.id, 'CLAIM_REFUND', { childId: p.refundPlanId });
      expect(claimed.status).toBe('PENDING');
      const view = await service.get(owner.cookie, owner.orgId, f.order.id);
      expect(view.batches[0]).toMatchObject({ status: 'PARTIAL', finished: true });
      await api.pool.query(
        "UPDATE trade_refunds SET status='SUCCEEDED',reviewed_by=$2,provider_refund_id=$3,success_at=clock_timestamp() WHERE id=$1",
        [claimed.refundId, finance1.id, 'SYNTHETIC_PARTIAL_FULL_' + claimed.refundId],
      );
      await act(finance1, f.order.id, 'CLOSE_ORDER');
      const c = await api.pool.connect();
      try {
        await c.query('BEGIN');
        expect(await readSponsorClosureFunds(c, f.order.id, f.trade)).toEqual({
          dischargedFen: 0,
          unresolved: false,
        });
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
    });
    test('advance cannot rely on approval notes and needs a pinned order-specific server reservation', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'synthetic-advance-split',
        state: 'FINISHED',
        receivers: i.receivers.map((x) => ({
          merchantId: x.merchantId,
          amountFen: x.amountFen,
          result: 'SUCCESS',
          detailId: 'synthetic-advance-detail',
        })),
      }));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      const p = await act(payer, f.order.id, 'PROPOSE_REFUND', {
        amountFen: 500,
        reason: '合成回退失败自有资金退款',
      });
      await act(finance1, f.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      const initial = await service.get(owner.cookie, owner.orgId, f.order.id),
        item = initial.returns.find((x) => x.status === 'PENDING')!;
      vi.mocked(provider.returnFunds).mockImplementationOnce(async (i) => ({
        outOrderNo: i.outOrderNo,
        outReturnNo: i.outReturnNo,
        merchantId: i.receiverMerchantId,
        amountFen: i.amountFen,
        returnId: 'synthetic-advance-failure',
        state: 'FAILED',
      }));
      await channel(f.order.id, 'SEND_RETURN', item.id);
      await expect(
        act(finance1, f.order.id, 'ADVANCE_PROPOSE', {
          childId: p.refundPlanId,
          evidence: '单纯口头审批不能代表可用资金',
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_ADVANCE_DISABLED' });
      const merchant = options.merchants![owner.orgId]!;
      merchant.ownFundsRefundSupported = true;
      await expect(
        act(finance1, f.order.id, 'ADVANCE_PROPOSE', {
          childId: p.refundPlanId,
          evidence: '只有渠道开关也不能视为锁定资金',
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_ADVANCE_DISABLED' });
      let wrong = true;
      options.reserveAdvanceCoverage = async (_c, binding) => ({
        ...binding,
        tradeOrderId: wrong ? randomUUID() : binding.tradeOrderId,
        reservationId: randomUUID(),
        proofHash: 'b'.repeat(64),
        channelSupportsOwnFundsRefund: true,
        reservedUntilRefundFinal: true,
      });
      try {
        await act(finance1, f.order.id, 'ADVANCE_PROPOSE', {
          childId: p.refundPlanId,
          evidence: '合成原订单自有资金锁定申请',
        });
        await expect(
          act(finance1, f.order.id, 'ADVANCE_APPROVE', { childId: p.refundPlanId }),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          act(finance2, f.order.id, 'ADVANCE_APPROVE', { childId: p.refundPlanId }),
        ).rejects.toMatchObject({ code: 'SPONSOR_COVERAGE_UNVERIFIED' });
        wrong = false;
        await act(finance2, f.order.id, 'ADVANCE_APPROVE', { childId: p.refundPlanId });
        const approvedView = await service.get(owner.cookie, owner.orgId, f.order.id);
        expect(approvedView.refunds[0]).toMatchObject({
          status: 'RECOVERY_REQUIRED',
          funding_mode: 'PLATFORM_ADVANCE',
        });
        expect(approvedView.recovery[0]!.status).toBe('OPEN');
        await expect(
          api.pool.query(
            "UPDATE sponsor_refund_plans SET advance_coverage=jsonb_set(advance_coverage,'{amountFen}','499') WHERE id=$1",
            [p.refundPlanId],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        vi.mocked(provider.finish).mockImplementationOnce(async (i) => ({
          transactionId: i.transactionId,
          outOrderNo: i.outOrderNo,
          orderId: 'synthetic-advance-unfreeze',
          state: 'FINISHED',
        }));
        await channel(f.order.id, 'REFUND_UNFREEZE', p.refundPlanId);
        const claimed = await act(finance1, f.order.id, 'CLAIM_REFUND', {
          childId: p.refundPlanId,
        });
        expect(claimed.status).toBe('PENDING');
        const final = await service.get(owner.cookie, owner.orgId, f.order.id);
        expect(final.returns.find((x) => x.id === item.id)!.status).toBe('FAILED');
        expect(final.recovery[0]!.status).toBe('OPEN');
      } finally {
        merchant.ownFundsRefundSupported = false;
        delete options.reserveAdvanceCoverage;
      }
    });
    test('trusted in-flight result remains recordable if the organization is disabled after dispatch', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => {
        await api.pool.query("UPDATE organizations SET status='DISABLED' WHERE id=$1", [
          owner.orgId,
        ]);
        return {
          transactionId: i.transactionId,
          outOrderNo: i.outOrderNo,
          orderId: 'synthetic-disabled-org',
          state: 'FINISHED',
          receivers: i.receivers.map((x) => ({
            merchantId: x.merchantId,
            amountFen: x.amountFen,
            result: 'SUCCESS',
            detailId: 'synthetic-disabled-detail',
          })),
        };
      });
      try {
        await channel(f.order.id, 'SEND_SPLIT', f.batchId);
        expect(
          (
            await api.pool.query('SELECT status FROM sponsor_settlement_batches WHERE id=$1', [
              f.batchId,
            ])
          ).rows[0].status,
        ).toBe('SUCCEEDED');
      } finally {
        await api.pool.query("UPDATE organizations SET status='ACTIVE' WHERE id=$1", [owner.orgId]);
      }
    });
    test('ordinary payer without an organization role discovers only assigned contracts and can sign and pay', async () => {
      const f = await contract();
      const inbox = await service.inbox(payer.cookie);
      expect(inbox.organizations).toContainEqual({
        id: owner.orgId,
        name: expect.any(String),
        role: 'ADVERTISER',
      });
      expect(inbox.contracts.find((x) => x.id === f.contract.id)).toMatchObject({
        orgId: owner.orgId,
        orderId: f.order.id,
        totalFen: 10003,
      });
      expect((await service.inbox(stranger.cookie)).contracts).toEqual([]);
      expect((await service.inbox(receiver.cookie)).contracts).toEqual([]);
      expect((await service.list(payer.cookie, owner.orgId)).canManage).toBe(false);
      expect((await service.get(payer.cookie, owner.orgId, f.order.id)).tradeOrderId).toBe(
        f.order.tradeOrderId,
      );
    });
    test('real common trade capture, allocation binding, independent review and dispatch recheck are atomic', async () => {
      const f = await approved();
      vi.mocked(provider.split).mockImplementationOnce(async (i) => ({
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'real-ledger-synthetic-split',
        state: 'FINISHED',
        receivers: i.receivers.map((x) => ({
          merchantId: x.merchantId,
          amountFen: x.amountFen,
          result: 'SUCCESS',
          detailId: 'real-ledger-synthetic-detail',
        })),
      }));
      await channel(f.order.id, 'SEND_SPLIT', f.batchId);
      const p = await act(payer, f.order.id, 'PROPOSE_REFUND', {
        amountFen: 10003,
        reason: '真实共同账本合成渠道全额退款',
      });
      await act(finance1, f.order.id, 'APPROVE_REFUND', { childId: p.refundPlanId });
      let view = await service.get(owner.cookie, owner.orgId, f.order.id);
      const external = view.returns.find((x) => x.status === 'PENDING')!;
      vi.mocked(provider.returnFunds).mockRejectedValueOnce(new Error('synthetic return timeout'));
      await channel(f.order.id, 'SEND_RETURN', external.id);
      const recapture = () =>
        trade.transaction(async (c: PoolClient) => {
          const a = await trade.lockActor(c, finance1.cookie);
          return trade.captureSourceRefund(c, a, {
            kind: 'SPONSOR_ORDER',
            sourceId: f.order.id,
            allocationId: p.refundPlanId,
            amountFen: 10003,
            reason: '真实共同账本合成渠道全额退款',
          });
        });
      await expect(recapture()).rejects.toMatchObject({
        code: 'SPONSOR_REFUND_ALLOCATION_REQUIRED',
      });
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::integer AS n FROM r6_trade_refund_bindings WHERE allocation_id=$1',
            [p.refundPlanId],
          )
        ).rows[0].n,
      ).toBe(0);
      vi.mocked(provider.queryReturn).mockImplementationOnce(async (i) => ({
        outOrderNo: i.outOrderNo,
        outReturnNo: i.outReturnNo,
        merchantId: i.receiverMerchantId,
        amountFen: i.amountFen,
        returnId: 'real-ledger-synthetic-return',
        state: 'SUCCESS',
      }));
      await channel(f.order.id, 'QUERY_RETURN', external.id);
      await expect(recapture()).rejects.toMatchObject({ code: 'SPONSOR_UNFREEZE_REQUIRED' });
      let channelUnfrozen = false;
      vi.mocked(provider.finish).mockImplementationOnce(async (i) => {
        channelUnfrozen = true;
        return {
          transactionId: i.transactionId,
          outOrderNo: i.outOrderNo,
          orderId: 'real-ledger-synthetic-finish',
          state: 'FINISHED',
        };
      });
      vi.mocked(payments.refund).mockImplementation(async (i) => {
        if (!channelUnfrozen)
          throw Error('synthetic provider requires unfreeze before full refund');
        const pay = (
          await api.pool.query('SELECT * FROM trade_payment_attempts WHERE out_trade_no=$1', [
            i.outTradeNo,
          ])
        ).rows[0];
        return {
          outTradeNo: i.outTradeNo,
          outRefundNo: i.outRefundNo,
          transactionId: pay.provider_transaction_id,
          refundId: 'SYNTHETIC_REAL_REFUND_' + i.outRefundNo,
          state: 'SUCCESS',
          totalFen: i.totalFen,
          refundFen: i.refundFen,
          currency: 'CNY',
          successTime: new Date().toISOString(),
          createdTime: new Date().toISOString(),
        };
      });
      await channel(f.order.id, 'REFUND_UNFREEZE', p.refundPlanId);
      view = await service.get(finance1.cookie, owner.orgId, f.order.id);
      const command = {
        commandId: randomUUID(),
        expectedVersion: view.order.version,
        action: 'CLAIM_REFUND',
        childId: p.refundPlanId,
      };
      const [first, replay] = await Promise.all([
        service.orderCommand(finance1.cookie, owner.orgId, f.order.id, command),
        service.orderCommand(finance1.cookie, owner.orgId, f.order.id, command),
      ]);
      expect(replay.refundId).toBe(first.refundId);
      const bindings = (
        await api.pool.query('SELECT * FROM r6_trade_refund_bindings WHERE allocation_id=$1', [
          p.refundPlanId,
        ])
      ).rows;
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toMatchObject({
        kind: 'SPONSOR_ORDER',
        source_id: f.order.id,
        order_id: f.trade,
        refund_id: first.refundId,
      });
      expect(
        (
          await api.pool.query(
            'SELECT count(*)::integer AS n FROM trade_refunds WHERE order_id=$1',
            [f.trade],
          )
        ).rows[0].n,
      ).toBe(1);
      const [again1, again2] = await Promise.all([recapture(), recapture()]);
      expect(again1.refundId).toBe(first.refundId);
      expect(again2.refundId).toBe(first.refundId);
      let dto = await trade.get(finance2.cookie, f.trade);
      await trade.review(finance2.cookie, f.trade, 'REFUND', first.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
        decision: 'APPROVE',
        reason: '独立核对原分配及渠道解冻',
      });
      // Inject an unresolved retained-return observation to verify dispatch rechecks current DB facts, not the earlier approval receipt.
      const retained = view.returns.find((x) => x.status === 'NOT_REQUIRED')!;
      await api.pool.query("UPDATE sponsor_return_items SET status='UNKNOWN' WHERE id=$1", [
        retained.id,
      ]);
      dto = await trade.get(finance1.cookie, f.trade);
      const before = vi.mocked(payments.refund).mock.calls.length;
      await expect(
        trade.dispatchRefund(finance1.cookie, f.trade, first.refundId, {
          clientRequestId: randomUUID(),
          expectedVersion: dto.version,
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_RETURN_PENDING' });
      expect(vi.mocked(payments.refund).mock.calls.length).toBe(before);
      await api.pool.query("UPDATE sponsor_return_items SET status='NOT_REQUIRED' WHERE id=$1", [
        retained.id,
      ]);
      dto = await trade.get(finance1.cookie, f.trade);
      await trade.dispatchRefund(finance1.cookie, f.trade, first.refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: dto.version,
      });
      expect(vi.mocked(payments.refund).mock.calls.length).toBe(before + 1);
      expect((await recapture()).status).toBe('SUCCEEDED');
      expect(
        (await api.pool.query('SELECT status FROM trade_refunds WHERE id=$1', [first.refundId]))
          .rows[0].status,
      ).toBe('SUCCEEDED');
    });
  },
);

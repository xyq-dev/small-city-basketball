import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../src/errors.js';
import type { Actor } from '../src/service.js';
import { TradeService } from '../src/trade-service.js';
import type { TradePayments, TradeRuntime } from '../src/trade-provider.js';
import type { AdditionalTradeSourceAdapter } from '../src/trade-source-adapter.js';
import { readSponsorTradeSource, sponsorSourceReference } from '../src/sponsor-commerce-source.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { createHarness, closeHarness, type Harness } from './p04-support.js';
import { login, ORIGIN } from './support.js';

class SourceTradeService extends TradeService {
  withActor<T>(cookie: string, work: (c: PoolClient, actor: Actor) => Promise<T>) {
    return this.transaction(async (c) => work(c, await this.lockActor(c, cookie)));
  }
}

/** Real migrated PG, authenticated sessions, frozen sponsor sources and canonical bindings.
 * Only provider-confirmed payment/refund outcomes and domain eligibility hooks are synthetic.
 * The complete sponsor retry ancestry is independently exercised by R6ADS integration tests. */
describe('R6 common-ledger sponsor refund revocation', { concurrent: false }, () => {
  let h: Harness, service: SourceTradeService, runtime: TradeRuntime;
  let dispatchError: ApiError | null, revocationError: ApiError | null, revokeSession: boolean;
  const allocations = new Map<string, { sourceId: string; amountFen: number }>();
  const payments: TradePayments = {
    enabled: true,
    native: vi.fn(),
    queryOrder: vi.fn(),
    refund: vi.fn(),
    queryRefund: vi.fn(),
    verifyNotification: vi.fn(),
    downloadBill: vi.fn(),
  };
  const assertAllocation = async (
    c: PoolClient,
    sourceId: string,
    allocationId: string,
    amountFen: number,
  ) => {
    expect(allocations.get(allocationId)).toEqual({ sourceId, amountFen });
    expect((await c.query('SELECT id FROM sponsor_orders WHERE id=$1', [sourceId])).rowCount).toBe(
      1,
    );
  };
  const dispatch = vi.fn(
    async (c: PoolClient, source: string, allocation: string, amount: number) => {
      await assertAllocation(c, source, allocation, amount);
      if (dispatchError) throw dispatchError;
    },
  );
  const revocation = vi.fn(
    async (c: PoolClient, source: string, allocation: string, amount: number) => {
      await assertAllocation(c, source, allocation, amount);
      if (revocationError) throw revocationError;
      // Deliberately invalidate the real locked session inside the transaction to prove
      // the final freshness check rolls back the review, audit and command receipt together.
      if (revokeSession)
        await c.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [
          h.leader.id,
        ]);
    },
  );
  const adapter: AdditionalTradeSourceAdapter = {
    reference: sponsorSourceReference,
    read: readSponsorTradeSource,
    settlementMode: 'MODULE',
    requiresProfitSharing: true,
    assertRefundAllocation: assertAllocation,
    assertRefundDispatch: dispatch,
    assertRefundRevocation: revocation,
  };
  const command = () => randomUUID();
  const reason = '独立核对原退款成功及当前后继未发送';

  beforeAll(async () => {
    h = await createHarness(1);
    await maintainPlatformOperator(h.api.pool, {
      email: h.leader.email,
      status: 'ACTIVE',
      reason: '合成广告退款独立审核员',
    });
    runtime = {
      encryptionKey: Buffer.alloc(32, 37),
      merchants: {
        [h.owner.orgId]: {
          key: 'r6-revocation-' + h.owner.orgId,
          merchantId: '1900000381',
          appId: 'wx1234567890abcdef',
          displayName: '合成广告收款机构',
          payments,
          receivers: {},
        },
      },
    };
    service = makeService(adapter);
  }, 90000);
  beforeEach(() => {
    dispatchError = revocationError = null;
    revokeSession = false;
    vi.clearAllMocks();
  });
  afterAll(async () => {
    if (h) await closeHarness(h);
  });
  function makeService(sourceAdapter: AdditionalTradeSourceAdapter) {
    return new SourceTradeService(
      h.api.pool,
      { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
      runtime,
      { SPONSOR_ORDER: sourceAdapter },
    );
  }
  function noTransport() {
    for (const transport of Object.values(payments))
      if (typeof transport === 'function') expect(transport).not.toHaveBeenCalled();
  }
  async function paidSource() {
    const sourceId = command(),
      contractId = command(),
      campaignId = command(),
      paymentId = command();
    const merchant = runtime.merchants![h.owner.orgId]!;
    const orderId = await service.withActor(h.otherOwner.cookie, async (c, actor) => {
      // A narrowly scoped signed commercial fixture, preserving all real FK/check/history guards.
      // Contract publication/signing UI is covered in the domain suite, not mocked in this ledger test.
      await c.query(
        `INSERT INTO sponsorship_campaigns(id,org_id,region_catalog_version,region_id,brand,title,body,starts_at,ends_at,status,created_by,reviewed_by,reviewed_at,review_reason)
         SELECT $1,$2,catalog_version,region_id,'合成品牌','合成退款广告','仅隔离数据库退款验收',clock_timestamp()+interval '1 day',clock_timestamp()+interval '10 days','APPROVED',$3,$4,clock_timestamp(),'合成独立广告审核'
         FROM region_catalog_nodes WHERE level='COUNTY' ORDER BY region_id LIMIT 1`,
        [campaignId, h.owner.orgId, h.owner.id, h.leader.id],
      );
      await c.query(
        `INSERT INTO sponsor_contracts(id,org_id,campaign_id,payer_user_id,beneficiary_user_id,title,total_fen,allowed_fee_fen,terms,starts_at,ends_at,merchant_key,merchant_id,merchant_app_id,shares,status,created_by,reviewed_by,reviewed_at,owner_signed_by,advertiser_signed_at)
         VALUES($1,$2,$3,$4,$5,'合成广告退款合同',1000,0,'合成退款条款及收款主体',clock_timestamp()+interval '1 day',clock_timestamp()+interval '10 days',$6,$7,$8,$9::jsonb,'SIGNED',$5,$10,clock_timestamp(),$5,clock_timestamp())`,
        [
          contractId,
          h.owner.orgId,
          campaignId,
          h.otherOwner.id,
          h.owner.id,
          merchant.key,
          merchant.merchantId,
          merchant.appId,
          JSON.stringify([{ beneficiaryOrgId: h.owner.orgId, bps: 10000, retained: true }]),
          h.leader.id,
        ],
      );
      await c.query(
        `INSERT INTO sponsor_orders(id,org_id,contract_id,payer_user_id,beneficiary_user_id,title,total_fen,merchant_key,merchant_id,merchant_app_id,terms,snapshot,created_by)
         VALUES($1,$2,$3,$4,$5,'合成广告退款订单',1000,$6,$7,$8,'合成退款条款及收款主体',$9::jsonb,$5)`,
        [
          sourceId,
          h.owner.orgId,
          contractId,
          h.otherOwner.id,
          h.owner.id,
          merchant.key,
          merchant.merchantId,
          merchant.appId,
          JSON.stringify({
            contractId,
            endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
            fixture: 'r6-common-refund-revocation',
          }),
        ],
      );
      const id = await service.captureSourceCharge(c, actor, {
        kind: 'SPONSOR_ORDER',
        sourceId,
        acceptedTermsId: contractId,
        chargeConsent: true,
      });
      expect(id).toEqual(expect.any(String));
      // Synthetic provider confirmation; no payment request, callback or external I/O.
      await c.query(
        `INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,provider_transaction_id,paid_at,profit_sharing)
         VALUES($1,$2,$3,'NATIVE','PAID',1000,$4,clock_timestamp()+interval '1 hour',$5,clock_timestamp(),true)`,
        [paymentId, id, paymentId.replaceAll('-', ''), command(), 'synthetic-' + paymentId],
      );
      return id!;
    });
    return { sourceId, contractId, orderId, paymentId };
  }
  type Source = Awaited<ReturnType<typeof paidSource>>;
  async function proposal(source: Source, cookie = h.otherOwner.cookie) {
    const allocationId = command();
    allocations.set(allocationId, { sourceId: source.sourceId, amountFen: 1000 });
    const result = await service.withActor(cookie, (c, actor) =>
      service.captureSourceRefund(c, actor, {
        kind: 'SPONSOR_ORDER',
        sourceId: source.sourceId,
        allocationId,
        amountFen: 1000,
        reason,
      }),
    );
    return { ...source, allocationId, refundId: result.refundId };
  }
  type Refund = Awaited<ReturnType<typeof proposal>>;
  async function reviewInput(orderId: string, decision: 'APPROVE' | 'REJECT') {
    const dto = await service.get(h.leader.cookie, orderId);
    return { clientRequestId: command(), expectedVersion: dto.version, decision, reason };
  }
  async function approved() {
    const r = await proposal(await paidSource());
    await service.review(
      h.leader.cookie,
      r.orderId,
      'REFUND',
      r.refundId,
      await reviewInput(r.orderId, 'APPROVE'),
    );
    return r;
  }
  async function facts(orderId: string) {
    const [orders, refunds, bindings, operations, audits] = await Promise.all([
      h.api.pool.query('SELECT * FROM trade_orders WHERE id=$1', [orderId]),
      h.api.pool.query('SELECT * FROM trade_refunds WHERE order_id=$1 ORDER BY id', [orderId]),
      h.api.pool.query(
        'SELECT * FROM r6_trade_refund_bindings WHERE order_id=$1 ORDER BY refund_id',
        [orderId],
      ),
      h.api.pool.query('SELECT * FROM trade_operations WHERE order_id=$1 ORDER BY command_id', [
        orderId,
      ]),
      h.api.pool.query(
        "SELECT * FROM audit_logs WHERE resource_type='trade_order' AND resource_id=$1 ORDER BY id",
        [orderId],
      ),
    ]);
    return {
      order: orders.rows[0],
      refunds: refunds.rows,
      bindings: bindings.rows,
      operations: operations.rows,
      audits: audits.rows,
    };
  }
  function capability(dto: Awaited<ReturnType<TradeService['get']>>, r: Refund) {
    return dto.refunds.find((refund) => refund.id === r.refundId)!.canRejectApprovedRefund;
  }

  test('PENDING approval rechecks domain dispatch eligibility before any durable mutation or transport', async () => {
    const r = await proposal(await paidSource());
    const input = await reviewInput(r.orderId, 'APPROVE'),
      before = await facts(r.orderId);
    dispatchError = new ApiError(409, 'SPONSOR_RETURN_NOT_READY', '合成回退未完成');
    await expect(
      service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input),
    ).rejects.toMatchObject({ code: 'SPONSOR_RETURN_NOT_READY' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]!.slice(1)).toEqual([r.sourceId, r.allocationId, 1000]);
    expect(await facts(r.orderId)).toEqual(before);
    noTransport();
    dispatchError = null;
    await service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input);
    expect((await facts(r.orderId)).refunds[0]!.status).toBe('APPROVED');
    expect(capability(await service.get(h.leader.cookie, r.orderId), r)).toBe(true);
    noTransport();
  });

  test('late success retains all money facts; safe rejection releases only unsent reservation and replays once', async () => {
    const source = await paidSource(),
      ancestor = await proposal(source);
    await service.review(
      h.leader.cookie,
      source.orderId,
      'REFUND',
      ancestor.refundId,
      await reviewInput(source.orderId, 'APPROVE'),
    );
    await h.api.pool.query("UPDATE trade_refunds SET status='FAILED',fence=$2 WHERE id=$1", [
      ancestor.refundId,
      command(),
    ]);
    const successor = await proposal(source);
    await service.review(
      h.leader.cookie,
      source.orderId,
      'REFUND',
      successor.refundId,
      await reviewInput(source.orderId, 'APPROVE'),
    );
    // Explicit late provider fact on the original number, not a new retry dispatch.
    await h.api.pool.query(
      "UPDATE trade_refunds SET status='SUCCEEDED',provider_refund_id=$2,success_at=clock_timestamp() WHERE id=$1",
      [ancestor.refundId, 'synthetic-late-' + ancestor.refundId],
    );
    const dto = await service.get(h.leader.cookie, source.orderId);
    expect(dto).toMatchObject({
      paidFen: 1000,
      refundedFen: 1000,
      refundReservedFen: 2000,
      refundableFen: 0,
      balanceConflict: true,
      capabilities: { canPay: false, canRequestRefund: false, settlementAvailable: false },
    });
    expect(capability(dto, successor)).toBe(true);
    expect(capability(dto, ancestor)).toBe(false);
    expect(capability(await service.get(h.otherOwner.cookie, source.orderId), successor)).toBe(
      false,
    );
    const before = await facts(source.orderId);
    const input = {
      clientRequestId: command(),
      expectedVersion: dto.version,
      decision: 'REJECT',
      reason,
    };
    await expect(
      service.review(h.leader.cookie, source.orderId, 'REFUND', successor.refundId, {
        ...input,
        expectedVersion: dto.version - 1,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await facts(source.orderId)).toEqual(before);
    const receipt = await service.review(
      h.leader.cookie,
      source.orderId,
      'REFUND',
      successor.refundId,
      input,
    );
    const after = await facts(source.orderId);
    expect(after.order.version).toBe(before.order.version + 1);
    expect(after.bindings).toEqual(before.bindings);
    expect(after.refunds.find((r) => r.id === ancestor.refundId)).toEqual(
      before.refunds.find((r) => r.id === ancestor.refundId),
    );
    expect(after.refunds.find((r) => r.id === successor.refundId)).toMatchObject({
      status: 'REJECTED',
      reviewed_by: h.leader.id,
      review_reason: reason,
      fence: null,
      provider_refund_id: null,
      success_at: null,
    });
    expect(await service.get(h.leader.cookie, source.orderId)).toMatchObject({
      paidFen: 1000,
      refundedFen: 1000,
      refundReservedFen: 1000,
      refundableFen: 0,
      balanceConflict: false,
    });
    expect(
      await service.review(h.leader.cookie, source.orderId, 'REFUND', successor.refundId, input),
    ).toEqual(receipt);
    expect(await facts(source.orderId)).toEqual(after);
    await expect(
      h.api.pool.query('UPDATE r6_trade_refund_bindings SET allocation_id=$2 WHERE refund_id=$1', [
        successor.refundId,
        command(),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      h.api.pool.query('DELETE FROM r6_trade_refund_bindings WHERE refund_id=$1', [
        successor.refundId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    noTransport();
  });

  test('payer, beneficiary and refund proposer cannot act as their own independent reviewer', async () => {
    const r = await approved(),
      before = await facts(r.orderId),
      input = await reviewInput(r.orderId, 'REJECT');
    for (const actor of [h.otherOwner, h.owner]) {
      expect(capability(await service.get(actor.cookie, r.orderId), r)).toBe(false);
      await expect(
        service.review(actor.cookie, r.orderId, 'REFUND', r.refundId, {
          ...input,
          clientRequestId: command(),
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await facts(r.orderId)).toEqual(before);
    const self = await proposal(await paidSource(), h.leader.cookie);
    // Synthetic already-approved intent; proposer is neither payer nor beneficiary.
    await h.api.pool.query(
      "UPDATE trade_refunds SET status='APPROVED',reviewed_by=$2 WHERE id=$1",
      [self.refundId, h.owner.id],
    );
    expect(capability(await service.get(h.leader.cookie, self.orderId), self)).toBe(false);
    const selfBefore = await facts(self.orderId);
    await expect(
      service.review(
        h.leader.cookie,
        self.orderId,
        'REFUND',
        self.refundId,
        await reviewInput(self.orderId, 'REJECT'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await facts(self.orderId)).toEqual(selfBefore);
    noTransport();
  });

  test.each([
    'FENCE',
    'PROVIDER_ID',
    'SUCCESS_AT',
    'UNKNOWN',
    'SENDING',
    'PROCESSING',
    'FAILED',
  ] as const)('%s history is never an eligible unsent APPROVED revocation', async (evidence) => {
    const r = await approved();
    if (evidence === 'FENCE')
      await h.api.pool.query('UPDATE trade_refunds SET fence=$2 WHERE id=$1', [
        r.refundId,
        command(),
      ]);
    else if (evidence === 'PROVIDER_ID')
      await h.api.pool.query('UPDATE trade_refunds SET provider_refund_id=$2 WHERE id=$1', [
        r.refundId,
        'synthetic-' + r.refundId,
      ]);
    else if (evidence === 'SUCCESS_AT')
      await h.api.pool.query('UPDATE trade_refunds SET success_at=clock_timestamp() WHERE id=$1', [
        r.refundId,
      ]);
    else
      await h.api.pool.query('UPDATE trade_refunds SET status=$2,fence=$3 WHERE id=$1', [
        r.refundId,
        evidence,
        command(),
      ]);
    const dto = await service.get(h.leader.cookie, r.orderId),
      before = await facts(r.orderId);
    expect(capability(dto, r)).toBe(false);
    await expect(
      service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, {
        clientRequestId: command(),
        expectedVersion: dto.version,
        decision: 'REJECT',
        reason,
      }),
    ).rejects.toMatchObject({ code: 'TRADE_REVIEW_STATE' });
    expect(await facts(r.orderId)).toEqual(before);
    noTransport();
  });

  test('absent or denied domain revocation proof fails closed without consuming a command', async () => {
    const r = await approved(),
      before = await facts(r.orderId);
    const { assertRefundRevocation: _omitted, ...missing } = adapter;
    const unconfigured = makeService(missing),
      input = await reviewInput(r.orderId, 'REJECT');
    expect(capability(await unconfigured.get(h.leader.cookie, r.orderId), r)).toBe(false);
    await expect(
      unconfigured.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input),
    ).rejects.toMatchObject({ code: 'TRADE_SOURCE_REFUND_REQUIRED' });
    revocationError = new ApiError(409, 'SPONSOR_REFUND_REVOCATION_STATE', '合成祖先尚未成功');
    expect(capability(await service.get(h.leader.cookie, r.orderId), r)).toBe(false);
    await expect(
      service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input),
    ).rejects.toMatchObject({ code: 'SPONSOR_REFUND_REVOCATION_STATE' });
    revocationError = new ApiError(503, 'SPONSOR_RESTORE_QUARANTINED', '合成恢复隔离');
    expect(capability(await service.get(h.leader.cookie, r.orderId), r)).toBe(false);
    await expect(
      service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input),
    ).rejects.toMatchObject({ code: 'SPONSOR_RESTORE_QUARANTINED' });
    expect(await facts(r.orderId)).toEqual(before);
    noTransport();
  });

  test.each(['ABSENT', 'WRONG_SOURCE', 'WRONG_KIND'] as const)(
    'immutable binding %s cannot authorize revocation',
    async (binding) => {
      const source = await paidSource(),
        refundId = command(),
        allocationId = command();
      // An explicitly malformed imported ledger row, never produced by captureSourceRefund.
      // Keep all database constraints active so the common service must reject absent/mismatched proof.
      await h.api.pool.query(
        `INSERT INTO trade_refunds(id,order_id,payment_id,out_refund_no,amount_fen,reason,status,proposed_by,reviewed_by)
      VALUES($1,$2,$3,$4,1000,$5,'APPROVED',$6,$7)`,
        [
          refundId,
          source.orderId,
          source.paymentId,
          'synthetic-' + refundId,
          reason,
          h.otherOwner.id,
          h.leader.id,
        ],
      );
      if (binding !== 'ABSENT')
        await h.api.pool.query(
          `INSERT INTO r6_trade_refund_bindings(kind,source_id,allocation_id,order_id,refund_id) VALUES($1,$2,$3,$4,$5)`,
          [
            binding === 'WRONG_KIND' ? 'TRAINING_ENROLLMENT' : 'SPONSOR_ORDER',
            binding === 'WRONG_SOURCE' ? command() : source.sourceId,
            allocationId,
            source.orderId,
            refundId,
          ],
        );
      const r = { ...source, refundId, allocationId },
        dto = await service.get(h.leader.cookie, source.orderId),
        before = await facts(source.orderId);
      expect(capability(dto, r)).toBe(false);
      await expect(
        service.review(h.leader.cookie, source.orderId, 'REFUND', refundId, {
          clientRequestId: command(),
          expectedVersion: dto.version,
          decision: 'REJECT',
          reason,
        }),
      ).rejects.toMatchObject({ code: 'TRADE_SOURCE_REFUND_REQUIRED' });
      expect(await facts(source.orderId)).toEqual(before);
      expect(revocation).not.toHaveBeenCalled();
      noTransport();
    },
  );

  test('session revoked during source proof rolls back review, version, audit and receipt', async () => {
    const r = await approved(),
      input = await reviewInput(r.orderId, 'REJECT'),
      before = await facts(r.orderId);
    revokeSession = true;
    await expect(
      service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await facts(r.orderId)).toEqual(before);
    revokeSession = false;
    // The synthetic in-transaction revocation also rolled back; the original session is still usable.
    expect(capability(await service.get(h.leader.cookie, r.orderId), r)).toBe(true);
    await service.review(h.leader.cookie, r.orderId, 'REFUND', r.refundId, input);
    expect((await facts(r.orderId)).order.version).toBe(before.order.version + 1);
    noTransport();
  });

  test('a previously revoked real session cannot enter the review transaction', async () => {
    const r = await approved(),
      input = await reviewInput(r.orderId, 'REJECT'),
      before = await facts(r.orderId),
      cookie = h.leader.cookie;
    await h.api.pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [
      h.leader.id,
    ]);
    try {
      await expect(
        service.review(cookie, r.orderId, 'REFUND', r.refundId, input),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(await facts(r.orderId)).toEqual(before);
      noTransport();
    } finally {
      h.leader.cookie = await login(h.api, h.leader);
    }
  });
});

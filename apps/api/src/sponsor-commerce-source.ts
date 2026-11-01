import type { PoolClient } from 'pg';
import { notFound } from './errors.js';
import {
  allocateSponsorRefund,
  sponsorFail,
  validateSponsorAdvanceCoverage,
} from './sponsor-commerce-domain.js';

/** Common trade adapter. Call under x12_calendar_lock, before locking this source. */
export async function sponsorSourceReference(c: PoolClient, id: string) {
  const r = (
    await c.query(
      'SELECT org_id,payer_user_id,beneficiary_user_id FROM sponsor_orders WHERE id=$1',
      [id],
    )
  ).rows[0];
  if (!r) throw notFound();
  return {
    orgId: r.org_id as string,
    payerId: r.payer_user_id as string,
    beneficiaryId: r.beneficiary_user_id as string,
  };
}
export async function readSponsorTradeSource(c: PoolClient, id: string) {
  const r = (
    await c.query(
      `SELECT s.*,u.display_name FROM sponsor_orders s JOIN users u ON u.id=s.beneficiary_user_id WHERE s.id=$1 FOR UPDATE OF s`,
      [id],
    )
  ).rows[0];
  if (!r) throw notFound();
  return {
    orgId: r.org_id as string,
    payerId: r.payer_user_id as string,
    beneficiaryId: r.beneficiary_user_id as string,
    beneficiaryName: r.display_name as string,
    title: r.title as string,
    version: r.version as number,
    totalFen: r.total_fen as number,
    platformFeeFen: 0,
    termsId: null,
    consentId: r.contract_id as string,
    terms: r.terms as string,
    merchantKey: r.merchant_key as string,
    payable: r.status === 'WAITING_PAYMENT',
    fulfilled: r.status === 'ACCEPTED',
    disputed: r.status === 'DISPUTED',
    valid: r.status !== 'CLOSED',
    expiresAt: r.snapshot.endsAt as string,
    requiresProfitSharing: true,
    identity: {
      contractId: r.contract_id,
      snapshot: r.snapshot,
      merchantId: r.merchant_id,
      merchantAppId: r.merchant_app_id,
    },
  };
}
/** Binds one independently approved allocation to one common-ledger refund, in the same transaction.
 * The caller must already hold calendar and common trade-order locks. Deferred FK lets it insert the refund after this guard. */
export async function claimSponsorRefundAllocation(
  c: PoolClient,
  input: {
    sourceId: string;
    allocationId: string;
    amountFen: number;
    refundId: string;
  },
) {
  const r = await assertSponsorRefundAllocation(
    c,
    input.sourceId,
    input.allocationId,
    input.amountFen,
  );
  await c.query(
    "UPDATE sponsor_refund_plans SET status='CLAIMED',trade_refund_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
    [r.id, input.refundId],
  );
}
export async function assertSponsorRefundAllocation(
  c: PoolClient,
  sourceId: string,
  allocationId: string,
  amountFen: number,
  beforeUnfreeze = false,
) {
  const r = (
    await c.query('SELECT * FROM sponsor_refund_plans WHERE id=$1 AND order_id=$2 FOR UPDATE', [
      allocationId,
      sourceId,
    ])
  ).rows[0];
  if (
    !r ||
    !(
      r.status === 'READY_FOR_REFUND' ||
      (r.status === 'RECOVERY_REQUIRED' && r.funding_mode === 'PLATFORM_ADVANCE')
    ) ||
    r.amount_fen !== amountFen ||
    !r.reviewed_by
  )
    sponsorFail('SPONSOR_REFUND_ALLOCATION_REQUIRED', '退款须先完成独立审核及分账回退');
  const covered = await sponsorAdvanceCovered(c, r);
  const pending = (
    await c.query(
      "SELECT 1 FROM sponsor_return_items WHERE refund_plan_id=$1 AND status NOT IN ('NOT_REQUIRED','SUCCEEDED') AND NOT ($2 AND status='FAILED' AND EXISTS(SELECT 1 FROM sponsor_recovery_cases k WHERE k.return_item_id=sponsor_return_items.id)) LIMIT 1",
      [r.id, covered],
    )
  ).rowCount;
  if (pending) sponsorFail('SPONSOR_RETURN_PENDING', '回退尚未完成，不能生成退款');
  if (r.batch_id && !beforeUnfreeze) {
    const batch = (
      await c.query(
        'SELECT finished,finish_status FROM sponsor_settlement_batches WHERE id=$1 AND order_id=$2 FOR UPDATE',
        [r.batch_id, sourceId],
      )
    ).rows[0];
    if (!batch?.finished || batch.finish_status !== 'SUCCEEDED')
      sponsorFail('SPONSOR_UNFREEZE_REQUIRED', '须先按原编号解冻退款所需资金，再进入统一退款');
  }
  return r;
}
export async function assertSponsorRefundReadyForUnfreeze(
  c: PoolClient,
  sourceId: string,
  allocationId: string,
  amountFen: number,
) {
  return assertSponsorRefundAllocation(c, sourceId, allocationId, amountFen, true);
}
/** Used by account closure: money facts and recovery obligations remain blockers. */
export async function sponsorClosureBlocked(c: PoolClient, userId: string) {
  return !!(
    await c.query(
      `SELECT 1 FROM sponsor_orders o WHERE (o.payer_user_id=$1 OR o.beneficiary_user_id=$1)
    AND (o.status<>'CLOSED' OR EXISTS(SELECT 1 FROM sponsor_recovery_cases r WHERE r.org_id=o.org_id AND r.status='OPEN')) LIMIT 1`,
      [userId],
    )
  ).rowCount;
}

export async function assertSponsorRefundDispatch(
  c: PoolClient,
  sourceId: string,
  allocationId: string,
  amountFen: number,
) {
  const p = (
    await c.query(
      `SELECT p.*,r.amount_fen AS refund_amount,t.source_id AS refund_source FROM sponsor_refund_plans p LEFT JOIN trade_refunds r ON r.id=p.trade_refund_id LEFT JOIN trade_orders t ON t.id=r.order_id WHERE p.id=$1 AND p.order_id=$2 FOR UPDATE OF p`,
      [allocationId, sourceId],
    )
  ).rows[0];
  if (
    !p ||
    p.status !== 'CLAIMED' ||
    p.amount_fen !== amountFen ||
    !p.reviewed_by ||
    !p.trade_refund_id ||
    p.refund_amount !== amountFen ||
    p.refund_source !== sourceId
  )
    sponsorFail('SPONSOR_REFUND_ALLOCATION_REQUIRED', '原退款分配未审核或金额已变化');
  if (
    p.batch_id &&
    !(
      await c.query(
        "SELECT 1 FROM sponsor_settlement_batches WHERE id=$1 AND order_id=$2 AND finished AND finish_status='SUCCEEDED' FOR UPDATE",
        [p.batch_id, sourceId],
      )
    ).rowCount
  )
    sponsorFail('SPONSOR_UNFREEZE_REQUIRED', '原退款解冻尚未核验');
  const covered = await sponsorAdvanceCovered(c, p);
  if (
    (
      await c.query(
        "SELECT 1 FROM sponsor_return_items WHERE refund_plan_id=$1 AND status NOT IN('NOT_REQUIRED','SUCCEEDED') AND NOT ($2 AND status='FAILED' AND EXISTS(SELECT 1 FROM sponsor_recovery_cases k WHERE k.return_item_id=sponsor_return_items.id)) LIMIT 1",
        [p.id, covered],
      )
    ).rowCount
  )
    sponsorFail('SPONSOR_RETURN_PENDING', '原分账回退尚未完成');
}

/** Amount that the ordinary trade closure guard may subtract from paid-minus-refunded.
 * Uses only final per-item facts and evidenced fees; no wallet balance or optimistic allocation. */
export async function readSponsorClosureFunds(
  c: PoolClient,
  sourceId: string,
  tradeOrderId: string,
): Promise<{ dischargedFen: number; unresolved: boolean }> {
  const blocked = () => ({ dischargedFen: 0, unresolved: true });
  const t = (
    await c.query(
      "SELECT * FROM trade_orders WHERE id=$1 AND source_id=$2 AND kind='SPONSOR_ORDER' FOR UPDATE",
      [tradeOrderId, sourceId],
    )
  ).rows[0];
  const o = (await c.query('SELECT * FROM sponsor_orders WHERE id=$1 FOR UPDATE', [sourceId]))
    .rows[0];
  if (
    !t ||
    !o ||
    t.org_id !== o.org_id ||
    t.payer_user_id !== o.payer_user_id ||
    t.total_fen !== o.total_fen ||
    o.status !== 'CLOSED'
  )
    return blocked();
  const payments = (
    await c.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1 ORDER BY id FOR UPDATE', [
      t.id,
    ])
  ).rows;
  if (payments.some((p) => ['DISPATCHING', 'UNKNOWN', 'NOTPAY'].includes(p.status)))
    return blocked();
  const paid = payments.filter((p) => p.status === 'PAID');
  if (paid.length !== 1 || !paid[0]!.profit_sharing || paid[0]!.total_fen !== o.total_fen)
    return blocked();
  const refunds = (
    await c.query('SELECT * FROM trade_refunds WHERE order_id=$1 ORDER BY id FOR UPDATE', [t.id])
  ).rows;
  if (refunds.some((r) => !['SUCCEEDED', 'FAILED', 'REJECTED'].includes(r.status)))
    return blocked();
  const refunded = refunds
    .filter((r) => r.status === 'SUCCEEDED')
    .reduce((n, r) => n + r.amount_fen, 0);
  if (refunded > o.total_fen) return blocked();
  const batches = (
    await c.query(
      'SELECT * FROM sponsor_settlement_batches WHERE order_id=$1 ORDER BY id FOR UPDATE',
      [sourceId],
    )
  ).rows;
  const items = (
    await c.query(
      'SELECT i.* FROM sponsor_settlement_items i JOIN sponsor_settlement_batches b ON b.id=i.batch_id WHERE b.order_id=$1 ORDER BY i.id FOR UPDATE OF i',
      [sourceId],
    )
  ).rows;
  const plans = (
    await c.query('SELECT * FROM sponsor_refund_plans WHERE order_id=$1 ORDER BY id FOR UPDATE', [
      sourceId,
    ])
  ).rows;
  const returns = (
    await c.query(
      'SELECT r.* FROM sponsor_return_items r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE p.order_id=$1 ORDER BY r.id FOR UPDATE OF r',
      [sourceId],
    )
  ).rows;
  const recoveries = (
    await c.query(
      'SELECT k.* FROM sponsor_recovery_cases k JOIN sponsor_refund_plans p ON p.id=k.refund_plan_id WHERE p.order_id=$1 ORDER BY k.id FOR UPDATE OF k',
      [sourceId],
    )
  ).rows;
  if (
    recoveries.some(
      (k) =>
        k.status === 'OPEN' || !k.reviewed_by || k.reviewed_by === k.proposed_by || !k.evidence,
    )
  )
    return blocked();
  const activePlans = plans.filter((p) => p.status !== 'REJECTED');
  if (
    activePlans.some(
      (p) =>
        p.status !== 'CLAIMED' ||
        (p.funding_mode && p.funding_mode !== 'RETURN_FIRST') ||
        !refunds.some(
          (r) =>
            r.id === p.trade_refund_id && r.status === 'SUCCEEDED' && r.amount_fen === p.amount_fen,
        ),
    )
  )
    return blocked();
  if (
    refunds
      .filter((r) => r.status === 'SUCCEEDED')
      .some((r) => !activePlans.some((p) => p.trade_refund_id === r.id))
  )
    return blocked();
  const active = batches.filter((b) => b.status !== 'REJECTED');
  if (!active.length)
    return refunded === o.total_fen ? { dischargedFen: 0, unresolved: false } : blocked();
  if (active.length !== 1) return blocked();
  const b = active[0]!;
  if (
    b.trade_order_id !== t.id ||
    b.payment_id !== paid[0]!.id ||
    b.transaction_id !== paid[0]!.provider_transaction_id ||
    !['SUCCEEDED', 'PARTIAL'].includes(b.status) ||
    !b.finished ||
    b.finish_status !== 'SUCCEEDED'
  )
    return blocked();
  if (
    o.verified_fee_fen === null ||
    !o.fee_verified_by ||
    !o.fee_evidence ||
    o.verified_fee_fen > o.snapshot.allowedFeeFen
  )
    return blocked();
  const allocation = items.filter((i) => i.batch_id === b.id);
  if (
    allocation.reduce((n, i) => n + i.amount_fen, 0) !== b.pool_fen ||
    allocation.some(
      (i) =>
        (!i.retained &&
          i.amount_fen > 0 &&
          (!['SUCCEEDED', 'FAILED'].includes(i.status) ||
            (i.status === 'SUCCEEDED' && !i.provider_detail_id))) ||
        (i.retained && i.status !== 'RETAINED'),
    )
  )
    return blocked();
  const priorRefund = o.total_fen - o.verified_fee_fen - b.pool_fen;
  if (priorRefund < 0 || priorRefund > refunded) return blocked();
  const batchPlans = activePlans.filter((p) => p.batch_id === b.id),
    reduction = batchPlans.reduce((n, p) => n + p.pool_reduction_fen, 0);
  if (reduction !== Math.min(refunded - priorRefund, b.pool_fen)) return blocked();
  const expected = allocateSponsorRefund(
    reduction,
    allocation.map((i) => ({ id: i.beneficiary_org_id, amountFen: i.amount_fen })),
  );
  let net = 0;
  for (let n = 0; n < allocation.length; n++) {
    const i = allocation[n]!,
      records = returns.filter(
        (r) => r.settlement_item_id === i.id && batchPlans.some((p) => p.id === r.refund_plan_id),
      );
    if (
      records.some(
        (r) =>
          r.status !== (i.retained || i.status === 'FAILED' ? 'NOT_REQUIRED' : 'SUCCEEDED') ||
          (!i.retained && i.status !== 'FAILED' && !r.provider_return_id),
      )
    )
      return blocked();
    const returned = records.reduce((sum, r) => sum + r.amount_fen, 0);
    if (returned !== expected[n]!.refundFen || (i.status === 'FAILED' && returned !== i.amount_fen))
      return blocked();
    net += i.amount_fen - returned;
  }
  const remainingFee = Math.min(o.verified_fee_fen, o.total_fen - refunded),
    dischargedFen = net + remainingFee;
  if (!Number.isSafeInteger(dischargedFen) || dischargedFen !== o.total_fen - refunded)
    return blocked();
  return { dischargedFen, unresolved: false };
}

async function sponsorAdvanceCovered(c: PoolClient, p: Record<string, any>) {
  if (p.funding_mode !== 'PLATFORM_ADVANCE') return false;
  const rows = (
    await c.query(
      "SELECT t.id,t.merchant_key,t.merchant_id,t.payer_user_id,t.beneficiary_user_id,a.id AS payment_id FROM trade_orders t JOIN trade_payment_attempts a ON a.order_id=t.id AND a.status='PAID' WHERE t.kind='SPONSOR_ORDER' AND t.source_id=$1",
      [p.order_id],
    )
  ).rows;
  if (
    rows.length !== 1 ||
    !p.advance_proposed_by ||
    !p.advance_reviewed_by ||
    p.advance_proposed_by === p.advance_reviewed_by ||
    !p.advance_evidence
  )
    sponsorFail('SPONSOR_COVERAGE_UNVERIFIED', '垫付审核或原支付绑定无效');
  const t = rows[0]!;
  if (
    [t.payer_user_id, t.beneficiary_user_id].includes(p.advance_proposed_by) ||
    [t.payer_user_id, t.beneficiary_user_id].includes(p.advance_reviewed_by)
  )
    sponsorFail('SPONSOR_COVERAGE_UNVERIFIED', '垫付须独立审核');
  validateSponsorAdvanceCoverage(p.advance_coverage, {
    sourceId: p.order_id,
    allocationId: p.id,
    tradeOrderId: t.id,
    paymentId: t.payment_id,
    merchantKey: t.merchant_key,
    merchantId: t.merchant_id,
    currency: 'CNY',
    amountFen: p.amount_fen,
  });
  return true;
}

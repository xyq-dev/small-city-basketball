import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { tradeBalances, tradeHash } from './trade-domain.js';
import { trainingTradeIdentity } from './training-trade-source.js';
type Row = Record<string, any>;
const unsettledPayment = ['DISPATCHING', 'UNKNOWN', 'NOTPAY'];
const unsettledRefund = ['PENDING_REVIEW', 'APPROVED', 'SENDING', 'UNKNOWN', 'PROCESSING'];
const unsettledSettlement = [
  'PENDING_REVIEW',
  'APPROVED',
  'SENDING',
  'UNKNOWN',
  'PROCESSING',
  'RETURNING',
  'RETURN_UNKNOWN',
];
/** Read-only capability preview; mutation reruns this under the shared org/calendar lock.
 * All training and common trade writes share that calendar lock. Completion ends teaching
 * obligations, not the independent trade settlement/closure gate. GET never mutates records. */
export async function trainingCohortCompletionBlocker(
  c: PoolClient,
  cohort: Row,
  safelyEndedEnrollmentIds?: string[],
): Promise<string | null> {
  if (!['ENROLLING', 'RUNNING', 'SUSPENDED'].includes(cohort.state))
    return '仅已发布班期可以正常结课';
  const sessions = (
    await c.query(
      `SELECT s.*,ends_at+buffer_minutes*interval '1 minute'<=clock_timestamp() AS ended
     FROM training_sessions s WHERE cohort_id=$1 ORDER BY id`,
      [cohort.id],
    )
  ).rows;
  if (
    !sessions.length ||
    sessions.some((s) => !s.ended || !['DELIVERED', 'CANCELLED'].includes(s.state))
  )
    return '仍有未来课次、未完成授课或未结束的离场缓冲';
  if (!sessions.some((s) => s.state === 'DELIVERED'))
    return '尚无实际授课记录，请按取消流程处理未开课班期';
  const entitlements = (
    await c.query(
      `SELECT e.* FROM training_lesson_entitlements e
     JOIN training_enrollments n ON n.id=e.enrollment_id
     JOIN training_sessions s ON s.id=e.current_session_id
     WHERE n.cohort_id=$1 OR s.cohort_id=$1 OR (n.state='CANCELLED' AND EXISTS(
       SELECT 1 FROM training_lesson_entitlements incoming JOIN training_sessions target ON target.id=incoming.current_session_id
       WHERE incoming.enrollment_id=n.id AND target.cohort_id=$1)) ORDER BY e.id`,
      [cohort.id],
    )
  ).rows;
  const ids = entitlements.map((e) => e.id);
  const enrollments = (
    await c.query(
      `SELECT n.*,n.hold_expires_at<=clock_timestamp() AS hold_expired,
     (SELECT enrollment_deadline<=clock_timestamp() FROM training_cohorts WHERE id=$1) AS enrollment_ended
     FROM training_enrollments n WHERE n.cohort_id=$1
     OR n.id IN(SELECT enrollment_id FROM training_lesson_entitlements WHERE id=ANY($2::uuid[])) ORDER BY n.id`,
      [cohort.id, ids],
    )
  ).rows;
  const consumptions = (
    await c.query(
      'SELECT * FROM training_consumptions WHERE entitlement_id=ANY($1::uuid[]) ORDER BY id',
      [ids],
    )
  ).rows;
  if (consumptions.some((x) => ['PROPOSED', 'REVIEWED', 'DISPUTED'].includes(x.status)))
    return '仍有未确认消费或消费异议';
  const allocations = (
    await c.query(
      `SELECT r.*,
     (SELECT count(*)::int FROM training_lesson_entitlements e WHERE e.id=ANY(r.entitlement_ids) AND e.enrollment_id=r.enrollment_id AND e.org_id=r.org_id) AS allocation_count,
     (SELECT sum(e.net_fen)::int FROM training_lesson_entitlements e WHERE e.id=ANY(r.entitlement_ids) AND e.enrollment_id=r.enrollment_id AND e.org_id=r.org_id) AS allocation_total
     FROM training_refund_allocations r WHERE r.entitlement_ids && $1::uuid[]
     OR r.enrollment_id IN(SELECT id FROM training_enrollments WHERE cohort_id=$2) ORDER BY r.id`,
      [ids, cohort.id],
    )
  ).rows;
  if (allocations.some((r) => ['PENDING_REVIEW', 'PENDING', 'UNKNOWN'].includes(r.status)))
    return '仍有待审核或待核对的逐课退款';
  if (
    allocations.some(
      (r) =>
        ['SUCCEEDED', 'COMPLETED_ZERO'].includes(r.status) &&
        (!r.reviewed_by ||
          r.reviewed_by === r.proposed_by ||
          r.allocation_count !== r.entitlement_ids.length ||
          r.allocation_total !== r.amount_fen),
    )
  )
    return '逐课退款金额或独立审核证据不一致';
  const unpaid = new Set<string>();
  for (const n of enrollments) {
    const primary = n.cohort_id === cohort.id;
    const orders = (
      await c.query(
        `SELECT * FROM trade_orders WHERE (kind='TRAINING_ENROLLMENT' AND source_id=$1) OR id=$2 ORDER BY id`,
        [n.id, n.trade_order_id],
      )
    ).rows;
    const order = orders[0];
    if (orders.length > 1 || (n.trade_order_id && !order)) return '培训交易来源绑定无法核验';
    let paid = 0,
      hasMoneyHistory = false;
    if (order) {
      const identity = trainingTradeIdentity(n),
        hash = tradeHash(identity);
      if (
        order.id !== n.trade_order_id ||
        order.kind !== 'TRAINING_ENROLLMENT' ||
        order.source_id !== n.id ||
        order.org_id !== n.org_id ||
        order.payer_user_id !== n.payer_user_id ||
        order.beneficiary_user_id !== n.terms_snapshot.beneficiaryId ||
        order.total_fen !== n.total_fen ||
        order.currency !== 'CNY' ||
        order.terms_id !== null ||
        order.source_version !== 1 ||
        order.merchant_key !== n.terms_snapshot.merchantKey ||
        order.source_hash !== hash ||
        !isDeepStrictEqual(order.source_snapshot, identity)
      )
        return '培训交易来源绑定无法核验';
      const attempts = (
        await c.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1', [order.id])
      ).rows;
      if (
        attempts.some(
          (p) =>
            unsettledPayment.includes(p.status) ||
            (['FAILED', 'CLOSED'].includes(p.status) &&
              (p.provider_transaction_id !== null || p.paid_at !== null)),
        )
      )
        return '仍有未核实的付款结果';
      paid = attempts.filter((p) => p.status === 'PAID').reduce((sum, p) => sum + p.total_fen, 0);
      if (paid !== 0 && paid !== n.total_fen) return '已收金额与培训合同不一致';
      const refunds = (await c.query('SELECT * FROM trade_refunds WHERE order_id=$1', [order.id]))
        .rows;
      const deductions = (
        await c.query('SELECT * FROM trade_deductions WHERE order_id=$1', [order.id])
      ).rows;
      const settlements = (
        await c.query('SELECT * FROM trade_settlements WHERE order_id=$1', [order.id])
      ).rows;
      hasMoneyHistory =
        paid > 0 || refunds.length > 0 || deductions.length > 0 || settlements.length > 0;
      try {
        const balances = tradeBalances(paid, refunds as any, deductions as any, settlements as any);
        if (balances.settledFen > paid - balances.refundedFen) return '退款与已结算金额相互冲突';
        if (
          order.status === 'SOURCE_CONFLICT' &&
          !(
            n.state === 'CANCELLED' &&
            paid > 0 &&
            balances.refundedFen === paid &&
            balances.settledFen === 0 &&
            entitlements
              .filter((e) => e.enrollment_id === n.id)
              .every((e) => e.state === 'REFUNDED')
          )
        )
          return '培训交易来源存在未消解冲突';
      } catch (error) {
        if (error instanceof ApiError && error.code === 'TRADE_BALANCE_INVALID')
          return '培训账款金额无法核验';
        throw error;
      }
      // Ordinary incoming makeup is lesson-scoped. The cancelled SOURCE_CONFLICT exception
      // instead proves a fully refunded source, so every money obligation of that source must be final.
      const wholeSource =
        primary || (n.state === 'CANCELLED' && order.status === 'SOURCE_CONFLICT');
      const relevantRefundIds = new Set(
        allocations.filter((r) => r.enrollment_id === n.id).map((r) => r.trade_refund_id),
      );
      if (
        refunds.some(
          (r) => (wholeSource || relevantRefundIds.has(r.id)) && unsettledRefund.includes(r.status),
        ) ||
        (wholeSource &&
          (deductions.some((d) => ['PENDING_REVIEW', 'REVERSAL_PENDING'].includes(d.status)) ||
            settlements.some((s) => unsettledSettlement.includes(s.status))))
      )
        return '仍有未决退款、扣减或结算，请在统一交易页核对';
      if (
        wholeSource &&
        (
          await c.query(
            `SELECT 1 FROM trade_settlement_returns r JOIN trade_settlements s ON s.id=r.settlement_id
         WHERE s.order_id=$1 AND r.status IN('SENDING','UNKNOWN','PROCESSING') LIMIT 1`,
            [order.id],
          )
        ).rowCount
      )
        return '仍有未决分账回退';
      for (const r of allocations.filter((x) => x.enrollment_id === n.id && x.trade_refund_id)) {
        const refund = refunds.find((x) => x.id === r.trade_refund_id);
        const binding = (
          await c.query(
            `SELECT 1 FROM r6_trade_refund_bindings WHERE kind='TRAINING_ENROLLMENT' AND source_id=$1
           AND allocation_id=$2 AND order_id=$3 AND refund_id=$4`,
            [n.id, r.id, order.id, r.trade_refund_id],
          )
        ).rowCount;
        if (
          !refund ||
          !binding ||
          refund.amount_fen !== r.amount_fen ||
          (r.status === 'SUCCEEDED' && refund.status !== 'SUCCEEDED')
        )
          return '逐课退款与统一交易回执不一致';
      }
    } else if (
      allocations.some(
        (r) =>
          r.enrollment_id === n.id &&
          (r.trade_refund_id || (r.amount_fen > 0 && r.status === 'SUCCEEDED')),
      )
    )
      return '逐课退款缺少真实交易来源';
    const own = entitlements.filter((e) => e.enrollment_id === n.id);
    const safeUnpaid =
      (!order || order.status !== 'SOURCE_CONFLICT') &&
      (['CANCELLED', 'EXPIRED'].includes(n.state) ||
        (primary &&
          n.enrollment_ended &&
          (n.state === 'WAITLISTED' || (n.state === 'HOLDING' && n.hold_expired)))) &&
      !hasMoneyHistory &&
      own.every((e) => e.state === 'AVAILABLE') &&
      !(
        await c.query(
          `SELECT 1 FROM training_lesson_entitlements e WHERE e.enrollment_id=$1 AND
         (EXISTS(SELECT 1 FROM training_attendance a WHERE a.entitlement_id=e.id)
          OR EXISTS(SELECT 1 FROM training_consumptions x WHERE x.entitlement_id=e.id)) LIMIT 1`,
          [n.id],
        )
      ).rowCount &&
      !(
        await c.query('SELECT 1 FROM training_refund_allocations WHERE enrollment_id=$1 LIMIT 1', [
          n.id,
        ])
      ).rowCount;
    if (safeUnpaid) {
      unpaid.add(n.id);
      if (primary && n.state !== 'CANCELLED') safelyEndedEnrollmentIds?.push(n.id);
    } else if (primary && !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(n.state))
      return '仍有未终结报名或待核对的付款，请先完成报名核对';
    else if (n.total_fen > 0 && (!order || paid !== n.total_fen))
      return '收费报名尚无完整真实付款记录';
  }
  for (const e of entitlements) {
    if (unpaid.has(e.enrollment_id)) continue;
    if (!['CONSUMED', 'REFUNDED'].includes(e.state)) return '仍有本班或跨班补课权益未完成';
    if (
      e.state === 'CONSUMED' &&
      !consumptions.some((x) => x.entitlement_id === e.id && x.status === 'FINALIZED')
    )
      return '课次消费缺少最终确认记录';
    if (
      e.state === 'REFUNDED' &&
      !allocations.some(
        (r) =>
          r.entitlement_ids.includes(e.id) &&
          r.enrollment_id === e.enrollment_id &&
          r.org_id === e.org_id &&
          ((r.status === 'SUCCEEDED' && r.trade_refund_id && r.amount_fen >= e.net_fen) ||
            (r.status === 'COMPLETED_ZERO' && r.amount_fen === 0 && e.net_fen === 0)),
      )
    )
      return '课次退款缺少已完成的分配记录';
  }
  return null;
}

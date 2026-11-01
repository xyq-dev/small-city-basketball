import type { PoolClient } from 'pg';
import { notFound } from './errors.js';
import { trainingFail } from './training-domain.js';
/** Read financial history independently of the rollout switch. Frozen identity never follows state. */
export async function trainingSourceReference(c: PoolClient, id: string) {
  const n = (
    await c.query(
      'SELECT org_id,payer_user_id,terms_snapshot FROM training_enrollments WHERE id=$1',
      [id],
    )
  ).rows[0];
  if (!n) throw notFound();
  return {
    orgId: n.org_id as string,
    payerId: n.payer_user_id as string,
    beneficiaryId: n.terms_snapshot.beneficiaryId as string,
  };
}
export async function readTrainingTradeSource(c: PoolClient, id: string) {
  const n = (
    await c.query(
      `SELECT n.*,h.state AS cohort_state,h.enrollment_deadline,
 EXISTS(SELECT 1 FROM training_providers p WHERE p.org_id=n.org_id AND p.status='APPROVED' AND p.qualified_until>(SELECT max(ends_at) FROM training_sessions WHERE cohort_id=h.id))
 AND EXISTS(SELECT 1 FROM organizations o WHERE o.id=n.org_id AND o.status='ACTIVE')
 AND EXISTS(SELECT 1 FROM courts ct WHERE ct.id=h.court_id AND ct.org_id=n.org_id AND ct.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM training_session_coaches sc JOIN training_sessions s ON s.id=sc.session_id JOIN training_coaches t ON t.id=sc.coach_id JOIN users u ON u.id=t.user_id WHERE s.cohort_id=h.id AND (t.status<>'APPROVED' OR NOT t.consented OR t.qualified_until<s.ends_at OR u.status<>'ACTIVE')) AS qualified
 FROM training_enrollments n JOIN training_cohorts h ON h.id=n.cohort_id WHERE n.id=$1 FOR UPDATE OF n`,
      [id],
    )
  ).rows[0];
  if (!n) throw notFound();
  const q = n.terms_snapshot;
  const ent = (
    await c.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN('CONSUMED','REFUNDED'))::int AS complete FROM training_lesson_entitlements WHERE enrollment_id=$1",
      [id],
    )
  ).rows[0]!;
  const disputed = !!(
    await c.query(
      "SELECT 1 FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE e.enrollment_id=$1 AND x.status='DISPUTED' LIMIT 1",
      [id],
    )
  ).rowCount;
  const now = (await c.query('SELECT clock_timestamp() AS n')).rows[0]!.n;
  return {
    orgId: n.org_id as string,
    payerId: n.payer_user_id as string,
    beneficiaryId: q.beneficiaryId as string,
    beneficiaryName: q.beneficiaryName as string,
    title: q.title as string,
    version: 1,
    totalFen: n.total_fen as number,
    platformFeeFen: 0,
    termsId: null,
    consentId: n.terms_id as string,
    terms: q.termsText as string,
    merchantKey: q.merchantKey as string | null,
    payable:
      n.state === 'HOLDING' &&
      n.qualified &&
      n.cohort_state === 'ENROLLING' &&
      new Date(n.hold_expires_at) > new Date(now) &&
      new Date(n.enrollment_deadline) > new Date(now),
    fulfilled: ent.total > 0 && ent.total === ent.complete,
    disputed,
    valid: !['CANCELLED', 'EXPIRED', 'PAID_UNALLOCATED', 'WAITLISTED'].includes(n.state),
    expiresAt: n.hold_expires_at ? new Date(n.hold_expires_at).toISOString() : null,
    identity: {
      kind: 'TRAINING_ENROLLMENT',
      id,
      orgId: n.org_id,
      applicantId: n.applicant_user_id,
      payerId: n.payer_user_id,
      learnerId: n.learner_user_id,
      termsId: n.terms_id,
      contract: q,
      totalFen: n.total_fen,
      merchantKey: q.merchantKey,
    },
  };
}
export async function assertTrainingRefundAllocation(
  c: PoolClient,
  enrollmentId: string,
  allocationId: string,
  amountFen: number,
): Promise<void> {
  const r = (
    await c.query(
      'SELECT * FROM training_refund_allocations WHERE id=$1 AND enrollment_id=$2 FOR UPDATE',
      [allocationId, enrollmentId],
    )
  ).rows[0];
  if (
    !r ||
    !r.reviewed_by ||
    r.reviewed_by === r.proposed_by ||
    !['PENDING', 'UNKNOWN', 'SUCCEEDED'].includes(r.status) ||
    r.amount_fen !== amountFen ||
    amountFen <= 0
  )
    trainingFail('REFUND_ALLOCATION_REQUIRED', '退款须使用已独立审核的逐课分配');
  const es = (
    await c.query(
      'SELECT * FROM training_lesson_entitlements WHERE enrollment_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [enrollmentId, r.entitlement_ids],
    )
  ).rows;
  if (
    es.length !== r.entitlement_ids.length ||
    es.reduce((a, e) => a + e.net_fen, 0) !== amountFen ||
    es.some((e) => !['REFUND_PENDING', 'REFUNDED'].includes(e.state))
  )
    trainingFail('REFUND_ALLOCATION_CHANGED', '逐课退款保留已变化');
  if (r.trade_refund_id) {
    const old = (
      await c.query('SELECT id,amount_fen FROM trade_refunds WHERE id=$1', [r.trade_refund_id])
    ).rows[0];
    if (!old || old.amount_fen !== amountFen)
      trainingFail('REFUND_BINDING_CONFLICT', '退款绑定不一致');
  }
}
/** Account closure must retain unresolved service/refund/dispute obligations. */
export async function trainingClosureBlockers(c: PoolClient, userId: string) {
  return !!(
    await c.query(
      `SELECT 1 FROM training_enrollments n WHERE $1 IN(n.applicant_user_id,n.payer_user_id,n.learner_user_id) AND (
 n.state IN('HOLDING','CONFIRMED','PAID_UNALLOCATED') OR
 EXISTS(SELECT 1 FROM training_refund_allocations r WHERE r.enrollment_id=n.id AND r.status IN('PENDING_REVIEW','PENDING','UNKNOWN')) OR
 EXISTS(SELECT 1 FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE e.enrollment_id=n.id AND x.status IN('PROPOSED','REVIEWED','DISPUTED'))) LIMIT 1`,
      [userId],
    )
  ).rowCount;
}
/** Called immediately before provider dispatch; history stays readable while unsafe effects stop. */
export async function assertTrainingRefundDispatch(
  c: PoolClient,
  enrollmentId: string,
  allocationId: string,
  amountFen: number,
): Promise<void> {
  await assertTrainingRefundAllocation(c, enrollmentId, allocationId, amountFen);
  const r = (
    await c.query(
      'SELECT * FROM training_refund_allocations WHERE id=$1 AND enrollment_id=$2 FOR UPDATE',
      [allocationId, enrollmentId],
    )
  ).rows[0]!;
  if (!r.trade_refund_id || !['PENDING', 'UNKNOWN'].includes(r.status))
    trainingFail('REFUND_BINDING_CONFLICT', '退款必须关联原待处理交易');
  const t = (
    await c.query(
      "SELECT r.id,r.amount_fen FROM trade_refunds r JOIN trade_orders o ON o.id=r.order_id WHERE r.id=$1 AND o.kind='TRAINING_ENROLLMENT' AND o.source_id=$2",
      [r.trade_refund_id, enrollmentId],
    )
  ).rows[0];
  if (!t || t.amount_fen !== amountFen)
    trainingFail('REFUND_BINDING_CONFLICT', '原交易退款绑定不一致');
  if (
    (
      await c.query(
        "SELECT 1 FROM training_consumptions WHERE entitlement_id=ANY($1::uuid[]) AND status IN('PROPOSED','REVIEWED','FINALIZED','DISPUTED') LIMIT 1",
        [r.entitlement_ids],
      )
    ).rowCount
  )
    trainingFail('REFUND_LESSON_UNAVAILABLE', '课次存在消费或异议，退款暂停');
}

import type { PoolClient } from 'pg';
import { readSponsorClosureFunds } from './sponsor-commerce-source.js';

/** These are retained workflow facts. Missing R6 tables are a failed inspection,
 * never evidence that an account has no obligations. Caller holds the user UPDATE. */
const sponsorScope = `WITH managed_orgs AS (
 SELECT org_id FROM organization_memberships WHERE user_id=$1 AND status='ACTIVE' AND role IN('ORG_OWNER','ORG_ADMIN')
), contracts AS (
 SELECT r.id,r.org_id FROM sponsor_contracts r WHERE $1 IN(r.payer_user_id,r.beneficiary_user_id,r.created_by,r.reviewed_by,r.owner_signed_by)
 OR r.org_id IN(SELECT org_id FROM managed_orgs)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.shares) AS share(value) JOIN managed_orgs m ON m.org_id::text=(share.value->>'beneficiaryOrgId'))
), orders AS (
 SELECT o.id,o.org_id FROM sponsor_orders o WHERE o.contract_id IN(SELECT id FROM contracts)
 OR $1 IN(o.payer_user_id,o.beneficiary_user_id,o.created_by)
 OR EXISTS(SELECT 1 FROM sponsor_deliveries d WHERE d.order_id=o.id AND $1 IN(d.created_by,d.reviewed_by))
 OR EXISTS(SELECT 1 FROM sponsor_settlement_batches b WHERE b.order_id=o.id AND ($1=b.proposed_by OR $1=ANY(b.approvals)))
 OR EXISTS(SELECT 1 FROM sponsor_refund_plans p WHERE p.order_id=o.id AND $1 IN(p.proposed_by,p.reviewed_by))
 OR EXISTS(SELECT 1 FROM sponsor_refund_retries r WHERE r.order_id=o.id AND $1 IN(r.proposed_by,r.reviewed_by))
 OR EXISTS(SELECT 1 FROM sponsor_recovery_cases r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE p.order_id=o.id AND $1 IN(r.proposed_by,r.reviewed_by))
), scoped_contracts AS (
 SELECT id,org_id FROM contracts
 UNION SELECT c.id,c.org_id FROM sponsor_contracts c JOIN sponsor_orders o ON o.contract_id=c.id WHERE o.id IN(SELECT id FROM orders)
)`;
const matchingNeeds = `SELECT n.id FROM matching_needs n WHERE n.owner_id=$1
 OR EXISTS(SELECT 1 FROM matching_intents i WHERE i.need_id=n.id AND i.receiver_id=$1)
 OR EXISTS(SELECT 1 FROM matching_slot_assignments a WHERE a.need_id=n.id AND a.source_user_id=$1)`;
const dispatchRequests = `SELECT r.id FROM dispatch_requests r WHERE r.owner_user_id=$1
 OR EXISTS(SELECT 1 FROM dispatch_offers o WHERE o.request_id=r.id AND o.provider_user_id=$1)
 OR EXISTS(SELECT 1 FROM dispatch_holds h WHERE h.request_id=r.id AND h.provider_user_id=$1)`;
const trainingEnrollments = `SELECT n.id FROM training_enrollments n WHERE $1 IN(n.applicant_user_id,n.payer_user_id,n.learner_user_id)
 OR EXISTS(SELECT 1 FROM training_refund_allocations r WHERE r.enrollment_id=n.id AND $1 IN(r.proposed_by,r.reviewed_by))
 OR EXISTS(SELECT 1 FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE e.enrollment_id=n.id AND $1 IN(x.proposed_by,x.reviewed_by,x.acknowledged_by))`;

/** Pre-confirmation cancellation retains AVAILABLE quote rows. They are not
 * outstanding lessons only when both service and canonical money evidence are empty.
 * Read by source identity as well as the optional back-reference: an orphaned or
 * inconsistent trade row must not disappear from an unpaid cancellation check. */
const safelyCancelledUnpaidTraining = `SELECT n.id FROM training_enrollments n
 WHERE $1 IN(n.applicant_user_id,n.payer_user_id,n.learner_user_id) AND n.state='CANCELLED'
 AND NOT EXISTS(SELECT 1 FROM training_attendance a JOIN training_lesson_entitlements e ON e.id=a.entitlement_id WHERE e.enrollment_id=n.id)
 AND NOT EXISTS(SELECT 1 FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE e.enrollment_id=n.id)
 AND NOT EXISTS(SELECT 1 FROM training_refund_allocations r WHERE r.enrollment_id=n.id)
 AND (n.trade_order_id IS NULL OR EXISTS(SELECT 1 FROM trade_orders t WHERE t.id=n.trade_order_id AND t.kind='TRAINING_ENROLLMENT' AND t.source_id=n.id AND t.org_id=n.org_id AND t.payer_user_id=n.payer_user_id AND t.total_fen=n.total_fen))
 AND NOT EXISTS(SELECT 1 FROM trade_orders t WHERE t.kind='TRAINING_ENROLLMENT' AND t.source_id=n.id AND (
  t.id IS DISTINCT FROM n.trade_order_id OR t.org_id<>n.org_id OR t.payer_user_id<>n.payer_user_id OR t.total_fen<>n.total_fen OR t.status='SOURCE_CONFLICT'
  OR EXISTS(SELECT 1 FROM trade_payment_attempts p WHERE p.order_id=t.id AND p.status NOT IN('FAILED','CLOSED'))
  OR EXISTS(SELECT 1 FROM trade_refunds r WHERE r.order_id=t.id)
  OR EXISTS(SELECT 1 FROM trade_deductions d WHERE d.order_id=t.id)
  OR EXISTS(SELECT 1 FROM trade_settlements s WHERE s.order_id=t.id)))`;

export async function readRemainingSixClosureOrgs(
  c: PoolClient,
  userId: string,
): Promise<string[]> {
  const result = await c.query(
    `${sponsorScope}
 SELECT org_id FROM training_enrollments WHERE id IN(${trainingEnrollments})
 UNION SELECT org_id FROM training_coaches WHERE user_id=$1 OR created_by=$1
 UNION SELECT org_id FROM training_cohorts WHERE created_by=$1
 UNION SELECT org_id FROM training_guardian_grants WHERE $1 IN(learner_user_id,guardian_user_id)
 UNION SELECT org_id FROM matching_needs WHERE id IN(${matchingNeeds})
 UNION SELECT org_id FROM matching_supply_preferences WHERE owner_id=$1 AND org_id IS NOT NULL
 UNION SELECT org_id FROM dispatch_requests WHERE id IN(${dispatchRequests})
 UNION SELECT org_id FROM scoped_contracts UNION SELECT org_id FROM orders
 UNION SELECT beneficiary_org_id FROM sponsor_settlement_items WHERE batch_id IN(SELECT id FROM sponsor_settlement_batches WHERE order_id IN(SELECT id FROM orders))
 ORDER BY org_id`,
    [userId],
  );
  return result.rows.map((r) => r.org_id as string);
}
function busy(): never {
  throw Object.assign(new Error('Closure resource busy'), { code: '55P03' });
}
/** Core has already acquired all org/calendar locks with try/NOWAIT. No waits on
 * opposite users, preferences or source rows while holding the closing user lock. */
export async function lockRemainingSixClosure(c: PoolClient, userId: string): Promise<void> {
  const prefs = (
    await c.query(
      'SELECT source_kind,source_id FROM matching_supply_preferences WHERE owner_id=$1 ORDER BY source_kind,source_id',
      [userId],
    )
  ).rows;
  for (const p of prefs) {
    const locked = await c.query(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1,4402)) AS acquired',
      [p.source_kind + ':' + p.source_id],
    );
    if (!locked.rows[0]?.acquired) busy();
  }
  const locks = [
    'SELECT source_id FROM matching_supply_preferences WHERE owner_id=$1 ORDER BY source_kind,source_id FOR UPDATE NOWAIT',
    `SELECT id FROM matching_needs WHERE id IN(${matchingNeeds}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM matching_demand_slots WHERE need_id IN(${matchingNeeds}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM matching_intents WHERE need_id IN(${matchingNeeds}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM matching_outbox WHERE need_id IN(${matchingNeeds}) ORDER BY id FOR UPDATE NOWAIT`,
    'SELECT provider_user_id FROM dispatch_preferences WHERE provider_user_id=$1 FOR UPDATE NOWAIT',
    `SELECT id FROM dispatch_requests WHERE id IN(${dispatchRequests}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM dispatch_offers WHERE request_id IN(${dispatchRequests}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM dispatch_holds WHERE request_id IN(${dispatchRequests}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM local_resource_reservations WHERE dispatch_offer_id IN(SELECT id FROM dispatch_offers WHERE request_id IN(${dispatchRequests})) ORDER BY id FOR UPDATE NOWAIT`,
    'SELECT id FROM training_coaches WHERE user_id=$1 ORDER BY id FOR UPDATE NOWAIT',
    'SELECT id FROM training_guardian_grants WHERE $1 IN(learner_user_id,guardian_user_id) ORDER BY id FOR UPDATE NOWAIT',
    `SELECT id FROM training_enrollments WHERE id IN(${trainingEnrollments}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM trade_orders WHERE kind='TRAINING_ENROLLMENT' AND source_id IN(${trainingEnrollments}) ORDER BY id FOR UPDATE NOWAIT`,
    ...['trade_payment_attempts', 'trade_refunds', 'trade_deductions', 'trade_settlements'].map(
      (table) =>
        `SELECT x.id FROM ${table} x JOIN trade_orders t ON t.id=x.order_id WHERE t.kind='TRAINING_ENROLLMENT' AND t.source_id IN(${trainingEnrollments}) ORDER BY x.id FOR UPDATE OF x NOWAIT`,
    ),
    `SELECT id FROM training_lesson_entitlements WHERE enrollment_id IN(${trainingEnrollments}) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM training_consumptions WHERE entitlement_id IN(SELECT id FROM training_lesson_entitlements WHERE enrollment_id IN(${trainingEnrollments})) ORDER BY id FOR UPDATE NOWAIT`,
    `SELECT id FROM training_refund_allocations WHERE enrollment_id IN(${trainingEnrollments}) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_contracts WHERE id IN(SELECT id FROM scoped_contracts) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_orders WHERE id IN(SELECT id FROM orders) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM trade_orders WHERE kind='SPONSOR_ORDER' AND source_id IN(SELECT id FROM orders) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT p.id FROM trade_payment_attempts p JOIN trade_orders t ON t.id=p.order_id WHERE t.kind='SPONSOR_ORDER' AND t.source_id IN(SELECT id FROM orders) ORDER BY p.id FOR UPDATE OF p NOWAIT`,
    ...['trade_refunds', 'trade_deductions', 'trade_settlements'].map(
      (table) =>
        `${sponsorScope} SELECT r.id FROM ${table} r JOIN trade_orders t ON t.id=r.order_id WHERE t.kind='SPONSOR_ORDER' AND t.source_id IN(SELECT id FROM orders) ORDER BY r.id FOR UPDATE OF r NOWAIT`,
    ),
    `${sponsorScope} SELECT id FROM sponsor_deliveries WHERE order_id IN(SELECT id FROM orders) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_settlement_batches WHERE order_id IN(SELECT id FROM orders) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_settlement_items WHERE batch_id IN(SELECT id FROM sponsor_settlement_batches WHERE order_id IN(SELECT id FROM orders)) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_refund_plans WHERE order_id IN(SELECT id FROM orders) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_refund_retries WHERE order_id IN(SELECT id FROM orders) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM trade_refunds WHERE id IN(
      SELECT trade_refund_id FROM sponsor_refund_plans WHERE order_id IN(SELECT id FROM orders)
      UNION SELECT previous_refund_id FROM sponsor_refund_retries WHERE order_id IN(SELECT id FROM orders)
      UNION SELECT trade_refund_id FROM sponsor_refund_retries WHERE order_id IN(SELECT id FROM orders)) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_return_items WHERE refund_plan_id IN(SELECT id FROM sponsor_refund_plans WHERE order_id IN(SELECT id FROM orders)) ORDER BY id FOR UPDATE NOWAIT`,
    `${sponsorScope} SELECT id FROM sponsor_recovery_cases WHERE refund_plan_id IN(SELECT id FROM sponsor_refund_plans WHERE order_id IN(SELECT id FROM orders)) ORDER BY id FOR UPDATE NOWAIT`,
  ];
  for (const sql of locks) await c.query(sql, [userId]);
}
export async function readRemainingSixClosureBlockers(
  c: PoolClient,
  userId: string,
): Promise<{ code: string }[]> {
  const result = await c.query(
    `${sponsorScope}, unpaid_training_cancellations AS (${safelyCancelledUnpaidTraining})
 SELECT
 EXISTS(SELECT 1 FROM training_enrollments n WHERE $1 IN(n.applicant_user_id,n.payer_user_id,n.learner_user_id) AND
  (n.state IN('WAITLISTED','HOLDING','CONFIRMED','PAID_UNALLOCATED') OR EXISTS(SELECT 1 FROM training_lesson_entitlements e WHERE e.enrollment_id=n.id AND e.state IN('AVAILABLE','MAKEUP_DUE','CONSUMPTION_PENDING','REFUND_PENDING') AND NOT(e.state='AVAILABLE' AND n.id IN(SELECT id FROM unpaid_training_cancellations)))))
 OR EXISTS(SELECT 1 FROM training_coaches t JOIN training_session_coaches x ON x.coach_id=t.id JOIN training_sessions s ON s.id=x.session_id JOIN training_cohorts h ON h.id=s.cohort_id WHERE t.user_id=$1 AND s.state='SCHEDULED' AND h.state NOT IN('COMPLETED','CANCELLED'))
 OR EXISTS(SELECT 1 FROM training_cohorts h WHERE h.created_by=$1 AND h.state IN('ENROLLING','RUNNING','SUSPENDED')) AS training_service,
 EXISTS(SELECT 1 FROM training_refund_allocations r WHERE (r.enrollment_id IN(SELECT id FROM training_enrollments WHERE $1 IN(applicant_user_id,payer_user_id,learner_user_id)) OR $1 IN(r.proposed_by,r.reviewed_by)) AND r.status NOT IN('SUCCEEDED','FAILED','REJECTED','COMPLETED_ZERO'))
 OR EXISTS(SELECT 1 FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE (e.enrollment_id IN(SELECT id FROM training_enrollments WHERE $1 IN(applicant_user_id,payer_user_id,learner_user_id)) OR $1 IN(x.proposed_by,x.reviewed_by,x.acknowledged_by)) AND x.status IN('PROPOSED','REVIEWED','DISPUTED')) AS training_money,
 EXISTS(SELECT 1 FROM matching_intents i JOIN matching_needs n ON n.id=i.need_id WHERE (n.owner_id=$1 OR i.receiver_id=$1) AND i.status IN('PENDING','MUTUAL_INTEREST') AND i.expires_at>clock_timestamp()) AS matching_intent,
 EXISTS(SELECT 1 FROM matching_slot_assignments a JOIN matching_needs n ON n.id=a.need_id WHERE (n.owner_id=$1 OR a.source_user_id=$1) AND a.active AND (
  (a.source_kind='LOCAL_BOOKING' AND NOT EXISTS(SELECT 1 FROM local_bookings b WHERE b.id=a.source_id AND b.status IN('COMPLETED','DECLINED','CANCELLED','EXPIRED')))
  OR (a.source_kind='TEAM_MATCHUP' AND NOT EXISTS(SELECT 1 FROM local_matchups m WHERE m.id=a.source_id AND m.status IN('COMPLETED','DECLINED','CANCELLED')))
  OR (a.source_kind='PLAYER_ORDER' AND (NOT EXISTS(SELECT 1 FROM booking_orders o WHERE o.id=a.source_id) OR NOT EXISTS(SELECT 1 FROM booking_appearances p WHERE p.order_id=a.source_id) OR EXISTS(SELECT 1 FROM booking_appearances p WHERE p.order_id=a.source_id AND p.status NOT IN('COMPLETED','DECLINED','CANCELLED','EXPIRED')))))) AS matching_source,
 EXISTS(SELECT 1 FROM dispatch_requests r WHERE r.owner_user_id=$1 AND r.source_booking_id IS NULL AND r.status IN('INVITING','PAUSED','REVIEWING','NEEDS_MANUAL') AND r.expires_at>clock_timestamp())
 OR EXISTS(SELECT 1 FROM dispatch_offers o WHERE o.provider_user_id=$1 AND ((o.status IN('PENDING','TRAVEL_REVIEW','READY') AND o.expires_at>clock_timestamp()) OR (o.status='ACCEPTED_HELD' AND o.hold_expires_at>clock_timestamp())))
 OR EXISTS(SELECT 1 FROM dispatch_holds h WHERE (h.provider_user_id=$1 OR h.request_id IN(SELECT id FROM dispatch_requests WHERE owner_user_id=$1)) AND h.state='ACTIVE' AND h.expires_at>clock_timestamp()) AS dispatch_intent,
 EXISTS(SELECT 1 FROM dispatch_requests r WHERE (r.owner_user_id=$1 OR EXISTS(SELECT 1 FROM dispatch_offers o WHERE o.request_id=r.id AND o.provider_user_id=$1 AND o.source_booking_id=r.source_booking_id)) AND r.source_booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM local_bookings b WHERE b.id=r.source_booking_id AND b.status IN('COMPLETED','DECLINED','CANCELLED','EXPIRED'))) AS dispatch_source,
 EXISTS(SELECT 1 FROM sponsor_contracts r WHERE r.id IN(SELECT id FROM scoped_contracts) AND r.status NOT IN('REJECTED','CLOSED'))
 OR EXISTS(SELECT 1 FROM sponsor_orders o WHERE o.id IN(SELECT id FROM orders) AND o.status<>'CLOSED') AS sponsor_service,
 EXISTS(SELECT 1 FROM sponsor_settlement_batches b WHERE b.order_id IN(SELECT id FROM orders) AND b.status<>'REJECTED' AND (b.status NOT IN('SUCCEEDED','PARTIAL') OR NOT b.finished OR b.finish_status<>'SUCCEEDED'
  OR EXISTS(SELECT 1 FROM sponsor_settlement_items i WHERE i.batch_id=b.id AND i.status NOT IN('SUCCEEDED','FAILED','RETAINED') AND NOT(i.status='NOT_REQUIRED' AND NOT i.retained AND i.amount_fen=0))))
 OR EXISTS(SELECT 1 FROM sponsor_refund_plans p WHERE p.order_id IN(SELECT id FROM orders) AND p.status NOT IN('REJECTED','CLAIMED'))
 OR EXISTS(SELECT 1 FROM sponsor_refund_retries r WHERE r.order_id IN(SELECT id FROM orders) AND r.status NOT IN('REJECTED','CLAIMED'))
 OR EXISTS(SELECT 1 FROM sponsor_return_items r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE p.order_id IN(SELECT id FROM orders) AND r.status NOT IN('NOT_REQUIRED','SUCCEEDED') AND NOT(
 r.status='FAILED' AND EXISTS(SELECT 1 FROM sponsor_recovery_cases resolved WHERE resolved.return_item_id=r.id
 AND resolved.status IN('RECOVERED','WRITTEN_OFF') AND resolved.proposed_by IS NOT NULL AND resolved.reviewed_by IS NOT NULL
 AND resolved.proposed_by<>resolved.reviewed_by AND char_length(btrim(resolved.evidence))>=4)))
 OR EXISTS(SELECT 1 FROM sponsor_recovery_cases r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE p.order_id IN(SELECT id FROM orders) AND r.status='OPEN') AS sponsor_money`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('R6 closure inspection did not return facts');
  const codes = {
    training_service: 'TRAINING_SERVICE_UNRESOLVED',
    training_money: 'TRAINING_MONEY_UNRESOLVED',
    matching_intent: 'MATCHING_INTENT_UNRESOLVED',
    matching_source: 'MATCHING_SOURCE_UNRESOLVED',
    dispatch_intent: 'DISPATCH_INTENT_UNRESOLVED',
    dispatch_source: 'DISPATCH_SOURCE_UNRESOLVED',
    sponsor_service: 'SPONSOR_SERVICE_UNRESOLVED',
    sponsor_money: 'SPONSOR_MONEY_UNRESOLVED',
  };
  const blockers = Object.entries(codes).flatMap(([key, code]) => {
    if (typeof row[key] !== 'boolean')
      throw new Error('R6 closure inspection returned invalid facts');
    return row[key] ? [{ code }] : [];
  });
  // The scope includes beneficiary-org administrators and workflow reviewers who
  // need not be the payer/beneficiary of any trade_order. Do not delegate their
  // module funds to the narrower common account-closure ownership query. Every
  // CLAIMED plan, including terminal failed attempts and any retry lineage, must
  // be discharged by this exact reconciliation. Its status alone is never proof.
  // The same helper proves CLOSED unpaid sources; a missing canonical order blocks.
  const orders = (
    await c.query(
      `${sponsorScope} SELECT o.id,t.id AS trade_order_id FROM orders o
       LEFT JOIN trade_orders t ON t.kind='SPONSOR_ORDER' AND t.source_id=o.id ORDER BY o.id`,
      [userId],
    )
  ).rows;
  for (const order of orders) {
    const funds = order.trade_order_id
      ? await readSponsorClosureFunds(c, order.id, order.trade_order_id)
      : null;
    if (
      !funds ||
      funds.unresolved ||
      !Number.isSafeInteger(funds.dischargedFen) ||
      funds.dischargedFen < 0
    ) {
      if (!blockers.some((b) => b.code === 'SPONSOR_MONEY_UNRESOLVED'))
        blockers.push({ code: 'SPONSOR_MONEY_UNRESOLVED' });
      break;
    }
  }
  return blockers;
}
/** Only after all inspections are empty, in the final closure transaction.
 * Withdraw contact/publicity permissions, never financial or immutable history. */
export async function revokeRemainingSixPrivacy(c: PoolClient, userId: string): Promise<void> {
  const updates = [
    'UPDATE matching_supply_preferences SET discovery_enabled=false,contact_enabled=false,version=version+1,updated_at=clock_timestamp() WHERE owner_id=$1 AND (discovery_enabled OR contact_enabled)',
    "UPDATE matching_outbox SET state='CANCELLED' WHERE state='PENDING' AND (recipient_id=$1 OR need_id IN(SELECT id FROM matching_needs WHERE owner_id=$1) OR intent_id IN(SELECT id FROM matching_intents WHERE receiver_id=$1))",
    "UPDATE matching_intents SET status=CASE WHEN receiver_id=$1 THEN 'DECLINED' ELSE 'WITHDRAWN' END,version=version+1,updated_at=clock_timestamp() WHERE status IN('PENDING','MUTUAL_INTEREST') AND (receiver_id=$1 OR need_id IN(SELECT id FROM matching_needs WHERE owner_id=$1))",
    "UPDATE matching_runs SET status='STALE' WHERE status='READY' AND need_id IN(SELECT id FROM matching_needs WHERE owner_id=$1)",
    "UPDATE matching_needs SET status='CLOSED',latest_run_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE owner_id=$1 AND status<>'CLOSED'",
    'UPDATE dispatch_preferences SET enabled=false,version=version+1,updated_at=clock_timestamp() WHERE provider_user_id=$1 AND enabled',
    `UPDATE local_resource_reservations SET active=false WHERE active AND dispatch_offer_id IN(SELECT o.id FROM dispatch_offers o JOIN dispatch_requests r ON r.id=o.request_id WHERE (o.provider_user_id=$1 OR r.owner_user_id=$1) AND o.source_booking_id IS NULL)`,
    `UPDATE dispatch_holds SET state='RELEASED' WHERE state='ACTIVE' AND source_booking_id IS NULL AND (provider_user_id=$1 OR request_id IN(SELECT id FROM dispatch_requests WHERE owner_user_id=$1))`,
    "UPDATE dispatch_offers SET status='WITHDRAWN',reason='账号注销撤回联系',version=version+1,updated_at=clock_timestamp() WHERE source_booking_id IS NULL AND status IN('PENDING','TRAVEL_REVIEW','READY','ACCEPTED_HELD') AND (provider_user_id=$1 OR request_id IN(SELECT id FROM dispatch_requests WHERE owner_user_id=$1))",
    "UPDATE dispatch_requests SET status='CANCELLED',winner_offer_id=NULL,next_batch_at=NULL,reason='账号注销关闭需求',version=version+1,updated_at=clock_timestamp() WHERE owner_user_id=$1 AND source_booking_id IS NULL AND status NOT IN('CANCELLED','EXPIRED')",
    "UPDATE training_coaches SET consented=false,status='SUSPENDED',version=version+1 WHERE user_id=$1 AND (consented OR status<>'SUSPENDED')",
    "UPDATE training_guardian_grants SET state='REVOKED',epoch=epoch+1 WHERE $1 IN(learner_user_id,guardian_user_id) AND state IN('PENDING','APPROVED')",
  ];
  for (const sql of updates) await c.query(sql, [userId]);
}

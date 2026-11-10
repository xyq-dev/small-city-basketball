import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CommerceMode } from '@small-city-basketball/contracts';
import { fail, integer } from './domain.js';
import { membershipMutex } from './membership-store.js';
/** Caller holds the original event UPDATE lock. Never starts another transaction. */
export async function activateEventCommerce(
  c: PoolClient,
  input: {
    orgId: string;
    eventId: string;
    participantCount: number;
    expectedMatchCount: number;
    mode: CommerceMode;
    actorId: string;
  },
): Promise<void> {
  integer(input.participantCount, 'participantCount', 2, 32);
  integer(input.expectedMatchCount, 'expectedMatchCount', 1, 1024);
  if (
    (
      await c.query(
        'SELECT event_id FROM event_commercial_activations WHERE org_id=$1 AND event_id=$2',
        [input.orgId, input.eventId],
      )
    ).rowCount
  )
    return;
  let entitlementId: string | null = null;
  let membershipPeriodId: string | null = null;
  if (input.mode === 'ENFORCED') {
    const row = (
      await c.query<{ id: string; max_teams: number; max_matches: number }>(
        `SELECT e.id,e.max_teams,e.max_matches FROM event_entitlements e JOIN billing_orders o ON o.id=e.order_id WHERE e.org_id=$1 AND e.event_id=$2 AND e.revoked_at IS NULL AND e.valid_until>clock_timestamp() AND o.status='PAID' ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE OF e,o`,
        [input.orgId, input.eventId],
      )
    ).rows[0];
    if (row) {
      if (input.participantCount > row.max_teams || input.expectedMatchCount > row.max_matches)
        fail('EVENT_ENTITLEMENT_LIMIT', '参赛队数或整届预计场次超过该届套餐额度', 422);
      entitlementId = row.id;
    } else {
      // An existing event purchase must be explicitly resolved, never silently charged again.
      if (
        (
          await c.query(
            `SELECT id FROM billing_orders b WHERE b.org_id=$1 AND b.event_id=$2 AND
         (b.status IN('PENDING_PAYMENT','PAID','REFUND_PENDING') OR (b.status='EXPIRED' AND (b.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=b.id AND r.status='PENDING_REVIEW')))) LIMIT 1`,
            [input.orgId, input.eventId],
          )
        ).rowCount
      )
        fail(
          'EVENT_PURCHASE_REVIEW_REQUIRED',
          '该届已有待核对或未激活的按届订单，请先核对原购与退款，未扣会员额度',
        );
      await membershipMutex(c, input.orgId);
      const candidate = (
        await c.query<{ id: string; order_id: string }>(
          `SELECT p.id,p.order_id FROM software_membership_periods p JOIN billing_orders o ON o.org_id=p.org_id AND o.id=p.order_id
         WHERE p.org_id=$1 AND p.revoked_at IS NULL AND p.starts_at<=clock_timestamp() AND p.ends_at>clock_timestamp() AND o.status='PAID'
         AND NOT EXISTS(SELECT 1 FROM billing_refunds f WHERE f.order_id=o.id AND f.status<>'REJECTED') ORDER BY p.starts_at,p.id LIMIT 1`,
          [input.orgId],
        )
      ).rows[0];
      if (!candidate)
        fail('EVENT_ENTITLEMENT_REQUIRED', '首次发布赛程前需要该届有效软件权益或可用机构会员', 402);
      // Same lock order as membership payment/refund: order, then period. No new transaction.
      await c.query('SELECT id FROM billing_orders WHERE org_id=$1 AND id=$2 FOR UPDATE', [
        input.orgId,
        candidate.order_id,
      ]);
      const p = (
        await c.query<{
          id: string;
          max_teams: number;
          max_matches: number;
          event_limit: number;
          used_events: number;
          usable: boolean;
        }>(
          `SELECT p.*,
         (SELECT count(*)::integer FROM event_commercial_activations a WHERE a.membership_period_id=p.id) AS used_events,
         (p.revoked_at IS NULL AND p.starts_at<=clock_timestamp() AND p.ends_at>clock_timestamp() AND o.status='PAID'
          AND NOT EXISTS(SELECT 1 FROM billing_refunds f WHERE f.order_id=o.id AND f.status<>'REJECTED')) AS usable
         FROM software_membership_periods p JOIN billing_orders o ON o.org_id=p.org_id AND o.id=p.order_id
         WHERE p.org_id=$1 AND p.id=$2 FOR UPDATE OF p`,
          [input.orgId, candidate.id],
        )
      ).rows[0];
      if (!p?.usable)
        fail('MEMBERSHIP_UNAVAILABLE', '会员已到期或退款状态变化，请重新核对，未激活本届', 402);
      if (input.participantCount > p.max_teams || input.expectedMatchCount > p.max_matches)
        fail('MEMBERSHIP_EVENT_LIMIT', '本届整届规模超过会员每届额度，未扣减会员届数', 422);
      if (p.used_events >= p.event_limit)
        fail('MEMBERSHIP_QUOTA_EXHAUSTED', '会员本期届数额度已用尽，已激活赛事继续使用', 402);
      membershipPeriodId = p.id;
    }
  }
  await c.query(
    'INSERT INTO event_commercial_activations(event_id,org_id,source,entitlement_id,participant_count,expected_match_count,activated_by,membership_period_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      input.eventId,
      input.orgId,
      entitlementId ? 'PAID' : membershipPeriodId ? 'MEMBERSHIP' : 'UNMETERED',
      entitlementId,
      input.participantCount,
      input.expectedMatchCount,
      input.actorId,
      membershipPeriodId,
    ],
  );
  await c.query(
    "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'commerce.event.activated','event',$4,$5::jsonb)",
    [
      randomUUID(),
      input.orgId,
      input.actorId,
      input.eventId,
      JSON.stringify({
        source: entitlementId ? 'PAID' : membershipPeriodId ? 'MEMBERSHIP' : 'UNMETERED',
        entitlementId,
        membershipPeriodId,
        participantCount: input.participantCount,
        expectedMatchCount: input.expectedMatchCount,
      }),
    ],
  );
}

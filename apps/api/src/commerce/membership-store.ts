import type { PoolClient } from 'pg';
import { digest, fail } from './domain.js';
import type { SoftwareMembershipPlanData } from '../../../../packages/contracts/membership.js';
type Row = Record<string, any>;

export const membershipLockKey = (orgId: string) =>
  `scb-software-membership:${orgId.toLowerCase()}`;
export async function membershipMutex(c: PoolClient, orgId: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [membershipLockKey(orgId)]);
}

export function membershipPlanDto(p: Row): SoftwareMembershipPlanData {
  return {
    id: p.id,
    code: p.code,
    version: p.version,
    name: p.name,
    currency: 'CNY',
    amountFen: p.amount_fen,
    scope: 'ORG_MEMBERSHIP',
    tier: p.membership_tier,
    durationDays: p.valid_days,
    eventLimit: p.membership_events,
    maxTeams: p.max_teams,
    maxMatches: p.max_matches,
    available: p.available,
    catalogVersion: p.catalog_version,
    createdAt: new Date(p.created_at).toISOString(),
  };
}

/** Caller holds org SHARE then the member mutex. All eligibility facts, not bounded UI history. */
export async function membershipAdmission(c: PoolClient, orgId: string) {
  const now: Date = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  const periods = (
    await c.query<Row>(
      `SELECT p.*,o.status AS order_status,
    (SELECT count(*)::integer FROM event_commercial_activations a WHERE a.membership_period_id=p.id) AS used_events
    FROM software_membership_periods p JOIN billing_orders o ON o.org_id=p.org_id AND o.id=p.order_id
    WHERE p.org_id=$1 AND p.revoked_at IS NULL AND p.ends_at>$2 ORDER BY p.starts_at,p.id LIMIT 1001`,
      [orgId, now],
    )
  ).rows;
  const claims = (
    await c.query<Row>(
      `SELECT o.id,o.status,o.version,o.channel,o.expires_at,o.membership_previous_period_id,
    EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=o.id AND r.status='PENDING_REVIEW') AS receipt_pending,
    EXISTS(SELECT 1 FROM software_membership_periods p WHERE p.order_id=o.id) AS has_period
    FROM billing_orders o WHERE o.org_id=$1 AND o.target_kind='ORG_MEMBERSHIP' AND
    (o.status IN('PENDING_PAYMENT','REFUND_PENDING') OR
    (o.status='EXPIRED' AND (o.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=o.id AND r.status='PENDING_REVIEW'))) OR
    (o.status='PAID' AND NOT EXISTS(SELECT 1 FROM software_membership_periods p WHERE p.order_id=o.id)))
    ORDER BY o.id LIMIT 1001`,
      [orgId],
    )
  ).rows;
  if (periods.length > 1000 || claims.length > 1000)
    fail('MEMBERSHIP_ADMISSION_LIMIT', '会员待核对记录超过读取上限，请联系平台核对', 422);
  const expirable = claims.filter(
    (o) =>
      o.status === 'PENDING_PAYMENT' &&
      !o.channel &&
      !o.receipt_pending &&
      new Date(o.expires_at).getTime() <= now.getTime(),
  );
  const unresolved = claims.filter((o) => !expirable.includes(o));
  const membershipVersion = digest({
    periods: periods.map((p) => [
      p.id,
      p.order_id,
      p.order_status,
      p.tier,
      p.duration_days,
      p.event_limit,
      p.used_events,
      p.starts_at,
      p.ends_at,
    ]),
    claims: claims.map((o) => [
      o.id,
      o.status,
      o.version,
      o.channel,
      o.expires_at,
      o.membership_previous_period_id,
      o.receipt_pending,
      o.has_period,
    ]),
  });
  let previous: Row | null = null;
  let notice = '可选择本机构会员方案，核对后创建原商业订单；下单不代表付款成功。';
  let allowed = true;
  if (unresolved.length) {
    allowed = false;
    notice = '已有待核对付款或退款，请先处理原订单，不要重复购买。';
  } else if (periods.length) {
    const active = periods.find(
      (p) => p.order_status === 'PAID' && new Date(p.starts_at).getTime() <= now.getTime(),
    );
    if (!active || periods.length !== 1) {
      allowed = false;
      notice = '已存在下一购买期或待核对会员来源，请核对原订单与购买期。';
    } else if (new Date(active.ends_at).getTime() - now.getTime() > 30 * 86400_000) {
      allowed = false;
      notice = '当前会员有效；结束前30天内可手动购买同等级、同周期的下一期。';
    } else {
      const children = (
        await c.query<Row>(
          `SELECT id FROM billing_orders WHERE membership_previous_period_id=$1 AND NOT(id=ANY($2::uuid[])) AND
         (status IN('PENDING_PAYMENT','PAID','REFUND_PENDING') OR (status='EXPIRED' AND (channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=billing_orders.id AND r.status='PENDING_REVIEW')))) LIMIT 1`,
          [active.id, expirable.map((o) => o.id)],
        )
      ).rows;
      if (children.length) {
        allowed = false;
        notice = '下一期已有订单或已开通，请先核对原续费，不重复创建。';
      } else {
        previous = active;
        notice = `可手动续费同等级、同周期；下一期从${new Date(active.ends_at).toISOString()}开始，未到期不能借用下一期额度。`;
      }
    }
  }
  return { now, periods, claims, expirable, previous, allowed, notice, membershipVersion };
}

export async function membershipUsage(
  c: PoolClient,
  orderId: string,
): Promise<{ used: number; liveSuccessor: boolean }> {
  const result = (
    await c.query<{ used: number; live_successor: boolean }>(
      `SELECT
    (SELECT count(*)::integer FROM event_commercial_activations a JOIN software_membership_periods p ON p.id=a.membership_period_id WHERE p.order_id=$1) AS used,
    EXISTS(SELECT 1 FROM billing_orders b JOIN software_membership_periods p ON p.id=b.membership_previous_period_id WHERE p.order_id=$1 AND
      (b.status IN('PENDING_PAYMENT','PAID','REFUND_PENDING') OR (b.status='EXPIRED' AND (b.channel IS NOT NULL OR EXISTS(SELECT 1 FROM billing_payment_reviews r WHERE r.order_id=b.id AND r.status='PENDING_REVIEW'))))) AS live_successor`,
      [orderId],
    )
  ).rows[0]!;
  return { used: result.used, liveSuccessor: result.live_successor };
}

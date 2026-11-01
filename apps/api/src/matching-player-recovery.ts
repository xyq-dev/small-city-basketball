import type { PoolClient } from 'pg';
import type { Actor } from './service.js';
import { notFound } from './errors.js';
import { tradeId } from './trade-domain.js';
import { lockTradeSourceCalendar } from './trade-source-hooks.js';

/** A cancelled player need can reopen only after every appearance and money effect ends. */
export async function inspectMatchingPlayerEnded(c: PoolClient, actor: Actor, sourceId: string) {
  const ref = (
    await c.query('SELECT org_id,team_id,buyer_user_id FROM booking_orders WHERE id=$1', [
      tradeId(sourceId),
    ])
  ).rows[0];
  if (!ref) throw notFound();
  await lockTradeSourceCalendar(c, ref.org_id);
  if (
    ref.buyer_user_id !== actor.user.id &&
    !(
      await c.query(
        `SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'
     UNION SELECT 1 FROM organization_memberships WHERE org_id=$1 AND user_id=$3 AND status='ACTIVE' AND role IN('ORG_OWNER','ORG_ADMIN')`,
        [ref.org_id, ref.team_id, actor.user.id],
      )
    ).rowCount
  )
    throw notFound();
  await c.query('SELECT id FROM booking_orders WHERE id=$1 FOR UPDATE', [sourceId]);
  const appearances = (
    await c.query(
      'SELECT id,status,expires_at,clock_timestamp() AS db_now FROM booking_appearances WHERE order_id=$1 ORDER BY id FOR UPDATE',
      [sourceId],
    )
  ).rows;
  const orders = (
    await c.query(
      "SELECT id FROM trade_orders WHERE kind='PLAYER_APPEARANCE' AND source_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [appearances.map((x) => x.id)],
    )
  ).rows;
  let unresolvedMoney = false;
  for (const order of orders) {
    const facts = (
      await c.query(
        `SELECT
      COALESCE((SELECT sum(total_fen) FROM trade_payment_attempts WHERE order_id=$1 AND status='PAID'),0)::bigint AS paid,
      COALESCE((SELECT sum(amount_fen) FROM trade_refunds WHERE order_id=$1 AND status='SUCCEEDED'),0)::bigint AS refunded,
      EXISTS(SELECT 1 FROM trade_payment_attempts WHERE order_id=$1 AND status IN('DISPATCHING','UNKNOWN','NOTPAY')) OR
      EXISTS(SELECT 1 FROM trade_refunds WHERE order_id=$1 AND status NOT IN('SUCCEEDED','FAILED','REJECTED')) OR
      EXISTS(SELECT 1 FROM trade_settlements WHERE order_id=$1 AND status NOT IN('RETURNED','FAILED','REJECTED')) OR
      EXISTS(SELECT 1 FROM trade_deductions WHERE order_id=$1 AND status NOT IN('REVERSED','REJECTED')) OR
      EXISTS(SELECT 1 FROM trade_settlement_returns r JOIN trade_settlements s ON s.id=r.settlement_id WHERE s.order_id=$1 AND r.status NOT IN('SUCCEEDED','FAILED')) AS unresolved`,
        [order.id],
      )
    ).rows[0];
    unresolvedMoney ||= facts.unresolved || Number(facts.paid) !== Number(facts.refunded);
  }
  return {
    ended:
      appearances.length > 0 &&
      appearances.every(
        (x) =>
          ['DECLINED', 'CANCELLED', 'EXPIRED', 'COMPLETED'].includes(x.status) ||
          (x.status === 'REQUESTED' && new Date(x.expires_at) <= new Date(x.db_now)),
      ),
    completed: appearances.some((x) => x.status === 'COMPLETED'),
    unresolvedMoney,
    retainedCostFen: 0,
  };
}

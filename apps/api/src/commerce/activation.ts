import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CommerceMode } from '@small-city-basketball/contracts';
import { fail, integer } from './domain.js';
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
  if (input.mode === 'ENFORCED') {
    const row = (
      await c.query<{ id: string; max_teams: number; max_matches: number }>(
        `SELECT e.id,e.max_teams,e.max_matches FROM event_entitlements e JOIN billing_orders o ON o.id=e.order_id WHERE e.org_id=$1 AND e.event_id=$2 AND e.revoked_at IS NULL AND e.valid_until>clock_timestamp() AND o.status='PAID' ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE OF e,o`,
        [input.orgId, input.eventId],
      )
    ).rows[0];
    if (!row) fail('EVENT_ENTITLEMENT_REQUIRED', '首次发布赛程前需要该届有效软件权益', 402);
    if (input.participantCount > row.max_teams || input.expectedMatchCount > row.max_matches)
      fail('EVENT_ENTITLEMENT_LIMIT', '参赛队数或整届预计场次超过该届套餐额度', 422);
    entitlementId = row.id;
  }
  await c.query(
    'INSERT INTO event_commercial_activations(event_id,org_id,source,entitlement_id,participant_count,expected_match_count,activated_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      input.eventId,
      input.orgId,
      entitlementId ? 'PAID' : 'UNMETERED',
      entitlementId,
      input.participantCount,
      input.expectedMatchCount,
      input.actorId,
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
        source: entitlementId ? 'PAID' : 'UNMETERED',
        entitlementId,
        participantCount: input.participantCount,
        expectedMatchCount: input.expectedMatchCount,
      }),
    ],
  );
}

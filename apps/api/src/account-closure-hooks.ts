import type { PoolClient } from 'pg';
import { ACCOUNT_CLOSURE_DOMAINS, closureBlockers } from './account-closure-domain.js';
import type { AccountClosureHooks } from './account-closure-service.js';

type Inspect = (c: PoolClient, userId: string) => Promise<readonly { code: string }[]>;
type Revoke = (c: PoolClient, userId: string) => Promise<unknown>;
/** Root supplies the real domain helpers. A missing module never means an empty domain. */
export interface AccountClosureDependencies {
  streaming: { inspect: Inspect; revoke: Revoke };
  insurance: { inspect: Inspect; revoke: Revoke };
  trade: { assertSafe: Revoke };
  notifications: { revoke: Revoke };
  guardians: { revoke: Revoke };
}
function busy(): never {
  const error = new Error('Closure resource busy') as Error & { code: string };
  error.code = '55P03';
  throw error;
}
async function tryKey(c: PoolClient, key: string) {
  const r = await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [
    key,
  ]);
  if (!r.rows[0]?.acquired) busy();
}
/** User UPDATE is already held. Never wait for another user's legacy event/calendar path. */
async function lockCoreScopes(c: PoolClient, userId: string) {
  const orgs = (
    await c.query(
      `SELECT org_id FROM organization_memberships WHERE user_id=$1
    UNION SELECT org_id FROM team_access_grants WHERE user_id=$1
    UNION SELECT org_id FROM team_member_bindings WHERE user_id=$1
    UNION SELECT org_id FROM event_staff WHERE user_id=$1
    UNION SELECT org_id FROM match_staff WHERE user_id=$1
    UNION SELECT org_id FROM participant_materials WHERE user_id=$1
    UNION SELECT s.org_id FROM public_archive_sources s LEFT JOIN public_archive_profiles p ON p.id=s.profile_id
      WHERE s.target_user_id=$1 OR s.consented_by=$1 OR s.nominated_by=$1 OR p.owner_user_id=$1
    UNION SELECT org_id FROM public_archive_profiles WHERE owner_user_id=$1 AND org_id IS NOT NULL
    UNION SELECT org_id FROM billing_orders WHERE created_by=$1
    UNION SELECT org_id FROM booking_orders WHERE buyer_user_id=$1
    UNION SELECT o.org_id FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.player_user_id=$1
    UNION SELECT org_id FROM local_bookings WHERE buyer_user_id=$1 OR provider_user_id=$1
    UNION SELECT org_id FROM local_listings WHERE provider_user_id=$1
    UNION SELECT home_org_id FROM local_matchups WHERE created_by=$1 OR home_confirmed_by=$1 OR away_confirmed_by=$1
    UNION SELECT away_org_id FROM local_matchups WHERE created_by=$1 OR home_confirmed_by=$1 OR away_confirmed_by=$1
    UNION SELECT org_id FROM governance_cases WHERE requester_id=$1 OR assigned_to=$1
    ORDER BY org_id`,
      [userId],
    )
  ).rows.map((r) => r.org_id as string);
  await c.query(
    'SELECT id FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE NOWAIT',
    [orgs],
  );
  await c.query(
    'SELECT org_id FROM org_schedule_mutex WHERE org_id=ANY($1::uuid[]) ORDER BY org_id FOR UPDATE NOWAIT',
    [orgs],
  );
  const calendar = await c.query('SELECT pg_try_advisory_xact_lock(20261031,12029) AS acquired');
  if (!calendar.rows[0]?.acquired) busy();
  const profiles = (
    await c.query('SELECT id FROM booking_profiles WHERE user_id=$1 ORDER BY id', [userId])
  ).rows;
  for (const profile of profiles) await tryKey(c, `scb-booking-player:${profile.id}`);
  const events = (
    await c.query(
      `SELECT org_id,event_id FROM event_staff WHERE user_id=$1
    UNION SELECT org_id,event_id FROM match_staff WHERE user_id=$1
    UNION SELECT org_id,event_id FROM participant_materials WHERE user_id=$1
    UNION SELECT n.org_id,n.event_id FROM team_member_bindings b JOIN entries n ON n.org_id=b.org_id AND n.team_id=b.team_id WHERE b.user_id=$1
    UNION SELECT s.org_id,s.event_id FROM public_archive_sources s JOIN public_archive_profiles p ON p.id=s.profile_id
      WHERE s.target_user_id=$1 OR s.consented_by=$1 OR s.nominated_by=$1 OR p.owner_user_id=$1
    UNION SELECT org_id,event_id FROM billing_orders WHERE created_by=$1
    UNION SELECT org_id,event_id FROM booking_orders WHERE buyer_user_id=$1
    UNION SELECT o.org_id,o.event_id FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.player_user_id=$1
    ORDER BY org_id,event_id`,
      [userId],
    )
  ).rows;
  for (const event of events)
    await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE NOWAIT', [
      event.org_id,
      event.event_id,
    ]);
  await tryKey(c, `notification-settings:${userId}`);
}
export function createAccountClosureHooks(
  dependencies: AccountClosureDependencies,
): AccountClosureHooks | undefined {
  if (
    !dependencies ||
    [
      dependencies.streaming?.inspect,
      dependencies.streaming?.revoke,
      dependencies.insurance?.inspect,
      dependencies.insurance?.revoke,
      dependencies.trade?.assertSafe,
      dependencies.notifications?.revoke,
      dependencies.guardians?.revoke,
    ].some((fn) => typeof fn !== 'function')
  )
    return undefined;
  return {
    domains: ACCOUNT_CLOSURE_DOMAINS,
    async lockAndInspect(c, userId) {
      await lockCoreScopes(c, userId);
      const blockers = [
        ...(await dependencies.streaming.inspect(c, userId)).map((b) => b.code),
        ...(await dependencies.insurance.inspect(c, userId)).map((b) => b.code),
      ];
      try {
        await dependencies.trade.assertSafe(c, userId);
      } catch (error) {
        if ((error as { code?: string }).code !== 'TRADE_MONEY_UNRESOLVED') throw error;
        blockers.push('TRADE_MONEY_UNRESOLVED');
      }
      return closureBlockers([...new Set(blockers)]);
    },
    async revoke(c, userId) {
      await dependencies.streaming.revoke(c, userId);
      await dependencies.insurance.revoke(c, userId);
      await dependencies.notifications.revoke(c, userId);
      await dependencies.guardians.revoke(c, userId);
      // This is a monotonic withdrawal, keyless even after roster freeze. Ciphertext and
      // immutable registration snapshots remain governed by retention/legal_hold.
      await c.query(
        `UPDATE participant_materials SET publicity_consent=false,version=version+1,
        updated_at=clock_timestamp() WHERE user_id=$1 AND publicity_consent`,
        [userId],
      );
    },
  };
}

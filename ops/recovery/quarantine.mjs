import { randomBytes, randomUUID } from 'node:crypto';
import { assertOwnedRestoreTarget, isMain, loadRestoreTarget, runAsCli } from '../db/common.mjs';
import { loadManifest } from '../db/privileges.mjs';
import { quoteIdentifier } from '../db/common.mjs';

const REASON = 'ISOLATED_RESTORE_QUARANTINE';
// Kept byte-for-byte with the domain contract; tested without importing API runtime modules.
const ADULT_DATA_CONSENTS_WITHDRAW_SQL = `WITH latest AS MATERIALIZED (
 SELECT DISTINCT ON(actor_id,org_id,event_id,entry_id,member_id) * FROM youth_adult_data_consents
 ORDER BY actor_id,org_id,event_id,entry_id,member_id,version DESC
) INSERT INTO youth_adult_data_consents(id,actor_id,performed_by,client_request_id,org_id,event_id,team_id,entry_id,member_id,binding_id,material_id,material_revision_id,age_evidence_qualification_id,policy_version,terms_version,material_version,version,decision,cause)
 SELECT gen_random_uuid(),actor_id,$1::uuid,gen_random_uuid(),org_id,event_id,team_id,entry_id,member_id,binding_id,material_id,material_revision_id,age_evidence_qualification_id,policy_version,terms_version,material_version,version+1,'WITHDRAW','RESTORE_QUARANTINE' FROM latest WHERE decision='CONSENT' RETURNING id`;
// Explicit minimum for the newly added writers, even when an older manifest is supplied.
// The full current manifest still locks every source/history table before any mutation.
const EXPANSION_TABLES = [
  'live_channel_accounts',
  'broadcast_sessions',
  'live_relays',
  'stream_jobs',
  'live_media_jobs',
  'live_media_artifacts',
  'insurance_products',
  'insurance_orders',
  'insurance_operations',
  'trade_terms',
  'trade_orders',
  'trade_payment_attempts',
  'trade_refunds',
  'trade_settlements',
  'trade_settlement_returns',
  'notification_subscription_intents',
  'notification_subscription_grants',
  'notification_deliveries',
  'notification_delivery_attempts',
  'account_closure_requests',
  'youth_guardian_requests',
  'youth_guardian_preconsents',
  'youth_guardian_history',
  'youth_preconsent_history',
  'youth_adult_data_consents',
];

/** Close restored credentials only in a newly created, receipt-owned restore database. */
export async function quarantineRestoredDatabase({ pool, ownership }) {
  let client;
  try {
    await assertOwnedRestoreTarget(pool, ownership);
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE scb_migrator');
    await assertOwnedRestoreTarget(client, ownership);
    await client.query("SET LOCAL lock_timeout = '15s'");
    // This is an offline restore operation: writers must already be stopped. Do not
    // wait while holding only some table locks: an in-flight authenticated request
    // locks sessions/users before organizations and could otherwise form a lock cycle.
    // NOWAIT rejects and rolls back the entire operation before any revocation. The
    // operator may retry after draining writers; quarantine never retries automatically.
    const manifest = await loadManifest();
    const first = ['organizations', 'events', 'users', 'sessions'];
    const tables = [
      ...first,
      ...[...new Set([...Object.keys(manifest.tables), ...EXPANSION_TABLES])]
        .sort()
        .filter((table) => !first.includes(table)),
    ];
    await client.query(
      `LOCK TABLE ${tables.map(quoteIdentifier).join(', ')} IN EXCLUSIVE MODE NOWAIT`,
    );
    const now = (await client.query('SELECT clock_timestamp()::text AS now')).rows[0].now;
    const systemUserId = randomUUID();
    // This is deliberately not a password hash accepted by verifyPassword.
    // The random sentinel satisfies 001's storage bound and never represents
    // a usable login credential, even if someone later changes user status.
    const sentinel = `!SCB_DISABLED_RESTORE_ACTOR!${randomBytes(64).toString('base64url')}`;
    await client.query(
      `INSERT INTO users(id,email,display_name,password_hash,status,created_at,updated_at)
       VALUES($1,$2,'恢复隔离系统主体',$3,'DISABLED',$4::timestamptz,$4::timestamptz)`,
      [systemUserId, `restore-quarantine-${systemUserId}@system.invalid`, sentinel, now],
    );
    const sessions = await client.query(
      'UPDATE sessions SET revoked_at=$1::timestamptz WHERE revoked_at IS NULL',
      [now],
    );
    const operators = await client.query(
      "UPDATE platform_operators SET status='DISABLED',updated_at=$1::timestamptz WHERE status='ACTIVE'",
      [now],
    );
    const wechatIdentities = await client.query(
      "UPDATE wechat_identities SET status='REVOKED',version=version+1,updated_at=$1::timestamptz,revoked_at=$1::timestamptz WHERE status='ACTIVE'",
      [now],
    );
    const wechatAttempts = await client.query('DELETE FROM wechat_auth_attempts');
    const invitations = await client.query(
      `UPDATE team_invitations SET revoked_at=$1::timestamptz
       WHERE accepted_at IS NULL AND revoked_at IS NULL`,
      [now],
    );
    // C19 bearer credentials: share links and join codes are usable by whoever holds the
    // token, and a pending claim admits its target. None may survive into a restored copy.
    const requestLinks = await client.query(
      `UPDATE team_request_links SET revoked_at=$1::timestamptz,revoked_by=$2,revoke_reason=$3
       WHERE revoked_at IS NULL`,
      [now, systemUserId, '恢复隔离统一撤销'],
    );
    const joinCodes = await client.query(
      `UPDATE team_join_codes SET revoked_at=$1::timestamptz,revoked_by=$2 WHERE revoked_at IS NULL`,
      [now, systemUserId],
    );
    const memberClaims = await client.query(
      `UPDATE team_member_claims SET status='REVOKED',decided_at=$1::timestamptz WHERE status='PENDING'`,
      [now],
    );
    // Close every unfinished upload; keep receipts and completed files. Use transaction
    // time for the terminal state to match the upload guard's expiry boundary.
    const uploadSessions = await client.query(
      `UPDATE media_upload_sessions SET
       status=CASE WHEN expires_at<=now() THEN 'EXPIRED' ELSE 'CANCELLED' END,
       version=version+1,closed_at=$1::timestamptz,closed_by=$2 WHERE status='OPEN'`,
      [now, systemUserId],
    );
    const uploadChunks = await client.query(
      `UPDATE media_upload_chunks SET payload=NULL,released_at=$1::timestamptz
       WHERE released_at IS NULL`,
      [now],
    );
    // Re-enabling an organization after a restore must never revive prior consent.
    const seasonGrants = await client.query(
      `UPDATE season_data_grants SET status='WITHDRAWN',version=version+1,
       withdrawn_by=$2,withdrawn_at=$1::timestamptz,withdraw_reason=$3,
       updated_at=$1::timestamptz WHERE status IN ('PENDING','ACTIVE')`,
      [now, systemUserId, '恢复隔离撤回私有赛季授权'],
    );
    const participantConsents = await client.query(
      `UPDATE participant_materials SET publicity_consent=false,version=version+1,updated_at=$1::timestamptz WHERE publicity_consent`,
      [now],
    );
    // Independent new public purposes are all permanently closed. Immutable receipts,
    // nominations, private reports and confirmed sporting decisions remain untouched.
    const recruitment = await client.query(
      `UPDATE recruitment_publications SET status='REVOKED',version=version+1,revoked_at=$1::timestamptz,revoked_by=$2,revoke_reason=$3 WHERE status='ACTIVE' RETURNING event_id`,
      [now, systemUserId, '恢复隔离撤销赛事招募'],
    );
    const eventInvitations = await client.query(
      `UPDATE event_invitations SET status='REVOKED',version=version+1,decided_at=$1::timestamptz WHERE status='PENDING'`,
      [now],
    );
    const posters = await client.query(
      `UPDATE poster_exports SET revoked_at=$1::timestamptz,revoked_by=$2,revoke_reason=$3 WHERE revoked_at IS NULL RETURNING event_id`,
      [now, systemUserId, '恢复隔离撤销海报导出'],
    );
    const archivePublications = await client.query(
      `UPDATE public_archive_publications SET status='REVOKED',revoked_at=$1::timestamptz WHERE status='ACTIVE'`,
      [now],
    );
    const archiveProfiles = await client.query(
      `UPDATE public_archive_profiles SET status='REVOKED',public_key=NULL,version=version+1,updated_at=$1::timestamptz WHERE status='PUBLISHED'`,
      [now],
    );
    const archiveSources = await client.query(
      `UPDATE public_archive_sources SET status='REVOKED',revoked_at=$1::timestamptz,revoke_reason=$2,version=version+1 WHERE status IN ('PENDING','APPROVED')`,
      [now, '恢复隔离撤销公开档案授权'],
    );
    const cities = await client.query(
      `UPDATE city_operation_grants SET status='REVOKED',version=version+1,revoked_at=$1::timestamptz,revoked_by=$2,revoke_reason=$3 WHERE status='ACTIVE'`,
      [now, systemUserId, '恢复隔离撤销城市运营授权'],
    );
    const advertisements = await client.query(
      `UPDATE sponsorship_publications SET revoked_at=$1::timestamptz,revoked_by=$2,revoke_reason=$3 WHERE revoked_at IS NULL`,
      [now, systemUserId, '恢复隔离撤销赞助公开授权'],
    );
    const campaigns = await client.query(
      `UPDATE sponsorship_campaigns SET status='WITHDRAWN',version=version+1,updated_at=$1::timestamptz WHERE status<>'WITHDRAWN'`,
      [now],
    );
    const ledgerPublications = await client.query(
      `UPDATE public_ledger_publications SET revoked_at=$1::timestamptz,revoked_by=$2,revoke_reason=$3 WHERE revoked_at IS NULL`,
      [now, systemUserId, '恢复隔离撤销经费公示授权'],
    );
    const ledgerAccounts = await client.query(
      `UPDATE public_ledger_accounts SET status='CLOSED',version=version+1 WHERE status='ACTIVE'`,
    );
    const reviews = await client.query(
      `UPDATE governance_reviews SET status='WITHDRAWN',version=version+1,review_reason=$2,updated_at=$1::timestamptz WHERE status<>'WITHDRAWN'`,
      [now, '恢复隔离撤回评价公开授权'],
    );
    // Expire both pending and used bearer actions; retain their permanent original-ID
    // tombstones. No restored encrypted envelope may be retried by a future mail worker.
    const accountTokens = await client.query(
      `UPDATE account_action_tokens SET revoked_at=$1::timestamptz WHERE revoked_at IS NULL`,
      [now],
    );
    const accountJobs = await client.query(
      `UPDATE account_mail_jobs SET status=CASE WHEN status='SENDING' THEN 'UNKNOWN' WHEN status IN ('PENDING','FAILED') THEN 'EXPIRED' ELSE status END,envelope=NULL,lease_id=NULL,lease_until=NULL,updated_at=$1::timestamptz WHERE status IN ('PENDING','SENDING','UNKNOWN','FAILED') OR envelope IS NOT NULL`,
      [now],
    );
    // These updates revoke authorization, not physical observations. A restored stream
    // can still be live externally: source_stopped/slot_held/provider IDs are never cleared.
    // createApi's permanent RESTORE_QUARANTINE restore audit marker disables all old/new
    // providers and workers after restart. State updates alone cannot prevent enforce()
    // from creating another cleanup job, and are never described as an external stop.
    const liveChannels = await client.query(
      `UPDATE live_channel_accounts SET revoked_at=$1::timestamptz,version=version+1 WHERE revoked_at IS NULL`,
      [now],
    );
    const broadcasts = await client.query(
      `UPDATE broadcast_sessions SET desired='STOPPED',observed=CASE WHEN observed='ENDED' THEN observed ELSE 'UNKNOWN' END,
       rights_revoked_at=COALESCE(rights_revoked_at,$1::timestamptz),source_token_hash=NULL,source_expires_at=NULL,
       epoch=epoch+1,source_epoch=source_epoch+1,version=version+1,updated_at=$1::timestamptz`,
      [now],
    );
    const relays = await client.query(
      `UPDATE live_relays SET desired='STOPPED',state=CASE WHEN slot_held OR state IN('STARTING','CONNECTED','STOPPING','UNKNOWN') THEN 'UNKNOWN' ELSE state END,
       epoch=epoch+1,worker_token=NULL,worker_until=NULL,error_code=$1`,
      [REASON],
    );
    const streamJobs = await client.query(
      `UPDATE stream_jobs SET state='UNKNOWN',lease_token=NULL,lease_until=NULL,next_attempt_at='infinity'::timestamptz,error_code=$1
       WHERE state IN('PENDING','RUNNING','UNKNOWN')`,
      [REASON],
    );
    const mediaJobs = await client.query(
      `UPDATE live_media_jobs SET status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,
       cancel_requested_at=COALESCE(cancel_requested_at,$1::timestamptz),worker_token=NULL,worker_until=NULL,
       error_code=CASE WHEN status='RUNNING' THEN 'RESTORE_RESULT_UNKNOWN' ELSE $2 END,version=version+1 WHERE status IN('QUEUED','RUNNING')`,
      [now, REASON],
    );
    const mediaArtifacts = await client.query(
      `UPDATE live_media_artifacts SET public_key=NULL,revoked_at=COALESCE(revoked_at,$1::timestamptz),version=version+1 WHERE revoked_at IS NULL OR public_key IS NOT NULL`,
      [now],
    );
    const insuranceProducts = await client.query(
      `UPDATE insurance_products SET active=false WHERE active`,
    );
    const insuranceOrders = await client.query(
      `UPDATE insurance_orders SET authorization_valid=false,version=version+1,updated_at=$1::timestamptz WHERE authorization_valid`,
      [now],
    );
    const insuranceOperations = await client.query(
      `UPDATE insurance_operations SET status='UNKNOWN',reconcile_only=true,fence=fence+1,lease_id=NULL,lease_until=NULL,
       next_attempt_at='infinity'::timestamptz,updated_at=$1::timestamptz WHERE status IN('PENDING','RUNNING','UNKNOWN')`,
      [now],
    );
    const tradeTerms = await client.query(
      `UPDATE trade_terms SET status='REVOKED',version=version+1 WHERE status='ACTIVE'`,
    );
    const tradeOrders = await client.query(
      `UPDATE trade_orders SET status='SOURCE_CONFLICT',version=version+1,updated_at=$1::timestamptz WHERE status='OPEN'`,
      [now],
    );
    const tradePayments = await client.query(
      `UPDATE trade_payment_attempts SET status=CASE WHEN status IN('DISPATCHING','NOTPAY') THEN 'UNKNOWN' ELSE status END,
       checkout=NULL,fence=$2,updated_at=$1::timestamptz WHERE status IN('DISPATCHING','NOTPAY','UNKNOWN') OR checkout IS NOT NULL`,
      [now, randomUUID()],
    );
    const tradeRefunds = await client.query(
      `UPDATE trade_refunds SET status='UNKNOWN',fence=$2,updated_at=$1::timestamptz WHERE status='SENDING'`,
      [now, randomUUID()],
    );
    const tradeSettlements = await client.query(
      `UPDATE trade_settlements SET status=CASE WHEN status='RETURNING' THEN 'RETURN_UNKNOWN' ELSE 'UNKNOWN' END,
       fence=$2,updated_at=$1::timestamptz WHERE status IN('SENDING','RETURNING')`,
      [now, randomUUID()],
    );
    const tradeReturns = await client.query(
      `UPDATE trade_settlement_returns SET status='UNKNOWN',fence=$2,updated_at=$1::timestamptz WHERE status='SENDING'`,
      [now, randomUUID()],
    );
    const notificationIntents = await client.query(
      `SELECT id,confirm_request_id FROM notification_subscription_intents WHERE status IN('PENDING','CLAIMED')`,
    );
    for (const intent of notificationIntents.rows)
      await client.query(
        `UPDATE notification_subscription_intents SET status='FAILED',confirm_request_id=$2,finished_at=$3::timestamptz WHERE id=$1`,
        [intent.id, intent.confirm_request_id ?? randomUUID(), now],
      );
    const notificationGrants = await client.query(
      `UPDATE notification_subscription_grants SET status='REVOKED',target_cipher=NULL,revoked_at=$1::timestamptz WHERE status<>'REVOKED'`,
      [now],
    );
    const notificationAttempts = await client.query(
      `UPDATE notification_delivery_attempts SET state='UNKNOWN',finished_at=$1::timestamptz WHERE state='SENDING'`,
      [now],
    );
    const notificationDeliveries = await client.query(
      `UPDATE notification_deliveries SET state=CASE WHEN state='SENDING' THEN 'UNKNOWN' ELSE 'CANCELLED' END,
       lease_id=NULL,lease_until=NULL,last_reason='IDENTITY_UNAVAILABLE',updated_at=$1::timestamptz WHERE state IN('WAITING_PERMISSION','PENDING','SENDING')`,
      [now],
    );
    const closureRequests = await client.query(
      `UPDATE account_closure_requests SET status='EXPIRED_AUTH',version=version+1,fence=fence+1,lease_id=NULL,lease_until=NULL,
       finished_at=$1::timestamptz,updated_at=$1::timestamptz WHERE status IN('PENDING','BLOCKED')`,
      [now],
    );
    const guardians = await client.query(
      `UPDATE youth_guardian_requests SET status='WITHDRAWN',version=version+1,updated_at=$1::timestamptz WHERE status<>'WITHDRAWN' RETURNING id,version`,
      [now],
    );
    for (const r of guardians.rows)
      await client.query(
        `INSERT INTO youth_guardian_history(id,request_id,version,actor_id,action,facts) VALUES($1,$2,$3,$4,'WITHDRAW',$5::jsonb)`,
        [randomUUID(), r.id, r.version, systemUserId, JSON.stringify({ reason: REASON })],
      );
    const preconsents = await client.query(
      `UPDATE youth_guardian_preconsents SET status='WITHDRAWN',version=version+1,updated_at=$1::timestamptz WHERE status<>'WITHDRAWN' RETURNING id,version`,
      [now],
    );
    for (const r of preconsents.rows)
      await client.query(
        `INSERT INTO youth_preconsent_history(id,preconsent_id,version,actor_id,action) VALUES($1,$2,$3,$4,'WITHDRAW')`,
        [randomUUID(), r.id, r.version, systemUserId],
      );
    const adultDataConsents = await client.query(ADULT_DATA_CONSENTS_WITHDRAW_SQL, [systemUserId]);
    const localListings = await client.query(
      `UPDATE local_listings SET status='SUSPENDED',published=false,version=version+1,updated_at=$1::timestamptz WHERE status<>'SUSPENDED' OR published`,
      [now],
    );
    const localSlots = await client.query(
      `UPDATE local_slots SET status='CLOSED',reason=$1,version=version+1 WHERE status='OPEN'`,
      ['恢复隔离关闭可预约时段'],
    );
    const localBookings = await client.query(
      `UPDATE local_bookings SET status=CASE WHEN status IN ('ARRIVED','DELIVERED','DISPUTED') THEN 'DISPUTED' ELSE 'CANCELLED' END,change_request=NULL,checkin_hash=NULL,checkin_expires_at=NULL,reason=$2,version=version+1,updated_at=$1::timestamptz WHERE status IN ('HELD','REQUESTED','CONFIRMED','ARRIVED','DELIVERED') OR (status='DISPUTED' AND (change_request IS NOT NULL OR checkin_hash IS NOT NULL OR checkin_expires_at IS NOT NULL))`,
      [now, '恢复隔离取消未履约预约或转争议'],
    );
    const localMatchups = await client.query(
      `UPDATE local_matchups SET status='CANCELLED',reason=$2,version=version+1,updated_at=$1::timestamptz WHERE status IN ('OPEN','CONFIRMED')`,
      [now, '恢复隔离取消双方约赛'],
    );
    const localReservations = await client.query(
      `UPDATE local_resource_reservations SET active=false WHERE active`,
    );
    if (
      (
        await client.query(
          `SELECT 1 FROM local_bookings WHERE checkin_hash IS NOT NULL OR checkin_expires_at IS NOT NULL LIMIT 1`,
        )
      ).rowCount
    )
      throw new Error();
    const publicGrants = await client.query(
      `UPDATE public_event_publications SET revoked_at=$1::timestamptz,revoked_by=$2
       WHERE revoked_at IS NULL RETURNING event_id`,
      [now, systemUserId],
    );
    const overlayGrants = await client.query(
      `UPDATE overlay_grants SET version=2,revoked_at=$1::timestamptz,revocation_reason=$2
       WHERE revoked_at IS NULL AND version=1 RETURNING event_id`,
      [now, REASON],
    );
    // Keep every identity and fencing counter, including expired bindings.
    // An unacquired row has NULL identity/expiry and fence zero: do not touch it.
    const leases = await client.query(
      `UPDATE scoring_leases SET expires_at=$1::timestamptz
       WHERE lease_id IS NOT NULL AND expires_at>$1::timestamptz RETURNING event_id`,
      [now],
    );
    const organizations = await client.query(
      `UPDATE organizations SET status='DISABLED',updated_at=$1::timestamptz
       WHERE status<>'DISABLED' RETURNING id`,
      [now],
    );
    const affectedEvents = [
      ...new Set(
        [
          ...publicGrants.rows,
          ...overlayGrants.rows,
          ...leases.rows,
          ...recruitment.rows,
          ...posters.rows,
        ].map((row) => row.event_id),
      ),
    ];
    const events = await client.query(
      `UPDATE events SET version=version+1,updated_at=$1::timestamptz
       WHERE org_id=ANY($2::uuid[]) OR id=ANY($3::uuid[]) RETURNING id,org_id,version`,
      [now, organizations.rows.map((row) => row.id), affectedEvents],
    );
    const counts = {
      sessionsRevoked: sessions.rowCount,
      platformOperatorsDisabled: operators.rowCount,
      wechatIdentitiesRevoked: wechatIdentities.rowCount,
      wechatChallengesRemoved: wechatAttempts.rowCount,
      pendingInvitationsRevoked: invitations.rowCount,
      teamRequestLinksRevoked: requestLinks.rowCount,
      teamJoinCodesRevoked: joinCodes.rowCount,
      pendingMemberClaimsRevoked: memberClaims.rowCount,
      uploadSessionsClosed: uploadSessions.rowCount,
      uploadChunksReleased: uploadChunks.rowCount,
      seasonDataGrantsWithdrawn: seasonGrants.rowCount,
      participantPublicityConsentsWithdrawn: participantConsents.rowCount,
      recruitmentPublicationsRevoked: recruitment.rowCount,
      eventInvitationsRevoked: eventInvitations.rowCount,
      posterExportsRevoked: posters.rowCount,
      archivePublicationsRevoked: archivePublications.rowCount,
      archiveProfilesRevoked: archiveProfiles.rowCount,
      archiveSourcesRevoked: archiveSources.rowCount,
      cityOperationGrantsRevoked: cities.rowCount,
      sponsorshipPublicationsRevoked: advertisements.rowCount,
      sponsorshipCampaignsWithdrawn: campaigns.rowCount,
      ledgerPublicationsRevoked: ledgerPublications.rowCount,
      ledgerAccountsClosed: ledgerAccounts.rowCount,
      governanceReviewsWithdrawn: reviews.rowCount,
      accountActionTokensRevoked: accountTokens.rowCount,
      accountMailJobsQuarantined: accountJobs.rowCount,
      liveChannelsRevoked: liveChannels.rowCount,
      broadcastsQuarantined: broadcasts.rowCount,
      relayIntentsQuarantined: relays.rowCount,
      streamJobsQuarantined: streamJobs.rowCount,
      mediaJobsQuarantined: mediaJobs.rowCount,
      mediaPublicationsRevoked: mediaArtifacts.rowCount,
      insuranceProductsDisabled: insuranceProducts.rowCount,
      insuranceAuthorizationsRevoked: insuranceOrders.rowCount,
      insuranceOperationsQuarantined: insuranceOperations.rowCount,
      tradeTermsRevoked: tradeTerms.rowCount,
      tradeSourcesConflicted: tradeOrders.rowCount,
      tradePaymentObservationsQuarantined: tradePayments.rowCount,
      tradeRefundDispatchesUnknown: tradeRefunds.rowCount,
      tradeSettlementsUnknown: tradeSettlements.rowCount,
      tradeReturnsUnknown: tradeReturns.rowCount,
      notificationIntentsClosed: notificationIntents.rowCount,
      notificationGrantsRevoked: notificationGrants.rowCount,
      notificationAttemptsUnknown: notificationAttempts.rowCount,
      notificationDeliveriesQuarantined: notificationDeliveries.rowCount,
      closureAuthorizationsExpired: closureRequests.rowCount,
      guardianConsentsWithdrawn: guardians.rowCount,
      guardianDataConsentsWithdrawn: preconsents.rowCount,
      adultDataConsentsWithdrawn: adultDataConsents.rowCount,
      localListingsSuspended: localListings.rowCount,
      localSlotsClosed: localSlots.rowCount,
      localBookingsQuarantined: localBookings.rowCount,
      localMatchupsCancelled: localMatchups.rowCount,
      localReservationsReleased: localReservations.rowCount,
      publicPublicationsRevoked: publicGrants.rowCount,
      overlayGrantsRevoked: overlayGrants.rowCount,
      activeLeasesExpired: leases.rowCount,
      organizationsDisabled: organizations.rowCount,
      eventsTouched: events.rowCount,
    };
    for (const event of events.rows) {
      await client.query(
        `INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata,created_at)
         VALUES($1,$2,$3,'RESTORE_QUARANTINE','event',$4,$5::jsonb,$6::timestamptz)`,
        [
          randomUUID(),
          event.org_id,
          systemUserId,
          event.id,
          JSON.stringify({ previousVersion: event.version - 1, currentVersion: event.version }),
          now,
        ],
      );
    }
    await client.query(
      `INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata,created_at)
       VALUES($1,NULL,$2,'RESTORE_QUARANTINE','restore',$2,$3::jsonb,$4::timestamptz)`,
      [randomUUID(), systemUserId, JSON.stringify(counts), now],
    );
    await client.query('COMMIT');
    return { status: 'quarantined', systemUserId, counts };
  } catch {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Never let cleanup errors expose connection credentials or row details.
      }
    }
    throw new Error('Restore quarantine failed');
  } finally {
    client?.release();
  }
}

if (isMain(import.meta.url)) {
  await runAsCli('quarantine', async () => {
    const target = await loadRestoreTarget();
    try {
      return await quarantineRestoredDatabase(target);
    } finally {
      await target.close();
    }
  });
}

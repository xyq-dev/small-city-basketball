import { randomBytes, randomUUID } from 'node:crypto';
import { assertOwnedRestoreTarget, isMain, loadRestoreTarget, runAsCli } from '../db/common.mjs';
import { loadManifest } from '../db/privileges.mjs';
import { quoteIdentifier } from '../db/common.mjs';

const REASON = 'ISOLATED_RESTORE_QUARANTINE';

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
      ...Object.keys(manifest.tables)
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
      `UPDATE account_mail_jobs SET status='EXPIRED',envelope=NULL,lease_id=NULL,lease_until=NULL,updated_at=$1::timestamptz WHERE status IN ('PENDING','SENDING','UNKNOWN','FAILED') OR envelope IS NOT NULL`,
      [now],
    );
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
      accountMailJobsExpired: accountJobs.rowCount,
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

import { randomBytes, randomUUID } from 'node:crypto';
import { assertOwnedRestoreTarget, isMain, loadRestoreTarget, runAsCli } from '../db/common.mjs';

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
    // This is an offline restore operation. Drain in-flight row-locking readers
    // and writers before choosing the single time used by all revocations.
    await client.query(`LOCK TABLE organizations, events, users, sessions,
      team_invitations, public_event_publications, overlay_grants, scoring_leases
      IN EXCLUSIVE MODE`);
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
    const invitations = await client.query(
      `UPDATE team_invitations SET revoked_at=$1::timestamptz
       WHERE accepted_at IS NULL AND revoked_at IS NULL`,
      [now],
    );
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
        [...publicGrants.rows, ...overlayGrants.rows, ...leases.rows].map((row) => row.event_id),
      ),
    ];
    const events = await client.query(
      `UPDATE events SET version=version+1,updated_at=$1::timestamptz
       WHERE org_id=ANY($2::uuid[]) OR id=ANY($3::uuid[]) RETURNING id,org_id,version`,
      [now, organizations.rows.map((row) => row.id), affectedEvents],
    );
    const counts = {
      sessionsRevoked: sessions.rowCount,
      pendingInvitationsRevoked: invitations.rowCount,
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

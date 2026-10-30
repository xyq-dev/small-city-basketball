import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isMain, parseDatabaseUrl, readSecretEnv, runAsCli } from './common.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One explicitly scoped manual batch. This file never installs a timer or a schedule. */
export function participantCleanupOptions(env = process.env) {
  const orgId = env.SCB_PARTICIPANT_CLEANUP_ORG_ID;
  const actorId = env.SCB_PARTICIPANT_CLEANUP_ACTOR_ID;
  const rawLimit = env.SCB_PARTICIPANT_CLEANUP_LIMIT ?? '20';
  if (!UUID.test(orgId ?? '') || !UUID.test(actorId ?? ''))
    throw new Error('Cleanup requires one organization and its authorized actor');
  if (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 500)
    throw new Error('Cleanup limit must be an integer between 1 and 500');
  return { orgId, actorId, limit: Number(rawLimit) };
}

/**
 * Preserve every revision, request fingerprint and request id as a permanent tombstone.
 * The migration trigger independently rechecks terminal state, age and legal hold.
 * Caller must use the application role, never the schema owner or backup identity.
 */
export async function purgeParticipantMaterials(pool, options) {
  const { orgId, actorId, limit } = participantCleanupOptions({
    SCB_PARTICIPANT_CLEANUP_ORG_ID: options?.orgId,
    SCB_PARTICIPANT_CLEANUP_ACTOR_ID: options?.actorId,
    SCB_PARTICIPANT_CLEANUP_LIMIT: String(options?.limit ?? 20),
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const identity = (await client.query('SELECT current_user AS name,session_user AS session'))
      .rows[0];
    if (identity?.name !== 'scb_runtime' || identity.session !== 'scb_runtime') throw new Error();
    // Same resource order as application writes: actor -> org -> event -> team -> entry -> head.
    const actor = await client.query(
      "SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [actorId],
    );
    if (!actor.rowCount) throw new Error();
    const org = await client.query(
      "SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [orgId],
    );
    if (!org.rowCount) throw new Error();
    const membership = await client.query(
      "SELECT user_id FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' AND role IN ('ORG_OWNER','ORG_ADMIN') FOR SHARE",
      [orgId, actorId],
    );
    if (!membership.rowCount) throw new Error();
    const events = await client.query(
      `SELECT e.id FROM events e WHERE e.org_id=$1 AND e.status IN ('ARCHIVED','CANCELLED')
       AND current_date>e.end_date+90 AND EXISTS(
         SELECT 1 FROM participant_material_revisions r JOIN participant_materials m ON m.id=r.material_id
         WHERE r.org_id=e.org_id AND r.event_id=e.id AND r.payload_ciphertext IS NOT NULL AND NOT m.legal_hold)
       ORDER BY e.id LIMIT $2`,
      [orgId, limit],
    );
    let purgedRevisions = 0;
    let touchedEvents = 0;
    for (const event of events.rows) {
      if (purgedRevisions === limit) break;
      const locked = await client.query(
        "SELECT id FROM events WHERE org_id=$1 AND id=$2 AND status IN ('ARCHIVED','CANCELLED') AND current_date>end_date+90 FOR UPDATE SKIP LOCKED",
        [orgId, event.id],
      );
      if (!locked.rowCount) continue;
      const revisions = await client.query(
        `SELECT r.id,r.material_id,r.team_id,r.entry_id FROM participant_material_revisions r
         JOIN participant_materials m ON m.id=r.material_id AND m.org_id=r.org_id
         WHERE r.org_id=$1 AND r.event_id=$2 AND r.payload_ciphertext IS NOT NULL AND NOT m.legal_hold
         ORDER BY r.created_at,r.id LIMIT $3`,
        [orgId, event.id, limit - purgedRevisions],
      );
      if (!revisions.rows.length) continue;
      const teams = [...new Set(revisions.rows.map((row) => row.team_id))].sort();
      const entries = [...new Set(revisions.rows.map((row) => row.entry_id))].sort();
      const materials = [...new Set(revisions.rows.map((row) => row.material_id))].sort();
      await client.query(
        'SELECT id FROM teams WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
        [orgId, teams],
      );
      await client.query(
        'SELECT id FROM entries WHERE org_id=$1 AND event_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',
        [orgId, event.id, entries],
      );
      await client.query(
        'SELECT id FROM participant_materials WHERE org_id=$1 AND event_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',
        [orgId, event.id, materials],
      );
      // Recheck every predicate after locks; only ciphertext and its purge timestamp change.
      const updated = await client.query(
        `UPDATE participant_material_revisions r SET payload_ciphertext=NULL,purged_at=clock_timestamp()
         FROM participant_materials m,events e
         WHERE r.material_id=m.id AND r.org_id=$1 AND r.event_id=$2 AND r.id=ANY($3::uuid[])
           AND r.payload_ciphertext IS NOT NULL AND NOT m.legal_hold
           AND e.org_id=r.org_id AND e.id=r.event_id AND e.status IN ('ARCHIVED','CANCELLED')
           AND current_date>e.end_date+90 RETURNING r.id`,
        [orgId, event.id, revisions.rows.map((row) => row.id)],
      );
      if (!updated.rowCount) continue;
      await client.query(
        `INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,$3,'PARTICIPANT_MATERIALS_PURGED','event',$4,$5::jsonb)`,
        [
          randomUUID(),
          orgId,
          actorId,
          event.id,
          JSON.stringify({
            revisionIds: updated.rows.map((row) => row.id),
            count: updated.rowCount,
            retention: 'TERMINAL_EVENT_END_PLUS_90_DAYS',
          }),
        ],
      );
      purgedRevisions += updated.rowCount;
      touchedEvents += 1;
    }
    await client.query('COMMIT');
    return { status: 'complete', purgedRevisions, touchedEvents };
  } catch {
    await client?.query('ROLLBACK').catch(() => {});
    throw new Error('Participant material cleanup failed');
  } finally {
    client?.release();
  }
}

export async function cleanupParticipantMaterials(env = process.env) {
  const options = participantCleanupOptions(env);
  const url = parseDatabaseUrl(await readSecretEnv('DATABASE_URL', env), 'scb_runtime');
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  try {
    return await purgeParticipantMaterials(pool, options);
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url))
  await runAsCli('participant-material-cleanup', cleanupParticipantMaterials);

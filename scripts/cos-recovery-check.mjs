import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { assertExpansionTarget } from './expansion-recovery-check.mjs';
import { syntheticPng } from './c05-media-fixtures.mjs';

const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function references(saved) {
  assert.equal(saved?.kind, 'SYNTHETIC_COS_METADATA_ONLY');
  for (const field of ['orgId', 'fileId', 'orphanId']) assert.ok(uuid(saved[field]));
  assert.equal(saved.objects?.length, 2, 'COS recovery covers linked and orphan registrations');
  for (const row of saved.objects) {
    assert.ok(uuid(row.id));
    assert.match(row.row_hash, /^[0-9a-f]{64}$/);
  }
  assert.match(saved.fileHash ?? '', /^[0-9a-f]{64}$/);
}

/** Read-only hashes cover the complete COS registrations and linked file, without printing keys. */
async function retained(readPool, saved) {
  const client = await readPool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const objects = (
      await client.query(
        `SELECT id,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') AS row_hash
         FROM media_cos_objects o WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,
        [saved.orgId, [saved.fileId, saved.orphanId]],
      )
    ).rows;
    assert.equal(objects.length, 2, 'Both nonempty COS recovery registrations must survive');
    const files = (
      await client.query(
        `SELECT encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') AS row_hash,
         cos_object_id,payload IS NULL AS no_payload,purged_at IS NOT NULL AS purged,version
         FROM media_files f WHERE org_id=$1 AND id=$2`,
        [saved.orgId, saved.fileId],
      )
    ).rows;
    assert.equal(files.length, 1, 'COS recovery keeps its real media_files foreign-key link');
    assert.equal(files[0].cos_object_id, saved.fileId);
    assert.equal(files[0].no_payload, true);
    assert.equal(files[0].purged, true);
    assert.equal(files[0].version, 3);
    assert.equal(
      (await client.query('SELECT 1 FROM media_files WHERE cos_object_id=$1', [saved.orphanId]))
        .rowCount,
      0,
      'The orphan remains a distinct cleanup receipt, not a second file',
    );
    await client.query('COMMIT');
    return { objects, fileHash: files[0].row_hash };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Metadata-only recovery acceptance, never a cloud upload claim. The real restricted runtime
 * role creates a linked file, then revokes/purges it through the real DB guards. Its zero final
 * quota effect preserves the existing C05 usage proofs. The second registration remains an
 * unlinked cleanup candidate. Neither registration names an actual configured cloud resource.
 */
export async function captureCosRecovery({
  runtimePool,
  readPool,
  databaseUrl,
  appOrigin,
  requireRuntimeRole = true,
  orgId,
  matchId,
}) {
  await assertExpansionTarget({
    runtimePool,
    readPool,
    databaseUrl,
    appOrigin,
    requireRuntimeRole,
  });
  assert.ok(uuid(orgId) && uuid(matchId));
  const fileId = randomUUID(),
    orphanId = randomUUID();
  const client = await runtimePool.connect();
  try {
    await client.query('BEGIN');
    const source = (
      await client.query(
        `SELECT m.event_id,e.created_by FROM published_matches m
         JOIN events e ON e.org_id=m.org_id AND e.id=m.event_id
         WHERE m.org_id=$1 AND m.id=$2`,
        [orgId, matchId],
      )
    ).rows[0];
    assert.ok(source, 'COS metadata recovery requires an existing synthetic match and event');
    const usage = (
      await client.query(
        'SELECT COALESCE(sum(byte_length),0)::int AS used FROM media_files WHERE org_id=$1 AND purged_at IS NULL',
        [orgId],
      )
    ).rows[0].used;
    for (const id of [fileId, orphanId])
      await client.query(
        `INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key,created_at)
         VALUES($1,$2,'synthetic-recovery-12345','ap-guangzhou',$3,clock_timestamp()-interval '2 days')`,
        [id, orgId, `synthetic-cos-recovery/v1/${orgId}/${id}/${randomUUID()}`],
      );
    await client.query(
      `INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by,cos_object_id)
       VALUES($1,$2,$3,$4,'MATCH_IMAGE','synthetic-cos-metadata.png','image/png',$5,$6,NULL,$7,$1)`,
      [
        fileId,
        orgId,
        source.event_id,
        matchId,
        syntheticPng.length,
        createHash('sha256').update(syntheticPng).digest('hex'),
        source.created_by,
      ],
    );
    await client.query(
      'UPDATE media_files SET revoked_at=clock_timestamp(),revoked_by=$2,version=version+1 WHERE id=$1',
      [fileId, source.created_by],
    );
    await client.query(
      'UPDATE media_files SET purged_at=clock_timestamp(),purged_by=$2,version=version+1 WHERE id=$1',
      [fileId, source.created_by],
    );
    assert.equal(
      (
        await client.query(
          'SELECT COALESCE(sum(byte_length),0)::int AS used FROM media_files WHERE org_id=$1 AND purged_at IS NULL',
          [orgId],
        )
      ).rows[0].used,
      usage,
      'Synthetic recovery metadata must not change original media quota assertions',
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const identity = { kind: 'SYNTHETIC_COS_METADATA_ONLY', orgId, fileId, orphanId };
  return { ...identity, ...(await retained(readPool, identity)) };
}

export async function verifyCosRecovery({ readPool, saved }) {
  references(saved);
  assert.deepEqual(await retained(readPool, saved), {
    objects: saved.objects,
    fileHash: saved.fileHash,
  });
}

/** Restore quarantine must preserve receipts and discard even an injected cloud provider. */
export async function verifyCosRecoveryQuarantine({ readPool, saved, databaseUrl }) {
  await verifyCosRecovery({ readPool, saved });
  assert.equal(
    (
      await readPool.query(
        "SELECT EXISTS(SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore') AS quarantined",
      )
    ).rows[0].quarantined,
    true,
  );
  let providerCalls = 0;
  const forbidden = async () => {
    providerCalls++;
    throw new Error('Synthetic restore must never operate a cloud provider');
  };
  // The Alpine db-tools image deliberately omits image-processing native addons. Import
  // the same pure startup gate used by the API, rather than importing the entire Nest app.
  const { MediaObjectStorage } = await import('../apps/api/dist/media-object-storage.js');
  const storage = MediaObjectStorage.forRuntime(readPool, databaseUrl, true, () => {
    providerCalls++;
    return {
      bucket: 'synthetic-recovery-12345',
      region: 'ap-guangzhou',
      prefix: 'synthetic-cos-recovery/v1',
      put: forbidden,
      get: forbidden,
      delete: forbidden,
    };
  });
  try {
    assert.equal(storage.store, undefined, 'Restore discards configured or injected COS adapters');
    assert.deepEqual(await storage.cleanup(), { deleted: 0, failed: 0 });
    await assert.rejects(
      storage.read(null, { org_id: saved.orgId, cos_object_id: saved.fileId }),
      (error) => error.code === 'MEDIA_STORAGE_UNAVAILABLE',
    );
    assert.equal(providerCalls, 0);
  } finally {
    await storage.onModuleDestroy();
  }
  await verifyCosRecovery({ readPool, saved });
}

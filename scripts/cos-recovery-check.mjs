import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertExpansionTarget } from './expansion-recovery-check.mjs';
import { syntheticPng } from './c05-media-fixtures.mjs';

const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const STORAGE_SETTINGS_TABLES = Object.freeze([
  'storage_config_operations',
  'storage_config_probes',
  'storage_config_revisions',
  'storage_config_state',
]);
export function storageSettingsTablesFromSql(sql) {
  const names = [...sql.matchAll(/\bCREATE TABLE\s+([a-z][a-z0-9_]+)\s*\(/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length, 'Storage recovery tables are uniquely owned');
  assert.deepEqual(
    names.sort(),
    STORAGE_SETTINGS_TABLES,
    'Every storage settings table needs recovery coverage',
  );
  return names;
}
export async function storageSettingsInventory() {
  const name = '051_platform_storage_settings.sql';
  const sql = await readFile(new URL(`../apps/api/migrations/${name}`, import.meta.url), 'utf8');
  return {
    tables: storageSettingsTablesFromSql(sql),
    migrations: [{ name, checksum: createHash('sha256').update(sql).digest('hex') }],
  };
}

function settingsReferences(saved) {
  assert.equal(saved?.kind, 'SYNTHETIC_COS_SETTINGS_METADATA_ONLY');
  for (const field of ['revisionId', 'operationId', 'probeId']) assert.ok(uuid(saved[field]));
  assert.deepEqual(Object.keys(saved.rows ?? {}).sort(), STORAGE_SETTINGS_TABLES);
  for (const value of Object.values(saved.rows)) assert.match(value, /^[0-9a-f]{64}$/);
}

/** Hash ciphertext and receipts in PostgreSQL; no encryption key or secret leaves the helper. */
async function retainedSettings(client, saved) {
  const rows = {};
  for (const [table, key, value] of [
    ['storage_config_revisions', 'id', saved.revisionId],
    ['storage_config_operations', 'id', saved.operationId],
    ['storage_config_probes', 'id', saved.probeId],
    ['storage_config_state', 'singleton', true],
  ]) {
    const result = await client.query(
      `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_hash
       FROM ${table} t WHERE ${key}=$1`,
      [value],
    );
    assert.equal(result.rows.length, 1, `Nonempty ${table} recovery receipt must survive`);
    rows[table] = result.rows[0].row_hash;
  }
  return rows;
}

/** The synthetic draft never becomes active and never names a real cloud resource. */
async function captureSettings(client, actorId, orgId) {
  await client.query('SELECT pg_advisory_xact_lock(73321051)');
  const state = (
    await client.query('SELECT * FROM storage_config_state WHERE singleton=true FOR UPDATE')
  ).rows[0];
  assert.ok(
    state && state.active_revision_id === null && state.draft_revision_id === null,
    'Recovery capture cannot replace an existing object storage configuration',
  );
  const revisionId = randomUUID(),
    operationId = randomUUID(),
    probeId = randomUUID();
  const version = state.version + 1;
  const bucket = 'synthetic-recovery-12345',
    region = 'ap-guangzhou',
    prefix = 'synthetic-cos-recovery/v1';
  const root = randomBytes(32),
    nonce = randomBytes(12);
  let ciphertext, tag;
  try {
    const cipher = createCipheriv('aes-256-gcm', root, nonce);
    cipher.setAAD(
      Buffer.from(
        JSON.stringify([
          'scb-storage-config-v1',
          revisionId,
          version,
          'COS',
          bucket,
          region,
          prefix,
        ]),
      ),
    );
    ciphertext = Buffer.concat([
      cipher.update(
        JSON.stringify({
          secretId: 'synthetic-recovery-secret-id',
          secretKey: 'synthetic-recovery-secret-key',
        }),
      ),
      cipher.final(),
    ]);
    tag = cipher.getAuthTag();
  } finally {
    root.fill(0);
  }
  await client.query(
    `INSERT INTO storage_config_revisions(id,version,mode,bucket,region,prefix,credentials_ciphertext,credentials_nonce,credentials_tag,created_by)
     VALUES($1,$2,'COS',$3,$4,$5,$6,$7,$8,$9)`,
    [revisionId, version, bucket, region, prefix, ciphertext, nonce, tag, actorId],
  );
  await client.query(
    'UPDATE storage_config_state SET version=$1,draft_revision_id=$2 WHERE singleton=true',
    [version, revisionId],
  );
  await client.query(
    `INSERT INTO storage_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version,result,completed_at)
     VALUES($1,$2,$3,$4,'TEST','FAILED',$5,$6::jsonb,clock_timestamp())`,
    [
      operationId,
      actorId,
      randomUUID(),
      createHash('sha256').update(randomBytes(32)).digest('hex'),
      version,
      JSON.stringify({ code: 'SYNTHETIC_UNCONFIRMED_PUT', revisionId }),
    ],
  );
  await client.query(
    `INSERT INTO storage_config_probes(id,operation_id,revision_id,bucket,region,prefix,object_key)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      probeId,
      operationId,
      revisionId,
      bucket,
      region,
      prefix,
      `${prefix}/${orgId}/${revisionId}/${probeId}`,
    ],
  );
  return { kind: 'SYNTHETIC_COS_SETTINGS_METADATA_ONLY', revisionId, operationId, probeId };
}

function references(saved) {
  assert.equal(saved?.kind, 'SYNTHETIC_COS_METADATA_ONLY');
  for (const field of ['orgId', 'fileId', 'orphanId']) assert.ok(uuid(saved[field]));
  assert.equal(saved.objects?.length, 2, 'COS recovery covers linked and orphan registrations');
  for (const row of saved.objects) {
    assert.ok(uuid(row.id));
    assert.match(row.row_hash, /^[0-9a-f]{64}$/);
  }
  assert.match(saved.fileHash ?? '', /^[0-9a-f]{64}$/);
  settingsReferences(saved.settings);
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
    const settings = saved.settings
      ? { ...saved.settings, rows: await retainedSettings(client, saved.settings) }
      : undefined;
    await client.query('COMMIT');
    return { objects, fileHash: files[0].row_hash, settings };
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
  let settings;
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
    await storageSettingsInventory();
    settings = await captureSettings(client, source.created_by, orgId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const identity = { kind: 'SYNTHETIC_COS_METADATA_ONLY', orgId, fileId, orphanId, settings };
  return { ...identity, ...(await retained(readPool, identity)) };
}

export async function verifyCosRecovery({ readPool, saved }) {
  references(saved);
  assert.deepEqual(await retained(readPool, saved), {
    objects: saved.objects,
    fileHash: saved.fileHash,
    settings: saved.settings,
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
  const { createStorageSettingsResolver } =
    await import('../apps/api/dist/storage-settings/runtime.js');
  const forbiddenFactory = () => {
    providerCalls++;
    throw new Error('Restored storage settings must not load a provider or encryption key');
  };
  const resolver = createStorageSettingsResolver(readPool, forbiddenFactory, forbiddenFactory);
  const settingsClient = await readPool.connect();
  try {
    await assert.rejects(
      resolver(settingsClient),
      (error) => error.code === 'MEDIA_STORAGE_UNAVAILABLE',
    );
    assert.equal(providerCalls, 0);
  } finally {
    settingsClient.release();
  }
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

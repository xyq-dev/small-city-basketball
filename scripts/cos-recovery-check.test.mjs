import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadManifest } from '../ops/db/privileges.mjs';
import { exactTableRows } from '../ops/recovery/fingerprint-rows.mjs';
import {
  STORAGE_SETTINGS_TABLES,
  storageSettingsInventory,
  storageSettingsTablesFromSql,
  verifyCosRecovery,
} from './cos-recovery-check.mjs';

test('051 assigns all four settings tables and exact migration checksum to recovery', async () => {
  const inventory = await storageSettingsInventory();
  assert.deepEqual(inventory.tables, STORAGE_SETTINGS_TABLES);
  assert.equal(inventory.migrations.length, 1);
  assert.equal(inventory.migrations[0].name, '051_platform_storage_settings.sql');
  assert.match(inventory.migrations[0].checksum, /^[0-9a-f]{64}$/);
  const declarations = STORAGE_SETTINGS_TABLES.map((table) => `CREATE TABLE ${table}(id uuid);`);
  for (const sql of [
    declarations.slice(1).join('\n'),
    [...declarations, 'CREATE TABLE future_settings(id uuid);'].join('\n'),
    [...declarations, declarations[0]].join('\n'),
  ])
    assert.throws(() => storageSettingsTablesFromSql(sql));
});

test('settings runtime privileges prohibit deleting receipts, rewriting ciphertext and direct trigger calls', async () => {
  const manifest = await loadManifest();
  assert.deepEqual(manifest.tables.storage_config_revisions, {
    privileges: ['SELECT', 'INSERT'],
    updateColumns: [],
  });
  assert.deepEqual(manifest.tables.storage_config_state, {
    privileges: ['SELECT'],
    updateColumns: [
      'version',
      'draft_revision_id',
      'active_revision_id',
      'activated_at',
      'activated_by',
    ],
  });
  assert.deepEqual(manifest.tables.storage_config_operations, {
    privileges: ['SELECT', 'INSERT'],
    updateColumns: ['status', 'result', 'test_result', 'completed_at'],
  });
  assert.deepEqual(manifest.tables.storage_config_probes, {
    privileges: ['SELECT', 'INSERT'],
    updateColumns: ['put_confirmed_at', 'cleanup_attempted_at', 'deleted_at'],
  });
  for (const name of ['immutable', 'state_guard', 'operation_guard', 'probe_guard'])
    assert.deepEqual(manifest.functions[`c51_storage_${name}()`], []);
  assert.ok(!Object.keys(manifest.tables).some((table) => table.includes('root_key')));
});

test('recovery fingerprints storage credentials inside PostgreSQL without returning ciphertext to Node', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return {
        rows:
          queries.length === 1
            ? ['id', 'credentials_ciphertext', 'credentials_nonce', 'credentials_tag'].map(
                (attname) => ({ attname }),
              )
            : [{ value: '{"stored_credentials_sha256":"synthetic-hash"}' }],
      };
    },
  };
  assert.deepEqual(await exactTableRows(client, 'storage_config_revisions'), [
    { value: '{"stored_credentials_sha256":"synthetic-hash"}' },
  ]);
  assert.match(queries[1], /sha256\("credentials_ciphertext"\)/);
  assert.match(queries[1], /octet_length\("credentials_ciphertext"\)/);
  assert.ok(!queries[1].includes('SELECT "id","credentials_ciphertext"'));
});

const id = (tail) => `a3a3a3a3-1111-4444-8888-${String(tail).padStart(12, '0')}`;
function snapshotFixture() {
  const hash = 'a'.repeat(64);
  const settings = {
    kind: 'SYNTHETIC_COS_SETTINGS_METADATA_ONLY',
    revisionId: id(4),
    operationId: id(5),
    probeId: id(6),
    rows: Object.fromEntries(STORAGE_SETTINGS_TABLES.map((table) => [table, hash])),
  };
  const saved = {
    kind: 'SYNTHETIC_COS_METADATA_ONLY',
    orgId: id(1),
    fileId: id(2),
    orphanId: id(3),
    objects: [
      { id: id(2), row_hash: hash },
      { id: id(3), row_hash: hash },
    ],
    fileHash: hash,
    settings,
  };
  let changed;
  const client = {
    release() {},
    async query(sql) {
      if (sql.includes('FROM media_cos_objects')) return { rows: saved.objects };
      if (sql.includes('FROM media_files f'))
        return {
          rows: [
            {
              row_hash: hash,
              cos_object_id: saved.fileId,
              no_payload: true,
              purged: true,
              version: 3,
            },
          ],
        };
      if (sql.includes('SELECT 1 FROM media_files')) return { rowCount: 0 };
      const table = STORAGE_SETTINGS_TABLES.find((table) => sql.includes(`FROM ${table} `));
      return { rows: table ? [{ row_hash: changed === table ? 'b'.repeat(64) : hash }] : [] };
    },
  };
  return {
    saved,
    readPool: {
      async connect() {
        return client;
      },
    },
    mutate(table) {
      changed = table;
    },
  };
}
test('restore verifies all four retained settings receipts, detecting any table change', async () => {
  const fixture = snapshotFixture();
  await verifyCosRecovery(fixture);
  for (const table of STORAGE_SETTINGS_TABLES) {
    fixture.mutate(table);
    await assert.rejects(verifyCosRecovery(fixture));
  }
});

test('the admin settings override requires only a read-only root key and outbound provider network', async () => {
  const source = await readFile(
    new URL('../ops/templates/compose.storage-settings.yaml', import.meta.url),
    'utf8',
  );
  assert.match(source, /SCB_STORAGE_CONFIG_KEY_FILE: \/run\/secrets\/storage_config_key/);
  assert.match(source, /file: \$\{SCB_PROVIDER_SECRET_DIR:[^}]+\}\/storage_config_key/);
  assert.match(source, /networks: \[frontend, backend, provider_egress\]/);
  assert.match(source, /provider_egress:\s+internal: false/);
  assert.ok(!/^\s*(ports|volumes|SCB_COS_[A-Z_]+|SCB_MEDIA_STORAGE):/m.test(source));
  assert.equal((source.match(/^\s+SCB_[A-Z_]+:/gm) ?? []).length, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  R6_DOMAINS,
  r6Inventory,
  r6TablesFromSql,
  assertR6QuarantineSnapshot,
  assertR6QuarantineCounts,
  captureR6,
} from './r6-recovery-check.mjs';

test('043–048 inventory assigns every one of the 44 new tables and exact migration checksums', async () => {
  const inventory = await r6Inventory();
  assert.equal(inventory.tables.length, 44);
  assert.equal(inventory.migrations.length, 6);
  for (const migration of inventory.migrations) assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  assert.ok(inventory.tables.includes('sponsor_beneficiaries'));
  assert.ok(inventory.tables.includes('r6_trade_refund_bindings'));
});
test('new or omitted recovery tables fail instead of silently accepting an empty fixture', () => {
  const sql = Object.values(R6_DOMAINS)
    .flat()
    .map((t) => `CREATE TABLE ${t} (id uuid);`)
    .join('\n');
  assert.equal(r6TablesFromSql([sql]).length, 44);
  assert.throws(() => r6TablesFromSql([sql + '\nCREATE TABLE unreviewed_money (id uuid);']));
  assert.throws(() =>
    r6TablesFromSql([sql.replace('CREATE TABLE training_consumptions (id uuid);', '')]),
  );
  assert.throws(() => r6TablesFromSql([sql, sql]));
});
test('quarantine retains immutable row identities and may only append reconciliation evidence', () => {
  const before = {
    schema: { sha256: 'schema' },
    tables: {
      dispatch_offers: { rows: 1, identitySha256: 'quote-immutable' },
      insurance_reconciliation_cases: { rows: 1, rowHashes: ['unknown-case'] },
    },
  };
  const after = structuredClone(before);
  after.tables.insurance_reconciliation_cases = {
    rows: 2,
    rowHashes: ['unknown-case', 'new-case'],
  };
  assert.doesNotThrow(() => assertR6QuarantineSnapshot(before, after));
  const quote = structuredClone(after);
  quote.tables.dispatch_offers.identitySha256 = 'new-amount';
  assert.throws(() => assertR6QuarantineSnapshot(before, quote));
  const erased = structuredClone(after);
  erased.tables.insurance_reconciliation_cases.rowHashes = ['other', 'new-case'];
  assert.throws(() => assertR6QuarantineSnapshot(before, erased));
  const deleted = structuredClone(after);
  deleted.tables.dispatch_offers.rows = 0;
  assert.throws(() => assertR6QuarantineSnapshot(before, deleted));
  const schema = structuredClone(after);
  schema.schema.sha256 = 'altered';
  assert.throws(() => assertR6QuarantineSnapshot(before, schema));
});
test('R6 count rules preserve every earlier expansion and completion invariant', () => {
  const before = Object.fromEntries(
    Object.values(R6_DOMAINS)
      .flat()
      .map((t) => [t, 1]),
  );
  Object.assign(before, { insurance_policy_facts: 2, poster_exports: 3 });
  const after = { ...before, insurance_reconciliation_cases: 2 };
  assertR6QuarantineCounts(before, after);
  assert.throws(() => assertR6QuarantineCounts(before, { ...after, insurance_policy_facts: 0 }));
  assert.throws(() => assertR6QuarantineCounts(before, { ...after, poster_exports: 4 }));
  assert.throws(() => assertR6QuarantineCounts(before, { ...after, sponsor_refund_plans: 0 }));
  assert.throws(() => assertR6QuarantineCounts({ ...before, training_attendance: 0 }, after));
});
test('R6 capture rejects production and restored targets before any DB writes or driver imports', async () => {
  const pool = {
    query() {
      assert.fail('unsafe capture must never query');
    },
  };
  for (const name of ['production', 'scb_restore_invalid'])
    await assert.rejects(
      captureR6({
        runtimePool: pool,
        readPool: pool,
        databaseUrl: 'postgresql://scb_runtime:synthetic@127.0.0.1/' + name,
        appOrigin: 'http://127.0.0.1:5173',
      }),
    );
});

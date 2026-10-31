import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expansionInventory,
  expansionTablesFromSql,
  assertExpansionTarget,
  EXPANSION_DOMAINS,
  assertExpansionQuarantineCounts,
} from './expansion-recovery-check.mjs';

test('all six checked-in expansion migrations map to exact recovery domains', async () => {
  const inventory = await expansionInventory();
  assert.equal(inventory.length, 48);
  assert.equal(new Set(inventory).size, inventory.length);
  assert.ok(inventory.includes('insurance_policy_facts'));
  assert.ok(inventory.includes('trade_settlement_returns'));
  assert.ok(inventory.includes('notification_start_scan'));
});
test('an omitted or newly introduced table cannot silently escape recovery acceptance', () => {
  const sql = Object.values(EXPANSION_DOMAINS)
    .flat()
    .map((name) => `CREATE TABLE ${name} (id uuid);`)
    .join('\n');
  assert.equal(expansionTablesFromSql([sql]).length, 48);
  assert.throws(() =>
    expansionTablesFromSql([sql.replace('CREATE TABLE insurance_policy_facts (id uuid);', '')]),
  );
  assert.throws(() =>
    expansionTablesFromSql([sql + '\nCREATE TABLE ignored_money_claim (id uuid);']),
  );
  assert.throws(() => expansionTablesFromSql([sql, 'CREATE TABLE trade_orders (id uuid);']));
});
test('capture rejects production/restored names before touching any database', async () => {
  const pool = {
    query() {
      assert.fail('Unsafe target must fail before a DB query');
    },
  };
  for (const database of ['production', 'scb_restore_synthetic'])
    await assert.rejects(
      assertExpansionTarget({
        runtimePool: pool,
        readPool: pool,
        databaseUrl: 'postgresql://scb_runtime:synthetic@127.0.0.1/' + database,
        appOrigin: 'http://127.0.0.1:5173',
      }),
    );
});
test('restricted capture checks the exact role and both pools on the same database server', async () => {
  const input = {
    databaseUrl: 'postgresql://scb_runtime:synthetic@127.0.0.1/scb_test_recovery',
    appOrigin: 'http://127.0.0.1:5173',
  };
  const runtimePool = {
    async query() {
      return { rows: [{ name: 'scb_test_recovery', role: 'scb_runtime', pid: 123 }] };
    },
  };
  const readPool = {
    async query(sql) {
      return sql.includes('pg_stat_activity')
        ? { rowCount: 1 }
        : { rows: [{ name: 'scb_test_recovery' }] };
    },
  };
  await assertExpansionTarget({ ...input, runtimePool, readPool });
  await assert.rejects(
    assertExpansionTarget({
      ...input,
      runtimePool: {
        async query() {
          return { rows: [{ name: 'scb_test_recovery', role: 'scb_migrator', pid: 123 }] };
        },
      },
      readPool,
    }),
  );
  await assert.rejects(
    assertExpansionTarget({
      ...input,
      runtimePool,
      readPool: {
        async query() {
          return { rows: [{ name: 'scb_test_other' }] };
        },
      },
    }),
  );
});
test('quarantine may append guardian revocation history but cannot erase rows or weaken old completion counts', () => {
  const before = { youth_guardian_history: 2, insurance_policy_facts: 1, poster_exports: 3 };
  assertExpansionQuarantineCounts(before, { ...before, youth_guardian_history: 3 });
  assert.throws(() =>
    assertExpansionQuarantineCounts(before, { ...before, insurance_policy_facts: 0 }),
  );
  assert.throws(() => assertExpansionQuarantineCounts(before, { ...before, poster_exports: 4 }));
  assert.throws(() => assertExpansionQuarantineCounts(before, { ...before, unchecked_extra: 1 }));
});

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import {
  assertExpansionTarget,
  assertExpansionQuarantineCounts,
  expansionTransaction,
} from './expansion-recovery-check.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
export const R6_DOMAINS = Object.freeze({
  insurance: ['insurance_provider_releases', 'insurance_reconciliation_cases'],
  matching: [
    'matching_supply_preferences',
    'matching_needs',
    'matching_demand_slots',
    'matching_runs',
    'matching_candidates',
    'matching_intents',
    'matching_slot_assignments',
    'matching_command_receipts',
    'matching_outbox',
  ],
  dispatch: [
    'dispatch_preferences',
    'dispatch_requests',
    'dispatch_batches',
    'dispatch_offers',
    'dispatch_holds',
    'dispatch_command_receipts',
    'dispatch_events',
  ],
  training: [
    'training_providers',
    'training_coaches',
    'training_courses',
    'training_cohorts',
    'training_sessions',
    'training_session_coaches',
    'training_resource_reservations',
    'training_enrollments',
    'training_lesson_entitlements',
    'training_attendance',
    'training_consumptions',
    'training_refund_allocations',
    'training_guardian_grants',
    'training_command_receipts',
    'training_audit_events',
  ],
  sponsor: [
    'sponsor_beneficiaries',
    'sponsor_contracts',
    'sponsor_orders',
    'sponsor_deliveries',
    'sponsor_settlement_batches',
    'sponsor_settlement_items',
    'sponsor_refund_plans',
    'sponsor_return_items',
    'sponsor_recovery_cases',
    'sponsor_commerce_operations',
  ],
  ledger: ['r6_trade_refund_bindings'],
});
// Only quarantine's explicit authorization/lease fields may change; full snapshots are used before quarantine.
export const R6_QUARANTINE_FIELDS = Object.freeze({
  matching_supply_preferences: ['discovery_enabled', 'contact_enabled', 'version', 'updated_at'],
  matching_needs: ['status', 'version', 'latest_run_id', 'updated_at'],
  matching_outbox: ['state'],
  dispatch_preferences: ['enabled', 'version', 'updated_at'],
  dispatch_requests: [
    'status',
    'winner_offer_id',
    'next_batch_at',
    'reason',
    'version',
    'updated_at',
  ],
  dispatch_offers: ['status', 'reason', 'version', 'updated_at'],
  dispatch_holds: ['state'],
  training_providers: ['status', 'version'],
  training_coaches: ['status', 'consented', 'version'],
  training_cohorts: ['state', 'version'],
  training_resource_reservations: ['active'],
  training_enrollments: ['state', 'version'],
  training_guardian_grants: ['state', 'epoch'],
  sponsor_beneficiaries: ['status', 'version'],
  sponsor_contracts: ['version', 'updated_at'],
  sponsor_orders: ['version', 'updated_at'],
  sponsor_settlement_batches: ['status', 'finish_status', 'fence', 'updated_at'],
  sponsor_return_items: ['status', 'fence', 'updated_at'],
});
export function r6TablesFromSql(sources) {
  const names = sources.flatMap((sql) =>
    [...sql.matchAll(/\bCREATE TABLE\s+([a-z][a-z0-9_]+)\s*\(/g)].map((m) => m[1]),
  );
  const expected = Object.values(R6_DOMAINS).flat().sort();
  assert.equal(new Set(names).size, names.length, 'R6 recovery tables must be uniquely owned');
  assert.deepEqual(
    names.sort(),
    expected,
    'Every 043–048 table needs nonempty durable recovery coverage',
  );
  return expected;
}
export async function r6Inventory() {
  const directory = new URL('../apps/api/migrations/', import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => /^04[3-8]_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  assert.deepEqual(
    files.map((name) => Number(name.slice(0, 3))),
    [43, 44, 45, 46, 47, 48],
  );
  const sources = await Promise.all(
    files.map((name) => readFile(new URL(name, directory), 'utf8')),
  );
  return {
    tables: r6TablesFromSql(sources),
    migrations: files.map((name, i) => ({ name, checksum: sha(sources[i]) })),
  };
}
async function schemaProof(c, inventory) {
  const migrations = (
    await c.query(
      'SELECT name,checksum FROM schema_migrations WHERE name=ANY($1::text[]) ORDER BY name',
      [inventory.migrations.map((m) => m.name)],
    )
  ).rows;
  assert.deepEqual(
    migrations,
    inventory.migrations,
    'R6 applied migration checksums must match exact reviewed source',
  );
  const columns = (
    await c.query(
      `SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
      [inventory.tables],
    )
  ).rows;
  const constraints = (
    await c.query(
      `SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`,
      [inventory.tables],
    )
  ).rows;
  const indexes = (
    await c.query(
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname",
      [inventory.tables],
    )
  ).rows;
  const triggers = (
    await c.query(
      `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
      [inventory.tables],
    )
  ).rows;
  const functions = (
    await c.query(
      "SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'r6_%' OR p.proname IN('x12_release_expired','x12_local_reservation_guard','x12_existing_calendar_guard')) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)",
    )
  ).rows;
  return {
    migrations,
    sha256: sha(JSON.stringify({ columns, constraints, indexes, triggers, functions })),
  };
}
export async function r6Snapshot(readPool) {
  const inventory = await r6Inventory(),
    c = await readPool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const schema = await schemaProof(c, inventory),
      tables = {};
    for (const table of inventory.tables) {
      // Table names are the fixed inventory, never interpolated caller input.
      const records = (
        await c.query(
          `SELECT to_jsonb(t)::text AS full,(to_jsonb(t)-$1::text[])::text AS identity FROM public."${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`,
          [R6_QUARANTINE_FIELDS[table] ?? []],
        )
      ).rows;
      assert.ok(records.length > 0, `${table} cannot pass R6 recovery with an empty placeholder`);
      const rowHashes = records.map((r) => sha(r.identity)).sort();
      tables[table] = {
        rows: records.length,
        sha256: sha(records.map((r) => r.full).join('\n')),
        identitySha256: sha(rowHashes.join('\n')),
        ...(table === 'insurance_reconciliation_cases' ? { rowHashes } : {}),
      };
    }
    await c.query('COMMIT');
    return { schema, tables };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export function assertR6QuarantineSnapshot(before, after) {
  assert.deepEqual(
    after.schema,
    before.schema,
    'Quarantine must preserve schema and migration evidence',
  );
  assert.deepEqual(Object.keys(after.tables).sort(), Object.keys(before.tables).sort());
  for (const [table, proof] of Object.entries(before.tables)) {
    const current = after.tables[table];
    if (table === 'insurance_reconciliation_cases') {
      assert.ok(current.rows >= proof.rows);
      const available = [...current.rowHashes];
      for (const hash of proof.rowHashes) {
        const i = available.indexOf(hash);
        assert.ok(i >= 0, 'Existing reconciliation evidence cannot be erased');
        available.splice(i, 1);
      }
    } else {
      assert.equal(
        current.rows,
        proof.rows,
        `${table} history cannot be deleted or fabricated during isolation`,
      );
      assert.equal(
        current.identitySha256,
        proof.identitySha256,
        `${table} immutable facts changed during isolation`,
      );
    }
  }
}
export function assertR6QuarantineCounts(before, after) {
  const names = new Set(Object.values(R6_DOMAINS).flat());
  const old = (value) =>
    Object.fromEntries(Object.entries(value).filter(([table]) => !names.has(table)));
  assertExpansionQuarantineCounts(old(before), old(after));
  for (const table of names) {
    assert.ok(
      Number.isSafeInteger(before[table]) && before[table] > 0,
      `${table} needs nonempty recovery data`,
    );
    if (table === 'insurance_reconciliation_cases') assert.ok(after[table] >= before[table]);
    else assert.equal(after[table], before[table]);
  }
}
async function helpers(context) {
  const { RegistrationService } = await import('../apps/api/dist/registration-service.js');
  const { LocalServicesService } = await import('../apps/api/dist/local-services-service.js');
  const { REGION_CATALOG_VERSION } = await import('../apps/api/dist/region-catalog-data.js');
  const options = {
    databaseUrl: context.databaseUrl,
    appOrigin: context.appOrigin,
    participantDataKey: context.participantDataKey,
    participantRegistrationEnabled: true,
    backgroundWorkersEnabled: false,
  };
  const registration = new RegistrationService(context.runtimePool, options),
    local = new LocalServicesService(context.runtimePool, options);
  const registerSynthetic = async (name) => {
    const password = randomBytes(24).toString('base64url');
    const r = await registration.registerParticipant(
      { email: `r6-${randomUUID()}@example.test`, password, displayName: name },
      `isolated-r6:${randomUUID()}`,
    );
    return {
      id: r.data.user.id,
      userId: r.data.user.id,
      cookie: 'scb.sid=' + r.token,
      password,
      session: r.data,
    };
  };
  let sequence = 0;
  const createLocalSource = async (label, { book = true } = {}) => {
    const provider = await registerSynthetic('合成R6服务方'),
      buyer = await registerSynthetic('合成R6需求方');
    buyer.orgId = randomUUID();
    const listingId = randomUUID(),
      slotId = randomUUID(),
      orgId = context.state.orgId;
    const now = new Date(
      (await context.readPool.query('SELECT clock_timestamp() AS now')).rows[0].now,
    );
    const startsAt = new Date(
        now.getTime() + 14 * 86400000 + sequence++ * 3 * 3600000,
      ).toISOString(),
      endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
    const regionId = (
      await context.readPool.query(
        "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
        [REGION_CATALOG_VERSION],
      )
    ).rows[0].region_id;
    const region = { catalogVersion: REGION_CATALOG_VERSION, regionId },
      address = '合成R6明确实际服务场地';
    await expansionTransaction(context.runtimePool, async (c) => {
      await c.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
        buyer.orgId,
        `合成R6需求机构-${label}`,
      ]);
      await c.query(
        "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
        [buyer.orgId, buyer.id],
      );
      await c.query(
        `INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,title,description,address,region_catalog_version,region_id,coverage_region_ids,qualification_note,terms,provider_confirmed,status,published,qualified_until,reviewed_by,reviewed_at)
        VALUES($1,$2,$3,$3,'SCORER',$4,'明确标记的隔离恢复合成源供给',$5,$6,$7,ARRAY[$7]::uuid[],'合成独立审核资料','明确实际场地和履约取消条款',true,'APPROVED',true,clock_timestamp()+interval '1 year',$8,clock_timestamp())`,
        [
          listingId,
          orgId,
          provider.id,
          `合成R6供给-${label}`,
          address,
          region.catalogVersion,
          regionId,
          context.state.userId,
        ],
      );
      await c.query(
        'INSERT INTO local_slots(id,org_id,listing_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
        [slotId, orgId, listingId, startsAt, endsAt],
      );
    });
    let bookingId = null;
    if (book) {
      const receipt = await local.book(buyer.cookie, {
        commandId: randomUUID(),
        listingId,
        slotId,
        serviceRegion: region,
        serviceAddress: address,
        acceptedTerms: true,
      });
      bookingId = receipt.resourceId;
      await local.bookingCommand(provider.cookie, bookingId, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'ACCEPT',
        reason: '合成服务方明确接单，供恢复验证真实预约',
      });
    }
    return {
      listingId,
      slotId,
      bookingId,
      provider,
      buyer,
      orgId,
      region,
      startsAt,
      endsAt,
      address,
      listingVersion: 1,
    };
  };
  return { registerSynthetic, createLocalSource };
}
async function insuranceUnknownProof(readPool, reference) {
  assert.match(reference?.operationId ?? '', /^[0-9a-f-]{36}$/i);
  const row = (
    await readPool.query(
      `SELECT o.id,o.order_id,o.kind,o.status,o.attempt_count,o.reconcile_only,o.next_attempt_at::text,
    encode(sha256(convert_to((to_jsonb(o)-ARRAY['fence','lease_id','lease_until','updated_at'])::text,'UTF8')),'hex') AS operation_identity,
    p.admission_release_id,p.admission_source_hash,r.source_hash,
    c.reason,c.resolved_at,
    encode(sha256(convert_to((to_jsonb(i)-ARRAY['authorization_valid','version','updated_at'])::text,'UTF8')),'hex') AS order_identity
    FROM insurance_operations o JOIN insurance_orders i ON i.id=o.order_id JOIN insurance_quotes p ON p.id=i.quote_id
    JOIN insurance_provider_releases r ON r.id=p.admission_release_id AND r.source_hash=p.admission_source_hash
    JOIN insurance_reconciliation_cases c ON c.operation_id=o.id AND c.order_id=o.order_id
    WHERE o.id=$1 AND i.id=$2`,
      [reference.operationId, reference.orderId],
    )
  ).rows[0];
  assert.ok(
    row,
    'R6 UNKNOWN must retain a real order, admitted quote, immutable release and reconciliation case',
  );
  assert.equal(row.kind, 'APPLY');
  assert.equal(row.status, 'UNKNOWN');
  assert.equal(row.attempt_count, 12);
  assert.equal(row.reconcile_only, true);
  assert.equal(row.next_attempt_at, 'infinity');
  assert.equal(row.resolved_at, null);
  assert.equal(row.reason, 'AUTOMATIC_QUERY_BUDGET_EXHAUSTED');
  assert.equal(row.admission_release_id, reference.admissionReleaseId);
  return row;
}
export async function captureR6(context) {
  await r6Inventory();
  await assertExpansionTarget(context);
  const helper = await helpers(context),
    input = { ...context, ...helper, suffix: randomUUID().slice(0, 8) };
  const insurance = { reference: context.expansion.insurance.r6Unknown };
  insurance.proof = await insuranceUnknownProof(context.readPool, insurance.reference);
  const matching = await (await import('./r6-recovery-matching.mjs')).captureR6Matching(input);
  const training = await (await import('./r6-recovery-training.mjs')).captureR6Training(input);
  const sponsor = await (await import('./r6-recovery-sponsor.mjs')).captureR6Sponsor(input);
  // Real dispatch acceptance has a bounded ten-minute hold; capture it last and quiesce all workers.
  const dispatch = await (await import('./r6-recovery-dispatch.mjs')).captureR6Dispatch(input);
  const snapshot = await r6Snapshot(context.readPool);
  return {
    version: 1,
    evidenceScope: 'ISOLATED_SYNTHETIC_POSTGRES_RECOVERY_NOT_PRODUCTION_SIGNOFF',
    insurance,
    matching,
    training,
    sponsor,
    dispatch,
    courtIds: [
      ...(training.courtIds ?? []),
      ...(sponsor.courtIds ?? []),
      ...(matching.courtIds ?? []),
      ...(dispatch.courtIds ?? []),
    ],
    snapshot,
  };
}
function savedInput(saved) {
  assert.equal(saved?.version, 1);
  assert.deepEqual(
    Object.keys(saved.snapshot?.tables ?? {}).sort(),
    Object.values(R6_DOMAINS).flat().sort(),
  );
}
export async function verifyR6({ readPool, saved, quarantined = false, baseUrl }) {
  savedInput(saved);
  const current = await r6Snapshot(readPool);
  if (quarantined) {
    assert.ok(
      (
        await readPool.query(
          "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore'",
        )
      ).rowCount,
    );
    assertR6QuarantineSnapshot(saved.snapshot, current);
  } else
    assert.deepEqual(
      current,
      saved.snapshot,
      'R6 schema, checksums and every nonempty durable fact must survive restart/restore',
    );
  assert.deepEqual(
    await insuranceUnknownProof(readPool, saved.insurance.reference),
    saved.insurance.proof,
    'UNKNOWN apply and bounded reconciliation must never become a fabricated success or new operation',
  );
  for (const [name, method] of [
    ['matching', 'Matching'],
    ['training', 'Training'],
    ['sponsor', 'Sponsor'],
    ['dispatch', 'Dispatch'],
  ]) {
    const module = await import(`./r6-recovery-${name}.mjs`);
    await module[`verifyR6${method}`]({ readPool, saved: saved[name], quarantined });
  }
  if (quarantined && baseUrl) {
    for (const route of ['/v1/dispatch/capabilities']) {
      const response = await fetch(baseUrl + route);
      assert.equal(response.status, 200, route);
      const body = await response.json();
      assert.equal(
        body.data.enabled,
        false,
        route + ' must not resume external admission after restore',
      );
    }
  }
}

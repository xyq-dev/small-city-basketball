import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export const MATCHING_RECOVERY_TABLES = Object.freeze([
  'matching_supply_preferences',
  'matching_needs',
  'matching_demand_slots',
  'matching_runs',
  'matching_candidates',
  'matching_intents',
  'matching_slot_assignments',
  'matching_command_receipts',
  'matching_outbox',
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const iso = (v) => new Date(v).toISOString();
function references(proof) {
  for (const key of [
    'needId',
    'slotId',
    'runId',
    'candidateId',
    'intentId',
    'assignmentId',
    'commandId',
    'outboxId',
    'listingId',
    'sourceSlotId',
    'bookingId',
    'providerId',
    'buyerId',
    'orgId',
    'supplyOrgId',
  ])
    assert.match(proof?.[key] ?? '', UUID, `R6MATCH recovery requires exact ${key}`);
}
/** Only exact synthetic scope IDs and SQL-generated digests leave the database. */
async function retained(readPool, proof) {
  references(proof);
  const c = await readPool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const rows = {};
    const scopes = [
      [
        'matching_supply_preferences',
        "source_kind='STAFF_SERVICE' AND source_id=$1",
        [proof.listingId],
      ],
      ['matching_needs', 'id=$1', [proof.needId]],
      ['matching_demand_slots', 'id=$1 AND need_id=$2', [proof.slotId, proof.needId]],
      ['matching_runs', 'id=$1 AND need_id=$2', [proof.runId, proof.needId]],
      ['matching_candidates', 'id=$1 AND need_id=$2', [proof.candidateId, proof.needId]],
      ['matching_intents', 'id=$1 AND need_id=$2', [proof.intentId, proof.needId]],
      ['matching_slot_assignments', 'id=$1 AND need_id=$2', [proof.assignmentId, proof.needId]],
      [
        'matching_command_receipts',
        'actor_id=$1 AND command_id=$2',
        [proof.buyerId, proof.commandId],
      ],
      ['matching_outbox', 'id=$1 AND need_id=$2', [proof.outboxId, proof.needId]],
    ];
    for (const [table, where, params] of scopes) {
      assert.ok(MATCHING_RECOVERY_TABLES.includes(table));
      const mutable = {
        matching_outbox: ['state'],
        matching_supply_preferences: [
          'discovery_enabled',
          'contact_enabled',
          'version',
          'updated_at',
        ],
        matching_needs: ['status', 'version', 'latest_run_id', 'updated_at'],
      }[table];
      const expression = mutable
        ? 'to_jsonb(r)-ARRAY[' + mutable.map((field) => "'" + field + "'").join(',') + ']'
        : 'to_jsonb(r)';
      const r = await c.query(
        `SELECT encode(sha256(convert_to((${expression})::text,'UTF8')),'hex') AS hash FROM ${table} r WHERE ${where}`,
        params,
      );
      assert.equal(r.rowCount, 1, `${table} representative row must remain nonempty`);
      rows[table] = r.rows[0].hash;
    }
    const binding = (
      await c.query(
        `SELECT n.owner_id,n.org_id,n.quantity,n.total_budget_fen,s.state AS slot_state,s.generation,i.status AS intent_status,i.source_kind,i.source_id,a.active,a.amount_fen,a.source_user_id
      FROM matching_needs n JOIN matching_demand_slots s ON s.need_id=n.id JOIN matching_intents i ON i.slot_id=s.id JOIN matching_slot_assignments a ON a.intent_id=i.id
      WHERE n.id=$1 AND s.id=$2 AND i.id=$3 AND a.id=$4`,
        [proof.needId, proof.slotId, proof.intentId, proof.assignmentId],
      )
    ).rows[0];
    const source = (
      await c.query(
        `SELECT b.id,b.listing_id,b.slot_id,b.buyer_user_id,b.provider_user_id,b.status,encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') AS hash
      FROM local_bookings b WHERE b.id=$1`,
        [proof.bookingId],
      )
    ).rows[0];
    const reservations = await c.query(
      "SELECT id,active,resource_key,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM local_resource_reservations r WHERE booking_id=$1 ORDER BY id",
      [proof.bookingId],
    );
    const outbox = (
      await c.query(
        'SELECT state,event,recipient_id,resource_version FROM matching_outbox WHERE id=$1',
        [proof.outboxId],
      )
    ).rows[0];
    const needState = (
      await c.query('SELECT status,version,latest_run_id FROM matching_needs WHERE id=$1', [
        proof.needId,
      ])
    ).rows[0];
    const preferenceState = (
      await c.query(
        "SELECT discovery_enabled,contact_enabled,version FROM matching_supply_preferences WHERE source_kind='STAFF_SERVICE' AND source_id=$1",
        [proof.listingId],
      )
    ).rows[0];
    const quarantined = !!(
      await c.query(
        "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
      )
    ).rowCount;
    await c.query('COMMIT');
    return {
      rows,
      binding,
      source,
      reservations: reservations.rows,
      outbox,
      needState,
      preferenceState,
      quarantined,
    };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

/** Explicit SQL recovery fixture; source creation/confirmation uses canonical X12 service.
 * This is a restore/ACL test, not proof of a production role journey or real payment. */
export async function captureR6Matching(context) {
  const { runtimePool, readPool } = context;
  assert.equal(typeof context.createLocalSource, 'function');
  const source = await context.createLocalSource('matching');
  const proof = {
    needId: randomUUID(),
    slotId: randomUUID(),
    runId: randomUUID(),
    candidateId: randomUUID(),
    intentId: randomUUID(),
    assignmentId: randomUUID(),
    commandId: randomUUID(),
    outboxId: randomUUID(),
    listingId: source.listingId,
    sourceSlotId: source.slotId,
    bookingId: source.bookingId,
    providerId: source.provider.userId ?? source.provider.id,
    buyerId: source.buyer.userId ?? source.buyer.id,
    orgId: source.buyer.orgId,
    supplyOrgId: source.orgId,
  };
  references(proof);
  const listing = (
    await readPool.query('SELECT kind,title,version FROM local_listings WHERE id=$1', [
      proof.listingId,
    ])
  ).rows[0];
  assert.ok(
    listing && ['REFEREE', 'SCORER', 'RECORDER', 'STREAMER', 'PHOTOGRAPHER'].includes(listing.kind),
    'Matching recovery source must be a real staff listing',
  );
  const window = {
    reportAt: iso(source.startsAt),
    startAt: iso(source.startsAt),
    endAt: iso(source.endsAt),
  };
  const expiresAt = new Date(Date.parse(window.reportAt) - 3600000).toISOString();
  const candidate = {
    id: proof.candidateId,
    sourceId: proof.listingId,
    sourceOrgId: proof.supplyOrgId,
    sourceSlotId: proof.sourceSlotId,
    sourceVersion: listing.version,
    name: listing.title,
    role: listing.kind,
    regionId: source.region.regionId,
    totalFen: 1000,
    needsQuote: false,
    crossCity: false,
    preferenceVersion: 1,
    settingsVersion: null,
    fingerprint: digest(['explicit-recovery-fixture', proof.bookingId]),
    score: {
      ruleVersion: 'match-rules-v1',
      score: 79,
      coverage: 60,
      band: 'LIMITED',
      dimensions: { time: 100, budget: 50, travel: null, reliability: null },
      reasons: ['合成同档恢复核验', '交通与履约没有伪造证据'],
    },
  };
  const c = await runtimePool.connect();
  try {
    await c.query('BEGIN');
    // A currently approved price is a fixture fact, not an external payment or backdated charge.
    await c.query(
      "INSERT INTO trade_terms(id,org_id,kind,source_id,amount_fen,terms,merchant_key,status,created_by,reviewed_by,reviewed_at) VALUES($1,$2,'LOCAL_BOOKING',$3,1000,'仅隔离恢复演练的固定服务报价，不执行真实收费','synthetic-r6-recovery','ACTIVE',$4,$5,clock_timestamp())",
      [randomUUID(), proof.supplyOrgId, proof.listingId, proof.providerId, proof.buyerId],
    );
    await c.query(
      `INSERT INTO matching_supply_preferences(source_kind,source_id,owner_id,org_id,region_catalog_version,region_id,allowed_region_ids,discovery_enabled,contact_enabled,adult_confirmed,availability) VALUES('STAFF_SERVICE',$1,$2,$3,$4,$5,ARRAY[$5::uuid],true,true,true,'[]'::jsonb)`,
      [
        proof.listingId,
        proof.providerId,
        proof.supplyOrgId,
        source.region.catalogVersion,
        source.region.regionId,
      ],
    );
    await c.query(
      `INSERT INTO matching_needs(id,owner_id,org_id,kind,title,address,region_catalog_version,region_id,allowed_region_ids,role,quantity,windows,unit_budget_fen,total_budget_fen,max_travel_minutes,expires_at) VALUES($1,$2,$3,'STAFF_SERVICE','R6匹配隔离恢复需求',$4,$5,$6,ARRAY[$6::uuid],$7,1,$8::jsonb,2000,2000,120,$9)`,
      [
        proof.needId,
        proof.buyerId,
        proof.orgId,
        source.address,
        source.region.catalogVersion,
        source.region.regionId,
        listing.kind,
        JSON.stringify([window]),
        expiresAt,
      ],
    );
    await c.query(
      "INSERT INTO matching_demand_slots(id,need_id,seat_no,state) VALUES($1,$2,1,'CONVERTED')",
      [proof.slotId, proof.needId],
    );
    await c.query(
      "INSERT INTO matching_runs(id,need_id,need_version,rule_version,seed,status) VALUES($1,$2,1,'match-rules-v1','r6-recovery','READY')",
      [proof.runId, proof.needId],
    );
    await c.query('UPDATE matching_needs SET latest_run_id=$2 WHERE id=$1', [
      proof.needId,
      proof.runId,
    ]);
    await c.query(
      `INSERT INTO matching_candidates(id,need_id,run_id,source_id,source_org_id,source_user_id,source_version,source_slot_id,preference_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)`,
      [
        proof.candidateId,
        proof.needId,
        proof.runId,
        proof.listingId,
        proof.supplyOrgId,
        proof.providerId,
        listing.version,
        proof.sourceSlotId,
        JSON.stringify(candidate),
      ],
    );
    await c.query(
      `INSERT INTO matching_intents(id,need_id,slot_id,candidate_id,generation,need_version,receiver_id,status,expires_at,version,accepted_at,source_kind,source_id) VALUES($1,$2,$3,$4,1,1,$5,'CONVERTED',$6,3,clock_timestamp(),'LOCAL_BOOKING',$7)`,
      [
        proof.intentId,
        proof.needId,
        proof.slotId,
        proof.candidateId,
        proof.providerId,
        expiresAt,
        proof.bookingId,
      ],
    );
    await c.query(
      `INSERT INTO matching_slot_assignments(id,need_id,slot_id,generation,intent_id,source_user_id,source_kind,source_id,amount_fen) VALUES($1,$2,$3,1,$4,$5,'LOCAL_BOOKING',$6,1000)`,
      [
        proof.assignmentId,
        proof.needId,
        proof.slotId,
        proof.intentId,
        proof.providerId,
        proof.bookingId,
      ],
    );
    await c.query(
      'INSERT INTO matching_command_receipts(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',
      [
        proof.buyerId,
        proof.commandId,
        digest(['synthetic-r6-recovery', proof.needId, proof.intentId]),
        JSON.stringify({
          resourceType: 'MATCHING_INTENT',
          resourceId: proof.intentId,
          needId: proof.needId,
          version: 3,
          sourceKind: 'LOCAL_BOOKING',
          sourceId: proof.bookingId,
        }),
      ],
    );
    await c.query(
      "INSERT INTO matching_outbox(id,need_id,intent_id,recipient_id,event,resource_version) VALUES($1,$2,$3,$4,'CONVERTED',3)",
      [proof.outboxId, proof.needId, proof.intentId, proof.providerId],
    );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
  proof.before = await retained(readPool, proof);
  assert.equal(proof.before.source.status, 'CONFIRMED');
  assert.ok(
    proof.before.reservations.some(
      (r) => r.active && r.resource_key === 'user:' + proof.providerId,
    ),
  );
  assert.equal(proof.before.outbox.state, 'PENDING');
  return { proof };
}
export async function verifyR6Matching({ readPool, saved, quarantined = false }) {
  const proof = saved.proof ?? saved;
  references(proof);
  assert.ok(proof.before, 'R6MATCH restore requires the original captured facts');
  const current = await retained(readPool, proof);
  assert.deepEqual(
    current.rows,
    proof.before.rows,
    'All nine matching history identities and snapshots must survive',
  );
  assert.deepEqual(
    current.binding,
    proof.before.binding,
    'Seat generation, budget hold and original source must not be reset',
  );
  assert.deepEqual(
    current.source,
    proof.before.source,
    'The canonical source booking must survive exactly',
  );
  assert.deepEqual(
    current.reservations,
    proof.before.reservations,
    'The original resource reservation must not be freed by restore',
  );
  assert.equal(current.binding.slot_state, 'CONVERTED');
  assert.equal(current.binding.intent_status, 'CONVERTED');
  assert.equal(current.binding.source_id, proof.bookingId);
  assert.equal(current.binding.active, true);
  assert.equal(current.binding.amount_fen, 1000);
  if (quarantined) {
    assert.deepEqual(
      current.preferenceState,
      {
        discovery_enabled: false,
        contact_enabled: false,
        version: proof.before.preferenceState.version + 1,
      },
      'Restored discovery/contact consent must be closed',
    );
    assert.deepEqual(
      current.needState,
      { status: 'PAUSED', version: proof.before.needState.version + 1, latest_run_id: null },
      'Restored active demand must pause and discard the current run pointer',
    );
    assert.equal(current.quarantined, true, 'Restore quarantine marker must be durable');
    assert.equal(
      current.outbox.state,
      'CANCELLED',
      'Restore must stop pending matching delivery without deleting history',
    );
  } else {
    assert.deepEqual(current.outbox, proof.before.outbox);
    assert.deepEqual(current.needState, proof.before.needState);
    assert.deepEqual(current.preferenceState, proof.before.preferenceState);
  }
  return {
    tables: MATCHING_RECOVERY_TABLES.length,
    sourcePreserved: true,
    budgetPreserved: true,
    outboundDisabled: quarantined,
  };
}

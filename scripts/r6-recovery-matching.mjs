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
    'tradeOrderId',
    'termsId',
    'providerId',
    'buyerId',
    'orgId',
    'supplyOrgId',
  ])
    assert.match(proof?.[key] ?? '', UUID, `R6MATCH recovery requires exact ${key}`);
  assert.ok(
    Number.isSafeInteger(proof.totalFen) && proof.totalFen > 0 && proof.totalFen <= 100000000,
  );
}
/** Check actual captured E04 facts, never synthesize a ledger after the source exists. */
async function canonicalTrade(c, proof) {
  const rows = await c.query(
    `SELECT t.id,t.org_id,t.kind,t.source_id,t.source_version,t.payer_user_id,t.beneficiary_user_id,t.terms_id,t.total_fen,t.source_snapshot,t.source_hash,t.quote,
      t.status,t.version,to_jsonb(t)->>'updated_at' AS updated_at,tt.status AS terms_status,tt.version AS terms_version,tt.merchant_key AS terms_merchant_key,t.merchant_key,
      tt.org_id AS terms_org_id,tt.kind AS terms_kind,tt.source_id AS terms_source_id,tt.amount_fen,
      b.listing_id,b.slot_id,b.buyer_user_id,b.provider_user_id,b.org_id AS booking_org_id,b.starts_at,b.ends_at,b.snapshot->>'address' AS address,
      encode(sha256(convert_to((to_jsonb(t)-ARRAY['status','version','updated_at'])::text,'UTF8')),'hex') AS identity_hash,
      encode(sha256(convert_to((to_jsonb(tt)-ARRAY['status','version'])::text,'UTF8')),'hex') AS terms_identity_hash,
      (SELECT count(*)::int FROM trade_payment_attempts WHERE order_id=t.id) AS payment_attempts
    FROM trade_orders t JOIN trade_terms tt ON tt.id=t.terms_id JOIN local_bookings b ON b.id=t.source_id
    WHERE t.id=$1 AND t.kind='LOCAL_BOOKING' AND t.source_id=$2 AND t.terms_id=$3`,
    [proof.tradeOrderId, proof.bookingId, proof.termsId],
  );
  assert.equal(rows.rowCount, 1, 'Paid matching must retain exactly its canonical source trade');
  const t = rows.rows[0];
  assert.equal(t.org_id, proof.supplyOrgId);
  assert.equal(t.booking_org_id, proof.supplyOrgId);
  assert.equal(t.terms_org_id, proof.supplyOrgId);
  assert.equal(t.terms_kind, 'LOCAL_BOOKING');
  assert.equal(t.terms_source_id, proof.listingId);
  assert.equal(t.listing_id, proof.listingId);
  assert.equal(t.slot_id, proof.sourceSlotId);
  assert.equal(t.payer_user_id, proof.buyerId);
  assert.equal(t.buyer_user_id, proof.buyerId);
  assert.equal(t.beneficiary_user_id, proof.providerId);
  assert.equal(t.provider_user_id, proof.providerId);
  assert.equal(t.total_fen, proof.totalFen);
  assert.equal(t.amount_fen, proof.totalFen);
  assert.equal(t.source_version, 1, 'The trade is captured when the original request is created');
  assert.equal(t.merchant_key, t.terms_merchant_key);
  assert.equal(t.payment_attempts, 0, 'Recovery never invokes a payment transport');
  // Same key order as TradeService.source's LOCAL_BOOKING immutable identity.
  const expected = {
    orgId: proof.supplyOrgId,
    kind: 'LOCAL_BOOKING',
    id: proof.bookingId,
    payer: proof.buyerId,
    beneficiary: proof.providerId,
    listingId: proof.listingId,
    slotId: proof.sourceSlotId,
    startsAt: iso(t.starts_at),
    endsAt: iso(t.ends_at),
    address: t.address,
    totalFen: proof.totalFen,
    platformFeeFen: 0,
    termsId: proof.termsId,
  };
  assert.deepEqual(
    t.source_snapshot,
    expected,
    'Frozen trade source must match the actual booking',
  );
  assert.equal(t.source_hash, digest(expected), 'Source digest must match the canonical identity');
  assert.equal(t.quote.kind, 'LOCAL_BOOKING');
  assert.equal(t.quote.sourceId, proof.bookingId);
  assert.equal(t.quote.totalFen, proof.totalFen);
  assert.equal(t.quote.termsId, proof.termsId);
  assert.equal(t.quote.sourceHash, t.source_hash);
  return {
    identity: {
      id: t.id,
      sourceId: t.source_id,
      termsId: t.terms_id,
      orgId: t.org_id,
      payerId: t.payer_user_id,
      beneficiaryId: t.beneficiary_user_id,
      totalFen: t.total_fen,
      sourceHash: t.source_hash,
      hash: t.identity_hash,
      termsHash: t.terms_identity_hash,
    },
    state: {
      status: t.status,
      version: t.version,
      updatedAt: t.updated_at,
      termsStatus: t.terms_status,
      termsVersion: t.terms_version,
    },
  };
}
/** Only exact synthetic scope IDs and SQL-generated digests leave the database. */
async function retained(readPool, proof) {
  references(proof);
  const c = await readPool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const rows = {},
      fullRows = {};
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
        `SELECT encode(sha256(convert_to((${expression})::text,'UTF8')),'hex') AS hash,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS full_hash FROM ${table} r WHERE ${where}`,
        params,
      );
      assert.equal(r.rowCount, 1, `${table} representative row must remain nonempty`);
      rows[table] = r.rows[0].hash;
      fullRows[table] = r.rows[0].full_hash;
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
        `SELECT b.id,b.listing_id,b.slot_id,b.buyer_user_id,b.provider_user_id,b.status,b.version,b.reason,b.change_request,b.checkin_hash,b.checkin_expires_at,
      to_jsonb(b)->>'updated_at' AS updated_at,
      encode(sha256(convert_to((to_jsonb(b)-ARRAY['status','version','reason','change_request','checkin_hash','checkin_expires_at','updated_at'])::text,'UTF8')),'hex') AS identity_hash,
      encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') AS hash
      FROM local_bookings b WHERE b.id=$1`,
        [proof.bookingId],
      )
    ).rows[0];
    const trade = await canonicalTrade(c, proof);
    const reservations = await c.query(
      "SELECT id,active,resource_key,encode(sha256(convert_to((to_jsonb(r)-'active')::text,'UTF8')),'hex') AS identity_hash,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM local_resource_reservations r WHERE booking_id=$1 ORDER BY id",
      [proof.bookingId],
    );
    const outbox = (
      await c.query(
        'SELECT state,event,recipient_id,resource_version FROM matching_outbox WHERE id=$1',
        [proof.outboxId],
      )
    ).rows[0];
    const needState = (
      await c.query(
        "SELECT status,version,latest_run_id,to_jsonb(n)->>'updated_at' AS updated_at FROM matching_needs n WHERE id=$1",
        [proof.needId],
      )
    ).rows[0];
    const preferenceState = (
      await c.query(
        "SELECT discovery_enabled,contact_enabled,version,to_jsonb(p)->>'updated_at' AS updated_at FROM matching_supply_preferences p WHERE source_kind='STAFF_SERVICE' AND source_id=$1",
        [proof.listingId],
      )
    ).rows[0];
    const quarantine = (
      await c.query(
        "SELECT to_jsonb(a)->>'created_at' AS at FROM audit_logs a WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    await c.query('COMMIT');
    return {
      rows,
      fullRows,
      binding,
      source,
      trade,
      reservations: reservations.rows,
      outbox,
      needState,
      preferenceState,
      quarantined: !!quarantine,
      quarantineAt: quarantine?.at ?? null,
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
  const source = await context.createLocalSource('matching', { paid: true });
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
    tradeOrderId: source.tradeOrderId,
    termsId: source.termsId,
    totalFen: source.totalFen,
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
    totalFen: proof.totalFen,
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
    await canonicalTrade(c, proof);
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
      `INSERT INTO matching_needs(id,owner_id,org_id,kind,title,address,region_catalog_version,region_id,allowed_region_ids,role,quantity,windows,unit_budget_fen,total_budget_fen,max_travel_minutes,expires_at) VALUES($1,$2,$3,'STAFF_SERVICE','R6匹配隔离恢复需求',$4,$5,$6,ARRAY[$6::uuid],$7,1,$8::jsonb,$10,$10,120,$9)`,
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
        proof.totalFen,
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
      `INSERT INTO matching_slot_assignments(id,need_id,slot_id,generation,intent_id,source_user_id,source_kind,source_id,amount_fen) VALUES($1,$2,$3,1,$4,$5,'LOCAL_BOOKING',$6,$7)`,
      [
        proof.assignmentId,
        proof.needId,
        proof.slotId,
        proof.intentId,
        proof.providerId,
        proof.bookingId,
        proof.totalFen,
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
  assert.equal(proof.before.trade.state.status, 'OPEN');
  assert.equal(proof.before.trade.state.termsStatus, 'ACTIVE');
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
  assert.equal(current.binding.slot_state, 'CONVERTED');
  assert.equal(current.binding.intent_status, 'CONVERTED');
  assert.equal(current.binding.source_id, proof.bookingId);
  assert.equal(current.binding.active, true);
  assert.equal(current.binding.amount_fen, proof.totalFen);
  assert.deepEqual(
    current.trade.identity,
    proof.before.trade.identity,
    'Source trade, fee terms, parties and frozen quote must survive',
  );
  if (quarantined) {
    assert.ok(current.quarantineAt, 'Quarantine must supply its durable database timestamp');
    // Exact old X12 quarantine transition: preserve every other source column.
    const { hash: sourceHash, ...sourceIdentityAndState } = current.source;
    assert.match(sourceHash, /^[a-f0-9]{64}$/);
    const { hash: beforeSourceHash, ...beforeSourceIdentityAndState } = proof.before.source;
    assert.match(beforeSourceHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      sourceIdentityAndState,
      {
        ...beforeSourceIdentityAndState,
        status: 'CANCELLED',
        reason: '恢复隔离取消未履约预约或转争议',
        version: proof.before.source.version + 1,
        change_request: null,
        checkin_hash: null,
        checkin_expires_at: null,
        updated_at: current.quarantineAt,
      },
      'Quarantine cancels the original booking without changing its immutable facts',
    );
    assert.deepEqual(
      current.reservations.map(({ hash, ...row }) => row),
      proof.before.reservations.map(({ hash, ...row }) => ({ ...row, active: false })),
      'Quarantine only releases source calendar reservations; their identities survive',
    );
    assert.deepEqual(
      current.trade.state,
      {
        status: 'SOURCE_CONFLICT',
        version: proof.before.trade.state.version + 1,
        updatedAt: current.quarantineAt,
        termsStatus: 'REVOKED',
        termsVersion: proof.before.trade.state.termsVersion + 1,
      },
      'Quarantine closes payment admission without altering the canonical binding',
    );
    assert.deepEqual(
      current.preferenceState,
      {
        discovery_enabled: false,
        contact_enabled: false,
        version: proof.before.preferenceState.version + 1,
        updated_at: current.quarantineAt,
      },
      'Restored discovery/contact consent must be closed',
    );
    assert.deepEqual(
      current.needState,
      {
        status: 'PAUSED',
        version: proof.before.needState.version + 1,
        latest_run_id: null,
        updated_at: current.quarantineAt,
      },
      'Restored active demand must pause and discard the current run pointer',
    );
    assert.equal(current.quarantined, true, 'Restore quarantine marker must be durable');
    assert.deepEqual(
      current.outbox,
      { ...proof.before.outbox, state: 'CANCELLED' },
      'Restore must stop pending matching delivery without deleting history',
    );
  } else {
    assert.deepEqual(
      current.fullRows,
      proof.before.fullRows,
      'Ordinary restore preserves all nine complete rows',
    );
    assert.deepEqual(
      current.source,
      proof.before.source,
      'Ordinary restore preserves the complete canonical source',
    );
    assert.deepEqual(
      current.reservations,
      proof.before.reservations,
      'Ordinary restore preserves all complete reservations',
    );
    assert.deepEqual(current.trade.state, proof.before.trade.state);
    assert.deepEqual(current.outbox, proof.before.outbox);
    assert.deepEqual(current.needState, proof.before.needState);
    assert.deepEqual(current.preferenceState, proof.before.preferenceState);
  }
  return {
    tables: MATCHING_RECOVERY_TABLES.length,
    sourcePreserved: true,
    budgetPreserved: true,
    canonicalTradePreserved: true,
    outboundDisabled: quarantined,
  };
}

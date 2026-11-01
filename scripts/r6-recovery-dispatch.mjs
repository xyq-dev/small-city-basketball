import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const zero = { serviceMinor: 0, travelMinor: 0, lodgingMinor: 0, platformMinor: 0, totalMinor: 0 };
const tables = {
  dispatch_preferences: ['provider_user_id', 'providerIds', ['enabled', 'version', 'updated_at']],
  dispatch_requests: [
    'id',
    'requestIds',
    ['status', 'winner_offer_id', 'next_batch_at', 'reason', 'version', 'updated_at'],
  ],
  dispatch_batches: ['id', 'batchIds', []],
  dispatch_offers: ['id', 'offerIds', ['status', 'reason', 'version', 'updated_at']],
  dispatch_holds: ['id', 'holdIds', ['state']],
  dispatch_command_receipts: ['command_id', 'commandIds', []],
  dispatch_events: ['id', 'eventIds', []],
  local_resource_reservations: ['id', 'reservationIds', ['active']],
  local_bookings: [
    'id',
    'bookingIds',
    [
      'status',
      'reason',
      'version',
      'updated_at',
      'change_request',
      'checkin_hash',
      'checkin_expires_at',
    ],
  ],
};
async function snapshot(readPool, saved) {
  const c = await readPool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const proof = {};
    for (const [table, [key, references, mutable]] of Object.entries(tables)) {
      const ids = saved[references];
      assert.ok(
        Array.isArray(ids) && ids.length && ids.every(uuid),
        `R6 dispatch requires exact ${references}`,
      );
      const rows = (
        await c.query(
          `SELECT ${key} AS id,
        encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS full_hash,
        encode(sha256(convert_to((to_jsonb(t)-$2::text[])::text,'UTF8')),'hex') AS identity_hash
        FROM ${table} t WHERE ${key}=ANY($1::uuid[]) ORDER BY ${key}`,
          [ids, mutable],
        )
      ).rows;
      assert.equal(rows.length, ids.length, `${table}: captured rows must remain`);
      proof[table] = {
        count: rows.length,
        full: hash(rows.map((r) => [r.id, r.full_hash])),
        identity: hash(rows.map((r) => [r.id, r.identity_hash])),
      };
    }
    const preferences = (
      await c.query(
        'SELECT provider_user_id,enabled FROM dispatch_preferences WHERE provider_user_id=ANY($1::uuid[]) ORDER BY provider_user_id',
        [saved.providerIds],
      )
    ).rows;
    const requests = (
      await c.query(
        'SELECT id,status,winner_offer_id,source_booking_id,next_batch_at FROM dispatch_requests WHERE id=ANY($1::uuid[]) ORDER BY id',
        [saved.requestIds],
      )
    ).rows;
    const offers = (
      await c.query(
        'SELECT id,status,quote_hash,travel_verified_by,source_booking_id FROM dispatch_offers WHERE id=ANY($1::uuid[]) ORDER BY id',
        [saved.offerIds],
      )
    ).rows;
    const holds = (
      await c.query(
        'SELECT id,state,source_booking_id FROM dispatch_holds WHERE id=ANY($1::uuid[]) ORDER BY id',
        [saved.holdIds],
      )
    ).rows;
    const resources = (
      await c.query(
        'SELECT id,active FROM local_resource_reservations WHERE id=ANY($1::uuid[]) ORDER BY id',
        [saved.reservationIds],
      )
    ).rows;
    const sources = (
      await c.query(
        "SELECT id,status,snapshot->'dispatchQuote'->>'quoteHash' AS quote_hash FROM local_bookings WHERE id=ANY($1::uuid[]) ORDER BY id",
        [saved.bookingIds],
      )
    ).rows;
    const batchCount = Number(
      (
        await c.query(
          'SELECT count(*) AS n FROM dispatch_batches WHERE request_id=ANY($1::uuid[])',
          [saved.requestIds],
        )
      ).rows[0].n,
    );
    const offerCount = Number(
      (
        await c.query(
          'SELECT count(*) AS n FROM dispatch_offers WHERE request_id=ANY($1::uuid[])',
          [saved.requestIds],
        )
      ).rows[0].n,
    );
    await c.query('COMMIT');
    return {
      proof,
      preferences,
      requests,
      offers,
      holds,
      resources,
      sources,
      batchCount,
      offerCount,
    };
  } catch (error) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

/** Explicitly synthetic data. Runtime services create every quote, hold and canonical source.
 * Only the isolated runner can call this; no provider, network request, payment or notification. */
export async function captureR6Dispatch(context) {
  const {
    runtimePool,
    readPool,
    state,
    databaseUrl,
    appOrigin,
    registerSynthetic,
    createLocalSource,
  } = context;
  const parsed = new URL(databaseUrl);
  assert.match(decodeURIComponent(parsed.pathname.slice(1)), /^scb_test_[A-Za-z0-9_]+$/);
  assert.ok(uuid(state?.orgId) && uuid(state?.userId) && state.cookie);
  assert.equal(typeof registerSynthetic, 'function');
  assert.equal(typeof createLocalSource, 'function');
  const { DispatchService } = await import('../apps/api/dist/dispatch-service.js');
  const { LocalServicesService } = await import('../apps/api/dist/local-services-service.js');
  const options = { databaseUrl, appOrigin, backgroundWorkersEnabled: false };
  const local = new LocalServicesService(runtimePool, options);
  const service = new DispatchService(runtimePool, options, {
    enabled: true,
    createLocalBooking: (c, a, i) => local.createDispatchBookingInTransaction(c, a, i),
  });
  const reviewer = await registerSynthetic('r6-dispatch-independent-reviewer');
  const proof = {
    version: 1,
    providerIds: [],
    requestIds: [],
    offerIds: [],
    batchIds: [],
    holdIds: [],
    commandIds: [],
    eventIds: [],
    bookingIds: [],
    reservationIds: [],
    heldRequestId: null,
    convertedRequestId: null,
    convertedOfferId: null,
    uncertainCommandId: null,
    quoteHash: null,
  };
  const command = () => {
    const id = randomUUID();
    proof.commandIds.push(id);
    return id;
  };
  try {
    for (const converted of [false, true]) {
      const supply = await createLocalSource(
        converted ? 'r6-dispatch-converted' : 'r6-dispatch-held',
        { book: false },
      );
      assert.notEqual(supply.provider.id, state.userId);
      const listing = (
        await readPool.query(
          'SELECT kind,org_id,region_id,region_catalog_version FROM local_listings WHERE id=$1',
          [supply.listingId],
        )
      ).rows[0];
      assert.ok(
        listing &&
          ['REFEREE', 'SCORER', 'RECORDER', 'STREAMER', 'PHOTOGRAPHER'].includes(listing.kind),
      );
      await runtimePool.query(
        "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN') ON CONFLICT(org_id,user_id) DO NOTHING",
        [listing.org_id, reviewer.id],
      );
      const now = new Date(
        (await readPool.query('SELECT clock_timestamp() AS now')).rows[0].now,
      ).getTime();
      assert.ok(
        Date.parse(supply.startsAt) > now + 3 * 3600000,
        'Dispatch recovery fixture needs future travel preparation',
      );
      const region = supply.region;
      await service.preference(supply.provider.cookie, {
        commandId: command(),
        expectedVersion: 0,
        enabled: true,
        regionIds: [region.regionId],
        dailyLimit: 3,
      });
      proof.providerIds.push(supply.provider.id);
      const created = await service.create(state.cookie, {
        commandId: command(),
        orgId: state.orgId,
        kind: listing.kind,
        serviceRegion: region,
        serviceAddress: supply.address,
        servicePoint: null,
        startsAt: supply.startsAt,
        endsAt: supply.endsAt,
        expiresAt: new Date(Date.parse(supply.startsAt) - 2 * 3600000).toISOString(),
        budget: zero,
        inviteRegionIds: [listing.region_id],
        allowCrossCity: true,
        people: 1,
      });
      proof.requestIds.push(created.resourceId);
      await service.requestCommand(state.cookie, created.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'START',
        reason: '隔离恢复演练明确同意有限站内邀请',
      });
      const detail = await service.detail(state.cookie, created.resourceId);
      const offer = detail.offers.find((o) => o.listingId === supply.listingId);
      assert.ok(offer, 'Recovery supply must be selected from real eligible inventory');
      const quote = {
        slotId: supply.slotId,
        ...zero,
        departureAt: new Date(Date.parse(supply.startsAt) - 3600000).toISOString(),
        arrivalAt: new Date(Date.parse(supply.startsAt) - 30 * 60000).toISOString(),
        returnAt: new Date(Date.parse(supply.endsAt) + 3600000).toISOString(),
        travelMethod: '隔离合成公益交通方案',
        travelEvidence: '仅隔离恢复演练，已核对合成班次与接驳时间的完整证据',
        terms: '合成公益零费用服务，完整报价经双方确认后转真实预约，取消改期留痕',
      };
      await service.offerCommand(supply.provider.cookie, offer.id, {
        commandId: command(),
        expectedVersion: 1,
        type: 'SUBMIT_QUOTE',
        reason: '服务方明确确认完整合成报价',
        quote,
      });
      const quoted = await service.offerDetail(supply.provider.cookie, offer.id);
      await service.offerCommand(reviewer.cookie, offer.id, {
        commandId: command(),
        expectedVersion: 2,
        type: 'VERIFY_TRAVEL',
        quoteHash: quoted.quoteHash,
        evidenceChecked: true,
        reason: '独立审核人核验合成报到及返程安排',
      });
      const acceptedCommandId = command();
      await service.offerCommand(supply.provider.cookie, offer.id, {
        commandId: acceptedCommandId,
        expectedVersion: 3,
        type: 'ACCEPT',
        quoteHash: quoted.quoteHash,
        reason: '本人接受合成报价并暂占完整旅行档期',
      });
      if (!converted) {
        proof.heldRequestId = created.resourceId;
        proof.uncertainCommandId = acceptedCommandId;
      } else {
        const current = (await service.detail(state.cookie, created.resourceId)).request;
        const result = await service.requestCommand(state.cookie, created.resourceId, {
          commandId: command(),
          expectedVersion: current.version,
          type: 'CONFIRM_QUOTE',
          quoteHash: quoted.quoteHash,
          acceptedTermsId: quoted.quoteHash,
          chargeConsent: true,
          reason: '客户明确同意当前完整报价并转真实预约',
        });
        assert.ok(uuid(result.sourceBookingId));
        await local.bookingCommand(supply.provider.cookie, result.sourceBookingId, {
          commandId: randomUUID(),
          expectedVersion: 1,
          type: 'ACCEPT',
          reason: '真实源预约经服务方本人确认',
        });
        proof.bookingIds.push(result.sourceBookingId);
        proof.convertedRequestId = created.resourceId;
        proof.convertedOfferId = offer.id;
        proof.quoteHash = quoted.quoteHash;
      }
    }
    await service.dispatchDue();
    for (const [table, key] of [
      ['dispatch_offers', 'offerIds'],
      ['dispatch_batches', 'batchIds'],
      ['dispatch_holds', 'holdIds'],
      ['dispatch_events', 'eventIds'],
    ]) {
      proof[key] = (
        await readPool.query(
          `SELECT id FROM ${table} WHERE request_id=ANY($1::uuid[]) ORDER BY id`,
          [proof.requestIds],
        )
      ).rows.map((r) => r.id);
    }
    // Preference evidence has no request_id and must also remain in the immutable audit.
    const preferenceEvents = (
      await readPool.query(
        "SELECT id FROM dispatch_events WHERE request_id IS NULL AND actor_id=ANY($1::uuid[]) AND action='PREFERENCE' ORDER BY id",
        [proof.providerIds],
      )
    ).rows.map((r) => r.id);
    proof.eventIds = [...new Set([...proof.eventIds, ...preferenceEvents])].sort();
    proof.reservationIds = (
      await readPool.query(
        'SELECT id FROM local_resource_reservations WHERE dispatch_offer_id=ANY($1::uuid[]) OR booking_id=ANY($2::uuid[]) ORDER BY id',
        [proof.offerIds, proof.bookingIds],
      )
    ).rows.map((r) => r.id);
    const retained = await snapshot(readPool, proof);
    assert.ok(retained.offers.some((o) => o.status === 'ACCEPTED_HELD'));
    assert.ok(retained.holds.some((h) => h.state === 'ACTIVE'));
    assert.ok(retained.holds.some((h) => h.state === 'CONVERTED'));
    assert.equal(retained.sources[0].status, 'CONFIRMED');
    assert.equal(retained.sources[0].quote_hash, proof.quoteHash);
    proof.hashes = retained.proof;
    proof.batchCount = retained.batchCount;
    proof.offerCount = retained.offerCount;
    return { proof };
  } finally {
    service.close();
  }
}

export async function verifyR6Dispatch({ readPool, saved, quarantined = false }) {
  const proof = saved?.proof ?? saved;
  assert.equal(proof?.version, 1);
  for (const id of [
    'heldRequestId',
    'convertedRequestId',
    'convertedOfferId',
    'uncertainCommandId',
  ])
    assert.ok(uuid(proof[id]));
  assert.match(proof.quoteHash, /^[0-9a-f]{64}$/);
  const current = await snapshot(readPool, proof);
  assert.equal(
    current.batchCount,
    proof.batchCount,
    'Restart/quarantine must not send a new invitation batch',
  );
  assert.equal(
    current.offerCount,
    proof.offerCount,
    'Restart/quarantine must not create replacement personnel',
  );
  for (const [table, actual] of Object.entries(current.proof)) {
    const expected = proof.hashes[table];
    assert.ok(expected?.count > 0, `${table}: recovery requires nonempty captured evidence`);
    assert.equal(actual.count, expected.count);
    assert.equal(
      actual.identity,
      expected.identity,
      `${table}: immutable quotes, actor/source identities and receipts must survive`,
    );
    if (!quarantined)
      assert.equal(actual.full, expected.full, `${table}: exact restart state must survive`);
  }
  assert.equal(current.sources[0].quote_hash, proof.quoteHash);
  assert.equal(current.offers.find((o) => o.id === proof.convertedOfferId).status, 'CONVERTED');
  if (quarantined) {
    assert.ok(current.preferences.every((p) => !p.enabled));
    assert.ok(
      current.requests.every((r) => !['DRAFT', 'INVITING', 'REVIEWING'].includes(r.status)),
    );
    assert.ok(current.requests.every((r) => r.next_batch_at === null));
    assert.ok(
      current.offers.every(
        (o) => !['PENDING', 'TRAVEL_REVIEW', 'READY', 'ACCEPTED_HELD'].includes(o.status),
      ),
    );
    assert.ok(current.holds.every((h) => h.state !== 'ACTIVE'));
    assert.ok(current.resources.every((r) => !r.active));
    assert.equal(current.sources[0].status, 'CANCELLED');
  } else {
    assert.ok(current.preferences.every((p) => p.enabled));
    assert.ok(current.holds.some((h) => h.state === 'ACTIVE'));
    assert.equal(current.sources[0].status, 'CONFIRMED');
  }
  return { tables: current.proof, uncertainReceiptRetained: true, newInvitations: 0 };
}

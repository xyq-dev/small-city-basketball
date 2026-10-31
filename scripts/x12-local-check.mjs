import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
const future = (now, minutes) => new Date(now.getTime() + minutes * 60000).toISOString();
const serviceRoot = '/v1/local-services/listings/';
function requireState(state) {
  assert.ok(state?.orgId && state.cookie, 'X12 needs the existing isolated owner session');
  assert.ok(state.registration?.leaderCookie, 'X12 needs the existing independent buyer session');
  assert.ok(state.scoring?.writerCookie, 'X12 needs the existing independent away manager');
  assert.ok(
    state.commerce?.operators?.[0]?.cookie,
    'X12 needs a real independent platform reviewer',
  );
}
async function preservedRows(readPool, saved) {
  const [ledger, receipts, history] = await Promise.all([
    readPool.query(
      'SELECT id,resource_key,booking_id,matchup_id,starts_at,ends_at,active FROM local_resource_reservations WHERE booking_id=ANY($1::uuid[]) OR matchup_id=$2 ORDER BY id',
      [saved.supplies.map((r) => r.bookingId), saved.matchupId],
    ),
    readPool.query(
      'SELECT actor_id,command_id,request_hash,result FROM local_command_receipts WHERE command_id=ANY($1::uuid[]) ORDER BY command_id',
      [saved.commandIds],
    ),
    readPool.query(
      'SELECT id,actor_id,resource_id,action,version,reason,created_at FROM local_service_history WHERE id=ANY($1::uuid[]) ORDER BY id',
      [saved.historyIds],
    ),
  ]);
  return { ledger: ledger.rows, receipts: receipts.rows, history: history.rows };
}
/** Real HTTP/runtime SQL fixture. Saved state contains references, versions and hashes only. */
export async function captureX12Local({ call, state, readPool, assertPublicMissing }) {
  requireState(state);
  assert.equal(typeof assertPublicMissing, 'function');
  const owner = (await call('/v1/auth/session', { cookie: state.cookie })).data.user;
  const buyer = (await call('/v1/auth/session', { cookie: state.registration.leaderCookie })).data
    .user;
  const away = (await call('/v1/auth/session', { cookie: state.scoring.writerCookie })).data.user;
  const reviewer = state.commerce.operators[0];
  assert.notEqual(owner.id, buyer.id);
  assert.notEqual(buyer.id, away.id);
  assert.notEqual(reviewer.userId, owner.id);
  const catalog = (await call('/v1/public/regions')).data;
  const county = catalog.regions.find((r) => r.level === 'COUNTY');
  assert.ok(county && catalog.catalogVersion, 'X12 needs a real current region catalog node');
  const region = { catalogVersion: catalog.catalogVersion, regionId: county.id };
  const org = `/v1/orgs/${state.orgId}`;
  const unique = randomUUID().slice(0, 8);
  const teams = [];
  for (const [label, userId] of [
    ['主队', buyer.id],
    ['客队', away.id],
  ]) {
    const team = (
      await call(`${org}/teams`, {
        method: 'POST',
        cookie: state.cookie,
        body: { name: `合成同城${label}-${unique}` },
      })
    ).data;
    await call(`${org}/teams/${team.id}/grants/${userId}`, {
      method: 'PUT',
      cookie: state.cookie,
      body: { status: 'ACTIVE' },
    });
    teams.push(team.id);
  }
  const court = (
    await call(`${org}/courts`, {
      method: 'POST',
      cookie: state.cookie,
      body: { name: `合成同城经营球场-${unique}` },
    })
  ).data;
  const now = new Date((await readPool.query('SELECT clock_timestamp() AS now')).rows[0].now);
  const commandIds = [];
  async function send(path, cookie, body) {
    const commandId = randomUUID();
    const result = await call(path, { method: 'POST', cookie, body: { ...body, commandId } });
    commandIds.push(commandId);
    return result.data;
  }
  const supplies = [];
  for (const [kind, startMinutes] of [
    ['COURT', 15],
    ['REFEREE', 150],
  ]) {
    const created = await send(`${org}/local-services/listings`, state.cookie, {
      kind,
      title: `合成${kind === 'COURT' ? '球场' : '裁判服务'}-${unique}`,
      description: '仅隔离恢复与运行身份验证的合成供给，不含真实人员资料',
      address: '合成公共体育场馆测试地址',
      region,
      point: null,
      coverageRegionIds: [county.id],
      providerUserId: owner.id,
      courtId: kind === 'COURT' ? court.id : null,
      qualificationNote: '合成经营授权、实际服务人员与范围均需独立审核后发布',
      terms: '按已确认时间与实际地址提供服务；天气取消和改期须保留原因。此版本不收款。',
    });
    const listingId = created.resourceId;
    await assertPublicMissing(`/v1/public/local-listings/${listingId}`);
    await send(`${serviceRoot}${listingId}/commands`, state.cookie, {
      type: 'SUBMIT',
      expectedVersion: 1,
      reason: '向独立合成审核者提交经营与必要资格资料',
    });
    await send(`${serviceRoot}${listingId}/commands`, reviewer.cookie, {
      type: 'APPROVE',
      expectedVersion: 2,
      reason: '独立核对合成主体、必要资格、真实地区与覆盖范围',
      qualificationChecked: true,
      scopeChecked: true,
      qualifiedUntil: future(now, 30 * 24 * 60),
    });
    await send(`${serviceRoot}${listingId}/commands`, state.cookie, {
      type: 'PUBLISH',
      expectedVersion: 3,
      reason: '公开已独立审核的隔离合成供给',
    });
    const slot = await send(`${serviceRoot}${listingId}/slots`, state.cookie, {
      expectedVersion: 4,
      startsAt: future(now, startMinutes),
      endsAt: future(now, startMinutes + 60),
    });
    const booked = await send('/v1/local-bookings', state.registration.leaderCookie, {
      listingId,
      slotId: slot.slotId,
      serviceRegion: region,
      acceptedTerms: true,
      ...(kind === 'COURT' ? {} : { serviceAddress: '需求方明确确认的合成比赛服务场馆' }),
    });
    await send(
      `/v1/local-bookings/${booked.resourceId}/commands`,
      kind === 'COURT' ? state.registration.leaderCookie : state.cookie,
      {
        type: kind === 'COURT' ? 'CONFIRM' : 'ACCEPT',
        expectedVersion: 1,
        reason: '真实双方确认本次合成时段与服务地址',
      },
    );
    supplies.push({ kind, listingId, slotId: slot.slotId, bookingId: booked.resourceId });
  }
  const courtSupply = supplies.find((r) => r.kind === 'COURT');
  const matchup = await send('/v1/local-matchups', state.registration.leaderCookie, {
    homeOrgId: state.orgId,
    homeTeamId: teams[0],
    awayOrgId: state.orgId,
    awayTeamId: teams[1],
    courtBookingId: courtSupply.bookingId,
    terms: '两名独立合成领队确认球队、到场时间与实际场地；不写入正式赛事赛程。',
  });
  await send(`/v1/local-matchups/${matchup.resourceId}/commands`, state.scoring.writerCookie, {
    type: 'CONFIRM',
    expectedVersion: 1,
    reason: '受邀球队由独立领队核对实际场地与时间后确认',
  });
  const currentCourt = (
    await call(`/v1/local-bookings/${courtSupply.bookingId}`, {
      cookie: state.registration.leaderCookie,
    })
  ).data;
  const issued = await send(
    `/v1/local-bookings/${courtSupply.bookingId}/checkin`,
    state.registration.leaderCookie,
    {
      expectedVersion: currentCourt.version,
    },
  );
  let code = issued.checkin?.code;
  assert.ok(
    typeof code === 'string' && /^[0-9a-f]{32}$/.test(code),
    'X12 must actually issue a one-time code',
  );
  const checkinHash = tokenHash(code);
  code = undefined;
  issued.checkin = null;
  const nonce = (
    await readPool.query('SELECT checkin_hash FROM local_bookings WHERE id=$1', [
      courtSupply.bookingId,
    ])
  ).rows[0];
  assert.equal(nonce.checkin_hash, checkinHash, 'Only the one-way code hash is retained');
  const saved = {
    orgId: state.orgId,
    providerUserId: owner.id,
    buyerUserId: buyer.id,
    awayManagerUserId: away.id,
    reviewerUserId: reviewer.userId,
    courtId: court.id,
    teamIds: teams,
    supplies,
    matchupId: matchup.resourceId,
    commandIds,
    checkinHash,
  };
  for (const row of supplies) {
    const detail = (await call(`${serviceRoot}${row.listingId}`, { cookie: state.cookie })).data;
    const publicDetail = (await call(`/v1/public/local-listings/${row.listingId}`)).data;
    const booking = (
      await call(`/v1/local-bookings/${row.bookingId}`, { cookie: state.registration.leaderCookie })
    ).data;
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal(booking.kind, row.kind);
    assert.equal(booking.paymentStatus, 'NOT_ENABLED');
    assert.equal(detail.listing.published, true);
    row.listingVersion = detail.listing.version;
    row.slotVersion = detail.slots.find((s) => s.id === row.slotId).version;
    row.bookingVersion = booking.version;
    row.privateHash = sha(detail);
    row.publicListingHash = sha(publicDetail.listing);
    row.bookingHash = sha(booking);
  }
  const match = (
    await call('/v1/local-matchups', { cookie: state.registration.leaderCookie })
  ).data.items.find((r) => r.id === saved.matchupId);
  assert.equal(match.status, 'CONFIRMED');
  assert.equal(match.awayConfirmed, true);
  saved.matchupVersion = match.version;
  saved.matchupHash = sha(match);
  const resources = supplies
    .flatMap((s) => [s.listingId, s.slotId, s.bookingId])
    .concat(saved.matchupId);
  saved.historyIds = (
    await readPool.query(
      'SELECT id FROM local_service_history WHERE resource_id=ANY($1::uuid[]) ORDER BY id',
      [resources],
    )
  ).rows.map((r) => r.id);
  const rows = await preservedRows(readPool, saved);
  assert.equal(rows.ledger.length, 4, 'Court, provider and both distinct teams must be occupied');
  assert.ok(rows.ledger.every((r) => r.active));
  assert.equal(rows.receipts.length, commandIds.length);
  assert.ok(rows.history.length >= commandIds.length);
  saved.ledgerHash = sha(rows.ledger);
  saved.receiptsHash = sha(rows.receipts);
  saved.historyHash = sha(rows.history);
  // New isolated team grants legitimately change these sessions' team contexts.
  state.registration.leaderSession = (
    await call('/v1/auth/session', { cookie: state.registration.leaderCookie })
  ).data;
  if (state.scoring.writerSession)
    state.scoring.writerSession = (
      await call('/v1/auth/session', { cookie: state.scoring.writerCookie })
    ).data;
  const serialized = JSON.stringify(saved);
  for (const secret of [
    state.cookie,
    state.registration.leaderCookie,
    state.scoring.writerCookie,
    reviewer.cookie,
  ])
    assert.equal(serialized.includes(secret), false, 'X12 saved state must not contain a session');
  assert.equal(
    /"(?:cookie|code|checkinCode|latitude|longitude|point)"\s*:/.test(serialized),
    false,
  );
  return saved;
}

export async function verifyX12Local({ call, state, readPool, saved, assertPublicMissing }) {
  requireState(state);
  assert.equal(typeof assertPublicMissing, 'function');
  for (const row of saved.supplies) {
    const detail = (await call(`${serviceRoot}${row.listingId}`, { cookie: state.cookie })).data;
    const publicDetail = (await call(`/v1/public/local-listings/${row.listingId}`)).data;
    const booking = (
      await call(`/v1/local-bookings/${row.bookingId}`, { cookie: state.registration.leaderCookie })
    ).data;
    assert.equal(
      sha(detail),
      row.privateHash,
      'Local reviewed supply and immutable slots must survive restart',
    );
    assert.equal(sha(publicDetail.listing), row.publicListingHash);
    assert.equal(sha(booking), row.bookingHash);
  }
  const match = (
    await call('/v1/local-matchups', { cookie: state.registration.leaderCookie })
  ).data.items.find((r) => r.id === saved.matchupId);
  assert.ok(match, 'Confirmed X12 matchup must remain accessible after restart');
  assert.equal(sha(match), saved.matchupHash);
  const rows = await preservedRows(readPool, saved);
  assert.equal(sha(rows.ledger), saved.ledgerHash);
  assert.equal(sha(rows.receipts), saved.receiptsHash);
  assert.equal(sha(rows.history), saved.historyHash);
  const nonce = (
    await readPool.query('SELECT checkin_hash FROM local_bookings WHERE id=$1', [
      saved.supplies.find((r) => r.kind === 'COURT').bookingId,
    ])
  ).rows[0];
  assert.equal(nonce.checkin_hash, saved.checkinHash);
  if (saved.completedService) {
    const completed = saved.completedService;
    const booking = (
      await call(`/v1/local-bookings/${completed.bookingId}`, {
        cookie: state.registration.leaderCookie,
      })
    ).data;
    assert.equal(sha(booking), completed.bookingHash);
    const rows = await completedEvidence(readPool, completed);
    assert.equal(sha(rows.receipts), completed.receiptsHash);
    assert.equal(sha(rows.history), completed.historyHash);
    assert.equal(sha(rows.ledger), completed.ledgerHash);
  }
}

export async function verifyX12LocalQuarantine({ readPool, saved, assertPublicMissing }) {
  assert.equal(typeof assertPublicMissing, 'function');
  const listings = (
    await readPool.query(
      'SELECT id,status,published,version FROM local_listings WHERE id=ANY($1::uuid[])',
      [saved.supplies.map((r) => r.listingId)],
    )
  ).rows;
  const slots = (
    await readPool.query('SELECT id,status,version FROM local_slots WHERE id=ANY($1::uuid[])', [
      saved.supplies.map((r) => r.slotId),
    ])
  ).rows;
  const bookings = (
    await readPool.query(
      'SELECT id,status,version,change_request,checkin_hash,checkin_expires_at FROM local_bookings WHERE id=ANY($1::uuid[])',
      [saved.supplies.map((r) => r.bookingId)],
    )
  ).rows;
  assert.equal(listings.length, 2);
  assert.equal(slots.length, 2);
  assert.equal(bookings.length, 2);
  for (const row of saved.supplies) {
    const listing = listings.find((r) => r.id === row.listingId),
      slot = slots.find((r) => r.id === row.slotId),
      booking = bookings.find((r) => r.id === row.bookingId);
    assert.equal(listing.status, 'SUSPENDED');
    assert.equal(listing.published, false);
    assert.ok(listing.version > row.listingVersion);
    assert.equal(slot.status, 'CLOSED');
    assert.ok(slot.version > row.slotVersion);
    assert.equal(booking.status, 'CANCELLED');
    assert.ok(booking.version > row.bookingVersion);
    assert.equal(booking.change_request, null);
    assert.equal(booking.checkin_hash, null);
    assert.equal(booking.checkin_expires_at, null);
    await assertPublicMissing(`/v1/public/local-listings/${row.listingId}`);
  }
  const matchup = (
    await readPool.query('SELECT status,version FROM local_matchups WHERE id=$1', [saved.matchupId])
  ).rows[0];
  assert.equal(matchup.status, 'CANCELLED');
  assert.ok(matchup.version > saved.matchupVersion);
  const rows = await preservedRows(readPool, saved);
  assert.equal(rows.ledger.length, 4);
  assert.ok(rows.ledger.every((r) => !r.active));
  assert.equal(
    sha(rows.receipts),
    saved.receiptsHash,
    'Recovery must retain original command receipts',
  );
  assert.equal(
    sha(rows.history),
    saved.historyHash,
    'Recovery must retain immutable original fulfillment audit',
  );
  if (saved.completedService) {
    const completed = saved.completedService;
    const booking = (
      await readPool.query(
        'SELECT status,version,checkin_hash,checkin_expires_at FROM local_bookings WHERE id=$1',
        [completed.bookingId],
      )
    ).rows[0];
    assert.equal(booking.status, 'COMPLETED');
    assert.equal(booking.version, completed.version);
    assert.equal(booking.checkin_hash, null);
    assert.equal(booking.checkin_expires_at, null);
    const slot = (
      await readPool.query('SELECT status,version FROM local_slots WHERE id=$1', [completed.slotId])
    ).rows[0];
    assert.equal(slot.status, 'CLOSED');
    assert.ok(slot.version > completed.slotVersion);
    const rows = await completedEvidence(readPool, completed);
    assert.equal(sha(rows.receipts), completed.receiptsHash);
    assert.equal(sha(rows.history), completed.historyHash);
    assert.equal(rows.ledger.length, 1);
    assert.ok(rows.ledger.every((r) => !r.active));
  }
}

async function completedEvidence(readPool, saved) {
  const [receipts, history, ledger] = await Promise.all([
    readPool.query(
      'SELECT actor_id,command_id,request_hash,result FROM local_command_receipts WHERE command_id=ANY($1::uuid[]) ORDER BY command_id',
      [saved.commandIds],
    ),
    readPool.query(
      'SELECT id,actor_id,resource_id,action,version,reason,created_at FROM local_service_history WHERE id=ANY($1::uuid[]) ORDER BY id',
      [saved.historyIds],
    ),
    readPool.query(
      'SELECT id,resource_key,booking_id,starts_at,ends_at,active FROM local_resource_reservations WHERE booking_id=$1 ORDER BY id',
      [saved.bookingId],
    ),
  ]);
  return { receipts: receipts.rows, history: history.rows, ledger: ledger.rows };
}

/** Optional bounded verification of an existing short personnel fulfillment flow, via HTTP only. */
export async function captureX12CompletedService({ call, state, readPool, saved }) {
  requireState(state);
  assert.ok(saved?.supplies, 'Create the normal X12 supply fixture first');
  const supply = saved.supplies.find((r) => r.kind === 'REFEREE');
  assert.ok(supply, 'Create the normal X12 supply fixture first');
  const detail = (await call(`${serviceRoot}${supply.listingId}`, { cookie: state.cookie })).data;
  const now = new Date((await readPool.query('SELECT clock_timestamp() AS now')).rows[0].now);
  const startsAt = new Date(now.getTime() + 15000).toISOString();
  const endsAt = new Date(now.getTime() + 22000).toISOString();
  const deadline = now.getTime() + 30000;
  const monotonicDeadline = performance.now() + 30000;
  const commandIds = [];
  async function send(path, cookie, body) {
    const commandId = randomUUID();
    const result = await call(path, { method: 'POST', cookie, body: { ...body, commandId } });
    commandIds.push(commandId);
    return result.data;
  }
  async function waitForDb(target) {
    for (;;) {
      const current = new Date(
        (await readPool.query('SELECT clock_timestamp() AS now')).rows[0].now,
      ).getTime();
      assert.ok(
        current <= deadline && performance.now() <= monotonicDeadline,
        'Bounded X12 completion exceeded its 30-second deadline',
      );
      if (current >= target) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, target - current)));
    }
  }
  const slot = await send(`${serviceRoot}${supply.listingId}/slots`, state.cookie, {
    expectedVersion: detail.listing.version,
    startsAt,
    endsAt,
  });
  const booking = await send('/v1/local-bookings', state.registration.leaderCookie, {
    listingId: supply.listingId,
    slotId: slot.slotId,
    serviceRegion: detail.listing.region,
    acceptedTerms: true,
    serviceAddress: '仅隔离权限与恢复验证的合成短时服务场馆',
  });
  const path = `/v1/local-bookings/${booking.resourceId}`;
  await send(`${path}/commands`, state.cookie, {
    type: 'ACCEPT',
    expectedVersion: 1,
    reason: '实际提供者本人接取隔离合成短时服务',
  });
  await waitForDb(Date.parse(startsAt));
  await send(`${path}/commands`, state.cookie, {
    type: 'ARRIVE',
    expectedVersion: 2,
    reason: '实际提供者在数据库服务时段开始后登记合成到场',
  });
  await send(`${path}/commands`, state.cookie, {
    type: 'DELIVER',
    expectedVersion: 3,
    reason: '实际提供者登记短时合成服务交付，等待需求方确认',
  });
  await waitForDb(Date.parse(endsAt));
  await send(`${path}/commands`, state.registration.leaderCookie, {
    type: 'COMPLETE',
    expectedVersion: 4,
    reason: '需求方在数据库服务时段结束后确认合成服务完成',
  });
  const completed = (await call(path, { cookie: state.registration.leaderCookie })).data;
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.kind, 'REFEREE');
  assert.equal(completed.version, 5);
  const evidence = {
    sourceKind: 'LOCAL_BOOKING',
    sourceId: booking.resourceId,
    bookingId: booking.resourceId,
    version: completed.version,
    bookingHash: sha(completed),
    listingId: supply.listingId,
    slotId: slot.slotId,
    slotVersion: 1,
    buyerUserId: saved.buyerUserId,
    providerUserId: saved.providerUserId,
    commandIds,
    historyIds: (
      await readPool.query(
        'SELECT id FROM local_service_history WHERE resource_id=ANY($1::uuid[]) ORDER BY id',
        [[slot.slotId, booking.resourceId]],
      )
    ).rows.map((r) => r.id),
  };
  const rows = await completedEvidence(readPool, evidence);
  assert.equal(rows.receipts.length, commandIds.length);
  assert.equal(rows.history.length, commandIds.length);
  assert.equal(rows.ledger.length, 1);
  evidence.receiptsHash = sha(rows.receipts);
  evidence.historyHash = sha(rows.history);
  evidence.ledgerHash = sha(rows.ledger);
  // This extra slot changes the original private detail, while the two original
  // confirmed inventory contracts and their ledger/receipt/history hashes remain intact.
  supply.privateHash = sha(
    (await call(`${serviceRoot}${supply.listingId}`, { cookie: state.cookie })).data,
  );
  saved.completedService = evidence;
  return evidence;
}

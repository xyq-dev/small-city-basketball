import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, device, http, register, signIn, startServer, tap } from './support.mjs';

// Booking extension against the real API: player profile -> independent platform review ->
// leader selects/compares/books (with a lost response recovered by the original command) ->
// player accepts -> player arrives -> leader confirms completion. No payment is involved.
let server, call, org, ownerCookie;
const pad = (v) => String(v).padStart(2, '0');
function china(ms) {
  const d = new Date(ms + 8 * 3600000);
  return {
    date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
    time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
  };
}

before(async () => {
  server = await startServer();
  call = http(server);
  org = (
    await server.bootstrapOwner({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: '合成负责人',
      organizationName: '合成高州篮协',
    })
  ).organizationId;
  ownerCookie = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.test', password: PASSWORD },
    })
  ).cookie;
});
after(async () => {
  await server?.close();
});

async function playerProfile(d, name, price) {
  const center = d.open('pages/player-center/index');
  await d.settle(center);
  assert.equal(center.page.data.authorized, true, center.page.data.error);
  center.page.edit(tap({}));
  for (const [field, value] of [
    ['displayName', name],
    ['heightCm', '182'],
    ['city', '合成高州'],
    ['bio', '合成资料，仅用于隔离联调'],
    ['price', price],
    ['travel', '0.00'],
    ['accommodation', '0.00'],
  ])
    center.page.input(tap({ field }, { value }));
  center.page.position(tap({}, { value: 0 }));
  center.page.addWindow();
  const until = china(Date.now() + 5 * 86400000);
  center.page.windowInput(tap({ field: 'startTime', index: 0 }, { value: '00:00' }));
  center.page.windowInput(tap({ field: 'endDate', index: 0 }, { value: until.date }));
  center.page.windowInput(tap({ field: 'endTime', index: 0 }, { value: '23:00' }));
  center.page.consent(tap({}, { value: ['yes'] }));
  await center.page.save();
  await d.settle(center);
  assert.equal(center.page.data.profile?.status ?? 'PENDING', 'PENDING', center.page.data.error);
  assert.equal(center.page.data.error, '');
  return center;
}

test('booking extension runs from selection to per-appearance completion on the real API', async () => {
  const root = `/v1/orgs/${org}`;
  const operatorDevice = device(server);
  await register(operatorDevice, 'operator@example.test', '合成平台运营');
  await server.grantOperator('operator@example.test');
  const leaderDevice = device(server);
  await register(leaderDevice, 'leader@example.test', '合成领队');
  const playerA = device(server);
  await register(playerA, 'player-a@example.test', '合成球员甲');
  const playerB = device(server);
  await register(playerB, 'player-b@example.test', '合成球员乙');
  const leaderId = (await leaderDevice.client.request('/v1/auth/session')).data.user.id;

  // A long-term team the leader manages (Web setup + leader's acceptance).
  const team = (
    await call(`${root}/teams`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { name: '合成石鼓青锋' },
    })
  ).data;
  const issued = (
    await call(`${root}/teams/${team.id}/invitations`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { targetUserId: leaderId, expiresInHours: 1 },
    })
  ).data;
  await leaderDevice.client.request(`/v1/invitations/${issued.invitation.id}/accept`, 'POST', {
    token: issued.token,
  });

  // Players publish profiles; an independent platform operator approves them.
  await playerProfile(playerA, '合成林越', '300.00');
  await playerProfile(playerB, '合成陈凯', '300.00');
  await signIn(operatorDevice, 'operator@example.test');
  const platform = operatorDevice.open('pages/platform/index');
  await operatorDevice.settle(platform);
  assert.equal(platform.page.data.allowed, true, platform.page.data.error);
  assert.equal(platform.page.data.reviewQueue.length, 2);
  for (const profile of platform.page.raw.reviewQueue.slice()) {
    platform.page.review(tap({ id: profile.id }));
    platform.page.status(tap({}, { value: 0 }));
    platform.page.reason(tap({}, { value: '资料核对一致' }));
    platform.page.agree(tap({}, { value: ['yes'] }));
    await platform.page.submitReview();
    await operatorDevice.settle(platform);
    assert.equal(platform.page.data.error, '');
  }

  // Leader: market -> select both -> same-price comparison -> book the first.
  await signIn(leaderDevice, 'leader@example.test');
  const market = leaderDevice.open('pages/players/index');
  await leaderDevice.settle(market);
  assert.equal(market.page.data.cards.length, 2, market.page.data.error);
  for (const card of market.page.data.cards) market.page.toggle(tap({ id: card.id }));
  market.page.compare();
  const compareUrl = leaderDevice.navigations.at(-1);
  const ids = /ids=([^&]+)/.exec(compareUrl)[1];
  const compare = leaderDevice.open('pages/compare/index', { ids: decodeURIComponent(ids) });
  await leaderDevice.settle(compare);
  assert.equal(compare.page.data.profiles.length, 2, compare.page.data.error);
  const chosen = compare.page.data.profiles.find((p) => /林越/.test(p.displayName ?? p.name));
  compare.page.book(tap({ id: chosen.id }));
  assert.match(leaderDevice.navigations.at(-1), /booking-create\/index\?playerId=/);

  const create = leaderDevice.open('pages/booking-create/index', { playerId: chosen.id });
  await leaderDevice.settle(create);
  assert.equal(create.page.data.ready, true, create.page.data.error);
  create.page.input(tap({ field: 'eventName' }, { value: '合成青锋杯' }));
  // A real, very short appearance: report ~2 minutes ahead, one minute long. Arrival opens
  // 30 minutes before reporting; completion opens after the end. Times are never rewritten.
  const reportMs = Math.ceil((Date.now() + 90000) / 60000) * 60000;
  const endMs = reportMs + 60000;
  const report = china(reportMs);
  const start = report;
  const end = china(endMs);
  for (const [field, value] of [
    ['label', '小组赛第1场'],
    ['venue', '合成石鼓公园球场'],
    ['reportDate', report.date],
    ['reportTime', report.time],
    ['startDate', start.date],
    ['startTime', start.time],
    ['endDate', end.date],
    ['endTime', end.time],
  ])
    create.page.slotInput(tap({ index: 0, field }, { value }));
  await create.page.review();
  await leaderDevice.settle(create);
  assert.equal(create.page.data.review, true, create.page.data.error);
  create.page.consent(tap({}, { value: ['agree'] }));
  // The order is created but the response is lost: recovery resends the original command.
  leaderDevice.dropNextResponse(
    (o) => o.method === 'POST' && o.url.endsWith('/v1/player-bookings/orders'),
  );
  await create.page.submit();
  await leaderDevice.settle(create);
  assert.equal(create.page.data.pending, true, 'unknown result keeps the original request');
  await create.page.recover();
  await leaderDevice.settle(create);
  assert.equal(create.page.data.success, true, create.page.data.error);
  const orderId = create.page.data.successOrderId;
  const workspace = (await leaderDevice.client.request('/v1/player-bookings/workspace')).data;
  assert.equal(
    workspace.orders.filter((o) => o.eventName === '合成青锋杯').length,
    1,
    'exactly one order despite the lost response',
  );

  // Player A accepts the request for this appearance.
  await signIn(playerA, 'player-a@example.test');
  const received = playerA.open('pages/booking-detail/index', { id: orderId, view: 'received' });
  await playerA.settle(received);
  assert.ok(
    received.page.data.order,
    JSON.stringify({
      e: received.page.data.error,
      m: received.page.data.message,
      l: received.page.data.loading,
    }),
  );
  const appearance = received.page.data.order.appearances[0];
  await received.page.chooseAction(tap({ id: appearance.id, type: 'ACCEPT' }));
  received.page.confirm(tap({}, { value: ['yes'] }));
  assert.equal(received.page.data.canSubmit, true, received.page.data.validation);
  playerA.approve();
  await received.page.submit();
  await playerA.settle(received);
  assert.equal(
    received.page.data.order.appearances[0].status,
    'ACCEPTED',
    received.page.data.error,
  );

  // Arrival opens 30 minutes before the report time.
  await received.page.chooseAction(tap({ id: appearance.id, type: 'ARRIVE' }));
  received.page.confirm(tap({}, { value: ['yes'] }));
  playerA.approve();
  await received.page.submit();
  await playerA.settle(received);
  assert.equal(received.page.data.order.appearances[0].status, 'ARRIVED', received.page.data.error);

  // Leader confirms this appearance completed once it has actually ended.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, endMs + 2000 - Date.now())));
  const sent = leaderDevice.open('pages/booking-detail/index', { id: orderId, view: 'sent' });
  await leaderDevice.settle(sent);
  await sent.page.chooseAction(tap({ id: appearance.id, type: 'COMPLETE' }));
  sent.page.confirm(tap({}, { value: ['yes'] }));
  leaderDevice.approve();
  await sent.page.submit();
  await leaderDevice.settle(sent);
  const done = sent.page.data.order.appearances[0];
  assert.equal(done.status, 'COMPLETED', sent.page.data.error);
  const final = (await leaderDevice.client.request('/v1/player-bookings/orders/' + orderId)).data;
  assert.equal(final.appearances[0].paymentStatus, 'UNAVAILABLE');

  // Account switch: the leader's private order page clears.
  const account = leaderDevice.open('pages/account/index');
  await leaderDevice.settle(account);
  account.page.switchAccount();
  await leaderDevice.settle(account);
  assert.equal(sent.page.data.order, null);
});

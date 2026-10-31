import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { device, organizationFixture, register, signIn, startServer, tap } from './support.mjs';

// C19 F: player bookings beyond SINGLE through the real booking-create and booking-detail
// pages -> real API -> owned PostgreSQL: MULTI, TOURNAMENT, SEASON and TIME_BLOCK orders; a
// conditional (advancement) item activated later; change proposal accepted and rejected;
// per-item cancellation; dispute with a lost response recovered by the ORIGINAL command id and
// resolved by an independent platform operator. HTTP only prepares the team and its leader.
let server, f, team;
const d = {};
const pad = (v) => String(v).padStart(2, '0');
function china(ms) {
  const x = new Date(ms + 8 * 3600000);
  return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
}
const DAY = (n) => china(Date.now() + n * 86400000);

async function playerProfile(dev, name) {
  const center = dev.open('pages/player-center/index');
  await dev.settle(center);
  center.page.edit(tap({}));
  for (const [field, value] of [
    ['displayName', name],
    ['heightCm', '182'],
    ['city', '合成高州'],
    ['bio', '合成资料，仅用于隔离联调'],
    ['price', '300.00'],
    ['travel', '20.00'],
    ['accommodation', '0.00'],
  ])
    center.page.input(tap({ field }, { value }));
  center.page.position(tap({}, { value: 0 }));
  center.page.addWindow();
  center.page.windowInput(tap({ field: 'startTime', index: 0 }, { value: '00:00' }));
  center.page.windowInput(tap({ field: 'endDate', index: 0 }, { value: DAY(5) }));
  center.page.windowInput(tap({ field: 'endTime', index: 0 }, { value: '23:00' }));
  center.page.consent(tap({}, { value: ['yes'] }));
  await center.page.save();
  await dev.settle(center);
  assert.equal(center.page.data.error, '');
  center.unload();
}

before(async () => {
  server = await startServer();
  f = await organizationFixture(server);
  for (const [key, email, name] of [
    ['operator', 'operator@example.test', '合成平台运营'],
    ['leader', 'leader@example.test', '合成领队'],
    ['a', 'player-a@example.test', '合成球员甲'],
    ['b', 'player-b@example.test', '合成球员乙'],
  ]) {
    d[key] = device(server);
    await register(d[key], email, name);
    d[key].id = (await d[key].client.request('/v1/auth/session')).data.user.id;
  }
  await server.grantOperator('operator@example.test');
  team = (
    await f.call(`${f.root}/teams`, {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { name: '合成石鼓青锋' },
    })
  ).data;
  const issued = (
    await f.call(`${f.root}/teams/${team.id}/invitations`, {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { targetUserId: d.leader.id, expiresInHours: 1 },
    })
  ).data;
  await d.leader.client.request(`/v1/invitations/${issued.invitation.id}/accept`, 'POST', {
    token: issued.token,
  });
  await playerProfile(d.a, '合成林越');
  await playerProfile(d.b, '合成陈凯');
  await signIn(d.operator, 'operator@example.test');
  const platform = d.operator.open('pages/platform/index');
  await d.operator.settle(platform);
  for (const profile of platform.page.raw.reviewQueue.slice()) {
    platform.page.review(tap({ id: profile.id }));
    platform.page.status(tap({}, { value: 0 }));
    platform.page.reason(tap({}, { value: '资料核对一致' }));
    platform.page.agree(tap({}, { value: ['yes'] }));
    await platform.page.submitReview();
    await d.operator.settle(platform);
  }
  const profiles = (await server.pool.query('SELECT id,user_id,status FROM booking_profiles')).rows;
  assert.ok(profiles.every((p) => p.status === 'APPROVED'));
  d.a.profile = profiles.find((p) => p.user_id === d.a.id).id;
  d.b.profile = profiles.find((p) => p.user_id === d.b.id).id;
  await signIn(d.leader, 'leader@example.test');
});
after(async () => {
  await server?.close();
});

const slot = (date, report, start, end, label, venue = '合成石鼓公园球场') => [
  ['label', label],
  ['venue', venue],
  ['reportDate', date],
  ['reportTime', report],
  ['startDate', date],
  ['startTime', start],
  ['endDate', date],
  ['endTime', end],
];
/** Create one order natively; returns the order id. `slots`: arrays of [field, value]. */
async function createOrder({ scope, player, name, slots, conditional = {}, period, lose = false }) {
  const dev = d.leader;
  const page = dev.open('pages/booking-create/index', { playerId: player });
  await dev.settle(page);
  assert.equal(page.page.data.ready, true, page.page.data.error);
  await page.page.changeScope(tap({ scope }));
  assert.equal(page.page.data.scope, scope);
  page.page.input(tap({ field: 'eventName' }, { value: name }));
  if (period) {
    page.page.input(tap({ field: 'periodStart' }, { value: period[0] }));
    page.page.input(tap({ field: 'periodEnd' }, { value: period[1] }));
  }
  slots.forEach((fields, index) => {
    if (index > 0) page.page.addSlot();
    if (conditional[index]) {
      page.page.conditional(tap({ index }, { value: true }));
      page.page.slotInput(tap({ index, field: 'conditionText' }, { value: conditional[index] }));
    }
    for (const [field, value] of fields) page.page.slotInput(tap({ index, field }, { value }));
  });
  await page.page.review();
  await dev.settle(page);
  assert.equal(page.page.data.review, true, page.page.data.error);
  page.page.consent(tap({}, { value: ['agree'] }));
  if (lose)
    dev.dropNextResponse(
      (o) => o.method === 'POST' && o.url.endsWith('/v1/player-bookings/orders'),
    );
  await page.page.submit();
  await dev.settle(page);
  if (lose) {
    assert.equal(page.page.data.pending, true, 'unknown create keeps the original request');
    await page.page.recover();
    await dev.settle(page);
  }
  assert.equal(page.page.data.success, true, page.page.data.error);
  const id = page.page.data.successOrderId;
  page.unload();
  return id;
}
const orderRows = async (id) => ({
  order: (
    await server.pool.query('SELECT scope,status,event_name FROM booking_orders WHERE id=$1', [id])
  ).rows[0],
  items: (
    await server.pool.query(
      'SELECT id,status,label,condition_text,report_at,start_at,end_at,venue,change_request,cancellation_reason,version FROM booking_appearances WHERE order_id=$1 ORDER BY created_at,id',
      [id],
    )
  ).rows,
});
/** One command natively on booking-detail. */
async function act(dev, orderId, view, appearanceId, type, fields = {}, extra) {
  const page = dev.open('pages/booking-detail/index', { id: orderId, view });
  await dev.settle(page);
  assert.ok(page.page.data.order, page.page.data.error);
  await page.page.chooseAction(tap({ id: appearanceId, type }));
  assert.ok(page.page.data.form, page.page.data.error);
  for (const [field, value] of Object.entries(fields)) page.page.input(tap({ field }, { value }));
  if (fields.resolution !== undefined) page.page.resolution(tap({}, { value: fields.resolution }));
  page.page.confirm(tap({}, { value: ['yes'] }));
  assert.equal(page.page.data.canSubmit, true, page.page.data.validation);
  dev.approve();
  await extra?.before?.(page);
  await page.page.submit();
  await dev.settle(page);
  return page;
}

test('MULTI / TOURNAMENT / SEASON / TIME_BLOCK orders, activation, change, cancel, dispute and recovery', async () => {
  // MULTI: two separately confirmed appearances for player A.
  const multi = await createOrder({
    scope: 'MULTI',
    player: d.a.profile,
    name: '合成联赛多场',
    slots: [
      slot(DAY(1), '09:30', '10:00', '11:00', '第1轮'),
      slot(DAY(1), '13:30', '14:00', '15:00', '第2轮'),
    ],
  });
  let m = await orderRows(multi);
  assert.equal(m.order.scope, 'MULTI');
  assert.deepEqual(
    m.items.map((i) => [i.label, i.status]),
    [
      ['第1轮', 'REQUESTED'],
      ['第2轮', 'REQUESTED'],
    ],
  );

  // TOURNAMENT: a fixed group match plus a conditional final for player B.
  const tour = await createOrder({
    scope: 'TOURNAMENT',
    player: d.b.profile,
    name: '合成青锋杯整届',
    slots: [
      slot(DAY(2), '09:30', '10:00', '11:00', '小组赛'),
      slot(DAY(2), '13:30', '14:00', '15:00', '决赛'),
    ],
    conditional: { 1: '若本队晋级决赛则出场' },
  });
  let t = await orderRows(tour);
  assert.equal(t.order.scope, 'TOURNAMENT');
  assert.deepEqual(
    t.items.map((i) => [i.label, i.status, i.condition_text, i.start_at === null]),
    [
      ['小组赛', 'REQUESTED', null, false],
      ['决赛', 'CONDITIONAL', '若本队晋级决赛则出场', true],
    ],
  );

  // SEASON: inside the stated period; created with a lost response and recovered once.
  const season = await createOrder({
    scope: 'SEASON',
    player: d.a.profile,
    name: '合成赛季合作',
    period: [DAY(1), DAY(4)],
    slots: [slot(DAY(3), '09:30', '10:00', '11:00', '赛季第1场')],
    lose: true,
  });
  const s = await orderRows(season);
  assert.equal(s.order.scope, 'SEASON');
  assert.equal(s.items.length, 1);
  assert.equal(
    (await server.pool.query("SELECT count(*)::int n FROM booking_orders WHERE scope='SEASON'"))
      .rows[0].n,
    1,
    'one SEASON order despite the lost response',
  );
  const creates = d.leader.wx.calls.filter(
    (c) => c.type === 'request' && c.method === 'POST' && c.url.endsWith('/player-bookings/orders'),
  );
  assert.equal(creates.at(-1).data.commandId, creates.at(-2).data.commandId);

  // TIME_BLOCK: one explicit service window.
  const block = await createOrder({
    scope: 'TIME_BLOCK',
    player: d.b.profile,
    name: '合成训练时段',
    slots: [slot(DAY(3), '14:30', '15:00', '17:00', '训练指导')],
  });
  const b = await orderRows(block);
  assert.equal(b.order.scope, 'TIME_BLOCK');
  assert.equal(b.items.length, 1);

  // Conditional activation: the leader fills in the real schedule; it becomes a normal request.
  const final = t.items[1];
  await act(d.leader, tour, 'sent', final.id, 'ACTIVATE', {
    reportDate: DAY(4),
    reportTime: '09:30',
    startDate: DAY(4),
    startTime: '10:00',
    endDate: DAY(4),
    endTime: '11:00',
    venue: '合成决赛场馆',
  });
  t = await orderRows(tour);
  assert.equal(t.items[1].status, 'REQUESTED');
  assert.equal(t.items[1].venue, '合成决赛场馆');
  assert.equal(
    new Date(t.items[1].start_at).toISOString(),
    new Date(`${DAY(4)}T10:00:00+08:00`).toISOString(),
  );
  // The player can now accept it.
  await signIn(d.b, 'player-b@example.test');
  await act(d.b, tour, 'received', final.id, 'ACCEPT');
  assert.equal((await orderRows(tour)).items[1].status, 'ACCEPTED');

  // Player A accepts MULTI item 1; the leader proposes a change; the player accepts it.
  await signIn(d.a, 'player-a@example.test');
  const first = m.items[0];
  await act(d.a, multi, 'received', first.id, 'ACCEPT');
  await act(d.leader, multi, 'sent', first.id, 'PROPOSE_CHANGE', {
    reportDate: DAY(1),
    reportTime: '11:00',
    startDate: DAY(1),
    startTime: '11:30',
    endDate: DAY(1),
    endTime: '12:30',
    venue: '合成二号场',
    reason: '场地调整到二号场',
  });
  m = await orderRows(multi);
  assert.equal(m.items[0].change_request?.venue, '合成二号场');
  assert.equal(m.items[0].venue, '合成石鼓公园球场', 'proposal alone changes nothing');
  await act(d.a, multi, 'received', first.id, 'ACCEPT_CHANGE');
  m = await orderRows(multi);
  assert.equal(m.items[0].venue, '合成二号场');
  assert.equal(m.items[0].change_request, null);
  assert.equal(
    new Date(m.items[0].start_at).toISOString(),
    new Date(`${DAY(1)}T11:30:00+08:00`).toISOString(),
  );

  // The player proposes another change; the leader rejects it; the agreement stays.
  await act(d.a, multi, 'received', first.id, 'PROPOSE_CHANGE', {
    reportDate: DAY(1),
    reportTime: '16:30',
    startDate: DAY(1),
    startTime: '17:00',
    endDate: DAY(1),
    endTime: '18:00',
    venue: '合成三号场',
    reason: '希望改到傍晚',
  });
  await act(d.leader, multi, 'sent', first.id, 'REJECT_CHANGE', { reason: '傍晚无场地' });
  m = await orderRows(multi);
  assert.equal(m.items[0].venue, '合成二号场');
  assert.equal(m.items[0].change_request, null);

  // Per-item cancellation: only item 2 ends; item 1 keeps its agreement.
  await act(d.leader, multi, 'sent', m.items[1].id, 'CANCEL', { reason: '第2轮取消' });
  m = await orderRows(multi);
  assert.deepEqual(
    m.items.map((i) => i.status),
    ['ACCEPTED', 'CANCELLED'],
  );
  assert.equal(m.items[1].cancellation_reason, '第2轮取消');

  // Dispute with a lost response: recovery resends the ORIGINAL command, applied once.
  const disputePage = await act(
    d.a,
    multi,
    'received',
    first.id,
    'DISPUTE',
    { reason: '约定地点无人接待' },
    {
      before: () =>
        d.a.dropNextResponse(
          (o) => o.method === 'POST' && /\/player-bookings\/orders\/[^/]+\/commands$/.test(o.url),
        ),
    },
  );
  assert.ok(disputePage.page.data.pending, 'unknown result keeps the original command');
  const commandsBefore = d.a.wx.calls.filter(
    (c) =>
      c.type === 'request' && c.method === 'POST' && c.url.endsWith(`/orders/${multi}/commands`),
  );
  d.a.approve();
  await disputePage.page.recover();
  await d.a.settle(disputePage);
  assert.equal(disputePage.page.data.pending, null, disputePage.page.data.error);
  const commandsAfter = d.a.wx.calls.filter(
    (c) =>
      c.type === 'request' && c.method === 'POST' && c.url.endsWith(`/orders/${multi}/commands`),
  );
  assert.equal(commandsAfter.length, commandsBefore.length + 1);
  assert.deepEqual(commandsAfter.at(-1).data, commandsBefore.at(-1).data, 'identical original');
  assert.equal((await orderRows(multi)).items[0].status, 'DISPUTED');
  const disputes = (
    await server.pool.query(
      "SELECT count(*)::int n FROM audit_logs WHERE action='BOOKING_DISPUTE' AND resource_id=$1",
      [first.id],
    )
  ).rows[0].n;
  assert.equal(disputes, 1, 'the dispute was written exactly once');
  disputePage.unload();

  // Neither party can resolve its own dispute; the independent operator resumes it.
  const own = d.leader.open('pages/booking-detail/index', { id: multi, view: 'sent' });
  await d.leader.settle(own);
  const ownItem = own.page.data.order.appearances.find((a) => a.id === first.id);
  assert.equal(
    ownItem.actions.some((x) => x.type === 'RESOLVE_DISPUTE'),
    false,
  );
  own.unload();
  await act(d.operator, multi, 'sent', first.id, 'RESOLVE_DISPUTE', {
    reason: '双方说明一致，恢复履约',
    resolution: 0,
  });
  m = await orderRows(multi);
  assert.equal(m.items[0].status, 'ACCEPTED');
  // No payment ever happened.
  const order = (await d.leader.client.request('/v1/player-bookings/orders/' + multi)).data;
  assert.ok(order.appearances.every((a) => a.paymentStatus === 'UNAVAILABLE'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const commonUi = require('../utils/ui');
const root = path.resolve(__dirname, '..');
const fixtures = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const read = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name + '.json')));
const clone = (value) => JSON.parse(JSON.stringify(value));
const event = (id) => ({ currentTarget: { dataset: { id } } });
function createBooking() {
  const f = read('c11-booking-create-ready');
  const sends = [];
  const previews = [];
  const actor = '90000000-0000-4000-8000-000000000099';
  const ui = {
    ...commonUi,
    today: () => '2026-10-25',
    session: async () => ({ user: { id: actor } }),
    begin: () => 1,
    live: (page) => !page.closed,
    uuid: async () => '90000000-0000-4000-8000-000000000088',
    confirm: async () => true,
  };
  let workspace;
  const h = loadPage({
    root,
    route: f.route,
    wx: createWx(),
    modules: {
      [path.join(root, 'utils/ui.js')]: ui,
      [path.join(root, 'utils/api.js')]: { getClient: () => ({ sessionRevision: () => 1 }) },
      [path.join(root, 'utils/booking.js')]: {
        workspace: async () => workspace,
        create: async (input) => {
          sends.push(clone(input));
          throw Error('合成网络结果未知');
        },
      },
      [path.join(root, 'pages/trade-order/client.js')]: {
        post: async (route, body) => {
          previews.push({ route, body });
          return { enabled: false, quotes: [] };
        },
      },
    },
  });
  const p = h.page;
  p.onLoad({});
  workspace = {
    viewerUserId: actor,
    teams: clone(f.data.teams),
    events: [],
    matches: [],
    settings: { version: 1, feeBps: 1000 },
    players: [
      {
        id: f.data.players[0].id,
        userId: '90000000-0000-4000-8000-000000000501',
        displayName: '合成球员',
        position: 'PG',
        status: 'APPROVED',
        priceFen: 30001,
        travelFen: 0,
        accommodationFen: 0,
        version: 1,
      },
    ],
  };
  const slot = clone(f.data.slots[0]);
  p.actor = actor;
  p.viewRevision = 1;
  p.workspace = workspace;
  p.draft = {
    scope: 'SINGLE',
    teamId: f.data.teamId,
    eventId: '',
    eventName: '合成赛事',
    selectedIds: [workspace.players[0].id],
    slots: [slot],
    periodStart: '2026-10-28',
    periodEnd: '2026-11-28',
    consent: false,
  };
  p.setData({ ready: true });
  p.renderForm();
  return { ...h, sends, previews };
}
const html = (page, route = 'pages/booking-create/index', width = 390) => {
  const phone = buildPreview({ root, route, data: page.data, width }).phone;
  return phone.slice(phone.indexOf('<body>'));
};

test('T09 field entries open the original complete editor; review remains a real unchecked fee step', async () => {
  const h = createBooking();
  const p = h.page;
  const initial = html(p);
  assert.ok(initial.indexOf('时间与地点') < initial.indexOf('确定报价'));
  assert.ok(initial.indexOf('确定报价') < initial.indexOf('返回选人'));
  assert.doesNotMatch(initial, /每位球员、每一场分别接单/);
  assert.match(initial, /data-mini-bindtap="openEditor"/);
  assert.doesNotMatch(initial, /selected-portrait|arrangement-summary|data-mini-bindtap="submit"/);
  assert.match(initial, /¥330.01/);
  p.openEditor();
  for (const value of ['合', '合成具体场地']) {
    p.slotInput({ currentTarget: { dataset: { index: 0, field: 'venue' } }, detail: { value } });
    const editing = html(p);
    assert.match(editing, /每位球员、每一场分别接单/);
    for (const handler of ['teamPick', 'eventPick', 'playerPick', 'slotPlayers', 'slotInput'])
      assert.match(editing, new RegExp('data-mini-bind(?:change|input)="' + handler + '"'));
    assert.equal(p.data.editorOpen, true);
    assert.equal(p.draft.slots[0].venue, value);
  }
  p.closeEditor();
  assert.doesNotMatch(html(p), /data-mini-bindchange="teamPick"/);
  await p.review();
  assert.equal(h.previews.length, 1);
  assert.equal(h.previews[0].route, '/preview');
  assert.equal(p.data.review, true);
  assert.equal(p.data.consent, false);
  assert.match(html(p), /data-mini-bindchange="consent"/);
  await p.submit();
  assert.equal(h.sends.length, 0);
  p.consent({ detail: { value: ['agree'] } });
  await p.submit();
  assert.equal(h.sends.length, 1);
  assert.equal(p.data.pending, true);
  const pending = html(p);
  assert.match(pending, /data-mini-bindtap="recover"/);
  assert.doesNotMatch(
    pending,
    /booking-display-field|data-mini-bindtap="review"|data-mini-bindtap="submit"/,
  );
  await p.recover();
  assert.equal(h.sends.length, 2);
  assert.deepEqual(h.sends[1], h.sends[0]);
});

test('T09 all five original modes and per-game conditionals remain reachable through the disclosed editor', async () => {
  const h = createBooking();
  h.page.openEditor();
  for (const scope of ['SINGLE', 'MULTI', 'TOURNAMENT', 'SEASON', 'TIME_BLOCK']) {
    await h.page.changeScope({ currentTarget: { dataset: { scope } } });
    assert.equal(h.page.data.scope, scope);
    assert.match(html(h.page), /data-mini-bindinput="slotInput"/);
  }
  await h.page.changeScope({ currentTarget: { dataset: { scope: 'MULTI' } } });
  h.page.addSlot();
  h.page.conditional({ currentTarget: { dataset: { index: 1 } }, detail: { value: true } });
  assert.equal(h.page.data.slots.length, 2);
  assert.equal(h.page.data.slots[1].conditional, true);
  assert.match(html(h.page), /data-mini-bindchange="conditional"/);
  assert.match(html(h.page), /条件意向/);
  assert.equal(h.previews.length, 0);
  assert.equal(h.sends.length, 0);
});

test('T09 recovery priority and revoked-team private hiding survive the new form layout', async () => {
  const h = createBooking();
  h.page.setData({ storageReadBlocked: true, invalidRecovery: true, pending: true });
  assert.match(html(h.page), /暂时无法读取原预约记录/);
  assert.doesNotMatch(html(h.page), /恢复记录损坏|booking-display-field/);
  h.page.setData({ storageReadBlocked: false, invalidRecovery: false, pending: false });
  await h.page.review();
  h.page.consent({ detail: { value: ['agree'] } });
  await h.page.submit();
  const original = h.page.data.recoveryCommand;
  h.page.workspace.teams = [];
  h.page.renderRecovery();
  assert.equal(h.page.data.canRecover, false);
  const hidden = html(h.page);
  assert.match(hidden, /当前账号已无原球队授权/);
  assert.equal(hidden.includes(original), false);
  assert.doesNotMatch(hidden, /合成赛事|合成具体场地/);
});

function cooperationList() {
  const f = read('c11-booking-orders-ready');
  const h = loadPage({ root, route: f.route });
  const rows = clone(f.data.rows);
  const p = h.page;
  p.viewer = rows[0].buyerUserId;
  p.raw = {
    viewerUserId: p.viewer,
    teams: [{ id: rows[0].teamId, orgId: rows[0].orgId }],
    orders: rows,
    players: [],
  };
  const ui = h.requireLocal('utils/ui.js');
  ui.today = () => '2026-10-25';
  p.loadedToken = ui.begin(p);
  p.render();
  return { ...h, ui };
}
test('T17 compact records preserve current detail, disclosure, funds and fixed navigation handlers', () => {
  const h = cooperationList();
  const p = h.page;
  const appearance = p.data.rows[0].appearances[0];
  const initial = html(p, 'pages/bookings/index');
  assert.match(initial, /合作进度/);
  assert.match(initial, /data-mini-bindtap="detail"/);
  assert.match(initial, /figma-fixed-actions/);
  assert.match(initial, /data-mini-bindtap="players"/);
  assert.doesNotMatch(
    initial,
    /order-portrait|booking-order-card|action-bar|data-mini-bindtap="trade"/,
  );
  p.toggleInfo(event(appearance.id));
  assert.match(html(p, 'pages/bookings/index'), /data-mini-bindtap="trade"/);
  assert.match(html(p, 'pages/bookings/index'), /总单确定报价/);
  p.trade(event(appearance.id));
  assert.match(h.wx.calls.at(-1).url, /trade-order\/index\?kind=PLAYER_APPEARANCE&sourceId=/);
  const count = h.wx.calls.length;
  p.trade(event('not-visible'));
  assert.equal(h.wx.calls.length, count);
  p.toggleFilters();
  assert.match(html(p, 'pages/bookings/index'), /data-mini-bindchange="changeStatus"/);
  p.onHide();
  assert.equal(p.data.rows.length, 0);
  p.trade(event(appearance.id));
  assert.equal(h.wx.calls.length, count);
});

test('T09/T17 real templates expand at three widths with local Figma icons and no design placeholder photos', () => {
  const c = createBooking();
  const h = cooperationList();
  h.page.raw.orders[0].scope = 'TOURNAMENT';
  h.page.render();
  for (const width of [320, 390, 430]) {
    assert.match(html(c.page, 'pages/booking-create/index', width), /¥330.01/);
    const preview = buildPreview({ root, route: 'pages/bookings/index', data: h.page.data, width });
    assert.ok(preview.assets.some((a) => a.path.endsWith('/booking.svg') && a.bytes > 0));
    assert.ok(
      preview.assets.every(
        (a) =>
          a.bytes > 0 &&
          /^(assets\/approved-ui\/|assets\/figma\/)/.test(a.path.replaceAll('\\', '/')),
      ),
    );
    assert.doesNotMatch(preview.phone, /src="https?:|player-placeholder|order-portrait/);
  }
});

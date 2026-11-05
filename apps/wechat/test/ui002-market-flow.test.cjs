const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const id = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(900);
const tap = (value) => ({ currentTarget: { dataset: { id: value } } });
const input = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });
const profile = (n, changes = {}) => ({
  id: id(n),
  displayName: '合成球员' + n,
  userId: id(n + 500),
  position: 'PG',
  heightCm: 182,
  city: '高州 / 石鼓',
  bio: '合成服务介绍',
  priceFen: 30000,
  travelFen: n * 1000,
  accommodationFen: 2000,
  status: 'APPROVED',
  availability: [{ startAt: '2026-10-27T17:00:00Z', endAt: '2026-10-27T20:00:00Z' }],
  ...changes,
});
function harness(route = 'players') {
  const h = loadPage({ root, route: 'pages/' + route + '/index' });
  const ui = h.requireLocal('utils/ui.js');
  const sdk = h.requireLocal('utils/booking.js');
  const market = h.requireLocal('utils/player-market.js');
  let revision = 0;
  const reads = [];
  const nav = [];
  const workspace = {
    viewerUserId: actor,
    players: [profile(1), profile(2), profile(3), profile(4)],
    settings: { feeBps: 1000 },
  };
  ui.session = async () => ({ user: { id: actor } });
  ui.begin = (page) => ({ revision, read: (page._read = (page._read || 0) + 1) });
  ui.live = (page, token) => !!token && token.revision === revision && token.read === page._read;
  ui.close = () => revision++;
  ui.open = (route, query) => nav.push({ route, query });
  sdk.workspace = async () => {
    reads.push('workspace');
    return workspace;
  };
  sdk.performances = async (ids) => {
    reads.push([...ids]);
    return { players: [], unavailableProfileIds: [] };
  };
  market.setViewer(actor);
  market.setSelected([]);
  return { ...h, ui, sdk, market, workspace, reads, nav, invalidate: () => revision++ };
}
function preview(h, route, width = 390) {
  return buildPreview({
    root,
    route: 'pages/' + route + '/index',
    data: h.page.data,
    width,
    height: 844,
  });
}
function noWrites(h) {
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
}

test('UI001 T06 real handlers retain draft filters and apply service-price/date semantics', async () => {
  const h = harness();
  await h.page.onShow();
  h.page.filtersToggle();
  h.page.input(input('city', '石鼓'));
  h.page.input(input('price', '300.00'));
  h.page.positionChange({ detail: { value: '1' } });
  h.page.dateChange({ detail: { value: '2026-10-28' } });
  const before = h.reads.length;
  h.page.filtersToggle();
  h.page.filtersToggle();
  assert.equal(h.reads.length, before);
  assert.equal(h.page.data.filters.city, '石鼓');
  assert.equal(h.page.data.filters.price, '300.00');
  await h.page.applyFilters();
  assert.equal(h.page.data.cards.length, 4);
  assert.equal(h.page.data.filterSummary.price, '同价 ¥300');
  assert.equal(h.page.data.filterSummary.date, '10月28日');
  assert.notEqual(h.page.data.cards[0].total, h.page.data.cards[1].total);
  h.page.input(input('price', '300.001'));
  await h.page.applyFilters();
  assert.match(h.page.data.error, /最多两位小数/);
  assert.equal(h.page.data.cards.length, 0);
  await h.page.clearFilters();
  assert.equal(h.page.data.cards.length, 4);
  assert.equal(h.page.data.filters.city, '');
  noWrites(h);
});

test('UI001 T06 list selection preserves two-person entry, max-three and current-token gates', async () => {
  const h = harness();
  await h.page.onShow();
  h.page.toggle(tap(id(1)));
  h.page.compare();
  assert.equal(h.nav.length, 0);
  h.page.toggle(tap(id(2)));
  h.page.compare();
  assert.equal(h.nav[0].route, 'compare');
  assert.equal(h.nav[0].query.ids, id(1) + ',' + id(2));
  h.page.toggle(tap(id(3)));
  h.page.toggle(tap(id(4)));
  assert.equal(h.page.data.selectedCount, 3);
  assert.match(h.page.data.error, /最多比较3位/);
  h.invalidate();
  h.page.detail(tap(id(1)));
  h.page.toggle(tap(id(1)));
  h.page.compare();
  assert.equal(h.nav.length, 1);
  assert.equal(h.page.data.selectedCount, 3);
  h.page.onHide();
  assert.equal(h.page.data.cards.length, 0);
  assert.equal(h.page.data.selectedCount, 0);
  noWrites(h);
});

test('UI001 T06 compact native list uses source icons and keeps real fees and unknown sources reachable', async () => {
  const h = harness();
  await h.page.onShow();
  for (const width of [320, 390, 430]) {
    const result = preview(h, 'players', width);
    assert.match(result.phone, /选择适合本场的球员/);
    assert.match(result.phone, /market-form/);
    assert.match(result.phone, /data-mini-bindtap="detail"/);
    assert.match(result.phone, /data-mini-bindtap="toggle"/);
    assert.ok(result.assets.some((asset) => asset.path.endsWith('ui002/avatar-user.svg')));
    assert.doesNotMatch(result.phone, /player-sample-|player-placeholder|player-metrics/);
    assert.match(result.phone, /data-mini-bindtap="compare"[^>]*disabled/);
  }
  const original = JSON.stringify(h.page.data.cards);
  h.page.informationToggle();
  const expanded = preview(h, 'players').phone;
  for (const text of [
    '平台服务费',
    '交通费',
    '食宿费',
    '含费预计',
    '未统计',
    '暂无有效个人统计',
    '缺少统计不代表能力差',
  ])
    assert.ok(expanded.includes(text), text);
  assert.equal(JSON.stringify(h.page.data.cards), original);
  h.page.informationToggle();
  noWrites(h);
});

test('UI001 T08 native compact table supports three actual profiles and preserves fees behind information', async () => {
  const h = harness('compare');
  h.page.onLoad({ ids: [1, 2, 3].map(id).join(',') });
  await h.page.onShow();
  assert.equal(h.page.data.sameServicePrice, true);
  assert.equal(h.page.data.profiles.length, 3);
  for (const width of [320, 390, 430]) {
    const result = preview(h, 'compare', width);
    assert.match(result.phone, /three-columns/);
    assert.match(result.phone, /左右滑动查看第3人/);
    assert.match(result.phone, /交通费/);
    assert.match(result.phone, /合成球员3/);
    assert.match(result.phone, /继续选人/);
    assert.match(result.phone, /预约合成球员1/);
    assert.doesNotMatch(result.phone, /compare-portrait|player-sample-|player-placeholder/);
  }
  const before = JSON.stringify(h.page.data.profiles);
  h.page.informationToggle();
  const expanded = preview(h, 'compare').phone;
  for (const text of [
    '参赛服务费',
    '平台服务费',
    '交通费',
    '食宿费',
    '含费预计',
    '未统计',
    '暂无有效个人统计',
    '缺少统计不代表能力差',
    '移除合成球员3',
  ])
    assert.ok(expanded.includes(text), text);
  assert.match(expanded, /data-mini-bindtap="detail"/);
  assert.match(expanded, /data-mini-bindtap="book"/);
  assert.match(expanded, /data-mini-bindtap="remove"/);
  assert.equal(JSON.stringify(h.page.data.profiles), before);
  noWrites(h);
});

test('UI001 T08 booking keeps the real selected target and selection removal rereads the current catalog', async () => {
  const h = harness('compare');
  h.page.onLoad({ ids: [1, 2, 3].map(id).join(',') });
  await h.page.onShow();
  h.page.book(tap(id(99)));
  assert.equal(h.nav.length, 0);
  h.page.book(tap(''));
  h.page.book(tap(id(3)));
  assert.equal(h.nav[0].route, 'booking-create');
  assert.equal(h.nav[0].query.playerId, id(1));
  assert.equal(h.nav[1].query.playerId, id(3));
  await h.page.remove(tap(id(1)));
  assert.equal(h.page.data.firstId, id(2));
  assert.equal(h.page.data.selectedCount, 2);
  h.page.book(tap(''));
  assert.equal(h.nav[2].query.playerId, id(2));
  h.invalidate();
  h.page.book(tap(id(2)));
  h.page.detail(tap(id(2)));
  assert.equal(h.nav.length, 3);
  h.page.onHide();
  const hidden = preview(h, 'compare').phone;
  assert.doesNotMatch(hidden, /合成球员/);
  assert.equal(h.page.data.firstId, '');
  noWrites(h);
});

test('UI001 T08 partial stats and unavailable profiles never become fabricated zero metrics or booking targets', async () => {
  const h = harness('compare');
  h.sdk.performances = async () => {
    throw { status: 503, message: '合成统计中断' };
  };
  h.page.onLoad({ ids: [1, 2].map(id).join(',') });
  await h.page.onShow();
  assert.match(h.page.data.statisticsError, /合成统计中断/);
  assert.equal(h.page.data.profiles[0].performance.sample, '暂不可用');
  assert.equal(h.page.data.profiles[0].performance.points, '暂不可用');
  h.sdk.performances = async () => ({ players: [], unavailableProfileIds: [id(2)] });
  await h.page.load();
  assert.equal(h.page.data.firstId, '');
  assert.equal(h.page.data.columns.length, 0);
  assert.match(h.page.data.error, /已不可查看/);
  h.page.book(tap(id(2)));
  assert.equal(h.nav.length, 0);
  noWrites(h);
});

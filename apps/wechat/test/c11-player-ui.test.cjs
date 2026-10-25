const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const fixture = (part) =>
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'c11-player-' + part + '-ready.json'), 'utf8'));
const preview = (f, width = 390) => buildPreview({ root, ...f, width, height: 844 });
const names = ['market', 'detail', 'compare'];

test('approved three-screen samples render native cards and isolated example portraits at all widths', () => {
  for (const name of names) {
    const f = fixture(name);
    for (const width of [320, 390, 430]) {
      const result = preview(f, width);
      for (const text of f.expectText) assert.ok(result.phone.includes(text), name + ': ' + text);
      assert.match(result.phone, /mini-custom-status/);
      assert.doesNotMatch(result.phone, /<header class="mini-native-bar"|<script\b|src="https?:/);
      assert.ok(result.assets.some((asset) => /player-sample-[ab]/.test(asset.path)));
      assert.ok(
        result.assets.every((asset) => !/approved-six-screen|design\/C11/.test(asset.path)),
      );
    }
  }
});

test('home position shortcut applies only a known position and never silently adds a city or request', () => {
  for (const code of ['PG', 'SG', 'SF', 'PF', 'C']) {
    const h = loadPage({ root, route: 'pages/players/index' });
    h.page.onLoad({ position: code });
    assert.equal(h.page.data.filters.position, code);
    assert.ok(h.page.data.positionIndex > 0);
    assert.equal(h.page.data.filters.city, '');
    assert.equal(h.wx.calls.length, 0);
  }
  for (const code of ['__proto__', '全部', 'pg', '', undefined]) {
    const h = loadPage({ root, route: 'pages/players/index' });
    h.page.onLoad({ position: code });
    assert.equal(h.page.data.filters.position, '');
    assert.equal(h.page.data.positionIndex, 0);
  }
});

test('current DTO never turns a real player name or untrusted portrait field into a sample identity', () => {
  const h = loadPage({ root, route: 'pages/player/index' });
  const market = h.requireLocal('utils/player-market.js');
  const view = market.profileView(
    {
      id: '80000000-0000-4000-8000-000000000001',
      displayName: '林越',
      position: 'PG',
      heightCm: 182,
      city: '高州',
      bio: '',
      priceFen: 30000,
      travelFen: 0,
      accommodationFen: 0,
      portrait: '/assets/approved-ui/player-sample-a.jpg',
      heroPortrait: '/assets/approved-ui/player-sample-a-hero.jpg',
    },
    1000,
    null,
    false,
  );
  assert.equal(view.portrait, undefined);
  assert.equal(view.heroPortrait, undefined);
  const f = fixture('detail');
  f.data.profile = view;
  const result = preview(f);
  assert.ok(result.assets.some((asset) => asset.path.endsWith('player-placeholder.png')));
  assert.ok(result.assets.every((asset) => !/player-sample-/.test(asset.path)));
});

test('expanded profile information retains exact costs, uncollected metrics and comparison actions', () => {
  const f = fixture('detail');
  const h = loadPage({ root, route: f.route });
  h.page.setData(f.data);
  const before = JSON.stringify(h.page.data.profile);
  h.page.informationToggle();
  const expanded = preview({ ...f, data: h.page.data }).phone;
  assert.match(expanded, /交通 ¥0.00/);
  assert.match(expanded, /篮板、助攻、上场时间和命中率：未统计/);
  assert.match(expanded, /固定名单统计样本不代表实际出场/);
  assert.match(expanded, /data-mini-bindtap="toggle"/);
  assert.match(expanded, /data-mini-bindtap="compare"/);
  assert.equal(JSON.stringify(h.page.data.profile), before);
  h.page.informationToggle();
  assert.equal(JSON.stringify(h.page.data.profile), before);
  assert.equal(h.wx.calls.length, 0);
});

test('compact comparison keeps the third player, source status and removal behind a reversible information view', () => {
  const f = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, 'c10-core-compare-ready.json'), 'utf8'),
  );
  const h = loadPage({ root, route: f.route });
  h.page.setData(f.data);
  const before = JSON.stringify(h.page.data.profiles);
  assert.match(preview({ ...f, data: h.page.data }).phone, /左右滑动查看第3人/);
  h.page.informationToggle();
  const expanded = preview({ ...f, data: h.page.data }).phone;
  assert.match(expanded, /移除合成周航/);
  assert.match(expanded, /来源完整度|部分记录/);
  assert.match(expanded, /暂无授权来源/);
  assert.match(expanded, /食宿费/);
  assert.equal(JSON.stringify(h.page.data.profiles), before);
  h.page.onHide();
  const hidden = preview({ ...f, data: h.page.data }).phone;
  assert.doesNotMatch(hidden, /合成林越|合成陈凯|合成周航/);
});

test('compact availability keeps same-day labels readable and preserves both dates when a window crosses midnight', async () => {
  const h = loadPage({ root, route: 'pages/player/index' });
  const id = '80000000-0000-4000-8000-000000000001';
  const actor = '80000000-0000-4000-8000-000000000099';
  const ui = h.requireLocal('utils/ui.js');
  ui.session = async () => ({ user: { id: actor } });
  ui.begin = () => ({});
  ui.live = () => true;
  const sdk = h.requireLocal('utils/booking.js');
  sdk.workspace = async () => ({
    viewerUserId: actor,
    settings: { feeBps: 1000 },
    players: [
      {
        id,
        userId: actor,
        status: 'APPROVED',
        displayName: '合成球员',
        position: 'PG',
        heightCm: 182,
        city: '高州',
        bio: '',
        priceFen: 30000,
        travelFen: 0,
        accommodationFen: 0,
        availability: [
          { startAt: '2026-10-28T11:00:00Z', endAt: '2026-10-28T14:00:00Z' },
          { startAt: '2026-10-28T15:00:00Z', endAt: '2026-10-29T01:00:00Z' },
        ],
      },
    ],
  });
  sdk.performance = async () => ({
    profileId: id,
    dataStatus: 'AVAILABLE',
    sourceCount: 0,
    recordedMatchCount: 0,
    completedServiceCount: 0,
    pointsPerRecordedMatch: null,
    foulsPerRecordedMatch: null,
    pendingMatchCount: 0,
    invalidMatchCount: 0,
    teamOnlyMatchCount: 0,
    partialAttributionMatchCount: 0,
    recentRecords: [],
    asOf: '2026-10-25T00:00:00Z',
  });
  h.page.onLoad({ id });
  await h.page.onShow();
  assert.equal(h.page.data.windows[0].display, '10月28日 19:00–22:00');
  assert.equal(h.page.data.windows[1].display, '');
  const html = preview({ route: 'pages/player/index', data: h.page.data }).phone;
  assert.match(html, /2026-10-28 23:00/);
  assert.match(html, /2026-10-29 09:00/);
  assert.equal(h.page.data.profile.portrait, undefined);
});

test('next-year availability retains its year in both the actual Page view model and WXML', async () => {
  const h = loadPage({ root, route: 'pages/player/index' });
  const id = '80000000-0000-4000-8000-000000000001';
  const actor = '80000000-0000-4000-8000-000000000099';
  const ui = h.requireLocal('utils/ui.js');
  ui.session = async () => ({ user: { id: actor } });
  ui.begin = () => ({});
  ui.live = () => true;
  ui.today = () => '2026-12-31';
  const sdk = h.requireLocal('utils/booking.js');
  sdk.workspace = async () => ({
    viewerUserId: actor,
    settings: { feeBps: 1000 },
    players: [
      {
        id,
        userId: actor,
        status: 'APPROVED',
        displayName: '合成球员',
        position: 'PG',
        heightCm: 182,
        city: '高州',
        bio: '',
        priceFen: 30000,
        travelFen: 0,
        accommodationFen: 0,
        availability: [
          { startAt: '2027-01-03T11:00:00Z', endAt: '2027-01-03T14:00:00Z' },
          { startAt: '2026-12-31T11:00:00Z', endAt: '2026-12-31T14:00:00Z' },
        ],
      },
    ],
  });
  sdk.performance = async () => {
    throw { status: 503, message: '合成统计读取失败' };
  };
  h.page.onLoad({ id });
  await h.page.onShow();
  assert.equal(h.page.data.windows[0].display, '2027年1月3日 19:00–22:00');
  assert.equal(h.page.data.windows[1].display, '12月31日 19:00–22:00');
  let html = preview({ route: 'pages/player/index', data: h.page.data }).phone;
  assert.match(html, /2027年1月3日 19:00–22:00/);
  ui.today = () => '2027-01-01';
  await h.page.load();
  assert.equal(h.page.data.windows[0].display, '1月3日 19:00–22:00');
  assert.equal(h.page.data.windows[1].display, '2026年12月31日 19:00–22:00');
  html = preview({ route: 'pages/player/index', data: h.page.data }).phone;
  assert.match(html, /2026年12月31日 19:00–22:00/);
  const marketHtml = preview(fixture('market')).phone;
  assert.match(marketHtml, /placeholder="搜索球员姓名"/);
  assert.doesNotMatch(marketHtml, /搜索球员或位置/);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

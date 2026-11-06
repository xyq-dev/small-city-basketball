const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registeredRoutes } = require('./helpers/registered-routes.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const repository = path.resolve(root, '../..');
const fixtures = path.join(repository, 'tests/mini-program/fixtures');
const read = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));

test('UI005 final matrix keeps all 73 registered routes backed by an isolated fixture', () => {
  const routes = registeredRoutes(read(path.join(root, 'app.json')));
  assert.equal(routes.length, 73);
  assert.equal(new Set(routes).size, 73);
  const covered = new Set(
    fs
      .readdirSync(fixtures)
      .filter((name) => name.endsWith('.json'))
      .map((name) => read(path.join(fixtures, name)).route),
  );
  assert.deepEqual(
    routes.filter((route) => !covered.has(route)),
    [],
  );
});

test('UI005 final matrix maps all 17 supplemental states to their real route templates', () => {
  const aliases = read(path.join(repository, 'tests/mini-program/ui005-state-aliases.json'));
  const direct = [
    'ui005-account-guest.json',
    'ui005-account-wechat-progress.json',
    'ui005-local-location.json',
    'ui005-local-map.json',
    'ui005-watch-empty.json',
  ].map((name) => read(path.join(fixtures, name)));
  const states = [...aliases, ...direct];
  const expectedNodes = [
    '36:62',
    '36:91',
    '36:114',
    '36:115',
    '36:116',
    '36:130',
    '36:131',
    '36:132',
    '36:133',
    '36:134',
    '36:135',
    '36:136',
    '36:137',
    '36:138',
    '36:139',
    '39:53',
    '39:54',
  ];
  assert.equal(states.length, 17);
  assert.deepEqual(states.map((state) => state.figmaNode).sort(), expectedNodes.sort());
  for (const state of states) {
    assert.match(state.route, /^pages\/[a-z0-9-]+\/index$/);
    assert.equal(fs.existsSync(path.join(root, state.route + '.wxml')), true, state.name);
    if (state.sourceFixture) {
      const source = read(path.join(fixtures, state.sourceFixture));
      assert.equal(source.route, state.route, state.name);
    }
  }
});

test('integrated native controls keep readable inputs, usable actions and one safe-area reservation', () => {
  const systemCss = fs.readFileSync(path.join(root, 'styles/figma-system.wxss'), 'utf8');
  const sharedCss = fs.readFileSync(path.join(root, 'styles/figma-pages.wxss'), 'utf8');
  const buttonCss = fs.readFileSync(path.join(root, 'components/figma-button/index.wxss'), 'utf8');
  const navigation = fs.readFileSync(path.join(root, 'components/navigation/index.wxml'), 'utf8');
  assert.match(systemCss, /button\s*\{[^}]*min-height:\s*44px/);
  assert.match(sharedCss, /\.figma-field-control\s*\{[^}]*border:\s*1px solid #7c8ea5/);
  assert.match(sharedCss, /\.figma-field-control\s*\{[^}]*min-height:\s*48px/);
  assert.match(sharedCss, /\.figma-field-control\s*\{[^}]*font-size:\s*16px/);
  assert.match(sharedCss, /\.figma-fixed-actions\s*\{[^}]*bottom:\s*0/);
  assert.match(sharedCss, /\.figma-fixed-actions\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(buttonCss, /\.figma-button\s*\{[^}]*min-height:\s*48px/);
  assert.match(buttonCss, /\.figma-button\s*\{[^}]*white-space:\s*normal/);
  assert.match(navigation, /height:\{\{50\+safeBottom\}\}px/);
});

test('integrated primary action palette keeps dark text on orange and WeChat green', () => {
  const accountCss = fs.readFileSync(path.join(root, 'pages/account/index.wxss'), 'utf8');
  const sharedCss = fs.readFileSync(path.join(root, 'styles/figma-pages.wxss'), 'utf8');
  const buttonCss = fs.readFileSync(path.join(root, 'components/figma-button/index.wxss'), 'utf8');
  assert.match(
    accountCss,
    /\.account-pill\.is-wechat\s*\{[^}]*background:\s*#07c160;\s*color:\s*#18283f/,
  );
  assert.match(
    accountCss,
    /\.account-pill\.is-orange\s*\{[^}]*background:\s*#f28c28;\s*color:\s*#18283f/,
  );
  assert.match(
    sharedCss,
    /\.figma-action--orange\s*\{[^}]*background:\s*#f28c28;\s*color:\s*#18283f/,
  );
  assert.match(
    buttonCss,
    /\.figma-button--wechat\s*\{[^}]*background:\s*#07c160;\s*color:\s*#18283f/,
  );
  for (const page of [
    'booking-create',
    'booking-detail',
    'city-select',
    'compare',
    'local',
    'player',
    'players',
    'search',
    'watch',
  ]) {
    const css = fs.readFileSync(path.join(root, 'pages', page, 'index.wxss'), 'utf8');
    const template = fs.readFileSync(path.join(root, 'pages', page, 'index.wxml'), 'utf8');
    assert.match(css, /@import\s+"\.\.\/\.\.\/styles\/figma-pages\.wxss"/, page);
    assert.match(template, /class="[^"]*figma-action--orange/, page);
  }
});

test('integrated shortcut actions are disabled or absent when no legal target exists', () => {
  const cases = [
    [
      'pages/booking-detail/index',
      { order: { appearances: [], changeAppearanceId: '', primaryAppearanceId: '' } },
      'requestChange',
    ],
    [
      'pages/booking-detail/index',
      { order: { appearances: [], changeAppearanceId: '', primaryAppearanceId: '' } },
      'primaryTrade',
    ],
    [
      'pages/follows/index',
      {
        loginRequired: false,
        items: [{ status: 'INVALID' }],
        activeItems: [],
        inactiveItems: [{ status: 'INVALID' }],
      },
      'openFirst',
    ],
    ['pages/memberships/index', { items: [{ status: 'LEFT' }], selectedId: '' }, 'openSelected'],
    ['pages/memberships/index', { items: [{ status: 'LEFT' }], selectedId: '' }, 'leaveSelected'],
    [
      'pages/local-bookings/index',
      { items: [{ id: 'visible', canActAs: 'BUYER' }], orderFilter: 'PROVIDER', filteredCount: 0 },
      'openCurrent',
    ],
    ['pages/team-requests/index', { allowed: true, requests: [], selectedId: '' }, 'scrollReview'],
    ['pages/registration-events/index', { events: [], hasDraft: false }, 'openDraft'],
  ];
  for (const [route, data, handler] of cases) {
    const html = buildPreview({ root, route, data, width: 320, height: 844 }).phone;
    assert.match(
      html,
      new RegExp(`<button(?=[^>]*data-mini-bindtap="${handler}")(?=[^>]*disabled)[^>]*>`),
      `${route} -> ${handler}`,
    );
  }
  const published = buildPreview({
    root,
    route: 'pages/public-archives/index',
    width: 320,
    height: 844,
    data: {
      primaryProfile: { id: 'published-profile', status: 'PUBLISHED', sources: [] },
      profiles: [{ id: 'published-profile', status: 'PUBLISHED', sources: [] }],
      secondaryProfiles: [],
      publicConsent: true,
    },
  }).phone;
  assert.doesNotMatch(
    published,
    /<button(?=[^>]*data-type="PUBLISH")(?=[^>]*data-mini-bindtap="profileCommand")[^>]*>/,
  );
  const noGrants = buildPreview({
    root,
    route: 'pages/season-grants/index',
    width: 320,
    height: 844,
    data: { mode: 'player', grants: [] },
  }).phone;
  assert.doesNotMatch(noGrants, /<button[^>]*data-mini-bindtap="(?:answer|showStats)"/);

  const local = loadPage({ root, route: 'pages/local-bookings/index' });
  let selected = '';
  local.page.select = (event) => {
    selected = event.currentTarget.dataset.id;
  };
  local.page.setData({
    items: [{ id: 'buyer-order', canActAs: 'BUYER' }],
    orderFilter: 'PROVIDER',
  });
  local.page.openCurrent();
  assert.equal(selected, '', 'a nonempty list cannot open an order outside the current filter');
  local.page.setData({
    items: [
      { id: 'buyer-order', canActAs: 'BUYER' },
      { id: 'provider-order', canActAs: 'PROVIDER' },
    ],
  });
  local.page.openCurrent();
  assert.equal(selected, 'provider-order', 'the current-filter shortcut opens the matching order');
});

test('local review source preserves the exact booking id and opens that order', async () => {
  const sourceId = 'c1000000-0000-4000-8000-000000000042';
  const wx = createWx();
  const review = loadPage({ root, route: 'pages/governance-reviews/index', wx });
  review.page.onLoad({ sourceKind: 'LOCAL_BOOKING', sourceId });
  review.page.openSourceOrder();
  assert.equal(
    wx.calls.find((call) => call.type === 'navigateTo').url,
    `/pages/local-bookings/index?sourceId=${sourceId}`,
  );

  const local = loadPage({ root, route: 'pages/local-bookings/index' });
  const ui = local.requireLocal('utils/ui.js');
  const services = local.requireLocal('utils/local-services.js');
  ui.session = async () => ({ user: { id: 'viewer-1' } });
  ui.begin = () => 1;
  ui.live = () => true;
  services.repository = () => ({
    bookings: async () => [
      { id: sourceId, title: '对应订单', canActAs: 'BUYER', change: null },
      { id: 'c1000000-0000-4000-8000-000000000043', title: '其他订单', canActAs: 'BUYER' },
    ],
  });
  local.page.onLoad({ sourceId });
  await local.page.load();
  assert.equal(local.page.data.selected.id, sourceId);
  assert.equal(local.page.data.selected.title, '对应订单');
});

test('integrated touch targets, long actions and event read failures retain their distinct states', () => {
  const styles = [
    ['pages/home/index.wxss', /\.home-rebuild \.home-event-card\s*\{[^}]*min-height:\s*96px/],
    [
      'pages/account/index.wxss',
      /\.account-check,\s*\.account-confirm-row\s*\{[^}]*min-height:\s*55px/,
    ],
    ['pages/account/index.wxss', /\.account-rebuild \.account-pill\s*\{[^}]*min-height:\s*48px/],
    ['pages/account/index.wxss', /\.account-grid\s*\{[^}]*repeat\(2,/],
    [
      'pages/account/index.wxss',
      /\.account-guest-section \.account-grid__item:last-child\s*\{[^}]*grid-column:\s*1/,
    ],
    ['pages/org-match/index.wxss', /\.org-match-tab\s*\{[^}]*height:\s*44px/],
    ['pages/reschedule/index.wxss', /\.reschedule-tab\s*\{[^}]*min-height:\s*44px/],
    ['pages/seasons/index.wxss', /\.season-tab\s*\{[^}]*min-height:\s*44px/],
    ['pages/city-select/index.wxss', /\.city-rebuild \.city-tab\s*\{[^}]*min-height:\s*44px/],
    ['styles/figma-pages.wxss', /\.figma-page \.figma-action\s*\{[^}]*min-height:\s*48px/],
    [
      'components/figma-button/index.wxss',
      /\.figma-button\s*\{[^}]*min-height:\s*48px;[^}]*white-space:\s*normal/,
    ],
  ];
  for (const [file, expected] of styles)
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), expected, file);
  const event = buildPreview({
    root,
    route: 'pages/event/index',
    width: 390,
    height: 844,
    data: { event: null, loading: false, unavailable: false, error: '合成网络中断' },
  }).phone;
  assert.match(event, /暂时无法读取赛事/);
  assert.match(event, /合成网络中断/);
  assert.match(event, /重新读取/);
  assert.doesNotMatch(event, /暂无操作权限/);
});

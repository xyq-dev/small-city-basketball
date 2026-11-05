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

test('latest UI005 interaction baseline keeps native controls stable and readable', () => {
  const appCss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
  const navigation = fs.readFileSync(path.join(root, 'components/navigation/index.wxml'), 'utf8');
  assert.match(appCss, /button\.button-hover\s*\{[^}]*box-shadow:\s*inset/);
  assert.match(appCss, /\.field,input\.field,textarea\.field\s*\{[^}]*border:\s*1px solid #7c8ea5/);
  assert.match(appCss, /\.field,input\.field,textarea\.field\s*\{[^}]*min-height:\s*48px/);
  assert.match(
    appCss,
    /\.fig-actions\s*\{[^}]*bottom:\s*calc\(50px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(appCss, /\.fig-actions button\s*\{[^}]*white-space:\s*normal/);
  assert.match(navigation, /height:\{\{50\+safeBottom\}\}px/);
});

test('latest UI005 primary action palette uses dark text on orange and WeChat green', () => {
  const cases = [
    [
      'pages/account/index.wxss',
      /\.account-wechat-go\.is-open,[^}]*background:#07c160; color:#18283f/,
    ],
    ['pages/account/index.wxss', /\.account-profile-go\s*\{[^}]*background:#f28c28; color:#18283f/],
    [
      'pages/booking-create/index.wxss',
      /\.create-actions \.primary\s*\{[^}]*color:#18283f; background:#f28c28/,
    ],
    [
      'pages/booking-detail/index.wxss',
      /\.booking-detail-actions \.primary\{[^}]*background:#f28c28;color:#18283f/,
    ],
    ['pages/city-select/index.wxss', /\.city-confirm\s*\{[^}]*color:#18283f; background:#f28c28/],
    [
      'pages/compare/index.wxss',
      /\.comparison-actions \.primary\s*\{[^}]*background: #f28c28; color: #18283f/,
    ],
    ['pages/local/index.wxss', /\.fig-orange\s*\{[^}]*background:#f28c28; color:#18283f/],
    [
      'pages/player/index.wxss',
      /\.profile-action \.primary\s*\{[^}]*background:#f28c28; color:#18283f/,
    ],
    [
      'pages/players/index.wxss',
      /\.market-action \.primary\s*\{[^}]*background: #f28c28; color: #18283f/,
    ],
    ['pages/search/index.wxss', /\.search-confirm\s*\{[^}]*color:#18283f; background:#f28c28/],
    ['pages/watch/index.wxss', /\.fig-orange\s*\{[^}]*background:#f28c28; color:#18283f/],
  ];
  for (const [file, expected] of cases) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), expected, file);
  }
});

test('UI005 shortcut actions are disabled when no legal target exists', () => {
  const cases = [
    [
      'pages/booking-detail/index',
      { order: { appearances: [], canProposeChange: false, canOpenTrade: false } },
      'proposeChange',
    ],
    [
      'pages/follows/index',
      { loginRequired: false, items: [{ status: 'INVALID' }], activeFollowCount: 0 },
      'openFirst',
    ],
    [
      'pages/memberships/index',
      { items: [{ status: 'LEFT' }], activeMembershipCount: 0 },
      'openCurrentTeam',
    ],
    [
      'pages/local-bookings/index',
      { items: [{ id: 'visible', canActAs: 'BUYER' }], orderFilter: 'PROVIDER', filteredCount: 0 },
      'openCurrent',
    ],
    [
      'pages/team-requests/index',
      { allowed: true, requests: [], reviewableCount: 0 },
      'reviewCurrent',
    ],
    [
      'pages/public-archives/index',
      { profiles: [{ status: 'PUBLISHED' }], publishableCount: 0, publicConsent: true },
      'publishFirst',
    ],
    [
      'pages/season-grants/index',
      { grants: [], declinableGrantCount: 0, viewableGrantCount: 0 },
      'declineCurrent',
    ],
    [
      'pages/season-grants/index',
      { grants: [], declinableGrantCount: 0, viewableGrantCount: 0 },
      'showCurrentGrant',
    ],
    [
      'pages/registration-events/index',
      { events: [], hasDraft: false, hasCreatableEvent: false },
      'openDraft',
    ],
    [
      'pages/registration-events/index',
      { events: [], hasDraft: false, hasCreatableEvent: false },
      'openRequirements',
    ],
  ];
  for (const [route, data, handler] of cases) {
    const html = buildPreview({ root, route, data, width: 320, height: 844 }).phone;
    assert.match(
      html,
      new RegExp(`<button(?=[^>]*data-mini-bindtap="${handler}")(?=[^>]*disabled)[^>]*>`),
      `${route} -> ${handler}`,
    );
  }
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

test('UI005 touch targets, long actions and event read failures retain their distinct states', () => {
  const styles = [
    ['pages/home/index.wxss', /\.home-ui \.home-hot\s*\{[^}]*height:auto;[^}]*min-height:96px/],
    [
      'pages/watch/index.wxss',
      /\.watch-main-actions button\.fig-orange\s*\{[^}]*background:#f28c28;[^}]*color:#18283f/,
    ],
    ['pages/account/index.wxss', /\.account-consent\s*\{[^}]*min-height:44px/],
    [
      'pages/account/index.wxss',
      /\.account-state-actions button,[^}]*height:auto;[^}]*white-space:normal/,
    ],
    [
      'pages/account/index.wxss',
      /\.account-shortcuts\.account-guest-shortcuts\s*\{[^}]*repeat\(3,/,
    ],
    ['pages/org-match/index.wxss', /\.score-meta > text:first-child\s*\{[^}]*min-height:44px/],
    ['pages/reschedule/index.wxss', /\.reschedule-tabs view\s*\{[^}]*min-height:44px/],
    ['pages/reschedule/index.wxss', /\.reschedule-current \.board-meta\s*\{[^}]*min-height:44px/],
    ['pages/seasons/index.wxss', /\.season-tabs view\s*\{[^}]*min-height:44px/],
    ['pages/city-select/index.wxss', /\.city-actions button\s*\{[^}]*white-space:normal/],
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
  assert.match(event, /授权状态尚未读取/);
  assert.doesNotMatch(event, /暂无操作权限/);
});

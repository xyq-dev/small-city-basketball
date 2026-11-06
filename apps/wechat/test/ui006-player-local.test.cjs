const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const pages = {
  local: ['36:54', '同城篮球'],
  players: ['36:76', '选择适合本场的球员'],
  player: ['36:77', '球员服务档案'],
  compare: ['36:78', '同价球员对比'],
  'booking-create': ['36:79', '创建预约'],
  bookings: ['36:80', '我的预约'],
  'booking-detail': ['36:81', '球员合作详情'],
  'player-center': ['36:82', '本人服务档案'],
  performance: ['36:83', '比赛数据授权'],
  'local-manage': ['36:84', '供给与档期管理'],
  'local-bookings': ['36:85', '同城服务订单'],
  'local-matchups': ['36:86', '球队约赛'],
  matching: ['36:87', '全国撮合'],
  dispatch: ['36:88', '跨城人员派单'],
  training: ['36:89', '成人篮球短课'],
  'training-manage': ['36:90', '培训工作台'],
};

const read = (page, ext) =>
  fs.readFileSync(path.join(root, 'pages', page, `index.${ext}`), 'utf8');

test('UI006 Agent B pages use the new Figma page system and page-specific design copy', () => {
  for (const [page, [node, copy]] of Object.entries(pages)) {
    const wxml = read(page, 'wxml');
    const wxss = read(page, 'wxss');
    assert.match(wxml, /class="[^"]*figma-page/, `${page} (${node}) root`);
    assert.match(wxml, new RegExp(copy), `${page} (${node}) copy`);
    assert.doesNotMatch(wxml, /<web-view\b|background-image:\s*url\([^)]*figma/i, page);
    assert.doesNotMatch(wxss, /(^|[}\s])page\s*\{/, `${page} must not reset the global page`);
  }
});

test('reviewed Group B pages retain the node-specific Figma content hierarchy', () => {
  const expectations = {
    players: ['筛选球员', '可约球员', '对比名单'],
    player: ['服务', '档期', '有限记录', '单场报价', '授权比赛数据'],
    compare: ['同价球员对比', '专业统计', '未统计'],
    bookings: ['当前合作', '报价与资金', '合作进度'],
    'player-center': ['本人服务档案', '可约窗口'],
    performance: ['本次提名', '有限公开的内容', '本人声明'],
    'local-manage': ['供给资料', '开放档期', '上架核验'],
    'local-bookings': ['本次服务', '履约与资金'],
    'local-matchups': ['场地预约', '双方球队', '约赛进度'],
    matching: ['当前需求', '候选球员', '转预约流程'],
    dispatch: ['服务邀请', '完整报价', '行程与接单'],
    training: ['课程信息', '固定课次', '报名确认'],
    'training-manage': ['本周课表', '本课签到', '需要处理'],
  };
  for (const [page, copies] of Object.entries(expectations)) {
    const wxml = read(page, 'wxml');
    for (const copy of copies) assert.match(wxml, new RegExp(copy), `${page}: ${copy}`);
  }
  assert.doesNotMatch(read('player', 'wxml'), /fee-row--total/);
  assert.match(read('performance', 'js'), /filter:\s*'PENDING'/);
  assert.match(read('training-manage', 'js'), /manageTab:\s*'teaching'/);
});

test('all WXML event targets remain backed by page methods', () => {
  for (const page of Object.keys(pages)) {
    const wxml = read(page, 'wxml');
    const js = read(page, 'js');
    const handlers = new Set();
    for (const match of wxml.matchAll(/\b(?:bind|catch)(?::[\w-]+|[a-z]+)="([A-Za-z_$][\w$]*)"/g)) {
      handlers.add(match[1]);
    }
    for (const handler of handlers) {
      assert.match(
        js,
        new RegExp(`(?:^|\\n)\\s{2}(?:async\\s+)?${handler}\\s*\\(`),
        `${page}.${handler}`,
      );
    }
  }
});

test('private local workspaces keep scoped state styling without shared-style leakage', () => {
  for (const page of ['local-manage', 'local-bookings', 'local-matchups']) {
    const wxml = read(page, 'wxml');
    const wxss = read(page, 'wxss');
    assert.match(wxml, /class="[^"]*local-private/);
    assert.match(wxml, /class="[^"]*status-banner/);
    assert.match(wxss, /\.local-private \.status-banner\s*\{[^}]*background:\s*#eaf0f8/s);
    assert.doesNotMatch(wxss, /@import/);
  }
  assert.match(read('local-manage', 'wxml'), /figma-summary__icon/);
  assert.match(read('local-bookings', 'wxml'), /figma-summary__icon/);
  assert.match(read('local-matchups', 'wxml'), /figma-summary__icon/);
  assert.match(read('local-manage', 'wxss'), /\.manage-tab\.is-active\s*\{[^}]*background:\s*#123c73[^}]*color:\s*#fff/s);
  assert.match(read('local-bookings', 'wxss'), /\.order-tab\.is-active,\s*\.detail-tab\.is-active\s*\{[^}]*background:\s*#123c73[^}]*color:\s*#fff/s);
  assert.match(read('local-matchups', 'wxss'), /\.matchup-tab\.is-active\s*\{[^}]*background:\s*#123c73[^}]*color:\s*#fff/s);
});

test('responsive controls retain semantic text at narrow and wide widths', () => {
  const shared = fs.readFileSync(path.join(root, 'styles', 'figma-pages.wxss'), 'utf8');
  assert.match(shared, /@media \(max-width: 360px\)/);
  assert.match(shared, /\.figma-page \.figma-action\s*\{[\s\S]*?min-height:\s*48px/);
  for (const page of Object.keys(pages)) {
    const wxml = read(page, 'wxml');
    const wxss = read(page, 'wxss');
    assert.doesNotMatch(wxml, /style="[^"]*(?:width:\s*(?:3[2-9]\d|4[0-3]\d)px|white-space:\s*nowrap)/i, page);
    assert.doesNotMatch(wxss, /\.figma-action[^{]*\{[^}]*white-space:\s*nowrap/i, page);
  }
  for (const page of ['local-manage', 'local-bookings', 'local-matchups']) {
    assert.match(read(page, 'wxss'), /@media\s*\(max-width:\s*340px\)/);
  }
});

test('all assigned native templates render at 320, 390 and 430 widths', () => {
  for (const page of Object.keys(pages)) {
    const route = `pages/${page}/index`;
    const harness = loadPage({ root, route });
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route, data: harness.page.data, width, height: 844 });
      assert.match(preview.phone, /figma-page/, `${page} ${width}`);
    }
  }
});

test('player and local booking paths remain distinct and preserve pending recovery', () => {
  const player = read('player', 'js');
  const local = read('local', 'js');
  const bookingCreate = read('booking-create', 'js');
  const localBookings = read('local-bookings', 'js');
  assert.match(player, /ui\.open\('booking-create'/);
  assert.match(local, /local-bookings/);
  assert.match(local, /pendingError/);
  assert.match(bookingCreate, /if \((?:this\.data\.busy|this\._loading \|\| this\._busy)/);
  assert.match(bookingCreate, /recover/);
  assert.match(localBookings, /REDEEM_CHECKIN/);
  assert.match(localBookings, /generation/);
});

test('buyer-provider permissions, quote confirmation and real-fund wording remain explicit', () => {
  const localBookingsWxml = read('local-bookings', 'wxml');
  const localBookingsJs = read('local-bookings', 'js');
  const matching = read('matching', 'js');
  const dispatch = read('dispatch', 'js');
  const training = read('training', 'js');
  const trainingWxml = read('training', 'wxml');
  assert.match(localBookingsWxml, /BUYER/);
  assert.match(localBookingsWxml, /PROVIDER/);
  assert.match(localBookingsJs, /canActAs/);
  assert.match(matching, /chargeConsent/);
  assert.match(matching, /pending/);
  assert.match(dispatch, /CONFIRM_QUOTE/);
  assert.match(dispatch, /expectedVersion/);
  assert.match(training, /AUTHORIZE_PAYMENT/);
  assert.match(trainingWxml, /PAID_UNALLOCATED/);
});

test('player money labels keep the single currency symbol supplied by the view model', () => {
  for (const page of ['players', 'player']) {
    const wxml = read(page, 'wxml');
    assert.doesNotMatch(wxml, /¥\s*{{[^}]+(?:price|platformFee|total)/, page);
  }
  assert.match(read('player', 'wxml'), /授权比赛数据/);
  assert.match(read('player', 'wxml'), /篮板、助攻、上场时间/);
});

test('local base, map and location states render as independent host-route branches', () => {
  const route = 'pages/local/index';
  const harness = loadPage({ root, route });
  const render = (data) => buildPreview({ root, route, data, width: 390, height: 844 }).phone;
  const listing = {
    id: 'fixture-listing',
    title: '隔离夹具球场',
    address: '合成地址',
    distanceLabel: '未计算距离',
  };

  assert.equal(harness.page.data.filtersOpen, false, '36:54 starts with filters collapsed');
  assert.equal(harness.page.data.mapVisible, false, '36:54 starts in list mode');
  const base = render({ ...harness.page.data, loaded: true, items: [listing] });
  assert.ok(base.indexOf('按需发现') < base.indexOf('球场与档期'));
  assert.doesNotMatch(base, /选城与距离起点|范围与起点|浏览城市与距离起点不同/);

  const map = render({
    ...harness.page.data,
    mapVisible: true,
    filtersOpen: false,
    loaded: true,
    items: [listing],
    selection: { mode: 'REGION', label: '广东 · 高州' },
    hasOrigin: true,
    originLabel: '体育中心 · 手动选择',
  });
  assert.match(map, /地图找服务/); // 36:91
  assert.match(map, /范围与起点/);
  assert.match(map, /区域内已发布供给/);
  assert.doesNotMatch(map, /按需发现|浏览城市与距离起点不同/);

  const location = render({
    ...harness.page.data,
    mapVisible: false,
    filtersOpen: true,
    loaded: true,
    items: [],
    locationEnabled: false,
    locationError: '',
  });
  assert.match(location, /选城与距离起点/); // 36:133
  assert.match(location, /浏览城市与距离起点不同/);
  assert.match(location, /定位未授权/);
  assert.match(location, /暂无已审核供给/);
  assert.doesNotMatch(location, /按需发现|地图找服务/);

  harness.page.setData({ mapVisible: true, filtersOpen: false });
  harness.page.toggleFilters();
  assert.equal(harness.page.data.mapVisible, false);
  assert.equal(harness.page.data.filtersOpen, true);
  harness.page.closeLocalState();
  assert.equal(harness.page.data.filtersOpen, false);
});

test('supplemental states stay inside their host routes', () => {
  const local = read('local', 'wxml');
  const center = read('player-center', 'wxml');
  assert.match(local, /mapVisible/); // 36:91 map state
  assert.match(local, /filtersOpen/); // 36:133 location state
  assert.match(center, /pending|待核对/); // 36:136 result-pending state
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const registered = JSON.stringify(app.pages || []).concat(JSON.stringify(app.subpackages || []));
  for (const state of ['36:91', '36:133', '36:136']) assert.doesNotMatch(registered, new RegExp(state));
});

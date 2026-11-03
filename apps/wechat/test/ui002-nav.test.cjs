const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(1),
  org = id(2);
const fixtureRoot = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name + '.json')));
const envelope = (data) => ({ data, meta: { requestId: 'synthetic-ui002-nav' } });
function render(name, data, width = 390) {
  const output = buildPreview({
    root,
    route: 'pages/' + name + '/index',
    data,
    width,
    height: 844,
  });
  return { ...output, body: output.phone.slice(output.phone.indexOf('<body')) };
}
const tap = (dataset) => ({ currentTarget: { dataset } });
function account(organizations = []) {
  let viewer = actor,
    revision = 1;
  const calls = [],
    listeners = new Set();
  const client = {
    hasSession: () => true,
    viewerId: () => viewer,
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return envelope({
          user: { id: viewer, displayName: '合成本人', email: 'fixture@example.test' },
          organizations,
          teamContexts: [],
        });
      if (url === '/v1/auth/wechat/capabilities') return envelope({ enabled: false });
      if (url === '/v1/auth/capabilities') return envelope({ canRegisterParticipant: false });
      if (url === '/v1/auth/wechat/binding') return envelope({ connected: false, version: 1 });
      throw Error('unexpected account request: ' + url);
    },
  };
  const h = loadPage({
    root,
    route: 'pages/account/index',
    wx: createWx(),
    modules: {
      './api': { ...api, getClient: () => client },
      '../../utils/api': { ...api, getClient: () => client },
    },
  });
  h.page.onLoad({});
  return {
    ...h,
    calls,
    switchActor() {
      viewer = id(9);
      revision++;
      for (const listener of listeners) listener();
    },
  };
}
function local() {
  const calls = [];
  const region = { regionId: id(3), catalogVersion: 'synthetic-ui002' };
  const client = {
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body, anonymous) {
      calls.push({ url, method, body, anonymous });
      assert.equal(url, '/v1/public/local-search');
      const listing = {
        id: id(4),
        kind: body.kind || 'COURT',
        title: '合成已审核供给',
        description: '仅合成布局',
        address: '合成市合成路1号',
        region,
        point: null,
        coverageRegionIds: [region.regionId],
        status: 'APPROVED',
        version: 1,
        providerConfirmed: true,
        qualifiedUntil: '2028-06-01T10:00:00Z',
        published: true,
        organizationName: '合成经营方',
        distanceMeters: null,
        distanceLabel: null,
      };
      return envelope({
        items: [listing],
        nextCursor: null,
        locationCapability: { enabled: false, coordinateSystem: 'GCJ02' },
        queryOrigin: 'REGION',
        truncated: false,
      });
    },
  };
  const wx = createWx();
  wx.getLocation = () => {
    throw Error('navigation must not request location automatically');
  };
  const h = loadPage({
    root,
    route: 'pages/local/index',
    wx,
    modules: {
      './api': { ...api, getClient: () => client },
      '../../utils/api': { ...api, getClient: () => client },
    },
  });
  h.page.onLoad({});
  return { ...h, calls };
}

test('A01 exposes identity, four personal priorities and three resource work entries before optional legacy consumers', async () => {
  const h = account();
  h.page.onShow();
  await h.flush();
  for (const width of [320, 390, 430]) {
    const output = render('account', h.page.data, width),
      html = output.body;
    for (const text of [
      '本人报名与资料',
      '我的订单与预约',
      '关注赛事与消息',
      '公开档案与数据授权',
      '当前角色工作台',
      '直播与媒体（先选赛事比赛）',
    ])
      assert.ok(html.includes(text), text);
    assert.ok(html.indexOf('account-profile') < html.indexOf('account-primary'));
    assert.ok(html.indexOf('account-primary') < html.indexOf('account-workspace'));
    assert.doesNotMatch(html, /我的球赛主场|class="hero account-hero"|data-page="team-request"/);
    const work = html.slice(
      html.indexOf('class="menu-group account-workspace"'),
      html.lastIndexOf('<button', html.indexOf('class="secondary account-security-entry"')),
    );
    assert.equal((work.match(/<button\b/g) || []).length, 3);
    assert.equal((work.match(/<button\b[^>]*disabled/g) || []).length, 3);
    assert.ok(output.assets.some((asset) => asset.path.endsWith('/avatar-user.svg')));
    assert.equal(
      output.assets.some((asset) => /player-sample|portrait|placeholder\.png/.test(asset.path)),
      false,
    );
  }
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('A01 order and more panels retain old destinations and current organization scope without changing account command state', async () => {
  const h = account([
    { id: org, name: '合成管理机构', role: 'ORG_OWNER' },
    { id: id(5), name: '合成赛事分工', role: 'EVENT_MANAGER' },
  ]);
  h.page.onShow();
  await h.flush();
  h.page.setData({ password: 'synthetic-password-draft', consent: true });
  h.page.toggleOrders();
  assert.match(render('account', h.page.data).body, /data-page="local-bookings"/);
  h.page.go(tap({ page: 'bookings' }));
  assert.equal(h.wx.calls.at(-1).url, '/pages/bookings/index?view=sent');
  h.page.toggleMore();
  h.page.workspace(tap({ key: 'work' }));
  const work = render('account', h.page.data).body;
  assert.match(work, /建队申请审批/);
  assert.match(work, /data-org="10000000-0000-4000-8000-000000000002"/);
  assert.doesNotMatch(work, /data-org="10000000-0000-4000-8000-000000000005"/);
  h.page.go(tap({ page: 'training-manage', org }));
  assert.equal(h.wx.calls.at(-1).url, '/pages/training-manage/index?orgId=' + org);
  h.page.go(tap({ page: 'watch' }));
  assert.equal(h.wx.calls.at(-1).type, 'redirectTo');
  assert.equal(h.wx.calls.at(-1).url, '/pages/watch/index');
  const panels = {
    ordersOpen: h.page.data.ordersOpen,
    navigationMoreOpen: h.page.data.navigationMoreOpen,
  };
  h.page.setData({ busy: true });
  h.page.toggleOrders();
  h.page.toggleMore();
  assert.deepEqual(
    { ordersOpen: h.page.data.ordersOpen, navigationMoreOpen: h.page.data.navigationMoreOpen },
    panels,
  );
  assert.equal(h.page.data.password, 'synthetic-password-draft');
  assert.equal(h.page.data.consent, true);
  h.switchActor();
  assert.equal(h.page.data.ordersOpen, false);
  assert.equal(h.page.data.navigationMoreOpen, false);
  assert.equal(h.page.data.user, null);
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('L01 prioritizes real court results and routes optional personnel filtering through the original public search only', async () => {
  const h = local();
  h.page.onShow();
  await h.flush();
  assert.equal(h.page.data.kind, 'COURT');
  assert.equal(h.calls[0].body.kind, 'COURT');
  for (const width of [320, 390, 430]) {
    const output = render('local', h.page.data, width),
      html = output.body;
    assert.ok(html.indexOf('local-top-tabs') < html.indexOf('local-brand'));
    assert.ok(html.indexOf('local-brand') < html.indexOf('local-service-tabs'));
    assert.ok(html.indexOf('local-service-tabs') < html.indexOf('listing-entry'));
    assert.match(html, /合成已审核供给/);
    assert.match(html, /查看场馆与可约时间/);
    assert.doesNotMatch(
      html,
      /data-mini-bindtap="locate"|data-mini-bindtap="searchPlaces"|data-mini-bindtap="expansion"/,
    );
    assert.ok(output.assets.some((asset) => asset.path.endsWith('/court-illustration.svg')));
    assert.ok(output.assets.some((asset) => asset.path.endsWith('/node-4-43-0.svg')));
  }
  const reads = h.calls.length;
  h.page.toggleFilters();
  assert.equal(h.calls.length, reads);
  const expanded = render('local', h.page.data).body;
  for (const handler of ['locate', 'searchPlaces', 'search', 'expansion', 'manage'])
    assert.ok(expanded.includes('data-mini-bindtap="' + handler + '"'), handler);
  h.page.kind(tap({ value: 'REFEREE' }));
  await h.flush();
  assert.equal(h.calls.at(-1).body.kind, 'REFEREE');
  assert.match(render('local', h.page.data).body, /查看人员与可约时间/);
  h.page.kind(tap({ value: '' }));
  await h.flush();
  assert.equal(Object.hasOwn(h.calls.at(-1).body, 'kind'), false);
  assert.equal(
    h.calls.every((call) => call.url === '/v1/public/local-search' && call.anonymous === true),
    true,
  );
});

test('home court and referee links select the existing local kind before the first search', () => {
  const court = loadPage({ root, route: 'pages/local/index' });
  court.page.onLoad({ kind: 'COURT' });
  assert.equal(court.page.data.kind, 'COURT');
  const referee = loadPage({ root, route: 'pages/local/index' });
  referee.page.onLoad({ kind: 'REFEREE' });
  assert.equal(referee.page.data.kind, 'REFEREE');
  const ignored = loadPage({ root, route: 'pages/local/index' });
  ignored.page.onLoad({ kind: 'NOT_A_KIND' });
  assert.equal(ignored.page.data.kind, 'COURT');
});

test('L01 navigation and optional tools keep unresolved operations and all original map and charge gates', () => {
  const h = local();
  const pending = { body: { commandId: id(7) } };
  h.page.setData({ pending, pendingError: '', busy: false });
  h.page.toggleFilters();
  assert.equal(h.page.data.filtersOpen, false);
  h.page.players();
  assert.equal(h.wx.calls.at(-1).url, '/pages/players/index');
  assert.deepEqual(h.page.data.pending, pending);
  const unknown = fixture('ui002-root-local-unknown').data;
  const html = render('local', {
    ...unknown,
    mapVisible: true,
    mapCenter: { latitude: 22.9, longitude: 111 },
    viewportEnabled: true,
    viewportDirty: true,
    viewportBusy: true,
    nextCursor: 'synthetic-next',
    pending,
  }).body;
  for (const handler of ['recover', 'retry', 'searchThisArea', 'cityList'])
    assert.ok(html.includes('data-mini-bindtap="' + handler + '"'), handler);
  assert.match(html, /data-mini-bindtap="searchThisArea"[^>]*disabled/);
  assert.match(html, /data-mini-bindtap="more"[^>]*disabled/);
  assert.equal(h.calls.length, 0);
});

test('A01 and L01 templates retain real handler implementations and account security and guest recovery consumers', () => {
  for (const name of ['account', 'local']) {
    const h = loadPage({ root, route: 'pages/' + name + '/index' });
    const source = fs.readFileSync(path.join(root, 'pages/' + name + '/index.wxml'), 'utf8');
    for (const handler of eventHandlers(parseWxml(source)))
      assert.equal(typeof h.page[handler], 'function', name + ': ' + handler);
  }
  const login = render('account', { user: null, canRegister: false }).body;
  assert.match(login, /data-mini-bindtap="login"/);
  assert.match(login, /微信登录暂未开放/);
  const security = render('account', {
    user: { id: actor, displayName: '合成本人' },
    securityOpen: true,
    connected: true,
    busy: false,
    consent: false,
  }).body;
  assert.match(security, /data-mini-bindtap="unbind"[^>]*disabled/);
  assert.match(security, /data-page="governance"/);
  assert.match(security, /data-mini-bindtap="closeSecurity"/);
});

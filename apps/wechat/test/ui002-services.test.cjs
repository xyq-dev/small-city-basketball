const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
function page(name = 'matching') {
  const h = loadPage({ root, route: 'pages/' + name + '/index', wx: createWx() });
  h.page.onLoad({});
  return h;
}
function markup(name, data) {
  return buildPreview({ root, route: 'pages/' + name + '/index', data, width: 390, height: 844 })
    .phone;
}
const tap = (key) => ({ currentTarget: { dataset: { key } } });
test('matching reviews actual disclosure before publish and returns to editable fields without an API write', () => {
  const h = page();
  h.page.setData({ enabled: true, selected: { id: 'private-need' } });
  h.page.toggleCreate();
  assert.equal(h.page.data.selected, null);
  let html = markup('matching', h.page.data);
  assert.match(html, /下一步：审阅公开范围/);
  assert.doesNotMatch(html, /确认并发布需求/);
  h.page.reviewNeed();
  assert.match(h.page.data.error, /名称/);
  h.page.setData({
    form: { ...h.page.data.form, title: '合成成人篮球补位需求', address: '合成体育中心东侧二号场' },
    scope: [{ regionId: 'region', label: '合成地区长名称' }],
  });
  h.page.reviewNeed();
  html = markup('matching', h.page.data);
  assert.match(html, /合成成人篮球补位需求/);
  assert.match(html, /合成体育中心东侧二号场/);
  assert.match(html, /合成地区长名称/);
  assert.match(html, /意向不锁位、不付款/);
  assert.match(html, /确认并发布需求/);
  h.page.editNeed();
  assert.equal(h.page.data.form.title, '合成成人篮球补位需求');
  assert.doesNotMatch(markup('matching', h.page.data), /确认并发布需求/);
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
});
test('matching tab navigation and return preserve unresolved original commands and block busy transitions', () => {
  const h = page();
  const original = { body: { commandId: 'original-command' } };
  h.page.setData({
    pending: original,
    selected: { id: 'private-need' },
    conversion: { id: 'intent' },
    chargeConsent: true,
    eligibility: true,
  });
  h.page.overview();
  assert.equal(h.page.data.pending.body.commandId, 'original-command');
  assert.equal(h.page.data.chargeConsent, false);
  assert.equal(h.page.data.eligibility, false);
  h.page.workspaceTab(tap('inbox'));
  assert.equal(h.page.data.workspaceTab, 'inbox');
  h.page.setData({ busy: true });
  h.page.workspaceTab(tap('needs'));
  h.page.overview();
  assert.equal(h.page.data.workspaceTab, 'inbox');
  assert.equal(h.page.data.pending.body.commandId, 'original-command');
});
test('matching account change drops the privacy review and opt-ins instead of carrying them into a new actor', () => {
  const h = page();
  h.page.setData({
    creating: true,
    supplyOpen: true,
    formStep: 'review',
    adult: true,
    discovery: true,
    contact: true,
  });
  h.page.onSessionReset();
  assert.equal(h.page.data.creating, false);
  assert.equal(h.page.data.supplyOpen, false);
  assert.equal(h.page.data.adult, false);
  assert.equal(h.page.data.discovery, false);
  assert.equal(h.page.data.contact, false);
  assert.equal(h.page.data.loginRequired, true);
});

test('matching new actor cannot reopen another actor draft, scope, quote or charge consent', () => {
  const h = page();
  h.page.setData({
    enabled: true,
    conversionEnabled: true,
    form: { title: 'private previous-actor title', address: 'private previous-actor address' },
    formRegion: { regionId: 'private-region' },
    scope: [{ regionId: 'private-region' }],
    windows: [{ date: 'private-date' }],
    terms: 'private negotiated terms',
    preview: { merchantName: 'private merchant' },
    chargeConsent: true,
    eligibility: true,
    courts: [{ id: 'private-booking' }],
    teamIndex: 4,
    orgIndex: 3,
  });
  h.page.onSessionReset();
  assert.equal(h.page.data.enabled, false);
  assert.equal(h.page.data.conversionEnabled, false);
  assert.equal(h.page.data.form.title, '');
  assert.equal(h.page.data.form.address, '');
  assert.equal(h.page.data.formRegion, null);
  assert.equal(h.page.data.scope.length, 0);
  assert.notEqual(h.page.data.windows[0].date, 'private-date');
  assert.equal(h.page.data.terms, '');
  assert.equal(h.page.data.preview, null);
  assert.equal(h.page.data.chargeConsent, false);
  assert.equal(h.page.data.eligibility, false);
  assert.equal(h.page.data.courts.length, 0);
  h.page.toggleCreate();
  const html = markup('matching', h.page.data);
  assert.doesNotMatch(
    html,
    /private previous-actor|private negotiated|private-region|private merchant/,
  );
});

test('training separates course reading from explicit adult and frozen-charge review without writing', () => {
  const h = page('training');
  h.page.setData({
    enabled: true,
    detail: {
      id: 'cohort',
      title: '合成成人短班',
      totalFen: 96000,
      amount: '¥960.00',
      termsText: '合成冻结合同',
      sessions: [],
      capabilities: { canEnroll: true, paidEnrollmentEnabled: true },
    },
    adult: true,
    accepted: true,
    chargeConsent: true,
  });
  assert.doesNotMatch(markup('training', h.page.data), /data-mini-bindtap="enroll"/);
  h.page.reviewSignup();
  assert.equal(h.page.data.adult, false);
  assert.equal(h.page.data.accepted, false);
  assert.equal(h.page.data.chargeConsent, false);
  let html = markup('training', h.page.data);
  let submit = html.match(/<button[^>]*data-mini-bindtap="enroll"[^>]*>/);
  assert.ok(submit);
  assert.match(submit[0], /disabled/);
  assert.match(html, /青少年招生与培训专用监护授权尚未开放/);
  h.page.consent({ detail: { value: ['adult', 'terms', 'payment'] } });
  html = markup('training', h.page.data);
  submit = html.match(/<button[^>]*data-mini-bindtap="enroll"[^>]*>/);
  assert.doesNotMatch(submit[0], /disabled/);
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
  h.page.setData({ pending: { body: { commandId: 'original-training' } } });
  h.page.backToList();
  assert.equal(h.page.data.pending.body.commandId, 'original-training');
  assert.equal(h.page.data.detail, null);
  assert.equal(h.page.data.chargeConsent, false);
});
test('training workspace separates teaching, scheduling and refund review without consuming a class', () => {
  const h = page('training-manage');
  h.page.setData({
    workspace: {
      capabilities: { enabled: true },
      provider: { name: '合成机构', status: 'APPROVED' },
      coaches: [],
      courses: [],
      cohorts: [],
      enrollments: [],
    },
    teaching: [
      { id: 'lesson', title: '合成教练课表', time: '合成日期09:00', stateLabel: '待上课' },
    ],
    reason: 'private grounds',
  });
  h.page.manageTab(tap('teaching'));
  let html = markup('training-manage', h.page.data);
  assert.match(html, /合成教练课表/);
  assert.doesNotMatch(html, /保存课程/);
  h.page.manageTab(tap('setup'));
  html = markup('training-manage', h.page.data);
  assert.match(html, /保存课程/);
  assert.doesNotMatch(html, /合成教练课表/);
  h.page.manageTab(tap('reviews'));
  assert.match(markup('training-manage', h.page.data), /暂无待核对报名/);
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
  h.page.setData({
    address: 'private address',
    price: '900',
    termsText: 'private terms',
    orgId: 'private org',
    isOperator: true,
  });
  h.page.onSessionReset();
  assert.equal(h.page.data.workspace, null);
  assert.equal(h.page.data.reason, '');
  assert.equal(h.page.data.address, '');
  assert.equal(h.page.data.price, '0.00');
  assert.equal(h.page.data.termsText, '');
  assert.equal(h.page.data.orgId, '');
  assert.equal(h.page.data.isOperator, false);
});

test('dispatch workspaces separate customer and provider actions while pending quotes stay tied to the original operation', () => {
  const h = page('dispatch');
  h.page.workspace(tap('create'));
  assert.equal(h.page.data.dispatchView, 'requests');
  h.page.setData({
    organizations: [{ id: 'org', name: '合成有权机构' }],
    capabilities: { enabled: true },
    pending: { body: { commandId: 'original-dispatch' } },
  });
  h.page.workspace(tap('create'));
  let html = markup('dispatch', h.page.data);
  assert.match(html, /建立一项跨城人员需求/);
  assert.doesNotMatch(html, /本人跨城接单许可/);
  h.page.workspace(tap('preference'));
  html = markup('dispatch', h.page.data);
  assert.match(html, /本人跨城接单许可/);
  assert.doesNotMatch(html, /建立一项跨城人员需求/);
  assert.equal(h.page.data.pending.body.commandId, 'original-dispatch');
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
  h.page.onSessionReset();
  assert.equal(h.page.data.capabilities, null);
  assert.equal(h.page.data.dispatchView, 'requests');
});
test('advertiser default view hides management configuration and tab-only navigation never dispatches funds', () => {
  const h = page('sponsor-commerce');
  h.page.setData({
    enabled: true,
    organizations: [{ id: 'org', name: '合成合作机构' }],
    canManage: false,
    canFinance: false,
  });
  h.page.workspace(tap('setup'));
  assert.equal(h.page.data.workspaceView, 'contracts');
  let html = markup('sponsor-commerce', h.page.data);
  assert.doesNotMatch(html, /建立固定价合同|受益主体审核/);
  h.page.setData({ canManage: true });
  h.page.workspace(tap('setup'));
  html = markup('sponsor-commerce', h.page.data);
  assert.match(html, /建立固定价合同/);
  h.page.setData({ pending: { body: { commandId: 'original-advertising' } } });
  h.page.workspace(tap('contracts'));
  assert.equal(h.page.data.workspaceView, 'setup');
  assert.equal(h.page.data.pending.body.commandId, 'original-advertising');
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
  h.page.setData({
    payerEmail: 'private@example.invalid',
    terms: 'private terms',
    amount: '90',
    evidence: 'private evidence',
    shares: [{ private: true }],
    canFinance: true,
    enabled: true,
  });
  h.page.onSessionReset();
  assert.equal(h.page.data.payerEmail, '');
  assert.equal(h.page.data.terms, '');
  assert.equal(h.page.data.amount, '');
  assert.equal(h.page.data.evidence, '');
  assert.equal(h.page.data.shares.length, 0);
  assert.equal(h.page.data.canFinance, false);
  assert.equal(h.page.data.enabled, false);
});

test('returning after an account switch while hidden scrubs previous service drafts before loading the new actor', async () => {
  const previous = '10000000-0000-4000-8000-000000000001';
  const current = '10000000-0000-4000-8000-000000000002';
  for (const name of ['matching', 'dispatch', 'training', 'training-manage', 'sponsor-commerce']) {
    const calls = [];
    const client = {
      viewerId: () => current,
      sessionRevision: () => 1,
      onSessionChange: () => () => {},
      async request(url, method = 'GET') {
        calls.push({ url, method });
        if (url === '/v1/auth/session')
          return { data: { user: { id: current }, organizations: [], teamContexts: [] } };
        if (url === '/v1/matching')
          return {
            data: {
              enabled: false,
              conversionEnabled: false,
              needs: [],
              inbox: [],
              sources: [],
              preferences: [],
            },
          };
        if (url === '/v1/dispatch')
          return {
            data: {
              requests: [],
              offers: [],
              preference: null,
              capabilities: { enabled: false, conversionEnabled: false },
            },
          };
        if (url === '/v1/training/mine')
          return { data: { items: [], teaching: [], coachProfiles: [] } };
        if (url === '/v1/me/sponsor-commerce') return { data: { organizations: [] } };
        throw Error('unexpected private request: ' + url);
      },
    };
    const api = { getClient: () => client, uuid: (value) => value };
    const h = loadPage({
      root,
      route: 'pages/' + name + '/index',
      wx: createWx(),
      modules: { './api': api, '../../utils/api': api },
    });
    h.page.onLoad({});
    h.page._visible = true;
    h.page._hidden = false;
    h.page._viewer = previous;
    h.page._actor = previous;
    const drafts = Object.fromEntries(
      Object.entries({
        address: 'private old venue',
        payerUserId: previous,
        payerEmail: 'private@example.invalid',
        terms: 'private old terms',
        termsText: 'private old terms',
        reason: 'private old reason',
        evidence: 'private old evidence',
      }).filter(([key]) => Object.hasOwn(h.page.data, key)),
    );
    if (Object.hasOwn(h.page.data, 'form'))
      drafts.form = {
        ...h.page.data.form,
        title: 'private old draft',
        address: 'private old venue',
      };
    h.page.setData(drafts);
    if (name === 'training') await h.page.identify();
    else await h.page.load();
    const serialized = JSON.stringify(h.page.data);
    assert.doesNotMatch(serialized, /private old|private@example.invalid/, name);
    assert.equal(calls.filter((x) => x.method !== 'GET').length, 0, name);
  }
});

const raceId = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
function deferredPage(name, extraModules = {}) {
  const requests = [];
  let current = '10000000-0000-4000-8000-000000000001';
  const client = {
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    viewerId: () => current,
    request: (url, method = 'GET', body) =>
      url === '/v1/auth/session'
        ? Promise.resolve({ data: { user: { id: current }, organizations: [], teamContexts: [] } })
        : new Promise((resolve, reject) => requests.push({ url, method, body, resolve, reject })),
  };
  const api = { getClient: () => client, uuid: (v) => v };
  const h = loadPage({
    root,
    route: 'pages/' + name + '/index',
    wx: createWx(),
    modules: { './api': api, '../../utils/api': api, ...extraModules },
  });
  h.page.onLoad({});
  h.page._visible = true;
  h.page._hidden = false;
  h.page._actor = current;
  return {
    ...h,
    requests,
    setViewer: (id) => {
      current = id;
    },
  };
}
const cohortResult = (id) => ({
  id,
  title: '合成班期 ' + id,
  totalFen: 0,
  state: 'ENROLLING',
  sessions: [],
});
const rosterResult = (id) => ({
  session: { id, state: 'SCHEDULED', starts_at: '2028-01-01T01:00:00Z' },
  learners: [],
  consumptions: [],
});
const enrollmentResult = (id) => ({
  id,
  totalFen: 0,
  state: 'CONFIRMED',
  capabilities: {},
  termsSnapshot: {},
  entitlements: [],
  consumptions: [],
  refunds: [],
});
test('training back/list navigation cancels late cohort reads and A/B responses cannot reopen A', async () => {
  const h = deferredPage('training');
  const old = h.page.showDetail(raceId(1));
  h.page.showCatalog();
  h.requests[0].resolve({ data: cohortResult(raceId(1)) });
  await old;
  assert.equal(h.page.data.detail, null);
  assert.equal(h.page.data.loading, false);
  const a = h.page.showDetail(raceId(2));
  const b = h.page.showDetail(raceId(3));
  h.requests[2].resolve({ data: cohortResult(raceId(3)) });
  await b;
  h.requests[1].resolve({ data: cohortResult(raceId(2)) });
  await a;
  assert.equal(h.page.data.detail.id, raceId(3));
  const lateError = h.page.showDetail(raceId(4));
  h.page.backToList();
  h.requests[3].reject(Error('private old failure'));
  await lateError;
  assert.equal(h.page.data.detail, null);
  assert.doesNotMatch(h.page.data.error, /private old failure/);
});
test('training leaving my list cancels late reads without leaving its loading spinner stuck', async () => {
  const h = deferredPage('training');
  const old = h.page.loadMine();
  await new Promise((r) => setImmediate(r));
  h.page.showCatalog();
  h.requests[0].resolve({ data: { items: [enrollmentResult(raceId(1))] } });
  await old;
  assert.equal(h.page.data.viewTab, 'catalog');
  assert.equal(h.page.data.mineLoading, false);
  assert.equal(h.page.data.mine.length, 0);
});
test('training management navigation cancels roster/enrollment reads and newest detail wins across domains', async () => {
  const h = deferredPage('training-manage');
  const old = h.page.showRoster(raceId(1));
  h.page.manageTab(tap('setup'));
  h.requests[0].resolve({ data: rosterResult(raceId(1)) });
  await old;
  assert.equal(h.page.data.manageTab, 'setup');
  assert.equal(h.page.data.roster, null);
  const a = h.page.showRoster(raceId(2));
  const b = h.page.showEnrollment(raceId(3));
  h.requests[2].resolve({ data: enrollmentResult(raceId(3)) });
  await b;
  h.requests[1].resolve({ data: rosterResult(raceId(2)) });
  await a;
  assert.equal(h.page.data.enrollment.id, raceId(3));
  assert.equal(h.page.data.roster, null);
  assert.equal(h.page.data.manageTab, 'reviews');
  const gone = h.page.showEnrollment(raceId(4));
  h.page.closeDetail();
  h.requests[3].resolve({ data: enrollmentResult(raceId(4)) });
  await gone;
  assert.equal(h.page.data.enrollment, null);
});
test('matching new form navigation cancels its outstanding selected-need response', async () => {
  let resolve;
  const model = require('../utils/matching');
  const h = deferredPage('matching', {
    '../../utils/matching': {
      ...model,
      repository: () => ({
        detail: () =>
          new Promise((r) => {
            resolve = r;
          }),
      }),
    },
  });
  const old = h.page.select({ currentTarget: { dataset: { id: raceId(1) } } });
  h.page.toggleCreate();
  resolve({ id: raceId(1), canManage: true });
  await old;
  assert.equal(h.page.data.creating, true);
  assert.equal(h.page.data.selected, null);
  assert.equal(h.page.data.loading, false);
});
test('dispatch preference navigation cancels its outstanding request detail response', async () => {
  let resolve;
  const model = require('../utils/dispatch');
  const h = deferredPage('dispatch', {
    '../../utils/dispatch': {
      ...model,
      repository: () => ({
        detail: () =>
          new Promise((r) => {
            resolve = r;
          }),
      }),
    },
  });
  const old = h.page.selectRequest({ currentTarget: { dataset: { id: raceId(1) } } });
  h.page.workspace(tap('preference'));
  resolve({ request: { id: raceId(1) }, offers: [] });
  await old;
  assert.equal(h.page.data.dispatchView, 'preference');
  assert.equal(h.page.data.detail, null);
});
test('closing an advertising order cancels its late GET without losing the original pending command', async () => {
  const h = deferredPage('sponsor-commerce');
  h.page._org = raceId(1);
  const old = h.page.selectOrder({ currentTarget: { dataset: { id: raceId(2) } } });
  h.page.setData({ pending: { body: { commandId: 'original-ad-order' } } });
  h.page.closeOrder();
  h.requests[0].resolve({
    data: {
      order: { id: raceId(2), total_fen: 0, status: 'ACCEPTED' },
      deliveries: [],
      batches: [],
      items: [],
      refunds: [],
      refundRetries: [],
      returns: [],
      recovery: [],
    },
  });
  await old;
  assert.equal(h.page.data.detail, null);
  assert.equal(h.page.data.pending.body.commandId, 'original-ad-order');
  assert.equal(h.page.data.loading, false);
});

test('local booking views separate role filters and fulfillment, and returning clears a displayed checkin secret', () => {
  const h = page('local-bookings');
  h.page.setData({
    items: [
      {
        id: raceId(1),
        title: '合成球场订单',
        status: 'CONFIRMED',
        canActAs: 'PROVIDER',
        actions: [{ type: 'REDEEM_CHECKIN', label: '核销球场到场' }],
      },
      { id: raceId(2), title: '合成我的预约', canActAs: 'BUYER' },
    ],
  });
  h.page.filterOrders(tap('PROVIDER'));
  const html = markup('local-bookings', h.page.data);
  assert.match(html, /合成球场订单/);
  assert.doesNotMatch(html, /合成我的预约/);
  h.page.select({ currentTarget: { dataset: { id: raceId(1) } } });
  assert.doesNotMatch(markup('local-bookings', h.page.data), /data-mini-bindtap="command"/);
  h.page.serviceTab(tap('actions'));
  assert.match(markup('local-bookings', h.page.data), /核销球场到场/);
  h.page.setData({
    checkinDisplay: { code: 'private-checkin-code' },
    checkinInput: 'private-checkin-code',
    pending: { body: { commandId: 'original-local-order' } },
  });
  h.page.closeBooking();
  assert.equal(h.page.data.checkinDisplay, null);
  assert.equal(h.page.data.checkinInput, '');
  assert.equal(h.page.data.pending.body.commandId, 'original-local-order');
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
});
test('local fulfillment fixture asserts visible redemption rules and separately retains the checkin input placeholder', () => {
  const fixture = require('../../../tests/mini-program/fixtures/ui002-services-local-fulfillment.json');
  const html = markup('local-bookings', fixture.data);
  const visibleText = html.replace(/<[^>]*>/g, ' ');
  for (const text of fixture.expectText) assert.ok(visibleText.includes(text), text);
  assert.match(html, /<input[^>]*placeholder="请粘贴需求方现场出示的本次核销码"/);
  assert.match(html, /<button[^>]*data-type="REDEEM_CHECKIN"/);
});
test('supply draft navigation cancels old private detail and an unprivileged account cannot start an application', async () => {
  let resolve;
  const model = require('../utils/local-services');
  const h = deferredPage('local-manage', {
    '../../utils/local-services': {
      ...model,
      repository: () => ({
        privateDetail: () =>
          new Promise((r) => {
            resolve = r;
          }),
      }),
    },
  });
  h.page.openSupply();
  assert.equal(h.page.data.creating, false);
  h.page.setData({ canCreate: true });
  const old = h.page.selectId(raceId(1));
  h.page.openSupply();
  resolve({ listing: { title: 'private old listing' }, capabilities: {} });
  await old;
  assert.equal(h.page.data.creating, true);
  assert.equal(h.page.data.selected, null);
  assert.match(markup('local-manage', h.page.data), /新增供给申请/);
  h.page.setData({ address: 'private draft address', places: [{ title: 'private place' }] });
  h.page.closeSupply();
  assert.equal(h.page.data.address, '');
  assert.equal(h.page.data.places.length, 0);
});
test('team matchup draft and list navigation keeps the original pending identity without creating an invitation', () => {
  const h = page('local-matchups');
  h.page.matchupView(tap('create'));
  assert.equal(h.page.data.matchupView, 'list');
  h.page.setData({
    teams: [{ name: '合成有权球队' }],
    pending: { body: { commandId: 'original-matchup' } },
  });
  h.page.matchupView(tap('create'));
  assert.match(markup('local-matchups', h.page.data), /双方独立确认/);
  h.page.matchupView(tap('list'));
  assert.equal(h.page.data.pending.body.commandId, 'original-matchup');
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
});
test('player funds shortcuts only navigate an appearance currently visible to this account and never collect funds', () => {
  for (const name of ['bookings', 'booking-detail']) {
    const h = deferredPage(name);
    const ui = h.requireLocal('utils/ui.js');
    const appearance = { id: raceId(1) };
    h.page.setData(
      name === 'bookings'
        ? { rows: [{ appearances: [appearance] }] }
        : { order: { appearances: [appearance] } },
    );
    h.page.loadedToken = ui.begin(h.page);
    h.page.trade({ currentTarget: { dataset: { id: raceId(2) } } });
    assert.equal(h.wx.calls.filter((x) => x.type === 'navigateTo').length, 0, name);
    h.page.trade({ currentTarget: { dataset: { id: raceId(1) } } });
    const nav = h.wx.calls.find((x) => x.type === 'navigateTo');
    assert.ok(nav, name);
    assert.match(nav.url, /kind=PLAYER_APPEARANCE/);
    assert.ok(nav.url.includes(raceId(1)));
    assert.equal(h.requests.length, 0, name);
  }
});

test('returning from a supply application during refresh ends loading and discards the canceled result without clearing pending', async () => {
  const actor = '10000000-0000-4000-8000-000000000001';
  const org = raceId(70);
  const calls = [];
  const client = {
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    viewerId: () => actor,
    async request(url, method = 'GET') {
      calls.push({ url, method });
      assert.equal(url, '/v1/auth/session');
      return {
        data: {
          user: { id: actor },
          organizations: [{ id: org, name: '合成机构', role: 'ORG_ADMIN' }],
          teamContexts: [],
        },
      };
    },
  };
  const api = { getClient: () => client, uuid: (v) => v };
  const h = deferredPage('local-manage', { './api': api, '../../utils/api': api });
  let complete;
  const model = h.requireLocal('utils/local-services.js');
  model.repository = () => ({
    workspace: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    options: async () => ({ providers: [], courts: [] }),
  });
  h.page.setData({ orgId: org, creating: true, canCreate: true });
  const refresh = h.page.load();
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof complete, 'function');
  assert.equal(h.page.data.loading, true);
  assert.equal(h.page.data.creating, true);
  h.page.setData({ pending: { body: { commandId: 'original-supply-command' } } });
  h.page.closeSupply();
  assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.creating, false);
  assert.equal(h.page.data.pending.body.commandId, 'original-supply-command');
  complete([{ id: raceId(71), title: 'private canceled refresh result' }]);
  await refresh;
  assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.listings.length, 0);
  assert.equal(h.page.data.selected, null);
  assert.equal(h.page.data.pending.body.commandId, 'original-supply-command');
  const html = markup('local-manage', h.page.data);
  assert.doesNotMatch(html, /private canceled refresh result|读取中…/);
  const button = html.match(/<button[^>]*data-mini-bindtap="load"[^>]*>/);
  assert.ok(button);
  assert.doesNotMatch(button[0], /\bdisabled\b/);
  assert.equal(
    calls.some((x) => x.method !== 'GET'),
    false,
  );
});

test('returning to the training enrollment list rereads it and an old hidden response cannot leave or clear its new spinner', async () => {
  const h = deferredPage('training');
  const model = h.requireLocal('utils/training.js');
  const actor = '10000000-0000-4000-8000-000000000001';
  const uncertain = model.write(actor, '/v1/training/enrollments/' + raceId(1) + '/commands', {
    action: 'REFRESH',
    expectedVersion: 1,
  });
  await new Promise((r) => setImmediate(r));
  h.requests[0].reject(Error('synthetic connection lost'));
  await assert.rejects(uncertain, /connection lost/);
  const original = model.pending(actor).body.commandId;
  const oldMine = h.page.loadMine();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.requests[1].url, '/v1/training/mine');
  assert.equal(h.page.data.mineLoading, true);
  h.page.onHide();
  assert.equal(h.page.data.mineLoading, false);
  assert.equal(h.page.data.pending.body.commandId, original);
  h.page.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.requests[2].url, '/v1/training/catalog');
  assert.equal(h.requests[3].url, '/v1/training/mine');
  assert.equal(h.page.data.mineLoading, true);
  h.requests[1].resolve({ data: { items: [enrollmentResult(raceId(2))] } });
  await oldMine;
  assert.equal(h.page.data.mineLoading, true);
  assert.equal(h.page.data.mine.length, 0);
  h.requests[2].resolve({ data: { items: [], capabilities: { enabled: false } } });
  h.requests[3].resolve({ data: { items: [enrollmentResult(raceId(3))] } });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.page.data.viewTab, 'mine');
  assert.equal(h.page.data.mineLoading, false);
  assert.equal(h.page.data.mine[0].id, raceId(3));
  assert.equal(h.page.data.pending.body.commandId, original);
  assert.equal(h.requests.filter((x) => x.method === 'POST').length, 1);
  const button = markup('training', h.page.data).match(
    /<button[^>]*data-mini-bindtap="loadMine"[^>]*>/,
  );
  assert.ok(button);
  assert.doesNotMatch(button[0], /\bdisabled\b/);
});
test('training workspace refresh resets its ordinary loading flag on return and hiding does not release an active write hold', async () => {
  const h = deferredPage('training-manage');
  h.page.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.page.data.loading, true);
  h.page.onHide();
  h.page.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve({ data: { teaching: [], coachProfiles: [] } });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.page.data.loading, true);
  h.requests[1].resolve({ data: { teaching: [], coachProfiles: [] } });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.page.data.loading, false);
  const learner = deferredPage('training');
  const token = learner.requireLocal('utils/ui.js').hold(learner.page);
  learner.page._writeToken = token;
  learner.page.setData({ busy: true, mineLoading: true });
  learner.page.onHide();
  assert.equal(learner.page.data.busy, true);
  assert.equal(learner.page._writeToken, token);
  assert.equal(learner.page.data.mineLoading, false);
});

test('returning to my training list under a new account discards the old list without keeping either spinner stuck', async () => {
  const h = deferredPage('training');
  const oldMine = h.page.loadMine();
  await new Promise((r) => setImmediate(r));
  h.page.onHide();
  h.setViewer('10000000-0000-4000-8000-000000000002');
  h.page.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve({ data: { items: [enrollmentResult(raceId(55))] } });
  h.requests[1].resolve({ data: { items: [], capabilities: { enabled: false } } });
  await oldMine;
  await new Promise((r) => setImmediate(r));
  assert.equal(h.page.data.viewTab, 'catalog');
  assert.equal(h.page.data.mine.length, 0);
  assert.equal(h.page.data.mineLoading, false);
  assert.equal(h.page.data.loading, false);
  assert.equal(
    h.requests.some((r) => r.method !== 'GET'),
    false,
  );
});

test('explicitly opening my training list retires cohort and enrollment deep links before returning', async () => {
  for (const target of ['cohort', 'enrollment']) {
    const h = deferredPage('training');
    const id = raceId(target === 'cohort' ? 61 : 62);
    h.page.onLoad({ [target]: id });
    h.page.onShow();
    h.requests[0].resolve({ data: { items: [], capabilities: { enabled: false } } });
    await new Promise((r) => setImmediate(r));
    const path = target === 'cohort' ? '/v1/training/cohorts/' : '/v1/training/enrollments/';
    assert.equal(h.requests[1].url, path + id);
    h.requests[1].resolve({ data: target === 'cohort' ? cohortResult(id) : enrollmentResult(id) });
    await new Promise((r) => setImmediate(r));
    assert.equal((target === 'cohort' ? h.page.data.detail : h.page.data.enrollment).id, id);
    const oldMine = h.page.loadMine();
    await new Promise((r) => setImmediate(r));
    assert.equal(h.requests[2].url, '/v1/training/mine');
    h.page.onHide();
    h.page.onShow();
    await new Promise((r) => setImmediate(r));
    assert.equal(h.requests[3].url, '/v1/training/catalog');
    assert.equal(h.requests[4].url, '/v1/training/mine');
    h.requests[3].resolve({ data: { items: [], capabilities: { enabled: false } } });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.requests.length, 5);
    h.requests[2].resolve({ data: { items: [enrollmentResult(raceId(63))] } });
    await oldMine;
    assert.equal(h.page.data.mineLoading, true);
    h.requests[4].resolve({ data: { items: [enrollmentResult(raceId(64))] } });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.page.data.mineLoading, false);
    assert.equal(h.page.data.viewTab, 'mine');
    assert.equal(h.page.data.mine[0].id, raceId(64));
    assert.equal(h.page.data.detail, null);
    assert.equal(h.page.data.enrollment, null);
    assert.equal(h.requests.filter((r) => r.url === path + id).length, 1);
  }
});

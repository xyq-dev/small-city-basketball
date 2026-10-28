const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const api = require('../utils/api');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222',
  p = '33333333-3333-4333-8333-333333333333';
const envelope = (data) => ({ data, meta: { requestId: 'native-account-explicit-test' } });
const session = (id) => ({
  user: { id, email: 'synthetic@example.test', displayName: '合成账号' },
  organizations: [],
  teamContexts: [],
});
function setup(route, options = {}) {
  let revision = 1,
    viewer = a;
  const calls = [],
    listeners = new Set();
  const client = {
    hasSession: () => true,
    sessionRevision: () => revision,
    viewerId: () => viewer,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clearSession() {
      revision++;
      viewer = null;
      for (const fn of listeners) fn();
    },
    async request(url, method = 'GET', data) {
      calls.push({ url, method, data });
      if (options.request) return options.request(url, method, data);
      if (url === '/v1/auth/session') return envelope(session(viewer));
      if (url === '/v1/auth/wechat/capabilities') return envelope({ enabled: true });
      if (url === '/v1/auth/capabilities') return envelope({ canRegisterParticipant: false });
      if (url === '/v1/auth/wechat/binding') return envelope({ connected: false, version: 0 });
      if (url === '/v1/auth/wechat/challenges')
        return envelope({ challengeId: 'synthetic', state: 'synthetic' });
      return envelope(null);
    },
  };
  const wx = createWx({ modalAnswers: options.modalAnswers || [] });
  const modules = { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } };
  if (options.sdk) modules[path.join(root, 'utils/booking.js')] = options.sdk;
  const h = loadPage({ root, route: 'pages/' + route + '/index', wx, modules });
  return {
    ...h,
    client,
    calls,
    switchActor() {
      viewer = b;
      revision++;
      for (const fn of listeners) fn();
    },
  };
}
test('C19 account entries expose participant flows and organization-scoped manager destinations', async () => {
  const h = setup('account', {
    request: async (url) => {
      if (url === '/v1/auth/session')
        return envelope({
          ...session(a),
          organizations: [
            { id: b, name: '合成主办方', role: 'ORG_OWNER' },
            { id: p, name: '合成工作人员机构', role: 'EVENT_MANAGER' },
          ],
        });
      return envelope({ enabled: false, canRegisterParticipant: false, connected: false });
    },
  });
  h.page.onLoad({});
  h.page.onShow();
  await h.flush();
  assert.deepEqual(
    h.page.data.managedOrgs.map((org) => org.id),
    [b],
  );
  const html = buildPreview({ root, route: 'pages/account/index', data: h.page.data }).phone;
  for (const label of [
    '我的关注',
    '我的成员关系',
    '申请建队',
    '加入球队与成员认领',
    '私有赛季授权与本人数据',
    '建队申请审批',
    '私有赛季管理',
  ])
    assert.ok(html.includes(label), label);
  for (const page of ['follows', 'memberships', 'team-request', 'team-join', 'season-grants']) {
    h.page.go({ currentTarget: { dataset: { page } } });
    assert.equal(h.wx.calls.at(-1).url, '/pages/' + page + '/index');
  }
  for (const page of ['seasons', 'team-requests']) {
    h.page.go({ currentTarget: { dataset: { page, org: b } } });
    assert.equal(h.wx.calls.at(-1).url, '/pages/' + page + '/index?orgId=' + b);
  }
  h.switchActor();
  assert.deepEqual(h.page.data.managedOrgs, []);
  assert.deepEqual(h.page.data.roles, []);
  assert.equal(h.page.data.user, null);
  h.page.onUnload();
});

test('C19 login return targets recognize both season pages and grant pagination stays bounded', () => {
  for (const page of ['seasons', 'season-grants']) {
    const h = setup('account');
    const returnTo = '/pages/' + page + '/index?orgId=' + b;
    h.page.onLoad({ returnTo });
    assert.equal(h.page.returnTo, returnTo);
  }
  assert.equal(api.pathAllowed('/v1/me/season-data-grants?limit=50&cursor=YWJj', 'GET'), true);
  for (const query of ['limit=51', 'limit=0', 'cursor=bad%2Fcursor', 'actorId=' + b])
    assert.equal(api.pathAllowed('/v1/me/season-data-grants?' + query, 'GET'), false);
});
test('late native wx.login code cannot overwrite a newer application identity', async () => {
  const h = setup('account');
  let finishCode;
  h.wx.login = (input) => {
    finishCode = input.success;
  };
  h.page.setData({ enabled: true, consent: true });
  h.page.wechatLogin();
  await h.flush();
  assert.equal(typeof finishCode, 'function');
  h.switchActor();
  finishCode({ code: 'synthetic-not-a-real-wechat-code' });
  await h.flush();
  assert.equal(
    h.calls.some((c) => c.url === '/v1/auth/wechat/login'),
    false,
  );
  assert.equal(h.client.viewerId(), b);
});
test('account return target rejects external routes and hiding clears credentials and agreement', () => {
  const h = setup('account');
  h.page.onLoad({ returnTo: 'https://untrusted.example/collect' });
  assert.equal(h.page.returnTo, '');
  h.page.setData({ password: 'synthetic-test-value', consent: true });
  h.page.onHide();
  assert.equal(h.page.data.password, '');
  assert.equal(h.page.data.consent, false);
  assert.equal(
    h.wx.calls.some((c) => c.type === 'setStorageSync'),
    false,
  );
});
test('registration and unselected WeChat actions do not issue hidden writes', async () => {
  const h = setup('account');
  h.page.setData({ canRegister: false, enabled: true, consent: false, user: session(a).user });
  h.page.register();
  h.page.wechatLogin();
  h.page.bind();
  await h.page.unbind();
  await h.flush();
  assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0);
});
test('unbind modal does not consume consent after an account switch', async () => {
  const h = setup('account', { modalAnswers: [true] });
  h.page.setData({
    user: session(a).user,
    binding: { connected: true, version: 2 },
    connected: true,
    consent: true,
    password: 'synthetic-test-value',
  });
  const action = h.page.unbind();
  h.switchActor();
  await action;
  await h.flush();
  assert.equal(
    h.calls.some((c) => c.url === '/v1/auth/wechat/unbind'),
    false,
  );
  assert.equal(h.page.data.password, '');
});
function work(version = 1, operator = true) {
  return {
    viewerUserId: a,
    isPlatformOperator: operator,
    reviewQueue: [
      {
        id: p,
        displayName: '合成球员',
        version,
        status: 'PENDING',
        position: 'PG',
        heightCm: 182,
        city: '合成地区',
        bio: '合成说明',
        priceFen: 30000,
        travelFen: 0,
        accommodationFen: 0,
        availability: [],
      },
    ],
    orders: [],
    settings: { feeBps: 1000, version: 1 },
    paymentNotice: '支付未开放',
  };
}
test('profile review refuses a new unseen version and requires a fresh explicit agreement', async () => {
  let current = work(),
    writes = 0;
  const h = setup('platform', {
    sdk: {
      workspace: async () => structuredClone(current),
      reviewProfile: async () => {
        writes++;
      },
    },
  });
  await h.page.load();
  h.page.review({ currentTarget: { dataset: { id: p } } });
  assert.equal(h.page.data.reviewVersion, 1);
  assert.equal(h.page.data.consent, false);
  h.page.reason({ detail: { value: '已核对本版资料' } });
  h.page.agree({ detail: { value: ['yes'] } });
  current = work(2);
  await h.page.submitReview();
  assert.equal(writes, 0);
  assert.equal(h.page.data.consent, false);
  assert.match(h.page.data.error, /资料已更新/);
});
test('platform cannot reconstruct an old private review from cached raw data after actor change', async () => {
  const h = setup('platform', { sdk: { workspace: async () => work() } });
  await h.page.load();
  assert.equal(h.page.data.allowed, true);
  h.switchActor();
  h.page.review({ currentTarget: { dataset: { id: p } } });
  assert.equal(h.page.data.reviewOpen, false);
  assert.equal(h.page.data.reviewSnapshot, null);
  assert.equal(h.page.data.allowed, false);
});
test('missing independent platform grant does not expose the review queue', async () => {
  const h = setup('platform', { sdk: { workspace: async () => work(1, false) } });
  await h.page.load();
  assert.equal(h.page.data.allowed, false);
  assert.equal(h.page.data.reviewQueue.length, 0);
  assert.match(h.page.data.error, /没有平台运营权限/);
});
test('review submission is blocked before the default-unchecked statement is selected', async () => {
  let writes = 0;
  const h = setup('platform', {
    sdk: {
      workspace: async () => work(),
      reviewProfile: async () => {
        writes++;
      },
    },
  });
  await h.page.load();
  h.page.review({ currentTarget: { dataset: { id: p } } });
  h.page.reason({ detail: { value: '已核对说明' } });
  await h.page.submitReview();
  assert.equal(writes, 0);
  assert.equal(
    h.wx.calls.some((c) => c.type === 'showModal'),
    false,
  );
});

test('WeChat login locks the exact account draft and agreement during native code preflight', async () => {
  const h = setup('account');
  let finishCode;
  h.wx.login = (input) => {
    finishCode = input.success;
  };
  h.page.setData({ enabled: true, consent: true, email: 'original@example.test' });
  h.page.wechatLogin();
  await h.flush();
  assert.equal(h.page.data.busy, true);
  h.page.input({
    currentTarget: { dataset: { field: 'email' } },
    detail: { value: 'later@example.test' },
  });
  h.page.consent({ detail: { value: [] } });
  assert.equal(h.page.data.email, 'original@example.test');
  assert.equal(h.page.data.consent, true);
  finishCode({ code: 'synthetic-code' });
  await h.flush();
  assert.equal(h.calls.filter((c) => c.url === '/v1/auth/wechat/login').length, 1);
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.consent, false);
});

test('binding preflight locks password and agreement until the original command completes', async () => {
  const h = setup('account');
  let finishCode;
  h.wx.login = (input) => {
    finishCode = input.success;
  };
  h.page.setData({
    enabled: true,
    user: session(a).user,
    consent: true,
    password: 'synthetic-original',
  });
  h.page.bind();
  await h.flush();
  h.page.input({
    currentTarget: { dataset: { field: 'password' } },
    detail: { value: 'synthetic-later' },
  });
  h.page.consent({ detail: { value: [] } });
  assert.equal(h.page.data.busy, true);
  assert.equal(h.page.data.password, '');
  assert.equal(h.page.data.consent, true);
  finishCode({ code: 'synthetic-code' });
  await h.flush();
  assert.equal(h.calls.filter((c) => c.url === '/v1/auth/wechat/bind').length, 1);
  assert.equal(h.page.data.busy, false);
});

test('unbind locks editing before its modal and cancellation releases the lock without a write', async () => {
  const h = setup('account');
  let finishModal;
  h.wx.showModal = (input) => {
    finishModal = input.success;
  };
  h.page.setData({
    connected: true,
    binding: { version: 2 },
    consent: true,
    password: 'synthetic-original',
  });
  const action = h.page.unbind();
  assert.equal(h.page.data.busy, true);
  h.page.consent({ detail: { value: [] } });
  assert.equal(h.page.data.consent, true);
  finishModal({ confirm: false });
  await action;
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.consent, false);
  assert.equal(
    h.calls.some((c) => c.url === '/v1/auth/wechat/unbind'),
    false,
  );
});

test('platform review cannot change decision, reason or agreement during the fresh read', async () => {
  let count = 0,
    release;
  const writes = [];
  const h = setup('platform', {
    sdk: {
      workspace: () =>
        ++count === 2
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(work()),
      reviewProfile: async (...args) => {
        writes.push(args);
      },
    },
  });
  await h.page.load();
  h.page.review({ currentTarget: { dataset: { id: p } } });
  h.page.reason({ detail: { value: '已核对原版资料' } });
  h.page.agree({ detail: { value: ['yes'] } });
  const action = h.page.submitReview();
  assert.equal(h.page.data.busy, true);
  h.page.reason({ detail: { value: '尚未确认的新理由' } });
  h.page.status({ detail: { value: 2 } });
  h.page.agree({ detail: { value: [] } });
  assert.equal(h.page.data.reviewReason, '已核对原版资料');
  assert.equal(h.page.data.statusIndex, 0);
  assert.equal(h.page.data.consent, true);
  release(work());
  await action;
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2], 'APPROVED');
  assert.equal(writes[0][3], '已核对原版资料');
  assert.equal(h.page.data.busy, false);
});

test('fee confirmation preserves its draft and ignores edits until cancellation finishes', async () => {
  let finishModal,
    writes = 0;
  const h = setup('platform', {
    sdk: {
      workspace: async () => work(),
      updateFee: async () => {
        writes++;
      },
    },
  });
  h.wx.showModal = (input) => {
    finishModal = input.success;
  };
  await h.page.load();
  h.page.feeInput({ detail: { value: '12.00' } });
  const action = h.page.saveFee();
  assert.equal(h.page.data.busy, true);
  h.page.feeInput({ detail: { value: '30.00' } });
  assert.equal(h.page.data.feePercent, '12.00');
  finishModal({ confirm: false });
  await action;
  assert.equal(writes, 0);
  assert.equal(h.page.data.feeDirty, true);
  assert.equal(h.page.data.busy, false);
});

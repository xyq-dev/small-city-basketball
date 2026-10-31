const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const api = require('../utils/api');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(1),
  teamId = id(2),
  eventId = id(3),
  entryId = id(4),
  viewer = id(5);
const rules = {
  id: id(6),
  eventId,
  createdAt: '2026-10-31T00:00:00Z',
  version: 1,
  minPlayers: 1,
  maxPlayers: 12,
  zeroAndDoubleZeroDistinct: false,
  requireIdentity: false,
  requireInsurance: false,
};
const entry = () => ({
  id: entryId,
  orgId: org,
  teamId,
  teamName: '合成队',
  eventId,
  status: 'DRAFT',
  version: 1,
  rules,
  players: [],
  history: [],
  capabilities: {
    canEditRoster: true,
    canSubmit: false,
    canWithdraw: true,
    canReview: false,
    canApprove: false,
    canRequestChanges: false,
    canReject: false,
  },
});
const event = () => ({
  event: {
    id: eventId,
    name: '合成赛事',
    startDate: '2026-10-31',
    endDate: '2026-11-02',
    version: 1,
    status: 'REGISTRATION_OPEN',
  },
  rules,
  entry: null,
  capabilities: { canCreateEntry: true },
});
function fixture(route = 'registration-events', options = {}) {
  let actor = viewer,
    revision = 0;
  const listeners = new Set(),
    calls = [],
    nav = [];
  const client = {
    hasSession: () => true,
    viewerId: () => actor,
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: structuredClone(body) });
      const overridden = options.request ? await options.request(url, method, body) : undefined;
      if (overridden !== undefined) return overridden;
      let data;
      if (url === '/v1/auth/session')
        data = {
          user: { id: actor, email: 'test@example.test', displayName: '合成本人' },
          organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
          teamContexts: [],
        };
      else if (url.includes('/registration-events?'))
        return { data: [event()], meta: { requestId: 'test', nextCursor: null } };
      else if (url.endsWith('/teams/' + teamId))
        data = {
          id: teamId,
          orgId: org,
          name: '合成队',
          version: 1,
          members: [],
          grants: [],
          capabilities: { canManage: true, canInvite: false },
        };
      else if (url === '/v1/trades/preview')
        data = options.free
          ? { enabled: false }
          : {
              enabled: true,
              termsId: body.kind === 'ENTRY_FEE' ? id(7) : id(8),
              totalFen: body.kind === 'ENTRY_FEE' ? 12000 : 5000,
              currency: 'CNY',
              merchantName: '服务端收款主体',
              title: '服务端条款标题',
              terms: '服务端完整条款\n退款规则由本次约定确认',
            };
      else if (url.endsWith('/events/' + eventId + '/entries')) data = entry();
      else data = { enabled: false, canRegisterParticipant: false, connected: false };
      return { data, meta: { requestId: 'test' } };
    },
  };
  const wx = createWx({ modalAnswers: [true] });
  const h = loadPage({
    root,
    route: 'pages/' + route + '/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } },
  });
  const ui = h.requireLocal('utils/ui.js');
  ui.open = (key, query) => nav.push({ key, query: structuredClone(query) });
  return {
    ...h,
    calls,
    nav,
    client,
    change() {
      actor = id(9);
      revision++;
      for (const fn of [...listeners]) fn();
    },
  };
}
async function loaded(h) {
  h.page.onLoad({ orgId: org, teamId });
  await h.page.load();
}
const tap = { currentTarget: { dataset: { id: eventId } } };
const creations = (h) =>
  h.calls.filter((x) => x.url.endsWith('/events/' + eventId + '/entries') && x.method === 'POST');

test('both server charge previews are shown with unchecked independent agreement before entry creation', async () => {
  const h = fixture();
  await loaded(h);
  await h.page.enter(tap);
  assert.equal(creations(h).length, 0);
  assert.equal(h.page.data.chargeAccepted, false);
  assert.equal(h.page.data.chargeDraft.items.length, 2);
  assert.deepEqual(
    h.calls.filter((x) => x.url === '/v1/trades/preview').map((x) => x.body),
    [
      { kind: 'ENTRY_FEE', sourceId: eventId },
      { kind: 'ENTRY_DEPOSIT', sourceId: eventId },
    ],
  );
  const html = buildPreview({
    root,
    route: 'pages/registration-events/index',
    data: h.page.data,
  }).phone;
  for (const text of ['服务端收款主体', '¥120.00', '¥50.00', '服务端完整条款', '报名费', '保证金'])
    assert.ok(html.includes(text), text);
  await h.page.confirmCharge();
  assert.equal(creations(h).length, 0);
});

test('explicit charged creation sends the exact viewed terms IDs and consent without client amount or merchant overrides', async () => {
  const h = fixture();
  await loaded(h);
  await h.page.enter(tap);
  h.page.chargeAgree({ detail: { value: ['yes'] } });
  await h.page.confirmCharge();
  assert.equal(creations(h).length, 1);
  assert.deepEqual(creations(h)[0].body, {
    teamId,
    acceptedTermsIds: { ENTRY_FEE: id(7), ENTRY_DEPOSIT: id(8) },
    chargeConsent: true,
  });
  assert.equal(h.page.data.chargeAccepted, false);
  assert.equal(h.page.data.chargeDraft, null);
  assert.equal(h.nav.at(-1).key, 'entry');
});

test('both free previews preserve the original body and require the original draft confirmation', async () => {
  const h = fixture('registration-events', { free: true });
  await loaded(h);
  await h.page.enter(tap);
  assert.equal(creations(h).length, 1);
  assert.deepEqual(creations(h)[0].body, { teamId });
  assert.equal(h.wx.calls.filter((x) => x.type === 'showModal').length, 1);
});

test('failed or malformed fee preview cannot fall back to a free entry', async () => {
  for (const mode of ['failure', 'bad']) {
    const h = fixture('registration-events', {
      request(url, method, body) {
        if (url === '/v1/trades/preview' && body.kind === 'ENTRY_DEPOSIT') {
          if (mode === 'failure') throw Error('preview failed');
          return {
            data: {
              enabled: true,
              termsId: 'invalid',
              totalFen: 5000,
              currency: 'CNY',
              merchantName: 'a',
              title: 'a',
              terms: 'a',
            },
          };
        }
      },
    });
    await loaded(h);
    await h.page.enter(tap);
    assert.equal(creations(h).length, 0);
    assert.equal(h.page.data.chargeDraft, null);
    assert.ok(h.page.data.error);
  }
});

test('preview results arriving after hide or identity switch do not expose terms or create entries', async () => {
  for (const action of ['hide', 'switch']) {
    let release;
    const waiting = new Promise((done) => {
      release = done;
    });
    const h = fixture('registration-events', {
      request: async (url) => (url === '/v1/trades/preview' ? waiting : undefined),
    });
    await loaded(h);
    const job = h.page.enter(tap);
    await new Promise((done) => setImmediate(done));
    if (action === 'hide') h.page.onHide();
    else h.change();
    release({ data: { enabled: false } });
    await job;
    assert.equal(creations(h).length, 0);
    assert.equal(h.page.data.chargeDraft, null);
    assert.equal(h.page.data.chargeAccepted, false);
  }
});

test('an account change during final session preflight cannot consume the previously checked charge terms', async () => {
  let pause = false,
    release;
  const h = fixture('registration-events', {
    request(url) {
      if (pause && url === '/v1/auth/session')
        return new Promise((done) => {
          release = done;
        });
    },
  });
  await loaded(h);
  await h.page.enter(tap);
  h.page.chargeAgree({ detail: { value: ['yes'] } });
  pause = true;
  const job = h.page.confirmCharge();
  await new Promise((done) => setImmediate(done));
  h.change();
  release({ data: { user: { id: viewer }, organizations: [], teamContexts: [] } });
  await job;
  assert.equal(creations(h).length, 0);
  assert.equal(h.page.data.chargeDraft, null);
  assert.equal(h.page.data.chargeAccepted, false);
});

test('unknown charged create clears the old consent and directs the user to refresh the original entry', async () => {
  const h = fixture('registration-events', {
    request(url, method) {
      if (method === 'POST' && url.endsWith('/entries')) throw Error('response lost');
    },
  });
  await loaded(h);
  await h.page.enter(tap);
  h.page.chargeAgree({ detail: { value: ['yes'] } });
  await h.page.confirmCharge();
  assert.equal(creations(h).length, 1);
  assert.equal(h.page.data.chargeDraft, null);
  assert.equal(h.page.data.chargeAccepted, false);
  assert.match(h.page.data.message, /刷新本队报名列表核对原结果/);
  await h.page.confirmCharge();
  assert.equal(creations(h).length, 1);
});

test('account exposes real destinations and copies only the current visible account UUID', async () => {
  const h = fixture('account');
  h.page.onLoad({});
  h.page.onShow();
  await h.flush();
  const html = buildPreview({ root, route: 'pages/account/index', data: h.page.data }).phone;
  for (const text of [
    '我的消息',
    '微信订阅提醒',
    '本人保险订单',
    '青少年与监护确认',
    '账号自助注销',
    '收款条款与资金管理',
    viewer,
  ])
    assert.ok(html.includes(text), text);
  for (const key of [
    'messages',
    'notification-settings',
    'insurance',
    'guardian',
    'trade-order',
    'account-closure',
  ]) {
    h.page.go({ currentTarget: { dataset: { page: key } } });
    assert.equal(h.nav.at(-1).key, key);
  }
  h.page.go({ currentTarget: { dataset: { page: 'trade-manage', org } } });
  assert.deepEqual(h.nav.at(-1).query, { orgId: org });
  let copied;
  h.wx.setClipboardData = (o) => {
    copied = o.data;
  };
  h.page.copyMemberId();
  assert.equal(copied, viewer);
  copied = null;
  h.page.onHide();
  h.page.copyMemberId();
  assert.equal(copied, null);
});

test('event and match entries carry existing business IDs to actual guardian, trade and live pages', () => {
  const e = fixture('org-event');
  e.page.orgId = org;
  e.page.eventId = eventId;
  e.page.setData({ manage: {}, loading: false });
  for (const key of ['youth-review', 'trade-manage']) {
    e.page.openFeature({ currentTarget: { dataset: { page: key } } });
    assert.deepEqual(e.nav.at(-1), { key, query: { orgId: org, eventId } });
  }
  const m = fixture('org-match');
  m.page.orgId = org;
  m.page.matchId = id(10);
  m.page.setData({ match: { eventId } });
  m.page.openLive();
  assert.deepEqual(m.nav.at(-1), { key: 'live-studio', query: { orgId: org, matchId: id(10) } });
});

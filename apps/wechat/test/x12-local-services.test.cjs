const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, loadComponent, createWx } = require('./helpers/native-page.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const { renderWxml } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const equal = (a, b) =>
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const preview = (route, data) => ({
  phone: renderWxml(fs.readFileSync(path.join(root, route + '.wxml'), 'utf8'), data, {
    root,
    pageDirectory: path.dirname(path.join(root, route)),
    usingComponents: JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
      .usingComponents,
    globalComponents: JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
      .usingComponents,
  }),
});
const U = '10000000-0000-4000-8000-000000000001',
  V = '10000000-0000-4000-8000-000000000002',
  L = '20000000-0000-4000-8000-000000000001',
  B = '30000000-0000-4000-8000-000000000001',
  S = '40000000-0000-4000-8000-000000000001',
  R = '50000000-0000-4000-8000-000000000001',
  O = '60000000-0000-4000-8000-000000000001',
  T = '70000000-0000-4000-8000-000000000001',
  M = '80000000-0000-4000-8000-000000000001',
  C = '90000000-0000-4000-8000-000000000001';
const point = { latitude: 22.9, longitude: 111, coordinateSystem: 'GCJ02' };
const region = { catalogVersion: 'synthetic-catalog-v1', regionId: R };
const selection = { mode: 'REGION', ...region, label: '合成市', level: 'CITY' };
const envelope = (data) => ({ data, meta: { requestId: 'synthetic-x12' } });
const listing = (extra = {}) => ({
  id: L,
  kind: 'COURT',
  title: '合成球场',
  description: '合成经营方发布的真实档期测试资料',
  address: '合成市合成路1号',
  region,
  point,
  coverageRegionIds: [R],
  status: 'APPROVED',
  version: 2,
  providerConfirmed: true,
  qualifiedUntil: '2028-06-01T10:00:00Z',
  published: true,
  organizationName: '合成机构',
  distanceMeters: null,
  distanceLabel: null,
  ...extra,
});
const slot = (extra = {}) => ({
  id: S,
  listingId: L,
  startsAt: '2028-05-01T01:00:00Z',
  endsAt: '2028-05-01T03:00:00Z',
  status: 'OPEN',
  version: 1,
  available: true,
  ...extra,
});
const booking = (extra = {}) => ({
  id: B,
  listingId: L,
  slotId: S,
  status: 'HELD',
  version: 1,
  startsAt: slot().startsAt,
  endsAt: slot().endsAt,
  holdExpiresAt: '2028-04-01T00:10:00Z',
  title: '合成球场',
  kind: 'COURT',
  address: '合成市合成路1号',
  location: point,
  terms: '合成合作约定',
  reason: null,
  change: null,
  paymentStatus: 'NOT_ENABLED',
  canActAs: 'BUYER',
  ...extra,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tap = (dataset = {}, value = '') => ({ currentTarget: { dataset }, detail: { value } });
const ticks = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
function harness(
  name = 'local',
  {
    request,
    storage = new Map(),
    user = U,
    sessionExtra = {},
    modalAnswers = [true, true, true],
  } = {},
) {
  const calls = [],
    listeners = new Set();
  let rev = 0,
    viewer = user;
  const session = () => ({
    user: { id: viewer },
    organizations: [{ id: O, name: '合成机构', role: 'ORG_OWNER' }],
    teamContexts: [{ orgId: O, organizationName: '合成机构', teamId: T, teamName: '合成球队' }],
    ...sessionExtra,
  });
  const client = {
    sessionRevision: () => rev,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hasSession: () => true,
    async request(url, method = 'GET', body, anonymous = false) {
      calls.push({ url, method, body, anonymous });
      if (url === '/v1/auth/session') return envelope(session());
      return request
        ? await request({ url, method, body, anonymous })
        : envelope({
            items: [],
            nextCursor: null,
            locationCapability: { enabled: false, coordinateSystem: 'GCJ02' },
            queryOrigin: 'REGION',
            truncated: false,
          });
    },
    requestPublic(url) {
      return this.request(url, 'GET', undefined, true);
    },
  };
  const api = { getClient: () => client, uuid: (v) => v, publicId: (v) => v };
  const wx = createWx({ storage, modalAnswers });
  wx.getLocation = () => {
    throw new Error('Unexpected automatic location request');
  };
  wx.openLocation = (o) => calls.push({ navigation: o });
  wx.setClipboardData = (o) => wx.calls.push({ type: 'clipboard', data: o.data });
  const h = loadPage({
    root,
    route: 'pages/' + name + '/index',
    wx,
    modules: { './api': api, '../../utils/api': api },
    globals: { getApp: () => ({ globalData: {} }) },
  });
  h.page.onLoad?.({});
  return {
    ...h,
    calls,
    client,
    storage,
    switchUser(next) {
      viewer = next;
      rev++;
      for (const fn of [...listeners]) fn();
    },
  };
}
function searchData(items = []) {
  return {
    items,
    nextCursor: null,
    locationCapability: { enabled: false, coordinateSystem: 'GCJ02' },
    queryOrigin: 'REGION',
    truncated: false,
  };
}

test('nationwide navigation has five finite destinations and preserves video through events', () => {
  const h = loadComponent({
    root,
    route: 'components/navigation/index',
    properties: { active: 'Video' },
  });
  equal(
    h.instance.data.items.map((v) => v.label),
    ['首页', '赛事', '同城', '球队', '我的'],
  );
  h.instance.go(tap({ key: 'Events' }));
  assert.equal(h.wx.calls.length, 0);
  h.instance.go(tap({ key: 'Local' }));
  assert.equal(h.wx.calls.at(-1).url, '/pages/local/index');
  h.instance.go(tap({ key: 'Teams' }));
  assert.equal(h.wx.calls.at(-1).url, '/pages/teams/index');
  assert.match(fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8'), /比赛视频/);
});

test('all four actual templates compile in the native harness and event handlers exist', () => {
  for (const name of ['local', 'local-manage', 'local-bookings', 'local-matchups']) {
    const h = harness(name),
      source = fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
    for (const handler of eventHandlers(parseWxml(source)))
      assert.equal(typeof h.page[handler], 'function', name + ':' + handler);
    assert.doesNotThrow(() => preview(h.page.route, h.page.data));
  }
});

test('public first view never requests location and sends no precise coordinates in URL', async () => {
  const h = harness('local', { request: () => envelope(searchData([listing()])) });
  h.page.onShow();
  await h.flush();
  assert.equal(h.page.data.items.length, 1);
  assert.equal(h.calls[0].anonymous, true);
  assert.equal(h.calls[0].method, 'POST');
  assert.equal(h.calls[0].url, '/v1/public/local-search');
  assert.equal(h.storage.size, 0);
  h.page.setData({ selection });
  h.wx.getLocation = (o) => o.fail({ errMsg: 'permission denied' });
  await h.page.locate();
  assert.match(h.page.data.locationError, /手动选城/);
  assert.equal(h.page.data.hasOrigin, false);
  assert.equal(h.storage.size, 0);
});

test('explicit location uses only page memory and an out-of-date callback cannot revive it', async () => {
  const h = harness('local', { request: () => envelope(searchData()) });
  h.page.onShow();
  await h.flush();
  h.page.setData({ selection });
  let callback;
  h.wx.getLocation = (o) => {
    callback = o;
  };
  const task = h.page.locate();
  assert.equal(callback.type, 'gcj02');
  h.page.onHide();
  callback.success(point);
  await task;
  assert.equal(h.page.data.hasOrigin, false);
  assert.equal(h.storage.size, 0);
  assert.equal(h.calls.length, 1);
  h.page._hidden = false;
  h.wx.getLocation = (o) => o.success(point);
  await h.page.locate();
  assert.equal(h.page.data.hasOrigin, true);
  const call = h.calls.at(-1);
  equal(call.body.point, point);
  assert.equal(call.url.includes('latitude'), false);
  h.page.onHide();
  assert.equal(h.page.data.hasOrigin, false);
  assert.equal(h.storage.size, 0);
});

test('location timeout settles once and ignores late success', async () => {
  const h = harness(),
    ls = h.requireLocal('utils/local-services.js');
  let callback;
  const pending = ls.locateOnce(
    {
      getLocation(o) {
        callback = o;
      },
    },
    5,
  );
  await assert.rejects(pending, /定位超时/);
  callback.success(point);
  assert.equal(h.storage.size, 0);
});

test('POI candidates cannot be interpreted as stock or silently change the selected region', async () => {
  const h = harness('local', {
    request: ({ url }) =>
      url.endsWith('local-location')
        ? envelope({
            candidates: [
              {
                title: '合成地点',
                address: '合成地点地址',
                point,
                sourceCode: '123456',
                source: 'TENCENT',
                kind: 'PLACE',
              },
            ],
            inventoryVerified: false,
          })
        : envelope(searchData()),
  });
  h.page.onShow();
  await h.flush();
  h.page.setData({ selection, placeQuery: '合成' });
  await h.page.searchPlaces();
  assert.equal(h.page.data.places.length, 1);
  assert.equal(h.page.data.items.length, 0);
  await h.page.usePlace(tap({ index: 0, purpose: 'origin' }));
  equal(h.page.data.selection, selection);
  assert.equal(h.page.data.hasOrigin, true);
  assert.equal(h.storage.size, 0);
  const ls = h.requireLocal('utils/local-services.js');
  assert.throws(() => ls.listing(listing({ providerUserId: U })), /格式无效/);
  assert.throws(
    () =>
      ls.candidate({
        title: 'x',
        address: 'x',
        point,
        source: 'TENCENT',
        kind: 'PLACE',
        sourceCode: null,
        available: true,
      }),
    /格式无效/,
  );
});

test('disabled reverse lookup keeps nationwide without requesting device permission', async () => {
  const h = harness('local', { request: () => envelope(searchData()) });
  h.page.onShow();
  await h.flush();
  await h.page.locate();
  assert.match(h.page.data.locationError, /先手动选择/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.page.data.selection.mode, 'NATIONWIDE');
  assert.equal(h.storage.size, 0);
});
test('on-demand reverse lookup suggests an exact catalog region and only explicit confirmation persists the region', async () => {
  const candidate = {
    title: '合成区',
    address: '合成区合成路',
    point,
    sourceCode: '123456',
    source: 'TENCENT',
    kind: 'REVERSE',
    region,
    regionLabel: '合成区',
    regionLevel: 'COUNTY',
  };
  const h = harness('local', {
    request: ({ url }) =>
      url.endsWith('local-location')
        ? envelope({ candidates: [candidate], inventoryVerified: false })
        : envelope({
            ...searchData(),
            locationCapability: { enabled: true, coordinateSystem: 'GCJ02' },
          }),
  });
  h.page.onShow();
  await h.flush();
  h.wx.getLocation = (o) => o.success(point);
  await h.page.locate();
  assert.equal(h.page.data.selection.mode, 'NATIONWIDE');
  assert.equal(h.storage.size, 0);
  assert.equal(h.page.data.locatedRegions.length, 1);
  assert.equal(h.calls.at(-1).body.type, 'REVERSE');
  await h.page.confirmLocatedRegion(tap({ index: 0 }));
  assert.equal(h.page.data.selection.regionId, R);
  assert.equal(h.page.data.selection.level, 'COUNTY');
  assert.equal(h.page.data.hasOrigin, true);
  assert.equal(h.storage.size, 1);
  const stored = JSON.stringify([...h.storage.values()]);
  assert.equal(stored.includes('latitude'), false);
  assert.equal(stored.includes('longitude'), false);
  assert.equal(h.calls.at(-1).url, '/v1/public/local-search');
});
test('a reverse lookup that arrives after leaving the page cannot present or select a city', async () => {
  const d = deferred(),
    h = harness('local', {
      request: ({ url }) =>
        url.endsWith('local-location')
          ? d.promise
          : envelope({
              ...searchData(),
              locationCapability: { enabled: true, coordinateSystem: 'GCJ02' },
            }),
    });
  h.page.onShow();
  await h.flush();
  h.wx.getLocation = (o) => o.success(point);
  const task = h.page.locate();
  await ticks();
  h.page.onHide();
  d.resolve(
    envelope({
      candidates: [
        {
          title: '合成区',
          address: '合成地址',
          point,
          sourceCode: '123456',
          source: 'TENCENT',
          kind: 'REVERSE',
          region,
          regionLabel: '合成区',
          regionLevel: 'COUNTY',
        },
      ],
      inventoryVerified: false,
    }),
  );
  await task;
  assert.equal(h.page.data.locatedRegions.length, 0);
  assert.equal(h.page.data.selection.mode, 'NATIONWIDE');
  assert.equal(h.storage.size, 0);
});

test('closing a detail prevents late server data from reopening the booking form', async () => {
  const d = deferred(),
    h = harness('local', { request: () => d.promise });
  h.page._hidden = false;
  const task = h.page.showDetail(L);
  h.page.closeDetail();
  d.resolve(
    envelope({
      listing: listing(),
      slots: [slot()],
      terms: '合成合作约定',
      paymentStatus: 'NOT_ENABLED',
    }),
  );
  await task;
  assert.equal(h.page.data.detail, null);
});

test('unknown writes keep their actor-scoped original payload and receipt lookup never generates a second command', async () => {
  let unknown = true;
  const h = harness('local-bookings', {
    request: async ({ url }) => {
      if (url.includes('/receipts/')) throw { status: 404, message: '未找到' };
      if (url.endsWith('/commands')) {
        if (unknown) throw { code: 'NETWORK_ERROR', message: '合成网络中断' };
        return envelope({ resourceType: 'BOOKING', resourceId: B, version: 2 });
      }
      return envelope({ items: [booking()], limit: 200 });
    },
  });
  h.page.onShow();
  await h.flush();
  h.page.select(tap({ id: B }));
  h.page.input(tap({}, '核对合成锁位'));
  await h.page.command(tap({ type: 'CONFIRM' }));
  assert.ok(h.page.data.pending);
  const original = structuredClone(h.page.data.pending);
  const ls = h.requireLocal('utils/local-services.js');
  equal(ls.readPending(h.wx, U).record, original);
  await h.page.recover();
  equal(h.page.data.pending, original);
  unknown = false;
  await h.page.retry();
  assert.equal(h.page.data.pending, null);
  const writes = h.calls.filter((c) => c.url.endsWith('/commands'));
  assert.equal(writes.length, 2);
  equal(writes[0].body, writes[1].body);
  assert.equal(h.storage.size, 0);
});

test('account change clears private forms and an old write cannot publish another actor result', async () => {
  const d = deferred(),
    h = harness('local-bookings', {
      request: ({ url }) =>
        url.endsWith('/commands') ? d.promise : envelope({ items: [booking()], limit: 200 }),
    });
  h.page.onShow();
  await h.flush();
  h.page.select(tap({ id: B }));
  h.page.input(tap({}, '核对合成锁位'));
  const task = h.page.command(tap({ type: 'CONFIRM' }));
  await ticks();
  assert.ok(h.page.data.pending);
  h.switchUser(V);
  d.resolve(envelope({ resourceType: 'BOOKING', resourceId: B, version: 2 }));
  await task;
  assert.equal(h.page.data.items.length, 0);
  assert.equal(h.page.data.selected, null);
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page.data.reason, '');
  const ls = h.requireLocal('utils/local-services.js');
  assert.ok(ls.readPending(h.wx, U).record);
  assert.equal(ls.readPending(h.wx, V).record, null);
});

test('failed local persistence prevents sending a mutation', async () => {
  const h = harness('local-bookings', {
    request: () => envelope({ items: [booking()], limit: 200 }),
  });
  h.page.onShow();
  await h.flush();
  h.page.select(tap({ id: B }));
  h.page.input(tap({}, '核对合成锁位'));
  h.wx.setStorageSync = () => {
    throw new Error('full');
  };
  await h.page.command(tap({ type: 'CONFIRM' }));
  assert.match(h.page.data.error, /未发送/);
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
});

test('provider and buyer UI each offer only their own fulfillment commands and changes require the other party', () => {
  const h = harness(),
    ls = h.requireLocal('utils/local-services.js');
  equal(
    ls.booking(booking()).actions.map((v) => v.type),
    ['CONFIRM', 'CANCEL'],
  );
  equal(
    ls
      .booking(booking({ status: 'REQUESTED', kind: 'REFEREE', canActAs: 'PROVIDER' }))
      .actions.map((v) => v.type),
    ['ACCEPT', 'DECLINE', 'CANCEL'],
  );
  assert.equal(
    ls
      .booking(booking({ status: 'ARRIVED', canActAs: 'ADMIN' }))
      .actions.some((v) => v.type === 'DELIVER'),
    false,
  );
  const b = harness('local-bookings');
  b.page._viewer = U;
  b.page.setData({
    items: [
      ls.booking(
        booking({
          status: 'CONFIRMED',
          change: {
            slotId: S,
            proposedBy: U,
            reason: '合成改期请求',
            startsAt: slot().startsAt,
            endsAt: slot().endsAt,
          },
        }),
      ),
    ],
  });
  b.page.select(tap({ id: B }));
  assert.equal(b.page.data.selected.canRespondChange, false);
});

test('independent review requires both explicit checks and its qualification deadline', async () => {
  const h = harness('local-manage');
  h.page._viewer = U;
  h.page.setData({
    selected: {
      listing: { ...listing({ status: 'PENDING' }), providerUserId: V },
      capabilities: {
        canManage: false,
        canReview: true,
        canSuspend: false,
        canConfirmProvider: false,
      },
      slots: [],
      terms: '合成合作约定',
    },
    reason: '已独立线下核验',
  });
  await h.page.command(tap({ type: 'APPROVE' }));
  assert.match(h.page.data.error, /分别确认/);
  assert.equal(h.calls.length, 0);
  h.page.setData({ qualificationChecked: true, scopeChecked: true });
  await h.page.command(tap({ type: 'APPROVE' }));
  assert.match(h.page.data.error, /北京时间/);
  assert.equal(h.calls.length, 0);
  h.page.setData({ qualificationChecked: false, scopeChecked: false });
  const html = preview(h.page.route, h.page.data).phone;
  assert.match(html, /执业许可/);
  assert.doesNotMatch(html, /type="checkbox" checked/);
});

test('team invite uses a real confirmed court booking and a finite team card rather than trusted client identity', async () => {
  const h = harness('local-matchups', {
    request: ({ url }) =>
      envelope(
        url === '/v1/local-matchups'
          ? { items: [], limit: 200 }
          : {
              items: [
                booking({ status: 'CONFIRMED' }),
                booking({ id: M, status: 'CONFIRMED', kind: 'REFEREE' }),
              ],
              limit: 200,
            },
      ),
  });
  h.page.onShow();
  await h.flush();
  assert.equal(h.page.data.courtBookings.length, 1);
  h.page.input(tap({ field: 'opponentCard' }, 'javascript:evil'));
  h.page.opponent();
  assert.equal(h.page.data.opponent, null);
  h.page.input(tap({ field: 'opponentCard' }, '/pages/team/index?orgId=' + C + '&teamId=' + M));
  h.page.opponent();
  assert.equal(h.page.data.opponent.teamId, M);
  h.page.card();
  assert.equal(h.wx.calls.at(-1).data, '/pages/team/index?orgId=' + O + '&teamId=' + T);
});

test('a court checkin secret appears only in the original response and is cleared when the page leaves', async () => {
  const code = 'abcdef0123456789abcdef0123456789';
  let version = 1;
  const h = harness('local-bookings', {
    request: ({ url }) => {
      if (url.endsWith('/checkin')) {
        version = 2;
        return envelope({
          receipt: { resourceType: 'BOOKING', resourceId: B, version: 2 },
          checkin: { code, expiresAt: '2028-05-01T01:10:00Z' },
        });
      }
      return envelope({ items: [booking({ status: 'CONFIRMED', version })], limit: 200 });
    },
  });
  h.page.onShow();
  await h.flush();
  h.page.select(tap({ id: B }));
  await h.page.issueCheckin();
  assert.equal(h.page.data.checkinDisplay.code, code);
  assert.equal(h.storage.size, 0);
  h.page.copyCheckin();
  assert.equal(h.wx.calls.at(-1).data, code);
  h.page.onHide();
  assert.equal(h.page.data.checkinDisplay, null);
  assert.equal(h.page.data.checkinInput, '');
  assert.equal(JSON.stringify([...h.storage.values()]).includes(code), false);
});

test('unknown checkin redemption persists its command but never its credential, and requires the same code to retry', async () => {
  const code = 'abcdef0123456789abcdef0123456789';
  let failed = true;
  const h = harness('local-bookings', {
    request: ({ url }) => {
      if (url.endsWith('/commands')) {
        if (failed) throw { code: 'NETWORK_ERROR', message: '合成断网' };
        return envelope({ resourceType: 'BOOKING', resourceId: B, version: 2 });
      }
      return envelope({
        items: [booking({ status: 'CONFIRMED', canActAs: 'PROVIDER' })],
        limit: 200,
      });
    },
  });
  h.page.onShow();
  await h.flush();
  h.page.select(tap({ id: B }));
  h.page.input(tap({}, '现场持需求方码核销'));
  h.page.input(tap({ field: 'checkinInput' }, code));
  await h.page.command(tap({ type: 'REDEEM_CHECKIN' }));
  assert.ok(h.page.data.pending);
  const original = h.page.data.pending.body.commandId;
  assert.equal(Object.hasOwn(h.page.data.pending.body, 'checkinCode'), false);
  assert.equal(JSON.stringify([...h.storage.values()]).includes(code), false);
  h.page.onHide();
  h.page.onShow();
  await h.flush();
  await h.page.retry();
  assert.match(h.page.data.error, /不会保存到本机/);
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 1);
  h.page.input(tap({ field: 'checkinInput' }, code));
  failed = false;
  await h.page.retry();
  const writes = h.calls.filter((c) => c.method === 'POST');
  assert.equal(writes[1].body.commandId, original);
  assert.equal(writes[1].body.checkinCode, code);
  assert.equal(h.storage.size, 0);
});

test('an issuing response arriving after the page is hidden never restores the plaintext code', async () => {
  const d = deferred(),
    code = 'abcdef0123456789abcdef0123456789';
  const h = harness('local-bookings', {
    request: ({ url }) =>
      url.endsWith('/checkin')
        ? d.promise
        : envelope({ items: [booking({ status: 'CONFIRMED' })], limit: 200 }),
  });
  h.page.onShow();
  await h.flush();
  h.page.select(tap({ id: B }));
  const task = h.page.issueCheckin();
  await ticks();
  h.page.onHide();
  d.resolve(
    envelope({
      receipt: { resourceType: 'BOOKING', resourceId: B, version: 2 },
      checkin: { code, expiresAt: '2028-05-01T01:10:00Z' },
    }),
  );
  await task;
  assert.equal(h.page.data.checkinDisplay, null);
  assert.equal(JSON.stringify([...h.storage.values()]).includes(code), false);
});

test('local booking feedback uses only the selected server booking and completion gates reviews', () => {
  const h = harness('local-bookings'),
    ls = h.requireLocal('utils/local-services.js'),
    ui = h.requireLocal('utils/ui.js');
  ui.routes.governance = '/pages/governance/index';
  ui.routes['governance-reviews'] = '/pages/governance-reviews/index';
  h.page.setData({ items: [ls.booking(booking({ status: 'CONFIRMED' }))] });
  h.page.select(tap({ id: B }));
  h.page.governance(tap({ kind: 'review' }));
  assert.equal(h.wx.calls.length, 0);
  h.page.governance(tap({ kind: 'case' }));
  assert.equal(
    h.wx.calls.at(-1).url,
    '/pages/governance/index?sourceKind=LOCAL_BOOKING&sourceId=' + B,
  );
  h.page.setData({ items: [ls.booking(booking({ status: 'COMPLETED' }))] });
  h.page.select(tap({ id: B }));
  h.page.governance(tap({ kind: 'review' }));
  assert.equal(
    h.wx.calls.at(-1).url,
    '/pages/governance-reviews/index?sourceKind=LOCAL_BOOKING&sourceId=' + B,
  );
  h.page.setData({ busy: true });
  const count = h.wx.calls.length;
  h.page.governance(tap({ kind: 'case' }));
  assert.equal(h.wx.calls.length, count);
});

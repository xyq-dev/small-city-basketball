const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const U = '10000000-0000-4000-8000-000000000001',
  V = '10000000-0000-4000-8000-000000000002',
  O = '20000000-0000-4000-8000-000000000001',
  R = '30000000-0000-4000-8000-000000000001',
  Q = '40000000-0000-4000-8000-000000000001',
  C = '50000000-0000-4000-8000-000000000001';
const envelope = (data) => ({ data, meta: { requestId: 'isolated-r6' } });
const empty = () => ({
  requests: [],
  offers: [],
  preference: null,
  truncated: false,
  capabilities: {
    enabled: true,
    conversionEnabled: true,
    maxBatches: 3,
    batchSize: 3,
    holdMinutes: 10,
    externalNotifications: false,
  },
});
const tap = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });
function harness(request, storage = new Map()) {
  let viewer = U,
    revision = 0;
  const calls = [],
    listeners = new Set();
  const client = {
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hasSession: () => true,
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return envelope({
          user: { id: viewer },
          organizations: [{ id: O, name: '合成机构', role: 'ORG_OWNER' }],
          teamContexts: [],
        });
      return request ? request({ url, method, body }) : envelope(empty());
    },
    requestPublic(url) {
      return this.request(url);
    },
  };
  const api = { getClient: () => client, uuid: (v) => v, publicId: (v) => v };
  const wx = createWx({ storage, modalAnswers: [true, true, true, true] });
  wx.getLocation = () => {
    throw Error('Do not acquire device location');
  };
  const h = loadPage({
    root,
    route: 'pages/dispatch/index',
    wx,
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad();
  h.page._visible = true;
  return {
    ...h,
    client,
    calls,
    storage,
    switchUser() {
      viewer = V;
      revision++;
      for (const fn of listeners) fn();
    },
  };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
test('native dispatch template compiles and every bound action exists', () => {
  const h = harness();
  const tree = parseWxml(fs.readFileSync(path.join(root, 'pages/dispatch/index.wxml'), 'utf8'));
  for (const name of eventHandlers(tree)) assert.equal(typeof h.page[name], 'function', name);
  const source = fs.readFileSync(path.join(root, 'pages/dispatch/index.wxml'), 'utf8');
  assert.match(source, /路线未知不会自动通过/);
  assert.match(source, /保持原编号重试/);
  assert.match(source, /同意本次报价/);
});
test('money parsing never turns blank or malformed fees into free; uses integer minor units', () => {
  const d = harness().requireLocal('utils/dispatch.js');
  assert.equal(d.fen('12.34'), 1234);
  assert.equal(d.fen('0'), 0);
  for (const x of ['', null, '1.001', '-1', 'Infinity', '1e3', '1000000.01'])
    assert.throws(() => d.fen(x));
  assert.throws(() => d.money({ serviceMinor: 0 }));
});
test('no automatic location or mutation while reading; disabled capability stays visible', async () => {
  const h = harness(() =>
    envelope({ ...empty(), capabilities: { ...empty().capabilities, enabled: false } }),
  );
  await h.page.load();
  assert.equal(h.page.data.capabilities.enabled, false);
  assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0);
  assert.equal(h.page.data.loading, false);
});
test('pending record is actor scoped, rejects foreign paths and cannot be overwritten by another command', () => {
  const h = harness(),
    d = h.requireLocal('utils/dispatch.js');
  const r = {
    version: 1,
    actorId: U,
    path: '/v1/dispatch/requests',
    label: '保存明确需求',
    body: { commandId: C, people: 1 },
  };
  assert.equal(d.savePending(h.wx, r), true);
  assert.equal(d.readPending(h.wx, V).record, null);
  assert.equal(d.savePending(h.wx, { ...r, body: { commandId: Q } }), false);
  assert.equal(d.clearPending(h.wx, U, Q), false);
  assert.equal(d.savePending(h.wx, { ...r, path: '/v1/admin/users' }), false);
  assert.equal(d.clearPending(h.wx, U, C), true);
});
test('uncertain response survives refresh; receipt miss does not generate a new command; retry preserves body', async () => {
  let fail = true;
  const h = harness(({ url, method, body }) => {
    if (url === '/v1/dispatch') return envelope(empty());
    if (url.startsWith('/v1/dispatch/receipts/'))
      throw Object.assign(Error('not found'), { status: 404 });
    if (method === 'POST') {
      if (fail) throw Object.assign(Error('network uncertain'), { code: 'NETWORK_ERROR' });
      return envelope({ resourceType: 'DISPATCH_REQUEST', resourceId: R, version: 1 });
    }
    throw Error('unexpected');
  });
  await h.page.load();
  const d = h.requireLocal('utils/dispatch.js');
  const input = {
    path: '/v1/dispatch/requests',
    body: { orgId: O, people: 1 },
    label: '保存跨城需求',
    content: '明确确认本次需求',
  };
  assert.equal(await d.write(h.page, input), false);
  const original = plain(h.page.data.pending);
  assert.ok(original.body.commandId);
  await d.recover(h.page);
  assert.deepEqual(plain(h.page.data.pending), original);
  fail = false;
  await d.retry(h.page);
  const posts = h.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(plain(posts[0].body), plain(posts[1].body));
  assert.equal(h.page.data.pending, null);
});
test('session reset scrubs address, quote evidence, selected scope and late callbacks', async () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const h = harness(() => promise);
  const work = h.page.load();
  await new Promise((r) => setImmediate(r));
  h.page.setData({
    address: '授权服务地址',
    travelEvidence: '授权路线证据',
    selectedOffer: { private: true },
    formRegion: { regionId: R },
    preferenceRegions: [{ regionId: R }],
  });
  h.switchUser();
  resolve(envelope(empty()));
  await work;
  assert.equal(h.page.data.address, '');
  assert.equal(h.page.data.travelEvidence, '');
  assert.equal(h.page.data.selectedOffer, null);
  assert.equal(h.page.data.formRegion, null);
  assert.deepEqual(plain(h.page.data.preferenceRegions), []);
  assert.equal(h.page.data.loginRequired, true);
});
test('explicit consent required before create and independent travel approval', async () => {
  const h = harness();
  await h.page.load();
  await h.page.create();
  assert.match(h.page.data.error, /勾选/);
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
  h.page.setData({
    selectedOffer: { id: Q, version: 2, quoteHash: 'a'.repeat(64), request: {} },
    reason: '本次交通路线需要核验',
    evidenceChecked: false,
  });
  await h.page.offerCommand(tap({ type: 'VERIFY_TRAVEL' }));
  assert.match(h.page.data.error, /独立核验/);
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
});

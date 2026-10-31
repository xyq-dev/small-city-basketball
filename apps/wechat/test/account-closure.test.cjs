const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const api = require('../utils/api');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const fs = require('node:fs');
const { renderWxml } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const prefix = '/v1/account-closure';
const journal = (id = actor) => 'scb-account-closure-v1:' + id;
const envelope = (data) => ({ data, meta: { requestId: 'synthetic-e07' } });
const dto = (status = 'PENDING') => ({
  id: requestId,
  version: 1,
  status,
  coolingOffDays: 0,
  requestedAt: '2026-10-31T00:00:00.000Z',
  executeAfter: '2026-10-31T00:00:00.000Z',
  finishedAt: null,
  blockers: [],
});
function setup(options = {}) {
  let viewer = actor,
    revision = 0;
  const listeners = new Set(),
    calls = [];
  const wx = createWx({ modalAnswers: [true, true, true] });
  const client = {
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return envelope({ user: { id: viewer }, organizations: [], teamContexts: [] });
      if (method === 'GET')
        return envelope({ enabled: options.enabled !== false, request: options.current || null });
      if (options.write) return options.write(url, body);
      return envelope(dto(url.endsWith('/cancel') ? 'CANCELLED' : 'PENDING'));
    },
  };
  const h = loadPage({
    root,
    route: 'pages/account-closure/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } },
  });
  return {
    ...h,
    calls,
    switchActor() {
      viewer = other;
      revision++;
      for (const fn of listeners) fn();
    },
  };
}
async function ready(h) {
  h.page.onShow();
  await h.flush();
  h.page.setData({ password: 'synthetic current password', confirmed: true });
}
test('E07 loads private status and defaults to zero days with clear retained-history notice', async () => {
  const h = setup();
  await ready(h);
  assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.coolingOffDays, 0);
  const html = renderWxml(
    // The shared header is covered by its own component tests; render this new page body before root registers its route.
    fs
      .readFileSync(path.join(root, 'pages/account-closure/index.wxml'), 'utf8')
      .replace(/<scb-header[^>]*\/>/, ''),
    h.page.data,
  );
  assert.ok(html.includes('立即检查'));
  assert.ok(html.includes('注销不等于立即删除所有记录'));
  assert.ok(html.includes('申请注销并开始安全检查'));
  h.page.onUnload();
});
test('E07 persists only command metadata and clears the matching receipt on success', async () => {
  const h = setup();
  await ready(h);
  await h.page.requestClosure();
  const write = h.calls.find((x) => x.method === 'POST');
  assert.equal(write.body.coolingOffDays, 0);
  assert.equal(write.body.password, 'synthetic current password');
  const saved = h.wx.calls.find((x) => x.type === 'setStorageSync');
  assert.equal(saved.key, journal());
  assert.equal(saved.value.operation, 'REQUEST');
  assert.deepEqual(Object.keys(saved.value).sort(), [
    'clientRequestId',
    'coolingOffDays',
    'operation',
  ]);
  assert.equal(h.wx.storage.has(journal()), false);
  assert.equal(h.page.data.password, '');
  assert.match(h.page.data.message, /尚不代表账号已注销/);
  h.page.onUnload();
});
test('E07 unknown result retries the original number and original days after a later edit', async () => {
  let count = 0;
  const h = setup({
    write: async () => {
      if (!count++) throw new Error('network uncertain');
      return envelope(dto());
    },
  });
  await ready(h);
  h.page.setData({ coolingOffDays: 4 });
  await h.page.requestClosure();
  const original = h.wx.storage.get(journal());
  assert.equal(h.page.data.pending, true);
  h.page.setData({ coolingOffDays: 7, password: 'new synthetic password', confirmed: true });
  await h.page.retry();
  const writes = h.calls.filter((x) => x.method === 'POST');
  assert.equal(writes[1].body.clientRequestId, original.clientRequestId);
  assert.equal(writes[1].body.coolingOffDays, 4);
  assert.equal(writes[1].body.password, 'new synthetic password');
  h.page.onUnload();
});
test('E07 hiding during secure UUID generation never starts a write or stores a password', async () => {
  const h = setup();
  await ready(h);
  let finish;
  h.wx.getRandomValues = (o) => {
    finish = o;
  };
  const pending = h.page.requestClosure();
  await h.flush();
  assert.ok(finish);
  h.page.onHide();
  finish.success({ randomValues: new Uint8Array(16).buffer });
  await pending;
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
  assert.equal(h.wx.storage.has(journal()), false);
  assert.equal(h.page.data.password, '');
});
test('E07 late old actor result cannot clear a newer command or replace current private state', async () => {
  let finish;
  const h = setup({
    write: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await ready(h);
  const pending = h.page.requestClosure();
  await h.flush();
  assert.ok(finish);
  h.switchActor();
  const newer = { operation: 'REQUEST', clientRequestId: other, coolingOffDays: 1 };
  h.wx.storage.set(journal(), newer);
  h.wx.storage.set(journal(other), newer);
  finish(envelope(dto()));
  await pending;
  assert.deepEqual(h.wx.storage.get(journal()), newer);
  assert.deepEqual(h.wx.storage.get(journal(other)), newer);
  assert.equal(h.page.data.request, null);
  assert.equal(h.page.data.loginRequired, true);
  h.page.onUnload();
});
test('E07 storage failure prevents the mutation from becoming unrecoverable', async () => {
  const h = setup();
  await ready(h);
  h.wx.setStorageSync = () => {
    throw new Error('storage unavailable');
  };
  await h.page.requestClosure();
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
  assert.match(h.page.data.error, /storage unavailable/);
  assert.equal(h.page.data.busy, false);
  h.page.onUnload();
});
test('E07 safety cancellation remains available while new requests are disabled', async () => {
  const h = setup({ enabled: false, current: dto() });
  await ready(h);
  await h.page.cancelClosure();
  const write = h.calls.find((x) => x.method === 'POST');
  assert.equal(write.url, prefix + '/cancel');
  assert.equal(write.body.requestId, requestId);
  assert.equal(write.body.expectedVersion, 1);
  assert.equal(h.page.data.request.status, 'CANCELLED');
  h.page.onUnload();
});

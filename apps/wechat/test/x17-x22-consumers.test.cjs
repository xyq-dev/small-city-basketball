const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tap = (dataset) => ({ currentTarget: { dataset } });
const pendingKey = 'scb-account-recovery-pending-v1';
function page(route, options = {}) {
  return loadPage({ root, route: 'pages/' + route + '/index', wx: createWx(options) });
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
test('account reset unknown retains only operation id, and a fresh mail does not discard it', async () => {
  const h = page('account-recovery');
  const calls = [];
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async (p, m, b) => {
      calls.push({ p, m, b });
      if (p.endsWith('/consume')) throw Error('lost');
      return { data: { accepted: true } };
    },
  });
  h.page._closed = false;
  h.page.setData({
    enabled: true,
    email: 'me@example.test',
    token: 'secret-code',
    newPassword: 'secret-password',
  });
  await h.page.consume();
  const stored = h.wx.storage.get(pendingKey);
  assert.deepEqual(Object.keys(stored), ['id']);
  assert.equal(h.page.data.pending, true);
  assert.equal(h.page.data.newPassword, '');
  await h.page.request(tap({ kind: 'reset' }));
  assert.equal(calls.at(-1).p, '/v1/account-recovery/reset-requests');
  assert.deepEqual(h.wx.storage.get(pendingKey), stored);
});
test('hidden reset cannot send after delayed secure UUID, and secrets clear', async () => {
  const h = page('account-recovery');
  const wait = deferred();
  let writes = 0;
  h.requireLocal('utils/ui.js').uuid = () => wait.promise;
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async () => {
      writes++;
      return { data: {} };
    },
  });
  h.page._closed = false;
  h.page.setData({ enabled: true, token: 'secret', newPassword: 'password' });
  const task = h.page.consume();
  h.page.onHide();
  wait.resolve(id(1));
  await task;
  assert.equal(writes, 0);
  assert.equal(h.wx.storage.has(pendingKey), false);
  assert.equal(h.page.data.token, '');
  assert.equal(h.page.data.newPassword, '');
});
test('late reset response cannot delete a different pending operation', async () => {
  const h = page('account-recovery');
  const wait = deferred();
  h.requireLocal('utils/api.js').getClient = () => ({ request: () => wait.promise });
  h.page._closed = false;
  h.page.setData({ enabled: true, token: 'secret' });
  const task = h.page.consume();
  await new Promise(setImmediate);
  h.page.onHide();
  h.wx.storage.set(pendingKey, { id: id(999) });
  wait.resolve({ data: { completed: true } });
  await task;
  assert.equal(h.wx.storage.get(pendingKey).id, id(999));
});
test('recovery storage failure fails closed before consuming credentials', async () => {
  const h = page('account-recovery');
  let writes = 0;
  h.wx.setStorageSync = () => {
    throw Error('full');
  };
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async () => {
      writes++;
    },
  });
  h.page._closed = false;
  h.page.setData({ enabled: true, token: 'secret', newPassword: 'password' });
  await h.page.consume();
  assert.equal(writes, 0);
});
function staff() {
  const h = page('staff-configuration', { modalAnswers: [true, true] });
  h.page._closed = false;
  h.page._viewer = id(1);
  h.page._org = id(2);
  h.page.setData({
    workspace: {
      members: [],
      staff: [],
      capabilities: { canManageMembers: true, canManageStaff: true },
    },
    userId: id(3),
  });
  h.requireLocal('utils/api.js').getClient = () => ({
    sessionRevision: () => 0,
    request: async () => {
      throw Error('lost');
    },
  });
  return h;
}
test('staff unknown retries exact command id, stale permissions do not silently clear it', async () => {
  const h = staff();
  const calls = [];
  h.requireLocal('utils/api.js').getClient = () => ({
    sessionRevision: () => 0,
    request: async (p, m, b) => {
      calls.push({ p, b: structuredClone(b) });
      throw Error('lost');
    },
  });
  await h.page.save();
  assert.equal(h.page.data.pending, true);
  await h.page.retry();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
});
test('staff hidden during confirmation sends no mutation', async () => {
  const h = staff();
  const wait = deferred();
  h.wx.showModal = (o) => wait.promise.then(() => o.success({ confirm: true }));
  let writes = 0;
  h.requireLocal('utils/api.js').getClient = () => ({
    sessionRevision: () => 0,
    request: async () => {
      writes++;
    },
  });
  const task = h.page.save();
  h.page.onHide();
  wait.resolve();
  await task;
  assert.equal(writes, 0);
  assert.equal(h.page.data.workspace, null);
});
test('completion client allows exact anonymous lanes and rejects private or wrong-method reuse', () => {
  const api = require('../utils/api');
  const org = '/v1/orgs/' + id(1),
    event = org + '/events/' + id(2),
    token = 'A'.repeat(43);
  assert.equal(api.pathAllowed(event + '/posters/' + id(3) + '/revoke', 'POST'), true);
  assert.equal(
    api.pathAllowed(event + '/posters/' + id(3) + '/revoke?token=secret', 'POST'),
    false,
  );
  assert.equal(api.pathAllowed('/v1/public/local-search', 'GET'), false);
  assert.equal(api.pathAllowed(org + '/matches/' + id(2) + '/offline-intents', 'POST'), true);
  assert.equal(api.pathAllowed('/v1/public/recruitments/' + token + '/applications', 'GET'), false);
});

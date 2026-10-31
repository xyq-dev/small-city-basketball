const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const viewer = '11111111-1111-4111-8111-111111111111';
const intentId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const consentKey = 'scb-notification-consent-v1:' + viewer;
const retryKey = 'scb-notification-retry-v1:' + viewer;
const intent = {
  id: intentId,
  kind: 'MATCH_STARTING',
  templateId: 'test-template',
  state: 'PENDING',
};
function fixture(route, handle = () => ({})) {
  const calls = [],
    listeners = new Set();
  let revision = 0;
  const wx = createWx();
  const api = {
    uuid: (x) => x,
    publicTime: (x) => x,
    getClient: () => ({
      sessionRevision: () => revision,
      onSessionChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      async request(url, method = 'GET', body) {
        calls.push({ url, method, body });
        if (url === '/v1/auth/session')
          return { data: { user: { id: viewer }, organizations: [], teamContexts: [] } };
        if (url.endsWith('/settings'))
          return {
            data: {
              wechatEnabled: true,
              kinds: [{ kind: 'MATCH_STARTING', templateId: 'test-template' }],
              subscriptions: [],
            },
          };
        return { data: await handle(url, method, body) };
      },
    }),
  };
  const h = loadPage({
    root,
    route: 'pages/' + route + '/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  return {
    ...h,
    calls,
    change() {
      revision++;
      for (const f of [...listeners]) f();
    },
  };
}
async function shown(h) {
  h.page.onShow();
  await h.flush();
}
const writes = (h) => h.calls.filter((x) => x.method !== 'GET');

test('prepare journals before network; native subscription prompt occurs in the tap callback', async () => {
  let h;
  h = fixture('notification-settings', (url) => {
    if (url.endsWith('/intents')) {
      assert.equal(h.wx.storage.get(consentKey).phase, 'PREPARE');
      return intent;
    }
    return {};
  });
  await shown(h);
  await h.page.prepare();
  let called = false,
    activeTap = true;
  h.wx.requestSubscribeMessage = (o) => {
    assert.equal(activeTap, true);
    assert.deepEqual(Array.from(o.tmplIds), ['test-template']);
    called = true;
  };
  h.page.subscribe();
  activeTap = false;
  assert.equal(called, true);
  assert.equal(writes(h).length, 1);
  assert.equal(h.page.data.intent.id, intentId);
});

test('accept uses ephemeral wx.login code and journals IDs only; server acceptance stays client reported', async () => {
  const h = fixture('notification-settings', (url) =>
    url.endsWith('/intents') ? intent : { state: 'ACCEPTED' },
  );
  await shown(h);
  await h.page.prepare();
  h.wx.login = (o) => o.success({ code: 'private-one-use-code' });
  h.wx.requestSubscribeMessage = (o) => o.success({ 'test-template': 'accept' });
  h.page.subscribe();
  await h.flush();
  const sent = writes(h).find((x) => x.url.endsWith('/confirmations'));
  assert.equal(sent.body.code, 'private-one-use-code');
  assert.equal(sent.body.result, 'accept');
  const stored = h.wx.calls
    .filter((x) => x.type === 'setStorageSync')
    .map((x) => JSON.stringify(x.value))
    .join('');
  assert.equal(stored.includes('private-one-use-code'), false);
  assert.equal(stored.includes('openid'), false);
  assert.match(h.page.data.message, /客户端许可/);
  assert.equal(h.wx.storage.has(consentKey), false);
});

test('reject submits no login code and never runs wx.login', async () => {
  const h = fixture('notification-settings', (url) =>
    url.endsWith('/intents') ? intent : { state: 'REJECTED' },
  );
  await shown(h);
  await h.page.prepare();
  h.wx.login = () => {
    throw Error('must not login for reject');
  };
  h.wx.requestSubscribeMessage = (o) => o.success({ 'test-template': 'reject' });
  h.page.subscribe();
  await h.flush();
  const sent = writes(h).at(-1);
  assert.equal(sent.body.result, 'reject');
  assert.equal(Object.hasOwn(sent.body, 'code'), false);
});

test('native callback after hide or account switch cannot exchange a code or confirm', async () => {
  for (const action of ['hide', 'switch']) {
    const h = fixture('notification-settings', () => intent);
    await shown(h);
    await h.page.prepare();
    let callback,
      logins = 0;
    h.wx.requestSubscribeMessage = (o) => {
      callback = o.success;
    };
    h.wx.login = () => {
      logins++;
    };
    h.page.subscribe();
    if (action === 'hide') h.page.onHide();
    else h.change();
    callback({ 'test-template': 'accept' });
    await h.flush();
    assert.equal(logins, 0);
    assert.equal(writes(h).length, 1);
    assert.equal(h.page.data.intent, null);
  }
});

test('ambiguous confirmation recovers by original intent lookup without replaying wx.login', async () => {
  let received;
  const h = fixture('notification-settings', (url, method, body) => {
    if (url.endsWith('/intents')) return intent;
    if (url.endsWith('/confirmations')) {
      received = body;
      throw Error('connection lost');
    }
    if (url.endsWith('/' + intentId)) return { state: 'ACCEPTED' };
    return {};
  });
  await shown(h);
  await h.page.prepare();
  h.wx.login = (o) => o.success({ code: 'ephemeral' });
  h.wx.requestSubscribeMessage = (o) => o.success({ 'test-template': 'accept' });
  h.page.subscribe();
  await h.flush();
  const original = h.wx.storage.get(consentKey);
  assert.equal(original.phase, 'CONFIRM');
  assert.equal(original.clientRequestId, received.clientRequestId);
  await h.page.recover();
  assert.equal(writes(h).filter((x) => x.url.endsWith('/confirmations')).length, 1);
  assert.equal(h.calls.at(-1).url, '/v1/me/notifications/intents/' + intentId);
  assert.equal(h.wx.storage.has(consentKey), false);
});

test('storage failure stops prepare and retry before any write', async () => {
  const h = fixture('notification-settings', () => intent);
  await shown(h);
  h.wx.setStorageSync = () => {
    throw Error('storage unavailable');
  };
  await h.page.prepare();
  assert.equal(writes(h).length, 0);
  const m = fixture('messages', () => ({ items: [], nextCursor: null }));
  await shown(m);
  m.wx.showModal = (o) => o.success({ confirm: true });
  m.wx.setStorageSync = () => {
    throw Error('storage unavailable');
  };
  await m.page.retry({ currentTarget: { dataset: { id: messageId } } });
  assert.equal(writes(m).length, 0);
});

test('unknown retry is journaled before sending and recovery uses the same permanent command', async () => {
  let first = true;
  const h = fixture('messages', (url, method, body) => {
    if (method === 'GET')
      return {
        items: [{ id: messageId, delivery: 'UNKNOWN', time: '2026-01-01T00:00:00Z' }],
        nextCursor: null,
      };
    assert.equal(h.wx.storage.get(retryKey).clientRequestId, body.clientRequestId);
    if (first) {
      first = false;
      throw Error('connection lost');
    }
    return { pending: true };
  });
  await shown(h);
  assert.match(h.page.data.items[0].deliveryLabel, /不会自动重发/);
  h.wx.showModal = (o) => o.success({ confirm: true });
  await h.page.retry({ currentTarget: { dataset: { id: messageId } } });
  const p = h.wx.storage.get(retryKey);
  assert.ok(p.clientRequestId);
  await h.page.resume();
  assert.equal(writes(h).length, 2);
  assert.deepEqual(writes(h)[0].body, writes(h)[1].body);
  assert.equal(writes(h)[0].body.acknowledgePossibleDuplicate, true);
  assert.equal(h.wx.storage.has(retryKey), false);
});

test('revoke replaces uncertain confirmation with a recoverable same-kind original request', async () => {
  let first = true;
  const h = fixture('notification-settings', () => {
    if (first) {
      first = false;
      throw Error('connection lost');
    }
    return { revoked: true };
  });
  h.wx.storage.set(consentKey, {
    phase: 'CONFIRM',
    clientRequestId: intentId,
    intentId,
    kind: 'REGISTRATION_REVIEW',
  });
  await shown(h);
  h.wx.showModal = (o) => o.success({ confirm: true });
  await h.page.revoke();
  const p = h.wx.storage.get(consentKey);
  assert.equal(p.phase, 'REVOKE');
  assert.equal(p.kind, 'REGISTRATION_REVIEW');
  await h.page.recover();
  assert.equal(writes(h).length, 2);
  assert.deepEqual(writes(h)[0].body, writes(h)[1].body);
  assert.equal(h.wx.storage.has(consentKey), false);
});

test('late list response cannot restore messages after account change', async () => {
  let resolve;
  const h = fixture(
    'messages',
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  h.page.onShow();
  await new Promise((done) => setImmediate(done));
  h.change();
  resolve({ items: [{ id: messageId, detail: 'private' }], nextCursor: null });
  await h.flush();
  assert.deepEqual(h.page.data.items, []);
  assert.equal(h.page._viewer, null);
});

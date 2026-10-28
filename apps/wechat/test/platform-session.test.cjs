const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// Reproduces C13 review: private event data shown for account A must not survive a later 401,
// sign-out or account switch, even though the session revision makes the in-flight token stale.
const orgA = '11111111-1111-4111-8111-111111111111';
const eventA = '33333333-3333-4333-8333-333333333333';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const ok = (data, cookie = cookieA) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-session-fixture', nextCursor: null } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const unauthorized = () => ({
  statusCode: 401,
  data: { error: { code: 'UNAUTHENTICATED', message: '合成会话失效' } },
});
const session = (user, organizations) => ({
  user: { id: user, email: 'synthetic@example.test', displayName: '合成账号' },
  organizations,
  teamContexts: [],
});
const adminA = session(userA, [{ id: orgA, name: '合成机构A', role: 'ORG_ADMIN' }]);
const event = {
  id: eventA,
  name: '账号A私有赛事',
  startDate: '2026-11-01',
  endDate: '2026-11-03',
  timezone: 'Asia/Shanghai',
  venueName: '合成体育馆',
  format: 'ROUND_ROBIN',
  status: 'RUNNING',
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const base = '/v1/orgs/' + orgA + '/events/' + eventA;

// Mutable synthetic server: tests switch replies between reads; `hold` delays one path.
function server(page) {
  const state = { session: () => ok(adminA), replies: new Map(), held: new Map() };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      if (state.held.has(url))
        return new Promise((resolve) => state.held.get(url).push(() => resolve(reply(url))));
      return reply(url);
    },
  });
  function reply(url) {
    if (url === '/v1/auth/session') return state.session();
    if (url === '/v1/auth/login') return ok(session(userB, []), cookieB);
    if (state.replies.has(url)) return state.replies.get(url)();
    return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: url } } };
  }
  const h = loadPage({ root, route: page, wx });
  const client = h.requireLocal('utils/api.js').getClient();
  const requests = () => wx.calls.filter((c) => c.type === 'request').map((c) => c.url);
  return {
    ...h,
    state,
    client,
    requests,
    hold(url) {
      state.held.set(url, []);
    },
    release(url) {
      for (const resume of state.held.get(url) || []) resume();
      state.held.delete(url);
    },
  };
}
function eventsRoutes(s) {
  s.state.replies.set('/v1/orgs/' + orgA + '/events?limit=50', () => ok([event]));
}
function detailRoutes(s) {
  s.state.replies.set(base, () => ok(event));
  s.state.replies.set(base + '/matches?limit=100', () => ok([]));
  s.state.replies.set(base + '/standings', () => ok({ standings: null, publication: null }));
  s.state.replies.set(base + '/player-statistics', () => ok({ summary: null }));
}
const shown = (data) => JSON.stringify(data).includes('账号A私有赛事');
const pages = [
  { route: 'pages/watch/index', start: (p) => (p.onLoad(), p.onShow()), loading: 'loading' },
  { route: 'pages/home/index', start: (p) => (p.onLoad(), p.onShow()), loading: 'eventsLoading' },
];

for (const { route, start, loading } of pages) {
  test(route + ': a 401 after account A data is shown clears it and ends loading', async () => {
    const s = server(route);
    eventsRoutes(s);
    await s.client.request('/v1/auth/session');
    start(s.page);
    await s.flush();
    assert.equal(shown(s.page.data), true);
    s.state.replies.set('/v1/orgs/' + orgA + '/events?limit=50', unauthorized);
    s.page.onShow();
    await s.flush();
    assert.equal(shown(s.page.data), false);
    assert.equal(s.page.data[loading], false);
    assert.equal(s.page.data.signedIn, false);
    assert.equal(s.client.hasSession(), false);
  });

  test(route + ': sign-out and account switch clear shown data immediately', async () => {
    for (const change of ['logout', 'switch']) {
      const s = server(route);
      eventsRoutes(s);
      await s.client.request('/v1/auth/session');
      start(s.page);
      await s.flush();
      assert.equal(shown(s.page.data), true);
      if (change === 'logout') s.client.clearSession();
      else await s.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
      assert.equal(shown(s.page.data), false, change);
      assert.equal(s.page.data[loading], false, change);
    }
  });

  test(route + ': a late response for the previous account is never filled in', async () => {
    const s = server(route);
    eventsRoutes(s);
    await s.client.request('/v1/auth/session');
    s.hold('/v1/orgs/' + orgA + '/events?limit=50');
    start(s.page);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(s.page.data[loading], true);
    s.client.clearSession();
    assert.equal(s.page.data[loading], false);
    s.release('/v1/orgs/' + orgA + '/events?limit=50');
    await s.flush();
    assert.equal(shown(s.page.data), false);
    assert.equal(s.page.data[loading], false);
  });

  test(route + ': unload unsubscribes and drops in-flight results', async () => {
    const s = server(route);
    eventsRoutes(s);
    await s.client.request('/v1/auth/session');
    s.hold('/v1/orgs/' + orgA + '/events?limit=50');
    start(s.page);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    s.unload();
    const writes = s.updates.length;
    s.client.clearSession();
    s.release('/v1/orgs/' + orgA + '/events?limit=50');
    await s.flush();
    assert.equal(s.updates.length, writes);
  });
}

test('org-event: first entry reads once; returning re-verifies identity before reading', async () => {
  const s = server('pages/org-event/index');
  detailRoutes(s);
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: orgA, eventId: eventA });
  s.page.onShow();
  await s.flush();
  const first = s.requests().slice(1);
  assert.equal(first.filter((url) => url === 'https://basketball.playhubs.cn' + base).length, 1);
  assert.equal(first[0], 'https://basketball.playhubs.cn/v1/auth/session');
  assert.equal(shown(s.page.data), true);
  s.page.onShow();
  await s.flush();
  const again = s.requests().slice(1 + first.length);
  assert.equal(again[0], 'https://basketball.playhubs.cn/v1/auth/session');
  assert.ok(again.includes('https://basketball.playhubs.cn' + base));
});

test('org-event: a 401 after data is shown clears every private section and ends loading', async () => {
  const s = server('pages/org-event/index');
  detailRoutes(s);
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: orgA, eventId: eventA, tab: 'stats' });
  s.page.onShow();
  await s.flush();
  assert.equal(shown(s.page.data), true);
  s.state.replies.set(base, unauthorized);
  s.page.onShow();
  await s.flush();
  assert.equal(s.page.data.event, null);
  assert.equal(s.page.data.stats, null);
  assert.deepEqual(s.page.data.matches, []);
  assert.equal(s.page.data.loading, false);
  assert.equal(shown(s.page.data), false);
});

test('org-event: sign-out, account switch and late responses never restore account A', async () => {
  for (const change of ['logout', 'switch']) {
    const s = server('pages/org-event/index');
    detailRoutes(s);
    await s.client.request('/v1/auth/session');
    s.page.onLoad({ orgId: orgA, eventId: eventA });
    s.page.onShow();
    await s.flush();
    assert.equal(shown(s.page.data), true);
    s.hold(base);
    s.page.onShow();
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    if (change === 'logout') s.client.clearSession();
    else await s.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
    assert.equal(shown(s.page.data), false, change);
    assert.equal(s.page.data.loading, false, change);
    s.release(base);
    await s.flush();
    assert.equal(shown(s.page.data), false, change);
  }
});

test('org-event: unload unsubscribes; later session changes and responses write nothing', async () => {
  const s = server('pages/org-event/index');
  detailRoutes(s);
  await s.client.request('/v1/auth/session');
  s.hold(base);
  s.page.onLoad({ orgId: orgA, eventId: eventA });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  s.unload();
  const writes = s.updates.length;
  s.client.clearSession();
  s.release(base);
  await s.flush();
  assert.equal(s.updates.length, writes);
});

test('public watch-link input survives a session reset', async () => {
  const s = server('pages/watch/index');
  eventsRoutes(s);
  await s.client.request('/v1/auth/session');
  s.page.onLoad();
  s.page.onShow();
  await s.flush();
  s.page.input({ detail: { value: '合成观赛链接草稿' } });
  s.client.clearSession();
  assert.equal(s.page.data.value, '合成观赛链接草稿');
  assert.equal(s.page.data.error, '');
});

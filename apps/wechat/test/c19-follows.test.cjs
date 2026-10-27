const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathAllowed } = require('../utils/api');
const follows = require('../utils/follows');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

// C19 event follows in the VM harness: the public event page stays cookie-less when signed out,
// follow/cancel writes use confirmOp (zero writes after late confirmations, async preparation
// invalidation, account switch, sign-out or unload), and "我的关注" is own-account only and
// cleared on any session change. Assertions check actual requests, not only page text.
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const key = 'K'.repeat(43);
const otherKey = 'L'.repeat(43);
const fid = (n) => '7777777' + n + '-7777-4777-8777-777777777777';
const ok = (data, cookie = cookieA, meta = {}, statusCode = 200) => ({
  statusCode,
  data: { data, meta: { requestId: 'synthetic-c19', ...meta } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const plain = (data, meta = {}) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c19', ...meta } },
});
const fail = (statusCode, code) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + statusCode } },
});
const sessionOf = (id) => ({
  user: { id, email: id.slice(0, 4) + '@example.test', displayName: '合成账号' },
  organizations: [],
  teamContexts: [],
});
const ticks = async (n = 15) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const tap = (dataset = {}) => ({ type: 'tap', currentTarget: { dataset }, detail: {} });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const followData = (over = {}) => ({
  followId: fid(1),
  publicEventId: key,
  status: 'ACTIVE',
  event: {
    name: '合成冬季杯',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    status: 'RUNNING',
    purpose: 'LIVE',
  },
  createdAt: '2026-10-28T01:00:00.000Z',
  cancelledAt: null,
  wechatReminder: 'NOT_ENABLED',
  ...over,
});
const invalidData = (over = {}) =>
  followData({
    status: 'INVALID',
    event: null,
    followId: fid(2),
    publicEventId: otherKey,
    ...over,
  });
const cancelledOf = (f) => ({
  ...f,
  status: 'CANCELLED',
  event: null,
  cancelledAt: '2026-10-28T02:00:00.000Z',
});
const publicEvent = {
  publicEventId: key,
  name: '合成冬季杯',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  timezone: 'Asia/Shanghai',
  venueName: '合成体育馆',
  status: 'RUNNING',
  rules: null,
  confirmedMatchCount: 0,
  totalMatchCount: 1,
  isComplete: false,
  serverTime: '2026-10-28T01:00:00.000Z',
};

/** Unregistered pages (app.json is integrator-owned) are previewed from a patched copy. */
let previewRootCache;
function previewRoot() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  if (manifest.pages.includes('pages/follows/index')) return root;
  if (previewRootCache) return previewRootCache;
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'scb-c19-follows-'));
  for (const entry of ['app.json', 'app.wxss', 'app.js', 'assets', 'components', 'pages', 'utils'])
    fs.cpSync(path.join(root, entry), path.join(copy, entry), { recursive: true });
  manifest.pages.push('pages/follows/index');
  fs.writeFileSync(path.join(copy, 'app.json'), JSON.stringify(manifest, null, 2));
  process.on('exit', () => fs.rmSync(copy, { recursive: true, force: true }));
  return (previewRootCache = copy);
}
const preview = (route, data) => buildPreview({ root: previewRoot(), route, data }).phone;

function device(routes) {
  const state = { who: userA, writes: [], privateReads: [], publicCalls: [], modal: null };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const method = options.method || 'GET';
      const k = method + ' ' + url;
      if (url === '/v1/auth/session')
        return ok(sessionOf(state.who), state.who === userA ? cookieA : cookieB);
      if (k === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(sessionOf(userB), cookieB);
      }
      if (url.startsWith('/v1/public/')) {
        state.publicCalls.push({ url, header: options.header });
        if (url === '/v1/public/events/' + key) return plain(publicEvent);
        if (url.startsWith('/v1/public/events/' + key + '/schedule'))
          return plain([], { nextCursor: null });
        if (url === '/v1/public/events/' + key + '/standings') return plain({ rows: [] });
      }
      if (url.startsWith('/v1/me/'))
        state.privateReads.push({ k, who: state.who, cookie: options.header.Cookie });
      if (method !== 'GET')
        state.writes.push({
          k,
          who: state.who,
          body: JSON.parse(JSON.stringify(options.data ?? null)),
        });
      const reply = routes(k, state);
      return reply || { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: k } } };
    },
  });
  wx.showModal = (o) => {
    state.modal = o;
  };
  return {
    wx,
    state,
    answer(confirm = true) {
      const m = state.modal;
      state.modal = null;
      m.success({ confirm, cancel: !confirm });
    },
    async open(route, query, { signIn = true } = {}) {
      const h = loadPage({ root, route, wx });
      const client = h.requireLocal('utils/api.js').getClient();
      if (signIn) await client.request('/v1/auth/session');
      h.page.onLoad(query);
      if (h.page.onShow) h.page.onShow();
      await h.flush();
      return { ...h, client };
    },
  };
}
async function change(p, kind) {
  if (kind === 'logout') p.client.clearSession();
  if (kind === 'switch')
    await p.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
  if (kind === 'unload') p.unload();
}
const lookupKey = 'GET /v1/me/follows/lookup?publicEventId=' + key;

// ---------- allowlist and reply validation ----------
test('follow paths are exact and own-account only', () => {
  for (const [url, method] of [
    ['/v1/me/follows', 'POST'],
    ['/v1/me/follows', 'GET'],
    ['/v1/me/follows?limit=20&cursor=abc_DEF-1', 'GET'],
    ['/v1/me/follows/lookup?publicEventId=' + key, 'GET'],
    ['/v1/me/follows/' + fid(1) + '/cancel', 'POST'],
  ])
    assert.equal(pathAllowed(url, method), true, method + ' ' + url);
  for (const [url, method] of [
    ['/v1/me/follows?limit=51', 'GET'],
    ['/v1/me/follows?userId=' + userB, 'GET'],
    ['/v1/me/follows?cursor=a.b', 'GET'],
    ['/v1/me/follows/lookup?publicEventId=short', 'GET'],
    ['/v1/me/follows/' + fid(1), 'GET'],
    ['/v1/me/follows/' + fid(1) + '/cancel', 'GET'],
    ['/v1/me/follows/not-a-uuid/cancel', 'POST'],
    ['/v1/users/' + userB + '/follows', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), false, method + ' ' + url);
});

test('follow replies are validated: withdrawn details and reminder claims are refused', () => {
  assert.equal(follows.follow(followData()).event.name, '合成冬季杯');
  assert.equal(follows.follow(invalidData()).event, null);
  for (const bad of [
    invalidData({ event: followData().event }),
    cancelledOf(followData()) && { ...cancelledOf(followData()), event: followData().event },
    { ...followData(), cancelledAt: '2026-10-28T02:00:00.000Z' },
    followData({ wechatReminder: 'ENABLED' }),
    followData({ wechatReminder: undefined }),
    followData({ publicEventId: 'short' }),
    followData({ followId: 'nope' }),
    followData({ status: 'SENT' }),
    followData({ event: { ...followData().event, purpose: 'PRIVATE' } }),
    followData({ event: null }),
  ])
    assert.throws(() => follows.follow(bad), /关注资料格式无效/);
  assert.match(follows.failure({ status: 404 }, 'follow'), /停止公开/);
  assert.match(follows.failure({ code: 'NETWORK_ERROR' }, 'follow'), /尚未确认/);
});

// ---------- event page ----------
test('signed out: the public page sends no cookie, asks nothing private and offers sign-in', async () => {
  const d = device(() => null);
  const p = await d.open('pages/event/index', { event: key }, { signIn: false });
  assert.equal(p.page.data.event.name, '合成冬季杯');
  assert.equal(p.page.data.follow.state, 'signedOut');
  assert.deepEqual(d.state.privateReads, []);
  assert.ok(d.state.publicCalls.length >= 3);
  for (const call of d.state.publicCalls)
    assert.equal(
      Object.keys(call.header).some((k) => k.toLowerCase() === 'cookie'),
      false,
    );
  const phone = preview('pages/event/index', p.page.data);
  assert.match(phone, /登录后关注/);
  assert.match(phone, /微信提醒未启用/);
  await p.page.followEvent();
  assert.deepEqual(d.state.writes, []);
  const nav = d.wx.calls.filter((c) => c.type === 'navigateTo').at(-1);
  assert.equal(
    nav.url,
    '/pages/account/index?returnTo=' + encodeURIComponent('/pages/event/index?event=' + key),
  );
});

test('follow: confirm, re-check, one POST; success and reminder are stated separately', async () => {
  let followed = null;
  const d = device((k) => {
    if (k === lookupKey) return ok(followed);
    if (k === 'POST /v1/me/follows') return ok((followed = followData()), cookieA, {}, 201);
    return null;
  });
  const p = await d.open('pages/event/index', { event: key });
  assert.equal(p.page.data.follow.state, 'none');
  let phone = preview('pages/event/index', p.page.data);
  assert.match(phone, /关注此赛事/);
  const pending = p.page.followEvent();
  await ticks();
  assert.match(d.state.modal.content, /微信提醒未启用/);
  d.answer(true);
  await pending;
  await p.flush();
  assert.deepEqual(
    d.state.writes.map((w) => [w.k, w.body]),
    [['POST /v1/me/follows', { publicEventId: key }]],
  );
  assert.equal(p.page.data.follow.state, 'active');
  assert.equal(p.page.data.follow.followId, fid(1));
  phone = preview('pages/event/index', p.page.data);
  assert.match(phone, /关注成功/);
  assert.match(phone, /微信提醒未启用/);
  assert.doesNotMatch(phone, /提醒已启用|已订阅|已送达/);
  // Declining sends nothing.
  const cancelling = p.page.cancelFollow();
  await ticks();
  d.answer(false);
  await cancelling;
  assert.equal(d.state.writes.length, 1);
});

test('follow when the follow already exists needs no write; a 404 explains and writes nothing more', async () => {
  let existing = null;
  let reply = fail(404, 'RESOURCE_NOT_FOUND');
  const d = device((k) => {
    if (k === lookupKey) return ok(existing);
    if (k === 'POST /v1/me/follows') return reply;
    return null;
  });
  const p = await d.open('pages/event/index', { event: key });
  existing = followData(); // Followed from another device after this page read "none".
  const first = p.page.followEvent();
  await ticks();
  d.answer(true);
  await first;
  await p.flush();
  assert.equal(d.state.writes.length, 0, 'the preparation re-check found the follow');
  assert.equal(p.page.data.follow.state, 'active');
  existing = null;
  p.page.setData({ follow: { ...p.page.data.follow, state: 'none', followId: '' } });
  const second = p.page.followEvent();
  await ticks();
  d.answer(true);
  await second;
  await p.flush();
  assert.equal(d.state.writes.length, 1);
  assert.equal(p.page.data.follow.state, 'none');
  assert.match(p.page.data.follow.error, /停止公开/);
});

for (const kind of ['logout', 'switch', 'unload'])
  test('a late follow confirmation after ' + kind + ' sends zero writes', async () => {
    const d = device((k) => (k === lookupKey ? ok(null) : null));
    const p = await d.open('pages/event/index', { event: key });
    const pending = p.page.followEvent();
    await ticks();
    await change(p, kind);
    await ticks();
    d.answer(true);
    await pending;
    await ticks();
    assert.deepEqual(
      d.state.writes.filter((w) => w.k !== 'POST /v1/auth/login'),
      [],
    );
    if (kind !== 'unload') assert.notEqual(p.page.data.follow.busy, true);
  });

for (const kind of ['logout', 'switch', 'unload'])
  test('invalidating the async preparation (' + kind + ') sends zero writes', async () => {
    const slow = deferred();
    let reads = 0;
    const d = device((k) => {
      if (k === lookupKey) return ++reads === 2 ? slow.promise : ok(null);
      return null;
    });
    const p = await d.open('pages/event/index', { event: key });
    const pending = p.page.followEvent();
    await ticks();
    d.answer(true);
    await ticks();
    assert.equal(reads, 2, 'the preparation lookup is in flight');
    await change(p, kind);
    slow.resolve(ok(null));
    await pending;
    await ticks();
    assert.deepEqual(
      d.state.writes.filter((w) => w.k !== 'POST /v1/auth/login'),
      [],
    );
  });

test('a follow reply arriving after an account switch never shows as the new account', async () => {
  const slow = deferred();
  const d = device((k, state) => {
    if (k === lookupKey) return ok(null, state.who === userA ? cookieA : cookieB);
    if (k === 'POST /v1/me/follows') return slow.promise;
    return null;
  });
  const p = await d.open('pages/event/index', { event: key });
  const pending = p.page.followEvent();
  await ticks();
  d.answer(true);
  await ticks();
  assert.equal(d.state.writes.length, 1);
  await change(p, 'switch');
  await ticks();
  assert.equal(p.page.data.follow.state, 'none', 'B was looked up afresh');
  assert.equal(d.state.privateReads.at(-1).who, userB);
  slow.resolve(ok(followData(), cookieA, {}, 201));
  await pending;
  await p.flush();
  assert.equal(p.page.data.follow.state, 'none');
  assert.equal(p.page.data.follow.notice, '');
});

for (const kind of ['logout', 'switch', 'unload'])
  test(
    'a late cancel confirmation on the event page after ' + kind + ' sends zero writes',
    async () => {
      const d = device((k) => (k === lookupKey ? ok(followData()) : null));
      const p = await d.open('pages/event/index', { event: key });
      assert.equal(p.page.data.follow.state, 'active');
      const pending = p.page.cancelFollow();
      await ticks();
      await change(p, kind);
      await ticks();
      d.answer(true);
      await pending;
      await ticks();
      assert.deepEqual(
        d.state.writes.filter((w) => w.k !== 'POST /v1/auth/login'),
        [],
      );
    },
  );

test('event page cancel sends one POST and signing out clears the follow block at once', async () => {
  let current = followData();
  const d = device((k) => {
    if (k === lookupKey) return ok(current);
    if (k === 'POST /v1/me/follows/' + fid(1) + '/cancel') {
      const done = cancelledOf(current);
      current = null;
      return ok(done);
    }
    return null;
  });
  const p = await d.open('pages/event/index', { event: key });
  const pending = p.page.cancelFollow();
  await ticks();
  d.answer(true);
  await pending;
  await p.flush();
  assert.deepEqual(
    d.state.writes.map((w) => [w.k, w.body]),
    [['POST /v1/me/follows/' + fid(1) + '/cancel', {}]],
  );
  assert.equal(p.page.data.follow.state, 'none');
  current = followData();
  await p.page.checkFollow();
  assert.equal(p.page.data.follow.state, 'active');
  p.client.clearSession();
  await ticks();
  assert.equal(p.page.data.follow.state, 'signedOut');
  assert.equal(p.page.data.follow.followId, '');
  assert.equal(p.page.data.event.name, '合成冬季杯', 'public data stays');
});

// ---------- follows page ----------
const listKey = 'GET /v1/me/follows?limit=20';
test('my follows: signed out asks nothing; lists ACTIVE and INVALID without withdrawn details', async () => {
  const d = device((k) =>
    k === listKey ? ok([followData(), invalidData()], cookieA, { nextCursor: null }) : null,
  );
  const out = await d.open('pages/follows/index', {}, { signIn: false });
  assert.equal(out.page.data.loginRequired, true);
  assert.deepEqual(d.state.privateReads, []);
  assert.match(preview('pages/follows/index', out.page.data), /登录后查看我的关注/);

  const p = await d.open('pages/follows/index', {});
  assert.deepEqual(
    p.page.data.items.map((i) => [i.status, i.event && i.event.name]),
    [
      ['ACTIVE', '合成冬季杯'],
      ['INVALID', null],
    ],
  );
  const phone = preview('pages/follows/index', p.page.data);
  assert.match(phone, /关注中/);
  assert.match(phone, /已失效/);
  assert.match(phone, /公开赛事已停止公开/);
  assert.match(phone, /微信提醒未启用/);
  p.page.openEvent(tap({ id: otherKey }));
  assert.equal(d.wx.calls.filter((c) => c.type === 'navigateTo').length, 0, 'INVALID never opens');
  p.page.openEvent(tap({ id: key }));
  assert.equal(
    d.wx.calls.filter((c) => c.type === 'navigateTo').at(-1).url,
    '/pages/event/index?event=' + key,
  );
});

test('my follows: a server returning INVALID with details is refused, never rendered', async () => {
  const d = device((k) =>
    k === listKey
      ? ok([invalidData({ event: followData().event })], cookieA, { nextCursor: null })
      : null,
  );
  const p = await d.open('pages/follows/index', {});
  assert.deepEqual(p.page.data.items, []);
  assert.match(p.page.data.error, /格式无效/);
  assert.doesNotMatch(preview('pages/follows/index', p.page.data), /合成冬季杯/);
});

test('my follows pages: later failure keeps rows and retries the same cursor; a refresh clears loadingMore', async () => {
  let failMore = true;
  const pendings = [];
  const d = device((k) => {
    if (k === listKey) return ok([followData()], cookieA, { nextCursor: 'next_1' });
    if (k === listKey + '&cursor=next_1') {
      if (pendings.length) {
        const w = deferred();
        pendings.push(w);
        return w.promise;
      }
      return failMore
        ? fail(500, 'INTERNAL_ERROR')
        : ok([followData(), invalidData()], cookieA, { nextCursor: null });
    }
    return null;
  });
  const p = await d.open('pages/follows/index', {});
  await p.page.more();
  assert.equal(p.page.data.items.length, 1);
  assert.match(p.page.data.moreError, /已显示的 1 条保留/);
  assert.match(preview('pages/follows/index', p.page.data), /重试加载更多/);
  failMore = false;
  await p.page.more();
  assert.deepEqual(
    p.page.data.items.map((i) => i.followId),
    [fid(1), fid(2)],
    'shifted row shown once',
  );
  assert.equal(p.page.data.nextCursor, null);
  // A refresh while a later page is pending: loadingMore resets and the late page is dropped.
  p.page.load();
  await p.flush();
  pendings.push(deferred()); // Marker: the next cursor read hangs.
  const hanging = p.page.more();
  await ticks();
  assert.equal(p.page.data.loadingMore, true);
  p.page.load();
  await ticks();
  assert.equal(p.page.data.loadingMore, false);
  pendings.forEach((w) =>
    w.resolve(ok([invalidData({ followId: fid(9) })], cookieA, { nextCursor: null })),
  );
  await hanging;
  await p.flush();
  assert.ok(!p.page.data.items.some((i) => i.followId === fid(9)));
});

test('my follows: switching account clears the list immediately and shows only the new account', async () => {
  const slowB = deferred();
  const d = device((k, state) => {
    if (k === listKey)
      return state.who === userA
        ? ok([followData()], cookieA, { nextCursor: 'a_next' })
        : slowB.promise;
    return null;
  });
  const p = await d.open('pages/follows/index', {});
  assert.equal(p.page.data.items.length, 1);
  await change(p, 'switch');
  await ticks();
  assert.deepEqual(p.page.data.items, [], 'cleared before B is read');
  assert.equal(p.page.data.nextCursor, null, 'A cursor dropped');
  assert.doesNotMatch(preview('pages/follows/index', p.page.data), /合成冬季杯/);
  slowB.resolve(ok([invalidData()], cookieB, { nextCursor: null }));
  await p.flush();
  assert.deepEqual(
    p.page.data.items.map((i) => i.followId),
    [fid(2)],
  );
  const reads = d.state.privateReads.filter((r) => r.k === listKey);
  assert.deepEqual(
    reads.map((r) => [r.who, r.cookie]),
    [
      [userA, 'scb.sid=' + cookieA],
      [userB, 'scb.sid=' + cookieB],
    ],
  );
  p.client.clearSession();
  await ticks();
  assert.deepEqual(p.page.data.items, []);
  assert.equal(p.page.data.loginRequired, true);
});

test('my follows cancel: one POST removes the row; an INVALID follow can be cancelled', async () => {
  const d = device((k) => {
    if (k === listKey) return ok([followData(), invalidData()], cookieA, { nextCursor: null });
    if (k === 'POST /v1/me/follows/' + fid(2) + '/cancel') return ok(cancelledOf(invalidData()));
    return null;
  });
  const p = await d.open('pages/follows/index', {});
  const pending = p.page.cancel(tap({ id: fid(2) }));
  await ticks();
  assert.match(d.state.modal.content, /已失效/);
  d.answer(true);
  await pending;
  await p.flush();
  assert.deepEqual(
    d.state.writes.map((w) => [w.k, w.body]),
    [['POST /v1/me/follows/' + fid(2) + '/cancel', {}]],
  );
  assert.deepEqual(
    p.page.data.items.map((i) => i.followId),
    [fid(1)],
  );
  assert.equal(p.page.data.notice, '已取消关注。');
});

for (const kind of ['logout', 'switch', 'unload'])
  test('my follows: a late cancel confirmation after ' + kind + ' sends zero writes', async () => {
    const d = device((k, state) =>
      k === listKey
        ? ok(state.who === userA ? [followData()] : [], state.who === userA ? cookieA : cookieB, {
            nextCursor: null,
          })
        : null,
    );
    const p = await d.open('pages/follows/index', {});
    const pending = p.page.cancel(tap({ id: fid(1) }));
    await ticks();
    await change(p, kind);
    await ticks();
    d.answer(true);
    await pending;
    await ticks();
    assert.deepEqual(
      d.state.writes.filter((w) => w.k !== 'POST /v1/auth/login'),
      [],
    );
  });

test('my follows: a cancel reply after a switch never edits the new account list', async () => {
  const slow = deferred();
  const d = device((k, state) => {
    if (k === listKey)
      return state.who === userA
        ? ok([followData()], cookieA, { nextCursor: null })
        : ok([followData({ followId: fid(5) })], cookieB, { nextCursor: null });
    if (k === 'POST /v1/me/follows/' + fid(1) + '/cancel') return slow.promise;
    return null;
  });
  const p = await d.open('pages/follows/index', {});
  const pending = p.page.cancel(tap({ id: fid(1) }));
  await ticks();
  d.answer(true);
  await ticks();
  await change(p, 'switch');
  await ticks(30);
  slow.resolve(ok(cancelledOf(followData())));
  await pending;
  await p.flush();
  assert.deepEqual(
    p.page.data.items.map((i) => i.followId),
    [fid(5)],
  );
  assert.equal(p.page.data.notice, '登录身份已变化，已清空上一账号的关注。');
  assert.equal(p.page.data.busy, false);
});

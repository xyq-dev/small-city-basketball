const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathAllowed } = require('../utils/api');
const directory = require('../utils/directory');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

// C18 public event directory: anonymous browse on the events tab and explicit LIST/UNLIST on
// event-setup. Directory reads never carry or change the session; directory writes follow the
// C17 confirmation rules (zero writes after a late confirmation).
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const listingId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const evBase = '/v1/orgs/' + org + '/events/' + eventId;
const pid = (c) => c.repeat(43);
const ok = (data, cookie = cookieA, meta = {}) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c18', nextCursor: null, ...meta } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + statusCode } },
});
// A hostile or buggy directory reply clearing the cookie must not reach the session either.
const failClearing = (statusCode, code) => ({
  ...fail(statusCode, code),
  header: { 'set-cookie': 'scb.sid=; Path=/; Max-Age=0' },
});
const sessionOf = (id, organizations = []) => ({
  user: { id, email: id.slice(0, 4) + '@example.test', displayName: '合成账号' },
  organizations,
  teamContexts: [],
});
const ticks = async (n = 15) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const row = (c, name, over = {}) => ({
  publicEventId: pid(c),
  name,
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  venueName: '合成体育馆',
  status: 'RUNNING',
  purpose: 'LIVE',
  displayCity: '茂名',
  ...over,
});
const page = (rows, nextCursor = null) => ok(rows, 'z'.repeat(43), { nextCursor });

function device(routes, organizations = []) {
  const state = { who: userA, writes: [], modal: null, publicCalls: [] };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const method = options.method || 'GET';
      const key = method + ' ' + url;
      if (url === '/v1/auth/session')
        return ok(sessionOf(state.who, organizations), state.who === userA ? cookieA : cookieB);
      if (key === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(sessionOf(userB, organizations), cookieB);
      }
      if (url.startsWith('/v1/public/directory'))
        state.publicCalls.push({ url, header: options.header });
      if (method !== 'GET')
        state.writes.push({ key, body: JSON.parse(JSON.stringify(options.data ?? null)) });
      const reply = routes(key, state);
      return (
        reply || { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } }
      );
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
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

// ---------- allowlist ----------
test('directory paths: exact anonymous query and private role-checked commands only', () => {
  for (const [url, method] of [
    ['/v1/public/directory', 'GET'],
    ['/v1/public/directory?status=LIVE&limit=20', 'GET'],
    [
      '/v1/public/directory?status=HISTORY&limit=50&city=%E8%8C%82%E5%90%8D&cursor=abc_DEF-1',
      'GET',
    ],
    [evBase + '/directory', 'GET'],
    [evBase + '/directory-commands', 'POST'],
  ])
    assert.equal(pathAllowed(url, method), true, method + ' ' + url);
  for (const [url, method] of [
    ['/v1/public/directory', 'POST'],
    ['/v1/public/directory?status=ALL', 'GET'],
    ['/v1/public/directory?limit=51', 'GET'],
    ['/v1/public/directory?limit=0', 'GET'],
    ['/v1/public/directory?orgId=' + org, 'GET'],
    ['/v1/public/directory?status=LIVE&status=HISTORY', 'GET'],
    ['/v1/public/directory?cursor=a.b', 'GET'],
    ['/v1/public/directory/extra', 'GET'],
    [evBase + '/directory', 'POST'],
    [evBase + '/directory?x=1', 'GET'],
    [evBase + '/directory-commands', 'GET'],
    ['/v1/orgs/not-a-uuid/events/' + eventId + '/directory', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), false, method + ' ' + url);
});

test('directory client helpers normalize cities like the server and reject unknown fields', async () => {
  assert.equal(directory.normalizeCity('  茂名  '), '茂名');
  assert.equal(directory.normalizeCity('Mao　Ming'), 'Mao Ming');
  assert.equal(directory.normalizeCity('   '), null);
  assert.equal(directory.normalizeCity('茂名!'), undefined);
  assert.equal(directory.normalizeCity('城'.repeat(21)), undefined);
  const fake = (data) => ({ requestPublic: async () => ({ data, meta: { nextCursor: null } }) });
  await assert.rejects(directory.fetchPage(fake([{ ...row('a', 'x'), orgId: org }]), {}));
  await assert.rejects(
    directory.fetchPage(fake([{ ...row('a', 'x'), publicEventId: 'short' }]), {}),
  );
  const ok1 = await directory.fetchPage(fake([row('a', '合成杯')]), { group: 'LIVE' });
  assert.equal(ok1.items[0].publicEventId, pid('a'));
  assert.deepEqual(
    directory.merge(ok1.items, [{ publicEventId: pid('a') }, { publicEventId: pid('b') }]).length,
    2,
  );
});

// ---------- watch: anonymous browse ----------
test('directory reads send no cookie and never change or clear the signed-in session', async () => {
  const d = device((key) => {
    if (key === 'GET /v1/public/directory?status=LIVE&limit=20')
      return page([row('a', '合成冬季杯')]);
    if (key === 'GET /v1/public/directory?status=UPCOMING&limit=20')
      return failClearing(401, 'UNAUTHENTICATED');
    return null;
  });
  const p = await d.open('pages/watch/index', {});
  assert.equal(p.client.hasSession(), true);
  const revision = p.client.sessionRevision();
  assert.deepEqual(
    p.page.data.dir.items.map((e) => e.name),
    ['合成冬季杯'],
  );
  p.page.pickDirGroup(tap({ group: 'UPCOMING' }));
  await p.flush();
  assert.match(p.page.data.dir.error, /合成错误 401/);
  assert.equal(d.state.publicCalls.length, 2);
  for (const call of d.state.publicCalls)
    assert.equal(
      Object.keys(call.header).some((k) => k.toLowerCase() === 'cookie'),
      false,
      'no cookie on ' + call.url,
    );
  assert.equal(p.client.hasSession(), true, 'a 401 or Set-Cookie on the directory never signs out');
  assert.equal(p.client.sessionRevision(), revision);
  // The next private request still carries the original cookie, not the directory reply's.
  await p.client.request('/v1/auth/session');
  const last = d.wx.calls.filter((c) => c.type === 'request').at(-1);
  assert.equal(last.header.Cookie, 'scb.sid=' + cookieA);
});

test('signed-out viewers can browse; empty groups and city filters say so', async () => {
  const d = device((key) => {
    if (key === 'GET /v1/public/directory?status=LIVE&limit=20') return page([]);
    if (
      key ===
      'GET /v1/public/directory?status=HISTORY&limit=20&city=' + encodeURIComponent('茂名')
    )
      return page([row('h', '合成春季联赛', { status: 'COMPLETED', purpose: 'HISTORY' })]);
    return null;
  });
  const p = await d.open('pages/watch/index', {}, { signIn: false });
  assert.equal(p.page.data.dir.loaded, true);
  assert.deepEqual(p.page.data.dir.items, []);
  let preview = buildPreview({ root, route: 'pages/watch/index', data: p.page.data });
  assert.match(preview.phone, /暂无主办方公开的进行中赛事/);
  p.page.dirCityInput(tap({}, { value: '茂名!' }));
  p.page.applyDirCity();
  assert.match(p.page.data.dir.cityError, /城市仅支持/);
  assert.equal(d.state.publicCalls.length, 1, 'an invalid city sends nothing');
  p.page.pickDirGroup(tap({ group: 'HISTORY' }));
  await p.flush();
  p.page.dirCityInput(tap({}, { value: ' 茂名 ' }));
  p.page.applyDirCity();
  await p.flush();
  assert.equal(p.page.data.dir.city, '茂名');
  assert.deepEqual(
    p.page.data.dir.items.map((e) => [e.name, e.group, e.displayCity]),
    [['合成春季联赛', 'finished', '茂名']],
  );
  preview = buildPreview({ root, route: 'pages/watch/index', data: p.page.data });
  assert.match(preview.phone, /合成春季联赛/);
  assert.match(preview.phone, /历史赛事/);
  p.page.openDirectory(tap({ id: pid('h') }));
  assert.ok(
    d.wx.calls.some(
      (c) => c.type === 'navigateTo' && c.url === '/pages/event/index?event=' + pid('h'),
    ),
  );
  p.page.openDirectory(tap({ id: '../../x' }));
  assert.equal(d.wx.calls.filter((c) => c.type === 'navigateTo').length, 1, 'bad ids never open');
});

test('a failed later page keeps the rows already read and retries the same cursor', async () => {
  let failMore = true;
  const d = device((key) => {
    if (key === 'GET /v1/public/directory?status=LIVE&limit=20')
      return page([row('a', '第一届'), row('b', '第二届')], 'next_1');
    if (key === 'GET /v1/public/directory?status=LIVE&limit=20&cursor=next_1')
      return failMore
        ? fail(500, 'INTERNAL_ERROR')
        : page([row('b', '第二届'), row('c', '第三届')]);
    return null;
  });
  const p = await d.open('pages/watch/index', {}, { signIn: false });
  assert.equal(p.page.data.dir.done, false);
  await p.page.loadMoreDirectory();
  assert.deepEqual(
    p.page.data.dir.items.map((e) => e.name),
    ['第一届', '第二届'],
  );
  assert.match(p.page.data.dir.moreError, /已显示的 2 届保留/);
  let preview = buildPreview({ root, route: 'pages/watch/index', data: p.page.data });
  assert.match(preview.phone, /重试加载更多/);
  failMore = false;
  await p.page.loadMoreDirectory();
  assert.deepEqual(
    p.page.data.dir.items.map((e) => e.name),
    ['第一届', '第二届', '第三届'],
    'a row shifted between pages is shown once',
  );
  assert.equal(p.page.data.dir.done, true);
  assert.equal(p.page.data.dir.moreError, '');
  preview = buildPreview({ root, route: 'pages/watch/index', data: p.page.data });
  assert.doesNotMatch(preview.phone, /加载更多/);
});

test('a slow reply for an older filter never overwrites the newer one', async () => {
  const slow = deferred();
  const d = device((key) => {
    if (key === 'GET /v1/public/directory?status=LIVE&limit=20') return slow.promise;
    if (key === 'GET /v1/public/directory?status=UPCOMING&limit=20')
      return page([row('u', '即将开赛', { status: 'SCHEDULED' })]);
    return null;
  });
  const h = loadPage({ root, route: 'pages/watch/index', wx: d.wx });
  h.page.onLoad({});
  h.page.onShow();
  await ticks();
  assert.equal(h.page.data.dir.loading, true);
  // The tab is disabled while loading, but a city change or re-entry can still reset it.
  h.page.setData({ 'dir.group': 'UPCOMING' });
  h.page.loadDirectory();
  await ticks();
  slow.resolve(page([row('a', '旧筛选结果')], 'old_cursor'));
  await h.flush();
  assert.deepEqual(
    h.page.data.dir.items.map((e) => e.name),
    ['即将开赛'],
  );
  assert.equal(h.page.data.dir.done, true, 'the stale cursor was not adopted');
});

test('a refresh clears old rows first and a failed refresh never shows them as current', async () => {
  let listed = true;
  const d = device((key) => {
    if (key === 'GET /v1/public/directory?status=LIVE&limit=20')
      return listed ? page([row('a', '已撤出的赛事')]) : fail(503, 'SERVICE_UNAVAILABLE');
    return null;
  });
  const p = await d.open('pages/watch/index', {}, { signIn: false });
  assert.equal(p.page.data.dir.items.length, 1);
  listed = false;
  p.page.onShow();
  await p.flush();
  assert.deepEqual(p.page.data.dir.items, []);
  assert.match(p.page.data.dir.error, /合成错误 503/);
  const preview = buildPreview({ root, route: 'pages/watch/index', data: p.page.data });
  assert.doesNotMatch(preview.phone, /已撤出的赛事/);
  assert.match(preview.phone, /公开赛事暂时无法读取/);
  assert.match(preview.phone, /重新读取/);
});

test('rate limiting and stale cursors explain themselves', () => {
  assert.match(directory.failure({ status: 429, code: 'RATE_LIMITED' }), /过于频繁/);
  assert.match(directory.failure({ status: 400, code: 'INVALID_CURSOR' }), /分页已变化/);
});

// ---------- event-setup: explicit LIST / UNLIST ----------
function setupRoutes(over = {}) {
  return (key, state) => {
    const listed = state.listed === true;
    if (key === 'GET ' + evBase)
      return ok({
        id: eventId,
        name: '合成赛事',
        startDate: '2028-03-01',
        endDate: '2028-03-02',
        venueName: '合成馆',
        format: 'ROUND_ROBIN',
        status: 'SCHEDULED',
        version: state.eventVersion || 4,
        permissions: { canEditDraft: false },
      });
    if (key === 'GET ' + evBase + '/registration')
      return ok({ rules: null, capabilities: { canManageRules: false } });
    if (key === 'GET ' + evBase + '/scoring')
      return ok({ rules: null, locked: false, capabilities: { canManageRules: false } });
    if (key === 'GET ' + evBase + '/standings')
      return ok({
        rules: null,
        locked: true,
        publication: { publicEventId: pid('p'), status: 'ACTIVE', purpose: 'LIVE' },
        capabilities: {
          canManageRules: false,
          canPublishRules: false,
          canEnablePublicViewing: false,
          canDisablePublicViewing: true,
        },
      });
    if (key === 'GET ' + evBase + '/directory')
      return ok({
        event: { id: eventId, status: 'SCHEDULED', version: state.eventVersion || 4 },
        publication: {
          publicEventId: state.publicEventId || pid('p'),
          purpose: 'LIVE',
          status: 'ACTIVE',
        },
        listing: listed
          ? {
              id: listingId,
              status: 'ACTIVE',
              publicEventId: pid('p'),
              displayCity: '茂名',
              listedAt: '2026-10-28T01:00:00Z',
              revokedAt: null,
              revokeSource: null,
            }
          : null,
        lastListing: state.lastListing || null,
        group: 'UPCOMING',
        capabilities: { canList: !listed, canUnlist: listed },
      });
    if (over[key]) return over[key](state);
    if (key === 'POST ' + evBase + '/directory-commands') {
      state.listed = !listed;
      state.eventVersion = (state.eventVersion || 4) + 1;
      return ok({ ok: true });
    }
    return null;
  };
}
const owner = [{ id: org, name: '合成机构', role: 'ORG_OWNER' }];
async function setup(over, init = {}) {
  const d = device(setupRoutes(over), owner);
  Object.assign(d.state, init);
  const p = await d.open('pages/event-setup/index', { orgId: org, eventId });
  return { d, p };
}
async function change(p, kind) {
  if (kind === 'logout') p.client.clearSession();
  if (kind === 'switch')
    await p.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
  if (kind === 'unload') p.unload();
}
const entries = [
  {
    name: 'LIST',
    init: {},
    start: (p) => {
      p.page.directoryCityInput(tap({}, { value: ' 茂名 ' }));
      p.page.directoryReasonInput(tap({}, { value: '赛程已发布，欢迎观众关注' }));
      return p.page.listDirectory();
    },
  },
  {
    name: 'UNLIST',
    init: { listed: true },
    start: (p) => {
      p.page.directoryReasonInput(tap({}, { value: '赛事信息需更新后再列入' }));
      return p.page.unlistDirectory();
    },
  },
];

test('event-setup shows the directory card and never lists on its own', async () => {
  const { d, p } = await setup({}, { lastListing: { revokeSource: 'PUBLICATION_REVOKED' } });
  const preview = buildPreview({ root, route: 'pages/event-setup/index', data: p.page.data });
  assert.match(preview.phone, /公开赛事目录/);
  assert.match(preview.phone, /未列入/);
  assert.match(preview.phone, /开启公开观赛不会自动列入目录/);
  assert.match(preview.phone, /目录已自动撤出/);
  assert.match(preview.phone, /列入公开目录/);
  assert.deepEqual(d.state.writes, []);
});

test('event-setup LIST validates locally before any confirmation', async () => {
  const { d, p } = await setup();
  p.page.directoryReasonInput(tap({}, { value: '短' }));
  await p.page.listDirectory();
  assert.match(p.page.data.error, /4–500字/);
  p.page.directoryReasonInput(tap({}, { value: '赛程已发布' }));
  p.page.directoryCityInput(tap({}, { value: '茂名<script>' }));
  await p.page.listDirectory();
  assert.match(p.page.data.error, /城市仅支持/);
  assert.equal(d.state.modal, null);
  assert.deepEqual(d.state.writes, []);
});

for (const entry of entries) {
  for (const kind of ['switch', 'logout', 'unload'])
    test('event-setup ' + entry.name + '：确认等待期间' + kind + '，不发送任何写请求', async () => {
      const { d, p } = await setup({}, entry.init);
      const pending = entry.start(p);
      await ticks();
      assert.ok(d.state.modal, 'confirmation opened');
      await change(p, kind);
      d.answer(true);
      await pending;
      await ticks();
      assert.deepEqual(d.state.writes, [], kind);
    });

  test('event-setup ' + entry.name + '：确认期间版本或公开授权变化，不发送', async () => {
    for (const target of [
      (s) => (s.eventVersion = 9),
      (s) => (s.publicEventId = pid('q')),
      (s) => (s.listed = !s.listed),
    ]) {
      const { d, p } = await setup({}, entry.init);
      const pending = entry.start(p);
      await ticks();
      target(d.state);
      await p.page.load();
      await ticks();
      d.answer(true);
      await pending;
      await ticks();
      assert.deepEqual(d.state.writes, []);
    }
  });

  test('event-setup ' + entry.name + '：取消不发送，确认只发送一次并固定版本', async () => {
    const { d, p } = await setup({}, entry.init);
    let pending = entry.start(p);
    await ticks();
    d.answer(false);
    await pending;
    assert.deepEqual(d.state.writes, []);
    pending = entry.start(p);
    await ticks();
    assert.match(
      d.state.modal.content,
      entry.name === 'LIST' ? /城市：茂名/ : /已分享的观赛链接仍可访问/,
    );
    d.answer(true);
    await pending;
    await p.flush();
    assert.equal(d.state.writes.length, 1);
    const { key, body } = d.state.writes[0];
    assert.equal(key, 'POST ' + evBase + '/directory-commands');
    assert.deepEqual(
      body,
      entry.name === 'LIST'
        ? {
            type: 'LIST',
            expectedEventVersion: 4,
            reason: '赛程已发布，欢迎观众关注',
            displayCity: '茂名',
          }
        : { type: 'UNLIST', expectedEventVersion: 4, reason: '赛事信息需更新后再列入' },
    );
    assert.equal(p.page.data.directory.listed, entry.name === 'LIST', 're-read after the write');
    assert.match(p.page.data.notice, entry.name === 'LIST' ? /已列入/ : /分享链接仍有效/);
  });
}

test('event-setup: a 409 re-reads and keeps the reason; an unknown result asks to re-read', async () => {
  let reply = (s) => {
    s.listed = true;
    return fail(409, 'DIRECTORY_ALREADY_LISTED');
  };
  const { d, p } = await setup({ ['POST ' + evBase + '/directory-commands']: (s) => reply(s) });
  let pending = entries[0].start(p);
  await ticks();
  d.answer(true);
  await pending;
  await p.flush();
  assert.match(p.page.data.error, /已在公开目录中，已重新读取/);
  assert.equal(p.page.data.directory.listed, true);
  assert.equal(p.page.data.directory.canUnlist, true);

  reply = () => Promise.reject(new Error('network down'));
  d.state.listed = true;
  p.page.directoryReasonInput(tap({}, { value: '赛事信息需更新后再列入' }));
  pending = p.page.unlistDirectory();
  await ticks();
  d.answer(true);
  await pending;
  await p.flush();
  assert.match(p.page.data.error, /目录操作结果未知/);
  assert.equal(p.page.data.busy, false);
});

test('event-setup clears the cached directory state when the account changes', async () => {
  const { d, p } = await setup();
  assert.ok(p.page._directory);
  await change(p, 'switch');
  await ticks();
  assert.equal(p.page._directory, null);
  assert.equal(p.page.data.directory, null);
  await p.page.listDirectory();
  assert.equal(d.state.modal, null);
  assert.deepEqual(d.state.writes, []);
});

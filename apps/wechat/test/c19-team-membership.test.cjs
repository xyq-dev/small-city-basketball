const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathAllowed } = require('../utils/api');
const tmUtil = require('../utils/team-membership');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');

// C19 team requests / join codes / bindings / claims on the mini program: real page code in the
// VM harness against synthetic replies. Asserts the actual requests (paths and bodies), storage
// and page state for response loss, original-ID recovery, identity switch, unload and late
// confirmations. Real-API coverage is tests/wechat-api/c19-teams.test.mjs.
const org = '11111111-1111-4111-8111-111111111111';
const teamId = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const bindingId = '77777777-7777-4777-8777-777777777777';
const memberId = '88888888-8888-4888-8888-888888888888';
const claimId = '99999999-9999-4999-8999-999999999999';
const codeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const TOKEN = 'Tok_en-1234567890abcdE';
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const now = '2026-10-28T08:00:00.000Z';
const later = '2026-11-04T08:00:00.000Z';
const ok = (data, cookie = cookieA, status = 200) => ({
  statusCode: status,
  data: { data, meta: { requestId: 'synthetic-c19' } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code, message = '合成错误') => ({
  statusCode,
  data: { error: { code, message } },
});
const LOST = Symbol('lost');
const sessionOf = (id, organizations = []) => ({
  user: { id, email: 'private@example.test', displayName: id === userA ? '合成甲' : '合成乙' },
  organizations,
  teamContexts: [],
});
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const myRequest = (clientRequestId, over = {}) => ({
  id: requestId,
  clientRequestId,
  orgId: org,
  orgName: '合成机构',
  teamName: '合成青锋',
  note: null,
  status: 'PENDING',
  version: 1,
  reviewReason: null,
  reviewedAt: null,
  withdrawnAt: null,
  teamId: null,
  createdAt: now,
  updatedAt: now,
  capabilities: { canWithdraw: true },
  ...over,
});
const membership = (over = {}) => ({
  bindingId,
  orgId: org,
  organizationName: '合成机构',
  teamId,
  teamName: '合成青锋',
  memberId,
  memberName: '合成球员',
  source: 'JOIN_CODE',
  status: 'ACTIVE',
  endedReason: null,
  createdAt: now,
  endedAt: null,
  ...over,
});

function device(routes, { organizations = [], storage } = {}) {
  const state = { who: userA, writes: [], modal: null };
  const wx = createWx({
    storage,
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
      if (method !== 'GET')
        state.writes.push({ key, body: JSON.parse(JSON.stringify(options.data ?? null)) });
      const reply = routes(key, state, options);
      if (reply === LOST) throw new Error('response lost');
      return reply || fail(404, 'TEST_UNHANDLED', key);
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
    async open(route, query) {
      const h = loadPage({ root, route, wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad(query);
      h.page.onShow?.();
      await h.flush();
      return { ...h, client };
    },
  };
}
const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
// Answer the modal as soon as it opens, then wait for the write to settle.
async function confirmNow(d, h, action, confirm = true) {
  const done = action();
  for (let i = 0; i < 50 && !d.state.modal; i++) await ticks(1);
  assert.ok(d.state.modal, 'a confirmation was shown');
  d.answer(confirm);
  await done;
  await h.flush();
}

// ---------- allowlist and helpers ----------
test('C19 team routes pass the allowlist exactly; other shapes are refused', () => {
  const o = '/v1/orgs/' + org;
  const t = o + '/teams/' + teamId;
  for (const [url, method] of [
    [o + '/team-request-links', 'GET'],
    [o + '/team-request-links', 'POST'],
    [o + '/team-request-links/' + linkId + '/revoke', 'POST'],
    [o + '/team-requests?status=PENDING', 'GET'],
    [o + '/team-requests/' + requestId + '/review', 'POST'],
    ['/v1/team-request-links/resolve', 'POST'],
    ['/v1/team-requests', 'POST'],
    ['/v1/team-joins', 'POST'],
    ['/v1/me/team-requests', 'GET'],
    ['/v1/me/team-requests/' + requestId + '/withdraw', 'POST'],
    ['/v1/me/memberships', 'GET'],
    ['/v1/me/memberships/' + bindingId + '/team', 'GET'],
    ['/v1/me/memberships/' + bindingId + '/leave', 'POST'],
    ['/v1/me/member-claims', 'GET'],
    ['/v1/me/member-claims/' + claimId + '/accept', 'POST'],
    [t + '/join-codes', 'POST'],
    [t + '/join-codes/' + codeId + '/revoke', 'POST'],
    [t + '/member-bindings', 'GET'],
    [t + '/member-bindings/' + bindingId + '/remove', 'POST'],
    [t + '/members/' + memberId + '/claims', 'POST'],
    [t + '/member-claims/' + claimId + '/revoke', 'POST'],
  ])
    assert.equal(pathAllowed(url, method), true, method + ' ' + url);
  for (const [url, method] of [
    [o + '/team-requests?status=ALL', 'GET'],
    [o + '/team-request-links?orgId=' + org, 'GET'],
    ['/v1/team-requests?orgId=' + org, 'POST'],
    ['/v1/me/memberships', 'POST'],
    ['/v1/me/memberships/' + bindingId + '/leave', 'GET'],
    [t + '/member-bindings', 'POST'],
  ])
    assert.equal(pathAllowed(url, method), false, method + ' ' + url);
});

test('join codes normalize like the server; responses carrying identities are refused', async () => {
  assert.equal(tmUtil.normalizeJoinCode(' abcd-efgh ijkl mnop qrst uvwx yz '), CODE);
  assert.equal(tmUtil.formatJoinCode(CODE), 'ABCD EFGH IJKL MNOP QRST UVWX YZ');
  assert.throws(() => tmUtil.normalizeJoinCode(CODE.slice(1)));
  assert.throws(() => tmUtil.normalizeJoinCode(CODE.slice(0, 25) + '1'));
  assert.equal(tmUtil.sharePath(TOKEN), '/pages/team-request/index?token=' + TOKEN);
  assert.throws(() => tmUtil.sharePath('../x'));
  const roster = {
    teamId,
    teamName: '合成青锋',
    bindings: [
      {
        bindingId,
        memberId,
        memberName: '甲',
        accountDisplayName: '合成甲',
        source: 'JOIN_CODE',
        status: 'ACTIVE',
        endedReason: null,
        createdAt: now,
        endedAt: null,
      },
    ],
    claims: [],
    claimableMembers: [],
  };
  const client = (data) => ({ request: async () => ({ data }) });
  assert.equal(
    (await tmUtil.createRepository(client(roster)).bindings(org, teamId)).bindings.length,
    1,
  );
  for (const leak of [{ email: 'x@example.test' }, { userId: userA }])
    await assert.rejects(
      tmUtil
        .createRepository(client({ ...roster, bindings: [{ ...roster.bindings[0], ...leak }] }))
        .bindings(org, teamId),
      /不完整/,
    );
});

// ---------- applicant ----------
function applicantRoutes(opts = {}) {
  let posts = 0;
  return (key, state) => {
    if (key === 'POST /v1/team-request-links/resolve')
      return ok({ linkId, orgName: '合成机构', expiresAt: later });
    if (key === 'GET /v1/me/team-requests')
      return ok(state.server ? [state.server] : [], state.who === userA ? cookieA : cookieB);
    if (key === 'POST /v1/team-requests') {
      posts++;
      const body = state.writes.at(-1).body;
      state.server = state.server || myRequest(body.clientRequestId, { teamName: body.teamName });
      if (opts.loseFirst && posts === 1) return LOST;
      return ok(state.server, cookieA, posts === 1 ? 201 : 200);
    }
    if (key === 'POST /v1/me/team-requests/' + requestId + '/withdraw')
      return ok({
        ...state.server,
        status: 'WITHDRAWN',
        version: 2,
        capabilities: { canWithdraw: false },
      });
    return null;
  };
}

test('a lost submission is recovered with the original clientRequestId and no token is stored', async () => {
  const d = device(applicantRoutes({ loseFirst: true }));
  const h = await d.open('pages/team-request/index', { token: TOKEN });
  assert.equal(h.page.data.link.orgName, '合成机构');
  assert.equal(JSON.stringify(h.page.data).includes(TOKEN), false, 'token never enters page data');
  h.page.input(tap({ field: 'teamName' }, { value: ' 合成青锋 ' }));
  await confirmNow(d, h, () => h.page.submit());
  assert.equal(h.page.data.uncertain, true);
  assert.ok(h.page.data.pending, 'the unresolved submission stays visible');
  const stored = d.wx.storage.get(tmUtil.PENDING_KEY);
  const firstPost = d.state.writes.find((w) => w.key === 'POST /v1/team-requests');
  assert.equal(stored[userA].clientRequestId, firstPost.body.clientRequestId);
  assert.equal(JSON.stringify(stored).includes(TOKEN), false, 'the share token is never stored');
  // Recovery resends the same id and content; the server answers with the original request.
  await confirmNow(d, h, () => h.page.recover());
  const posts = d.state.writes.filter((w) => w.key === 'POST /v1/team-requests');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1].body, posts[0].body);
  assert.deepEqual(posts[0].body, {
    token: TOKEN,
    clientRequestId: posts[0].body.clientRequestId,
    teamName: '合成青锋',
  });
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page.data.requests.length, 1);
  assert.equal(d.wx.storage.get(tmUtil.PENDING_KEY)[userA], undefined);
});

test('reopening after a lost reply finds the request by its original id without resending', async () => {
  const storage = new Map();
  const d = device(applicantRoutes({ loseFirst: true }), { storage });
  const h = await d.open('pages/team-request/index', { token: TOKEN });
  h.page.input(tap({ field: 'teamName' }, { value: '合成青锋' }));
  await confirmNow(d, h, () => h.page.submit());
  h.unload();
  // A new page instance (no token in the query) reconciles from "my requests".
  const again = await d.open('pages/team-request/index', {});
  assert.equal(again.page.data.pending, null);
  assert.match(again.page.data.message, /上次提交已由服务器确认/);
  assert.equal(d.state.writes.filter((w) => w.key === 'POST /v1/team-requests').length, 1);
});

test('no durable request id means no submission', async () => {
  const d = device(applicantRoutes());
  d.wx.setStorageSync = () => {
    throw new Error('quota');
  };
  const h = await d.open('pages/team-request/index', { token: TOKEN });
  h.page.input(tap({ field: 'teamName' }, { value: '合成青锋' }));
  await h.page.submit();
  await h.flush();
  assert.match(h.page.data.error, /无法在本机保存请求编号/);
  assert.equal(d.state.modal, null);
  assert.equal(d.state.writes.filter((w) => w.key === 'POST /v1/team-requests').length, 0);
});

test('identity switch or unload while confirming sends nothing', async () => {
  const d = device(applicantRoutes());
  const h = await d.open('pages/team-request/index', { token: TOKEN });
  h.page.input(tap({ field: 'teamName' }, { value: '合成青锋' }));
  const pending = h.page.submit();
  await ticks();
  assert.ok(d.state.modal);
  await h.client.request('/v1/auth/login', 'POST', { email: 'b@example.test', password: 'x' });
  d.answer(true);
  await pending;
  await h.flush();
  assert.equal(d.state.writes.filter((w) => w.key === 'POST /v1/team-requests').length, 0);
  assert.equal(h.page.data.requests.length, 0);
  // Unload during a withdraw confirmation.
  const d2 = device(applicantRoutes());
  d2.state.server = myRequest('0b4c8b1e-6f1a-4c2d-9e3f-1a2b3c4d5e6f');
  const h2 = await d2.open('pages/team-request/index', {});
  const withdraw = h2.page.withdraw(tap({ id: requestId }));
  await ticks();
  h2.unload();
  d2.answer(true);
  await withdraw;
  assert.equal(d2.state.writes.length, 0);
});

// ---------- organization admin ----------
test('admin: share token shown once, never stored, cleared on hide; review sends CAS version', async () => {
  const link = {
    id: linkId,
    orgId: org,
    status: 'ACTIVE',
    reason: '合成联赛建队',
    maxUses: 20,
    useCount: 0,
    expiresAt: later,
    createdAt: now,
    revokedAt: null,
    revokeReason: null,
  };
  const orgRequest = {
    ...myRequest('x'),
    requesterDisplayName: '合成乙',
    capabilities: { canReview: true, isOwnRequest: false },
  };
  delete orgRequest.clientRequestId;
  const d = device(
    (key, state) => {
      if (key === 'GET /v1/orgs/' + org + '/team-request-links') return ok([]);
      if (key === 'GET /v1/orgs/' + org + '/team-requests?status=PENDING') return ok([orgRequest]);
      if (key === 'POST /v1/orgs/' + org + '/team-request-links')
        return ok({ link, token: TOKEN }, cookieA, 201);
      if (key === 'POST /v1/orgs/' + org + '/team-requests/' + requestId + '/review')
        return ok({
          ...orgRequest,
          status: 'APPROVED',
          teamId,
          version: 2,
          capabilities: { canReview: false, isOwnRequest: false },
        });
      return null;
    },
    { organizations: [{ id: org, name: '合成机构', role: 'ORG_ADMIN' }] },
  );
  const h = await d.open('pages/team-requests/index', { orgId: org });
  assert.equal(h.page.data.allowed, true);
  h.page.input(tap({ field: 'linkReason' }, { value: '合成联赛建队' }));
  await confirmNow(d, h, () => h.page.createLink());
  assert.deepEqual(d.state.writes[0].body, {
    expiresInHours: 72,
    maxUses: 20,
    reason: '合成联赛建队',
  });
  assert.equal(h.page.data.issued.path, '/pages/team-request/index?token=' + TOKEN);
  assert.equal(h.page.onShareAppMessage().path, h.page.data.issued.path);
  for (const value of d.wx.storage.values())
    assert.equal(JSON.stringify(value).includes(TOKEN), false);
  h.page.onHide();
  assert.equal(h.page.data.issued, null);
  h.page.select(tap({ id: requestId }));
  h.page.input(tap({ field: 'reviewReason' }, { value: '资料核对无误' }));
  await confirmNow(d, h, () => h.page.review(tap({ decision: 'APPROVE' })));
  assert.deepEqual(d.state.writes.at(-1).body, {
    decision: 'APPROVE',
    reason: '资料核对无误',
    expectedVersion: 1,
  });
  assert.equal(h.page.data.requests[0].status, 'APPROVED');
  // A non-administrator never reads the organization's links or requests.
  const d2 = device(() => null, { organizations: [{ id: org, name: '合成机构', role: 'SCORER' }] });
  const h2 = await d2.open('pages/team-requests/index', { orgId: org });
  assert.equal(h2.page.data.allowed, false);
  assert.equal(
    d2.wx.calls.filter((c) => c.type === 'request' && /team-request/.test(c.url)).length,
    0,
  );
});

// ---------- player ----------
test('join: normalized code, uncertain reply retried with the same code; claims accept', async () => {
  let joins = 0;
  const claim = {
    claimId,
    organizationName: '合成机构',
    teamName: '合成青锋',
    memberName: '历史球员',
    status: 'PENDING',
    expiresAt: later,
    createdAt: now,
    decidedAt: null,
  };
  const d = device((key) => {
    if (key === 'GET /v1/me/member-claims') return ok([claim]);
    if (key === 'POST /v1/team-joins')
      return ++joins === 1 ? fail(503, 'UNAVAILABLE') : ok(membership());
    if (key === 'POST /v1/me/member-claims/' + claimId + '/accept')
      return ok({
        claim: { ...claim, status: 'ACCEPTED', decidedAt: now },
        membership: membership({ source: 'CLAIM', memberName: '历史球员' }),
      });
    return null;
  });
  const h = await d.open('pages/team-join/index', {});
  assert.equal(h.page.data.displayName, '合成甲');
  h.page.input(tap({ field: 'code' }, { value: 'abcd efgh-ijkl mnop qrst uvwx yz' }));
  await confirmNow(d, h, () => h.page.join());
  assert.equal(h.page.data.uncertain, true);
  assert.match(h.page.data.message, /不会重复加入/);
  await confirmNow(d, h, () => h.page.join());
  const posts = d.state.writes.filter((w) => w.key === 'POST /v1/team-joins');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, { code: CODE, displayName: '合成甲' });
  assert.deepEqual(posts[1].body, posts[0].body);
  assert.equal(h.page.data.joined.bindingId, bindingId);
  assert.equal(h.page.data.code, '', 'the code is cleared after a confirmed join');
  await confirmNow(d, h, () => h.page.decide(tap({ id: claimId, decision: 'accept' })));
  assert.equal(h.page.data.claims[0].status, 'ACCEPTED');
  assert.deepEqual(d.state.writes.at(-1), {
    key: 'POST /v1/me/member-claims/' + claimId + '/accept',
    body: {},
  });
});

test('memberships: read-only team view, leave posts once; a declined confirmation sends nothing', async () => {
  const d = device((key) => {
    if (key === 'GET /v1/me/memberships') return ok([membership()]);
    if (key === 'GET /v1/me/memberships/' + bindingId + '/team')
      return ok({
        bindingId,
        organizationName: '合成机构',
        teamName: '合成青锋',
        members: [{ memberId, name: '合成球员', isSelf: true }],
        myBinding: membership(),
      });
    if (key === 'POST /v1/me/memberships/' + bindingId + '/leave')
      return ok(membership({ status: 'ENDED', endedReason: 'LEFT', endedAt: now }));
    return null;
  });
  const h = await d.open('pages/memberships/index', {});
  await h.page.open(tap({ id: bindingId }));
  await h.flush();
  assert.deepEqual(h.page.data.team.members, [{ memberId, name: '合成球员', isSelf: true }]);
  await confirmNow(d, h, () => h.page.leave(tap({ id: bindingId })), false);
  assert.equal(d.state.writes.length, 0);
  await confirmNow(d, h, () => h.page.leave(tap({ id: bindingId })));
  assert.equal(d.state.writes.length, 1);
  assert.equal(h.page.data.items[0].stateText, '本人已退出');
});

// ---------- team page (leader) ----------
const teamDto = (canManage) => ({
  id: teamId,
  orgId: org,
  name: '合成青锋',
  version: 3,
  members: [{ id: memberId, name: '合成球员' }],
  grants: [],
  createdAt: now,
  updatedAt: now,
  capabilities: { canManage, canInvite: false },
});
test('team page: managers see join codes and bindings, issue a code shown once; others read nothing', async () => {
  const roster = {
    teamId,
    teamName: '合成青锋',
    bindings: [],
    claims: [],
    claimableMembers: [{ memberId, name: '合成球员' }],
  };
  const code = {
    id: codeId,
    teamId,
    status: 'ACTIVE',
    maxUses: 30,
    useCount: 0,
    expiresAt: later,
    createdAt: now,
    revokedAt: null,
    issuedByDisplayName: '合成甲',
  };
  const base = '/v1/orgs/' + org + '/teams/' + teamId;
  const d = device((key) => {
    if (key === 'GET ' + base) return ok(teamDto(true));
    if (key === 'GET ' + base + '/join-codes') return ok([]);
    if (key === 'GET ' + base + '/member-bindings') return ok(roster);
    if (key === 'POST ' + base + '/join-codes')
      return ok({ joinCode: code, code: CODE }, cookieA, 201);
    if (key === 'POST ' + base + '/members/' + memberId + '/claims')
      return ok(
        {
          claimId,
          memberId,
          memberName: '合成球员',
          targetDisplayName: '合成乙',
          status: 'PENDING',
          expiresAt: later,
          createdAt: now,
          decidedAt: null,
        },
        cookieA,
        201,
      );
    return null;
  });
  const h = await d.open('pages/team/index', { orgId: org, teamId });
  assert.deepEqual(h.page.data.roster.claimableMembers, [{ memberId, name: '合成球员' }]);
  await confirmNow(d, h, () => h.page.issueJoinCode());
  assert.equal(h.page.data.issuedCode, 'ABCD EFGH IJKL MNOP QRST UVWX YZ');
  h.page.onHide();
  assert.equal(h.page.data.issuedCode, '');
  h.page.pickClaimMember(tap({ id: memberId }));
  h.page.playerField(tap({ field: 'claimTarget' }, { value: ' ' + userB + ' ' }));
  await confirmNow(d, h, () => h.page.createClaim());
  assert.deepEqual(d.state.writes.at(-1), {
    key: 'POST ' + base + '/members/' + memberId + '/claims',
    body: { targetUserId: userB },
  });
  const d2 = device((key) => (key === 'GET ' + base ? ok(teamDto(false)) : null));
  const h2 = await d2.open('pages/team/index', { orgId: org, teamId });
  assert.equal(h2.page.data.roster, null);
  assert.equal(
    d2.wx.calls.filter((c) => c.type === 'request' && /join-codes|member-bindings/.test(c.url))
      .length,
    0,
  );
});

test('new pages: static WXML handlers exist and no literal page route escapes the module list', () => {
  for (const name of ['team-request', 'team-requests', 'team-join', 'memberships', 'team']) {
    const route = 'pages/' + name + '/index';
    const source = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
    const { page } = loadPage({ root, route });
    for (const handler of eventHandlers(parseWxml(source)))
      assert.equal(typeof page[handler], 'function', route + ': ' + handler);
  }
  // The existing team page keeps no literal route to the not-yet-registered pages.
  const teamScript = fs.readFileSync(path.join(root, 'pages/team/index.js'), 'utf8');
  assert.doesNotMatch(teamScript, /\/pages\/(team-join|team-request|memberships)/);
});

// Interrupted C19 review: async preparation and already-sent requests retain their original
// identity, target and durable recovery record, independent of later page state.
for (const change of ['switch', 'logout', 'unload']) {
  test('team submission waiting for UUID is abandoned after ' + change, async () => {
    const d = device(applicantRoutes());
    const h = await d.open('pages/team-request/index', { token: TOKEN });
    h.page.input(tap({ field: 'teamName' }, { value: '合成青锋' }));
    let random;
    d.wx.getRandomValues = (o) => {
      random = o;
    };
    const action = h.page.submit();
    await ticks();
    if (change === 'switch') {
      await h.client.request('/v1/auth/login', 'POST', { email: 'b@example.test', password: 'x' });
      await h.page.load();
    } else if (change === 'logout') h.client.clearSession();
    else h.unload();
    random.success({ randomValues: new Uint8Array(16).fill(4).buffer });
    let failure;
    const completion = action.catch((e) => {
      failure = e;
    });
    await ticks();
    const modal = d.state.modal;
    if (modal) d.answer(false);
    await completion;
    assert.equal(modal, null, 'stale preparation cannot open a new confirmation');
    assert.equal(failure, undefined, 'stale preparation exits without a page error');
    assert.equal(d.state.writes.filter((w) => w.key === 'POST /v1/team-requests').length, 0);
    assert.equal(d.wx.storage.get(tmUtil.PENDING_KEY), undefined);
  });
}

test('an already-sent team request keeps its original recovery ID after account switch', async () => {
  let resolveResponse;
  const routes = applicantRoutes();
  const d = device((key, state, options) =>
    key === 'POST /v1/team-requests'
      ? new Promise((resolve) => {
          resolveResponse = () => resolve(routes(key, state, options));
        })
      : routes(key, state, options),
  );
  const h = await d.open('pages/team-request/index', { token: TOKEN });
  h.page.input(tap({ field: 'teamName' }, { value: '合成青锋' }));
  const action = h.page.submit();
  await ticks();
  d.answer();
  await ticks();
  const id = d.wx.storage.get(tmUtil.PENDING_KEY)[userA].clientRequestId;
  await h.client.request('/v1/auth/login', 'POST', { email: 'b@example.test', password: 'x' });
  resolveResponse();
  await action;
  assert.equal(d.wx.storage.get(tmUtil.PENDING_KEY)[userA]?.clientRequestId, id);
  assert.equal(
    h.page.data.pending,
    null,
    'old identity recovery is not rendered to the new account',
  );
  assert.equal(d.state.writes.filter((w) => w.key === 'POST /v1/team-requests').length, 1);
});

test('changed request state during withdraw confirmation sends nothing', async () => {
  const d = device(applicantRoutes());
  d.state.server = myRequest('0b4c8b1e-6f1a-4c2d-9e3f-1a2b3c4d5e6f');
  const h = await d.open('pages/team-request/index', {});
  const action = h.page.withdraw(tap({ id: requestId }));
  await ticks();
  h.page.setData({
    requests: [
      {
        ...h.page.data.requests[0],
        version: 2,
        status: 'REJECTED',
        capabilities: { canWithdraw: false },
      },
    ],
  });
  d.answer();
  await action;
  assert.equal(d.state.writes.length, 0);
});

test('request storage cannot replace an unresolved original ID', () => {
  const wx = createWx();
  const first = { clientRequestId: '0b4c8b1e-6f1a-4c2d-9e3f-1a2b3c4d5e6f', teamName: '原申请' };
  const second = { clientRequestId: '1b4c8b1e-6f1a-4c2d-9e3f-1a2b3c4d5e6f', teamName: '另申请' };
  assert.equal(tmUtil.writePending(wx, userA, first), true);
  assert.equal(tmUtil.writePending(wx, userA, second), false);
  assert.equal(tmUtil.readPending(wx, userA).record.clientRequestId, first.clientRequestId);
});

test('approval confirmation does not send after the request version or review permission changes', async () => {
  const request = {
    ...myRequest('x'),
    requesterDisplayName: '合成乙',
    capabilities: { canReview: true, isOwnRequest: false },
  };
  delete request.clientRequestId;
  const d = device(
    (key) =>
      key === 'GET /v1/orgs/' + org + '/team-request-links'
        ? ok([])
        : key === 'GET /v1/orgs/' + org + '/team-requests?status=PENDING'
          ? ok([request])
          : null,
    { organizations: [{ id: org, name: '合成机构', role: 'ORG_ADMIN' }] },
  );
  const h = await d.open('pages/team-requests/index', { orgId: org });
  h.page.select(tap({ id: requestId }));
  h.page.input(tap({ field: 'reviewReason' }, { value: '资料核对无误' }));
  const action = h.page.review(tap({ decision: 'APPROVE' }));
  await ticks();
  h.page.setData({
    requests: [{ ...request, version: 2, capabilities: { canReview: false, isOwnRequest: false } }],
  });
  d.answer();
  await action;
  assert.equal(d.state.writes.length, 0);
});

for (const operation of ['claim', 'leave']) {
  test(operation + ' confirmation does not send after the current target ended', async () => {
    const claim = {
      claimId,
      organizationName: '合成机构',
      teamName: '合成青锋',
      memberName: '球员甲',
      status: 'PENDING',
      expiresAt: later,
      createdAt: now,
      decidedAt: null,
    };
    const d = device((key) =>
      key === 'GET /v1/me/member-claims'
        ? ok([claim])
        : key === 'GET /v1/me/memberships'
          ? ok([membership()])
          : null,
    );
    const h = await d.open(
      operation === 'claim' ? 'pages/team-join/index' : 'pages/memberships/index',
      {},
    );
    const action =
      operation === 'claim'
        ? h.page.decide(tap({ id: claimId, decision: 'accept' }))
        : h.page.leave(tap({ id: bindingId }));
    await ticks();
    if (operation === 'claim') h.page.setData({ claims: [{ ...claim, status: 'REVOKED' }] });
    else h.page.setData({ items: [membership({ status: 'ENDED', endedAt: now })] });
    d.answer();
    await action;
    assert.equal(d.state.writes.length, 0);
  });
}

test('team account management rechecks the team version before issuing a code', async () => {
  const base = '/v1/orgs/' + org + '/teams/' + teamId;
  const d = device((key) =>
    key === 'GET ' + base
      ? ok(teamDto(true))
      : key === 'GET ' + base + '/join-codes'
        ? ok([])
        : key === 'GET ' + base + '/member-bindings'
          ? ok({ teamId, teamName: '合成青锋', bindings: [], claims: [], claimableMembers: [] })
          : null,
  );
  const h = await d.open('pages/team/index', { orgId: org, teamId });
  const action = h.page.issueJoinCode();
  await ticks();
  h.page.apply({ ...teamDto(true), version: 4 });
  d.answer();
  await action;
  assert.equal(d.state.writes.length, 0);
});

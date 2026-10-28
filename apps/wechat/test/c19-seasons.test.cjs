const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathAllowed } = require('../utils/api');
const model = require('../utils/seasons');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
// The static preview helper only renders pages registered in app.json. Until the integrator
// registers these two routes, render them from a throwaway copy whose manifest lists them.
let previewRoot = null;
function preview(route, data) {
  if (!previewRoot) {
    previewRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scb-c19-seasons-'));
    process.on('exit', () => fs.rmSync(previewRoot, { recursive: true, force: true }));
    for (const name of ['app.js', 'app.json', 'app.wxss', 'components', 'pages', 'utils', 'assets'])
      fs.cpSync(path.join(root, name), path.join(previewRoot, name), { recursive: true });
    const file = path.join(previewRoot, 'app.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const page of ['pages/seasons/index', 'pages/season-grants/index'])
      if (!manifest.pages.includes(page)) manifest.pages.push(page);
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
  return buildPreview({ root: previewRoot, route, data });
}

// C19 private seasons (admin page) and PRIVATE_SEASON grants (organizer + player page). The
// real Page/utils code runs against an explicit wx double; every write is asserted by its
// actual request. Writes follow the C17 confirmation rules: zero writes after a late answer.
const org = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const grantId = '44444444-4444-4444-8444-444444444444';
const teamId = '55555555-5555-4555-8555-555555555555';
const memberId = '66666666-6666-4666-8666-666666666666';
const unboundId = '77777777-7777-4777-8777-777777777777';
const userA = '88888888-8888-4888-8888-888888888888';
const userB = '99999999-9999-4999-8999-999999999999';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const ok = (data, cookie = cookieA, statusCode = 200) => ({
  statusCode,
  data: { data, meta: { requestId: 'synthetic-c19s' } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + code } },
});
const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const disclosure = {
  purpose: '用途：私有赛季统计（PRIVATE_SEASON）',
  scope: '范围：机构、赛事、球队、成员与账号',
  readers: '读者：本人与机构 OWNER/ADMIN，没有匿名查询',
  metrics: '统计口径：篮板、助攻、出场时间未统计；名单场次不代表实际出场',
  revocation: '撤销：可随时撤销',
  independence: '与预约档案授权互相独立',
};
const season = (over = {}) => ({
  id: seasonId,
  orgId: org,
  name: '合成春季',
  startDate: '2028-01-01',
  endDate: '2028-12-31',
  status: 'ACTIVE',
  version: 3,
  activatedAt: '2028-01-01T00:00:00.000Z',
  closedAt: null,
  createdAt: '2028-01-01T00:00:00.000Z',
  updatedAt: '2028-01-01T00:00:00.000Z',
  events: [
    {
      eventId,
      name: '合成杯',
      startDate: '2028-03-01',
      endDate: '2028-03-02',
      status: 'RUNNING',
      attachedAt: '2028-01-02T00:00:00.000Z',
    },
  ],
  candidates: [],
  capabilities: { canEdit: true, canActivate: false, canClose: true },
  ...over,
});
const summary = (rows, over = {}) => ({
  algorithmVersion: 'SEASON_PRIVATE_BASIC_V1',
  sourceHash: 'f'.repeat(64),
  asOf: '2028-03-03T00:00:00.000Z',
  seasonVersion: 3,
  events: [
    {
      eventId,
      name: '合成杯',
      state: 'INCLUDED',
      totalMatchCount: 2,
      includedMatchCount: 1,
      teamOnlyConfirmedMatchCount: 0,
      pendingMatchCount: 1,
      coverageComplete: false,
      attributionComplete: false,
    },
  ],
  effectiveGrantCount: rows.length,
  rankingComplete: false,
  rows,
  notCollected: ['REBOUNDS', 'ASSISTS', 'MINUTES'],
  ...over,
});
const playerRow = {
  userId: userA,
  displayName: '合成球员甲',
  score: 7,
  fouls: 2,
  rosterSampleMatchCount: 1,
  eventCount: 1,
  rank: 1,
  tied: false,
  sources: [
    {
      eventId,
      eventName: '合成杯',
      teamName: '合成队',
      memberName: '合成甲',
      jerseyNo: '7',
      score: 7,
      fouls: 2,
      rosterSampleMatchCount: 1,
    },
  ],
  rebounds: null,
  assists: null,
  minutesPlayed: null,
};
const grant = (over = {}) => ({
  id: grantId,
  purpose: 'PRIVATE_SEASON',
  orgId: org,
  orgName: '合成机构',
  eventId,
  eventName: '合成杯',
  teamId,
  teamName: '合成队',
  memberId,
  memberName: '合成甲',
  targetUserId: userA,
  targetDisplayName: '合成球员甲',
  nominatedByDisplayName: '合成负责人',
  status: 'PENDING',
  version: 1,
  nominateReason: '本届逐人统计提名',
  withdrawReason: null,
  createdAt: '2028-03-03T00:00:00.000Z',
  consentedAt: null,
  declinedAt: null,
  revokedAt: null,
  withdrawnAt: null,
  effective: false,
  ineffectiveReasons: ['NOT_CONSENTED'],
  season: { id: seasonId, name: '合成春季', status: 'ACTIVE' },
  capabilities: { canConsent: true, canDecline: true, canRevoke: false, canWithdraw: false },
  ...over,
});
const sources = [
  {
    teamId,
    teamName: '合成队',
    members: [
      {
        memberId,
        name: '合成甲',
        jerseyNo: '7',
        binding: { bindingId: grantId, userId: userA, displayName: '合成球员甲' },
      },
      { memberId: unboundId, name: '合成乙', jerseyNo: '8', binding: null },
    ],
  },
];

function device(routes) {
  const state = { who: userA, writes: [], modal: null, reads: [] };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const method = options.method || 'GET';
      const key = method + ' ' + url;
      if (url === '/v1/auth/session')
        return ok(
          {
            user: { id: state.who, email: 'x@example.test', displayName: '合成账号' },
            organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
            teamContexts: [],
          },
          state.who === userA ? cookieA : cookieB,
        );
      if (key === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(
          {
            user: { id: userB, email: 'b@example.test', displayName: 'B' },
            organizations: [],
            teamContexts: [],
          },
          cookieB,
        );
      }
      if (method !== 'GET')
        state.writes.push({ key, body: JSON.parse(JSON.stringify(options.data ?? null)) });
      else state.reads.push(key);
      const reply = routes(key, state, options);
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
    async open(route, query) {
      const h = loadPage({ root, route, wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad(query);
      h.page.onShow();
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
async function confirmed(d, p, start) {
  const pending = start();
  await ticks();
  assert.ok(d.state.modal, 'confirmation opened');
  d.answer(true);
  await pending;
  await p.flush();
}

// ---------- allowlist, utils and static templates ----------
test('every C19 season route passes the fixed allowlist; anything else is refused', () => {
  const o = '/v1/orgs/' + org;
  for (const [url, method] of [
    [o + '/seasons', 'GET'],
    [o + '/seasons', 'POST'],
    [o + '/seasons/' + seasonId, 'GET'],
    [o + '/seasons/' + seasonId, 'PATCH'],
    [o + '/seasons/' + seasonId + '/commands', 'POST'],
    [o + '/seasons/' + seasonId + '/player-statistics', 'GET'],
    [o + '/events/' + eventId + '/season-data-grants', 'GET'],
    [o + '/events/' + eventId + '/season-data-grants', 'POST'],
    [o + '/season-data-grants/' + grantId + '/withdraw', 'POST'],
    ['/v1/me/season-data-grants', 'GET'],
    ['/v1/me/season-data-grants/' + grantId + '/commands', 'POST'],
    ['/v1/me/season-statistics?orgId=' + org + '&seasonId=' + seasonId, 'GET'],
  ])
    assert.equal(pathAllowed(url, method), true, method + ' ' + url);
  for (const [url, method] of [
    [o + '/seasons/' + seasonId, 'DELETE'],
    [o + '/seasons/' + seasonId + '/player-statistics?limit=5', 'GET'],
    ['/v1/me/season-statistics?orgId=' + org, 'GET'],
    ['/v1/me/season-statistics?orgId=' + org + '&seasonId=' + seasonId + '&userId=' + userB, 'GET'],
    ['/v1/public/seasons/' + seasonId, 'GET'],
  ])
    assert.equal(pathAllowed(url, method), false, method + ' ' + url);
});

test('season utils mirror the server bounds and never invent uncollected statistics', () => {
  const id = '7c1f2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  assert.deepEqual(
    model.createInput({ name: ' 春季 ', startDate: '2028-01-01', endDate: '2028-06-30' }, id),
    { clientRequestId: id, name: '春季', startDate: '2028-01-01', endDate: '2028-06-30' },
  );
  assert.throws(
    () => model.createInput({ name: '', startDate: '2028-01-01', endDate: '2028-01-02' }, id),
    /名称/,
  );
  assert.throws(
    () => model.createInput({ name: 'a', startDate: '2028-02-30', endDate: '2028-03-01' }, id),
    /有效/,
  );
  assert.throws(
    () => model.createInput({ name: 'a', startDate: '2028-01-02', endDate: '2028-01-01' }, id),
    /早于/,
  );
  assert.throws(
    () => model.createInput({ name: 'a', startDate: '2028-01-01', endDate: '2030-01-03' }, id),
    /731/,
  );
  assert.deepEqual(
    model.updateInput(season(), { name: '新名', startDate: '2028-01-01', endDate: '2028-12-31' }),
    {
      expectedVersion: 3,
      name: '新名',
    },
  );
  assert.throws(
    () =>
      model.updateInput(season(), {
        name: '合成春季',
        startDate: '2028-01-01',
        endDate: '2028-12-31',
      }),
    /没有变化/,
  );
  assert.deepEqual(model.commandInput(season(), 'ATTACH_EVENT', eventId), {
    type: 'ATTACH_EVENT',
    eventId,
    expectedVersion: 3,
  });
  assert.throws(
    () => model.commandInput(season({ status: 'CLOSED' }), 'DETACH_EVENT', eventId),
    /锁定/,
  );
  assert.throws(() => model.commandInput(season(), 'ACTIVATE'), /草稿/);
  assert.throws(
    () => model.nominateInput(sources, { teamId, memberId: unboundId, reason: '本届提名原因' }, id),
    /没有绑定账号/,
  );
  assert.deepEqual(
    model.nominateInput(sources, { teamId, memberId, reason: ' 本届提名原因 ' }, id),
    {
      clientRequestId: id,
      teamId,
      memberId,
      targetUserId: userA,
      reason: '本届提名原因',
    },
  );
  assert.throws(
    () => model.nominateInput(sources, { teamId, memberId, reason: '短' }, id),
    /4至500/,
  );
  assert.deepEqual(model.grantCommandInput(grant(), 'CONSENT'), {
    type: 'CONSENT',
    expectedVersion: 1,
  });
  assert.throws(() => model.grantCommandInput(grant(), 'REVOKE'), /刷新/);
  assert.throws(
    () => model.grantCommandInput(grant({ capabilities: { canConsent: false } }), 'CONSENT'),
    /刷新/,
  );
  assert.throws(() => model.withdrawInput(grant(), '撤回原因说明'), /无法撤回/);
  const row = model.playerRow(playerRow);
  assert.equal(row.rebounds, '未统计');
  assert.equal(row.assists, '未统计');
  assert.equal(row.minutes, '未统计');
  assert.equal(row.score, '7');
  assert.match(row.sources[0].text, /名单场次 1/);
  assert.match(model.rankingNote(summary([playerRow])), /部分样本.*不是完整排名/);
  assert.match(
    model.rankingNote(summary([playerRow], { rankingComplete: true })),
    /仅含已授权球员/,
  );
  assert.equal(model.grantView(grant()).reasonsText, '尚未经本人同意');
});

test('season pages: static templates bind only existing handlers', () => {
  for (const route of ['pages/seasons/index', 'pages/season-grants/index']) {
    const source = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
    const { page } = loadPage({ root, route });
    for (const handler of eventHandlers(parseWxml(source)))
      assert.equal(typeof page[handler], 'function', route + ': ' + handler);
    JSON.parse(fs.readFileSync(path.join(root, route + '.json'), 'utf8'));
  }
});

// ---------- admin seasons page ----------
function seasonRoutes(over = {}) {
  return (key, state) => {
    const o = 'GET /v1/orgs/' + org + '/seasons';
    if (over[key]) return over[key](state);
    if (key === o) return ok([season({ candidates: undefined })]);
    if (key === o + '/' + seasonId) return ok(season());
    if (key === o + '/' + seasonId + '/player-statistics')
      return ok({ season: season(), summary: summary([playerRow]) });
    if (key === 'POST /v1/orgs/' + org + '/seasons')
      return ok(season({ status: 'DRAFT', version: 1 }), cookieA, 201);
    if (key === 'POST /v1/orgs/' + org + '/seasons/' + seasonId + '/commands') return ok(season());
    if (key === 'PATCH /v1/orgs/' + org + '/seasons/' + seasonId) return ok(season({ version: 4 }));
    return null;
  };
}

test('seasons page: detail shows the private board with “未统计” and a partial-sample warning', async () => {
  const d = device(seasonRoutes());
  const p = await d.open('pages/seasons/index', { orgId: org, seasonId });
  assert.equal(p.page.data.season.name, '合成春季');
  assert.equal(p.page.data.board.rows[0].rebounds, '未统计');
  const rendered = preview('pages/seasons/index', p.page.data);
  assert.match(rendered.phone, /机构私有榜单/);
  assert.match(rendered.phone, /篮板 未统计 · 助攻 未统计 · 出场时间 未统计/);
  assert.match(rendered.phone, /部分样本/);
  assert.match(rendered.phone, /名单场次/);
  assert.doesNotMatch(rendered.phone, /实际出场 \d/);
  assert.deepEqual(d.state.writes, []);
});

test('seasons page: a lost create response is retried with the same clientRequestId', async () => {
  let attempt = 0;
  const d = device(
    seasonRoutes({
      ['POST /v1/orgs/' + org + '/seasons']: () => {
        attempt++;
        if (attempt === 1) throw new Error('response lost');
        return ok(season({ status: 'DRAFT', version: 1 }), cookieA, 200);
      },
    }),
  );
  const p = await d.open('pages/seasons/index', { orgId: org });
  for (const [field, value] of [
    ['name', '合成春季'],
    ['startDate', '2028-01-01'],
    ['endDate', '2028-12-31'],
  ])
    p.page.input(tap({ section: 'draft', field }, { value }));
  await confirmed(d, p, () => p.page.create());
  assert.equal(p.page.data.createPending, true);
  assert.match(p.page.data.error, /沿用原请求编号/);
  // Draft inputs are locked while the result is unknown.
  p.page.input(tap({ section: 'draft', field: 'name' }, { value: '换个名字' }));
  assert.equal(p.page.data.draft.name, '合成春季');
  await confirmed(d, p, () => p.page.create());
  const posts = d.state.writes.filter((w) => w.key === 'POST /v1/orgs/' + org + '/seasons');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.clientRequestId, posts[1].body.clientRequestId);
  assert.equal(p.page.data.createPending, false);
  assert.match(d.wx.calls.filter((c) => c.type === 'navigateTo').at(-1).url, /seasonId=/);
});

for (const kind of ['switch', 'logout', 'unload'])
  test('seasons page: a confirmation answered after ' + kind + ' sends nothing', async () => {
    const d = device(seasonRoutes());
    const p = await d.open('pages/seasons/index', { orgId: org, seasonId });
    const pending = p.page.command(tap({ type: 'CLOSE' }));
    await ticks();
    assert.ok(d.state.modal);
    await change(p, kind);
    d.answer(true);
    await pending;
    await ticks();
    assert.deepEqual(d.state.writes, []);
    if (kind !== 'unload') {
      assert.equal(p.page.data.season, null, 'private season data cleared on identity change');
      assert.equal(p.page.data.board, null);
    }
  });

test('seasons page: commands send the read version; a CAS conflict reloads; 403 explains the boundary', async () => {
  let conflict = true;
  const d = device(
    seasonRoutes({
      ['POST /v1/orgs/' + org + '/seasons/' + seasonId + '/commands']: () => {
        if (conflict) {
          conflict = false;
          return fail(409, 'VERSION_CONFLICT');
        }
        return ok(season());
      },
    }),
  );
  const p = await d.open('pages/seasons/index', { orgId: org, seasonId });
  const readsBefore = d.state.reads.length;
  await confirmed(d, p, () => p.page.command(tap({ type: 'DETACH_EVENT', id: eventId })));
  assert.deepEqual(d.state.writes[0].body, { type: 'DETACH_EVENT', eventId, expectedVersion: 3 });
  assert.match(p.page.data.error, /已重新读取/);
  assert.ok(d.state.reads.length > readsBefore, 'reloaded after the conflict');
  // A declined confirmation sends nothing.
  const declined = p.page.command(tap({ type: 'CLOSE' }));
  await ticks();
  d.answer(false);
  await declined;
  assert.equal(d.state.writes.length, 1);
  const manager = device(
    seasonRoutes({
      ['GET /v1/orgs/' + org + '/seasons/' + seasonId]: () => fail(403, 'FORBIDDEN'),
    }),
  );
  const denied = await manager.open('pages/seasons/index', { orgId: org, seasonId });
  assert.match(denied.page.data.error, /只管理某一届赛事不能查看赛季汇总/);
  assert.equal(denied.page.data.board, null);
});

// ---------- player grants page ----------
function grantRoutes(over = {}) {
  return (key, state) => {
    if (over[key]) return over[key](state);
    if (key === 'GET /v1/me/season-data-grants')
      return ok({ grants: [state.grant || grant()], truncated: false, disclosure });
    if (key === 'POST /v1/me/season-data-grants/' + grantId + '/commands') {
      state.grant = grant({
        status: 'ACTIVE',
        version: 2,
        effective: true,
        ineffectiveReasons: [],
        capabilities: { canConsent: false, canDecline: false, canRevoke: true, canWithdraw: false },
      });
      return ok(state.grant);
    }
    if (key === 'GET /v1/me/season-statistics?orgId=' + org + '&seasonId=' + seasonId)
      return ok({
        season: {
          id: seasonId,
          orgId: org,
          orgName: '合成机构',
          name: '合成春季',
          startDate: '2028-01-01',
          endDate: '2028-12-31',
          status: 'ACTIVE',
        },
        summary: summary(state.grant && state.grant.status === 'ACTIVE' ? [playerRow] : []),
      });
    return null;
  };
}

test('player consent screen shows scope, readers, metrics and revocation; consent needs explicit acknowledgement', async () => {
  const d = device(grantRoutes());
  const p = await d.open('pages/season-grants/index', {});
  assert.equal(p.page.data.mode, 'player');
  const rendered = preview('pages/season-grants/index', p.page.data);
  for (const text of ['范围', '读者', '统计口径', '撤销', '预约档案', '尚未经本人同意'])
    assert.match(rendered.phone, new RegExp(text));
  // Without the acknowledgement no confirmation opens and nothing is sent.
  await p.page.answer(tap({ id: grantId, type: 'CONSENT' }));
  assert.match(p.page.data.error, /请先勾选/);
  assert.equal(d.state.modal, null);
  p.page.acknowledge(tap({ id: grantId }, { value: ['yes'] }));
  await confirmed(d, p, () => p.page.answer(tap({ id: grantId, type: 'CONSENT' })));
  assert.deepEqual(d.state.writes, [
    {
      key: 'POST /v1/me/season-data-grants/' + grantId + '/commands',
      body: { type: 'CONSENT', expectedVersion: 1 },
    },
  ]);
  assert.equal(p.page.data.grants[0].status, 'ACTIVE');
  assert.equal(p.page.data.acknowledged, '');
  // Own statistics only; uncollected items read “未统计”.
  await p.page.showStats(tap({ org, season: seasonId }));
  await p.flush();
  assert.equal(p.page.data.stats.row.score, '7');
  const stats = preview('pages/season-grants/index', p.page.data);
  assert.match(stats.phone, /只显示您本人的数据/);
  assert.match(stats.phone, /篮板 未统计/);
  assert.match(stats.phone, /名单场次（非实际出场）/);
  // Revoke: the next read of own statistics no longer has a row.
  d.state.grant = grant({
    status: 'ACTIVE',
    version: 2,
    effective: true,
    ineffectiveReasons: [],
    capabilities: { canConsent: false, canDecline: false, canRevoke: true, canWithdraw: false },
  });
  await p.page.load();
  await p.flush();
  const before = d.state.writes.length;
  const pending = p.page.answer(tap({ id: grantId, type: 'REVOKE' }));
  await ticks();
  d.state.grant = grant({
    status: 'REVOKED',
    version: 3,
    ineffectiveReasons: ['TERMINATED'],
    capabilities: { canConsent: false, canDecline: false, canRevoke: false, canWithdraw: false },
  });
  d.answer(true);
  await pending;
  await p.flush();
  assert.deepEqual(d.state.writes[before].body, { type: 'REVOKE', expectedVersion: 2 });
});

for (const kind of ['switch', 'logout', 'unload'])
  test(
    'player grant page: consent answered after ' + kind + ' sends nothing and clears private data',
    async () => {
      const d = device(grantRoutes());
      const p = await d.open('pages/season-grants/index', {});
      p.page.acknowledge(tap({ id: grantId }, { value: ['yes'] }));
      const pending = p.page.answer(tap({ id: grantId, type: 'CONSENT' }));
      await ticks();
      assert.ok(d.state.modal);
      await change(p, kind);
      d.answer(true);
      await pending;
      await ticks();
      assert.deepEqual(d.state.writes, []);
      if (kind !== 'unload') {
        assert.deepEqual(p.page.data.grants, []);
        assert.equal(p.page.data.stats, null);
        assert.equal(p.page.data.loginRequired, true);
      }
    },
  );

test('player grant page: a stale version or ended grant reloads instead of retrying', async () => {
  const d = device(
    grantRoutes({
      ['POST /v1/me/season-data-grants/' + grantId + '/commands']: () =>
        fail(409, 'VERSION_CONFLICT'),
    }),
  );
  const p = await d.open('pages/season-grants/index', {});
  const reads = d.state.reads.length;
  await confirmed(d, p, () => p.page.answer(tap({ id: grantId, type: 'DECLINE' })));
  assert.equal(d.state.writes.length, 1);
  assert.match(p.page.data.error, /已重新读取/);
  assert.ok(d.state.reads.length > reads);
});

test('a late read response after an identity switch never shows the previous account data', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const d = device(
    grantRoutes({
      ['GET /v1/me/season-data-grants']: async (state) => {
        if (state.who === userA) await gate;
        return ok({ grants: state.who === userA ? [grant()] : [], truncated: false, disclosure });
      },
    }),
  );
  const h = loadPage({ root, route: 'pages/season-grants/index', wx: d.wx });
  const client = h.requireLocal('utils/api.js').getClient();
  await client.request('/v1/auth/session');
  h.page.onLoad({});
  h.page.onShow();
  await ticks();
  await client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
  release();
  await ticks(40);
  assert.deepEqual(h.page.data.grants, []);
});

// ---------- organizer nomination ----------
function organizerRoutes(over = {}) {
  return (key, state) => {
    const base = '/v1/orgs/' + org + '/events/' + eventId + '/season-data-grants';
    if (over[key]) return over[key](state);
    if (key === 'GET ' + base)
      return ok({
        event: {
          id: eventId,
          orgId: org,
          name: '合成杯',
          startDate: '2028-03-01',
          endDate: '2028-03-02',
          status: 'RUNNING',
        },
        season: { id: seasonId, name: '合成春季', status: 'ACTIVE' },
        frozen: true,
        sources,
        grants: state.grants || [],
        disclosure,
      });
    if (key === 'POST ' + base)
      return ok(
        grant({
          capabilities: {
            canConsent: false,
            canDecline: false,
            canRevoke: false,
            canWithdraw: true,
          },
        }),
        cookieA,
        201,
      );
    if (key === 'POST /v1/orgs/' + org + '/season-data-grants/' + grantId + '/withdraw')
      return ok(grant({ status: 'WITHDRAWN' }));
    return null;
  };
}

test('organizer: an unbound member cannot be nominated; a lost response retries with the same id', async () => {
  let attempt = 0;
  const base = '/v1/orgs/' + org + '/events/' + eventId + '/season-data-grants';
  const d = device(
    organizerRoutes({
      ['POST ' + base]: () => {
        attempt++;
        if (attempt === 1) throw new Error('response lost');
        return ok(grant(), cookieA, 200);
      },
    }),
  );
  const p = await d.open('pages/season-grants/index', { orgId: org, eventId });
  assert.equal(p.page.data.mode, 'organizer');
  p.page.pickTeam(tap({}, { value: 0 }));
  assert.match(p.page.data.memberLabels[1], /未绑定（不能提名）/);
  p.page.pickMember(tap({}, { value: 1 }));
  p.page.input(tap({ field: 'reason' }, { value: '本届逐人统计提名' }));
  await p.page.nominate();
  assert.match(p.page.data.error, /没有绑定账号/);
  assert.equal(d.state.modal, null);
  assert.deepEqual(d.state.writes, []);
  p.page.pickMember(tap({}, { value: 0 }));
  await confirmed(d, p, () => p.page.nominate());
  assert.equal(p.page.data.nominationPending, true);
  // The selection is locked while the result is unknown.
  p.page.pickMember(tap({}, { value: 1 }));
  assert.equal(p.page.data.memberIndex, 0);
  await confirmed(d, p, () => p.page.nominate());
  assert.equal(d.state.writes.length, 2);
  assert.equal(d.state.writes[0].body.clientRequestId, d.state.writes[1].body.clientRequestId);
  assert.deepEqual(
    { ...d.state.writes[1].body, clientRequestId: undefined },
    {
      clientRequestId: undefined,
      teamId,
      memberId,
      targetUserId: userA,
      reason: '本届逐人统计提名',
    },
  );
  assert.equal(p.page.data.nominationPending, false);
});

test('organizer: withdraw needs a reason and the read version; 403 explains who may nominate', async () => {
  const d = device(organizerRoutes());
  d.state.grants = [
    grant({
      status: 'ACTIVE',
      version: 2,
      capabilities: { canConsent: false, canDecline: false, canRevoke: false, canWithdraw: true },
    }),
  ];
  const p = await d.open('pages/season-grants/index', { orgId: org, eventId });
  p.page.askWithdraw(tap({ id: grantId }));
  p.page.input(tap({ field: 'withdrawReason' }, { value: '短' }));
  await p.page.withdraw();
  assert.match(p.page.data.error, /4至500/);
  assert.deepEqual(d.state.writes, []);
  p.page.input(tap({ field: 'withdrawReason' }, { value: '主办方撤回合成提名' }));
  await confirmed(d, p, () => p.page.withdraw());
  assert.deepEqual(d.state.writes[0].body, { reason: '主办方撤回合成提名', expectedVersion: 2 });
  const denied = device(
    organizerRoutes({
      ['GET /v1/orgs/' + org + '/events/' + eventId + '/season-data-grants']: () =>
        fail(403, 'FORBIDDEN'),
    }),
  );
  const q = await denied.open('pages/season-grants/index', { orgId: org, eventId });
  assert.match(q.page.data.error, /赛事负责人可以提名/);
  const invalid = device(organizerRoutes());
  const r = await invalid.open('pages/season-grants/index', { orgId: 'x', eventId });
  assert.equal(r.page.data.invalid, true);
  assert.deepEqual(invalid.state.reads, []);
});

// C19 resumption review: asynchronous preparation, refreshed targets and durable recovery.
for (const kind of ['switch', 'logout', 'unload']) {
  for (const operation of ['create', 'nominate']) {
    test(
      operation +
        ': identity/lifecycle change while generating request ID sends zero writes (' +
        kind +
        ')',
      async () => {
        const d = device(operation === 'create' ? seasonRoutes() : organizerRoutes());
        const p = await d.open(
          operation === 'create' ? 'pages/seasons/index' : 'pages/season-grants/index',
          operation === 'create' ? { orgId: org } : { orgId: org, eventId },
        );
        if (operation === 'create')
          p.page.setData({
            draft: { name: '合成春季', startDate: '2028-01-01', endDate: '2028-12-31' },
          });
        else p.page.setData({ teamIndex: 0, memberIndex: 0, reason: '合成提名原因' });
        const original = d.wx.getRandomValues;
        let generate;
        d.wx.getRandomValues = (options) => {
          generate = () => original(options);
        };
        const pending = p.page[operation]();
        await ticks();
        d.answer(true);
        await ticks();
        assert.equal(typeof generate, 'function', 'request ID preparation is pending');
        await change(p, kind);
        generate();
        await pending;
        assert.deepEqual(d.state.writes, []);
        assert.equal(
          [...d.wx.storage.keys()].filter((k) => k.startsWith('scb-season-request-v1:')).length,
          0,
        );
        if (kind === 'unload') assert.equal(p.page._closed, true);
      },
    );
  }
}

for (const operation of ['save', 'ACTIVATE', 'CLOSE', 'ATTACH_EVENT', 'DETACH_EVENT']) {
  test(
    'season ' + operation + ': refreshed target/version while confirming sends zero writes',
    async () => {
      const d = device(seasonRoutes());
      const p = await d.open('pages/seasons/index', { orgId: org, seasonId });
      if (operation === 'ACTIVATE')
        p.page.setData({
          season: season({
            status: 'DRAFT',
            capabilities: { canEdit: true, canActivate: true, canClose: false },
          }),
        });
      if (operation === 'save') p.page.setData({ 'edit.name': '新赛季名称' });
      const pending =
        operation === 'save'
          ? p.page.save()
          : p.page.command(tap({ type: operation, id: eventId }));
      await ticks();
      p.page.setData({ season: season({ version: 4 }) });
      d.answer(true);
      await pending;
      assert.deepEqual(d.state.writes, []);
      assert.match(p.page.data.error, /重新核对/);
    },
  );
}
for (const operation of ['CONSENT', 'DECLINE', 'REVOKE', 'withdraw']) {
  test(
    'grant ' + operation + ': refreshed target/capability while confirming sends zero writes',
    async () => {
      const d = device(operation === 'withdraw' ? organizerRoutes() : grantRoutes());
      const p = await d.open(
        'pages/season-grants/index',
        operation === 'withdraw' ? { orgId: org, eventId } : {},
      );
      if (operation === 'withdraw')
        p.page.setData({ grants: [grant({ capabilities: { canWithdraw: true } })] });
      if (operation === 'REVOKE')
        p.page.setData({
          grants: [
            grant({
              status: 'ACTIVE',
              capabilities: {
                canConsent: false,
                canDecline: false,
                canRevoke: true,
                canWithdraw: true,
              },
            }),
          ],
        });
      p.page.setData({
        acknowledged: grantId,
        withdrawId: grantId,
        withdrawReason: '合成撤回原因',
      });
      const pending =
        operation === 'withdraw'
          ? p.page.withdraw()
          : p.page.answer(tap({ type: operation, id: grantId }));
      await ticks();
      p.page.setData({
        grants: [
          grant({
            version: 2,
            capabilities: {
              canConsent: false,
              canDecline: false,
              canRevoke: false,
              canWithdraw: false,
            },
          }),
        ],
      });
      d.answer(true);
      await pending;
      assert.deepEqual(d.state.writes, []);
      assert.match(p.page.data.error, /重新核对/);
    },
  );
}

test('nomination: binding changes during confirmation cannot silently target the new account', async () => {
  const d = device(organizerRoutes());
  const p = await d.open('pages/season-grants/index', { orgId: org, eventId });
  p.page.setData({ teamIndex: 0, memberIndex: 0, reason: '合成提名原因' });
  const pending = p.page.nominate();
  await ticks();
  p.page.setData({ 'sources[0].members[0].binding.userId': userB });
  d.answer(true);
  await pending;
  assert.deepEqual(d.state.writes, []);
});

test('create: unknown server error survives page unload and replays original ID/body', async () => {
  let attempts = 0;
  const d = device(
    seasonRoutes({
      ['POST /v1/orgs/' + org + '/seasons']: () =>
        ++attempts === 1 ? fail(502, 'UPSTREAM_UNKNOWN') : ok(season(), cookieA, 200),
    }),
  );
  const p = await d.open('pages/seasons/index', { orgId: org });
  p.page.setData({ draft: { name: '合成春季', startDate: '2028-01-01', endDate: '2028-12-31' } });
  await confirmed(d, p, () => p.page.create());
  assert.equal(p.page.data.createPending, true);
  p.unload();
  const resumed = await d.open('pages/seasons/index', { orgId: org });
  assert.equal(resumed.page.data.createPending, true);
  await confirmed(d, resumed, () => resumed.page.create());
  assert.equal(d.state.writes.length, 2);
  assert.deepEqual(d.state.writes[0].body, d.state.writes[1].body);
});

test('nomination: durable pending request survives unload without changing target or ID', async () => {
  let attempts = 0;
  const post = 'POST /v1/orgs/' + org + '/events/' + eventId + '/season-data-grants';
  const d = device(
    organizerRoutes({
      [post]: () => {
        if (++attempts === 1) throw new Error('response lost');
        return ok(grant(), cookieA, 200);
      },
    }),
  );
  const p = await d.open('pages/season-grants/index', { orgId: org, eventId });
  p.page.setData({ teamIndex: 0, memberIndex: 0, reason: '合成提名原因' });
  await confirmed(d, p, () => p.page.nominate());
  p.unload();
  const resumed = await d.open('pages/season-grants/index', { orgId: org, eventId });
  assert.equal(resumed.page.data.nominationPending, true);
  await confirmed(d, resumed, () => resumed.page.nominate());
  assert.equal(d.state.writes.length, 2);
  assert.deepEqual(d.state.writes[0].body, d.state.writes[1].body);
});

for (const operation of ['create', 'nominate']) {
  test(operation + ': storage failure stops the request before sending', async () => {
    const d = device(operation === 'create' ? seasonRoutes() : organizerRoutes());
    const p = await d.open(
      operation === 'create' ? 'pages/seasons/index' : 'pages/season-grants/index',
      operation === 'create' ? { orgId: org } : { orgId: org, eventId },
    );
    if (operation === 'create')
      p.page.setData({
        draft: { name: '合成春季', startDate: '2028-01-01', endDate: '2028-12-31' },
      });
    else p.page.setData({ teamIndex: 0, memberIndex: 0, reason: '合成提名原因' });
    d.wx.setStorageSync = () => {
      throw new Error('disk unavailable');
    };
    await confirmed(d, p, () => p.page[operation]());
    assert.deepEqual(d.state.writes, []);
    assert.match(p.page.data.error, /无法保存/);
  });
}

for (const settleOld of ['success', 'failure']) {
  test(
    'grant pagination: refresh supersedes old page ' +
      settleOld +
      ' and keeps further pages reachable',
    async () => {
      let pageRequest;
      let cursorCalls = 0;
      const cursor = 'c3ludGhldGlj';
      const d = device(
        grantRoutes({
          'GET /v1/me/season-data-grants': () =>
            ok({ grants: [grant()], disclosure, truncated: true, nextCursor: cursor }),
          ['GET /v1/me/season-data-grants?cursor=' + cursor]: () => {
            cursorCalls++;
            if (cursorCalls === 1)
              return new Promise((resolve, reject) => {
                pageRequest = { resolve, reject };
              });
            return ok({
              grants: [grant({ id: userB })],
              disclosure,
              truncated: false,
              nextCursor: null,
            });
          },
        }),
      );
      const p = await d.open('pages/season-grants/index', {});
      const old = p.page.loadMore();
      await ticks();
      assert.ok(pageRequest);
      await p.page.load();
      if (settleOld === 'success')
        pageRequest.resolve(
          ok({ grants: [grant({ id: teamId })], disclosure, truncated: false, nextCursor: null }),
        );
      else pageRequest.reject(new Error('old request failed'));
      await old;
      assert.equal(p.page.data.loadingMore, false);
      assert.equal(p.page.data.moreError, '');
      assert.equal(p.page.data.grants.length, 1);
      await p.page.loadMore();
      assert.equal(cursorCalls, 2);
      assert.deepEqual(
        p.page.data.grants.map((g) => g.id),
        [grantId, userB],
      );
      assert.equal(p.page.data.nextCursor, null);
    },
  );
}

test('administrator season list keeps the array envelope and appends older pages after a retry', async () => {
  let attempts = 0;
  const cursor = 'YWRtaW4';
  const base = 'GET /v1/orgs/' + org + '/seasons';
  const d = device(
    seasonRoutes({
      [base]: () => {
        const r = ok([season()]);
        r.data.meta.nextCursor = cursor;
        return r;
      },
      [base + '?cursor=' + cursor]: () => {
        if (++attempts === 1) throw new Error('page failed');
        const r = ok([season({ id: userB, name: '更早的赛季' })]);
        r.data.meta.nextCursor = null;
        return r;
      },
    }),
  );
  const p = await d.open('pages/seasons/index', { orgId: org });
  await p.page.loadMore();
  assert.equal(p.page.data.seasons.length, 1);
  assert.equal(p.page.data.nextCursor, cursor);
  assert.ok(p.page.data.moreError);
  await p.page.loadMore();
  assert.deepEqual(
    p.page.data.seasons.map((s) => s.id),
    [seasonId, userB],
  );
  assert.equal(p.page.data.nextCursor, null);
  assert.equal(attempts, 2);
});

test('organizer reads an earlier grant page and can withdraw that older grant', async () => {
  const cursor = 'b2xk';
  const base = '/v1/orgs/' + org + '/events/' + eventId + '/season-data-grants';
  const old = grant({
    id: userB,
    status: 'ACTIVE',
    version: 4,
    capabilities: { canWithdraw: true },
  });
  const d = device(
    organizerRoutes({
      ['GET ' + base]: () =>
        ok({
          event: { id: eventId },
          season: null,
          sources,
          frozen: true,
          disclosure,
          grants: [grant()],
          nextCursor: cursor,
        }),
      ['GET ' + base + '?cursor=' + cursor]: () => ok({ grants: [old], nextCursor: null }),
      ['POST /v1/orgs/' + org + '/season-data-grants/' + userB + '/withdraw']: () =>
        ok({ ...old, status: 'WITHDRAWN', version: 5 }),
    }),
  );
  const p = await d.open('pages/season-grants/index', { orgId: org, eventId });
  await p.page.loadMore();
  assert.deepEqual(
    p.page.data.grants.map((g) => g.id),
    [grantId, userB],
  );
  p.page.askWithdraw(tap({ id: userB }));
  p.page.input(tap({ field: 'withdrawReason' }, { value: '核对后撤回授权' }));
  await confirmed(d, p, () => p.page.withdraw());
  assert.deepEqual(d.state.writes.at(-1).body, { expectedVersion: 4, reason: '核对后撤回授权' });
});

test('candidate events page through in bounded requests and reject mixed season versions', async () => {
  const cursor = 'Y2FuZGlkYXRl';
  const base = 'GET /v1/orgs/' + org + '/seasons/' + seasonId;
  let version = 4;
  const d = device(
    seasonRoutes({
      [base]: () =>
        ok(season({ candidates: [{ eventId, name: '候选赛事一' }], candidateNextCursor: cursor })),
      [base + '?candidateCursor=' + cursor]: () =>
        ok(
          season({
            version,
            candidates: [{ eventId: userB, name: '候选赛事二' }],
            candidateNextCursor: null,
          }),
        ),
    }),
  );
  const p = await d.open('pages/seasons/index', { orgId: org, seasonId });
  await p.page.loadMoreCandidates();
  assert.equal(p.page.data.season.candidates.length, 1);
  assert.match(p.page.data.candidateMoreError, /请刷新/);
  version = 3;
  await p.page.loadMoreCandidates();
  assert.deepEqual(
    p.page.data.season.candidates.map((e) => e.eventId),
    [eventId, userB],
  );
  assert.equal(p.page.data.season.candidateNextCursor, null);
});

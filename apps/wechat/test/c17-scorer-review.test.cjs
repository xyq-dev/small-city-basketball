const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// PR #26 review (scorer): acquiring control must re-check after the client-instance id wait,
// and confirmed commands (next period, overtime, end) must use the match version the scorer saw
// when the dialog opened; a newer read in between means nothing is sent. Assertions count real
// requests and read their expectedVersion.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const leaseId = '77777777-7777-4777-8777-777777777777';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const base = '/v1/orgs/' + org + '/matches/' + matchId;
const LEASE = 'POST ' + base + '/scorekeeper-lease';
const COMMAND = 'POST ' + base + '/commands';
const ok = (data, cookie = cookieA) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-scorer-review', nextCursor: null } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const sessionOf = (id) => ({
  user: { id, email: id.slice(0, 4) + '@example.test', displayName: '合成记分员' },
  organizations: [{ id: org, name: '合成机构', role: 'SCORER' }],
  teamContexts: [],
});
const ticks = async (n = 15) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const snapshot = (version, home) => ({
  status: 'LIVE',
  version,
  home: { teamName: '合成主队' },
  away: { teamName: '合成客队' },
  totals: {
    home: { score: home, fouls: 0, timeouts: 0 },
    away: { score: 3, fouls: 0, timeouts: 0 },
  },
  periods: [{ period: 4, home: { score: home }, away: { score: 3 } }],
  rules: { regulationPeriods: 4, allowedScoreValues: [1, 2, 3] },
  clock: { period: 4, remainingMs: 0, running: false, anchorServerTime: '2026-10-27T10:00:00Z' },
  serverTime: '2026-10-27T10:00:10.000Z',
  collected: { playerStatistics: false },
  requiresReconfirmation: false,
});
const workbench = (version, home) => ({
  event: { id: eventId, name: '合成赛事', status: 'RUNNING', version: 3 },
  match: {
    roundNo: 1,
    startsAt: '2026-11-01T02:00:00Z',
    courtName: '合成1号场',
    home: { teamName: '合成主队' },
    away: { teamName: '合成客队' },
    status: 'LIVE',
    version,
  },
  rules: { regulationPeriods: 4, periodDurationSeconds: 600, tiePolicy: 'OVERTIME' },
  snapshot: snapshot(version, home),
  playerRoster: { home: [], away: [] },
  staff: [],
  lease: null,
  capabilities: { canAcquireControl: true },
});

function device() {
  const state = {
    who: userA,
    version: 5,
    home: 5,
    sent: [],
    modal: null,
    random: [],
    holdRandom: false,
    reads: [],
    holdRead: false,
    loseCommand: false,
  };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const method = options.method || 'GET';
      const key = method + ' ' + url;
      if (url === '/v1/auth/session')
        return ok(sessionOf(state.who), state.who === userA ? cookieA : cookieB);
      if (key === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(sessionOf(userB), cookieB);
      }
      if (method !== 'GET')
        state.sent.push({
          key,
          body: JSON.parse(JSON.stringify(options.data ?? null)),
          cookie: (options.header || {}).Cookie || '',
        });
      if (key === 'GET ' + base + '/scoring') {
        const reply = () => ok(workbench(state.version, state.home));
        if (!state.holdRead) return reply();
        return new Promise((resolve) => state.reads.push(() => resolve(reply())));
      }
      if (/scoring-events\?/.test(key)) return ok([]);
      if (key === LEASE) return ok({ leaseId, fencingToken: '1', clientInstanceId: leaseId });
      if (key === 'POST ' + base + '/scorekeeper-lease/renew') return ok({});
      if (key === 'DELETE ' + base + '/scorekeeper-lease') return ok({});
      if (key === COMMAND) {
        if (state.loseCommand) return Promise.reject(new Error('synthetic lost response'));
        return ok({ snapshot: snapshot(state.version + 1, state.home) });
      }
      if (/^GET .*\/commands\/[0-9a-f-]+$/.test(key))
        return ok({ snapshot: snapshot(state.version + 1, state.home) });
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } };
    },
  });
  wx.showModal = (o) => {
    state.modal = o;
  };
  const random = wx.getRandomValues;
  wx.getRandomValues = (o) => (state.holdRandom ? state.random.push(() => random(o)) : random(o));
  return {
    wx,
    state,
    sent: (key) => state.sent.filter((s) => s.key === key),
    answer(confirm = true) {
      const m = state.modal;
      state.modal = null;
      m.success({ confirm, cancel: !confirm });
    },
    async open() {
      const h = loadPage({ root, route: 'pages/scorer/index', wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad({ orgId: org, matchId });
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
async function withControl() {
  const d = device();
  const p = await d.open();
  await p.page.acquire();
  await p.flush();
  assert.equal(p.page.data.held, true);
  return { d, p };
}

// ---------- 1. acquiring control ----------
for (const kind of ['switch', 'logout', 'unload'])
  test('acquire: a ' + kind + ' during the instance-id wait sends no lease request', async () => {
    const d = device();
    const p = await d.open();
    d.state.holdRandom = true;
    const acquiring = p.page.acquire();
    await ticks();
    assert.equal(d.state.random.length, 1, 'waiting for secure random');
    await change(p, kind);
    d.state.holdRandom = false;
    d.state.random.shift()();
    await acquiring;
    await ticks();
    assert.equal(d.sent(LEASE).length, 0, kind);
    assert.ok(!p.page._instance, 'the late instance id is not kept for the new state');
    assert.equal(p.page._control || null, null);
  });

test('acquire: the normal flow sends one lease request, then renew and release still work', async () => {
  const { d, p } = await withControl();
  assert.equal(d.sent(LEASE).length, 1);
  await p.page.renew();
  assert.equal(d.sent('POST ' + base + '/scorekeeper-lease/renew').length, 1);
  p.unload();
  await ticks();
  assert.equal(d.sent('DELETE ' + base + '/scorekeeper-lease').length, 1);
});

// ---------- 2. confirmed commands pin the version the scorer saw ----------
const confirmed = [
  ['nextPeriod', 'NEXT_PERIOD'],
  ['overtime', 'START_OVERTIME'],
  ['end', 'END_MATCH'],
];
for (const [method, type] of confirmed) {
  test(method + ': a newer read landing while the dialog is open sends nothing', async () => {
    const { d, p } = await withControl();
    d.state.holdRead = true;
    p.page.load();
    await ticks();
    const confirming = p.page[method]();
    await ticks();
    assert.ok(d.state.modal, 'dialog opened at version 5');
    d.state.version = 6;
    d.state.home = 7;
    d.state.holdRead = false;
    d.state.reads.shift()();
    await ticks();
    assert.equal(p.page._matchVersion, 6, 'the read brought version 6');
    d.answer(true);
    await confirming;
    await ticks();
    assert.equal(d.sent(COMMAND).length, 0, 'no ' + type);
    assert.match(p.page.data.error, /重新核对/);
  });

  test(
    method + ': unchanged target sends once with the confirmed version; cancel sends nothing',
    async () => {
      const { d, p } = await withControl();
      let confirming = p.page[method]();
      await ticks();
      d.answer(false);
      await confirming;
      assert.equal(d.sent(COMMAND).length, 0);
      confirming = p.page[method]();
      await ticks();
      d.answer(true);
      await confirming;
      await p.flush();
      const sent = d.sent(COMMAND);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].body.type, type);
      assert.equal(sent[0].body.expectedVersion, 5);
    },
  );

  for (const kind of ['switch', 'unload'])
    test(
      method + ': a ' + kind + ' during the command-id wait after confirming sends nothing',
      async () => {
        const { d, p } = await withControl();
        const confirming = p.page[method]();
        await ticks();
        d.state.holdRandom = true;
        d.answer(true);
        await ticks();
        assert.equal(d.state.random.length, 1);
        await change(p, kind);
        d.state.holdRandom = false;
        d.state.random.shift()();
        await confirming;
        await ticks();
        assert.equal(d.sent(COMMAND).length, 0, kind);
      },
    );
}

test('a newer read during the command-id wait after confirming sends nothing', async () => {
  const { d, p } = await withControl();
  const confirming = p.page.end();
  await ticks();
  d.state.holdRandom = true;
  d.answer(true);
  await ticks();
  // A version change arriving now (e.g. another device's record) must stop the confirmed END.
  p.page.show(snapshot(6, 7), Date.now());
  d.state.holdRandom = false;
  d.state.random.shift()();
  await confirming;
  await ticks();
  assert.equal(d.sent(COMMAND).length, 0);
});

test('a lost END_MATCH response is recovered with the original command id', async () => {
  const { d, p } = await withControl();
  d.state.loseCommand = true;
  const confirming = p.page.end();
  await ticks();
  d.answer(true);
  await confirming;
  await p.flush();
  const first = d.sent(COMMAND);
  assert.equal(first.length, 1);
  assert.equal(first[0].body.expectedVersion, 5);
  assert.ok(p.page.data.pending, 'unknown result kept');
  assert.equal(p.page.data.pending.body.commandId, first[0].body.commandId);
  d.state.loseCommand = false;
  await p.page.resendPending();
  await p.flush();
  const all = d.sent(COMMAND);
  assert.equal(all.length, 2);
  assert.equal(all[1].body.commandId, first[0].body.commandId, 'resent with the same id');
  assert.equal(all[1].body.expectedVersion, 5, 'and the same version');
  assert.equal(p.page.data.pending, null);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../utils/matching');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const U = '10000000-0000-4000-8000-000000000001',
  V = '10000000-0000-4000-8000-000000000002',
  N = '20000000-0000-4000-8000-000000000001',
  C = '30000000-0000-4000-8000-000000000001',
  S = '40000000-0000-4000-8000-000000000001',
  R = '50000000-0000-4000-8000-000000000001',
  O = '60000000-0000-4000-8000-000000000001',
  P = '70000000-0000-4000-8000-000000000001',
  Q = '80000000-0000-4000-8000-000000000001';
const rawCandidate = () => ({
  id: C,
  sourceId: P,
  sourceOrgId: null,
  sourceSlotId: null,
  sourceVersion: 1,
  preferenceVersion: 1,
  settingsVersion: 2,
  name: '合成控卫',
  role: 'PG',
  regionId: R,
  totalFen: 11000,
  needsQuote: false,
  crossCity: false,
  score: {
    ruleVersion: 'match-rules-v1',
    score: 75,
    coverage: 60,
    band: 'LIMITED',
    dimensions: { time: 100, budget: 0, travel: null, reliability: null },
    reasons: ['档期覆盖', '交通尚未核验'],
  },
});
const rawNeed = () => ({
  id: N,
  kind: 'ADULT_PLAYER',
  orgId: O,
  teamId: Q,
  title: '成人球队补位',
  address: '公开场馆',
  regionId: R,
  catalogVersion: 'test-v1',
  role: 'PG',
  quantity: 1,
  unitBudgetFen: 11000,
  totalBudgetFen: 11000,
  version: 1,
  status: 'ACTIVE',
  expiresAt: '2028-02-01T09:00:00Z',
  windows: [
    {
      reportAt: '2028-02-01T10:00:00Z',
      startAt: '2028-02-01T10:15:00Z',
      endAt: '2028-02-01T12:00:00Z',
    },
  ],
  slots: [{ id: S, number: 1, generation: 1, status: 'OPEN' }],
  candidates: [rawCandidate()],
  intents: [],
  canManage: true,
  latestRunId: C,
  truncated: false,
});
const rawWorkspace = () => ({
  enabled: true,
  conversionEnabled: true,
  needs: [
    {
      id: N,
      kind: 'ADULT_PLAYER',
      title: '成人球队补位',
      status: 'ACTIVE',
      version: 1,
      expiresAt: '2028-02-01T09:00:00Z',
    },
  ],
  inbox: [],
  sources: [{ kind: 'TEAM_MATCHUP', id: Q, name: '合成队', orgId: O, role: 'TEAM' }],
  preferences: [],
});
function harness({ request, modalAnswers = [] } = {}) {
  let actor = U,
    rev = 1;
  const listeners = new Set(),
    calls = [];
  const client = {
    sessionRevision: () => rev,
    onSessionChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return {
          data: {
            user: { id: actor },
            organizations: [{ id: O, name: '合成机构', role: 'ORG_OWNER' }],
            teamContexts: [],
          },
        };
      if (request) return request(url, method, body);
      return { data: url === '/v1/matching' ? rawWorkspace() : rawNeed() };
    },
  };
  const api = { getClient: () => client, uuid: (v) => v };
  const wx = createWx({ modalAnswers });
  const h = loadPage({
    root,
    route: 'pages/matching/index',
    wx,
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad({});
  return {
    ...h,
    calls,
    client,
    switchActor() {
      actor = V;
      rev++;
      for (const fn of [...listeners]) fn();
    },
  };
}
test('strict DTO preserves unknown evidence and rejects malformed money or flags', () => {
  const c = m.candidate(rawCandidate());
  assert.equal(c.priceText, '¥110.00');
  assert.equal(c.score.dimensions.travel, null);
  assert.throws(() => m.candidate({ ...rawCandidate(), totalFen: -1 }));
  assert.throws(() => m.candidate({ ...rawCandidate(), needsQuote: 'false' }));
  assert.equal(m.detail(rawNeed()).slots[0].label, '席位 1 · 待补位');
  assert.throws(() => m.workspace({ ...rawWorkspace(), enabled: 'true' }));
});
test('times are explicitly China local and budgets preserve exact cents', () => {
  const windows = m.windows([
    { date: '2028-01-01', endDate: '2028-01-02', report: '23:00', start: '23:15', end: '01:00' },
  ]);
  assert.equal(windows[0].reportAt, '2028-01-01T15:00:00.000Z');
  assert.equal(m.fen('12.34'), 1234);
  assert.throws(() => m.fen('12.345'));
  assert.throws(() =>
    m.windows([
      { date: 'invalid', endDate: '2028-01-02', report: '23:00', start: '23:15', end: '01:00' },
    ]),
  );
});
test('pending commands are actor scoped and cannot be overwritten or redirected', () => {
  const wx = createWx(),
    body = { commandId: C, type: 'ACCEPT' };
  m.savePending(wx, U, '/v1/matching/intents/' + N + '/commands', body);
  assert.equal(m.readPending(wx, V), null);
  assert.throws(() => m.savePending(wx, U, '/v1/matching/needs', { commandId: P }));
  assert.throws(() => m.clearPending(wx, U, P));
  m.clearPending(wx, U, C);
  assert.equal(m.readPending(wx, U), null);
  assert.throws(() => m.savePending(wx, U, 'https://example.test', { commandId: C }));
});
test('preview uses frozen profile and settings versions instead of accepting a changed quote', async () => {
  const n = rawNeed(),
    c = rawCandidate();
  const mock = {
    request: async () => ({
      data: {
        enabled: true,
        merchantName: '合成收款方',
        terms: '收费及退款约定',
        quotes: [
          {
            profileId: P,
            profileVersion: 1,
            settingsVersion: 2,
            totalFen: 11000,
            termsId: 'a'.repeat(64),
          },
        ],
      },
    }),
  };
  assert.equal((await m.repository(mock).preview(n, c)).acceptedTermsId, 'a'.repeat(64));
  await assert.rejects(m.repository(mock).preview(n, { ...c, settingsVersion: 3 }), /报价已变化/);
});
test('all native WXML handlers exist and the initial view does not request location or auto-opt-in', async () => {
  const h = harness();
  const tree = parseWxml(fs.readFileSync(path.join(root, 'pages/matching/index.wxml'), 'utf8'));
  for (const handler of eventHandlers(tree))
    assert.equal(typeof h.page[handler], 'function', handler);
  h.page.onShow();
  await h.flush();
  assert.equal(h.page.data.needs.length, 1);
  assert.equal(h.page.data.discovery, false);
  assert.equal(h.page.data.contact, false);
  assert.deepEqual(
    h.calls.map((c) => c.method),
    ['GET', 'GET'],
  );
});
test('a hidden page cannot receive stale private workspace data', async () => {
  let resolve;
  const h = harness({ request: () => new Promise((r) => (resolve = r)) });
  h.page.onShow();
  await h.flush();
  h.page.onHide();
  resolve({ data: rawWorkspace() });
  await h.flush();
  assert.equal(h.page.data.needs.length, 0);
});
test('changing account clears private state and invalidates a pending confirmation', async () => {
  const h = harness({ modalAnswers: [true] });
  h.page.onShow();
  await h.flush();
  h.page.setData({ selected: m.detail(rawNeed()) });
  const task = h.page.write(
    '/v1/matching/needs/' + N + '/runs',
    { expectedVersion: 1 },
    '确认',
    '确认',
  );
  h.switchActor();
  await task;
  assert.equal(h.page.data.selected, null);
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
});
test('network uncertainty retains the same command and blocks a second operation', async () => {
  let fail = true;
  const h = harness({
    modalAnswers: [true, true],
    request: (url, method, body) => {
      if (method === 'POST') {
        if (fail) throw { code: 'NETWORK_ERROR', message: '网络中断' };
        return { data: { resourceType: 'MATCHING_RUN', resourceId: P, needId: N, version: 1 } };
      }
      if (url === '/v1/matching') return { data: rawWorkspace() };
      if (url.includes('/receipts/')) return { data: { found: false, result: null } };
      return { data: rawNeed() };
    },
  });
  h.page.onShow();
  await h.flush();
  await h.page.write('/v1/matching/needs/' + N + '/runs', { expectedVersion: 1 }, '确认', '确认');
  const first = h.calls.find((c) => c.method === 'POST').body.commandId;
  assert.equal(h.page.data.pending.body.commandId, first);
  await h.page.write('/v1/matching/needs/' + N + '/runs', { expectedVersion: 1 }, '第二次', '确认');
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 1);
  await h.page.recover();
  assert.equal(h.page.data.pending.body.commandId, first);
  fail = false;
  await h.page.retry();
  assert.equal(h.calls.filter((c) => c.method === 'POST')[1].body.commandId, first);
  assert.equal(h.page.data.pending, null);
});

test('paid matching cannot convert while canonical collection preparation is disabled', async () => {
  const h = harness();
  h.page.setData({
    selected: m.detail(rawNeed()),
    conversion: { id: C, version: 1, candidate: rawCandidate() },
    preview: { enabled: false },
    eligibility: true,
  });
  await h.page.convert();
  assert.match(h.page.data.error, /收费准备尚未完成/);
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { parse } = require('../utils/scheduling-optimization');
const root = path.resolve(__dirname, '..');
const org = '11111111-1111-4111-8111-111111111111',
  court = '22222222-2222-4222-8222-222222222222';
const revision = () => ({
  id: org,
  eventVersion: 7,
  version: 3,
  capabilities: { canEditAllocations: true },
  fixtures: [{ fixtureKey: 'R1-P1', courtId: null, startsAt: null }],
});
const proposal = () => ({
  algorithm: 'BALANCED_SEARCH_V1',
  optimality: 'BOUNDED_HEURISTIC',
  eventVersion: 7,
  revisionVersion: 3,
  sourceHash: 'a'.repeat(64),
  status: 'COMPLETE',
  allocations: [{ fixtureKey: 'R1-P1', courtId: court, startsAt: '2026-11-01T10:00:00.000Z' }],
  unassigned: [],
  score: { assignedCount: 1, firstLastPenalty: 4 },
  checks: 20,
  limitReached: false,
});
const ticks = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
function device() {
  const requests = [],
    state = { rev: 1, listener: null, modal: null, resolve: null, holdPreview: false };
  const client = {
    sessionRevision: () => state.rev,
    hasSession: () => true,
    onSessionChange: (f) => {
      state.listener = f;
      return () => {};
    },
    request: async (url, method, body) => {
      requests.push({ url, method, body });
      if (url.endsWith('/optimization-preview'))
        return state.holdPreview
          ? new Promise((resolve) => {
              state.resolve = () => resolve({ data: proposal() });
            })
          : { data: proposal() };
      if (url.endsWith('/allocations')) return { data: {} };
      throw new Error('Unexpected fixture URL ' + url);
    },
  };
  const wx = createWx();
  wx.showModal = (o) => {
    state.modal = o;
  };
  const h = loadPage({
    root,
    route: 'pages/schedule/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client } },
  });
  h.page.orgId = org;
  h.page.eventId = org;
  h.page._alive = true;
  h.page._revision = revision();
  h.page.load = async () => {};
  return {
    h,
    state,
    requests,
    switchAccount() {
      state.rev++;
      state.listener && state.listener();
    },
    answer() {
      assert.ok(state.modal);
      state.modal.success({ confirm: true });
    },
  };
}
test('optimization DTO parser rejects stale, forged and incomplete suggestions', () => {
  const p = proposal(),
    r = revision();
  assert.equal(parse(p, r).unassigned, 0);
  for (const invalid of [
    { ...p, eventVersion: 8 },
    { ...p, allocations: [] },
    { ...p, allocations: [{ ...p.allocations[0], fixtureKey: 'R9-P9' }] },
    { ...p, status: 'PARTIAL' },
    { ...p, checks: 100001 },
  ])
    assert.throws(() => parse(invalid, r));
});
test('native draft applies only after explicit confirmation with the original versions', async () => {
  const d = device(),
    pending = d.h.page.autoAssign({ currentTarget: { dataset: { mode: 'all' } } });
  await ticks();
  assert.equal(d.requests.length, 1);
  assert.equal(d.requests[0].body.preserveAssigned, false);
  d.answer();
  await pending;
  const writes = d.requests.filter((r) => r.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.expectedEventVersion, 7);
  assert.equal(writes[0].body.expectedRevisionVersion, 3);
  assert.equal(writes[0].body.allocations[0].startsAt, proposal().allocations[0].startsAt);
});
test('account switch during preview never opens a confirmation or writes old private draft', async () => {
  const d = device();
  d.state.holdPreview = true;
  const pending = d.h.page.autoAssign();
  await ticks();
  d.switchAccount();
  d.state.resolve();
  await pending;
  assert.equal(d.state.modal, null);
  assert.equal(d.requests.filter((r) => r.method === 'PUT').length, 0);
});
test('unload or changed target while confirmation is open cannot apply stale allocations', async () => {
  for (const kind of ['unload', 'target', 'account']) {
    const d = device(),
      pending = d.h.page.autoAssign();
    await ticks();
    if (kind === 'unload') d.h.unload();
    else if (kind === 'target') d.h.page._revision = revision();
    else d.switchAccount();
    d.answer();
    await pending;
    assert.equal(d.requests.filter((r) => r.method === 'PUT').length, 0, kind);
  }
});

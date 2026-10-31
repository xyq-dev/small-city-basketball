const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const hash = 'a'.repeat(64);
function setup(group = false) {
  const wx = createWx({ modalAnswers: [true] });
  const h = loadPage({ root, route: 'pages/bracket/index', wx });
  const requests = [];
  let changed;
  const next = {
    roundNo: 2,
    sourceHash: hash,
    fixtures: [
      {
        fixtureKey: 'R2-P1',
        homeEntryId: id(4),
        awayEntryId: id(5),
        courtId: null,
        startsAt: null,
        endsAt: null,
      },
    ],
  };
  const d = {
    event: { version: 7 },
    ...(group ? { competition: { nextRound: next } } : { bracket: { nextRound: next } }),
  };
  const value = {
    status: 'READY',
    eventVersion: 7,
    revisionVersion: 3,
    sourceHash: hash,
    roundNo: 2,
    optimization: {
      algorithm: 'BALANCED_SEARCH_V1',
      optimality: 'BOUNDED_HEURISTIC',
      eventVersion: 7,
      revisionVersion: 3,
      sourceHash: 'b'.repeat(64),
      status: 'COMPLETE',
      allocations: [{ fixtureKey: 'R2-P1', courtId: id(6), startsAt: '2026-11-01T10:00:00.000Z' }],
      unassigned: [],
      score: { assignedCount: 1, firstLastPenalty: 4 },
      checks: 20,
      limitReached: false,
    },
  };
  const client = {
    hasSession: () => true,
    sessionRevision: () => 1,
    onSessionChange(fn) {
      changed = fn;
      return () => {};
    },
    async request(path, method, body) {
      requests.push({ path, method, body });
      return { data: value };
    },
  };
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page._alive = true;
  h.page.orgId = id(1);
  h.page.eventId = id(2);
  h.page._sourceHash = hash;
  h.page._data = d;
  h.page.setData({
    kind: group ? 'GROUP_KNOCKOUT' : 'SINGLE_ELIMINATION',
    next: {},
    courts: [{ id: id(6), name: '合成球场' }],
    fixtures: [
      { key: 'R2-P1', label: '实际晋级队', courtId: '', courtIndex: 0, date: '', time: '' },
    ],
  });
  return { ...h, requests, value, changed: () => changed?.() };
}
for (const group of [false, true])
  test(
    'X01 next-round suggestion uses real source hash and only fills native form ' + group,
    async () => {
      const h = setup(group);
      await h.page.optimizeNext();
      assert.equal(h.requests.length, 1);
      assert.equal(
        h.requests[0].path.endsWith(
          group ? '/group-optimization-preview' : '/knockout-optimization-preview',
        ),
        true,
      );
      assert.equal(h.requests[0].body.expectedSourceHash, hash);
      assert.equal(h.page.data.fixtures[0].date, '2026-11-01');
      assert.equal(h.page.data.fixtures[0].time, '18:00');
      assert.equal(h.page.data.fixtures[0].courtId, id(6));
      assert.match(h.page.data.notice, /正式发布/);
    },
  );
test('X01 stale next-round proof or unavailable court cannot overwrite the form', async () => {
  for (const field of ['sourceHash', 'court']) {
    const h = setup();
    if (field === 'sourceHash') h.value.sourceHash = 'c'.repeat(64);
    else h.value.optimization.allocations[0].courtId = id(90);
    await h.page.optimizeNext();
    assert.equal(h.page.data.fixtures[0].date, '');
    assert.ok(h.page.data.error);
    assert.equal(h.wx.calls.filter((c) => c.type === 'showModal').length, 0);
  }
});
test('X01 session change during suggestion confirmation clears private facts and prevents adoption', async () => {
  const h = setup();
  let finish;
  h.wx.showModal = (o) => {
    finish = o.success;
  };
  const pending = h.page.optimizeNext();
  await h.flush();
  h.changed();
  finish({ confirm: true });
  await pending;
  assert.equal(h.page._data, null);
  assert.equal(h.page.data.fixtures.length, 0);
});

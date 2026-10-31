const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tap = (dataset) => ({ currentTarget: { dataset } });
function setup({ rulesOnly = false, responseLost = false } = {}) {
  const h = loadPage({
    root,
    route: 'pages/match-exceptions/index',
    wx: createWx({ modalAnswers: [true, true, true] }),
  });
  let revision = 1,
    listener,
    lose = responseLost;
  const calls = [];
  const rules = {
    id: id(5),
    eventId: id(2),
    version: 1,
    forfeitWinPoints: 2,
    forfeitLossPoints: 0,
    cancellationPolicy: 'EXCLUDE_FROM_TABLE',
  };
  let work = rulesOnly
    ? { event: { id: id(2), version: 2, status: 'DRAFT' }, rules, canEdit: true }
    : {
        event: { id: id(2), version: 2, status: 'SCHEDULED' },
        match: { id: id(3), version: 1, status: 'SCHEDULED' },
        rules,
        active: null,
        requests: [],
        capabilities: { canPropose: true, canRevoke: false, canReview: false },
      };
  const client = {
    hasSession: () => true,
    revision: () => revision,
    onSessionChange(fn) {
      listener = fn;
      return () => {};
    },
    async request(p, method = 'GET', body) {
      calls.push({ path: p, method, body: structuredClone(body) });
      if (method !== 'GET') {
        if (lose) {
          lose = false;
          throw new Error('lost');
        }
        return { data: { requestId: id(9) } };
      }
      return { data: structuredClone(work) };
    },
  };
  h.requireLocal('utils/api.js').getClient = () => client;
  return {
    ...h,
    calls,
    start: async () => {
      h.page.onLoad({ orgId: id(1), ...(rulesOnly ? { eventId: id(2) } : { matchId: id(3) }) });
      await h.flush();
    },
    switchUser() {
      revision++;
      listener?.();
    },
    setWork(v) {
      work = v;
    },
    work: () => work,
  };
}
test('X02 native real page pins explicit rules and genuine forfeit side in POST body', async () => {
  const h = setup();
  await h.start();
  h.page.setData({ reason: '合成单场弃权原因', side: 'AWAY' });
  await h.page.propose(tap({}));
  const c = h.calls.find((c) => c.method === 'POST');
  assert.ok(c);
  assert.equal(c.path, '/v1/orgs/' + id(1) + '/matches/' + id(3) + '/exceptions/proposals');
  assert.equal(c.body.expectedEventVersion, 2);
  assert.equal(c.body.expectedMatchVersion, 1);
  assert.equal(c.body.forfeitingSide, 'AWAY');
  assert.equal(c.body.operation, 'DECLARE');
  assert.match(c.body.clientRequestId, /^[0-9a-f-]{36}$/);
  assert.equal(h.page.data.uncertain, false);
  assert.equal(h.page.data.reason, '');
});
test('X02 response-loss retry keeps the original immutable command ID and body', async () => {
  const h = setup({ responseLost: true });
  await h.start();
  h.page.setData({ reason: '合成取消比赛原因', kind: 'CANCELLED' });
  await h.page.propose(tap({}));
  assert.equal(h.page.data.uncertain, true);
  const first = h.calls.find((c) => c.method === 'POST');
  assert.equal(first.body.forfeitingSide, null);
  await h.page.propose(tap({}));
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 1);
  await h.page.retry();
  const writes = h.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(h.page.data.uncertain, false);
});
test('X02 draft rules persist both explicit point values with exact versions', async () => {
  const h = setup({ rulesOnly: true });
  await h.start();
  h.page.setData({ winPoints: '3', lossPoints: '0' });
  await h.page.saveRules();
  const c = h.calls.find((c) => c.method === 'PUT');
  assert.equal(c.body.expectedVersion, 1);
  assert.equal(c.body.expectedEventVersion, 2);
  assert.equal(c.body.forfeitWinPoints, 3);
  assert.equal(c.body.forfeitLossPoints, 0);
  assert.equal(c.body.cancellationPolicy, 'EXCLUDE_FROM_TABLE');
});
test('X02 malformed response fails closed and session switch clears private adjudications', async () => {
  const h = setup();
  await h.start();
  h.setWork({ ...h.work(), capabilities: { canPropose: 'yes' } });
  await h.page.load();
  assert.equal(h.page.data.canPropose, false);
  assert.equal(h.page.data.event, null);
  h.switchUser();
  assert.equal(h.page._raw, null);
  assert.equal(h.page.data.event, null);
  assert.equal(h.page.data.uncertain, false);
});
test('X02 unloading during a confirmation never sends a late write', async () => {
  const h = setup();
  await h.start();
  h.page.setData({ reason: '合成异步确认原因' });
  let finish;
  h.wx.showModal = (o) => {
    finish = o.success;
  };
  const pending = h.page.propose(tap({}));
  h.unload();
  finish({ confirm: true });
  await pending;
  assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
});

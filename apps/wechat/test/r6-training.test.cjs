const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const { renderWxml } = require('./helpers/native-preview.cjs');
const { trainingPathAllowed } = require('../utils/training-paths');
const root = path.resolve(__dirname, '..');
const U = '10000000-0000-4000-8000-000000000001',
  V = '10000000-0000-4000-8000-000000000002',
  C = '20000000-0000-4000-8000-000000000001',
  O = '30000000-0000-4000-8000-000000000001';
const pattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
function harness(
  name = 'training',
  handler = async () => ({ items: [], capabilities: { enabled: false } }),
) {
  let viewer = U,
    revision = 0;
  const listeners = new Set(),
    calls = [],
    storage = new Map();
  const client = {
    viewerId: () => viewer,
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      return {
        data:
          url === '/v1/auth/session'
            ? { user: { id: viewer }, organizations: [], teamContexts: [] }
            : await handler(url, method, body),
        meta: { requestId: 'synthetic-training' },
      };
    },
  };
  const api = { getClient: () => client, uuid: (v) => v };
  const h = loadPage({
    root,
    route: 'pages/' + name + '/index',
    wx: createWx({ storage }),
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad({});
  return {
    ...h,
    calls,
    storage,
    client,
    switchUser() {
      viewer = V;
      revision++;
      for (const f of listeners) f();
    },
  };
}
test('training paths are exact and reject arbitrary methods, ids and query parameters', () => {
  assert.equal(
    trainingPathAllowed('/v1/training/cohorts/' + C + '/enrollments', 'POST', {}, pattern),
    true,
  );
  assert.equal(
    trainingPathAllowed('/v1/training/cohorts/' + C, 'GET', { orgId: O }, pattern),
    false,
  );
  assert.equal(
    trainingPathAllowed('/v1/training/enrollments/' + C + '/commands', 'GET', {}, pattern),
    false,
  );
  assert.equal(
    trainingPathAllowed('/v1/orgs/' + O + '/training/provider/commands', 'POST', {}, pattern),
    true,
  );
  assert.equal(trainingPathAllowed('/v1/training/../../admin', 'POST', {}, pattern), false);
});
test('closed rollout displays no fake available classes', async () => {
  const h = harness();
  await h.page.load();
  assert.equal(h.page.data.enabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.page.data.items)), []);
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
});
test('adult and contract consent is explicit before signup', async () => {
  const h = harness();
  h.page.setData({ detail: { id: C, totalFen: 0 } });
  await h.page.enroll();
  assert.match(h.page.data.error, /成年/);
  assert.equal(h.calls.length, 0);
});
test('a hidden page cannot replace data with a late catalog response', async () => {
  let resolve;
  const h = harness('training', () => new Promise((r) => (resolve = r)));
  const work = h.page.load();
  h.page.onHide();
  resolve({
    items: [{ id: C, totalFen: 0, state: 'ENROLLING', sessions: [] }],
    capabilities: { enabled: true },
  });
  await work;
  assert.equal(h.page.data.items.length, 0);
});
test('unknown writes keep original command id and retry without duplication', async () => {
  let count = 0;
  const h = harness('training', async (url, method, body) => {
    if (method === 'POST' && ++count === 1) throw Error('synthetic connection lost');
    return { enrollmentId: C };
  });
  const t = h.requireLocal('utils/training.js');
  await assert.rejects(
    t.write(U, '/v1/training/cohorts/' + C + '/enrollments', { acceptedTermsId: O }),
    /connection lost/,
  );
  const first = h.calls.find((x) => x.method === 'POST').body.commandId;
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.equal(t.pending(U).body.commandId, first);
  await t.retry(U);
  assert.equal(h.calls.filter((x) => x.method === 'POST')[1].body.commandId, first);
  assert.equal(t.pending(U), null);
});
test('switching accounts stops replay and clears private page data', async () => {
  const h = harness('training', async () => {
    throw Error('uncertain');
  });
  const t = h.requireLocal('utils/training.js');
  await h.page.identify();
  h.page.setData({ enrollment: { id: C }, mine: [{ id: C }] });
  await assert.rejects(
    t.write(U, '/v1/training/enrollments/' + C + '/commands', {
      action: 'CONFIRM',
      expectedVersion: 1,
    }),
    /uncertain/,
  );
  h.switchUser();
  assert.equal(h.page.data.enrollment, null);
  assert.equal(h.page.data.mine.length, 0);
  await assert.rejects(t.retry(U), /身份/);
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 1);
});
test('both native pages have bound handlers, balanced templates, and no simulated success copy', () => {
  for (const name of ['training', 'training-manage']) {
    const h = harness(name);
    const source = fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
    parseWxml(source);
    for (const handler of eventHandlers(source))
      assert.equal(typeof h.page[handler], 'function', name + ' ' + handler);
    assert.doesNotMatch(source, /模拟支付|点击即到账|默认已审核/);
  }
});

test('native empty and unknown-refund layouts render without leaking hidden participant data', () => {
  for (const name of ['training', 'training-manage']) {
    const h = harness(name),
      source = fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
    const options = { root, pageDirectory: path.join(root, 'pages', name) };
    assert.doesNotThrow(() => renderWxml(source, h.page.data, options));
    if (name === 'training') {
      h.page.setData({
        enrollment: {
          id: C,
          state: 'PAID_UNALLOCATED',
          stateLabel: '已付款但未取得名额',
          amount: '¥1.01',
          capabilities: {},
          termsSnapshot: { termsText: '冻结合同' },
          entitlements: [],
          consumptions: [],
          refunds: [
            { id: O, status: 'UNKNOWN', stateLabel: '结果未知 · 保留退款额度', amount: '¥1.01' },
          ],
        },
      });
      const html = renderWxml(source, h.page.data, options);
      assert.match(html, /结果未知/);
      assert.match(html, /核对真实退款回执/);
      assert.doesNotMatch(html, /真实退款成功/);
    }
  }
});

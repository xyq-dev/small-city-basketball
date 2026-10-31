const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tap = (dataset) => ({ currentTarget: { dataset } });
const key = (actor) => 'scb-insurance-command-v1:' + actor;
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
function setup(route = 'insurance') {
  const h = loadPage({ root, route: 'pages/' + route + '/index', wx: createWx() });
  h.page._closed = false;
  h.page.setData({
    userId: id(1),
    orgId: id(2),
    entryId: id(3),
    memberId: id(4),
    quote: { quoteId: id(5) },
    consent: true,
  });
  const api = h.requireLocal('utils/api.js');
  h.calls = [];
  api.getClient = () => ({
    request: async (p, m, b) => {
      h.calls.push({ p, m, b: structuredClone(b) });
      throw Error('unknown');
    },
    sessionRevision: () => 0,
  });
  return h;
}
test('unknown purchase persists only original non-sensitive command and recovers same id and body', async () => {
  const h = setup();
  await h.page.purchase();
  const pending = structuredClone(h.wx.storage.get(key(id(1))));
  assert.equal(pending.kind, 'PURCHASE');
  assert.equal(h.page.data.pending.body.clientRequestId, pending.body.clientRequestId);
  assert.deepEqual(Object.keys(pending.body).sort(), [
    'acceptedTermsVersion',
    'clientRequestId',
    'quoteId',
  ]);
  assert.equal(h.page.data.quote.quoteId, id(5));
  let receipt = false;
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async (p, m, b) => {
      h.calls.push({ p, m, b: structuredClone(b) });
      if (!m) {
        receipt = true;
        return { data: { found: false } };
      }
      throw Error('still unknown');
    },
    sessionRevision: () => 0,
  });
  await h.page.recover();
  assert.equal(receipt, true);
  assert.deepEqual(h.calls.at(-1).b, pending.body);
  assert.deepEqual(h.wx.storage.get(key(id(1))), pending);
});
test('storage failure prevents purchase before network and hidden UUID cannot send', async () => {
  const h = setup();
  h.wx.setStorageSync = () => {
    throw Error('full');
  };
  await h.page.purchase();
  assert.equal(h.calls.length, 0);
  const h2 = setup(),
    wait = deferred();
  h2.requireLocal('utils/ui.js').uuid = () => wait.promise;
  const task = h2.page.purchase();
  h2.page.onHide();
  wait.resolve(id(9));
  await task;
  assert.equal(h2.calls.length, 0);
  assert.equal(h2.wx.storage.size, 0);
  assert.equal(h2.page.data.quote, null);
  assert.equal(h2.page.data.busy, false);
});
test('late old-account response cannot clear another account or replacement command', async () => {
  const h = setup(),
    wait = deferred();
  h.requireLocal('utils/api.js').getClient = () => ({
    request: () => wait.promise,
    sessionRevision: () => 0,
  });
  const task = h.page.purchase();
  await new Promise(setImmediate);
  h.page.onHide();
  const replacement = {
    kind: 'PURCHASE',
    path: '/v1/insurance/purchases',
    body: {
      clientRequestId: id(99),
      quoteId: id(5),
      acceptedTermsVersion: 'insurance-purchase-consent-v1',
    },
  };
  h.wx.storage.set(key(id(1)), replacement);
  h.wx.storage.set(key(id(9)), replacement);
  wait.resolve({ data: { orderId: id(8) } });
  await task;
  assert.deepEqual(h.wx.storage.get(key(id(1))), replacement);
  assert.deepEqual(h.wx.storage.get(key(id(9))), replacement);
  assert.equal(h.page.data.workspace, null);
  assert.equal(h.page.data.userId, '');
});
test('cancel confirmation cannot authorize after hiding or changing account', async () => {
  const h = setup(),
    wait = deferred();
  h.page.setData({ quote: null, workspace: { orders: [{ id: id(8), version: 2 }] } });
  h.wx.showModal = (o) => wait.promise.then(() => o.success({ confirm: true }));
  const task = h.page.command(tap({ id: id(8), type: 'REQUEST_CANCELLATION' }));
  h.page.onHide();
  wait.resolve();
  await task;
  assert.equal(h.calls.length, 0);
  assert.equal(h.wx.storage.size, 0);
});
test('precheck requires explicit subject consent and reviewer confirmation remains lifecycle bound', async () => {
  const h = setup('qualification-precheck');
  h.page.setData({
    consent: false,
    workspace: {
      canReview: false,
      participants: [{ memberId: id(4), canRequest: true, materialVersion: 1 }],
    },
  });
  await h.page.request(tap({ id: id(4) }));
  assert.equal(h.calls.length, 0);
  h.page.setData({ consent: true });
  await h.page.request(tap({ id: id(4) }));
  const r = h.wx.storage.get(key(id(1)));
  assert.equal(r.kind, 'QUAL_REQUEST');
  assert.equal(r.body.acceptedTermsVersion, 'qualification-precheck-v1');
  assert.equal(r.body.memberId, id(4));
  const h2 = setup('qualification-precheck'),
    wait = deferred();
  h2.page.setData({
    workspace: {
      canReview: true,
      participants: [
        { memberId: id(4), materialVersion: 1, requestId: id(7), requestCurrent: true },
      ],
    },
  });
  h2.wx.showModal = (o) => wait.promise.then(() => o.success({ confirm: true }));
  const task = h2.page.review(tap({ id: id(4), decision: 'APPROVED' }));
  h2.page.onHide();
  wait.resolve();
  await task;
  assert.equal(h2.calls.length, 0);
});
test('journal rejects document/identity injection and arbitrary endpoints', () => {
  const h = setup(),
    r = h.requireLocal('utils/insurance-recovery.js');
  const v = {
    kind: 'PURCHASE',
    path: '/v1/insurance/purchases',
    body: {
      clientRequestId: id(6),
      quoteId: id(5),
      acceptedTermsVersion: 'insurance-purchase-consent-v1',
    },
  };
  assert.equal(r.valid(v), true);
  assert.equal(r.valid({ ...v, path: 'https://evil.test' }), false);
  assert.equal(r.valid({ ...v, body: { ...v.body, identityNumber: '990101201201010010' } }), false);
});

test('private policy PDF uses tracked temporary files and removes them on hide', async () => {
  const h = setup(),
    paths = [],
    opened = [];
  h.page.onLoad({});
  h.wx.env = { USER_DATA_PATH: '/test-private' };
  h.wx.getFileSystemManager = () => ({
    writeFile: (o) => {
      paths.push(o.filePath);
      o.success();
    },
    unlink: (o) => o.success(),
  });
  h.wx.openDocument = (o) => opened.push(o);
  h.requireLocal('utils/api.js').getClient = () => ({
    download: async () => ({
      data: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]).buffer,
      contentType: 'application/pdf',
    }),
    sessionRevision: () => 0,
  });
  await h.page.document(tap({ id: id(8) }));
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/test-private\/scb-participant-insurance-/);
  assert.equal(opened[0].showMenu, false);
  assert.equal(
    [...h.wx.storage.values()].some((v) => Array.isArray(v) && v.includes(paths[0])),
    true,
  );
  h.page.onHide();
  assert.equal(
    [...h.wx.storage.values()].some((v) => Array.isArray(v) && v.includes(paths[0])),
    false,
  );
});

test('exhausted unknown insurance resumes only a REFRESH of the original order and keeps the recovery id', async () => {
  const h = setup();
  h.page.setData({
    quote: null,
    workspace: {
      enabled: true,
      products: [],
      orders: [
        {
          id: id(8),
          version: 3,
          canRefresh: true,
          pendingOperation: id(9),
          paymentStatus: 'PAID',
          policyStatus: 'CANCEL_PENDING',
          premiumFen: 100,
          coverageStartDate: '2028-01-01',
          coverageEndDate: '2028-01-02',
        },
      ],
    },
  });
  const fs = require('node:fs');
  const { renderWxml } = require('./helpers/native-preview.cjs');
  const html = renderWxml(
    fs
      .readFileSync(path.join(root, 'pages/insurance/index.wxml'), 'utf8')
      .replace(/<scb-header[^>]*\/>/, ''),
    h.page.data,
  );
  assert.ok(html.includes('自动核对已暂停'));
  assert.ok(html.includes('不会重复投保或退保'));
  await h.page.command(tap({ id: id(8), type: 'REFRESH' }));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].p, '/v1/insurance/orders/' + id(8) + '/commands');
  assert.equal(h.calls[0].b.type, 'REFRESH');
  assert.equal(h.calls[0].b.expectedVersion, 3);
  const saved = h.wx.storage.get(key(id(1)));
  assert.equal(saved.kind, 'COMMAND');
  assert.equal(saved.body.clientRequestId, h.calls[0].b.clientRequestId);
  assert.deepEqual(Object.keys(saved.body).sort(), ['clientRequestId', 'expectedVersion', 'type']);
});

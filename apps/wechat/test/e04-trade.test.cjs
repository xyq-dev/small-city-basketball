const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const actor = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  order = '20000000-0000-4000-8000-000000000001',
  command = '30000000-0000-4000-8000-000000000001',
  attempt = '40000000-0000-4000-8000-000000000001';
function clientHarness() {
  const memory = new Map(),
    calls = [];
  let viewer = actor,
    fail = false,
    writeDenied = false;
  const wx = {
    getStorageSync: (k) => memory.get(k),
    setStorageSync: (k, v) => {
      if (writeDenied) throw Error('synthetic storage denied');
      memory.set(k, JSON.parse(JSON.stringify(v)));
    },
    removeStorageSync: (k) => memory.delete(k),
  };
  const api = {
    getClient: () => ({
      viewerId: () => viewer,
      request: async (path, method, body) => {
        calls.push({ path, method, body });
        if (fail) throw Error('synthetic connection lost');
        return {
          data: path.includes('/receipts/')
            ? { found: true, result: { orderId: order, attemptId: attempt } }
            : { orderId: order, attemptId: attempt },
        };
      },
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/trade-order/client.js'), 'utf8'), {
    module,
    exports: module.exports,
    require: () => api,
    wx,
  });
  return {
    client: module.exports,
    memory,
    calls,
    wx,
    setViewer: (v) => (viewer = v),
    setFailure: (v) => (fail = v),
    setStorageDenied: (v) => (writeDenied = v),
  };
}
function page(route, trade = {}, wx = {}) {
  let definition;
  const ui = {
    message: (e) => e.message,
    close() {},
    uuid: async () => command,
    begin: () => 1,
    live: () => true,
    session: async () => ({ user: { id: actor } }),
    today: () => '2026-10-31',
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', route, 'index.js'), 'utf8'), {
    Page: (v) => (definition = v),
    require: (n) => (n.endsWith('/ui') ? ui : trade),
    wx,
  });
  const p = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  return p;
}
test('funds intent survives connection loss; retry keeps original route/body/NO and never persists wx.login code', async () => {
  const h = clientHarness();
  h.setFailure(true);
  await assert.rejects(
    h.client.execute(
      actor,
      '/orders/' + order + '/payments',
      { clientRequestId: command, expectedVersion: 1, channel: 'JSAPI' },
      'SENSITIVE_ONETIME_CODE',
    ),
  );
  const saved = h.client.pending(actor);
  assert.equal(saved.body.clientRequestId, command);
  assert.equal(JSON.stringify([...h.memory.values()]).includes('SENSITIVE_ONETIME_CODE'), false);
  h.setFailure(false);
  await h.client.retry(actor, 'FRESH_ONETIME_CODE');
  assert.equal(h.calls[0].body.clientRequestId, h.calls[1].body.clientRequestId);
  assert.equal(h.calls[1].body.code, 'FRESH_ONETIME_CODE');
  assert.equal(h.client.pending(actor), null);
});
test('intent journal cannot be overwritten or dispatched under a different actor', async () => {
  const h = clientHarness();
  h.setFailure(true);
  await assert.rejects(
    h.client.execute(actor, '/orders/' + order + '/refunds', {
      clientRequestId: command,
      expectedVersion: 1,
      amountFen: 100,
      reason: '合成退款理由',
    }),
  );
  const count = h.calls.length;
  await assert.rejects(
    h.client.execute(actor, '/orders/' + order + '/refunds', { clientRequestId: order }),
  );
  assert.equal(h.calls.length, count);
  h.setViewer(other);
  await assert.rejects(h.client.retry(actor));
  assert.equal(h.client.pending(other), null);
  assert.equal(h.calls.length, count);
});
test('storage write denial fails before any money request', async () => {
  const h = clientHarness();
  h.setStorageDenied(true);
  await assert.rejects(
    h.client.execute(actor, '/orders/' + order + '/payments', {
      clientRequestId: command,
      expectedVersion: 1,
      channel: 'NATIVE',
    }),
  );
  assert.equal(h.calls.length, 0);
});
test('recovery queries original permanent command receipt before dropping local barrier', async () => {
  const h = clientHarness();
  h.setFailure(true);
  await assert.rejects(
    h.client.execute(actor, '/orders/' + order + '/refunds', {
      clientRequestId: command,
      expectedVersion: 1,
      amountFen: 100,
      reason: '合成退款理由',
    }),
  );
  h.setFailure(false);
  await h.client.recover(actor);
  assert.equal(h.calls.at(-1).path, '/v1/trades/receipts/' + command);
  assert.equal(h.calls.at(-1).method, undefined);
  assert.equal(h.client.pending(actor), null);
});
test('storage tampering with arbitrary endpoint or raw code is rejected', () => {
  const h = clientHarness(),
    key = 'scb-trade-pending-v1:' + actor;
  h.memory.set(key, { actor, path: '/auth/logout', body: { clientRequestId: command } });
  assert.throws(() => h.client.pending(actor));
  h.memory.set(key, {
    actor,
    path: '/orders/' + order + '/payments',
    body: { clientRequestId: command, code: 'do-not-persist' },
  });
  assert.throws(() => h.client.pending(actor));
});
test('wx.requestPayment success leaves actual PAID unchanged and asks for server verification', async () => {
  let invoked = 0;
  const p = page(
    'trade-order',
    {},
    {
      requestPayment: (o) => {
        invoked++;
        o.success({});
      },
    },
  );
  p._alive = p._visible = true;
  p.setData({
    order: {
      paidFen: 0,
      attempts: [
        {
          id: attempt,
          checkout: {
            mode: 'JSAPI',
            timeStamp: '123',
            nonceStr: 'n',
            package: 'prepay_id=synthetic',
            signType: 'RSA',
            paySign: 'synthetic',
          },
        },
      ],
    },
  });
  await p.continueJsapi({ currentTarget: { dataset: { id: attempt } } });
  assert.equal(invoked, 1);
  assert.equal(p.data.order.paidFen, 0);
  assert.match(p.data.message, /待服务端核实/);
  p.onHide();
  assert.equal(p.data.order, null);
  assert.equal(p.data.consent, false);
});
test('native checkout displays original verified link without claiming payment success', () => {
  let copied;
  const p = page('trade-order', {}, { setClipboardData: (o) => (copied = o.data) });
  p.setData({
    order: {
      paidFen: 0,
      attempts: [
        {
          id: attempt,
          checkout: { mode: 'NATIVE', codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic' },
        },
      ],
    },
  });
  p.copy({ currentTarget: { dataset: { id: attempt } } });
  assert.equal(copied, 'weixin://wxpay/bizpayurl?pr=synthetic');
  assert.equal(p.data.order.paidFen, 0);
});
test('unbound historical source displays free state and never creates an after-the-fact invoice', async () => {
  const calls = [];
  const p = page('trade-order', {
    id: (v) => v,
    pending: () => null,
    read: async (path) => {
      calls.push(path);
      return { orderId: null };
    },
  });
  p.onLoad({ kind: 'LOCAL_BOOKING', sourceId: order });
  p._visible = true;
  await p.load();
  assert.equal(p.data.noCharge, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/source\?/);
  assert.equal(p.data.order, null);
});
test('new funds templates compile and each event handler exists', () => {
  for (const route of ['trade-order', 'trade-manage']) {
    const p = page(route),
      source = fs.readFileSync(path.join(root, 'pages', route, 'index.wxml'), 'utf8');
    const tree = parseWxml(source);
    for (const name of eventHandlers(tree))
      assert.equal(typeof p[name], 'function', route + ':' + name);
    assert.match(source, /disabled="\{\{busy/);
  }
});

test('account reset clears private refund evidence and unpublished fee drafts before another actor can load', () => {
  const orderPage = page('trade-order');
  orderPage.actor = actor;
  orderPage.setData({
    amount: '12345',
    reason: 'PRIVATE_REFUND_REASON',
    evidence: 'PRIVATE_EVIDENCE',
    pendingAcknowledged: true,
    order: { id: order },
  });
  orderPage.onSessionReset();
  assert.equal(orderPage.data.reason, '');
  assert.equal(orderPage.data.evidence, '');
  assert.equal(orderPage.data.amount, '');
  assert.equal(orderPage.data.order, null);
  assert.equal(orderPage.data.pendingAcknowledged, false);
  const manager = page('trade-manage');
  manager.actor = actor;
  manager.orgId = order;
  manager.setData({
    orgId: order,
    sourceId: order,
    amount: '12345',
    termsText: 'PRIVATE_UNPUBLISHED_FEE_DRAFT',
    reason: 'PRIVATE_REVIEW_REASON',
  });
  manager.onSessionReset();
  assert.equal(manager.data.termsText, '');
  assert.equal(manager.data.reason, '');
  assert.equal(manager.data.orgId, '');
  assert.equal(manager.data.sourceId, '');
  assert.equal(manager.actor, '');
});

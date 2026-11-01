const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..'),
  model = require('../utils/sponsor-commerce');
const actor = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  org = '20000000-0000-4000-8000-000000000001',
  command = '30000000-0000-4000-8000-000000000001';
function harness() {
  const memory = new Map(),
    calls = [];
  let viewer = actor,
    fail = false,
    deny = false,
    found = true;
  const wx = {
    getStorageSync: (k) => memory.get(k),
    setStorageSync: (k, v) => {
      if (deny) throw Error('storage denied');
      memory.set(k, structuredClone(v));
    },
    removeStorageSync: (k) => memory.delete(k),
  };
  const client = {
    viewerId: () => viewer,
    request: async (p, m, b) => {
      calls.push({ p, m, b });
      if (fail) throw Error('connection lost');
      return {
        data: p.includes('/receipts/') ? { found, result: { id: command } } : { id: command },
      };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/sponsor-commerce-client.js'), 'utf8'), {
    module,
    exports: module.exports,
    wx,
    require: (p) => (p === './api' ? { getClient: () => client } : model),
  });
  return {
    api: module.exports,
    memory,
    calls,
    viewer: (v) => (viewer = v),
    fail: (v) => (fail = v),
    deny: (v) => (deny = v),
    found: (v) => (found = v),
  };
}
test('currency parsing never rounds fractional fen and rejects scientific/unsafe amounts', () => {
  assert.equal(model.fen('100.03'), 10003);
  assert.equal(model.money(10003), '100.03');
  for (const v of ['1.001', '1e4', '-1', 'Infinity', '1000000.01'])
    assert.throws(() => model.fen(v));
});
test('strict route allowlist supports only intended methods, UUIDs and no queries', () => {
  const uuid = '[0-9a-f-]{36}',
    q = {};
  for (const route of ['', '/statements', '/orders/' + command, '/receipts/' + command])
    assert.equal(
      model.sponsorCommercePathAllowed(
        '/v1/orgs/' + org + '/sponsor-commerce' + route,
        'GET',
        q,
        uuid,
      ),
      true,
    );
  assert.equal(
    model.sponsorCommercePathAllowed(
      '/v1/orgs/' + org + '/sponsor-commerce/orders/' + command + '/channel',
      'POST',
      q,
      uuid,
    ),
    true,
  );
  assert.equal(
    model.sponsorCommercePathAllowed(
      '/v1/orgs/' + org + '/sponsor-commerce/orders/' + command + '/channel',
      'GET',
      q,
      uuid,
    ),
    false,
  );
  assert.equal(
    model.sponsorCommercePathAllowed(
      '/v1/orgs/' + org + '/sponsor-commerce',
      'GET',
      { org: 'bad' },
      uuid,
    ),
    false,
  );
});
test('unknown results preserve actor-scoped original command and block replacement', async () => {
  const h = harness();
  h.fail(true);
  await assert.rejects(h.api.send(org, '/path', { commandId: command }));
  assert.equal(h.api.pending(org).commandId, command);
  await assert.rejects(h.api.send(org, '/path', { commandId: other }));
  assert.equal(h.calls.length, 1);
  h.viewer(other);
  assert.equal(h.api.pending(org), null);
  h.viewer(actor);
  h.fail(false);
  h.found(false);
  assert.equal((await h.api.resolve(org)).found, false);
  assert.ok(h.api.pending(org));
  h.found(true);
  await h.api.resolve(org);
  assert.equal(h.api.pending(org), null);
});
test('storage failure prevents channel mutation and cancellation uses original receipt identity', async () => {
  const h = harness();
  h.deny(true);
  await assert.rejects(h.api.send(org, '/path', { commandId: command }));
  assert.equal(h.calls.length, 0);
  h.deny(false);
  h.fail(true);
  await assert.rejects(h.api.send(org, '/path', { commandId: command }));
  h.fail(false);
  await h.api.resolve(org, true);
  assert.equal(
    h.calls.at(-1).p,
    '/v1/orgs/' + org + '/sponsor-commerce/receipts/' + command + '/cancel',
  );
  assert.equal(h.calls.at(-1).m, 'POST');
});
test('commercial page template has handlers for every action and hides private rows on leave', () => {
  const module = { exports: {} },
    ui = { close: () => {} };
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/sponsor-commerce/index.js'), 'utf8'), {
    module,
    exports: module.exports,
    Page: (p) => (page = p),
    require: (p) => (p.endsWith('/ui') ? ui : p.endsWith('/sponsor-commerce') ? model : {}),
  });
  const tree = parseWxml(
    fs.readFileSync(path.join(root, 'pages/sponsor-commerce/index.wxml'), 'utf8'),
  );
  for (const name of eventHandlers(tree)) assert.equal(typeof page[name], 'function', name);
  const instance = {
    ...page,
    data: {
      ...page.data,
      detail: { private: true },
      contracts: [{ private: true }],
      orders: [],
      beneficiaries: [],
      statements: [],
      busy: true,
    },
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  instance.onHide();
  assert.equal(instance.data.detail, null);
  assert.equal(instance.data.contracts.length, 0);
  assert.equal(instance.data.busy, false);
});

test('ordinary advertiser loads its authorized inbox without manager membership or typed organization id', async () => {
  let page;
  const calls = [],
    sent = [];
  const user = actor;
  const transport = {
    request: async (path) => {
      calls.push(path);
      if (path === '/v1/me/sponsor-commerce')
        return {
          data: {
            organizations: [{ id: org, name: '已分配合同机构', role: 'ADVERTISER' }],
            contracts: [],
          },
        };
      return {
        data: {
          enabled: true,
          canManage: false,
          canFinance: false,
          userId: user,
          contracts: [
            {
              id: command,
              payer_user_id: user,
              status: 'SIGNED',
              version: 5,
              total_fen: 10003,
              title: '本人广告合同',
              contractHash: 'a'.repeat(64),
            },
          ],
          orders: [],
          beneficiaries: [],
          receiverOptions: [],
        },
      };
    },
  };
  const ui = {
    begin: () => ({}),
    live: () => true,
    session: async () => ({ user: { id: user }, organizations: [], teamContexts: [] }),
    message: (e) => e.message,
    uuid: async () => other,
    close: () => {},
  };
  const client = {
    pending: () => null,
    send: async (_org, path, body) => {
      sent.push({ org: _org, path, body });
      return { id: command };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/sponsor-commerce/index.js'), 'utf8'), {
    Page: (p) => (page = p),
    require: (p) =>
      p.endsWith('/api')
        ? { getClient: () => transport }
        : p.endsWith('/ui')
          ? ui
          : p.endsWith('/sponsor-commerce-client')
            ? client
            : model,
  });
  const instance = {
    ...page,
    data: structuredClone(page.data),
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  instance.onLoad({});
  await instance.load();
  assert.equal(instance._org, org);
  assert.equal(instance.data.canManage, false);
  assert.equal(instance.data.contracts[0].title, '本人广告合同');
  assert.equal(calls[0], '/v1/me/sponsor-commerce');
  await instance.contractAction({ currentTarget: { dataset: { id: command, action: 'ORDER' } } });
  assert.equal(sent[0].path, '/v1/orgs/' + org + '/sponsor-commerce/orders');
  assert.equal(sent[0].body.chargeConsent, true);
  assert.equal(sent[0].body.acceptedContractHash, 'a'.repeat(64));
  assert.equal(
    model.sponsorCommercePathAllowed('/v1/me/sponsor-commerce', 'GET', {}, '[a-f0-9-]{36}'),
    true,
  );
  assert.equal(
    model.sponsorCommercePathAllowed('/v1/me/sponsor-commerce', 'POST', {}, '[a-f0-9-]{36}'),
    false,
  );
});

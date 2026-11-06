const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { parseWxml } = require('./helpers/wxml.cjs');

const root = path.resolve(__dirname, '..');
const actor = '10000000-0000-4000-8000-000000000001';
const otherActor = '10000000-0000-4000-8000-000000000002';
const fixtures = [
  require('../../../tests/mini-program/fixtures/int01-governance-cancel-pending.json'),
  require('../../../tests/mini-program/fixtures/int01-review-cancel-pending.json'),
];
function setup(fixture, { confirm = true, completed = false, viewer = actor, cancelError } = {}) {
  let revision = 1;
  const listeners = new Set();
  const calls = [];
  const record = structuredClone(fixture.data.pending);
  const storageKey = 'scb.x18.pending.v1:' + record.userId + ':' + record.kind;
  const wx = createWx({
    storage: new Map([[storageKey, record]]),
    modalAnswers: [confirm],
  });
  const client = {
    sessionRevision: () => revision,
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: structuredClone(body) });
      if (method === 'GET') throw { status: 404, code: 'NOT_FOUND' };
      if (cancelError) throw cancelError;
      return {
        data: { commandId: record.commandId, completed, cancelled: !completed },
      };
    },
  };
  const h = loadPage({
    root,
    route: fixture.route,
    wx,
    modules: {
      [path.join(root, 'utils/api.js')]: {
        getClient: () => client,
        uuid: (value) => value,
        publicId: (value) => value,
      },
    },
  });
  h.page.onLoad({});
  h.page._viewer = viewer;
  h.requireLocal('utils/ui.js').begin(h.page);
  h.page.setData(structuredClone(fixture.data));
  let reloads = 0;
  h.page.load = async () => reloads++;
  return {
    ...h,
    calls,
    record,
    storageKey,
    get reloads() {
      return reloads;
    },
    changeActor() {
      revision++;
      for (const listener of [...listeners]) listener();
    },
  };
}
const preview = (h, width = 390) =>
  buildPreview({ root, route: h.page.route, data: h.page.data, width, height: 844 });
function cancelButton(h, width = 390) {
  return [...preview(h, width).phone.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((match) => match[1].includes('data-cancel="true"'))
    .map((match) => ({ attributes: match[1], text: match[2] }));
}
function invokeCancel(h, { allowDisabled = false } = {}) {
  const buttons = cancelButton(h);
  assert.equal(buttons.length, 1, 'The pending state must expose one explicit cancellation action');
  const button = buttons[0];
  assert.equal(button.text, '明确放弃原请求');
  if (!allowDisabled) assert.doesNotMatch(button.attributes, /\bdisabled\b/);
  const handler = button.attributes.match(/data-mini-bindtap="([^"]+)"/)[1];
  assert.equal(handler, 'recover');
  const cancel = button.attributes.match(/data-cancel="([^"]+)"/)[1];
  return h.page[handler]({ currentTarget: { dataset: { cancel } } });
}
async function invokeQuery(h) {
  const rendered = preview(h);
  assert.match(rendered.phone, />查询原操作<\/button>/);
  const feedback = rendered.components.find(
    (component) =>
      component.tag === 'figma-feedback' && component.properties.actionLabel === '查询原操作',
  );
  assert.ok(feedback, 'The original query component remains reachable');
  const tree = parseWxml(fs.readFileSync(path.join(root, h.page.route + '.wxml'), 'utf8'));
  function find(node) {
    if (node.name === 'figma-feedback' && node.attributes['action-label'] === '查询原操作')
      return node;
    return (node.children || []).map(find).find(Boolean);
  }
  const handler = find(tree).attributes['bind:action'];
  assert.equal(handler, 'recover');
  const component = loadComponent({ root, route: feedback.path, properties: feedback.properties });
  let operation;
  component.instance.triggerEvent = (name) => {
    assert.equal(name, 'action');
    operation = h.page[handler]({ currentTarget: { dataset: {} } });
  };
  component.instance.action();
  assert.ok(operation);
  await operation;
}

for (const fixture of fixtures) {
  const name = fixture.route.split('/')[1];
  test(name + ': pending cancellation renders with the existing action class at all widths', () => {
    const h = setup(fixture);
    for (const width of [320, 390, 430]) {
      const buttons = cancelButton(h, width);
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0].text, '明确放弃原请求');
      assert.match(buttons[0].attributes, /class="figma-action figma-action--ghost"/);
      assert.doesNotMatch(buttons[0].attributes, /\bdisabled\b/);
    }
    h.page.setData({ pending: null });
    assert.equal(cancelButton(h).length, 0);
  });
  test(
    name + ': rendered query 404 keeps the lock, then confirmed cancellation posts the original ID',
    async () => {
      const h = setup(fixture);
      await invokeQuery(h);
      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.calls[0], {
        url: '/v1/me/governance/operations/' + h.record.commandId,
        method: 'GET',
        body: undefined,
      });
      assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
      assert.deepEqual(h.page.data.pending, h.record);
      assert.match(h.page.data.error, /保护记录保留/);
      assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 0);
      await invokeCancel(h);
      assert.deepEqual(h.calls[1], {
        url: '/v1/me/governance/operations/' + h.record.commandId + '/cancel',
        method: 'POST',
        body: { reason: '用户明确放弃未确认操作' },
      });
      assert.equal(h.calls.length, 2);
      assert.equal(h.wx.storage.has(h.storageKey), false);
      assert.equal(h.page.data.pending, null);
      assert.equal(h.reloads, 1);
      assert.match(h.page.data.notice, /迟到请求不会执行/);
      const modal = h.wx.calls.find((call) => call.type === 'showModal');
      assert.equal(modal.title, '明确放弃未确认操作');
      assert.match(modal.content, /已生效的请求不会撤销/);
    },
  );
  test(
    name + ': declining cancellation leaves the original pending record and sends nothing',
    async () => {
      const h = setup(fixture, { confirm: false });
      await invokeCancel(h);
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
      assert.deepEqual(h.page.data.pending, h.record);
      assert.equal(h.reloads, 0);
    },
  );
  test(
    name + ': busy disables the real button and the existing handler refuses a forced callback',
    async () => {
      const h = setup(fixture);
      h.page.setData({ busy: true });
      assert.match(cancelButton(h)[0]?.attributes || '', /\bdisabled\b/);
      await invokeCancel(h, { allowDisabled: true });
      assert.equal(h.calls.length, 0);
      assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 0);
      assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
    },
  );
  test(name + ': a different current actor cannot cancel the original actor journal', async () => {
    const h = setup(fixture, { viewer: otherActor });
    await invokeCancel(h);
    assert.equal(h.calls.length, 0);
    assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 0);
    assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
    assert.equal(h.page.data.pending, null);
  });
  test(
    name + ': no current actor cannot send cancellation or release the original journal',
    async () => {
      const h = setup(fixture, { viewer: null });
      await invokeCancel(h);
      assert.equal(h.calls.length, 0);
      assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 0);
      assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
      assert.deepEqual(h.page.data.pending, h.record);
    },
  );
  test(
    name +
      ': an unknown cancellation result retains the original lock without a replacement request',
    async () => {
      const h = setup(fixture, { cancelError: { status: 503, code: 'UNAVAILABLE' } });
      await invokeCancel(h);
      assert.equal(h.calls.length, 1);
      assert.equal(
        h.calls[0].url,
        '/v1/me/governance/operations/' + h.record.commandId + '/cancel',
      );
      assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
      assert.deepEqual(h.page.data.pending, h.record);
      assert.equal(h.page.data.busy, false);
      assert.equal(h.reloads, 0);
      assert.equal(cancelButton(h).length, 1);
    },
  );
  for (const boundary of ['account change', 'page hide']) {
    test(name + ': late confirmation after ' + boundary + ' cannot send cancellation', async () => {
      const h = setup(fixture);
      let confirm;
      h.wx.showModal = (options) => {
        confirm = options.success;
      };
      const operation = invokeCancel(h);
      assert.equal(typeof confirm, 'function');
      if (boundary === 'account change') h.changeActor();
      else h.page.onHide();
      confirm({ confirm: true });
      await operation;
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.wx.storage.get(h.storageKey), h.record);
      assert.equal(h.page.data.pending, null);
      assert.equal(cancelButton(h).length, 0);
    });
  }
  test(
    name + ': a server-completed receipt releases protection without undoing its result',
    async () => {
      const h = setup(fixture, { completed: true });
      await invokeCancel(h);
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].method, 'POST');
      assert.equal(
        h.calls[0].url,
        '/v1/me/governance/operations/' + h.record.commandId + '/cancel',
      );
      assert.equal(h.wx.storage.has(h.storageKey), false);
      assert.equal(h.page.data.pending, null);
      assert.match(h.page.data.notice, /原请求已经生效.*没有撤销既有结果/);
      assert.doesNotMatch(h.page.data.notice, /原操作已明确取消/);
      assert.equal(h.reloads, 1);
    },
  );
}

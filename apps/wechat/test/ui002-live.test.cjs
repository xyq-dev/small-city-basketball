const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const { buildPreview } = require('./helpers/native-preview.cjs');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function live() {
  const calls = [];
  const wx = createWx({ modalAnswers: [true] });
  const h = loadPage({ root, route: 'pages/live-studio/index', wx });
  h.page._alive = true;
  h.page._visible = true;
  h.page.org = id(1);
  h.page.match = id(2);
  h.page.setData({
    capabilities: { providerReady: false, blockers: ['正式推流未核验'] },
    cameraReady: true,
    selected: [id(3)],
    session: { id: id(4), version: 1, desired: 'DRAFT' },
  });
  h.requireLocal('utils/api.js').getClient = () => ({
    viewerId: () => id(5),
    sessionRevision: () => 0,
    request: async (p, m, b) => {
      calls.push({ p, m, b });
      throw Error('合成未知结果');
    },
  });
  return { ...h, calls };
}
test('closed live capability blocks both creation and capture without persisting new commands', async () => {
  const h = live();
  await h.page.create();
  await h.page.action({ currentTarget: { dataset: { type: 'START' } } });
  assert.equal(h.calls.length, 0);
  assert.equal(h.wx.storage.size, 0);
  assert.match(h.page.data.error, /正式直播能力尚未就绪/);
});
test('closed live capability retains exact original pending command recovery', async () => {
  const h = live();
  const original = {
    clientRequestId: id(6),
    type: 'STOP',
    sessionId: id(4),
    expectedVersion: 1,
    reason: '合成停流核对',
  };
  h.page._pending = original;
  h.page.setData({ pending: true });
  await h.page.retry();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].b)), original);
  assert.equal(h.page.data.pending, true);
});
test('live workflow tabs only move to known local sections and never issue business requests', () => {
  const h = live();
  const scrolls = [];
  h.wx.pageScrollTo = (v) => scrolls.push(v);
  h.page.changeSection({ detail: { key: 'channels' } });
  assert.equal(h.page.data.activeSection, 'channels');
  assert.equal(scrolls[0].selector, '#live-channels');
  h.page.changeSection({ detail: { key: 'not-a-section' } });
  h.page.setData({ busy: true });
  h.page.changeSection({ detail: { key: 'capture' } });
  assert.equal(scrolls.length, 1);
  assert.equal(h.calls.length, 0);
});
test('closed insurance blocks fresh quote/purchase without altering original policy facts', async () => {
  const h = loadPage({ root, route: 'pages/insurance/index', wx: createWx() });
  h.page._closed = false;
  const workspace = {
    enabled: false,
    products: [],
    orders: [{ id: id(8), paymentStatus: 'PAID', policyStatus: 'UNKNOWN' }],
  };
  h.page.setData({
    workspace,
    userId: id(1),
    quote: { quoteId: id(5) },
    consent: true,
    entryId: id(2),
    memberId: id(3),
    selectedProduct: id(4),
  });
  const calls = [];
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async (...args) => {
      calls.push(args);
      throw Error('must not send');
    },
    sessionRevision: () => 0,
  });
  await h.page.quote();
  await h.page.purchase();
  assert.equal(calls.length, 0);
  assert.deepEqual(h.page.data.workspace, workspace);
  assert.equal(h.wx.storage.size, 0);
  assert.match(h.page.data.error, /在线投保暂未开放/);
});
test('insurance record and funds progress navigation preserve request journals and use local section anchors', () => {
  for (const [route, action, expected] of [
    ['insurance', 'showRecords', '#insurance-records'],
    ['trade-order', 'fundingProgress', '#funds-resolution'],
  ]) {
    const h = loadPage({ root, route: 'pages/' + route + '/index', wx: createWx() });
    const scrolls = [];
    h.wx.pageScrollTo = (v) => scrolls.push(v);
    h.page[action]();
    assert.equal(scrolls[0].selector, expected);
    assert.equal(h.wx.storage.size, 0);
  }
});
test('UI002 live, insurance and funds fixtures expand real templates and local design assets at all three widths', () => {
  const directory = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
  const covered = new Set();
  for (const file of fs.readdirSync(directory).filter((name) => name.startsWith('ui002-live-'))) {
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    covered.add(fixture.route);
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({
        root,
        route: fixture.route,
        data: fixture.data,
        width,
        height: 844,
      });
      for (const text of fixture.expectText)
        assert.ok(preview.phone.includes(text), file + ': ' + text);
      for (const text of fixture.expectAbsentText || [])
        assert.equal(preview.phone.includes(text), false, file + ': hidden ' + text);
      assert.doesNotMatch(preview.phone, /\ssrc="https:/);
      for (const asset of preview.assets) assert.ok(asset.bytes > 0, asset.path);
    }
  }
  assert.equal(
    covered.size,
    22,
    'all assigned real routes have a populated or gated workflow fixture',
  );
});
test('message tabs filter only loaded notifications and marking read updates the unread subset', async () => {
  const h = loadPage({ root, route: 'pages/messages/index', wx: createWx() });
  h.page._closed = false;
  h.page.setData({
    items: [
      { id: id(41), title: '合成未读消息', readAt: null },
      { id: id(42), title: '合成已读消息', readAt: '2028-06-01' },
    ],
    unreadCount: 1,
  });
  const calls = [];
  h.requireLocal('utils/api.js').getClient = () => ({
    sessionRevision: () => 0,
    request: async (...args) => {
      calls.push(args);
      return { data: {} };
    },
  });
  h.page.filterMessages({ currentTarget: { dataset: { filter: 'unread' } } });
  assert.equal(h.page.data.messageFilter, 'unread');
  assert.equal(calls.length, 0);
  const before = buildPreview({ root, route: 'pages/messages/index', data: h.page.data });
  assert.match(before.phone, /合成未读消息/);
  assert.doesNotMatch(before.phone, /合成已读消息/);
  await h.page.read({ currentTarget: { dataset: { id: id(41) } } });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/notifications\/.+\/read$/);
  assert.equal(h.page.data.unreadCount, 0);
  assert.equal(
    h.page.data.items.length,
    2,
    'filtering never discards original loaded notifications',
  );
  const after = buildPreview({ root, route: 'pages/messages/index', data: h.page.data });
  assert.match(after.phone, /已读取范围内暂无未读消息/);
});
test('finance workspace uses existing channel capability and discards private results after hide', async () => {
  let visible = true;
  const writes = [];
  const ui = {
    begin: () => 1,
    live: () => visible,
    session: async () => ({ user: { id: id(1) } }),
    close: () => {
      visible = false;
    },
    message: (e) => e.message,
  };
  let resolveRead;
  const wait = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const trade = {
    id: (value) => value,
    money: (value) => '¥' + value,
    pending: () => null,
    read: async (p) => (p.includes('/terms') ? { terms: [], providerConfigured: false } : wait),
    execute: async (...args) => {
      writes.push(args);
    },
  };
  const h = loadPage({
    root,
    route: 'pages/trade-manage/index',
    wx: createWx(),
    modules: {
      [path.join(root, 'utils/ui.js')]: ui,
      [path.join(root, 'pages/trade-order/client.js')]: trade,
    },
  });
  h.page._alive = true;
  h.page._visible = true;
  h.page.setData({ orgId: id(2) });
  const loading = h.page.load();
  await new Promise(setImmediate);
  h.page.onHide();
  resolveRead({ orders: [{ id: id(3), title: '合成私有订单', totalFen: 100 }] });
  await loading;
  assert.equal(h.page.data.workspaceReady, false);
  assert.equal(h.page.data.orders.length, 0);
  assert.equal(h.page.data.loading, false);
  h.page.setData({ date: '2028-06-01', workspaceReady: true, providerConfigured: false });
  h.page.reconcile();
  assert.equal(writes.length, 0);
  assert.match(h.page.data.error, /未配置可用资金渠道/);
});

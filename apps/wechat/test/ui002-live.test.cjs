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
  for (const file of fs.readdirSync(directory).filter((name) => name.startsWith('ui002-live-'))) {
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
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
      assert.doesNotMatch(preview.phone, /\ssrc="https:/);
      for (const asset of preview.assets) assert.ok(asset.bytes > 0, asset.path);
    }
  }
});

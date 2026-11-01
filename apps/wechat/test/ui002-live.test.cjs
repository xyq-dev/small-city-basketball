const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
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

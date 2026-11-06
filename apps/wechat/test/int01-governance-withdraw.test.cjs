const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-governance-withdraw.json');
const root = path.resolve(__dirname, '..');
const route = 'pages/governance-reviews/index';
const actor = '10000000-0000-4000-8000-000000000001';
function harness({ confirm = true, fail = false } = {}) {
  const calls = [];
  const client = {
    sessionRevision: () => 0,
    onSessionChange: () => () => {},
    async request(url, method, body) {
      calls.push({ url, method, body: structuredClone(body) });
      if (fail) throw { status: 503, code: 'UNAVAILABLE' };
      return { data: { id: fixture.data.items[0].id, version: 8 } };
    },
  };
  const h = loadPage({
    root,
    route,
    wx: createWx({ modalAnswers: [confirm] }),
    modules: {
      [path.join(root, 'utils/api.js')]: {
        getClient: () => client,
        uuid: (value) => value,
        publicId: (value) => value,
      },
    },
  });
  h.page.onLoad({});
  h.page._viewer = actor;
  h.requireLocal('utils/ui.js').begin(h.page);
  h.page.setData(structuredClone(fixture.data));
  h.page.load = async () => {};
  return { ...h, calls };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const reasonField = (html) =>
  (html.match(/<textarea\b[^>]*>/g) || []).find((tag) => tag.includes('data-field="reason"'));
const commandButton = (html, type) =>
  (html.match(/<button\b[^>]*>/g) || []).find((tag) => tag.includes(`data-type="${type}"`));
function enterReason(h) {
  const input = reasonField(render(h.page));
  assert.ok(input, 'An author must be able to enter the required withdrawal reason');
  assert.doesNotMatch(input, /\sdisabled(?:\s|>)/);
  const handler = input.match(/data-mini-bindinput="([^"]+)"/)[1];
  h.page[handler]({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: '合成本人主动撤回公开评价' },
  });
}
async function invoke(h, type) {
  const tag = commandButton(render(h.page), type);
  assert.ok(tag);
  assert.doesNotMatch(tag, /\sdisabled(?:\s|>)/);
  const handler = tag.match(/data-mini-bindtap="([^"]+)"/)[1];
  await h.page[handler]({
    currentTarget: { dataset: { id: tag.match(/data-id="([^"]+)"/)[1], type } },
  });
}
test('an ordinary author can enter a withdrawal reason from the visible control at every width', () => {
  const h = harness();
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.ok(reasonField(html));
    assert.ok(commandButton(html, 'WITHDRAW'));
    assert.equal(commandButton(html, 'PUBLISH'), undefined);
    assert.equal(commandButton(html, 'REJECT'), undefined);
  }
});
test('the author input reaches the existing confirmed, versioned withdrawal command', async () => {
  const h = harness();
  enterReason(h);
  await invoke(h, 'WITHDRAW');
  assert.equal(h.calls.length, 1);
  assert.equal(
    h.calls[0].url,
    '/v1/me/governance/reviews/' + fixture.data.items[0].id + '/commands',
  );
  assert.equal(h.calls[0].method, 'POST');
  assert.equal(h.calls[0].body.type, 'WITHDRAW');
  assert.equal(h.calls[0].body.expectedVersion, 7);
  assert.equal(h.calls[0].body.reason, '合成本人主动撤回公开评价');
  assert.match(h.calls[0].body.commandId, /^[0-9a-f-]{36}$/);
});
test('platform review keeps its reason and independent publish command', async () => {
  const h = harness();
  h.page.setData({
    mode: 'platform',
    isOperator: true,
    items: [{ ...fixture.data.items[0], status: 'PENDING_REVIEW' }],
  });
  enterReason(h);
  await invoke(h, 'PUBLISH');
  assert.equal(h.calls[0].body.type, 'PUBLISH');
  assert.equal(h.calls[0].body.reason, '合成本人主动撤回公开评价');
  assert.equal(commandButton(render(h.page), 'WITHDRAW'), undefined);
});
test('public and signed-out views do not expose private command inputs', () => {
  for (const state of [{ isPublic: true }, { loginRequired: true }, { figmaReviewPreview: true }]) {
    const h = harness();
    h.page.setData(state);
    assert.equal(reasonField(render(h.page)), undefined);
    assert.equal(commandButton(render(h.page), 'WITHDRAW'), undefined);
  }
});
test('busy and unknown results keep the reason and withdrawal controls disabled', async () => {
  const h = harness({ fail: true });
  enterReason(h);
  await invoke(h, 'WITHDRAW');
  assert.equal(h.calls.length, 1);
  assert.ok(h.page.data.pending);
  assert.match(reasonField(render(h.page)), /\sdisabled(?:\s|>)/);
  assert.match(commandButton(render(h.page), 'WITHDRAW'), /\sdisabled(?:\s|>)/);
  h.page.setData({ pending: null, busy: true });
  assert.match(reasonField(render(h.page)), /\sdisabled(?:\s|>)/);
  h.page.field({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: 'late replacement' },
  });
  assert.equal(h.page.data.reason, '合成本人主动撤回公开评价');
});
test('declining the original confirmation sends no command or journal', async () => {
  const h = harness({ confirm: false });
  enterReason(h);
  await invoke(h, 'WITHDRAW');
  assert.equal(h.calls.length, 0);
  assert.equal(h.wx.storage.size, 0);
});

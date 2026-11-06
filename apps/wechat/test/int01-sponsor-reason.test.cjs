const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-sponsor-delivery-reason.json');

const root = path.resolve(__dirname, '..');
const route = fixture.route;
const actor = fixture.data.userId;
const org = '40000000-0000-4000-8000-000000000001';
const reason = '合成现场广告交付范围与约定不符';

function setup({ deliveryStatus = 'PROPOSED', viewer = actor } = {}) {
  const requests = [];
  const client = {
    viewerId: () => viewer,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      requests.push({ url, method, body: structuredClone(body) });
      assert.equal(method, 'POST');
      assert.equal(body.reason, reason);
      return { data: { id: fixture.data.detail.order.id } };
    },
  };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: {
      [path.join(root, 'utils/api.js')]: { getClient: () => client },
    },
  });
  h.page.onLoad({ orgId: org });
  h.page.setData(structuredClone(fixture.data));
  h.page.setData({ userId: viewer });
  h.page.data.detail.deliveries[0].status = deliveryStatus;
  h.page.load = async () => {};
  return { ...h, requests };
}

const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const reasonInput = (html) =>
  (html.match(/<textarea\b[^>]*>/g) || []).find((tag) => tag.includes('data-field="reason"'));
const actionButton = (html, action) =>
  (html.match(/<button\b[^>]*>/g) || []).find((tag) => tag.includes(`data-action="${action}"`));

function enterReason(page, html) {
  const field = reasonInput(html);
  assert.ok(field, 'The delivery view must expose its own factual reason input');
  assert.doesNotMatch(field, /\bdisabled\b/);
  const handler = field.match(/data-mini-bindinput="([^"]+)"/)[1];
  page[handler]({ currentTarget: { dataset: { field: 'reason' } }, detail: { value: reason } });
}

for (const [deliveryStatus, action] of [
  ['PROPOSED', 'DISPUTE'],
  ['DISPUTED', 'ACCEPT'],
]) {
  test(`advertiser ${action} keeps its reason visible and sends it through the existing command`, async () => {
    const h = setup({ deliveryStatus });
    const html = render(h.page);
    enterReason(h.page, html);
    const button = actionButton(html, action);
    assert.ok(button);
    assert.doesNotMatch(button, /\bdisabled\b/);
    const handler = button.match(/data-mini-bindtap="([^"]+)"/)[1];
    await h.page[handler]({
      currentTarget: {
        dataset: {
          action: button.match(/data-action="([^"]+)"/)[1],
          id: button.match(/data-id="([^"]+)"/)[1],
        },
      },
    });
    assert.equal(h.requests.length, 1);
    assert.equal(
      h.requests[0].url,
      `/v1/orgs/${org}/sponsor-commerce/orders/${fixture.data.detail.order.id}/commands`,
    );
    assert.equal(h.requests[0].body.action, action);
    assert.equal(h.requests[0].body.reason, reason);
    assert.equal(h.requests[0].body.expectedVersion, 3);
    assert.equal(h.requests[0].body.childId, fixture.data.detail.deliveries[0].id);
    assert.equal(h.page.data.pending, null);
  });
}

test('delivery and refund views share the original reason while settlement has no unused input', () => {
  const h = setup();
  enterReason(h.page, render(h.page));
  for (const key of ['refunds', 'delivery']) {
    h.page.detailTab({ currentTarget: { dataset: { key } } });
    assert.ok(reasonInput(render(h.page)));
    assert.equal(h.page.data.reason, reason);
  }
  h.page.detailTab({ currentTarget: { dataset: { key: 'settlement' } } });
  assert.equal(reasonInput(render(h.page)), undefined);
});

test('a read-only nonpayer gains no delivery commands from the restored reason field', () => {
  const h = setup({ viewer: '10000000-0000-4000-8000-000000000002' });
  const html = render(h.page);
  assert.ok(reasonInput(html));
  for (const action of ['ACCEPT', 'DISPUTE', 'DELIVERY', 'VERIFY_FEE'])
    assert.equal(actionButton(html, action), undefined, action);
  assert.equal(h.requests.length, 0);
});

test('a busy command keeps its reason control and delivery buttons disabled', async () => {
  const h = setup();
  h.page.setData({ busy: true });
  const html = render(h.page);
  assert.match(reasonInput(html), /\bdisabled\b/);
  assert.match(actionButton(html, 'DISPUTE'), /\bdisabled\b/);
  await h.page.orderAction({ currentTarget: { dataset: { action: 'DISPUTE' } } });
  assert.equal(h.requests.length, 0);
});

test('an unknown original command hides the editor and blocks a replacement write', async () => {
  const h = setup();
  h.page.setData({ pending: { commandId: '50000000-0000-4000-8000-000000000001' } });
  const html = render(h.page);
  assert.equal(reasonInput(html), undefined);
  assert.equal(actionButton(html, 'DISPUTE'), undefined);
  await h.page.orderAction({ currentTarget: { dataset: { action: 'DISPUTE' } } });
  assert.equal(h.requests.length, 0);
});

test('the new CI fixture exposes advertiser reason and commands in every required width', () => {
  const h = setup();
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.ok(reasonInput(html), width);
    assert.ok(actionButton(html, 'DISPUTE'), width);
    assert.ok(actionButton(html, 'ACCEPT'), width);
    assert.equal(actionButton(html, 'DELIVERY'), undefined, width);
    assert.equal(actionButton(html, 'VERIFY_FEE'), undefined, width);
  }
});

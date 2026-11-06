const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/match-exceptions/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(1),
  event = id(2),
  match = id(3),
  request = id(4),
  actor = id(5);
const base = `/v1/orgs/${org}/matches/${match}/exceptions`;

async function setup({ mode = 'review', confirm = true, unknown = false, denied = false } = {}) {
  const calls = [];
  let lose = unknown;
  const pending = {
    id: request,
    version: 7,
    operation: 'DECLARE',
    kind: 'FORFEIT',
    forfeitingSide: 'AWAY',
    status: ['history', 'revoke'].includes(mode) ? 'APPROVED' : 'PENDING',
    proposedBy: mode === 'own' ? actor : id(6),
    reason: '合成客队未按约到场的原提案事实',
  };
  const data = {
    event: { id: event, version: 9, status: mode === 'history' ? 'COMPLETED' : 'SCHEDULED' },
    match: { id: match, version: 11, status: 'SCHEDULED' },
    rules: {
      id: id(7),
      version: 2,
      forfeitWinPoints: 2,
      forfeitLossPoints: 0,
      cancellationPolicy: 'EXCLUDE_FROM_TABLE',
    },
    active: ['history', 'revoke'].includes(mode) ? pending : null,
    requests: mode === 'proposal' ? [] : [pending],
    capabilities: {
      canPropose: mode === 'proposal',
      canRevoke: mode === 'revoke',
      canReview: mode === 'review',
    },
  };
  const client = {
    hasSession: () => true,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: body && structuredClone(body) });
      if (method === 'GET') {
        assert.equal(url, base);
        if (denied) throw { status: 403, message: '合成当前账号无权读取裁定' };
        return { data: structuredClone(data) };
      }
      assert.equal(denied, false);
      if (url.endsWith('/review')) {
        assert.notEqual(
          pending.proposedBy,
          actor,
          'The synthetic server must not grant self-review',
        );
        assert.equal(data.capabilities.canReview, true);
      } else if (body.operation === 'REVOKE') assert.equal(data.capabilities.canRevoke, true);
      else assert.equal(data.capabilities.canPropose, true);
      if (lose) {
        lose = false;
        throw new Error('合成响应遗失');
      }
      return { data: { requestId: request } };
    },
  };
  const h = loadPage({ root, route, wx: createWx({ modalAnswers: [confirm, true] }) });
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad({ orgId: org, matchId: match });
  await h.flush();
  assert.equal(h.page.data.loading, false);
  return { ...h, calls };
}

const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const reasonFields = (page) =>
  (render(page).match(/<textarea\b[^>]*>/g) || []).filter((tag) =>
    tag.includes('data-field="reason"'),
  );
function enterReason(page, value) {
  const fields = reasonFields(page);
  assert.equal(fields.length, 1, 'The eligible view must expose one actual shared reason input');
  const handler = fields[0].match(/data-mini-bindinput="([^"]+)"/)[1];
  page[handler]({ currentTarget: { dataset: { field: 'reason' } }, detail: { value } });
}
function reviewButton(page, type) {
  return (render(page).match(/<button\b[^>]*>/g) || []).find(
    (tag) => tag.includes('data-mini-bindtap="review"') && tag.includes(`data-type="${type}"`),
  );
}
async function review(page, type) {
  const control = reviewButton(page, type);
  assert.ok(control);
  const handler = control.match(/data-mini-bindtap="([^"]+)"/)[1];
  await page[handler]({
    currentTarget: { dataset: { type: control.match(/data-type="([^"]+)"/)[1] } },
  });
}
function change(page, tab) {
  const control = (render(page).match(/<button\b[^>]*>/g) || []).find(
    (tag) =>
      tag.includes('data-mini-bindtap="changeExceptionTab"') && tag.includes(`data-tab="${tab}"`),
  );
  assert.ok(control);
  page.changeExceptionTab({ currentTarget: { dataset: { tab } } });
}
const writes = (h) => h.calls.filter((call) => call.method !== 'GET');

for (const type of ['APPROVE', 'REJECT']) {
  test(`an independent pending reviewer enters a reason in the actual review view and sends ${type}`, async () => {
    const h = await setup();
    change(h.page, 'review');
    for (const width of [320, 390, 430]) {
      assert.equal((render(h.page, width).match(/data-field="reason"/g) || []).length, 1);
    }
    enterReason(h.page, '合成独立核对双方陈述与到场记录');
    assert.doesNotMatch(reviewButton(h.page, type), /\bdisabled\b/);
    await review(h.page, type);
    assert.equal(writes(h).length, 1);
    const sent = writes(h)[0];
    assert.equal(sent.url, base + '/' + request + '/review');
    assert.equal(sent.body.type, type);
    assert.equal(sent.body.reason, '合成独立核对双方陈述与到场记录');
    assert.equal(sent.body.expectedEventVersion, 9);
    assert.equal(sent.body.expectedMatchVersion, 11);
    assert.equal(sent.body.expectedRequestVersion, 7);
    assert.match(sent.body.clientRequestId, /^[0-9a-f-]{36}$/);
    assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
  });
}

test('proposal retains its original single reason field and versions without exposing it in history', async () => {
  const h = await setup({ mode: 'proposal' });
  enterReason(h.page, '合成提案事实和明确时间说明');
  change(h.page, 'history');
  assert.equal(reasonFields(h.page).length, 0);
  change(h.page, 'proposal');
  assert.equal(reasonFields(h.page).length, 1);
  assert.equal(h.page.data.reason, '合成提案事实和明确时间说明');
  await h.page.propose({ currentTarget: { dataset: {} } });
  assert.equal(writes(h).length, 1);
  assert.equal(writes(h)[0].url, base + '/proposals');
  assert.equal(writes(h)[0].body.reason, '合成提案事实和明确时间说明');
  assert.equal(writes(h)[0].body.expectedEventVersion, 9);
  assert.equal(writes(h)[0].body.expectedMatchVersion, 11);
});

test('an eligible active adjudication retains the same reason for its independent revocation proposal', async () => {
  const h = await setup({ mode: 'revoke' });
  enterReason(h.page, '合成撤回当前生效裁定的事实依据');
  const control = (render(h.page).match(/<button\b[^>]*>/g) || []).find(
    (tag) => tag.includes('data-mini-bindtap="propose"') && tag.includes('data-operation="REVOKE"'),
  );
  assert.ok(control);
  assert.doesNotMatch(control, /\bdisabled\b/);
  await h.page.propose({ currentTarget: { dataset: { operation: 'REVOKE' } } });
  assert.equal(writes(h).length, 1);
  assert.equal(writes(h)[0].url, base + '/proposals');
  assert.equal(writes(h)[0].body.operation, 'REVOKE');
  assert.equal(writes(h)[0].body.targetAdjudicationId, request);
  assert.equal(writes(h)[0].body.forfeitingSide, 'AWAY');
  assert.equal(writes(h)[0].body.reason, '合成撤回当前生效裁定的事实依据');
  assert.equal(writes(h)[0].body.expectedEventVersion, 9);
  assert.equal(writes(h)[0].body.expectedMatchVersion, 11);
});

test('an own proposal cannot expose independent review inputs or approve itself', async () => {
  const h = await setup({ mode: 'own' });
  change(h.page, 'review');
  assert.equal(reasonFields(h.page).length, 0);
  assert.equal(reviewButton(h.page, 'APPROVE'), undefined);
  assert.equal(reviewButton(h.page, 'REJECT'), undefined);
  assert.ok(render(h.page).includes('当前账号不能复核'));
  await h.page.review({ currentTarget: { dataset: { type: 'APPROVE' } } });
  assert.equal(writes(h).length, 0);
});

test('unauthorized reads and historical read-only records expose no editable adjudication reason', async () => {
  const unauthorized = await setup({ denied: true });
  assert.equal(unauthorized.page.data.event, null);
  assert.equal(reasonFields(unauthorized.page).length, 0);
  const history = await setup({ mode: 'history' });
  assert.equal(reasonFields(history.page).length, 0);
  change(history.page, 'history');
  assert.equal(reasonFields(history.page).length, 0);
  assert.equal(reviewButton(history.page, 'APPROVE'), undefined);
  assert.equal(writes(unauthorized).length + writes(history).length, 0);
});

test('busy disables the visible reviewer reason and actions and prevents another command', async () => {
  const h = await setup();
  change(h.page, 'review');
  enterReason(h.page, '合成已填写的独立复核依据');
  h.page.setData({ busy: true });
  assert.match(reasonFields(h.page)[0], /\bdisabled\b/);
  assert.match(reviewButton(h.page, 'APPROVE'), /\bdisabled\b/);
  await review(h.page, 'APPROVE');
  assert.equal(writes(h).length, 0);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'showModal'),
    false,
  );
});

test('unknown review results keep the exact original request while the shared input stays disabled', async () => {
  const h = await setup({ unknown: true });
  change(h.page, 'review');
  enterReason(h.page, '合成原编号的独立复核依据');
  await review(h.page, 'REJECT');
  const original = structuredClone(writes(h)[0]);
  assert.equal(h.page.data.uncertain, true);
  assert.match(reasonFields(h.page)[0], /\bdisabled\b/);
  assert.match(reviewButton(h.page, 'REJECT'), /\bdisabled\b/);
  await review(h.page, 'APPROVE');
  assert.equal(writes(h).length, 1);
  await h.page.retry();
  assert.equal(writes(h).length, 2);
  assert.deepEqual(writes(h)[1], original);
});

test('the original reason length and explicit confirmation remain required', async () => {
  const short = await setup();
  change(short.page, 'review');
  enterReason(short.page, '太短');
  await review(short.page, 'APPROVE');
  assert.match(short.page.data.error, /4至500字/);
  assert.equal(writes(short).length, 0);
  assert.equal(
    short.wx.calls.some((call) => call.type === 'showModal'),
    false,
  );
  const cancelled = await setup({ confirm: false });
  change(cancelled.page, 'review');
  enterReason(cancelled.page, '合成核对后取消本次确认');
  await review(cancelled.page, 'APPROVE');
  assert.equal(writes(cancelled).length, 0);
  assert.equal(cancelled.wx.calls.filter((call) => call.type === 'showModal').length, 1);
});

test('the independent-review fixture exposes one enabled shared reason at all widths', () => {
  const fixture = require('../../../tests/mini-program/fixtures/int01-adjudication-review-reason.json');
  assert.equal(fixture.data.exceptionTab, 'review');
  assert.equal(fixture.data.canPropose, false);
  assert.equal(fixture.data.canReview, true);
  const h = loadPage({ root, route });
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.equal((html.match(/data-field="reason"/g) || []).length, 1);
    assert.doesNotMatch(reasonFields(h.page)[0], /\bdisabled\b/);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-sponsor-refund-unverified.json');

const root = path.resolve(__dirname, '..');
const route = fixture.route;
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(1),
  org = id(2),
  contract = id(3),
  order = id(4),
  tradeOrder = id(5);
const listPath = '/v1/orgs/' + org + '/sponsor-commerce';
const copy = (value) => structuredClone(value);
const rawContract = () => ({
  id: contract,
  org_id: org,
  payer_user_id: actor,
  title: '合成退款待核合同',
  total_fen: 10000,
  status: 'SIGNED',
  version: 3,
  owner_signed_by: id(6),
  starts_at: '2028-06-01T00:00:00Z',
  ends_at: '2028-06-02T00:00:00Z',
  terms: '合成原合同条款与金额保持不变',
  contractHash: 'a'.repeat(64),
});
// The real list query returns sponsor_orders.*, trade_order_id and paid_fen.
// It supplies no refund aggregate; decorate must not turn that omission into zero.
const rawOrder = () => ({
  id: order,
  org_id: org,
  contract_id: contract,
  payer_user_id: actor,
  title: '合成原广告订单',
  total_fen: 10000,
  status: 'DELIVERING',
  version: 4,
  verified_fee_fen: 100,
  trade_order_id: tradeOrder,
  paid_fen: 10000,
});
async function setup(refundFields = {}, orderFields = {}) {
  const calls = [],
    sourceOrder = { ...rawOrder(), ...refundFields, ...orderFields };
  const source = {
    enabled: false,
    canManage: false,
    canFinance: false,
    canAdvance: false,
    userId: actor,
    campaignOptions: [],
    contracts: [rawContract()],
    orders: [sourceOrder],
    beneficiaries: [],
    receiverOptions: [],
  };
  const client = {
    viewerId: () => actor,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      assert.equal(method, 'GET', 'The overview may not send a money command');
      assert.equal(body, undefined);
      if (url === '/v1/auth/session')
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      if (url === '/v1/me/sponsor-commerce')
        return {
          data: { organizations: [{ id: org, name: '合成合同机构', role: 'ADVERTISER' }] },
        };
      assert.equal(url, listPath, 'The overview must not request additional financial data');
      return { data: copy(source) };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  h.page.onLoad({ orgId: org });
  await h.page.load();
  assert.equal(h.page.data.error, '');
  assert.equal(h.page.data.loading, false);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/v1/auth/session', '/v1/me/sponsor-commerce', listPath],
  );
  return { ...h, calls, sourceOrder };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const poolRow = (html) =>
  html.match(/可分配基数<\/div>[\s\S]*?class="commerce-money">([^<]*)/)?.[1];

test('the actual list shape reaches decorate and keeps the unreported refund base unverified', async () => {
  const h = await setup();
  assert.equal('refunded_fen' in h.sourceOrder, false);
  assert.equal('refundedFen' in h.sourceOrder, false);
  assert.equal('refunded_fen' in h.page.data.orders[0], false);
  assert.equal('refundedFen' in h.page.data.orders[0], false);
  assert.equal(h.page.data.orders[0].amountText, '100.00');
  assert.equal(h.page.data.orders[0].stateLabel, '投放交付中');
  assert.equal(h.page.data.contractOverview.paymentLabel, '投放交付中');
  assert.equal(h.page.data.contractOverview.poolLabel, '待核对');
  assert.equal(poolRow(render(h.page)), '待核对');
});

for (const field of ['refunded_fen', 'refundedFen']) {
  // Exercise the already supported explicit aggregate aliases separately from
  // the current list response, which omits both of them.
  for (const [refund, label] of [
    [0, '¥99.00'],
    [3000, '¥69.00'],
  ])
    test(field + '=' + refund + ' remains an explicit integer amount', async () => {
      const h = await setup({ [field]: refund });
      assert.equal(h.page.data.contractOverview.poolLabel, label);
      assert.equal(poolRow(render(h.page)), label);
      assert.equal(h.page.data.orders[0][field], refund);
    });

  for (const [name, value] of [
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['numeric string', '0'],
    ['unknown status', 'UNKNOWN'],
    ['negative', -1],
    ['fraction', 0.5],
    ['NaN', NaN],
    ['infinite', Infinity],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['boolean', false],
  ])
    test(field + ' ' + name + ' cannot be presented as a verified zero refund', async () => {
      const h = await setup({ [field]: value });
      assert.equal(h.page.data.contractOverview.poolLabel, '待核对');
      assert.equal(poolRow(render(h.page)), '待核对');
    });
}

test('an invalid primary aggregate cannot be hidden by an explicit zero alias', async () => {
  for (const value of [null, '', -1, 'UNKNOWN']) {
    const h = await setup({ refunded_fen: value, refundedFen: 0 });
    assert.equal(h.page.data.contractOverview.poolLabel, '待核对');
  }
});

test('invalid receipt and fee values cannot be hidden by aliases or subtraction', async () => {
  for (const fields of [
    { paid_fen: null, paidFen: 10000 },
    { paid_fen: '', paidFen: 10000 },
    { paid_fen: -1, paidFen: 10000 },
    { paid_fen: Number.MAX_SAFE_INTEGER + 1, paidFen: 10000 },
    { verified_fee_fen: null, verifiedFeeFen: 100 },
    { verified_fee_fen: '', verifiedFeeFen: 100 },
    { verified_fee_fen: -1, verifiedFeeFen: 100 },
    { verified_fee_fen: 0.5, verifiedFeeFen: 100 },
    { verified_fee_fen: Number.MAX_SAFE_INTEGER + 1, verifiedFeeFen: 100 },
  ]) {
    const h = await setup({ refunded_fen: 0 }, fields);
    assert.equal(h.page.data.contractOverview.poolLabel, '待核对');
  }
});

test('inconsistent deductions are unverified while an explicit exact zero base stays valid', async () => {
  for (const refund of [10001, 10000]) {
    const h = await setup({ refunded_fen: refund });
    assert.equal(h.page.data.contractOverview.poolLabel, '待核对');
  }
  const h = await setup({ refunded_fen: 9900 });
  assert.equal(h.page.data.contractOverview.poolLabel, '¥0.00');
});

test('already supported explicit camel-case amounts still use the same formatter', async () => {
  const h = await setup(
    { refundedFen: 3000 },
    { paid_fen: undefined, paidFen: 10000, verified_fee_fen: undefined, verifiedFeeFen: 100 },
  );
  assert.equal(h.page.data.contractOverview.poolLabel, '¥69.00');
});

test('unverified receipts and fees remain unverified', async () => {
  for (const fields of [{ paid_fen: 0 }, { verified_fee_fen: null }]) {
    const h = await setup({ refunded_fen: 0 }, fields);
    assert.equal(h.page.data.contractOverview.poolLabel, '待核对');
  }
});

test('the overview preserves original identities and amounts without granting financial actions', async () => {
  const h = await setup();
  for (const [key, value] of Object.entries(rawOrder()))
    assert.equal(h.page.data.orders[0][key], value, key);
  assert.equal(h.page.data.contracts[0].id, contract);
  assert.equal(h.page.data.contracts[0].total_fen, 10000);
  assert.equal(h.page.data.userId, actor);
  assert.equal(h.page.data.canManage, false);
  assert.equal(h.page.data.canFinance, false);
  const html = render(h.page);
  assert.doesNotMatch(html, /data-mini-bindtap="(?:orderAction|channel|createContract)"/);
  const contractButtons = (html.match(/<button\b[^>]*>/g) || []).filter((tag) =>
    tag.includes('data-mini-bindtap="contractAction"'),
  );
  assert.equal(contractButtons.length, 1);
  assert.match(contractButtons[0], /data-action="ORDER"/);
  assert.ok(contractButtons[0].includes('data-id="' + contract + '"'));
  assert.equal(
    h.wx.calls.some((call) => call.type === 'showModal'),
    false,
  );
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('the new unverified fixture matches the real loaded view at every width', async () => {
  const h = await setup();
  for (const key of [
    'contracts',
    'orders',
    'contractOverview',
    'userId',
    'canManage',
    'canFinance',
  ])
    assert.deepEqual(h.page.data[key], fixture.data[key], key);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.equal(poolRow(html), '待核对');
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    for (const text of fixture.expectAbsentText) assert.ok(!html.includes(text), text);
  }
});

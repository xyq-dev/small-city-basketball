const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api');
const ui = require('../utils/ui');
const trade = require('../pages/trade-order/client');
const root = path.resolve(__dirname, '..');
const id = '10000000-0000-4000-8000-000000000001';
const pageNames = ['matching', 'dispatch', 'training', 'training-manage', 'sponsor-commerce'];
test('all five R6 pages are registered with safe login return paths while navigation retains five tabs', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  for (const name of pageNames) {
    const route = 'pages/' + name + '/index';
    const registered = [
      ...app.pages,
      ...(app.subpackages || []).flatMap((pack) =>
        pack.pages.map((page) => pack.root.replace(/\/$/, '') + '/' + page),
      ),
    ];
    assert.ok(registered.includes(route), route);
    for (const ext of ['js', 'json', 'wxml', 'wxss'])
      assert.ok(fs.existsSync(path.join(root, route + '.' + ext)), route + '.' + ext);
    assert.equal(ui.safeReturn('/' + route), '/' + route);
  }
  assert.equal(ui.safeReturn('/pages/unknown/index'), '');
  const nav = fs.readFileSync(path.join(root, 'components/navigation/index.js'), 'utf8');
  assert.ok(!nav.includes("label: '撮合'"));
});
const allowed = [
  ['GET', '/v1/matching'],
  ['GET', '/v1/matching/receipts/' + id],
  ['GET', '/v1/matching/needs/' + id],
  ['POST', '/v1/matching/preferences'],
  ['POST', '/v1/matching/needs'],
  ...['runs', 'intents', 'commands'].map((x) => ['POST', '/v1/matching/needs/' + id + '/' + x]),
  ['POST', '/v1/matching/intents/' + id + '/commands'],
  ['GET', '/v1/dispatch'],
  ['GET', '/v1/dispatch/capabilities'],
  ...['requests', 'offers', 'receipts'].map((x) => ['GET', '/v1/dispatch/' + x + '/' + id]),
  ['POST', '/v1/dispatch/preferences'],
  ['POST', '/v1/dispatch/requests'],
  ...['requests', 'offers'].map((x) => ['POST', '/v1/dispatch/' + x + '/' + id + '/commands']),
  ['GET', '/v1/training/catalog'],
  ['GET', '/v1/training/mine'],
  ['GET', '/v1/training/cohorts/' + id],
  ['GET', '/v1/training/enrollments/' + id],
  ['GET', '/v1/training/sessions/' + id + '/roster'],
  ['GET', '/v1/orgs/' + id + '/training'],
  ['POST', '/v1/training/cohorts/' + id + '/enrollments'],
  ['POST', '/v1/training/enrollments/' + id + '/refunds'],
  ...[
    'cohorts',
    'enrollments',
    'entitlements',
    'sessions',
    'consumptions',
    'refunds',
    'coaches',
  ].map((x) => ['POST', '/v1/training/' + x + '/' + id + '/commands']),
  ...['provider', 'provider/commands', 'coaches', 'courses', 'cohorts'].map((x) => [
    'POST',
    '/v1/orgs/' + id + '/training/' + x,
  ]),
  ['GET', '/v1/me/sponsor-commerce'],
  ['GET', '/v1/orgs/' + id + '/sponsor-commerce'],
  ['GET', '/v1/orgs/' + id + '/sponsor-commerce/statements'],
  ['GET', '/v1/orgs/' + id + '/sponsor-commerce/orders/' + id],
  ['GET', '/v1/orgs/' + id + '/sponsor-commerce/receipts/' + id],
  ...[
    'beneficiaries',
    'contracts',
    'orders',
    'contracts/' + id + '/commands',
    'orders/' + id + '/commands',
    'orders/' + id + '/channel',
    'receipts/' + id + '/cancel',
  ].map((x) => ['POST', '/v1/orgs/' + id + '/sponsor-commerce/' + x]),
];
test('real API client allowlist admits the precise matching, dispatch, training and sponsor routes', () => {
  for (const [method, p] of allowed)
    assert.equal(api.pathAllowed(p, method), true, method + ' ' + p);
});
test('new endpoints reject extra queries, path injection and unadvertised verbs', () => {
  for (const [method, p] of allowed) {
    assert.equal(api.pathAllowed(p + '?other=1', method), false, p);
    assert.equal(api.pathAllowed(p, 'DELETE'), false, p);
    assert.equal(api.pathAllowed(p + '/unexpected', method), false, p);
  }
  assert.equal(api.pathAllowed('/v1/matching/needs/not-a-uuid', 'GET'), false);
  assert.equal(api.pathAllowed('/v1/dispatchx', 'GET'), false);
  assert.equal(api.pathAllowed('https://example.test/v1/matching', 'GET'), false);
});
test('training and sponsor sources use the existing funds page with explicit labels and source validation', () => {
  for (const [kind, label] of [
    ['TRAINING_ENROLLMENT', '培训报名订单'],
    ['SPONSOR_ORDER', '广告合同订单'],
  ]) {
    assert.equal(
      api.pathAllowed('/v1/trades/source?kind=' + kind + '&sourceId=' + id, 'GET'),
      true,
    );
    assert.equal(trade.kindLabel(kind), label);
  }
  assert.throws(() => trade.sourceKind('OTHER'));
  assert.equal(api.pathAllowed('/v1/trades/source?kind=OTHER&sourceId=' + id, 'GET'), false);
});
test('account and local entries point to operational pages and carry organization context for management', () => {
  const account = fs.readFileSync(path.join(root, 'pages/account/index.wxml'), 'utf8'),
    local = fs.readFileSync(path.join(root, 'pages/local/index.wxml'), 'utf8');
  for (const name of ['matching', 'dispatch', 'training']) {
    assert.ok(account.includes('data-page="' + name + '"'));
    assert.ok(local.includes('data-page="' + name + '"'));
  }
  for (const name of ['training-manage', 'sponsor-commerce'])
    assert.ok(account.includes('data-page="' + name + '" data-org="{{item.id}}"'));
});

test('ordinary payer can open own advertising contracts without an organization admin grant', () => {
  const { loadPage } = require('./helpers/native-page.cjs');
  const { buildPreview } = require('./helpers/native-preview.cjs');
  const opened = [];
  const h = loadPage({
    root,
    route: 'pages/account/index',
    modules: {
      [path.join(root, 'utils/ui.js')]: {
        ...ui,
        open: (...args) => opened.push(JSON.parse(JSON.stringify(args))),
      },
    },
  });
  h.page.setData({
    user: { id, displayName: '合成广告主', email: 'payer@example.test' },
    managedOrgs: [],
  });
  h.page.toggleMore();
  const preview = buildPreview({ root, route: 'pages/account/index', data: h.page.data });
  assert.match(preview.phone, /我的广告合同/);
  h.page.go({ currentTarget: { dataset: { page: 'sponsor-commerce' } } });
  assert.deepEqual(opened, [['sponsor-commerce', {}]]);
  h.page.go({ currentTarget: { dataset: { page: 'sponsor-commerce', org: id } } });
  assert.deepEqual(opened[1], ['sponsor-commerce', { orgId: id }]);
  h.page.data.busy = true;
  h.page.go({ currentTarget: { dataset: { page: 'sponsor-commerce' } } });
  assert.equal(opened.length, 2);
});

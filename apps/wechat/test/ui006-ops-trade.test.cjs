const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const pages = [
  'platform',
  'sponsorships',
  'sponsor-commerce',
  'public-ledgers',
  'trade-order',
  'trade-manage',
  'city-operations',
];

function source(page, extension) {
  return fs.readFileSync(path.join(root, 'pages', page, 'index.' + extension), 'utf8');
}

test('UI006 operations and trade pages use the scoped native Figma page system', () => {
  for (const page of pages) {
    const wxml = source(page, 'wxml');
    const wxss = source(page, 'wxss');
    assert.match(wxml, /<scb-header\b/, page + ': shared native header');
    assert.match(wxml, /class="[^"]*figma-page\b/, page + ': scoped Figma page root');
    assert.match(wxml, /figma-page__content--actions/, page + ': fixed action clearance');
    assert.match(wxss, /^@import "\.\.\/\.\.\/styles\/figma-pages\.wxss";/, page);
    assert.doesNotMatch(wxml, /\bui002-|class="page(?:\s|")|<web-view\b/, page);
    assert.doesNotMatch(wxml + wxss, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//, page);
    assert.doesNotMatch(wxml, /\{\{[^}]*\w+\s*\([^}]*\}\}|indexOf\s*\(/, page);
  }
});

test('UI006 operations and trade WXML parses and every event target exists', () => {
  for (const page of pages) {
    const route = 'pages/' + page + '/index';
    const tree = parseWxml(source(page, 'wxml'));
    const { page: definition } = loadPage({ root, route });
    for (const handler of eventHandlers(tree))
      assert.equal(typeof definition[handler], 'function', route + ': ' + handler);
  }
});

test('UI006 operations and trade pages expose the designed state branches', () => {
  const platform = source('platform', 'wxml');
  assert.match(platform, /平台权限尚未就绪/);
  assert.match(platform, /暂无可审核资料/);

  const sponsorships = source('sponsorships', 'wxml');
  assert.match(sponsorships, /当前可展示投放/);
  assert.match(sponsorships, /原操作结果待核对/);

  const commerce = source('sponsor-commerce', 'wxml');
  assert.match(commerce, /商业收款尚未开通/);
  assert.match(commerce, /我的合同[\s\S]*订单与交付[\s\S]*收益明细/);
  assert.match(commerce, /固定价合同[\s\S]*收款与交付[\s\S]*分配核对[\s\S]*相关服务/);
  assert.match(commerce, /分账核对/);
  assert.match(commerce, /退款与回退分别核对/);

  const ledgers = source('public-ledgers', 'wxml');
  assert.match(ledgers, /公开账目快照/);
  assert.match(ledgers, /已审批线下账目/);
  assert.match(ledgers, /原操作等待核对/);
  assert.match(ledgers, /冲销会追加原记录的精确反向金额/);

  const order = source('trade-order', 'wxml');
  assert.match(order, /资金结果待核对/);
  assert.match(order, /退款进度/);
  assert.match(order, /未知结果不会当作成功/);

  const manage = source('trade-manage', 'wxml');
  assert.match(manage, /当前机构资金渠道未配置/);
  assert.match(manage, /后续收费条款[\s\S]*原单查询[\s\S]*渠道日账核对/);
  assert.match(manage, /渠道日账核对/);

  const city = source('city-operations', 'wxml');
  assert.match(city, /有限范围运营授权/);
  assert.match(city, /原授权操作待核对/);
  assert.match(city, /平台维护/);
  assert.match(city, /授权维护[\s\S]*已分派事项/);
});

test('UI006 operations and trade rebuild keeps write protection and permission semantics', () => {
  const checks = {
    platform: [/raw\.settings\.version/, /profile\.version/, /ui\.uuid\(\)/, /ui\.confirm/],
    sponsorships: [/gov\.perform/, /gov\.recover/, /impressions/, /expectedVersion/, /readPending/],
    'sponsor-commerce': [
      /acceptedContractHash/,
      /chargeConsent/,
      /client\.pending/,
      /expectedVersion/,
    ],
    'public-ledgers': [/publicConsent/, /REVERSAL/, /expectedVersion/, /gov\.recover/],
    'trade-order': [
      /clientRequestId/,
      /pendingState/,
      /balanceConflict/,
      /approvedRefundRejectConsent/,
      /retry/,
    ],
    'trade-manage': [/providerConfigured/, /expectedVersion/, /trade\.recover/, /trade\.retry/],
    'city-operations': [
      /catalogVersion/,
      /expiresAt/,
      /expectedVersion/,
      /gov\.perform/,
      /readPending/,
    ],
  };
  for (const [page, patterns] of Object.entries(checks)) {
    const script = source(page, 'js');
    for (const pattern of patterns) assert.match(script, pattern, page + ': ' + pattern);
  }
});

test('rebuilt checkbox and workspace controls keep their page-local state semantics', () => {
  const ledger = loadPage({ root, route: 'pages/public-ledgers/index' }).page;
  ledger.consent({
    currentTarget: { dataset: { field: 'publicConsent' } },
    detail: { value: ['yes'] },
  });
  assert.equal(ledger.data.publicConsent, true);
  ledger.consent({
    currentTarget: { dataset: { field: 'publicConsent' } },
    detail: { value: [] },
  });
  assert.equal(ledger.data.publicConsent, false);
  ledger.consent({
    currentTarget: { dataset: { field: 'authorizationConfirmed' } },
    detail: { value: true },
  });
  assert.equal(ledger.data.authorizationConfirmed, true);

  const manage = loadPage({ root, route: 'pages/trade-manage/index' }).page;
  manage.changeView({ detail: { key: 'orders' } });
  assert.equal(manage.data.activeView, 'orders');
  manage.changeView({ detail: { key: 'unknown' } });
  assert.equal(manage.data.activeView, 'orders');
});

test('reviewed operation summaries do not expose unrelated money or management actions', () => {
  const commerce = source('sponsor-commerce', 'wxml');
  assert.match(commerce, /contractOverview\.paymentLabel/);
  assert.match(commerce, /contractOverview\.poolLabel/);
  assert.doesNotMatch(commerce, /commerce-money">\{\{orders\.length \? orders\[0\]\.stateLabel/);
  assert.match(commerce, /wx:if="\{\{canManage \|\| canFinance\}\}"[^>]*bindtap="openTradeManage"/);
  assert.match(
    source('sponsor-commerce', 'js'),
    /!this\.data\.canManage && !this\.data\.canFinance/,
  );

  assert.match(source('city-operations', 'wxml'), /wx:if="\{\{platform && canManage\}\}"/);
  assert.match(
    source('city-operations', 'js'),
    /!this\.data\.platform \|\| !this\.data\.canManage/,
  );
  assert.match(source('sponsorships', 'wxml'), /selected\.publicKey[\s\S]*已审核/);

  const ledger = loadPage({ root, route: 'pages/public-ledgers/index' }).page;
  ledger.jump({ currentTarget: { dataset: { selector: '#ledger-entries' } } });
  assert.equal(ledger.data.ledgerSection, 'entries');
  ledger.jump({ currentTarget: { dataset: { selector: '#ledger-overview' } } });
  assert.equal(ledger.data.ledgerSection, 'overview');
});

test('UI006 operations and trade controls retain touch targets and responsive containment', () => {
  const shared = fs.readFileSync(path.join(root, 'styles', 'figma-pages.wxss'), 'utf8');
  assert.match(shared, /\.figma-page \.figma-row[^{]*\{[^}]*min-height:\s*55px/s);
  assert.match(shared, /\.figma-page \.figma-action[^{]*\{[^}]*min-height:\s*48px/s);
  for (const page of pages) {
    const wxss = source(page, 'wxss');
    assert.match(wxss, /min-height:\s*4[48]px/, page + ': local buttons or tabs');
    assert.match(wxss, /@media \(max-width:\s*360px\)/, page + ': narrow layout');
    assert.doesNotMatch(wxss, /(?:^|[;{])\s*(?:min-)?width:\s*(?:[4-9]\d\d|[1-9]\d{3,})px/, page);
    assert.doesNotMatch(wxss, /overflow-x:\s*(?:scroll|auto)/, page);
  }
});

test('UI006 operations and trade routes render native templates at 320, 390 and 430 widths', () => {
  for (const page of pages) {
    const route = 'pages/' + page + '/index';
    const { page: definition } = loadPage({ root, route });
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route, data: definition.data, width, height: 844 });
      assert.match(preview.phone, /figma-page/, route + ': ' + width);
      assert.doesNotMatch(preview.phone, />undefined</, route + ': ' + width);
      assert.doesNotMatch(preview.phone, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//, route);
    }
  }
});

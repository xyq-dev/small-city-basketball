const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const pages = [
  'watch',
  'local',
  'teams',
  'city-select',
  'search',
  'media',
  'event',
  'match',
  'public-archives',
  'public-archive',
  'follows',
  'recruitment',
  'poster',
  'team',
  'team-request',
  'team-requests',
  'team-join',
  'memberships',
  'invitation',
  'registration-events',
  'entry',
];

function source(page, extension) {
  return fs.readFileSync(path.join(root, 'pages', page, 'index.' + extension), 'utf8');
}

test('UI006 public and team pages use native Figma page structure', () => {
  for (const page of pages) {
    const wxml = source(page, 'wxml');
    const wxss = source(page, 'wxss');
    assert.match(wxml, /<scb-header\b/, page + ': shared native header');
    assert.match(wxml, /class="[^"]*figma-page\b/, page + ': scoped Figma page root');
    assert.match(wxss, /^@import "\.\.\/\.\.\/styles\/figma-pages\.wxss";/, page);
    assert.doesNotMatch(wxml, /<v3-chrome\b|\bui002-|class="page(?:\s|")/, page);
    assert.doesNotMatch(wxml + wxss, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//, page);
  }
  for (const page of ['watch', 'local', 'teams']) {
    const wxml = source(page, 'wxml');
    assert.match(wxml, /<scb-nav\b/, page + ': main navigation remains available');
    assert.match(wxml, /figma-page__content--nav/, page + ': bottom navigation clearance');
  }
  assert.match(source('media', 'wxml'), /figma-page__content--actions/);
  assert.doesNotMatch(source('media', 'wxml'), /<scb-nav\b/);
});

test('UI006 public and team WXML parses and every event target exists', () => {
  for (const page of pages) {
    const route = 'pages/' + page + '/index';
    const tree = parseWxml(source(page, 'wxml'));
    const { page: definition } = loadPage({ root, route });
    for (const handler of eventHandlers(tree))
      assert.equal(typeof definition[handler], 'function', route + ': ' + handler);
  }
});

test('poster kind label is precomputed instead of calling JavaScript in WXML', () => {
  const wxml = source('poster', 'wxml');
  const script = source('poster', 'js');
  assert.match(wxml, /\{\{kindLabel\}\}/);
  assert.doesNotMatch(wxml, /indexOf\s*\(|\{\{[^}]*\w+\s*\([^}]*\}\}/);
  assert.match(script, /kindLabel:\s*'授权阵容'/);
  assert.match(script, /kindLabel:\s*this\.data\.labels\[index\]/);
});

test('match media marker actions keep the outer media id and inner marker id distinct', () => {
  const wxml = source('match', 'wxml');
  assert.match(wxml, /wx:for-item="mediaItem"/);
  assert.match(wxml, /wx:for-item="marker"/);
  assert.match(wxml, /data-id="\{\{mediaItem\.publicMediaId\}\}"/);
  assert.match(wxml, /data-marker="\{\{marker\.publicMarkerId\}\}"/);
});

test('UI006 rebuild keeps explicit loading, failure, empty and action states', () => {
  for (const page of pages) {
    const wxml = source(page, 'wxml');
    if (page !== 'media') assert.match(wxml, /disabled=/, page + ': disabled or submitting state');
  }
  for (const page of pages.filter((page) => !['media', 'city-select', 'search'].includes(page))) {
    const wxml = source(page, 'wxml');
    assert.match(wxml, /loading/, page + ': loading state');
    assert.match(wxml, /error/, page + ': failure state');
  }
  assert.match(source('city-select', 'wxml'), /catalogLoading/);
  assert.match(source('city-select', 'wxml'), /catalogError/);
  assert.match(source('search', 'wxml'), /busy/);
  assert.match(source('search', 'wxml'), /error/);
  assert.match(source('watch', 'wxml'), /暂无公开赛事/);
  assert.match(source('event', 'wxml'), /该赛事已停止公开/);
  assert.match(source('match', 'wxml'), /该比赛已停止公开/);
  assert.match(source('team-request', 'wxml'), /结果待核对/);
  assert.match(source('entry', 'wxml'), /操作结果待核对/);
});

test('UI006 rebuild retains permission, consent and duplicate-write semantics', () => {
  const checks = {
    teams: [/uncertain/, /acknowledgeUnknown/, /sessionRevision/],
    event: [/_followGen/, /cancelFollow/, /requestPublic/],
    'public-archives': [/publicConsent/, /publisherConsent/, /profileCommand/],
    recruitment: [/clientRequestId/, /pending/, /recover/],
    team: [/canManage/, /uncertain/, /issueJoinCode/],
    'team-request': [/clientRequestId/, /pending/, /recover/],
    'team-requests': [/ORG_OWNER/, /ORG_ADMIN/, /canReview/],
    'team-join': [/confirmedWrite/, /uncertain/, /normalizeJoinCode/],
    memberships: [/confirmedWrite/, /uncertain/, /leave/],
    invitation: [/consent/, /sessionRevision/, /ui\.confirm/],
    'registration-events': [/chargeAccepted/, /confirmOp/, /sessionRevision/, /validEntry/],
    entry: [/fileConsent/, /uncertain/, /clientRequestId|beginWrite/],
  };
  for (const [page, patterns] of Object.entries(checks)) {
    const script = source(page, 'js');
    for (const pattern of patterns) assert.match(script, pattern, page + ': ' + pattern);
  }
});

test('UI006 page controls retain 44px touch targets and responsive containment', () => {
  const shared = fs.readFileSync(path.join(root, 'styles', 'figma-pages.wxss'), 'utf8');
  assert.match(shared, /\.figma-page \.(?:figma-row)[^{]*\{[^}]*min-height:\s*55px/s);
  assert.match(shared, /\.figma-page \.figma-action[^{]*\{[^}]*min-height:\s*48px/s);
  assert.match(shared, /@media \(max-width:\s*360px\)/);
  for (const page of pages) {
    const wxss = source(page, 'wxss');
    assert.doesNotMatch(wxss, /(?:^|[;{])\s*(?:min-)?width:\s*(?:[4-9]\d\d|[1-9]\d{3,})px/, page);
    assert.doesNotMatch(wxss, /overflow-x:\s*(?:scroll|auto)/, page);
  }
  for (const page of [
    'watch',
    'teams',
    'event',
    'match',
    'public-archive',
    'team-requests',
    'entry',
  ])
    assert.match(source(page, 'wxss'), /min-height:4[48]px/, page + ': tabs/actions are touchable');
});

test('UI006 assigned routes render native templates at 320, 390 and 430 widths', () => {
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

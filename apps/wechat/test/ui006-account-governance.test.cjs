const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const pages = [
  'participant-materials',
  'insurance',
  'qualification-precheck',
  'guardian',
  'youth-review',
  'planned',
  'account-recovery',
  'messages',
  'notification-settings',
  'account-closure',
  'governance',
  'governance-reviews',
];

function source(page, extension) {
  return fs.readFileSync(path.join(root, 'pages', page, 'index.' + extension), 'utf8');
}

test('UI006 profile, safeguards and governance pages use the scoped Figma system', () => {
  for (const page of pages) {
    const wxml = source(page, 'wxml');
    const wxss = source(page, 'wxss');
    assert.match(wxml, /<scb-header\b/, page + ': native shared header');
    assert.match(wxml, /class="[^"]*figma-page\b/, page + ': scoped page root');
    assert.match(wxss, /^@import "\.\.\/\.\.\/styles\/figma-pages\.wxss";/, page);
    assert.doesNotMatch(wxml, /<v3-chrome\b|\bui002-|class="page(?:\s|")/, page);
    assert.doesNotMatch(wxml + wxss, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//, page);
  }
});

test('UI006 profile, safeguards and governance templates parse with real handlers', () => {
  for (const page of pages) {
    const route = 'pages/' + page + '/index';
    const tree = parseWxml(source(page, 'wxml'));
    const { page: definition } = loadPage({ root, route });
    for (const handler of eventHandlers(tree))
      assert.equal(typeof definition[handler], 'function', route + ': ' + handler);
  }
});

test('UI006 profile and governance flows preserve distinct state and write semantics', () => {
  const templates = Object.fromEntries(pages.map((page) => [page, source(page, 'wxml')]));
  assert.match(templates['participant-materials'], /资料待补充/);
  assert.match(templates['participant-materials'], /statusLabel/);
  assert.match(templates['participant-materials'], /用途授权[\s\S]*相关服务/);
  assert.match(templates.insurance, /在线投保暂未开放/);
  assert.match(templates.insurance, /办理进度/);
  assert.match(templates['qualification-precheck'], /本人申请|独立审核/);
  assert.match(templates.guardian, /监护人.*独立确认/);
  assert.match(templates.guardian, /监护关系[\s\S]*可选公开用途/);
  assert.match(templates['youth-review'], /监护关系审核/);
  assert.match(templates.planned, /确定场次报价[\s\S]*条件意向[\s\S]*原单查询/);
  assert.match(templates['account-recovery'], /邮箱[\s\S]*操作码[\s\S]*处理进度/);
  assert.match(templates.messages, /今天[\s\S]*更早消息[\s\S]*消息工具/);
  assert.match(templates['notification-settings'], /微信订阅提醒/);
  assert.match(templates['notification-settings'], /渠道状态/);
  assert.match(templates['notification-settings'], /订阅记录/);
  assert.match(templates['account-closure'], /本人确认[\s\S]*处理阶段/);
  assert.match(templates.governance, /当前工单[\s\S]*关联来源[\s\S]*资料可见性/);
  assert.match(templates['governance-reviews'], /公开范围/);

  const scripts = {
    'participant-materials': source('participant-materials', 'js'),
    guardian:
      source('guardian', 'js') +
      fs.readFileSync(path.join(root, 'utils', 'youth-guardians-page.js'), 'utf8'),
    planned: source('planned', 'js'),
    'account-closure': source('account-closure', 'js'),
    governance: source('governance', 'js'),
  };
  assert.match(scripts['participant-materials'], /clientRequestId|commandId|pending/i);
  assert.match(scripts.guardian, /clientRequestId|commandId|pending/i);
  assert.match(scripts.planned, /refund|charge|payment/i);
  assert.match(scripts['account-closure'], /pending|requestId|command/i);
  assert.match(scripts.governance, /clientRequestId|commandId|pending/i);
});

test('insurance and account recovery progress is derived from current state', () => {
  const insurance = source('insurance', 'wxml');
  assert.match(insurance, /workspace\.orders\.length \? '已提交'/);
  assert.match(insurance, /policyLabels\[workspace\.orders\[0\]\.policyStatus\]/);
  const recovery = source('account-recovery', 'wxml');
  assert.match(recovery, /requestStatus === 'accepted'/);
  assert.match(recovery, /receiptStatus === 'complete'/);
  assert.doesNotMatch(recovery, /<view class="figma-status">待申请<\/view>/);
});

test('UI006 profile, safeguards and governance pages render at 320, 390 and 430', () => {
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const repository = path.resolve(root, '..', '..');
const fixtureRoot = path.join(repository, 'tests', 'mini-program', 'fixtures');
const read = (page, extension) =>
  fs.readFileSync(path.join(root, 'pages', page, `index.${extension}`), 'utf8');
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.json`), 'utf8'));

test('event 36:60 uses the Figma overview body and keeps real tab handlers', () => {
  const wxml = read('event', 'wxml');
  const wxss = read('event', 'wxss');
  assert.match(wxml, /本周赛程/);
  assert.match(wxml, /小组积分/);
  assert.match(wxml, /赛事服务/);
  assert.match(wxml, /排名与晋级/);
  assert.match(wxml, /视频与图片/);
  assert.match(wxml, /bindtap="followPrimary"/);
  assert.match(wxml, /bindtap="openSchedule"[^>]*>查看赛程/);
  assert.match(wxss, /\.event-hero image\s*\{[^}]*width:\s*128px;[^}]*height:\s*80px/s);
  assert.match(wxss, /\.event-service\s*\{[^}]*min-height:\s*85px/s);

  const { page } = loadPage({ root, route: 'pages/event/index' });
  page.openSchedule();
  assert.equal(page.data.overview, false);
  assert.equal(page.data.tab, 'schedule');
  page.tab({ currentTarget: { dataset: { tab: 'media' } } });
  assert.equal(page.data.tab, 'media');
  page.backToOverview();
  assert.equal(page.data.overview, true);
});

test('booking-create 36:79 keeps labels outside 48px controls and scope changes real state', async () => {
  const wxml = read('booking-create', 'wxml');
  const wxss = read('booking-create', 'wxss');
  assert.match(
    wxml,
    /booking-display-group"><view class="figma-field-label">代表球队<\/view><button class="booking-display-control"/,
  );
  assert.match(wxss, /\.booking-display-control\s*\{[^}]*min-height:\s*48px/s);
  assert.match(wxss, /\.booking-fee-row\s*\{[^}]*min-height:\s*55px/s);
  assert.match(wxml, /返回选人/);
  assert.doesNotMatch(wxml, /<figma-feedback type="info" title="当前仅提交合作预约"/);

  const { page } = loadPage({ root, route: 'pages/booking-create/index' });
  page.draft = { scope: 'SINGLE', slots: [{ conditional: false }], consent: false };
  page.editable = () => true;
  page.changed = () => page.setData({ scope: page.draft.scope });
  await page.changeScope({ currentTarget: { dataset: { scope: 'MULTI' } } });
  assert.equal(page.draft.scope, 'MULTI');
  assert.equal(page.data.scope, 'MULTI');
});

test('booking-detail 36:81 switches arrangement, fulfillment and fee bodies without faking results', () => {
  const wxml = read('booking-detail', 'wxml');
  assert.match(wxml, /data-tab="arrangement" bindtap="changeTab"/);
  assert.match(wxml, /data-tab="fulfillment" bindtap="changeTab"/);
  assert.match(wxml, /data-tab="fees" bindtap="changeTab"/);
  assert.match(wxml, /本场安排/);
  assert.match(wxml, /逐场合作进度/);
  assert.match(wxml, /本场费用/);
  assert.match(wxml, /bindtap="requestChange">提出改期/);
  assert.match(wxml, /bindtap="primaryTrade">查看本场资金订单/);

  const { page } = loadPage({ root, route: 'pages/booking-detail/index' });
  page.setData({ order: { appearances: [] }, activeTab: 'arrangement' });
  page.changeTab({ currentTarget: { dataset: { tab: 'fulfillment' } } });
  assert.equal(page.data.activeTab, 'fulfillment');
  page.changeTab({ currentTarget: { dataset: { tab: 'fees' } } });
  assert.equal(page.data.activeTab, 'fees');
  page.changeTab({ currentTarget: { dataset: { tab: 'unknown' } } });
  assert.equal(page.data.activeTab, 'fees');
});

test('three target fixtures render their Figma body at 320, 390 and 430 widths', () => {
  const scenarios = [
    ['event', 'ui006-event-detail-ready'],
    ['booking-create', 'ui006-booking-create-ready'],
    ['booking-detail', 'ui006-booking-detail-ready'],
  ];
  for (const [pageName, fixtureName] of scenarios) {
    const route = `pages/${pageName}/index`;
    const input = fixture(fixtureName);
    const base = loadPage({ root, route }).page.data;
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({
        root,
        route,
        data: { ...base, ...input.data },
        width,
        height: 844,
      });
      for (const text of input.expectText) assert.match(preview.phone, new RegExp(text), `${pageName} ${width}: ${text}`);
      assert.doesNotMatch(preview.phone, />undefined</, `${pageName} ${width}`);
      assert.doesNotMatch(preview.phone, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//);
    }
  }

  const detail = fixture('ui006-booking-detail-ready');
  const route = 'pages/booking-detail/index';
  const base = loadPage({ root, route }).page.data;
  const fulfillment = buildPreview({ root, route, data: { ...base, ...detail.data, activeTab: 'fulfillment' }, width: 390, height: 844 });
  const fees = buildPreview({ root, route, data: { ...base, ...detail.data, activeTab: 'fees' }, width: 390, height: 844 });
  assert.match(fulfillment.phone, /逐场合作进度/);
  assert.match(fulfillment.phone, /已接单/);
  assert.match(fees.phone, /确定报价/);
  assert.match(fees.phone, /实际资金/);
});

test('existing reads, permissions, duplicate-write guards and command validation remain wired', () => {
  const event = read('event', 'js');
  const create = read('booking-create', 'js');
  const detail = read('booking-detail', 'js');
  for (const pattern of [/requestPublic/, /_followGen/, /confirmOp/, /cancelFollow/]) assert.match(event, pattern);
  for (const pattern of [/recoveryStore\.execute/, /trade\.post\('\/preview'/, /ui\.begin/, /needsRequote/]) assert.match(create, pattern);
  for (const pattern of [/model\.allowed/, /model\.command/, /ui\.live/, /sourceId:\s*model\.id\(id\)/]) assert.match(detail, pattern);
});

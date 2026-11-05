const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

test('UI001 home keeps its real header and exact vector assets without a second native title bar', () => {
  const preview = buildPreview({ root, route: 'pages/home/index', width: 390, height: 844 });
  assert.match(preview.phone, /<header class="mini-custom-status"/);
  assert.doesNotMatch(preview.phone, /<header class="mini-native-bar"/);
  assert.match(preview.phone, /按位置找球员/);
  assert.ok(preview.assets.some((asset) => asset.path === 'assets/home/brandmark.svg'));
  assert.ok(preview.assets.some((asset) => asset.path === 'assets/home/hero.jpg'));
  assert.equal(
    preview.assets.some((asset) => /court-night|home-slogan|homepage-reference/.test(asset.path)),
    false,
  );
  assert.match(preview.phone, /每一场/);
  assert.match(preview.phone, /都值得被看见/);
  assert.ok(preview.assets.every((asset) => !/approved-six-screen|design\/C11/.test(asset.path)));
  const classic = buildPreview({ root, route: 'pages/watch/index' });
  assert.match(classic.phone, /<header class="mini-custom-status"/);
  assert.doesNotMatch(classic.phone, /<header class="mini-native-bar"/);
});

test('custom-header respects pending-operation locks and actual status/capsule geometry', () => {
  const h = loadComponent({
    root,
    route: 'components/header/index',
    properties: { disabled: true },
  });
  const events = [];
  h.instance.triggerEvent = (name) => events.push(name);
  h.instance.goBack();
  h.instance.search();
  assert.equal(h.wx.calls.length, 0);
  assert.deepEqual(events, []);
  h.wx.getWindowInfo = () => ({ statusBarHeight: 38 });
  h.wx.getMenuButtonBoundingClientRect = () => ({ width: 86 });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.statusBarHeight, 38);
  assert.equal(h.instance.data.capsulePresent, true);
  h.wx.getWindowInfo = () => ({ statusBarHeight: 10000 });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.statusBarHeight, 38);
});

test('custom-header can hand state-specific back handling to its page without navigating twice', () => {
  const h = loadComponent({
    root,
    route: 'components/header/index',
    properties: { emitBack: true },
  });
  const events = [];
  h.instance.triggerEvent = (name) => events.push(name);
  h.instance.goBack();
  assert.deepEqual(events, ['back']);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'navigateBack' || call.type === 'reLaunch'),
    false,
  );
});

test('home position shortcuts pass only finite positions, while the booking extension retains original entries', () => {
  const h = loadPage({ root, route: 'pages/home/index' });
  h.page.position({ currentTarget: { dataset: { position: '__proto__' } } });
  assert.equal(h.wx.calls.length, 0);
  h.page.position({ currentTarget: { dataset: { position: 'PG' } } });
  assert.ok(h.wx.calls.some((call) => call.url === '/pages/players/index?position=PG'));
  const preview = buildPreview({ root, route: 'pages/home/index', data: h.page.data });
  assert.match(preview.phone, /扩展服务/);
  assert.match(preview.phone, /查看我的预约/);
  assert.match(preview.phone, /进入本人球员中心/);
  assert.match(preview.phone, /不自动加入赛事报名名单/);
});

test('header dark-to-light transitions update native status text rather than leaving white text on permission screens', () => {
  const h = loadComponent({ root, route: 'components/header/index', properties: { dark: true } });
  const colors = [];
  h.wx.setNavigationBarColor = (value) => colors.push(value.frontColor);
  h.definition.lifetimes.attached.call(h.instance);
  h.definition.observers.dark.call(h.instance, false);
  assert.deepEqual(colors, ['#ffffff', '#000000']);
});

test('image compatibility keeps declared native crop and contain modes rather than stretching artwork', () => {
  const fixture = require('../../../tests/mini-program/fixtures/c11-player-detail-ready.json');
  const preview = buildPreview({ root, route: fixture.route, data: fixture.data });
  assert.match(preview.phone, /data-mini-image-mode="aspectFill"/);
  const event = require('../../../tests/mini-program/fixtures/c10-public-event-ready.json');
  const eventPreview = buildPreview({ root, route: event.route, data: event.data });
  assert.match(eventPreview.phone, /data-mini-image-mode="aspectFill"/);
  assert.match(eventPreview.phone, /data-mini-image-mode="aspectFit"/);
  assert.match(preview.phone, /\[data-mini-image-mode=aspectFill\]\{object-fit:cover\}/);
  assert.match(preview.phone, /\[data-mini-image-mode=aspectFit\]\{object-fit:contain\}/);
});

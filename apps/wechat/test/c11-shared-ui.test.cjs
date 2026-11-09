const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

test('UI006 home expands the new Figma header, exact assets and no second native title bar', () => {
  const preview = buildPreview({ root, route: 'pages/home/index', width: 390, height: 844 });
  assert.match(preview.phone, /<header class="mini-custom-status"/);
  assert.doesNotMatch(preview.phone, /<header class="mini-native-bar"/);
  assert.match(preview.phone, /搜赛事、球队、球员/);
  assert.ok(
    preview.assets.some((asset) => asset.path === 'assets/home/header-brandmark-35-41.svg'),
  );
  assert.ok(preview.assets.some((asset) => asset.path === 'assets/home/hero.jpg'));
  assert.equal(
    preview.assets.some((asset) => /court-night|home-slogan|homepage-reference/.test(asset.path)),
    false,
  );
  assert.match(preview.phone, /让热爱，有主场/);
  assert.match(preview.phone, /看赛事/);
  assert.match(preview.phone, /球队档案/);
  assert.doesNotMatch(preview.phone, /每一场|都值得被看见|示意图/);
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
  h.wx.getWindowInfo = () => ({ statusBarHeight: 38, windowWidth: 390 });
  h.wx.getMenuButtonBoundingClientRect = () => ({ width: 86, left: 296, bottom: 82 });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.statusBarHeight, 38);
  assert.equal(h.instance.data.capsulePresent, true);
  h.wx.getWindowInfo = () => ({ statusBarHeight: 10000, windowWidth: 390 });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.statusBarHeight, 38);
});

test('home header reports one chrome height and refreshes it after a narrow resize', () => {
  const h = loadComponent({
    root,
    route: 'components/header/index',
    properties: { mode: 'home' },
  });
  const layouts = [];
  h.instance.triggerEvent = (name, detail) => {
    if (name === 'layoutchange') layouts.push(detail);
  };
  h.wx.getWindowInfo = () => ({ statusBarHeight: 47, windowWidth: 390 });
  h.wx.getMenuButtonBoundingClientRect = () => ({ width: 86, left: 296, bottom: 83 });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(layouts.at(-1).height, 152);
  assert.equal(layouts.at(-1).narrow, false);
  h.wx.getWindowInfo = () => ({ statusBarHeight: 47, windowWidth: 320 });
  h.wx.getMenuButtonBoundingClientRect = () => ({ width: 86, left: 226, bottom: 83 });
  h.definition.pageLifetimes.resize.call(h.instance);
  assert.equal(layouts.at(-1).height, 196);
  assert.equal(layouts.at(-1).narrow, true);

  const page = loadPage({ root, route: 'pages/home/index' });
  page.wx.getWindowInfo = () => ({
    statusBarHeight: 47,
    windowWidth: 320,
    windowHeight: 844,
    screenHeight: 844,
    safeArea: { bottom: 810 },
  });
  page.page.headerLayout({ detail: { height: 196 } });
  assert.equal(page.page.data.contentHeight, 564);
});

test('home position shortcuts pass only finite positions, while rebuilt extensions retain original entries', () => {
  const h = loadPage({ root, route: 'pages/home/index' });
  h.page.position({ currentTarget: { dataset: { position: '__proto__' } } });
  assert.equal(h.wx.calls.length, 0);
  h.page.position({ currentTarget: { dataset: { position: 'PG' } } });
  assert.ok(h.wx.calls.some((call) => call.url === '/pages/players/index?position=PG'));
  const preview = buildPreview({ root, route: 'pages/home/index', data: h.page.data });
  assert.match(preview.phone, /按位置找球员/);
  assert.match(preview.phone, /查看我的预约/);
  assert.match(preview.phone, /进入本人球员中心/);
  assert.match(preview.phone, /不会自动加入赛事报名名单/);
});

test('header dark-to-light transitions update native status text rather than leaving white text on permission screens', () => {
  const h = loadComponent({ root, route: 'components/header/index', properties: { dark: true } });
  const colors = [];
  h.wx.setNavigationBarColor = (value) => colors.push(value.frontColor);
  h.definition.lifetimes.attached.call(h.instance);
  h.definition.observers.dark.call(h.instance, false);
  assert.deepEqual(colors, ['#ffffff', '#000000']);
});

test('image compatibility keeps declared native aspectFill/widthFix rather than stretching portrait photos', () => {
  const fixture = require('../../../tests/mini-program/fixtures/c11-player-detail-ready.json');
  const preview = buildPreview({ root, route: fixture.route, data: fixture.data });
  assert.match(preview.phone, /data-mini-image-mode="aspectFill"/);
  const media = require('../../../tests/mini-program/fixtures/c10-public-match-media.json');
  const mediaPreview = buildPreview({ root, route: media.route, data: media.data });
  assert.match(mediaPreview.phone, /data-mini-image-mode="widthFix"/);
  assert.match(preview.phone, /\[data-mini-image-mode=aspectFill\]\{object-fit:cover\}/);
  assert.match(preview.phone, /\[data-mini-image-mode=widthFix\]\{height:auto\}/);
});

test('Figma tabs and fixed actions are isolated from legacy global button spacing', () => {
  const tabs = fs.readFileSync(path.join(root, 'components/figma-tabs/index.wxss'), 'utf8');
  const pages = fs.readFileSync(path.join(root, 'styles/figma-pages.wxss'), 'utf8');
  const system = fs.readFileSync(path.join(root, 'styles/figma-system.wxss'), 'utf8');
  const header = fs.readFileSync(path.join(root, 'components/header/index.wxss'), 'utf8');
  assert.match(tabs, /\.figma-tab\.is-active\s*\{[^}]*background:#123c73[^}]*color:#ffffff/s);
  assert.match(system, /(?:^|\n)button\s*\{[^}]*background:\s*transparent/s);
  assert.doesNotMatch(system, /\.scb-ui-page button\s*\{[^}]*background:\s*transparent/s);
  assert.match(pages, /\.figma-page button\s*\{[^}]*margin:\s*0/s);
  assert.match(pages, /\.figma-page__content--actions\s*\{[^}]*80px/s);
  assert.match(pages, /\.figma-page \.figma-action\s*\{[^}]*margin:\s*0/s);
  assert.match(header, /\.figma-header__title\s*\{[^}]*text-align:left/s);
  assert.doesNotMatch(header, /\.figma-header__title\s*\{[^}]*position:absolute/s);
});

test('the five audited Figma corrections stay scoped to their intended surfaces', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const local = read('pages/local/index.wxss');
  const watch = read('pages/watch/index.wxml');
  const teams = read('pages/teams/index.wxml');
  const account = read('pages/account/index.wxml');
  const accountStyles = read('pages/account/index.wxss');
  const navigation = read('components/navigation/index.wxml');
  const navigationStyles = read('components/navigation/index.wxss');
  const home = read('pages/home/index.wxss');

  assert.match(
    local,
    /\.local-rebuild \.local-tabs > \.local-tab[^}]*width:auto[^}]*margin:0[^}]*padding:0 4px[^}]*box-sizing:border-box/s,
  );
  assert.match(local, /\.local-rebuild \.local-tabs > \.local-tab::after[^}]*border:0/s);
  assert.match(
    watch,
    /^<scb-header mode="{{figmaState==='watch-empty' \? '' : 'account'}}" title="{{figmaState==='watch-empty' \? '暂无公开赛事' : '赛事'}}"/,
  );
  assert.match(teams, /^<scb-header mode="account" title="球队"/);
  assert.match(
    account,
    /account-list-row account-legal-row[^>]*bindtap="openAgreement"[^>]*><view class="account-legal-row__mark"[^>]*\/>/s,
  );
  assert.match(
    accountStyles,
    /\.account-legal-row > \.account-legal-row__mark[^}]*width:18px[^}]*height:18px[^}]*border-radius:3px/s,
  );
  assert.match(navigation, /<figma-icon[^>]*size="23"\/>/);
  assert.match(navigationStyles, /\.figma-nav__item[^}]*font-size:11px[^}]*line-height:16px/s);
  assert.match(navigationStyles, /\.figma-nav__label\s*\{[^}]*height:16px/s);
  assert.match(home, /\.home-section__title[^}]*font-size:20px[^}]*line-height:27px/s);
});

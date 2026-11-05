const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registeredRoutes } = require('./helpers/native-preview.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '../..');

test('restored homepage keeps 44px targets on the bell and section actions', () => {
  const css = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
  // .home-ui button { width:auto } outranks a single-class bell rule, so the
  // 44px bell box has to be at least as specific as that shared button rule.
  assert.match(css, /\.home-ui \.home-bell\s*\{[^}]*\bwidth:\s*44px/);
  assert.match(css, /\.home-section-head button\s*\{[^}]*\bmin-height:\s*44px/);
});

test('layout checks register fixture routes from the main package and subpackages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const routes = registeredRoutes(manifest);
  const registered = new Set(routes);
  const fixtures = path.join(repo, 'tests/mini-program/fixtures');
  for (const file of fs.readdirSync(fixtures).filter((name) => name.endsWith('.json'))) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));
    assert.ok(registered.has(fixture.route), file + ' -> ' + fixture.route);
  }
  const spec = fs.readFileSync(path.join(repo, 'tests/e2e/mini-program.spec.ts'), 'utf8');
  const evidence = fs.readFileSync(
    path.join(repo, 'scripts/check-mini-layout-evidence.mjs'),
    'utf8',
  );
  assert.match(spec, /registeredRoutes\(manifest\)/);
  assert.doesNotMatch(spec, /manifest\.pages\)\.toContain\(scenario\.route\)/);
  assert.doesNotMatch(evidence, /manifest\.pages\.includes\(fixture\.route\)/);
  // Fixture membership alone still passes if the initial matrix stays on the six tab
  // pages. Initial scenarios have to follow the same full route list, including a
  // subpackage page, with one name each. A second joiner must not turn a missing
  // subpackage root into the segment "undefined".
  assert.match(spec, /const routes = registeredRoutes\(manifest\)/);
  assert.match(spec, /\.\.\.routes\.map\(\(route\)/);
  assert.doesNotMatch(spec, /manifest\.pages\.map\(\(route\)/);
  assert.match(evidence, /registered-routes\.cjs/);
  assert.match(evidence, /const routes = registeredRoutes\(manifest\)/);
  assert.match(evidence, /Duplicate initial native scenario/);
  assert.doesNotMatch(evidence, /function registeredRoutes/);
  assert.doesNotMatch(evidence, /manifest\.pages\.map\(\(route\)/);
  assert.doesNotMatch(evidence, /String\(pack\.root\)/);
  const joined = registeredRoutes({
    pages: ['pages/home/index'],
    subpackages: [{ pages: ['index'] }],
  });
  assert.equal(joined.includes('undefined/index'), false);
  assert.ok(routes.includes('pages/city-select/index'));
  assert.ok(routes.length > manifest.pages.length);
  // The restored homepage stays in the same matrix: no shared header, pack hero.
  assert.match(spec, /expect\(metrics\.header\)\.toBeNull\(\)/);
  assert.match(spec, /homepage-pack/);
  assert.match(spec, /metrics\.hero\?\.height\)\.toBe\(204\)/);
  assert.match(spec, /if \(group !== 'home'\) expect\(metrics\.header\?\.height\)\.toBe\(84\)/);
});

test('a long city name stays in the city slot and a 320-wide capsule moves the brand row down', () => {
  const css = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
  assert.match(css, /\.home-brand-name\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.home-brand-name\s*\{[^}]*font-size:\s*20px/);
  assert.doesNotMatch(
    css,
    /@media\(max-width:360px\)[\s\S]*?\.home-brand-name\s*\{[^}]*font-size:\s*17px/,
  );
  assert.match(css, /\.home-city view[^{]*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.home-ui \.home-city\s*\{[^}]*min-width:\s*44px/);
  assert.match(js, /brandOffset/);
  const wx = createWx();
  const home = loadPage({ root, route: 'pages/home/index', wx });
  wx.getWindowInfo = () => ({ windowWidth: 320, windowHeight: 568, statusBarHeight: 20 });
  wx.getMenuButtonBoundingClientRect = () => ({
    left: 226,
    right: 313,
    top: 24,
    bottom: 56,
    width: 87,
    height: 32,
  });
  home.page.syncChrome();
  assert.equal(home.page.data.capsuleGap, 0);
  assert.equal(home.page.data.brandOffset, 44);
  wx.getWindowInfo = () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47 });
  wx.getMenuButtonBoundingClientRect = () => ({
    left: 296,
    right: 383,
    top: 51,
    bottom: 83,
    width: 87,
    height: 32,
  });
  home.page.syncChrome();
  assert.equal(home.page.data.capsuleGap, 86);
  assert.equal(home.page.data.brandOffset, 0);
  const longName = '合成二十字超长城市名称仅供界面测试使用';
  const phone = buildPreview({
    root,
    route: 'pages/home/index',
    width: 320,
    data: {
      citySelection: { mode: 'LEGACY_CITY', label: longName, source: '本次选择' },
    },
  }).phone;
  assert.match(phone, /小城市篮球/);
  assert.match(phone, new RegExp(longName));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview, registeredRoutes } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '../..');

test('restored homepage keeps 44px targets on the bell and section actions', () => {
  const css = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
  const header = fs.readFileSync(path.join(root, 'components/header/index.wxss'), 'utf8');
  assert.match(
    header,
    /button\.figma-header__message\s*\{[^}]*\bwidth:44px[^}]*\bmax-width:44px[^}]*\bflex:0 0 44px[^}]*\bmargin:0 !important/,
  );
  assert.match(header, /button\.figma-header__city\s*\{[^}]*\bmargin:0 !important/);
  assert.match(header, /\.figma-header__home-row\s*\{[^}]*\bjustify-content:flex-start/);
  assert.match(css, /\.home-rebuild \.home-section__more\s*\{[^}]*\bmin-height:44px/);
});

test('rebuilt homepage scopes native button resets before grid and text-link sizing', () => {
  const css = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
  assert.match(
    css,
    /\.home-rebuild \.home-quick__item,[\s\S]*\.home-rebuild \.home-extra__links button\s*\{[^}]*\bwidth:auto;[^}]*\bmargin:0;[^}]*\bbackground:transparent;/,
  );
  assert.match(css, /\.home-rebuild \.home-extra__links button::after\s*\{[^}]*\bborder:0;/);
  assert.doesNotMatch(css, /\.home-rebuild button\s*\{/);
  assert.doesNotMatch(css, /\.home-rebuild button::after/);
  assert.match(css, /\.home-rebuild \.home-section__more\s*\{[^}]*\bline-height:17px;/);
  assert.match(
    css,
    /\.home-rebuild \.home-section__more\s*\{[^}]*\bwidth:auto;[^}]*\bbackground:transparent;/,
  );
  assert.match(css, /\.home-rebuild \.home-position-grid button\s*\{[^}]*\bwidth:auto;/);
  assert.match(
    css,
    /\.home-rebuild \.home-extra__links button\s*\{[^}]*\bwidth:auto;[^}]*\bbackground:#ffffff;/,
  );
});

test('homepage empty state uses the plain feedback layout only', () => {
  const page = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
  const feedback = fs.readFileSync(path.join(root, 'components/figma-feedback/index.wxss'), 'utf8');
  assert.match(
    page,
    /plain="\{\{true\}\}" type="empty" title="\{\{citySelection\.label\}\}暂无进行中赛事"/,
  );
  assert.doesNotMatch(page, /暂无进行中赛事[\s\S]{0,180}action-label="查看全部赛事"/);
  assert.match(page, /class="home-section__more" bindtap="openEvents"/);
  assert.match(feedback, /\.figma-feedback--plain\s*\{[^}]*height:112px[^}]*background:#f4f6fa/);
  assert.match(
    feedback,
    /\.figma-feedback--plain \.figma-feedback__body\s*\{[^}]*font-size:14px[^}]*line-height:22px/,
  );
  assert.match(feedback, /\.figma-feedback--error\s*\{[^}]*background:#fdecef/);
  assert.match(feedback, /\.figma-feedback--pending\s*\{[^}]*background:#fff1e2/);
  assert.match(feedback, /\.figma-feedback--success\s*\{[^}]*background:#e5f7ee/);
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
  assert.ok(routes.includes('pages/watch/index'));
  // UI006 keeps the rebuilt homepage in the same matrix with exact latest-Figma geometry.
  assert.match(spec, /expect\(metrics\.header\?\.height\)\.toBe\(width <= 360 \? 196 : 152\)/);
  assert.match(spec, /expect\(metrics\.hero\?\.x\)\.toBe\(0\)/);
  assert.match(spec, /expect\(metrics\.hero\?\.height\)\.toBe\(204\)/);
  assert.match(spec, /latest:UI006:35:38\/59:54/);
  // UI006 uses a 44px status inset plus a 44px navigation row on rebuilt secondary pages.
  assert.match(spec, /expect\(metrics\.header\?\.height\)\.toBe\(88\)/);
});

test('featured more-events link stays enabled and opens the events page', () => {
  const source = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
  const more = source.match(
    /<button class="home-section__more" bindtap="openEvents" disabled="\{\{uiPreview\}\}">更多赛事 ›<\/button>/,
  );
  const local = source.match(
    /<button class="home-section__more" bindtap="openLocal" disabled="\{\{uiPreview\}\}">查看全部 ›<\/button>/,
  );
  assert.ok(more);
  assert.ok(local);
  assert.doesNotMatch(more[0], /openLocal|查看全部赛事/);
  const wx = createWx();
  const h = loadPage({ root, route: 'pages/home/index', wx });
  h.page.onLoad({});
  assert.equal(h.page.uiPreview, false);
  h.page.openEvents();
  assert.deepEqual(
    wx.calls.filter((call) => call.type === 'navigateTo').map((call) => call.url),
    ['/pages/watch/index'],
  );
  for (const file of ['c20-home-empty.json', 'c22-home-region.json']) {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(repo, 'tests/mini-program/fixtures', file), 'utf8'),
    );
    assert.deepEqual(fixture.data.publicEvents, []);
    assert.equal(fixture.data.publicLoaded, true);
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({
        root,
        route: fixture.route,
        data: fixture.data,
        width,
        height: 844,
      });
      const button = preview.phone.match(
        /<button\b(?=[^>]*data-mini-bindtap="openEvents")(?![^>]*\sdisabled(?:\s|>|=))[^>]*>更多赛事 ›<\/button>/,
      );
      assert.ok(button, file + ' ' + width);
      assert.equal(preview.phone.includes('查看全部赛事'), false, file + ' ' + width);
    }
  }
});

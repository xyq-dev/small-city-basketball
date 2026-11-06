const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registeredRoutes } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '../..');

test('restored homepage keeps 44px targets on the bell and section actions', () => {
  const css = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
  const header = fs.readFileSync(path.join(root, 'components/header/index.wxss'), 'utf8');
  assert.match(header, /\.figma-header__message\s*\{[^}]*\bwidth:44px/);
  assert.match(css, /\.home-rebuild \.home-section__more\s*\{[^}]*\bmin-height:44px/);
});

test('rebuilt homepage scopes native button resets before grid and text-link sizing', () => {
  const css = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
  assert.match(
    css,
    /\.home-rebuild button\s*\{[^}]*\bwidth:auto;[^}]*\bmargin:0;[^}]*\bbackground:transparent;/,
  );
  assert.match(css, /\.home-rebuild button::after\s*\{[^}]*\bborder:0;/);
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
  // UI006 keeps the rebuilt homepage in the same matrix with exact latest-Figma geometry.
  assert.match(spec, /expect\(metrics\.header\?\.height\)\.toBe\(width <= 360 \? 196 : 152\)/);
  assert.match(spec, /expect\(metrics\.hero\?\.x\)\.toBe\(0\)/);
  assert.match(spec, /expect\(metrics\.hero\?\.height\)\.toBe\(204\)/);
  assert.match(spec, /latest:UI006:35:38\/59:54/);
  assert.match(spec, /if \(group !== 'home'\) expect\(metrics\.header\?\.height\)\.toBe\(84\)/);
});

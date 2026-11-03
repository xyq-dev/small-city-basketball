const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registeredRoutes } = require('./helpers/native-preview.cjs');

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
  assert.match(spec, /width <= 360 \? 180 : 188/);
  assert.match(spec, /if \(group !== 'home'\) expect\(metrics\.header\?\.height\)\.toBe\(84\)/);
});

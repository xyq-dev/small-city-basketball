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
  const registered = new Set(registeredRoutes(manifest));
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
  assert.match(evidence, /subpackages/);
  assert.doesNotMatch(evidence, /manifest\.pages\.includes\(fixture\.route\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPreview, registeredRoutes } = require('./helpers/native-preview.cjs');
const { loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const repository = path.resolve(root, '..', '..');
const fixtureRoot = path.join(repository, 'tests', 'mini-program', 'fixtures');
const routeMap = JSON.parse(
  fs.readFileSync(path.join(repository, 'tests', 'mini-program', 'ui006-route-map.json'), 'utf8'),
);
const states = JSON.parse(
  fs.readFileSync(
    path.join(repository, 'tests', 'mini-program', 'ui006-state-scenarios.json'),
    'utf8',
  ),
);
const visualScenarios = JSON.parse(
  fs.readFileSync(
    path.join(repository, 'tests', 'mini-program', 'ui006-visual-scenarios.json'),
    'utf8',
  ),
);

function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    output[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? merge(output[key], value)
        : structuredClone(value);
  }
  return output;
}

function scenarioData(scenario) {
  const page = loadPage({ root, route: scenario.route }).page.data;
  let data = page;
  if (scenario.fixture) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, scenario.fixture), 'utf8'));
    assert.equal(fixture.route, scenario.route, `${scenario.name} fixture route`);
    data = merge(data, fixture.data || {});
  }
  return merge(data, scenario.data || {});
}

test('UI006 route map matches exactly 73 registered native pages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const actual = registeredRoutes(manifest);
  const expected = routeMap.map((entry) => entry.route);
  assert.equal(actual.length, 73);
  assert.equal(new Set(actual).size, 73);
  assert.equal(routeMap.length, 73);
  assert.equal(new Set(expected).size, 73);
  assert.equal(new Set(routeMap.map((entry) => entry.figmaNode)).size, 73);
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

test('all 73 routes use native rebuilt templates and render at 320/390/430', () => {
  for (const { route, figmaNode } of routeMap) {
    const base = path.join(root, route);
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.equal(fs.existsSync(`${base}.${extension}`), true, `${route}.${extension}`);
    }
    const wxml = fs.readFileSync(`${base}.wxml`, 'utf8');
    const wxss = fs.readFileSync(`${base}.wxss`, 'utf8');
    assert.match(wxml, /(?:figma-page|scb-ui-page)/, `${route} (${figmaNode}) rebuilt root`);
    if (route === 'pages/insurance/index') {
      assert.match(wxml, /<web-view\s+wx:if="{{checkoutUrl}}"\s+src="{{checkoutUrl}}"/);
    } else {
      assert.doesNotMatch(wxml, /<web-view\b/i, route);
    }
    assert.doesNotMatch(wxml + wxss, /https?:\/\/(?:www\.)?figma\.com\//i, route);
    const data = loadPage({ root, route }).page.data;
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route, data, width, height: 844 });
      assert.match(preview.phone, /(?:figma-page|scb-ui-page)/, `${route} ${width}`);
    }
  }
});

test('73 primary visual fixtures cover every route and retain their business assertions', () => {
  const expectedRoutes = routeMap.map((entry) => entry.route).sort();
  const scenarioRoutes = visualScenarios.map((entry) => entry.route).sort();
  assert.equal(visualScenarios.length, 73);
  assert.equal(new Set(visualScenarios.map((entry) => entry.name)).size, 73);
  assert.equal(new Set(scenarioRoutes).size, 73);
  assert.deepEqual(scenarioRoutes, expectedRoutes);

  for (const scenario of visualScenarios) {
    const fixtureFile = path.join(fixtureRoot, scenario.fixture);
    assert.equal(fs.existsSync(fixtureFile), true, scenario.fixture);
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    assert.equal(fixture.route, scenario.route, scenario.name);
    const expectedText = scenario.expectText || fixture.expectText;
    assert.ok(expectedText?.length, `${scenario.name} retains expected business copy`);
    const data = scenarioData(scenario);
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route: scenario.route, data, width, height: 844 });
      for (const copy of expectedText) {
        assert.ok(
          preview.phone.includes(copy),
          `${scenario.name} (${scenario.figmaNode}) ${width}: ${copy}`,
        );
      }
    }
  }
});

test('17 supplemental states remain host-route branches and render at three widths', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const routes = registeredRoutes(manifest);
  assert.equal(states.length, 17);
  assert.equal(new Set(states.map((state) => state.name)).size, 17);
  assert.equal(new Set(states.map((state) => state.figmaNode)).size, 17);

  for (const state of states) {
    assert.ok(routes.includes(state.route), `${state.name} host route`);
    assert.equal(
      routes.some((route) => route.includes(state.name)),
      false,
      state.name,
    );
    const data = scenarioData(state);
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({
        root,
        route: state.route,
        data,
        width,
        height: 844,
      });
      for (const copy of state.expectText) {
        assert.ok(
          preview.phone.includes(copy),
          `${state.name} (${state.figmaNode}) ${width}: ${copy}`,
        );
      }
    }
  }
});

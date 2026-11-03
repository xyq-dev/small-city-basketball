const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseWxml, eventHandlers, validateExpression } = require('./helpers/wxml.cjs');
const { loadPage } = require('./helpers/native-page.cjs');
const { registeredRoutes } = require('./helpers/registered-routes.cjs');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const routes = registeredRoutes(manifest);
const mainTabs = [
  'pages/home/index',
  'pages/watch/index',
  'pages/account/index',
  'pages/teams/index',
  'pages/local/index',
];

test('native manifest routes are unique, local and include loadable Page/templates', () => {
  assert.deepEqual(manifest.pages.slice(0, mainTabs.length), mainTabs);
  assert.ok(manifest.pages.includes('pages/trade-order/index'));
  assert.equal(manifest.pages.length, 6);
  assert.equal(manifest.subpackages.length, 67);
  assert.equal(routes.length, 73);
  assert.equal(new Set(routes).size, routes.length);
  assert.ok(Array.isArray(manifest.subpackages) && manifest.subpackages.length > 0);
  for (const pack of manifest.subpackages) {
    assert.match(pack.root, /^pages\/[a-z0-9-]+$/);
    assert.deepEqual(pack.pages, ['index']);
  }
  for (const route of routes) {
    assert.match(route, /^pages\/[a-z0-9-]+\/index$/);
    assert.equal(fs.existsSync(path.join(root, route + '.js')), true, route);
    assert.equal(fs.existsSync(path.join(root, route + '.wxml')), true, route);
    const config = path.join(root, route + '.json');
    if (fs.existsSync(config))
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(config, 'utf8')));
  }
  const subRoots = new Set((manifest.subpackages || []).map((pack) => pack.root));
  const packageOf = (file) => {
    const match = /^pages\/([a-z0-9-]+)\//.exec(file);
    if (!match) return 'main';
    const root = 'pages/' + match[1];
    return subRoots.has(root) ? root : 'main';
  };
  for (const route of routes) {
    const owner = packageOf(route + '.js');
    const source = fs.readFileSync(path.join(root, route + '.js'), 'utf8');
    for (const match of source.matchAll(/require\((['"])(\.\.?\/[^'"]+)\1\)/g)) {
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(route + '.js'), match[2]),
      );
      const targetPackage = packageOf(target);
      assert.ok(
        targetPackage === 'main' || targetPackage === owner,
        route + ' cannot require ' + target + ' from another package',
      );
    }
  }
  for (const route of routes) {
    const wxss = route + '.wxss';
    const file = path.join(root, wxss);
    if (!fs.existsSync(file)) continue;
    const owner = packageOf(wxss);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/@import\s+(['"])([^'"]+)\1/g)) {
      const spec = match[2];
      const target = spec.startsWith('/')
        ? spec.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(wxss), spec));
      assert.equal(fs.existsSync(path.join(root, target)), true, wxss + ' -> ' + target);
      const targetPackage = packageOf(target);
      assert.ok(
        targetPackage === 'main' || targetPackage === owner,
        wxss + ' cannot import ' + target + ' from another package',
      );
    }
  }
  for (const route of [
    'pages/local-bookings/index',
    'pages/local-matchups/index',
    'pages/local-manage/index',
  ]) {
    const css = fs.readFileSync(path.join(root, route + '.wxss'), 'utf8');
    assert.match(css, /\.local-private \.status-banner\{[^}]*background:#eaf0f8/);
    assert.doesNotMatch(css, /@import/);
  }
  for (const route of ['pages/training/index', 'pages/training-manage/index']) {
    const css = fs.readFileSync(path.join(root, route + '.wxss'), 'utf8');
    assert.match(css, /\.title\{[^}]*font-size:24px/);
  }
  assert.match(
    fs.readFileSync(path.join(root, 'pages/training-manage/index.wxss'), 'utf8'),
    /\.training-manage \.workflow-tabs\{align-items:stretch\}/,
  );
});

test('pages with a custom header disable the native navigation bar', () => {
  for (const route of routes) {
    const source = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
    if (!/<scb-header(?:\s|>)/.test(source)) continue;
    const configPath = path.join(root, route + '.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    assert.equal(
      config.navigationStyle || manifest.window?.navigationStyle,
      'custom',
      route + ': native and custom navigation bars must not stack',
    );
  }
});

// The runtime sets these on every Page instance; a same-named method is replaced at runtime
// (booking-detail once called this.route() and failed before reading the order).
const builtIns = [
  'route',
  'options',
  'data',
  'setData',
  'selectComponent',
  'is',
  '__wxExparserNodeId__',
];
test('page definitions never shadow built-in page instance properties', () => {
  for (const route of routes) {
    let definition;
    new vm.Script(fs.readFileSync(path.join(root, route + '.js'), 'utf8')).runInNewContext({
      Page(value) {
        definition = value;
      },
      require: () => new Proxy({}, { get: () => () => ({}) }),
      wx: {},
      getApp: () => ({}),
    });
    for (const name of builtIns)
      if (name !== 'data')
        assert.equal(
          Object.prototype.hasOwnProperty.call(definition, name),
          false,
          route + ': ' + name,
        );
  }
});

for (const route of routes) {
  test('native template and static event targets: ' + route, () => {
    const source = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
    const tree = parseWxml(source);
    const { page } = loadPage({ root, route });
    for (const handler of eventHandlers(tree))
      assert.equal(typeof page[handler], 'function', route + ': ' + handler);
    const script = fs.readFileSync(path.join(root, route + '.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(script, { filename: route }));
    assert.doesNotMatch(script + source, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//);
    for (const match of (script + source).matchAll(
      /["'](\/pages\/[a-z0-9-]+\/index)(?:\?[^"']*)?["']/g,
    )) {
      assert.equal(
        routes.includes(match[1].slice(1)),
        true,
        'Unregistered literal route: ' + match[1],
      );
    }
  });
}

test('component WXSS comments contain no semicolon; DevTools 3.17.4 then never starts AppService', () => {
  // Reproduced 2026-10-26: "/* a; b */" in components/header/index.wxss left the simulator
  // unresponsive to automation, while the same comment in a page stylesheet compiled normally.
  const files = [];
  (function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.name.endsWith('.wxss')) files.push(file);
    }
  })(path.join(root, 'components'));
  assert.ok(files.length > 0);
  for (const file of files)
    for (const [comment] of fs.readFileSync(file, 'utf8').matchAll(/\/\*[\s\S]*?\*\//g))
      assert.doesNotMatch(comment, /;/, path.relative(root, file));
});

test('static WXML checks reject malformed branches, duplicate attributes and JS calls', () => {
  for (const invalid of [
    '<view><text>x</view>',
    '<view class="a" class="b"/>',
    '<view wx:else>x</view>',
    '<view>{{money(price)}}</view>',
    '<view bindtap="doThing()"/>',
    '<view>{{unfinished</view>',
  ]) {
    assert.throws(() => eventHandlers(parseWxml(invalid)), invalid);
  }
  for (const expression of [
    'x=3',
    'new Date()',
    'item?.name',
    'a++',
    'process.env',
    '({}).constructor',
  ]) {
    assert.throws(() => validateExpression(expression), expression);
  }
});

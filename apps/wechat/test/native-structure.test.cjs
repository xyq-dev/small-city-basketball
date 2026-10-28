const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseWxml, eventHandlers, validateExpression } = require('./helpers/wxml.cjs');
const { loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

test('native manifest routes are unique, local and include loadable Page/templates', () => {
  assert.ok(Array.isArray(manifest.pages) && manifest.pages.length > 0);
  assert.equal(new Set(manifest.pages).size, manifest.pages.length);
  for (const route of manifest.pages) {
    assert.match(route, /^pages\/[a-z0-9-]+\/index$/);
    assert.equal(fs.existsSync(path.join(root, route + '.js')), true, route);
    assert.equal(fs.existsSync(path.join(root, route + '.wxml')), true, route);
    const config = path.join(root, route + '.json');
    if (fs.existsSync(config))
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(config, 'utf8')));
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
  for (const route of manifest.pages) {
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

for (const route of manifest.pages) {
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
        manifest.pages.includes(match[1].slice(1)),
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

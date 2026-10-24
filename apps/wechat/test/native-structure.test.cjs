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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets/approved-ui');
const sources = path.resolve(root, '../../tools/wechat-icons/src');
const tones = ['navy', 'orange', 'gray', 'white', 'green'];

function png(file) {
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.subarray(1, 4).toString() === 'PNG', file);
  // IHDR: width, height, bit depth, colour type (6 = RGBA).
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colour: bytes[25] };
}
function templates(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'test') templates(file, found);
    else if (entry.name.endsWith('.wxml')) found.push(file);
  }
  return found;
}

test('every icon source has all tones as transparent 120px PNGs, and no SVG ships at runtime', () => {
  const names = fs.readdirSync(sources).map((file) => file.replace(/\.svg$/, ''));
  assert.ok(names.length >= 28);
  for (const name of names) {
    assert.match(fs.readFileSync(path.join(sources, name + '.svg'), 'utf8'), /currentColor/);
    for (const tone of tones) {
      const info = png(path.join(assets, 'icon-' + name + '-' + tone + '.png'));
      assert.deepEqual(info, { width: 120, height: 120, colour: 6 }, name + '-' + tone);
    }
  }
  assert.deepEqual(
    fs.readdirSync(assets).filter((file) => /^icon-.*\.svg$/.test(file)),
    [],
  );
});

test('every literal icon name/tone in templates resolves to a local asset', () => {
  for (const file of templates(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [tag] of source.matchAll(/<scb-icon\b[^>]*>/g)) {
      const name = /\bname="([a-z-]+)"/.exec(tag);
      const tone = /\btone="([a-z]+)"/.exec(tag);
      if (!name) continue; // dynamic names are checked below
      const value = tone ? tone[1] : 'navy';
      assert.ok(
        fs.existsSync(path.join(assets, 'icon-' + name[1] + '-' + value + '.png')),
        path.relative(root, file) + ': ' + name[1] + '-' + value,
      );
    }
  }
});

test('navigation uses house/trophy/play/person with orange selected and gray idle on every tab', () => {
  for (const active of ['Home', 'Events', 'Video', 'Account']) {
    const nav = loadComponent({
      root,
      route: 'components/navigation/index',
      properties: { active },
    });
    assert.deepEqual(
      nav.instance.data.items.map((item) => item.icon),
      ['home', 'trophy', 'play', 'user'],
    );
  }
  // The video tab renders the shared bar: its own icon in orange, the other three in gray.
  const bar = buildPreview({ root, route: 'pages/media/index' })
    .assets.map((asset) => path.basename(asset.path))
    .filter((file) => /^icon-(home|trophy|play|user)-/.test(file))
    .sort();
  assert.deepEqual(bar, [
    'icon-home-gray.png',
    'icon-play-orange.png',
    'icon-trophy-gray.png',
    'icon-user-gray.png',
  ]);
  const html = fs.readFileSync(path.join(root, 'components/navigation/index.wxml'), 'utf8');
  assert.match(html, /tone="\{\{active===item\.key \? 'orange' : 'gray'\}\}"/);
  assert.doesNotMatch(html, /nav-dot|wx:else/);
});

test('home entries and positions use the mapped icons; positions keep labels and filters', () => {
  const html = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
  for (const name of ['court', 'users', 'chart', 'play'])
    assert.match(html, new RegExp('name="' + name + '"'));
  assert.doesNotMatch(html, /name="trophy"/);
  const h = loadPage({ root, route: 'pages/home/index' });
  assert.deepEqual(
    h.page.data.positions.map((p) => [p.code, p.name, p.icon]),
    [
      ['PG', '控卫', 'pos-pg'],
      ['SG', '分卫', 'pos-sg'],
      ['SF', '小前', 'pos-sf'],
      ['PF', '大前', 'pos-pf'],
      ['C', '中锋', 'pos-c'],
    ],
  );
  for (const position of h.page.data.positions)
    assert.ok(fs.existsSync(path.join(assets, 'icon-' + position.icon + '-navy.png')));
});

test('no Unicode glyph or dot is used as a functional icon inside buttons', () => {
  for (const file of templates(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [button] of source.matchAll(/<button\b[\s\S]*?<\/button>/g))
      assert.doesNotMatch(button, /[⋯●○✓✔＋→←›‹]/, path.relative(root, file));
  }
});

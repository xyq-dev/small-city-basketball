const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const hash = (file) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex')
    .toUpperCase();

test('home binds the Figma jersey while the bottom Teams destination keeps its teams icon', () => {
  const home = read('pages/home/index.wxml');
  const navigation = read('components/navigation/index.js');
  const shortcut = home.match(/<button[^>]*data-page="teams"[\s\S]*?<\/button>/)?.[0] || '';

  assert.match(shortcut, /<figma-icon name="jersey" size="26"\/>/);
  assert.match(shortcut, /<view>我的球队<\/view>/);
  assert.doesNotMatch(shortcut, /<figma-icon name="teams"/);
  assert.match(
    navigation,
    /\{ key: 'Teams', label: '球队', icon: 'teams' \}/,
    'bottom navigation must not inherit the homepage jersey asset',
  );
});

test('home header slots use the exact transparent Figma exports and recorded fingerprints', () => {
  const manifest = JSON.parse(read('test/fixtures/home-figma-icons.json'));
  const header = read('components/header/index.wxml');
  assert.equal(manifest.fileKey, 'QpKOskViUwHFVqSG3uYR9X');
  assert.equal(manifest.frameNodeId, '35:38');
  assert.deepEqual(
    manifest.assets.map(({ nodeId }) => nodeId),
    ['35:41', '35:53', '35:56', '35:60'],
  );

  for (const asset of manifest.assets) {
    const source = read(asset.path);
    assert.equal(
      hash(asset.path),
      asset.sha256,
      `${asset.slot} bytes changed without a Figma export review`,
    );
    assert.match(
      header,
      new RegExp(`src="/${asset.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      `${asset.slot} must remain bound to its audited home-only asset`,
    );
    assert.match(
      source,
      new RegExp(`<svg[^>]*width="${asset.width}"[^>]*height="${asset.height}"`),
    );
    assert.doesNotMatch(source, /<rect\b/, `${asset.slot} must retain a transparent background`);
    assert.ok(asset.wholeNodeExportSha256);
    assert.ok(asset.transparentLayerSha256.length >= 1);
  }

  assert.match(read(manifest.assets[0].path), /stroke-width="3\.2"/);
  assert.match(read(manifest.assets[1].path), /stroke="white"[^>]*stroke-width="1\.8"/);
  assert.match(read(manifest.assets[2].path), /fill="white"[^>]*stroke="white"/);
  assert.match(read(manifest.assets[3].path), /stroke="#63758B"/);
  assert.doesNotMatch(header, /https:\/\/www\.figma\.com\/api\/mcp\/asset\//);
});

test('featured event card keeps node 35:102 geometry without truncating longer status text', () => {
  const styles = read('pages/home/index.wxss');
  assert.match(styles, /\.home-rebuild \.home-event-card[^}]*border-radius:14px/s);
  assert.match(styles, /\.home-event-card__image[^}]*border-radius:8px/s);
  assert.match(styles, /\.home-event-card__name[^}]*font-size:17px[^}]*line-height:23px/s);
  assert.match(
    styles,
    /\.home-event-card__status[^}]*min-width:58px[^}]*height:20px[^}]*padding:0 8px[^}]*border-radius:5px[^}]*font-size:11px[^}]*line-height:15px/s,
  );
  assert.doesNotMatch(styles, /\.home-event-card__status[^}]*(?:^|[;{]\s*)width:58px/s);
});

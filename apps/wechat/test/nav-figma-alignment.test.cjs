const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const directory = require('../utils/directory');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('a successful empty directory is distinct from loading, failure and rows', () => {
  assert.equal(
    directory.successfulEmpty({ loaded: true, loading: false, error: '', items: [] }),
    true,
  );
  assert.equal(
    directory.successfulEmpty({ loaded: false, loading: true, error: '', items: [] }),
    false,
  );
  assert.equal(
    directory.successfulEmpty({ loaded: false, loading: false, error: '读取失败', items: [] }),
    false,
  );
  assert.equal(
    directory.successfulEmpty({
      loaded: true,
      loading: false,
      error: '',
      items: [{ publicEventId: 'a', name: '合成冬季杯' }],
    }),
    false,
  );
});

test('the events page binds the live hero and empty state without a sample event', () => {
  const page = read('pages/watch/index.wxml');
  const script = read('pages/watch/index.js');
  const style = read('pages/watch/index.wxss');
  assert.equal(page.includes('城市篮球邀请赛'), false);
  assert.match(page, /watch-hero__title">\{\{citySelection\.label\}\}公开赛事/);
  assert.match(page, /wx:if="\{\{directoryEmpty\}\}"/);
  assert.match(page, /bindtap="pickDirGroup"/);
  assert.match(page, /bindtap="resetDirGroup"/);
  assert.match(page, /bindtap="clearDirCity"/);
  assert.match(page, /bindtap="chooseCity"/);
  assert.match(script, /directory\.successfulEmpty\(/);
  assert.match(script, /resetDirGroup\(\)/);
  assert.doesNotMatch(script, /items\[0\]/);
  assert.match(
    style,
    /\.watch-page \.watch-tabs > \.watch-tab[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0[^}]*height:44px[^}]*min-height:44px[^}]*margin:0[^}]*padding:0 4px[^}]*box-sizing:border-box/s,
  );
  assert.match(style, /\.watch-page \.watch-tabs > \.watch-tab\.is-active[^}]*background:#123c73/s);
});

test('the local active tab wins its own rule and only the local title is 21/30', () => {
  const local = read('pages/local/index.wxss');
  const shared = read('styles/figma-pages.wxss');
  assert.match(
    local,
    /\.local-rebuild \.local-tabs > \.local-tab\.is-active[^}]*background:#123c73[^}]*color:#fff/s,
  );
  assert.match(
    local,
    /\.local-rebuild \.local-summary \.figma-title[^}]*font-size:21px[^}]*font-weight:700[^}]*line-height:30px/s,
  );
  assert.match(shared, /\.figma-title\s*\{[^}]*font-size:\s*18px[^}]*line-height:\s*26px/s);
  assert.match(read('pages/local/index.wxml'), /kind === 'COURT' \? 'is-active'/);
  assert.match(read('pages/local/index.js'), /kind: 'COURT'/);
});

test('the white header uses the Figma 3:39 export and the home header stays separate', () => {
  const header = read('components/header/index.wxml');
  const asset = fs.readFileSync(path.join(root, 'assets/home/header-brandmark-3-39.svg'));
  const hash = createHash('sha256').update(asset).digest('hex').toUpperCase();
  assert.equal(hash, 'AA0CEC08D2FD1AB0262674FFC5EAAAE65E20E373322689DD68CAEA8E18C33EC7');
  assert.match(asset.toString('utf8'), /mask0_3_39/);
  assert.match(header, /mode==='home'[\s\S]*header-brandmark-35-41\.svg/);
  assert.match(header, /mode==='account'[\s\S]*header-brandmark-3-39\.svg/);
  assert.match(read('components/v3-chrome/index.wxml'), /src="\/assets\/home\/brandmark\.svg"/);
  assert.match(read('pages/home/index.wxml'), /name="jersey"/);
  assert.match(read('components/navigation/index.wxml'), /name="\{\{item\.icon\}\}"/);
  assert.match(read('components/navigation/index.js'), /icon: 'teams'/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const directory = require('../utils/directory');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const brandPath = path.join(root, 'assets/home/header-brandmark-3-39.svg');
const brandExpected = 'AA0CEC08D2FD1AB0262674FFC5EAAAE65E20E373322689DD68CAEA8E18C33EC7';

const crlfToLf = (bytes) => {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      parts.push(0x0a);
      i += 1;
    } else parts.push(bytes[i]);
  }
  return Buffer.from(parts);
};

const brandIdentity = (bytes) =>
  createHash('sha256').update(crlfToLf(bytes)).digest('hex').toUpperCase();

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
    page,
    /<block wx:else>\s*<view id="watch-directory"[\s\S]*?<\/view>\s*<\/block>\s*<view class="figma-section">\s*<view class="figma-section__title">赛事入口/s,
  );
  assert.match(page, /id="watch-private"/);
  assert.match(page, /id="watch-recent"/);
  assert.match(page, /id="watch-link-entry"/);
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
  const asset = fs.readFileSync(brandPath);
  assert.equal(brandIdentity(asset), brandExpected);
  assert.match(asset.toString('utf8'), /mask0_3_39/);
  assert.match(header, /mode==='home'[\s\S]*header-brandmark-35-41\.svg/);
  assert.match(header, /mode==='account'[\s\S]*header-brandmark-3-39\.svg/);
  assert.match(read('components/v3-chrome/index.wxml'), /src="\/assets\/home\/brandmark\.svg"/);
  assert.match(read('pages/home/index.wxml'), /name="jersey"/);
  assert.match(read('components/navigation/index.wxml'), /name="\{\{item\.icon\}\}"/);
  assert.match(read('components/navigation/index.js'), /icon: 'teams'/);
});

test('brand identity treats CRLF as LF and still rejects other asset changes', () => {
  const lf = crlfToLf(fs.readFileSync(brandPath));
  const crlf = Buffer.from(
    Array.from(lf, (byte) => (byte === 0x0a ? [0x0d, 0x0a] : [byte])).flat(),
  );
  assert.equal(brandIdentity(lf), brandExpected);
  assert.equal(brandIdentity(crlf), brandExpected);
  assert.notEqual(
    createHash('sha256').update(lf).digest('hex'),
    createHash('sha256').update(crlf).digest('hex'),
  );
  const changed = Buffer.from(lf);
  const at = changed.indexOf('mask0_3_39');
  assert.notEqual(at, -1);
  changed[at + 'mask0_3_39'.length - 1] = '8'.charCodeAt(0);
  assert.notEqual(brandIdentity(changed), brandExpected);
});

test('the teams registration action stays on one line inside the 140px button', () => {
  const page = read('pages/teams/index.wxml');
  const style = read('pages/teams/index.wxss');
  assert.match(page, /class="teams-actions"[\s\S]*选择可报名赛事[\s\S]*进入球队/);
  assert.match(page, /bindtap="events"/);
  assert.match(page, /bindtap="team"/);
  assert.match(style, /\.teams-actions\{[^}]*grid-template-columns:140px/);
  assert.match(
    style,
    /\.teams-page \.teams-actions \.figma-action\{[^}]*padding:0 12px[^}]*white-space:nowrap/,
  );
});

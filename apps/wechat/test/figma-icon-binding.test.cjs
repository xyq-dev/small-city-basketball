const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function text(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
}

function sha256(file) {
  return crypto.createHash('sha256').update(text(file)).digest('hex');
}

test('back chevron is the Figma 3:121 export, and the old navy PNG is not called', () => {
  assert.equal(
    sha256('assets/figma/chevron-left.svg'),
    '8771437a8f5e940b49128fcf25931454ab3e33f1c32c806c0709a63dceb637ea',
  );
  const header = text('components/header/index.wxml');
  const style = text('components/header/index.wxss');
  assert.match(header, /\/assets\/figma\/chevron-left\.svg/);
  assert.doesNotMatch(header, /icon-chevron-left-navy\.png/);
  assert.match(style, /\.figma-header__back image \{ width:24px; height:24px; \}/);
  for (const file of [
    'pages/dispatch/index.wxml',
    'pages/matching/index.wxml',
    'pages/training/index.wxml',
    'pages/training-manage/index.wxml',
  ]) {
    assert.doesNotMatch(text(file), /icon-chevron-left-navy\.png/, file);
    assert.match(text(file), /\/assets\/figma\/chevron-left\.svg/, file);
  }
});

test('local related-service row uses the page instance, not the same-library dispatch icon', () => {
  assert.equal(
    sha256('assets/figma/workbench.svg'),
    '9a7a1709411156b47753c98883acf28488fb339cf725cd54b8e09118c3643e4a',
  );
  assert.equal(
    sha256('assets/figma/dispatch.svg'),
    '9fb819523fa341723cd59c8cf08f8b7f4fced6d33aac095ed503a05803859e4e',
  );
  assert.notEqual(sha256('assets/figma/workbench.svg'), sha256('assets/figma/dispatch.svg'));
  const local = text('pages/local/index.wxml');
  const row = /data-page="dispatch"[\s\S]{0,180}/.exec(local);
  assert.ok(row, 'cross-city row missing');
  assert.match(row[0], /name="workbench"/);
  assert.match(row[0], /size="19"/);
  assert.doesNotMatch(row[0], /name="dispatch"/);
  const matching = /data-page="matching"[\s\S]{0,160}/.exec(local);
  assert.match(matching[0], /name="matching" size="19"/);
});

test('dispatch page keeps its own dispatch glyph and the schedule instances', () => {
  const page = text('pages/dispatch/index.wxml');
  assert.match(page, /name="dispatch" size="25"/);
  assert.equal(page.match(/name="schedule" size="18"/g).length, 2);
});

test('dark back uses the 115:237 export and still rejects a path or color change', () => {
  const file = 'assets/figma/chevron-left-inverse.svg';
  const bytes = fs.readFileSync(path.join(root, file));
  const identity = crypto.createHash('sha256').update(text(file)).digest('hex');
  assert.equal(identity, 'd66368fd46dbd4ae79f8c6a69da9fc63d85f041802d9a25e7200c6d44b6dc465');
  assert.equal(bytes.length, 213);
  const header = text('components/header/index.wxml');
  assert.match(
    header,
    /dark \? '\/assets\/figma\/chevron-left-inverse\.svg' : '\/assets\/figma\/chevron-left\.svg'/,
  );
  assert.doesNotMatch(header, /icon-chevron-left-white\.png/);
  const style = text('components/header/index.wxss');
  assert.match(style, /button\.figma-header__back[\s\S]*width:44px/);
  assert.match(style, /\.figma-header__back image \{ width:24px; height:24px; \}/);
  const source = text(file);
  const pathChanged = source.replace('M15 18L9 12L15 6', 'M16 18L9 12L15 6');
  const colorChanged = source.replace('stroke="white"', 'stroke="#123C73"');
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  assert.notEqual(hash(pathChanged), identity);
  assert.notEqual(hash(colorChanged), identity);
});

test('manuscript section links stay text, and the extra row arrows stay removed', () => {
  const home = text('pages/home/index.wxml');
  const style = text('pages/home/index.wxss');
  assert.match(home, />更多赛事 ›<\/button>/);
  assert.match(home, />查看全部 ›<\/button>/);
  assert.match(home, />全部赛事 ›<\/button>/);
  assert.doesNotMatch(home, /chevron-right\.svg/);
  assert.match(style, /\.home-rebuild \.home-section__more\s*\{[^}]*font-size:12px/);
  assert.match(style, /\.home-rebuild \.home-section__more\s*\{[^}]*line-height:17px/);
  assert.match(style, /\.home-rebuild \.home-section__more\s*\{[^}]*color:#51657d/);
  for (const file of [
    'pages/trade-order/index.wxml',
    'pages/trade-manage/index.wxml',
    'pages/sponsor-commerce/index.wxml',
    'pages/public-ledgers/index.wxml',
    'pages/city-operations/index.wxml',
  ]) {
    assert.doesNotMatch(text(file), /chevron-down-white/, file);
    assert.doesNotMatch(text(file), /chevron-left-inverse/, file);
  }
  const media = text('pages/media-jobs/index.wxml');
  for (const icon of ['clock.svg', 'bars.svg', 'play.svg', 'chevron.svg'])
    assert.doesNotMatch(media, new RegExp(icon.replace('.', '\\.')), icon);
  assert.match(media, /class="media-step__number">1/);
  assert.match(media, /class="media-step__number">2/);
  assert.match(media, /class="media-step__number">3/);
  assert.match(media, /\/assets\/figma\/media\.svg/);
  const training = text('pages/training-manage/index.wxml');
  assert.doesNotMatch(training, /icon-arrow-right-navy\.png/);
  assert.match(training, /class="setup-link" data-key="setup" bindtap="manageTab"/);
});

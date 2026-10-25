const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const fixtures = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixtures, 'c10-profile-' + name + '.json'), 'utf8'));
const preview = (fixture) => buildPreview({ root, ...fixture, width: 390, height: 844 }).phone;
const action = (html, handler) =>
  html.match(new RegExp('<button[^>]*data-mini-bindtap="' + handler + '"[^>]*>'))?.[0];
const disabled = (tag) => /\sdisabled(?:\s|>)/.test(tag || '');

test('profile visual states render expected current content from real templates at all three widths', () => {
  for (const name of fs.readdirSync(fixtures).filter((n) => n.startsWith('c10-profile-'))) {
    const f = JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
    for (const width of [320, 390, 430]) {
      const result = buildPreview({ root, ...f, width, height: 844 });
      for (const text of f.expectText) assert.ok(result.phone.includes(text), name + ': ' + text);
      assert.doesNotMatch(result.phone, /<script\b|src="https?:/);
    }
  }
});

test('detail and records views keep real zero distinct from empty personal statistics', () => {
  const ready = preview(read('player-ready'));
  assert.match(ready, /0 分 \/ 0 犯规/);
  const records = preview(read('player-records'));
  assert.match(records, /得分 0 \/ 犯规 0/);
  assert.match(records, /仅球队数据，不计入个人均值分母/);
  const missing = preview(read('player-empty-statistics'));
  assert.match(missing, /个人比赛数据：未统计/);
  assert.match(missing, /不以0分替代缺失/);
  assert.doesNotMatch(missing, /得分 0 \/ 犯规 0/);
});

test('profile review states never advertise an unapproved archive as currently bookable', () => {
  assert.match(preview(read('center-ready')), /当前可预约/);
  for (const name of ['center-pending', 'center-changes', 'center-disabled'])
    assert.doesNotMatch(preview(read(name)), /当前可预约/);
  assert.match(preview(read('center-disabled')), /停用档案不自动取消已有约定/);
});

test('paired profile fields retain explicit declaration and unknown submission locks', () => {
  const f = read('center-edit');
  const html = preview(f);
  assert.ok(disabled(action(html, 'save')));
  assert.equal((html.match(/data-mini-bindchange="consent"/g) || []).length, 1);
  const unknown = preview(read('center-unknown'));
  assert.match(unknown, /核对原资料提交/);
  for (const tag of unknown.match(/<input[^>]*data-mini-bindinput="input"[^>]*>/g) || [])
    assert.ok(disabled(tag));
});

test('consent view cannot enable confirmation without a fresh checked declaration', () => {
  const f = read('performance-consent');
  assert.ok(disabled(action(preview(f), 'submitDialog')));
  f.data.pending.consent = true;
  assert.equal(disabled(action(preview(f), 'submitDialog')), false);
  f.data.busy = true;
  assert.ok(disabled(action(preview(f), 'submitDialog')));
});

test('authorization permission loss hides stale records and confirmation even if old data is present', () => {
  const f = read('performance-consent');
  f.data.authorized = false;
  f.data.error = '当前权限已变化';
  const html = preview(f);
  assert.doesNotMatch(html, /合成青锋杯|合成林越|核对并明确同意/);
  assert.match(html, /当前权限已变化/);
});

test('nomination shortcut obeys the existing draft/write gate and never starts a network operation', () => {
  const wx = createWx();
  const calls = [];
  wx.pageScrollTo = (options) => calls.push(options);
  const h = loadPage({ root, route: 'pages/performance/index', wx });
  h.page.setData({ authorized: true, ownOnly: false, dirty: true });
  h.page.nomination();
  assert.equal(calls.length, 0);
  h.page.setData({ dirty: false });
  h.page.nomination();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].selector, '#nomination-section');
  assert.equal(
    wx.calls.some((c) => c.type === 'request'),
    false,
  );
});

test('profile editor sections only change the visible section and retain original draft, consent and write lock', () => {
  const h = loadPage({ root, route: 'pages/player-center/index' });
  const f = read('center-edit');
  h.page.setData({ ...f.data, editing: true, editorSection: 'PROFILE' });
  const draft = JSON.stringify(h.page.data.form);
  h.page.editSection({ currentTarget: { dataset: { section: 'FEES' } } });
  assert.equal(h.page.data.editorSection, 'FEES');
  assert.equal(JSON.stringify(h.page.data.form), draft);
  h.page.setData({ busy: true });
  h.page.editSection({ currentTarget: { dataset: { section: 'AVAILABILITY' } } });
  assert.equal(h.page.data.editorSection, 'FEES');
  h.page.setData({ busy: false });
  h.page._pending = { payload: { commandId: 'original-command' } };
  h.page.editSection({ currentTarget: { dataset: { section: 'AVAILABILITY' } } });
  assert.equal(h.page.data.editorSection, 'FEES');
  assert.equal(JSON.stringify(h.page.data.form), draft);
});

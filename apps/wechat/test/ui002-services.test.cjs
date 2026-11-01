const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
function page(name = 'matching') {
  const h = loadPage({ root, route: 'pages/' + name + '/index', wx: createWx() });
  h.page.onLoad({});
  return h;
}
function markup(name, data) {
  return buildPreview({ root, route: 'pages/' + name + '/index', data, width: 390, height: 844 })
    .phone;
}
const tap = (key) => ({ currentTarget: { dataset: { key } } });
test('matching reviews actual disclosure before publish and returns to editable fields without an API write', () => {
  const h = page();
  h.page.setData({ enabled: true, selected: { id: 'private-need' } });
  h.page.toggleCreate();
  assert.equal(h.page.data.selected, null);
  let html = markup('matching', h.page.data);
  assert.match(html, /下一步：审阅公开范围/);
  assert.doesNotMatch(html, /确认并发布需求/);
  h.page.reviewNeed();
  assert.match(h.page.data.error, /名称/);
  h.page.setData({
    form: { ...h.page.data.form, title: '合成成人篮球补位需求', address: '合成体育中心东侧二号场' },
    scope: [{ regionId: 'region', label: '合成地区长名称' }],
  });
  h.page.reviewNeed();
  html = markup('matching', h.page.data);
  assert.match(html, /合成成人篮球补位需求/);
  assert.match(html, /合成体育中心东侧二号场/);
  assert.match(html, /合成地区长名称/);
  assert.match(html, /意向不锁位、不付款/);
  assert.match(html, /确认并发布需求/);
  h.page.editNeed();
  assert.equal(h.page.data.form.title, '合成成人篮球补位需求');
  assert.doesNotMatch(markup('matching', h.page.data), /确认并发布需求/);
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
});
test('matching tab navigation and return preserve unresolved original commands and block busy transitions', () => {
  const h = page();
  const original = { body: { commandId: 'original-command' } };
  h.page.setData({
    pending: original,
    selected: { id: 'private-need' },
    conversion: { id: 'intent' },
    chargeConsent: true,
    eligibility: true,
  });
  h.page.overview();
  assert.equal(h.page.data.pending.body.commandId, 'original-command');
  assert.equal(h.page.data.chargeConsent, false);
  assert.equal(h.page.data.eligibility, false);
  h.page.workspaceTab(tap('inbox'));
  assert.equal(h.page.data.workspaceTab, 'inbox');
  h.page.setData({ busy: true });
  h.page.workspaceTab(tap('needs'));
  h.page.overview();
  assert.equal(h.page.data.workspaceTab, 'inbox');
  assert.equal(h.page.data.pending.body.commandId, 'original-command');
});
test('matching account change drops the privacy review and opt-ins instead of carrying them into a new actor', () => {
  const h = page();
  h.page.setData({
    creating: true,
    supplyOpen: true,
    formStep: 'review',
    adult: true,
    discovery: true,
    contact: true,
  });
  h.page.onSessionReset();
  assert.equal(h.page.data.creating, false);
  assert.equal(h.page.data.supplyOpen, false);
  assert.equal(h.page.data.adult, false);
  assert.equal(h.page.data.discovery, false);
  assert.equal(h.page.data.contact, false);
  assert.equal(h.page.data.loginRequired, true);
});

test('matching new actor cannot reopen another actor draft, scope, quote or charge consent', () => {
  const h = page();
  h.page.setData({
    enabled: true,
    conversionEnabled: true,
    form: { title: 'private previous-actor title', address: 'private previous-actor address' },
    formRegion: { regionId: 'private-region' },
    scope: [{ regionId: 'private-region' }],
    windows: [{ date: 'private-date' }],
    terms: 'private negotiated terms',
    preview: { merchantName: 'private merchant' },
    chargeConsent: true,
    eligibility: true,
    courts: [{ id: 'private-booking' }],
    teamIndex: 4,
    orgIndex: 3,
  });
  h.page.onSessionReset();
  assert.equal(h.page.data.enabled, false);
  assert.equal(h.page.data.conversionEnabled, false);
  assert.equal(h.page.data.form.title, '');
  assert.equal(h.page.data.form.address, '');
  assert.equal(h.page.data.formRegion, null);
  assert.equal(h.page.data.scope.length, 0);
  assert.notEqual(h.page.data.windows[0].date, 'private-date');
  assert.equal(h.page.data.terms, '');
  assert.equal(h.page.data.preview, null);
  assert.equal(h.page.data.chargeConsent, false);
  assert.equal(h.page.data.eligibility, false);
  assert.equal(h.page.data.courts.length, 0);
  h.page.toggleCreate();
  const html = markup('matching', h.page.data);
  assert.doesNotMatch(
    html,
    /private previous-actor|private negotiated|private-region|private merchant/,
  );
});

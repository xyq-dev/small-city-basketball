const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const model = require('../utils/performance-data');
const fixture = require('../../../tests/mini-program/fixtures/int01-performance-source-unavailable.json');

const root = path.resolve(__dirname, '..');
const route = fixture.route;
const clone = (value) => structuredClone(value);
function setup({ capabilities } = {}) {
  const calls = [];
  const client = {
    sessionRevision: () => 1,
    request(url, method = 'GET') {
      calls.push({ url, method });
      throw Error('Source status rendering must not read or write data');
    },
  };
  const h = loadPage({ root, route, wx: createWx() });
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad({});
  const raw = clone(fixture.data.links[0]);
  for (const key of ['sourceText', 'statusText', 'revokeText']) delete raw[key];
  if (capabilities) raw.capabilities = capabilities;
  assert.equal(model.link(raw), true, 'The normal regression starts with an actual link DTO');
  assert.equal(raw.status, 'PENDING');
  assert.equal(raw.sourceCurrentlyAvailable, false);
  assert.equal(Object.hasOwn(raw, 'sourceStatusText'), false);
  h.page._links = [raw];
  h.page.setData({ ...clone(fixture.data), links: [] });
  h.page.updateLinks();
  return { ...h, raw, calls };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
function badge(page, width = 390) {
  const html = render(page, width);
  const match = html.match(
    />来源比赛<\/div>[\s\S]*?<div[^>]*class="(figma-status[^"]*)"[^>]*>([^<]*)<\/div>/,
  );
  assert.ok(match, 'The real first-card source row must render its status badge');
  return { classes: match[1], text: match[2], html };
}
const actions = (page) =>
  (render(page).match(/<button\b[^>]*>/g) || []).filter((tag) =>
    tag.includes('data-mini-bindtap="checkLink"'),
  );

test('the actual pending DTO passes through updateLinks without a false green verification', () => {
  const h = setup();
  assert.equal(h.page.data.links[0].sourceText, '来源已失效或暂不可用');
  assert.equal(Object.hasOwn(h.page.data.links[0], 'sourceStatusText'), false);
  for (const width of [320, 390, 430]) {
    const result = badge(h.page, width);
    assert.equal(result.text, h.page.data.links[0].sourceText);
    assert.doesNotMatch(result.classes, /figma-status--green/);
    assert.ok(result.html.includes('当前来源不再满足公开条件'));
    assert.doesNotMatch(result.html, />已核对</);
  }
  assert.equal(h.calls.length, 0);
});

test('source badge rendering preserves the record identity and its independent rejection capability', () => {
  const h = setup();
  const row = h.page.data.links[0];
  for (const key of ['id', 'profileId', 'eventId', 'teamId', 'memberId', 'version'])
    assert.equal(row[key], h.raw[key], key);
  assert.deepEqual(row.capabilities, { canConsent: false, canRevoke: true });
  const controls = actions(h.page);
  assert.equal(controls.length, 1);
  assert.ok(controls[0].includes('data-id="' + row.id + '"'));
  assert.match(controls[0], /data-type="REVOKE"/);
  assert.doesNotMatch(controls[0], /\sdisabled(?:\s|>)/);
  assert.equal(h.calls.length, 0);
});

test('a readable source label does not grant an otherwise unauthorized command', async () => {
  const h = setup({ capabilities: { canConsent: false, canRevoke: false } });
  assert.equal(badge(h.page).text, '来源已失效或暂不可用');
  assert.equal(actions(h.page).length, 0);
  for (const type of ['CONSENT', 'REVOKE'])
    await h.page.checkLink({ currentTarget: { dataset: { id: h.raw.id, type } } });
  assert.equal(h.page.data.pending, null);
  assert.equal(h.calls.length, 0);
});

test('incomplete template snapshots stay neutral and pending instead of inventing verification', () => {
  const h = setup();
  const row = clone(h.page.data.links[0]);
  for (const value of [undefined, null, 'true', 1]) {
    h.page.setData({ links: [{ ...row, sourceCurrentlyAvailable: value }] });
    const result = badge(h.page);
    assert.equal(result.text, '待核对');
    assert.doesNotMatch(result.classes, /figma-status--green/);
  }
  h.page.setData({ links: [{ ...row, sourceCurrentlyAvailable: true, sourceText: '' }] });
  assert.equal(badge(h.page).text, '待核对');
  assert.doesNotMatch(badge(h.page).classes, /figma-status--green/);
  assert.equal(h.calls.length, 0);
});

test('only the explicit available template state colors the existing source text green', () => {
  // This is a defensive template branch, not a claim that the current server
  // returns sourceCurrentlyAvailable=true for a PENDING authorization.
  const h = setup();
  const controls = actions(h.page);
  h.page.setData({
    links: [
      { ...h.page.data.links[0], sourceCurrentlyAvailable: true, sourceText: '来源当前有效' },
    ],
  });
  assert.equal(badge(h.page).text, '来源当前有效');
  assert.match(badge(h.page).classes, /figma-status--green/);
  assert.deepEqual(actions(h.page), controls);
  assert.equal(h.calls.length, 0);
});

test('the new minimal fixture matches updateLinks and keeps the neutral badge at three widths', () => {
  const h = setup();
  for (const key of ['id', 'sourceCurrentlyAvailable', 'sourceText', 'statusText', 'capabilities'])
    assert.deepEqual(h.page.data.links[0][key], fixture.data.links[0][key], key);
  for (const width of [320, 390, 430]) {
    const result = badge(h.page, width);
    assert.equal(result.text, '来源已失效或暂不可用');
    assert.doesNotMatch(result.classes, /figma-status--green/);
    for (const text of fixture.expectText) assert.ok(result.html.includes(text), text);
    for (const text of fixture.expectAbsentText) assert.ok(!result.html.includes(text), text);
  }
});

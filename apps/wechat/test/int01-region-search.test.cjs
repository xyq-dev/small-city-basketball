const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/city-select/index';
const id = (number) => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const catalog = {
  catalogVersion: 'synthetic-int01-region-v1',
  dataDate: '2026-11-01',
  partialRootIds: [],
  regions: [
    { id: id(1), parentId: null, name: '合成广东省', level: 'PROVINCE' },
    { id: id(2), parentId: id(1), name: '合成茂名市', level: 'PREFECTURE' },
    { id: id(3), parentId: id(2), name: '合成高州市', level: 'COUNTY' },
  ],
};
function setup({ organizer = false, wait = null } = {}) {
  const calls = [],
    emitted = [],
    storage = new Map();
  const client = {
    sessionRevision: () => 1,
    async requestPublic(url) {
      calls.push({ url, method: 'GET' });
      assert.equal(url, '/v1/public/regions');
      if (wait) await wait;
      return { data: structuredClone(catalog) };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const wx = createWx({ storage });
  wx.getLocation = wx.getFuzzyLocation = () => {
    throw Error('search must not request device location');
  };
  const h = loadPage({
    root,
    route,
    wx,
    modules: { [path.join(root, 'utils/api.js')]: api },
    globals: { getApp: () => ({ globalData: {} }), getCurrentPages: () => [{}, {}] },
  });
  h.page.getOpenerEventChannel = () => ({ emit: (type, value) => emitted.push({ type, value }) });
  h.page.onLoad(organizer ? { context: 'directory' } : {});
  return { ...h, calls, emitted, storage };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const searches = (html) =>
  html.match(/<input\b[^>]*data-mini-bindinput="searchRegion"[^>]*>/g) || [];
const tags = (html) => html.match(/<button\b[^>]*>/g) || [];
function searchFromControl(page, html, value) {
  const controls = searches(html);
  assert.equal(
    controls.length,
    1,
    'standard results and their only search field must share one view',
  );
  const handler = controls[0].match(/data-mini-bindinput="([^"]+)"/)[1];
  page[handler]({ detail: { value } });
}
const tab = (view) => ({ currentTarget: { dataset: { view } } });

test('directory organizers can search from the standard tab while recent selection stays disabled', async () => {
  const h = setup({ organizer: true });
  await h.flush();
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    const recent = tags(html).find((button) => /data-view="recent"/.test(button));
    assert.match(recent, /\sdisabled(?:\s|>)/);
    assert.equal(searches(html).length, 1);
  }
  searchFromControl(h.page, render(h.page), '高州');
  assert.equal(h.page.data.activeView, 'standard');
  assert.deepEqual(
    Array.from(h.page.data.rows, (row) => row.id),
    [id(3)],
  );
  const html = render(h.page);
  assert.match(html, /合成高州市/);
  assert.match(html, new RegExp('data-id="' + id(3) + '"'));
  assert.equal(searches(html).length, 1);
});

test('search stays read-only and an organizer selection emits the existing region contract without browser history', async () => {
  const h = setup({ organizer: true });
  await h.flush();
  searchFromControl(h.page, render(h.page), '高州');
  assert.equal(h.wx.calls.filter((call) => call.type === 'setStorageSync').length, 0);
  const row = tags(render(h.page)).find((button) => button.includes('data-id="' + id(3) + '"'));
  assert.ok(row);
  h.page.openRegion({ currentTarget: { dataset: { id: row.match(/data-id="([^"]+)"/)[1] } } });
  assert.equal(h.emitted.length, 1);
  assert.equal(h.emitted[0].type, 'regionSelected');
  assert.equal(h.emitted[0].value.regionId, id(3));
  assert.equal(h.emitted[0].value.catalogVersion, catalog.catalogVersion);
  assert.equal(h.wx.calls.filter((call) => call.type === 'setStorageSync').length, 0);
  assert.deepEqual(h.calls, [{ url: '/v1/public/regions', method: 'GET' }]);
});

test('ordinary selection and recent manual city text retain their existing controls without duplicate search fields', async () => {
  const h = setup();
  await h.flush();
  searchFromControl(h.page, render(h.page), '高州');
  h.page.openRegion({ currentTarget: { dataset: { id: id(3) } } });
  assert.equal(h.page.data.regionId, id(3));
  assert.ok(h.storage.has('scb.browseRegion.v2'));
  h.page.changeView(tab('recent'));
  const recent = render(h.page);
  assert.equal(searches(recent).length, 0);
  assert.match(recent, /data-mini-bindtap="pickRecent"/);
  assert.match(recent, /data-mini-bindinput="inputCity"/);
  assert.match(recent, /data-mini-bindtap="apply"/);
  h.page.inputCity({ detail: { value: '合成历史城市' } });
  h.page.apply();
  assert.equal(h.page.data.mode, 'LEGACY_CITY');
  assert.equal(h.page.data.city, '合成历史城市');
  h.page.changeView(tab('standard'));
  assert.equal(searches(render(h.page)).length, 1);
  assert.equal(h.emitted.length, 0);
});

test('catalog loading keeps tabs disabled and the not-yet-available search and results concealed', async () => {
  let resolve;
  const wait = new Promise((done) => {
    resolve = done;
  });
  const h = setup({ organizer: true, wait });
  const loading = render(h.page);
  assert.equal(searches(loading).length, 0);
  for (const button of tags(loading).filter((tag) => /data-mini-bindtap="changeView"/.test(tag)))
    assert.match(button, /\sdisabled(?:\s|>)/);
  h.page.changeView(tab('recent'));
  assert.equal(h.page.data.activeView, 'standard');
  resolve();
  await h.flush();
  assert.equal(searches(render(h.page)).length, 1);
});

test('the organizer search CI fixture keeps one input and its matching region rows in the same tab', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-region-search-directory.json',
      ),
      'utf8',
    ),
  );
  assert.equal(fixture.data.organizer, true);
  assert.equal(fixture.data.activeView, 'standard');
  const h = setup({ organizer: true });
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.equal(searches(html).length, 1);
    assert.match(searches(html)[0], /value="高州"/);
  }
});

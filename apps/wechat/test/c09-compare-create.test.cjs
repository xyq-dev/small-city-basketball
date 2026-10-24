const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const scenario = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../tests/mini-program/fixtures/booking-create-tournament.json'),
    'utf8',
  ),
);

test('expanding reviewed party details changes only presentation and keeps the exact booking draft', () => {
  const harness = loadPage({
    root,
    route: 'pages/booking-create/index',
    modules: {
      [path.join(root, 'utils/api.js')]: { getClient: () => ({ sessionRevision: () => 1 }) },
    },
  });
  const page = harness.page;
  page.workspace = {};
  page.draft = {
    selectedIds: ['original-player'],
    slots: [{ venue: 'original-venue' }],
    consent: false,
  };
  page.viewRevision = 1;
  page.needsRequote = true;
  page.setData({ ready: true });
  const original = JSON.stringify(page.draft);
  page.toggleDetails();
  assert.equal(page.data.detailsOpen, true);
  assert.equal(JSON.stringify(page.draft), original);
  assert.equal(page.needsRequote, true);
  page.toggleDetails();
  assert.equal(page.data.detailsOpen, false);
  assert.equal(JSON.stringify(page.draft), original);
  assert.equal(harness.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('party details cannot be expanded while the booking is locked, pending or in fee review', () => {
  const harness = loadPage({
    root,
    route: 'pages/booking-create/index',
    modules: {
      [path.join(root, 'utils/api.js')]: { getClient: () => ({ sessionRevision: () => 1 }) },
    },
  });
  const page = harness.page;
  page.workspace = {};
  page.draft = {};
  page.viewRevision = 1;
  page.setData({ ready: true });
  for (const key of ['pending', 'invalidRecovery', 'storageReadBlocked', 'success', 'review']) {
    page.setData({ [key]: true });
    page.toggleDetails();
    assert.equal(page.data.detailsOpen, false, key);
    page.setData({ [key]: false });
  }
  page._busy = true;
  page.toggleDetails();
  assert.equal(page.data.detailsOpen, false);
  page._busy = false;
  page.viewRevision = 0;
  page.toggleDetails();
  assert.equal(page.data.detailsOpen, false);
});

test('compact party summary keeps missing inputs reachable and fee review uses the unchanged draft quote', () => {
  const render = (data) =>
    buildPreview({ root, route: scenario.route, data, width: 390, height: 844 }).phone;
  const data = structuredClone(scenario.data);
  const originalQuote = JSON.stringify(data.quote);
  assert.doesNotMatch(render(data), /data-mini-bindchange="teamPick"/);
  assert.match(render({ ...data, detailsOpen: true }), /data-mini-bindchange="teamPick"/);
  assert.match(render({ ...data, eventName: '' }), /data-mini-bindchange="teamPick"/);
  assert.match(render({ ...data, selectedCount: 0 }), /data-mini-bindchange="teamPick"/);
  const reviewed = render({ ...data, review: true, consent: false });
  assert.doesNotMatch(reviewed, /data-mini-bindchange="teamPick"/);
  assert.match(reviewed, /data-mini-bindchange="consent"/);
  assert.match(reviewed, /确定报价合计/);
  assert.ok(reviewed.includes(data.quote.confirmed));
  assert.ok(reviewed.includes(data.quote.conditional));
  assert.equal(JSON.stringify(data.quote), originalQuote);
  assert.match(reviewed, /disabled[^>]*>\s*请先核对并勾选声明/);
});

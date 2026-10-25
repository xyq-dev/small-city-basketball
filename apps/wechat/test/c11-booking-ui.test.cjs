const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const fixtureDirectory = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const read = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name + '.json')));
const clone = (value) => JSON.parse(JSON.stringify(value));
const event = (id) => ({ currentTarget: { dataset: { id } } });
const actor = '90000000-0000-4000-8000-000000000099';

function booking() {
  const f = read('c11-booking-create-ready');
  let revision = 1;
  const client = { sessionRevision: () => revision, onSessionChange: () => () => {} };
  const h = loadPage({
    root,
    route: f.route,
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client } },
  });
  const p = h.page;
  p.onLoad({});
  p.actor = actor;
  p.viewRevision = revision;
  p.workspace = {
    viewerUserId: actor,
    teams: clone(f.data.teams),
    events: [],
    matches: [],
    settings: { version: 1, feeBps: 1000 },
    players: [
      {
        id: f.data.players[0].id,
        userId: '90000000-0000-4000-8000-000000000501',
        displayName: '林越',
        position: 'PG',
        heightCm: 182,
        city: '合成高州 / 石鼓',
        status: 'APPROVED',
        priceFen: 30000,
        travelFen: 0,
        accommodationFen: 0,
        version: 1,
        // An unrelated upstream field must not select a fictional identity.
        portrait: '/assets/approved-ui/player-sample-b.jpg',
      },
    ],
  };
  const slot = {};
  for (const key of [
    'label',
    'venue',
    'profileIds',
    'conditional',
    'conditionText',
    'reportDate',
    'reportTime',
    'startDate',
    'startTime',
    'endDate',
    'endTime',
    'matchId',
  ])
    slot[key] = clone(f.data.slots[0][key]);
  p.draft = {
    scope: 'SINGLE',
    teamId: f.data.teamId,
    eventId: '',
    eventName: f.data.eventName,
    selectedIds: [p.workspace.players[0].id],
    slots: [slot],
    periodStart: '2026-10-28',
    periodEnd: '2026-10-28',
    consent: false,
  };
  p.setData({ ready: true });
  h.requireLocal('utils/ui.js').today = () => '2026-10-25';
  p.renderForm();
  return {
    ...h,
    setRevision: (value) => {
      revision = value;
    },
  };
}

test('compact summary opens the full original editor without losing continuous input or granting consent', () => {
  const h = booking();
  const p = h.page;
  const original = JSON.stringify(p.draft);
  assert.equal(p.data.editorOpen, false);
  assert.equal(p.data.compactQuote.confirmed, '¥330');
  assert.equal(p.data.slots[0].dayLabel, '10月28日');
  assert.equal(p.data.slots[0].scheduleLabel, '19:30–21:00');
  assert.equal(p.data.players[0].portrait, undefined);
  p.openEditor();
  assert.equal(p.data.editorOpen, true);
  assert.equal(p.data.detailsOpen, true);
  assert.equal(JSON.stringify(p.draft), original);
  for (const value of ['石', '石鼓公园篮球场二号场']) {
    p.slotInput({ currentTarget: { dataset: { index: 0, field: 'venue' } }, detail: { value } });
    assert.equal(p.data.editorOpen, true);
    assert.equal(p.draft.slots[0].venue, value);
  }
  p.closeEditor();
  assert.equal(p.data.editorOpen, false);
  assert.equal(p.data.slots[0].venue, '石鼓公园篮球场二号场');
  assert.equal(p.draft.consent, false);
  assert.equal(p.data.consent, false);
  p.review();
  assert.equal(p.data.review, true);
  assert.equal(p.data.consent, false);
  p.openEditor();
  assert.equal(
    p.data.editorOpen,
    false,
    'review can only leave through its explicit existing edit action',
  );
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('completing an initially missing name does not unmount the original party editor mid-input', () => {
  const h = booking();
  const p = h.page;
  p.draft.eventName = '';
  p.renderForm();
  assert.equal(p.data.detailsOpen, true);
  assert.equal(p.data.editorOpen, false);
  for (const value of ['青', '青锋杯']) {
    p.input({ currentTarget: { dataset: { field: 'eventName' } }, detail: { value } });
    const html = buildPreview({ root, route: 'pages/booking-create/index', data: p.data }).phone;
    assert.ok(html.includes('data-mini-bindchange="teamPick"'));
    assert.ok(html.includes('data-mini-bindinput="input"'));
    assert.equal(p.data.detailsOpen, true);
  }
  p.closeEditor();
  assert.equal(p.data.detailsOpen, false);
  const summary = buildPreview({ root, route: 'pages/booking-create/index', data: p.data }).phone;
  assert.ok(summary.includes('arrangement-summary'));
  assert.ok(!summary.includes('data-mini-bindchange="teamPick"'));
});

test('summary/editor switches respect busy, recovery and account revision barriers', () => {
  for (const key of ['pending', 'invalidRecovery', 'storageReadBlocked', 'success']) {
    const h = booking();
    h.page.setData({ [key]: true });
    h.page.openEditor();
    assert.equal(h.page.data.editorOpen, false, key);
  }
  const h = booking();
  h.page._busy = true;
  h.page.openEditor();
  assert.equal(h.page.data.editorOpen, false);
  h.page._busy = false;
  h.page.openEditor();
  assert.equal(h.page.data.editorOpen, true);
  h.setRevision(2);
  h.page.closeEditor();
  assert.equal(h.page.data.editorOpen, true, 'a stale actor may not repaint the prior draft');
});

test('compact quote formatting preserves cents, conditional separation and cross-day dates', () => {
  const h = booking();
  const p = h.page;
  p.workspace.players[0].priceFen = 30001;
  p.draft.scope = 'TOURNAMENT';
  p.draft.slots[0].endDate = '2026-10-29';
  p.draft.slots[0].endTime = '00:30';
  p.draft.slots.push({
    ...clone(p.draft.slots[0]),
    conditional: true,
    conditionText: '合成晋级后另行确认',
    label: '合成条件项',
  });
  p.renderForm();
  assert.equal(p.data.compactQuote.service, '¥300.01');
  assert.equal(p.data.compactQuote.confirmed, '¥330.01');
  assert.equal(p.data.compactQuote.conditional, '¥330.01');
  assert.equal(p.data.quote.fixedCount, 1);
  assert.equal(p.data.quote.conditionalCount, 1);
  assert.equal(p.data.slots[0].scheduleLabel, '19:30–10月29日 00:30');
  assert.equal(p.data.slots[1].conditional, true);
});

function ordersPage() {
  const f = read('c11-booking-orders-ready');
  const h = loadPage({ root, route: f.route });
  const p = h.page;
  const rows = clone(f.data.rows);
  rows.forEach((row) =>
    row.appearances.forEach((item) => {
      delete item.portrait;
    }),
  );
  p.viewer = rows[0].buyerUserId;
  p.raw = {
    viewerUserId: p.viewer,
    teams: [{ id: rows[0].teamId, orgId: rows[0].orgId }],
    orders: rows,
    players: [{ id: rows[0].appearances[0].profileId, heightCm: 182, city: '合成高州 / 石鼓' }],
  };
  const ui = h.requireLocal('utils/ui.js');
  ui.today = () => '2026-10-25';
  p.loadedToken = ui.begin(p);
  p.render();
  return { ...h, ui };
}

test('order-card details are an authenticated display disclosure and preserve original order projection', () => {
  const h = ordersPage();
  const p = h.page;
  const id = p.data.rows[0].appearances[0].id;
  const raw = JSON.stringify(p.raw);
  assert.equal(p.data.rows[0].appearances[0].summaryStartText, '10月28日  19:30');
  assert.equal(p.data.rows[0].appearances[0].playerMeta, '182cm · 合成高州 / 石鼓');
  assert.equal(p.data.rows[0].appearances[0].portrait, undefined);
  p.toggleInfo(event(id));
  assert.equal(p.data.expandedAppearanceId, id);
  p.toggleInfo(event('not-an-order-item'));
  assert.equal(p.data.expandedAppearanceId, id);
  p.setData({ loading: true });
  p.toggleInfo(event(id));
  p.toggleFilters();
  assert.equal(p.data.expandedAppearanceId, id);
  assert.equal(p.data.filtersOpen, false);
  p.setData({ loading: false });
  p.toggleFilters();
  assert.equal(p.data.filtersOpen, true);
  assert.equal(JSON.stringify(p.raw), raw);
  h.ui.begin(p);
  p.toggleInfo(event(id));
  assert.equal(p.data.expandedAppearanceId, id, 'stale read cannot change private card context');
  p.onHide();
  assert.equal(p.data.rows.length, 0);
  assert.equal(p.data.expandedAppearanceId, '');
});

test('approved booking fixtures render real controls and separate example portraits from real data', () => {
  const files = fs.readdirSync(fixtureDirectory).filter((file) => file.startsWith('c11-booking-'));
  assert.equal(files.length, 4);
  for (const file of files) {
    const f = read(file.slice(0, -5));
    for (const width of [320, 390, 430]) {
      const r = buildPreview({ root, route: f.route, data: f.data, width, height: 844 });
      for (const text of f.expectText) assert.ok(r.phone.includes(text), file + ': ' + text);
      assert.ok(r.assets.every((asset) => asset.path.startsWith('assets/approved-ui/')));
      assert.ok(!r.assets.some((asset) => /approved-six-screen|docs\/design/.test(asset.path)));
      assert.ok(r.phone.includes('data-mini-bindtap='));
      assert.doesNotMatch(r.phone, /<script\b|src="https?:/);
    }
  }
  const normal = read('c11-booking-create-ready');
  const html = buildPreview({ root, ...normal }).phone;
  assert.doesNotMatch(html, /data-mini-bindtap="submit"/);
  assert.ok(html.includes('data-mini-bindtap="openEditor"'));
  const editing = read('c11-booking-create-editor');
  const editHtml = buildPreview({ root, ...editing }).phone;
  for (const handler of ['slotInput', 'slotPlayers', 'teamPick', 'eventPick', 'playerPick']) {
    assert.ok(
      editHtml.includes('data-mini-bindchange="' + handler + '"') ||
        editHtml.includes('data-mini-bindinput="' + handler + '"'),
      handler,
    );
  }
  const expanded = read('c11-booking-orders-expanded');
  const expandedHtml = buildPreview({ root, ...expanded }).phone;
  assert.ok(expandedHtml.includes('总单确定报价'));
  assert.ok(expandedHtml.includes('实收 ¥0.00'));
});

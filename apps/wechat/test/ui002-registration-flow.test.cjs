const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const orgId = '00000000-0000-4000-8000-000000000001';
const entryId = '00000000-0000-4000-8000-000000000002';
const eventId = '00000000-0000-4000-8000-000000000003';
const memberId = '00000000-0000-4000-8000-000000000004';
const tap = (panel) => ({ currentTarget: { dataset: { panel } } });

function participant() {
  const wx = createWx();
  const h = loadPage({ root, route: 'pages/participant-materials/index', wx });
  h.page.onLoad({ orgId, entryId });
  const workspace = {
    eventId,
    memberId,
    capabilities: { canSave: true, canSubmit: false },
  };
  h.page._workspace = workspace;
  h.page.setData({ workspace });
  return { ...h, wx };
}

test('UI002 materials panels preserve an unsaved draft and never issue API commands', () => {
  const h = participant();
  h.page.field({
    currentTarget: { dataset: { field: 'realName' } },
    detail: { value: '合成本人' },
  });
  for (const panel of ['portrait', 'insurance', 'consent', 'progress', 'profile']) {
    h.page.switchMaterialPanel(tap(panel));
    assert.equal(h.page.data.materialPanel, panel);
    assert.equal(h.page.data.form.realName, '合成本人');
    assert.equal(h.page.data.dirty, true);
  }
  assert.equal(h.wx.calls.filter((c) => c.type === 'request').length, 0);
});

test('UI002 materials keep write, unknown-result and role gates when switching steps', () => {
  const h = participant();
  for (const state of ['busy', 'loading', 'pending']) {
    h.page.setData({ [state]: true });
    h.page.switchMaterialPanel(tap('insurance'));
    h.page.registrationStepChange({ detail: { key: 'qualification' } });
    assert.equal(h.page.data.materialPanel, 'profile', state);
    assert.equal(h.wx.calls.filter((c) => c.type === 'navigateTo').length, 0, state);
    h.page.setData({ [state]: false });
  }
  h.page._workspace.capabilities.canSave = false;
  h.page.field({
    currentTarget: { dataset: { field: 'realName' } },
    detail: { value: '禁止写入' },
  });
  assert.equal(h.page.data.form.realName, '');
  h.page.setData({ mode: 'review' });
  h.page.switchMaterialPanel(tap('insurance'));
  assert.equal(h.page.data.materialPanel, 'profile');
  assert.equal(h.wx.calls.filter((c) => c.type === 'request').length, 0);
});

test('UI002 leaving a dirty material form cannot discard it through precheck or insurance', () => {
  const h = participant();
  h.page.setData({ dirty: true });
  h.page.registrationStepChange({ detail: { key: 'qualification' } });
  h.page.insurance();
  h.page.guardian();
  assert.match(h.page.data.error, /请先保存当前草稿/);
  assert.equal(h.wx.calls.filter((c) => c.type === 'navigateTo').length, 0);
  h.page.setData({ dirty: false });
  h.page.registrationStepChange({ detail: { key: 'qualification' } });
  const calls = h.wx.calls.filter((c) => c.type === 'navigateTo');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /qualification-precheck\/index/);
  assert.match(calls[0].url, new RegExp(entryId));
});

test('UI002 material deep links whitelist the panel and clear the selected private text', () => {
  const h = participant();
  h.page.onLoad({ orgId, entryId, panel: 'insurance' });
  assert.equal(h.page.data.materialPanel, 'insurance');
  h.page.setData({ privateDetails: { realName: '合成私有资料' } });
  h.page.switchMaterialPanel(tap('progress'));
  assert.equal(h.page.data.privateDetails, null);
  h.page.switchMaterialPanel(tap('not-a-panel'));
  assert.equal(h.page.data.materialPanel, 'progress');
  h.page.onSessionReset();
  assert.equal(h.page.data.materialPanel, 'profile');
  assert.equal(h.page.data.workspace, null);
  assert.equal(h.page.data.form.realName, '');
});

test('UI002 roster steps preserve the draft while invalidating prior submit consent', () => {
  const h = loadPage({ root, route: 'pages/entry/index', wx: createWx() });
  h.page.setData({
    dirty: true,
    consent: true,
    fileConsent: true,
    rows: [{ name: '合成未保存球员' }],
  });
  h.page.entryStepChange({ detail: { key: 'documents' } });
  assert.equal(h.page.data.stage, 'documents');
  assert.equal(h.page.data.rows[0].name, '合成未保存球员');
  assert.equal(h.page.data.dirty, true);
  assert.equal(h.page.data.consent, false);
  h.page.setData({ uncertain: true });
  h.page.entryStepChange({ detail: { key: 'review' } });
  assert.equal(h.page.data.stage, 'documents');
  assert.equal(h.wx.calls.filter((c) => c.type === 'request').length, 0);
});

test('UI002 organizer tools require a current workspace and preserve the event route', () => {
  const h = loadPage({ root, route: 'pages/org-event/index', wx: createWx() });
  h.page.orgId = orgId;
  h.page.eventId = eventId;
  h.page.openSchedule();
  h.page.toggleManagementTools();
  assert.equal(h.page.data.managementToolsOpen, false);
  assert.equal(h.wx.calls.filter((c) => c.type === 'navigateTo').length, 0);
  h.page.setData({ manage: { review: true } });
  h.page.toggleManagementTools();
  assert.equal(h.page.data.managementToolsOpen, true);
  h.page.openSchedule();
  const calls = h.wx.calls.filter((c) => c.type === 'navigateTo');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /schedule\/index/);
  assert.match(calls[0].url, new RegExp(eventId));
  assert.equal(h.wx.calls.filter((c) => c.type === 'request').length, 0);
});

test('UI002 scorer quick navigation cannot acquire control or fabricate uncollected lineups', () => {
  const wx = createWx();
  const scrolled = [];
  wx.pageScrollTo = (options) => scrolled.push(options.selector);
  const h = loadPage({ root, route: 'pages/scorer/index', wx });
  h.page.setData({ match: { status: 'LIVE' }, board: { proMode: false }, held: false });
  h.page.openConsoleSection({ currentTarget: { dataset: { section: 'lineup' } } });
  assert.equal(scrolled.length, 0);
  assert.match(h.page.data.notice, /不能补造/);
  h.page.setData({
    board: { proMode: true },
    canControl: true,
    offlineItems: [{ id: 'synthetic-original-command' }],
  });
  h.page.openConsoleSection({ currentTarget: { dataset: { section: 'offline' } } });
  assert.equal(scrolled[0], '#scorer-offline');
  assert.equal(h.page.data.offlineItems[0].id, 'synthetic-original-command');
  assert.equal(h.page.data.held, false);
  h.page.setData({ busy: true });
  h.page.openConsoleSection({ currentTarget: { dataset: { section: 'history' } } });
  assert.equal(scrolled.length, 1);
  assert.equal(h.wx.calls.filter((c) => c.type === 'request').length, 0);
});

test('UI002 setup navigation keeps unsaved values and cannot bypass unavailable settings', () => {
  const wx = createWx();
  const scrolled = [];
  wx.pageScrollTo = (options) => scrolled.push(options.selector);
  const h = loadPage({ root, route: 'pages/event-setup/index', wx });
  h.page.setData({ draft: { name: '合成未保存赛事' }, registration: null });
  h.page.jumpSetupSection({ currentTarget: { dataset: { section: 'basic' } } });
  assert.equal(scrolled[0], '#setup-basic');
  assert.equal(h.page.data.draft.name, '合成未保存赛事');
  h.page.jumpSetupSection({ currentTarget: { dataset: { section: 'registration' } } });
  assert.equal(scrolled.length, 1);
  assert.match(h.page.data.notice, /没有此项设置/);
  h.page.setData({ templatePending: true });
  h.page.jumpSetupSection({ currentTarget: { dataset: { section: 'basic' } } });
  assert.equal(scrolled.length, 1);
  assert.equal(h.wx.calls.filter((c) => c.type === 'request').length, 0);
});

for (const file of fs
  .readdirSync(path.resolve(root, '../../tests/mini-program/fixtures'))
  .filter((name) => name.startsWith('ui002-registration-') && name.endsWith('.json'))) {
  test('UI002 actual template preserves critical workflow state: ' + file, () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.resolve(root, '../../tests/mini-program/fixtures', file), 'utf8'),
    );
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route: fixture.route, data: fixture.data, width });
      for (const expected of fixture.expectText)
        assert.ok(preview.html.includes(expected), width + ': ' + expected);
    }
  });
}

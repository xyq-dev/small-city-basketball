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

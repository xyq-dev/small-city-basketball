const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/staff-configuration/index';
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../tests/mini-program/fixtures/ui002-registration-staff-readonly.json',
    ),
    'utf8',
  ),
);
const tap = (type) => ({ currentTarget: { dataset: { type } } });
function readOnly() {
  const h = loadPage({ root, route, wx: createWx() });
  h.page.onLoad({});
  h.page.setData(fixture.data);
  return h;
}
function buttons(page) {
  const html = buildPreview({ root, route, data: page.data }).phone;
  return {
    html,
    member: html.match(/<button\b[^>]*data-type="MEMBER"[^>]*>/)?.[0],
    staff: html.match(/<button\b[^>]*data-type="STAFF"[^>]*>/)?.[0],
    save: html.match(/<button\b[^>]*data-mini-bindtap="save"[^>]*>/)?.[0],
  };
}

test('read-only staff viewers can browse both lists without enabling an authorization change', async () => {
  const h = readOnly();
  for (const [type, name] of [
    ['MEMBER', '合成工作人员'],
    ['STAFF', '合成记分员'],
  ]) {
    h.page.type(tap(type));
    assert.equal(h.page.data.type, type);
    const rendered = buttons(h.page);
    assert.match(rendered.html, new RegExp(name));
    for (const tab of [rendered.member, rendered.staff]) {
      assert.ok(tab);
      assert.doesNotMatch(tab, /\sdisabled(?:\s|>)/);
    }
    assert.match(rendered.save, /\sdisabled(?:\s|>)/);
    await h.page.save();
  }
  assert.deepEqual(
    h.wx.calls.filter((call) =>
      ['request', 'showModal', 'setStorageSync', 'removeStorageSync'].includes(call.type),
    ),
    [],
  );
});

test('busy and unknown authorization commands still prevent list switching', () => {
  for (const flags of [{ busy: true }, { pending: true }]) {
    const h = readOnly();
    h.page.setData({ type: 'MEMBER', ...flags });
    h.page.type(tap('STAFF'));
    assert.equal(h.page.data.type, 'MEMBER');
    const rendered = buttons(h.page);
    for (const tab of [rendered.member, rendered.staff]) assert.match(tab, /\sdisabled(?:\s|>)/);
  }
});

test('save button retains the independent member and staff write capabilities', () => {
  for (const capabilities of [
    { canManageMembers: false, canManageStaff: true },
    { canManageMembers: true, canManageStaff: false },
  ]) {
    const h = readOnly();
    h.page.setData({ workspace: { capabilities } });
    for (const type of ['MEMBER', 'STAFF']) {
      h.page.type(tap(type));
      const rendered = buttons(h.page);
      const canWrite =
        type === 'MEMBER' ? capabilities.canManageMembers : capabilities.canManageStaff;
      assert.equal(/\sdisabled(?:\s|>)/.test(rendered.save), !canWrite);
    }
  }
});

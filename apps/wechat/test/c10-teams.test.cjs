const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const fixtures = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const id = (n) => 'c1000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('long-term member editor opens only explicitly and keeps both drafts through collapse', () => {
  const { page } = loadPage({ root, route: 'pages/team/index' });
  page.onLoad({ orgId: id(1), teamId: id(2) });
  page.setData({
    team: { capabilities: { canManage: true } },
    name: '合成未保存队名',
    nameDirty: true,
    members: [{ key: 'draft-1', name: '合成新成员' }],
    membersDirty: true,
  });
  const draft = JSON.stringify({ name: page.data.name, members: page.data.members });
  assert.equal(page.data.editMode, false);
  page.toggleEdit();
  assert.equal(page.data.editMode, true);
  page.toggleEdit();
  assert.equal(page.data.editMode, false);
  assert.equal(JSON.stringify({ name: page.data.name, members: page.data.members }), draft);
  assert.equal(page.data.nameDirty, true);
  assert.equal(page.data.membersDirty, true);
  for (const blocked of [
    { busy: true },
    { busy: false, uncertain: true },
    { uncertain: false, team: { capabilities: { canManage: false } } },
  ]) {
    page.setData(blocked);
    page.toggleEdit();
    assert.equal(page.data.editMode, false);
  }
});

test('invitation shows account-read progress without accepting or retaining an invitation secret in data', async () => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  let writes = 0;
  const { page } = loadPage({
    root,
    route: 'pages/invitation/index',
    modules: {
      '../../utils/ui': { begin: () => ({}), session: () => pending, message: (e) => e.message },
      '../../utils/api': {
        getClient: () => ({
          sessionRevision: () => 0,
          request: () => {
            writes++;
          },
        }),
      },
    },
  });
  page.onLoad({});
  const task = page.load();
  assert.equal(page.data.loading, true);
  assert.equal(page.data.user, null);
  assert.equal(page.data.consent, false);
  resolve({ user: { id: id(3), displayName: '合成领队', email: 'leader@example.invalid' } });
  await task;
  assert.equal(page.data.loading, false);
  assert.equal(page.data.user.id, id(3));
  assert.equal(page.data.accepted, null);
  assert.equal(Object.hasOwn(page.data, 'token'), false);
  assert.equal(writes, 0);
});

test('read-only approved roster and unmet insurance review keep write controls unavailable in real templates', () => {
  const readonly = JSON.parse(fs.readFileSync(path.join(fixtures, 'c10-team-entry-approved.json')));
  const html = buildPreview({ root, ...readonly, width: 390, height: 844 }).phone;
  assert.match(html, /本届名单当前只读/);
  assert.doesNotMatch(html, /class="field jersey-input"/);
  assert.doesNotMatch(html, /保存本届名单/);
  const blocked = JSON.parse(
    fs.readFileSync(path.join(fixtures, 'c10-team-entry-requirements-blocked.json')),
  );
  const rendered = buildPreview({ root, ...blocked, width: 390, height: 844 }).phone;
  assert.match(rendered, /上传文件不会解除提交限制/);
  assert.match(rendered, /<button[^>]*data-mini-bindtap="command"[^>]*disabled/);
  assert.doesNotMatch(rendered, /type="checkbox" checked/);
});

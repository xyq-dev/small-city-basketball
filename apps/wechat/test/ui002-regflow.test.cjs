const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const fixtures = path.resolve(root, '../../tests/mini-program/fixtures');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixtures, 'ui002-regflow-' + name + '.json')));
const tap = (dataset) => ({ currentTarget: { dataset } });
const participant = (n, changes = {}) => ({
  memberId: id(n),
  materialVersion: n,
  canRequest: true,
  hasRealName: true,
  hasIdentity: true,
  hasPortrait: true,
  hasSignature: true,
  requestCurrent: false,
  ...changes,
});
function precheck(participants = [participant(3)]) {
  const h = loadPage({ root, route: 'pages/qualification-precheck/index' });
  const calls = [];
  const workspace = { canReview: false, participants };
  h.page.onLoad({ orgId: id(1), entryId: id(2) });
  h.requireLocal('utils/ui.js').session = async () => ({ user: { id: id(4) } });
  h.requireLocal('utils/api.js').getClient = () => ({
    sessionRevision: () => 0,
    request: async (url, method, body) => {
      calls.push({ url, method, body: structuredClone(body) });
      if (!method) return { data: workspace };
      throw Error('合成请求结果待核对');
    },
  });
  return { ...h, calls, workspace };
}
function render(h, route, width = 390) {
  return buildPreview({
    root,
    route: 'pages/' + route + '/index',
    data: h.page.data,
    width,
    height: 844,
  }).phone;
}

test('UI001 R03 necessary cells change only the displayed panel and retain all unsaved insurance fields', () => {
  const f = fixture('material-profile');
  const h = loadPage({ root, route: f.route });
  h.page.setData(f.data);
  h.page._workspace = f.data.workspace;
  h.page.field({ ...tap({ field: 'insurer' }), detail: { value: '合成未保存保险机构' } });
  for (const panel of ['portrait', 'consent', 'insurance', 'progress', 'profile']) {
    h.page.switchMaterialPanel(tap({ panel }));
    assert.equal(h.page.data.materialPanel, panel);
    assert.equal(h.page.data.form.insurer, '合成未保存保险机构');
    assert.equal(h.page.data.insuranceDirty, true);
  }
  h.page.qualification();
  assert.match(h.page.data.error, /请先保存当前草稿/);
  assert.equal(h.wx.calls.filter((c) => ['request', 'navigateTo'].includes(c.type)).length, 0);
});

test('UI001 R05 native checkbox represents this confirmation and changing target clears it without a command', async () => {
  const h = precheck([participant(3), participant(5)]);
  await h.page.load();
  assert.equal(h.page.data.selectedParticipant, null);
  h.page.selectParticipant(tap({ id: id(3) }));
  h.page.consent({ detail: { value: ['yes'] } });
  assert.equal(h.page.data.consent, true);
  h.page.consent({ detail: { value: ['yes'] } });
  assert.equal(h.page.data.consent, true);
  h.page.selectParticipant(tap({ id: id(5) }));
  assert.equal(h.page.data.selectedMemberId, id(5));
  assert.equal(h.page.data.consent, false);
  assert.equal(h.calls.filter((c) => c.method).length, 0);
  h.page.setData({ pending: { kind: 'QUAL_REQUEST' } });
  h.page.selectParticipant(tap({ id: id(3) }));
  h.page.consent({ detail: { value: ['yes'] } });
  assert.equal(h.page.data.selectedMemberId, id(5));
  assert.equal(h.page.data.consent, false);
});

test('UI001 R05 fixed request uses fresh workspace version and the unchanged durable request payload', async () => {
  const h = precheck();
  await h.page.load();
  assert.equal(h.page.data.selectedMemberId, id(3));
  h.page.setData({ selectedParticipant: participant(3, { materialVersion: 999 }), consent: true });
  h.page.data.workspace.participants[0].materialVersion = 7;
  await h.page.request(tap({ id: id(3) }));
  const writes = h.calls.filter((c) => c.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  assert.match(writes[0].url, /qualification-precheck\/requests$/);
  assert.equal(writes[0].body.memberId, id(3));
  assert.equal(writes[0].body.expectedMaterialVersion, 7);
  assert.equal(writes[0].body.acceptedTermsVersion, 'qualification-precheck-v1');
  assert.deepEqual(Object.keys(writes[0].body).sort(), [
    'acceptedTermsVersion',
    'clientRequestId',
    'expectedMaterialVersion',
    'memberId',
  ]);
  assert.equal(h.page.data.pending.body.clientRequestId, writes[0].body.clientRequestId);
  await h.page.request(tap({ id: id(5) }));
  assert.equal(h.calls.filter((c) => c.method).length, 1);
});

test('UI001 R05 loading, lost eligibility and account reset cannot revive a displayed target or consent', async () => {
  const h = precheck();
  await h.page.load();
  h.page.consent({ detail: { value: ['yes'] } });
  let resolve;
  const pending = new Promise((yes) => {
    resolve = yes;
  });
  h.requireLocal('utils/api.js').getClient = () => ({
    sessionRevision: () => 0,
    request: () => pending,
  });
  const task = h.page.load();
  assert.equal(h.page.data.selectedParticipant, null);
  assert.equal(h.page.data.selectedMemberId, '');
  assert.equal(h.page.data.consent, false);
  assert.equal(h.page.data.workspace, null);
  await new Promise(setImmediate);
  h.page.onSessionReset();
  resolve({ data: h.workspace });
  await task;
  assert.equal(h.page.data.workspace, null);
  assert.equal(h.page.data.selectedParticipant, null);
  assert.equal(h.page.data.consent, false);
  const lost = precheck([participant(3, { canRequest: false })]);
  await lost.page.load();
  assert.equal(lost.page.data.selectedParticipant, null);
  lost.page.setData({ consent: true });
  await lost.page.request(tap({ id: id(3) }));
  assert.equal(lost.calls.filter((c) => c.method).length, 0);
});

test('UI001 R05 external policy cell retains the controlled material route and pending prevents leaving', async () => {
  const h = precheck();
  await h.page.load();
  h.page.externalPolicy();
  let nav = h.wx.calls.filter((c) => c.type === 'navigateTo');
  assert.equal(nav.length, 1);
  assert.match(nav[0].url, /participant-materials\/index/);
  assert.match(nav[0].url, /panel=insurance/);
  h.page.setData({ pending: { kind: 'QUAL_REQUEST' } });
  h.page.externalPolicy();
  nav = h.wx.calls.filter((c) => c.type === 'navigateTo');
  assert.equal(nav.length, 1);
  assert.equal(h.calls.filter((c) => c.method).length, 0);
});

for (const name of fs
  .readdirSync(fixtures)
  .filter((f) => f.startsWith('ui002-regflow-') && f.endsWith('.json'))) {
  test('UI001 real native workflow state is rendered at three widths: ' + name, () => {
    const f = JSON.parse(fs.readFileSync(path.join(fixtures, name)));
    const h = loadPage({ root, route: f.route });
    h.page.setData(f.data);
    for (const width of [320, 390, 430]) {
      const html = buildPreview({
        root,
        route: f.route,
        data: h.page.data,
        width,
        height: 844,
      }).phone;
      for (const text of f.expectText) assert.ok(html.includes(text), width + ': ' + text);
      assert.doesNotMatch(html, /src="https?:/);
      if (name.includes('material-profile')) {
        assert.ok(html.indexOf('mini-component-scb-steps') < html.indexOf('material-profile'));
        assert.match(html, /data-mini-bindtap="switchMaterialPanel"/);
        assert.doesNotMatch(html, /class="[^"]*(?:material-section-tabs|material-paths)/);
      }
      if (name.includes('insurance-pending'))
        assert.match(html, /data-mini-bindtap="saveInsurance"[^>]*disabled/);
      if (name.includes('qualification-current')) {
        assert.match(html, /type="checkbox"/);
        assert.match(html, /data-mini-bindtap="request"[^>]*disabled/);
        const closed = html.match(/<div[^>]*class="precheck-cell closed"[^>]*>/);
        assert.ok(closed);
        assert.doesNotMatch(closed[0], /data-mini-bindtap/);
      }
    }
  });
}

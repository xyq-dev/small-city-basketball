const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const clone = (v) => JSON.parse(JSON.stringify(v));
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const select = { detail: { value: ['record'] } };
const tap = (id) => ({ currentTarget: { dataset: { id } } });
const body = (route, data, width = 390) => {
  const result = buildPreview({ root, route: 'pages/' + route + '/index', data, width });
  return result.phone.slice(result.phone.indexOf('<body>'));
};
function live() {
  let actor = id(3),
    revision = 1;
  const calls = [];
  const workspace = {
    match: { id: id(2), eventId: id(4), status: 'SCHEDULED' },
    sessions: [],
    channels: [{ id: id(5), label: '合成已核验频道', platform: 'BILIBILI', revoked: false }],
    capabilities: { providerReady: true, canManage: true, canExecute: true, blockers: [] },
  };
  const client = {
    viewerId: () => actor,
    sessionRevision: () => revision,
    hasSession: () => true,
    request: async (p, m = 'GET', b) => {
      calls.push({ p, m, b: b && clone(b) });
      if (m === 'GET') return { data: workspace };
      throw Error('合成结果未知');
    },
  };
  const h = loadPage({
    root,
    route: 'pages/live-studio/index',
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (v) => v } },
  });
  h.page._alive = true;
  h.page._visible = true;
  h.page.org = id(1);
  h.page.match = id(2);
  h.page.apply(workspace);
  h.page.setData({ selected: [id(5)] });
  return {
    ...h,
    calls,
    workspace,
    switchActor: () => {
      actor = id(6);
      revision++;
    },
  };
}
test('V01 recording starts with no current application consent and unchecked creation cannot write', async () => {
  const h = live();
  assert.equal(h.page.data.record, true);
  assert.equal(h.page.data.recordConsent, false);
  const html = body('live-studio', h.page.data);
  assert.ok(html.indexOf('live-match-summary') < html.indexOf('live-preparation-form'));
  assert.ok(html.indexOf('live-recording-row') < html.indexOf('capability-notice'));
  assert.match(html, /data-mini-bindchange="recordConsentChange"/);
  assert.match(html, /live-create-actions/);
  assert.doesNotMatch(html, /page-intro|尚未创建本场直播/);
  await h.page.create();
  assert.equal(h.calls.filter((c) => c.m === 'POST').length, 0);
  assert.equal(h.wx.storage.size, 0);
  assert.match(h.page.data.error, /本次申请包含录制/);
});
test('V01 explicit recording choice retains the real CREATE body and unknown retries do not require new consent', async () => {
  const h = live();
  h.page.recordConsentChange(select);
  assert.equal(h.page.data.recordConsent, true);
  await h.page.create();
  const original = h.calls.find((c) => c.m === 'POST').b;
  assert.equal(original.type, 'CREATE');
  assert.equal(original.record, true);
  assert.equal(original.maximumSeconds, 3600);
  assert.equal(original.budgetFen, 10000);
  assert.deepEqual(original.channelIds, [id(5)]);
  assert.equal(h.page.data.pending, true);
  h.page.clearRecordConsent();
  await h.page.retry();
  const writes = h.calls.filter((c) => c.m === 'POST');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].b, original);
});
test('V01 disabling recording keeps its original false input and needs no recording application consent', async () => {
  const h = live();
  h.page.setRecord({ detail: { value: false } });
  await h.page.create();
  assert.equal(h.page.data.recordConsent, false);
  assert.equal(h.calls.find((c) => c.m === 'POST').b.record, false);
});
test('V01 actor, match, input, record and visibility changes cannot reuse a prior application checkbox', async () => {
  for (const change of [
    (h) => h.switchActor(),
    (h) => {
      h.page.match = id(9);
    },
    (h) =>
      h.page.input({ currentTarget: { dataset: { field: 'minutes' } }, detail: { value: '90' } }),
    (h) => h.page.setRecord({ detail: { value: true } }),
    (h) => h.page.onHide(),
    (h) => h.page.onShow(),
  ]) {
    const h = live();
    h.page.recordConsentChange(select);
    change(h);
    await h.page.create();
    assert.equal(h.calls.filter((c) => c.m === 'POST').length, 0);
    assert.equal(h.page.data.recordConsent, false);
  }
  const h = live();
  h.page.onHide();
  h.page.recordConsentChange(select);
  assert.equal(
    h.page.data.recordConsent,
    false,
    'late checkbox events do not restore hidden consent',
  );
});
function jobs() {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/ui002-live-media-jobs-filled.json',
      ),
    ),
  );
  const data = clone(fixture.data);
  const calls = [];
  const client = {
    viewerId: () => id(3),
    sessionRevision: () => 1,
    hasSession: () => true,
    request: async (p, m = 'GET', b) => {
      calls.push({ p, m, b: b && clone(b) });
      if (m === 'GET') return { data };
      throw Error('合成结果未知');
    },
  };
  const h = loadPage({
    root,
    route: fixture.route,
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (v) => v } },
  });
  h.page._alive = true;
  h.page.org = id(1);
  h.page.session = data.session.id;
  h.page.setData(data);
  return { ...h, calls };
}
test('V06 records render before controls; explicit calibration disclosure retains the actual job/version command and original retry', async () => {
  const h = jobs();
  const job = h.page.data.jobs.find((j) => j.kind === 'RECORDING' && j.status === 'READY');
  const initial = body('media-jobs', h.page.data);
  assert.match(initial, /录制产物与任务/);
  assert.doesNotMatch(initial, /data-mini-bindinput="input"/);
  assert.ok(initial.indexOf('media-overview') < initial.indexOf('media-boundary'));
  h.page.toggleJob(tap(job.id));
  h.page.toggleCalibration();
  assert.match(body('media-jobs', h.page.data), /data-mini-bindinput="input"/);
  assert.equal(h.calls.length, 0);
  h.page.input({
    currentTarget: { dataset: { field: 'anchorAt' } },
    detail: { value: '2028-06-01T12:00:00+08:00' },
  });
  h.page.input({ currentTarget: { dataset: { field: 'offsetMs' } }, detail: { value: '42' } });
  await h.page.command({
    currentTarget: { dataset: { type: 'CALIBRATE', id: job.id, version: job.version } },
  });
  const original = h.calls.find((c) => c.m === 'POST').b;
  assert.equal(original.jobId, job.id);
  assert.equal(original.expectedVersion, job.version);
  assert.equal(original.offsetMs, 42);
  assert.equal(h.page.data.pending, true);
  await h.page.retry();
  assert.deepEqual(h.calls.filter((c) => c.m === 'POST')[1].b, original);
});
test('V01/V06 actual templates retain closed, pending and local icon slots at three widths', () => {
  const l = live(),
    j = jobs();
  l.page.setData({ capabilities: { providerReady: false, blockers: ['合成准入未验'] } });
  for (const width of [320, 390, 430]) {
    const preparation = body('live-studio', l.page.data, width);
    assert.match(preparation, /合成准入未验/);
    assert.match(preparation, /data-mini-bindtap="create" disabled/);
    const preview = buildPreview({
      root,
      route: 'pages/media-jobs/index',
      data: j.page.data,
      width,
    });
    for (const icon of ['play.svg', 'clock.svg', 'bars.svg', 'chevron.svg'])
      assert.ok(preview.assets.some((asset) => asset.path.endsWith('/' + icon) && asset.bytes > 0));
  }
});

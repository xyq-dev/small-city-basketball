const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/media-jobs/index';
const org = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const processingId = '55555555-5555-4555-8555-555555555555';

function setup(status = 'RUNNING', confirm = true) {
  const requests = [];
  let stops = 0;
  const client = {
    sessionRevision: () => 1,
    viewerId: () => actor,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      requests.push({ url, method, body: body && structuredClone(body) });
      return { data: {} };
    },
  };
  const wx = createWx({ modalAnswers: [confirm] });
  wx.createLivePusherContext = () => ({ stop: () => stops++ });
  const h = loadPage({
    root,
    route,
    wx,
    modules: {
      [path.join(root, 'utils/api.js')]: {
        getClient: () => client,
        uuid: (value) => value,
      },
    },
  });
  h.page._alive = true;
  h.page.org = org;
  h.page.session = sessionId;
  h.page.load = async () => {};
  h.page.setData({
    mediaTab: 'recording',
    canManage: true,
    session: { id: sessionId, eventName: '合成正在直播的赛事', desired: 'LIVE', targets: [] },
    jobs: [
      {
        id: jobId,
        kind: 'RECORDING',
        kindText: '合成独立录像',
        status,
        statusText: status,
        version: 3,
      },
      {
        id: processingId,
        kind: 'TRANSCODE',
        kindText: '合成转码任务',
        status: 'RUNNING',
        statusText: '处理中',
        version: 4,
      },
    ],
    recordingCount: 1,
    processingCount: 1,
  });
  return { ...h, requests, stops: () => stops };
}

const render = (page) => buildPreview({ root, route, data: page.data }).phone;
const buttons = (html) => html.match(/<button\b[^>]*>/g) || [];
function button(page, handler, dataset = {}) {
  return buttons(render(page)).find(
    (tag) =>
      tag.includes(`data-mini-bindtap="${handler}"`) &&
      Object.entries(dataset).every(([key, value]) => tag.includes(`data-${key}="${value}"`)),
  );
}
async function activate(page, tag) {
  assert.ok(tag, 'The action must be reachable from a rendered template control');
  if (/\bdisabled\b/.test(tag)) return false;
  const handler = tag.match(/data-mini-bindtap="([^"]+)"/)?.[1];
  const dataset = Object.fromEntries(
    [...tag.matchAll(/\bdata-(?!mini-)([a-z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
  await page[handler]({ currentTarget: { dataset } });
  return true;
}

for (const status of ['QUEUED', 'RUNNING']) {
  test(`${status} recording exposes its own cancel command without stopping the live session`, async () => {
    const h = setup(status);
    const liveSession = structuredClone(h.page.data.session);
    await activate(h.page, button(h.page, 'toggleJob', { id: jobId }));
    const cancel = button(h.page, 'command', { type: 'CANCEL_JOB', id: jobId });
    assert.ok(cancel, 'An active recording needs a visible cancel action in the recording tab');
    assert.doesNotMatch(cancel, /\bdisabled\b/);
    await activate(h.page, cancel);
    assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
    assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.url, `/v1/orgs/${org}/broadcasts/${sessionId}/media/commands`);
    assert.equal(request.method, 'POST');
    assert.equal(request.body.type, 'CANCEL_JOB');
    assert.equal(request.body.jobId, jobId);
    assert.equal(request.body.expectedVersion, 3);
    assert.deepEqual(Object.keys(request.body).sort(), [
      'clientRequestId',
      'expectedVersion',
      'jobId',
      'type',
    ]);
    assert.equal(h.stops(), 0);
    assert.deepEqual(h.page.data.session, liveSession);
  });
}

test('recording, processing and artifact tabs keep independent job domains and capabilities', async () => {
  const h = setup();
  await activate(h.page, button(h.page, 'changeMediaTab', { tab: 'jobs' }));
  assert.equal(button(h.page, 'toggleJob', { id: jobId }), undefined);
  await activate(h.page, button(h.page, 'toggleJob', { id: processingId }));
  assert.ok(button(h.page, 'command', { type: 'CANCEL_JOB', id: processingId }));
  assert.equal(button(h.page, 'command', { type: 'CANCEL_JOB', id: jobId }), undefined);
  await activate(h.page, button(h.page, 'changeMediaTab', { tab: 'artifacts' }));
  assert.equal(button(h.page, 'toggleJob', { id: jobId }), undefined);
  assert.equal(button(h.page, 'command', { type: 'CANCEL_JOB' }), undefined);
  await activate(h.page, button(h.page, 'changeMediaTab', { tab: 'recording' }));
  assert.equal(h.page.data.expandedJobId, '');
  await activate(h.page, button(h.page, 'toggleJob', { id: jobId }));
  assert.ok(button(h.page, 'command', { type: 'CANCEL_JOB', id: jobId }));
  assert.equal(button(h.page, 'toggleJob', { id: processingId }), undefined);
  assert.equal(h.requests.length, 0);
});

for (const field of ['busy', 'pending']) {
  test(`${field} keeps an expanded recording cancellation disabled`, async () => {
    const h = setup();
    h.page.setData({ expandedJobId: jobId, [field]: true });
    const cancel = button(h.page, 'command', { type: 'CANCEL_JOB', id: jobId });
    assert.ok(cancel);
    assert.match(cancel, /\bdisabled\b/);
    assert.equal(await activate(h.page, cancel), false);
    assert.equal(h.requests.length, 0);
    assert.equal(
      h.wx.calls.some((call) => call.type === 'showModal'),
      false,
    );
  });
}

test('a viewer without management capability cannot cancel recording or processing jobs', () => {
  const h = setup();
  for (const mediaTab of ['recording', 'jobs', 'artifacts']) {
    h.page.setData({ canManage: false, mediaTab, expandedJobId: jobId });
    assert.equal(button(h.page, 'command', { type: 'CANCEL_JOB' }), undefined);
  }
  assert.equal(h.requests.length, 0);
});

test('declining the recording cancellation confirmation sends no command', async () => {
  const h = setup('RUNNING', false);
  await activate(h.page, button(h.page, 'toggleJob', { id: jobId }));
  await activate(h.page, button(h.page, 'command', { type: 'CANCEL_JOB', id: jobId }));
  assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.stops(), 0);
});

test('finished recordings retain calibration but never show active-job cancellation', async () => {
  for (const status of ['READY', 'FAILED', 'CANCELLED']) {
    const h = setup(status);
    await activate(h.page, button(h.page, 'toggleJob', { id: jobId }));
    assert.equal(button(h.page, 'command', { type: 'CANCEL_JOB', id: jobId }), undefined);
    const calibration = button(h.page, 'toggleCalibration');
    if (status === 'READY') {
      await activate(h.page, calibration);
      assert.ok(button(h.page, 'command', { type: 'CALIBRATE', id: jobId }));
      const html = render(h.page);
      for (const field of ['anchorAt', 'offsetMs', 'reason'])
        assert.match(html, new RegExp(`data-field="${field}"`));
    } else assert.equal(calibration, undefined);
  }
});

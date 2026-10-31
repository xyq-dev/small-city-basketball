const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { parseWxml } = require('./helpers/wxml.cjs');
const { renderWxml } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const org = '11111111-1111-4111-8111-111111111111',
  match = '22222222-2222-4222-8222-222222222222',
  session = '33333333-3333-4333-8333-333333333333',
  actor = '44444444-4444-4444-8444-444444444444';
const tick = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const snapshot = (extra = {}) => ({
  id: session,
  matchId: match,
  version: 2,
  epoch: 1,
  sourceEpoch: 1,
  desired: 'PAUSED',
  observed: 'INTERRUPTED',
  sourceExpiresAt: null,
  leaseOwned: false,
  approved: true,
  recordingApproved: true,
  maximumSeconds: 3600,
  budgetFen: 1000,
  startedAt: null,
  targets: [
    {
      channelId: org,
      platform: 'BILIBILI',
      label: '合成频道',
      epoch: 1,
      state: 'STOPPED',
      observedAt: null,
      platformState: 'UNKNOWN',
    },
  ],
  ...extra,
});
function fixture(route = 'live-studio') {
  let revision = 0,
    viewer = actor,
    handler = async () => ({ data: workspace }),
    calls = [];
  const listeners = new Set();
  const workspace = {
    match: { id: match, eventId: org, status: 'SCHEDULED' },
    channels: [],
    sessions: [snapshot()],
    capabilities: { canManage: true, canExecute: true, providerReady: true, blockers: [] },
  };
  const client = {
    viewerId: () => viewer,
    sessionRevision: () => revision,
    hasSession: () => true,
    onSessionChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    request: async (p, m = 'GET', b) => {
      calls.push({ p, m, b });
      return handler(p, m, b);
    },
  };
  const api = {
    getClient: () => client,
    uuid: (v) => {
      assert.match(v, /^[a-f0-9-]{36}$/);
      return v;
    },
    API_ORIGIN: 'https://basketball.playhubs.cn',
  };
  const wx = createWx({ modalAnswers: Array(20).fill(true) });
  let starts = 0,
    stops = 0,
    startCallback;
  wx.createLivePusherContext = () => ({
    start: (o) => {
      starts++;
      startCallback = o;
    },
    stop: () => {
      stops++;
    },
  });
  const h = loadPage({
    root,
    route: 'pages/' + route + '/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  return {
    ...h,
    client,
    calls,
    workspace,
    setHandler: (v) => {
      handler = v;
    },
    starts: () => starts,
    stops: () => stops,
    startSuccess: () => startCallback.success(),
    switchAccount() {
      viewer = org;
      revision++;
      for (const l of listeners) l();
    },
    async open() {
      h.page.onLoad(
        route === 'live-studio'
          ? { orgId: org, matchId: match }
          : { orgId: org, sessionId: session },
      );
      if (h.page.onReady) h.page.onReady();
      await tick();
    },
  };
}
const tap = (type) => ({ currentTarget: { dataset: { type } }, detail: {} });
test('real live-pusher page burns no credentials into durable pending journal and pauses explicitly on background', async () => {
  const h = fixture();
  await h.open();
  h.setHandler(async (p, m, b) => {
    if (m === 'GET')
      return {
        data: { ...h.workspace, sessions: [snapshot({ desired: 'RUNNING', leaseOwned: true })] },
      };
    if (b.type === 'START' || b.type === 'HEARTBEAT')
      return {
        data: {
          session: snapshot({ desired: 'RUNNING', leaseOwned: true, version: 3 }),
          source: {
            pushUrl: 'rtmp://push.example.com/live/synthetic?txSecret=synthetic',
            leaseToken: 'private-lease-token',
            sourceEpoch: 1,
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        },
      };
    return { data: { session: snapshot({ version: 4 }) } };
  });
  await h.page.action(tap('START'));
  assert.equal(h.starts(), 1);
  h.startSuccess();
  await tick();
  assert.equal(h.page.data.capturing, true);
  const stored = JSON.stringify([...h.wx.storage.values()]);
  assert.doesNotMatch(stored, /private-lease-token|txSecret|pushUrl/);
  h.page.onHide();
  await tick();
  assert.equal(h.page.data.pushUrl, '');
  assert.equal(h.page.data.capturing, false);
  assert.ok(h.stops() > 0);
  assert.ok(h.calls.some((c) => c.b?.type === 'PAUSE'));
  assert.equal(h.intervals.size, 0);
  h.page.onUnload();
});
test('an unknown write reuses the exact persisted command and a returned lease after hide never starts the phone', async () => {
  const h = fixture();
  await h.open();
  let attempts = 0;
  h.setHandler(async (p, m, b) => {
    if (m === 'GET') return { data: h.workspace };
    if (++attempts === 1) throw { message: '合成断网' };
    return {
      data: {
        session: snapshot({ desired: 'RUNNING', leaseOwned: true, version: 3 }),
        source: {
          pushUrl: 'rtmp://push.example.com/live/synthetic',
          leaseToken: 'secret',
          sourceEpoch: 1,
          expiresAt: new Date().toISOString(),
        },
      },
    };
  });
  await h.page.action(tap('START'));
  assert.equal(h.page.data.pending, true);
  const original = JSON.stringify(h.calls.find((c) => c.b?.type === 'START').b);
  h.page._visible = false;
  await h.page.retry();
  await tick();
  const starts = h.calls.filter((c) => c.b?.type === 'START');
  assert.equal(starts.length, 2);
  assert.equal(JSON.stringify(starts[1].b), original);
  assert.equal(h.starts(), 0);
  assert.ok(h.calls.some((c) => c.b?.type === 'PAUSE'));
  h.page.onUnload();
});
test('storage failure sends no command; late start callback after identity reset cannot restart capture', async () => {
  const h = fixture();
  await h.open();
  h.wx.setStorageSync = () => {
    throw Error('storage full');
  };
  await h.page.action(tap('START'));
  assert.equal(h.calls.filter((c) => c.m === 'POST').length, 0);
  const other = fixture();
  await other.open();
  other.setHandler(async (p, m, b) =>
    m === 'GET'
      ? { data: other.workspace }
      : {
          data: {
            session: snapshot({ desired: 'RUNNING', leaseOwned: true }),
            source: {
              pushUrl: 'rtmp://push.example.com/live/synthetic',
              leaseToken: 'secret',
              sourceEpoch: 1,
            },
          },
        },
  );
  await other.page.action(tap('START'));
  other.switchAccount();
  other.startSuccess();
  assert.equal(other.page.data.pushUrl, '');
  assert.equal(other.page.data.capturing, false);
  assert.ok(other.stops() > 0);
  h.page.onUnload();
  other.page.onUnload();
});
test('media page sends actual calibrated job commands and preserves original identity after unknown outcome', async () => {
  const h = fixture('media-jobs');
  h.setHandler(async () => ({
    data: { session: snapshot(), jobs: [], artifacts: [], canManage: true },
  }));
  await h.open();
  h.page.setData({
    anchorAt: '2026-10-31T12:00:00+08:00',
    offsetMs: '42',
    reason: '人工核对合成素材PTS',
  });
  let unknown = true;
  h.setHandler(async (p, m, b) => {
    if (m === 'GET')
      return { data: { session: snapshot(), jobs: [], artifacts: [], canManage: true } };
    if (unknown) {
      unknown = false;
      throw { message: '合成断网' };
    }
    return { data: { jobId: match } };
  });
  await h.page.command({
    currentTarget: { dataset: { type: 'CALIBRATE', id: match, version: 1 } },
  });
  assert.equal(h.page.data.pending, true);
  await h.page.retry();
  assert.equal(h.page.data.pending, false);
  const requests = h.calls.filter((c) => c.m === 'POST');
  assert.deepEqual(requests[0].b, requests[1].b);
  assert.equal(requests[0].b.offsetMs, 42);
  assert.equal(requests[0].b.anchorAt, '2026-10-31T12:00:00+08:00');
  h.page.onUnload();
});
test('dedicated pages parse actual WXML; private journal rejects credentials regardless of caller', () => {
  const h = fixture();
  const journal = h.requireLocal('utils/streaming.js');
  assert.throws(
    () => journal.save('scope', { clientRequestId: org, pushUrl: 'rtmp://secret' }),
    /不能保存/,
  );
  for (const route of ['live-studio', 'media-jobs'])
    assert.doesNotThrow(() =>
      parseWxml(fs.readFileSync(path.join(root, 'pages', route, 'index.wxml'), 'utf8')),
    );
});

function strictBindings(source) {
  for (const match of source.matchAll(/wx:(if|elif|for)="([^"]*)"/g))
    assert.match(
      match[2],
      /^\{\{[\s\S]+\}\}$/,
      'wx:' + match[1] + ' must use a complete native binding',
    );
  return parseWxml(source);
}
test('native conditions require explicit braces and actually hide management and capture content', async () => {
  assert.throws(
    () => strictBindings('<view wx:if="canManage"/>'),
    /must use a complete native binding/,
  );
  assert.throws(
    () => strictBindings('<view wx:for="jobs"/>'),
    /must use a complete native binding/,
  );
  const live = fs.readFileSync(path.join(root, 'pages/live-studio/index.wxml'), 'utf8'),
    media = fs.readFileSync(path.join(root, 'pages/media-jobs/index.wxml'), 'utf8');
  strictBindings(live);
  strictBindings(media);
  // The compatibility renderer has no live-pusher implementation. Its surrounding real
  // control markup is rendered unchanged; the actual full source was strictly parsed above.
  assert.match(live, /<live-pusher[^>]+url="\{\{pushUrl\}\}"/);
  const controls = live.replace(
    /<live-pusher\b[^>]*\/>/g,
    '<view data-native-camera-placeholder="true"/>',
  );
  const h = fixture();
  const empty = renderWxml(controls, h.page.data);
  assert.doesNotMatch(empty, /批准直播与所选录像用途|源代次|撤销直播与录像授权/);
  await h.open();
  assert.match(renderWxml(controls, h.page.data), /批准直播与所选录像用途/);
  h.page.setData({
    capabilities: { canManage: false, providerReady: false, blockers: ['合成未准入'] },
  });
  const denied = renderWxml(controls, h.page.data);
  assert.doesNotMatch(denied, /批准直播与所选录像用途|撤销直播与录像授权/);
  assert.match(denied, /合成未准入/);
  const data = {
    session: snapshot(),
    jobs: [],
    artifacts: [
      {
        id: org,
        durationText: '1.0秒',
        sizeText: '1MB',
        sha256: '0'.repeat(64),
        version: 1,
        published: false,
      },
    ],
    canManage: false,
    busy: false,
    pending: false,
  };
  assert.doesNotMatch(
    renderWxml(media, data),
    /录像时间校准|独立审核并公开产物|按有效得分生成集锦/,
  );
  assert.match(renderWxml(media, { ...data, canManage: true }), /录像时间校准|独立审核并公开产物/);
  h.page.onUnload();
});

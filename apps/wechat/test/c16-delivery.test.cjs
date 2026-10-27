const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// C16: the remaining match-media interactions the Web workspace already offers (external links
// on trusted hosts, manual time markers, irreversible purge after revoke, private preview) and
// events-tab paging. Server rules stay authoritative; these checks cover what the page sends,
// refuses, cleans up and keeps across failures.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const fileId = '77777777-7777-4777-8777-777777777771';
const videoFile = '77777777-7777-4777-8777-777777777773';
const mediaId = '77777777-7777-4777-8777-777777777772';
const confirmation = '88888888-8888-4888-8888-888888888881';
const sourceEvent = '88888888-8888-4888-8888-888888888882';
const cookie = 'a'.repeat(43);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ok = (data, meta = {}) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c16', nextCursor: null, ...meta } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + code } },
});
const session = (organizations) => ({
  user: { id: userA, email: 'a@example.test', displayName: '合成负责人' },
  organizations,
  teamContexts: [],
});
const lost = () => Promise.reject(new Error('synthetic lost response'));
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;

const fileRow = (over = {}) => ({
  id: fileId,
  purpose: 'MATCH_IMAGE',
  rosterRevisionId: null,
  fileName: 'photo.png',
  contentType: 'image/png',
  byteLength: PNG.length,
  sha256: '2'.repeat(64),
  version: 1,
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  revokedAt: null,
  purgedAt: null,
  ...over,
});
const mediaRow = (over = {}) => ({
  id: mediaId,
  kind: 'VIDEO',
  title: '决赛回放',
  fileId: videoFile,
  externalUrl: null,
  rightsDeclaration: '主办方摄影组拍摄',
  status: 'DRAFT',
  version: 3,
  createdAt: new Date().toISOString(),
  markers: [],
  ...over,
});
function workspace(over = {}) {
  return {
    matchId,
    eventId,
    matchStatus: 'FINAL',
    matchVersion: 9,
    currentConfirmationId: confirmation,
    files: [],
    media: [],
    sourceEvents: [
      { id: sourceEvent, seq: 12, type: 'STAT_RECORDED', serverTime: '2026-10-27T02:30:00Z' },
    ],
    trustedExternalHosts: [],
    usage: { usedBytes: 0, limitBytes: 134217728, maxFileBytes: 8388608 },
    capabilities: {
      canUpload: true,
      canManage: true,
      canPublish: true,
      canMark: true,
      canPurge: true,
    },
    ...over,
  };
}

function device(ws) {
  const state = {
    ws,
    replies: new Map(),
    bodies: [],
    files: new Map(),
    unlinked: [],
    previews: [],
  };
  const wx = createWx({
    modalAnswers: Array(40).fill(true),
    request(options) {
      const key = (options.method || 'GET') + ' ' + options.url.replace(/^https:\/\/[^/]+/, '');
      if (options.method && options.method !== 'GET')
        state.bodies.push({ key, body: JSON.parse(JSON.stringify(options.data ?? null)) });
      if (key === 'GET /v1/auth/session')
        return ok(session([{ id: org, name: '合成机构', role: 'ORG_OWNER' }]));
      if (key === 'GET ' + matchBase + '/media') return ok(state.ws);
      const handler = state.replies.get(key);
      if (handler) return handler(options);
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } };
    },
  });
  wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  wx.getFileSystemManager = () => ({
    writeFile(o) {
      state.files.set(o.filePath, o.data);
      o.success();
    },
    unlink(o) {
      state.unlinked.push(o.filePath);
      state.files.delete(o.filePath);
      o.success && o.success();
    },
  });
  wx.previewImage = (o) => {
    state.previews.push(o.current);
    o.success();
  };
  return {
    wx,
    state,
    sent: (key) => state.bodies.filter((b) => b.key === key),
    async open() {
      const h = loadPage({ root, route: 'pages/match-media/index', wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad({ orgId: org, matchId });
      await h.flush();
      return { ...h, client };
    },
  };
}
const binary = (contentType, bytes) => () => ({
  statusCode: 200,
  data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  header: { 'Content-Type': contentType },
});

test('external links are offered only for configured trusted hosts and checked before sending', async () => {
  const d = device(workspace({ files: [fileRow()] }));
  let page = await d.open();
  assert.deepEqual(page.page.data.trustedHosts, []);
  page.page.setDraftMode(tap({ mode: 'LINK' }));
  assert.equal(page.page.data.draftMode, 'FILE', 'no trusted host, no link mode');
  page.unload();

  d.state.ws = workspace({ trustedExternalHosts: ['video.example.test'] });
  page = await d.open();
  page.page.setDraftMode(tap({ mode: 'LINK' }));
  page.page.titleInput(tap({}, { value: '决赛直播回看' }));
  page.page.rightsInput(tap({}, { value: '主办方授权平台发布' }));
  const create = 'POST ' + matchBase + '/media';
  for (const url of [
    'http://video.example.test/v/1',
    'https://evil.example.test/v/1',
    'https://video.example.test:8443/v/1',
    'https://video.example.test/v/1#t=3',
  ]) {
    page.page.externalInput(tap({}, { value: url }));
    await page.page.createDraft();
    assert.match(page.page.data.error, /受信列表/, url);
  }
  assert.equal(d.sent(create).length, 0);
  // A lost response for a link draft is protected exactly like a file draft.
  d.state.replies.set(create, lost);
  page.page.externalInput(tap({}, { value: 'https://video.example.test/v/1' }));
  await page.page.createDraft();
  await page.flush();
  assert.deepEqual(d.sent(create)[0].body, {
    kind: 'EXTERNAL_LINK',
    title: '决赛直播回看',
    externalUrl: 'https://video.example.test/v/1',
    rightsDeclaration: '主办方授权平台发布',
  });
  d.state.ws = workspace({
    trustedExternalHosts: ['video.example.test'],
    media: [
      mediaRow({
        kind: 'EXTERNAL_LINK',
        fileId: null,
        externalUrl: 'https://video.example.test/v/1',
        title: '决赛直播回看',
      }),
    ],
  });
  await page.page.load();
  await page.flush();
  assert.equal(page.page.data.pending.candidates.length, 1, 'shown for checking, not proof');
  await page.page.createDraft();
  assert.equal(d.sent(create).length, 1, 'no second link draft while unknown');
  assert.match(page.page.data.items[0].externalUrl, /video\.example\.test/);
  page.unload();
});

test('time markers: only on confirmed private video drafts, pinned to version and confirmation', async () => {
  const d = device(
    workspace({
      files: [fileRow({ id: videoFile, purpose: 'MATCH_VIDEO', contentType: 'video/mp4' })],
      media: [mediaRow(), mediaRow({ id: fileId, kind: 'IMAGE', fileId })],
    }),
  );
  const page = await d.open();
  assert.equal(page.page.data.items[0].canMark, true);
  assert.equal(page.page.data.items[1].canMark, false, 'images take no markers');
  assert.match(page.page.data.sources[0].label, /#12 记录/);
  page.page.openMarker(tap({ id: mediaId }));
  const key = 'POST ' + matchBase + '/media/' + mediaId + '/markers';
  page.page.markerInput(tap({ field: 'label' }, { value: '第四节绝杀' }));
  page.page.markerInput(tap({ field: 'start' }, { value: '95' }));
  page.page.markerInput(tap({ field: 'end' }, { value: '90' }));
  await page.page.addMarker();
  assert.match(page.page.data.error, /结束位置须晚于开始位置/);
  page.page.markerInput(tap({ field: 'end' }, { value: '101.5' }));
  d.state.replies.set(key, () => fail(409, 'VERSION_CONFLICT'));
  await page.page.addMarker();
  await page.flush();
  assert.deepEqual(d.sent(key)[0].body, {
    expectedVersion: 3,
    expectedConfirmationId: confirmation,
    sourceEventId: sourceEvent,
    label: '第四节绝杀',
    startMs: 95000,
    endMs: 101500,
  });
  assert.match(page.page.data.error, /已被其他操作更新/);
  assert.equal(page.page.data.busy, false);
  page.unload();

  // Without an independently confirmed result, no marker can be started.
  const noConfirm = device(workspace({ currentConfirmationId: null, media: [mediaRow()] }));
  const p2 = await noConfirm.open();
  assert.equal(p2.page.data.items[0].canMark, false);
  p2.unload();
});

test('purge is offered only after revoke, needs a reason and confirmation, and pins the version', async () => {
  const d = device(workspace({ files: [fileRow()] }));
  const page = await d.open();
  assert.equal(page.page.data.files[0].canPurge, false, 'an active file is revoked first');
  page.unload();
  d.state.ws = workspace({ files: [fileRow({ status: 'REVOKED', version: 2 })] });
  const again = await d.open();
  assert.equal(again.page.data.files[0].canPurge, true);
  again.page.askPurgeFile(tap({ id: fileId }));
  const key = 'POST ' + matchBase + '/media-files/' + fileId + '/commands';
  await again.page.purgeFile();
  assert.match(again.page.data.error, /至少4个字/);
  assert.equal(d.sent(key).length, 0);
  again.page.purgeReasonInput(tap({}, { value: '含未授权肖像，按要求删除' }));
  d.state.replies.set(key, () => {
    d.state.ws = workspace({ files: [fileRow({ status: 'PURGED', version: 3 })] });
    return ok(fileRow({ status: 'PURGED', version: 3 }));
  });
  await again.page.purgeFile();
  await again.flush();
  assert.deepEqual(d.sent(key)[0].body, {
    type: 'PURGE',
    expectedVersion: 2,
    reason: '含未授权肖像，按要求删除',
  });
  const confirm = d.wx.calls.filter((c) => c.type === 'showModal').at(-1);
  assert.match(confirm.content, /不可恢复/);
  assert.equal(again.page.data.files[0].statusLabel, '内容已清除');
  assert.equal(again.page.data.files[0].canPurge, false);
  again.unload();

  // Declining the confirmation sends nothing.
  const d2 = device(workspace({ files: [fileRow({ status: 'REVOKED', version: 2 })] }));
  d2.wx.showModal = (o) => o.success({ confirm: false, cancel: true });
  const p2 = await d2.open();
  p2.page.askPurgeFile(tap({ id: fileId }));
  p2.page.purgeReasonInput(tap({}, { value: '含未授权肖像，按要求删除' }));
  await p2.page.purgeFile();
  assert.equal(d2.sent(key).length, 0);
  p2.unload();
});

test('private preview downloads to a temporary file and removes it on close, hide and logout', async () => {
  const video = Buffer.from('0000001866747970', 'hex');
  const d = device(
    workspace({
      files: [
        fileRow(),
        fileRow({
          id: videoFile,
          purpose: 'MATCH_VIDEO',
          fileName: 'clip.mp4',
          contentType: 'video/mp4',
          byteLength: video.length,
        }),
      ],
    }),
  );
  d.state.replies.set(
    'GET ' + matchBase + '/media-files/' + fileId + '/content',
    binary('image/png', PNG),
  );
  d.state.replies.set(
    'GET ' + matchBase + '/media-files/' + videoFile + '/content',
    binary('video/mp4', video),
  );
  const page = await d.open();
  await page.page.preview(tap({ id: fileId }));
  await page.flush();
  assert.equal(d.state.previews.length, 1);
  assert.match(d.state.previews[0], /^wxfile:\/\/usr\/scb-media-.*\.png$/);
  await page.page.preview(tap({ id: videoFile }));
  await page.flush();
  assert.match(page.page.data.previewVideo, /\.mp4$/);
  assert.ok(d.state.unlinked.includes(d.state.previews[0]), 'the image temp file was removed');
  page.page.onHide();
  assert.equal(page.page.data.previewVideo, '');
  assert.equal(d.state.files.size, 0, 'no temporary file left after hiding');
  page.page.onShow();
  await page.page.preview(tap({ id: videoFile }));
  await page.flush();
  assert.equal(d.state.files.size, 1);
  page.client.clearSession();
  assert.equal(d.state.files.size, 0, 'an account change removes it at once');
  assert.equal(page.page.data.previewVideo, '');
  page.unload();
});

test('preview refuses content that does not match the record and never previews other paths', async () => {
  const d = device(workspace({ files: [fileRow()] }));
  d.state.replies.set(
    'GET ' + matchBase + '/media-files/' + fileId + '/content',
    binary('image/jpeg', PNG),
  );
  const page = await d.open();
  await page.page.preview(tap({ id: fileId }));
  await page.flush();
  assert.match(page.page.data.error, /不一致/);
  assert.equal(d.state.previews.length, 0);
  assert.equal(d.state.files.size, 0);
  d.state.replies.set('GET ' + matchBase + '/media-files/' + fileId + '/content', () =>
    fail(410, 'MEDIA_FILE_GONE'),
  );
  await page.page.preview(tap({ id: fileId }));
  await page.flush();
  assert.match(page.page.data.error, /撤销或权限变化/);
  await assert.rejects(page.client.download(matchBase + '/media'), { code: 'INVALID_PATH' });
  await assert.rejects(
    page.client.download(
      '/v1/orgs/' + org + '/teams/' + matchId + '/media-files/' + fileId + '/content',
    ),
    { code: 'INVALID_PATH' },
  );
  page.unload();
});

// ---------- events tab paging ----------
const sessionKey = (o) => o.url.replace(/^https:\/\/[^/]+/, '');
function eventsDevice(pages, failAt) {
  const calls = [];
  const wx = createWx({
    request(options) {
      const url = sessionKey(options);
      if (url === '/v1/auth/session')
        return ok(session([{ id: org, name: '合成机构', role: 'ORG_ADMIN' }]));
      if (url.startsWith('/v1/orgs/' + org + '/events?limit=50')) {
        const n = Number((/cursor=p(\d+)/.exec(url) || [0, 0])[1]);
        calls.push(n);
        if (n === failAt) return fail(500, 'INTERNAL');
        const rows = [
          {
            id: '9' + String(n).padStart(7, '0') + '-0000-4000-8000-000000000000',
            name: '合成第' + (n + 1) + '页赛事',
            startDate: '2026-10-01',
            endDate: '2026-10-02',
            timezone: 'Asia/Shanghai',
            venueName: '合成体育馆',
            format: 'ROUND_ROBIN',
            status: 'RUNNING',
            version: 1,
          },
        ];
        return ok(rows, { nextCursor: n + 1 < pages ? 'p' + (n + 1) : null });
      }
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: url } } };
    },
  });
  return { wx, calls };
}
async function openWatch(d) {
  const h = loadPage({ root, route: 'pages/watch/index', wx: d.wx });
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  h.page.onLoad();
  await h.page.load();
  await h.flush();
  return h;
}

test('the events tab follows the cursor up to 500 events and names organizations beyond that', async () => {
  const d = eventsDevice(12);
  const h = await openWatch(d);
  assert.equal(d.calls.length, 10);
  assert.equal(h.page.data.total, 10);
  assert.deepEqual(h.page.data.truncated, ['合成机构']);
  h.unload();
  const all = eventsDevice(3);
  const h2 = await openWatch(all);
  assert.equal(all.calls.length, 3);
  assert.deepEqual(h2.page.data.truncated, []);
  h2.unload();
  // The home summary still reads a single page.
  const home = eventsDevice(3);
  const hh = loadPage({ root, route: 'pages/home/index', wx: home.wx });
  await hh.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  hh.page.onLoad();
  hh.page.onShow();
  await hh.flush();
  assert.equal(home.calls.length, 1);
  hh.unload();
});

test('a later page failing keeps the events already read and says the list is incomplete', async () => {
  const d = eventsDevice(5, 2);
  const h = await openWatch(d);
  assert.equal(h.page.data.total, 2, 'the two pages read are shown');
  assert.equal(h.page.data.failures.length, 1);
  assert.match(h.page.data.failures[0].message, /后续赛事读取未完成，仅显示已读取的 2 届/);
  h.unload();
});

// ---------- court maintenance on the schedule page ----------
test('courts: rename and disable pin the version, need confirmation and stay server-checked', async () => {
  const courtA = '66666666-6666-4666-8666-666666666661';
  const courtB = '66666666-6666-4666-8666-666666666662';
  const evBase = '/v1/orgs/' + org + '/events/' + eventId;
  const courts = [
    { id: courtA, name: '一号场', status: 'ACTIVE', version: 4, capabilities: { canManage: true } },
    {
      id: courtB,
      name: '旧场',
      status: 'DISABLED',
      version: 2,
      capabilities: { canManage: false },
    },
  ];
  const bodies = [];
  const answers = [true, false];
  const wx = createWx({
    modalAnswers: answers,
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const key = (options.method || 'GET') + ' ' + url;
      if (options.method === 'PATCH') bodies.push(JSON.parse(JSON.stringify(options.data)));
      if (url === '/v1/auth/session')
        return ok(session([{ id: org, name: '合成机构', role: 'ORG_OWNER' }]));
      if (key === 'GET ' + evBase + '/scheduling')
        return ok({
          event: {
            id: eventId,
            name: '合成赛事',
            status: 'REGISTRATION_FROZEN',
            version: 5,
            startDate: '2028-03-01',
            endDate: '2028-03-02',
            format: 'ROUND_ROBIN',
          },
          freeze: null,
          currentRevision: null,
          publication: null,
          support: { supported: true, reason: null },
          capabilities: { canGenerate: true, canRedraw: false, canReadMatches: true },
        });
      if (key === 'GET /v1/orgs/' + org + '/courts?limit=100')
        return ok(courts, { capabilities: { canCreateCourt: true } });
      if (key === 'PATCH /v1/orgs/' + org + '/courts/' + courtA)
        return ok({ ...courts[0], version: 5 });
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } };
    },
  });
  const h = loadPage({ root, route: 'pages/schedule/index', wx });
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  h.page.onLoad({ orgId: org, eventId });
  await h.flush();
  assert.deepEqual(
    h.page.data.courtAdmin.map((c) => c.name),
    ['一号场'],
    'only courts this identity may manage',
  );
  h.page.askRename(tap({ id: courtA }));
  h.page.renameInput(tap({}, { value: '一号主场' }));
  await h.page.saveRename();
  await h.flush();
  assert.deepEqual(bodies[0], { expectedVersion: 4, name: '一号主场', status: 'ACTIVE' });
  // First confirmation accepted (disable), second declined (nothing sent).
  answers.length = 0;
  answers.push(true, false);
  await h.page.toggleCourtStatus(tap({ id: courtA }));
  await h.flush();
  assert.deepEqual(bodies[1], { expectedVersion: 4, name: '一号场', status: 'DISABLED' });
  await h.page.toggleCourtStatus(tap({ id: courtA }));
  await h.flush();
  assert.equal(bodies.length, 2, 'a declined confirmation sends nothing');
  h.unload();
});

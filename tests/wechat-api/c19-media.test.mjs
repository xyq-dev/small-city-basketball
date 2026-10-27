import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { PASSWORD, device, http, register, signIn, startServer, tap } from './support.mjs';

// C19 match media through the real match-media page: actual Page/utils code in the VM harness,
// every wx.request forwarded to the real API on loopback backed by an owned isolated PostgreSQL
// database. HTTP only prepares the frozen event; the schedule is published natively. Covers an
// idempotent whole-file upload whose response is lost and recovered by the same request ID's
// receipt, a lost draft response, and a chunked upload interrupted mid-way and resumed from the
// server-confirmed chunks after re-entering the page.
let server, call, org, root, ownerCookie, leaderId, leaderCookie;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const fixtures = fs.readFileSync(
  new URL('../../apps/api/test/media-fixtures.ts', import.meta.url),
  'utf8',
);
const MP4 = Buffer.from(/syntheticMp4 = Buffer\.from\(\s*'([^']+)'/.exec(fixtures)[1], 'base64');
/** A structurally valid MP4 of an exact size: the API fixture plus one `free` box. */
function bigMp4(size) {
  const b = Buffer.alloc(size);
  MP4.copy(b);
  b.writeUInt32BE(size - MP4.length, MP4.length);
  b.write('free', MP4.length + 4, 'ascii');
  for (let i = MP4.length + 8; i < size; i++) b[i] = (i * 13) & 255;
  return b;
}

before(async () => {
  server = await startServer();
  call = http(server);
  const owner = await server.bootstrapOwner({
    email: 'owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成茂名篮协',
  });
  org = owner.organizationId;
  root = `/v1/orgs/${org}`;
  const login = async (email) =>
    (await call('/v1/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).cookie;
  ownerCookie = await login('owner@example.test');
  const d = device(server);
  await register(d, 'leader@example.test', '合成领队');
  leaderId = (await d.client.request('/v1/auth/session')).data.user.id;
  leaderCookie = await login('leader@example.test');
});
after(async () => {
  await server?.close();
});

const version = async (eventPath) => (await call(eventPath, { cookie: ownerCookie })).data.version;
/** HTTP only: an event with two approved, frozen teams. */
async function frozenEvent() {
  const event = (
    await call(`${root}/events`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name: '合成媒体杯',
        startDate: '2028-06-01',
        endDate: '2028-06-03',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    })
  ).data;
  const eventPath = `${root}/events/${event.id}`;
  await call(`${eventPath}/registration-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedVersion: await version(eventPath),
      minPlayers: 2,
      maxPlayers: 3,
      zeroAndDoubleZeroDistinct: true,
      requireIdentity: false,
      requireInsurance: false,
    },
  });
  const stage = async (type) =>
    call(`${eventPath}/registration-commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type, expectedVersion: await version(eventPath) },
    });
  await stage('OPEN_REGISTRATION');
  for (const teamName of ['合成甲队', '合成乙队']) {
    let team = (
      await call(`${root}/teams`, { method: 'POST', cookie: ownerCookie, body: { name: teamName } })
    ).data;
    team = (
      await call(`${root}/teams/${team.id}/members`, {
        method: 'PUT',
        cookie: ownerCookie,
        body: {
          expectedVersion: team.version,
          members: [{ name: teamName + '一' }, { name: teamName + '二' }],
        },
      })
    ).data;
    const issued = (
      await call(`${root}/teams/${team.id}/invitations`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { targetUserId: leaderId, expiresInHours: 1 },
      })
    ).data;
    await call(`/v1/invitations/${issued.invitation.id}/accept`, {
      method: 'POST',
      cookie: leaderCookie,
      body: { token: issued.token },
    });
    let entry = (
      await call(`${eventPath}/entries`, {
        method: 'POST',
        cookie: leaderCookie,
        body: { teamId: team.id },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/roster`, {
        method: 'PUT',
        cookie: leaderCookie,
        body: {
          expectedVersion: entry.version,
          players: team.members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 4) })),
        },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/commands`, {
        method: 'POST',
        cookie: leaderCookie,
        body: { type: 'SUBMIT', expectedVersion: entry.version },
      })
    ).data;
    await call(`${root}/entries/${entry.id}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'APPROVE', expectedVersion: entry.version },
    });
  }
  await stage('CLOSE_REGISTRATION');
  await stage('FREEZE_REGISTRATION');
  return { id: event.id, path: eventPath };
}

test('match media page: lost responses recovered by receipt; chunked upload resumed after re-entry', async () => {
  const owner = device(server);
  await signIn(owner, 'owner@example.test');
  const event = await frozenEvent();
  // Native schedule publication.
  const schedule = owner.open('pages/schedule/index', { orgId: org, eventId: event.id });
  await owner.settle(schedule);
  schedule.page.courtInput(tap({}, { value: '合成一号场' }));
  await schedule.page.addCourt();
  await owner.settle(schedule);
  owner.approve();
  await schedule.page.generate();
  await owner.settle(schedule);
  await schedule.page.autoAssign();
  await owner.settle(schedule);
  await schedule.page.validate();
  await owner.settle(schedule);
  owner.approve();
  await schedule.page.publish();
  await owner.settle(schedule);
  assert.equal(schedule.page.data.state, 'published', schedule.page.data.error);
  const matchId = (await call(`${event.path}/matches`, { cookie: ownerCookie })).data[0].id;
  const q = async (sql, params) => (await server.pool.query(sql, params)).rows;

  // Device files: the picker's temp file and the page's own staging copies.
  const files = new Map();
  owner.wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  owner.wx.getFileSystemManager = () => ({
    readFile: (o) => {
      const b = files.get(o.filePath);
      return b ? o.success({ data: b.toString('base64') }) : o.fail({ errMsg: 'no such file' });
    },
    copyFile: (o) => {
      files.set(o.destPath, Buffer.from(files.get(o.srcPath)));
      o.success();
    },
    writeFile: (o) => {
      files.set(o.filePath, Buffer.from(o.data));
      o.success();
    },
    unlink: (o) => {
      files.delete(o.filePath);
      o.success?.();
    },
  });
  const pick = (name, bytes) => {
    files.set('wxfile://tmp/' + name, bytes);
    owner.wx.chooseMedia = (o) =>
      o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/' + name, size: bytes.length }] });
  };
  const openPage = async () => {
    const page = owner.open('pages/match-media/index', { orgId: org, matchId });
    await owner.settle(page);
    return page;
  };

  // 1. Whole-file request whose response is lost: the server stored it; the next read looks up
  //    the same request ID's receipt and shows it as saved. Nothing is sent twice.
  let page = await openPage();
  assert.equal(page.page.data.caps.upload, true, page.page.data.error);
  pick('final-moment.png', PNG);
  owner.dropNextResponse((o) => o.method === 'POST' && /\/media-file-requests$/.test(o.url));
  await page.page.uploadImage();
  await owner.settle(page);
  assert.equal(page.page.data.request?.state, 'unknown', page.page.data.error);
  const crid = Object.values(owner.wx.storage.get('scb.mediaRequests.v2'))[0].clientRequestId;
  await page.page.load();
  await owner.settle(page);
  assert.equal(page.page.data.request, null, page.page.data.error);
  assert.equal(page.page.data.upload.stage, 'saved');
  assert.equal(page.page.data.files.length, 1);
  const pngRows = await q('SELECT id FROM media_files WHERE org_id=$1 AND sha256=$2', [
    org,
    sha(PNG),
  ]);
  assert.equal(pngRows.length, 1, 'one file');
  assert.deepEqual(
    await q(
      'SELECT result_file_id FROM media_request_receipts WHERE client_request_id=$1 AND operation=$2',
      [crid, 'MATCH_FILE_UPLOAD'],
    ),
    [{ result_file_id: pngRows[0].id }],
  );
  assert.equal(
    (
      await q(
        "SELECT count(*)::int AS n FROM audit_logs WHERE action='media.file.uploaded' AND metadata->>'clientRequestId'=$1",
        [crid],
      )
    )[0].n,
    1,
  );

  // 2. Draft whose response is lost: recovered by its own receipt, one media record.
  page.page.titleInput(tap({}, { value: ' 决赛最后一攻 ' }));
  page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄，仅限本届公开观赛' }));
  owner.dropNextResponse((o) => o.method === 'POST' && /\/media-requests$/.test(o.url));
  await page.page.createDraft();
  await owner.settle(page);
  assert.equal(page.page.data.request?.state, 'unknown', page.page.data.error);
  await page.page.queryRequest();
  await owner.settle(page);
  assert.equal(page.page.data.request, null, page.page.data.error);
  assert.equal(page.page.data.items.length, 1);
  assert.equal(page.page.data.items[0].title, '决赛最后一攻');
  assert.equal(
    (await q('SELECT count(*)::int AS n FROM match_media WHERE match_id=$1', [matchId]))[0].n,
    1,
  );

  // 3. Chunked upload (3 chunks): the reply for chunk 1 is lost and the page is left. On
  //    re-entry the receipt shows the server-confirmed bytes; continuing sends only the rest.
  const video = bigMp4(524288 * 2 + 4321);
  pick('final-replay.mp4', video);
  owner.dropNextResponse((o) => o.method === 'PUT' && /\/chunks\/1$/.test(o.url));
  await page.page.uploadVideo();
  await owner.settle(page);
  assert.equal(page.page.data.request?.state, 'unknown', page.page.data.error);
  const stored = Object.values(owner.wx.storage.get('scb.mediaRequests.v2'))[0];
  assert.match(stored.path, /^wxfile:\/\/usr\/scb-upload-[0-9a-f-]{36}\.mp4$/);
  page.unload();
  page = await openPage();
  assert.equal(page.page.data.request?.state, 'session', page.page.data.error);
  assert.equal(page.page.data.upload.confirmed, 524288 * 2, 'server-confirmed bytes only');
  assert.ok(
    page.page.data.upload.label.includes('（' + 524288 * 2 + ' / ' + video.length + ' 字节）'),
    page.page.data.upload.label,
  );
  await page.page.continueRequest();
  await owner.settle(page);
  assert.equal(page.page.data.upload.stage, 'saved', page.page.data.error);
  assert.equal(page.page.data.request, null);
  const sessions = await q(
    'SELECT id,status,file_id FROM media_upload_sessions WHERE client_request_id=$1',
    [stored.clientRequestId],
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, 'COMPLETED');
  const videoRows = await q('SELECT id FROM media_files WHERE org_id=$1 AND sha256=$2', [
    org,
    sha(video),
  ]);
  assert.deepEqual(videoRows, [{ id: sessions[0].file_id }], 'exactly one assembled file');
  assert.deepEqual(
    (
      await q(
        "SELECT metadata->>'index' AS i FROM audit_logs WHERE action='media.upload_session.chunk' AND resource_id=$1 ORDER BY 1",
        [sessions[0].id],
      )
    ).map((r) => r.i),
    ['0', '1', '2'],
    'each chunk stored once',
  );
  assert.deepEqual(
    await q('SELECT payload IS NULL AS released FROM media_upload_chunks WHERE session_id=$1', [
      sessions[0].id,
    ]),
    [{ released: true }, { released: true }, { released: true }],
  );
  const content = await fetch(
    `${server.url}${root}/matches/${matchId}/media-files/${sessions[0].file_id}/content`,
    {
      headers: { Cookie: ownerCookie },
    },
  );
  assert.ok(Buffer.from(await content.arrayBuffer()).equals(video), 'assembled bytes intact');
  assert.equal(files.has(stored.path), false, 'staged copy released after the final receipt');
  assert.equal(page.page.data.files.length, 2);

  // Account switch clears the page; another account never sees this account's records.
  owner.client.clearSession();
  assert.match(page.page.data.error, /登录身份已变化/);
  assert.equal(page.page.data.request, null);
  page.unload();
});

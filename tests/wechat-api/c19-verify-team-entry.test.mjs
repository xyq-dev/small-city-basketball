import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  device,
  frozenEventFixture,
  organizationFixture,
  register,
  signIn,
  startServer,
  tap,
} from './support.mjs';

// C19 F: long-term team member maintenance (the frozen entry roster never changes) and
// private registration files (upload, read, revoke, isolation), through the real team and
// entry pages -> real API -> owned PostgreSQL. HTTP only prepares the frozen event.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
let server, f, event, leader, leaderDevice, teamA;

before(async () => {
  server = await startServer();
  f = await organizationFixture(server);
  leaderDevice = device(server);
  await register(leaderDevice, 'leader@example.test', '合成领队');
  leader = {
    id: (await leaderDevice.client.request('/v1/auth/session')).data.user.id,
    cookie: await f.login('leader@example.test'),
  };
  event = await frozenEventFixture(f, leader, [
    { name: '合成石鼓青锋', members: ['林甲', '陈乙', '黄丙'] },
    { name: '合成高州猛龙', members: ['周丁', '吴戊', '郑己'] },
  ]);
  teamA = event.teams[0];
});
after(async () => {
  await server?.close();
});

const frozenRoster = async (entryId) =>
  (
    await server.pool.query(
      `SELECT to_jsonb(rp)::text AS row FROM entry_roster_players rp WHERE entry_id=$1 ORDER BY 1`,
      [entryId],
    )
  ).rows.map((r) => r.row);
const members = async (teamId) =>
  (
    await server.pool.query(
      'SELECT id,name,status FROM team_members WHERE team_id=$1 ORDER BY created_at,id',
      [teamId],
    )
  ).rows;

test('team page maintains long-term members; the frozen entry roster stays exactly as frozen', async () => {
  const rosterBefore = await frozenRoster(teamA.entryId);
  assert.equal(rosterBefore.length, 3);
  const freezeBefore = (
    await server.pool.query('SELECT to_jsonb(r)::text AS row FROM registration_freezes r')
  ).rows;
  const original = await members(teamA.id);
  const page = leaderDevice.open('pages/team/index', { orgId: f.org, teamId: teamA.id });
  await leaderDevice.settle(page);
  assert.equal(page.page.data.team?.capabilities.canManage, true, page.page.data.error);
  // A second open copy of the same team (stale after the first save).
  const stale = leaderDevice.open('pages/team/index', { orgId: f.org, teamId: teamA.id });
  await leaderDevice.settle(stale);

  page.page.toggleEdit();
  page.page.memberName(tap({ index: 0 }, { value: '林甲（改名）' }));
  page.page.removeMember(tap({ index: 2 }));
  page.page.addMember();
  page.page.memberName(tap({ index: 2 }, { value: '新成员庚' }));
  leaderDevice.approve();
  await page.page.save(tap({ mode: 'members' }));
  await leaderDevice.settle(page);
  assert.equal(page.page.data.error, '', page.page.data.error);
  assert.match(page.page.data.message, /长期成员已保存/);
  const saved = await members(teamA.id);
  const byId = new Map(saved.map((m) => [m.id, m]));
  // Kept members keep their identity; the removed one is archived; the new one is added.
  assert.deepEqual(byId.get(original[0].id), { ...original[0], name: '林甲（改名）' });
  assert.deepEqual(byId.get(original[1].id), original[1]);
  assert.equal(byId.get(original[2].id).status, 'ARCHIVED');
  const added = saved.filter((m) => !original.some((o) => o.id === m.id));
  assert.deepEqual(
    added.map((m) => [m.name, m.status]),
    [['新成员庚', 'ACTIVE']],
  );
  // The request carried the existing member ids, never client-made ids for new members.
  const put = leaderDevice.wx.calls.filter(
    (c) =>
      c.type === 'request' && c.method === 'PUT' && c.url.endsWith(`/teams/${teamA.id}/members`),
  );
  assert.equal(put.length, 1);
  assert.deepEqual(
    put[0].data.members.map((m) => m.id ?? null),
    [original[0].id, original[1].id, null],
  );

  // The frozen entry roster and the freeze record are untouched (names, members, jerseys).
  assert.deepEqual(await frozenRoster(teamA.entryId), rosterBefore);
  assert.deepEqual(
    (await server.pool.query('SELECT to_jsonb(r)::text AS row FROM registration_freezes r')).rows,
    freezeBefore,
  );
  const entry = leaderDevice.open('pages/entry/index', { orgId: f.org, entryId: teamA.entryId });
  await leaderDevice.settle(entry);
  const api = (await f.call(`${f.root}/entries/${teamA.entryId}`, { cookie: leader.cookie })).data;
  assert.deepEqual(
    api.players.map((p) => p.name).sort(),
    ['林甲', '陈乙', '黄丙'].sort(),
    'the frozen roster keeps the names it was frozen with',
  );
  entry.unload();

  // The stale copy cannot overwrite: its save is refused by version and nothing changes.
  stale.page.toggleEdit();
  stale.page.memberName(tap({ index: 1 }, { value: '过期覆盖' }));
  leaderDevice.approve();
  await stale.page.save(tap({ mode: 'members' }));
  await leaderDevice.settle(stale);
  assert.notEqual(stale.page.data.error, '', 'stale save reports a conflict');
  assert.deepEqual(await members(teamA.id), saved);

  // Someone without a grant for this team cannot read or change it.
  const stranger = device(server);
  await register(stranger, 'stranger@example.test', '合成路人');
  const denied = stranger.open('pages/team/index', { orgId: f.org, teamId: teamA.id });
  await stranger.settle(denied);
  assert.equal(denied.page.data.team, null);
  assert.notEqual(denied.page.data.error, '');
  page.unload();
  stale.unload();
});

test('entry page: private file upload, read, revoke, and isolation between teams and roles', async () => {
  const d = leaderDevice;
  const temp = new Map(),
    previewed = [];
  d.wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  d.wx.chooseMessageFile = (o) =>
    o.success({
      tempFiles: [{ path: 'wxfile://tmp/insurance.png', size: PNG.length, name: 'insurance.png' }],
    });
  d.wx.getFileSystemManager = () => ({
    readFile: (o) => o.success({ data: PNG.toString('base64') }),
    writeFile: (o) => {
      temp.set(o.filePath, Buffer.from(o.data));
      o.success();
    },
    unlink: (o) => {
      temp.delete(o.filePath);
      o.success?.();
    },
  });
  d.wx.previewImage = (o) => {
    previewed.push(temp.get(o.current));
    o.success();
  };
  const entry = d.open('pages/entry/index', {
    orgId: f.org,
    entryId: teamA.entryId,
    stage: 'documents',
  });
  await d.settle(entry);
  assert.equal(
    entry.page.data.fileWorkspace?.capabilities.canUpload,
    true,
    entry.page.data.fileError,
  );
  entry.page.fileConsent(tap({}, { value: ['yes'] }));
  await entry.page.upload();
  await d.settle(entry);
  assert.equal(entry.page.data.fileError, '', entry.page.data.fileError);
  assert.equal(entry.page.data.files.length, 1);
  const file = entry.page.data.files[0];
  assert.equal(file.status, 'ACTIVE');
  const row = (
    await server.pool.query(
      'SELECT purpose,content_type,byte_length,octet_length(payload) AS stored,entry_id FROM media_files WHERE id=$1',
      [file.id],
    )
  ).rows[0];
  assert.deepEqual(row, {
    purpose: 'PRIVATE_INSURANCE',
    content_type: 'image/png',
    byte_length: PNG.length,
    stored: PNG.length,
    entry_id: teamA.entryId,
  });

  // Read: the bytes reach the preview through a temporary file that is removed on hide.
  await entry.page.viewFile(tap({ id: file.id }));
  await d.settle(entry);
  assert.ok(previewed[0]?.equals(PNG), 'private bytes previewed: ' + entry.page.data.fileError);
  entry.page.onHide();
  assert.equal(temp.size, 0, 'temporary copies are removed');
  entry.page.onShow();
  await d.settle(entry);

  const content = `${f.root}/entries/${teamA.entryId}/media-files/${file.id}/content`;
  const raw = (cookie) =>
    fetch(server.url + content, {
      headers: { Origin: 'https://basketball.playhubs.cn', Cookie: cookie },
    });
  // Isolation: anonymous, a stranger, and another team's leader cannot list or read it.
  assert.equal((await fetch(server.url + content)).status, 401);
  const otherLeaderDevice = device(server);
  await register(otherLeaderDevice, 'leader2@example.test', '合成乙领队');
  const otherLeader = {
    id: (await otherLeaderDevice.client.request('/v1/auth/session')).data.user.id,
    cookie: await f.login('leader2@example.test'),
  };
  const teamC = (
    await f.call(`${f.root}/teams`, {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { name: '合成另一队' },
    })
  ).data;
  const issued = (
    await f.call(`${f.root}/teams/${teamC.id}/invitations`, {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { targetUserId: otherLeader.id, expiresInHours: 1 },
    })
  ).data;
  await f.call(`/v1/invitations/${issued.invitation.id}/accept`, {
    method: 'POST',
    cookie: otherLeader.cookie,
    body: { token: issued.token },
  });
  assert.equal((await raw(otherLeader.cookie)).status, 404);
  const foreign = otherLeaderDevice.open('pages/entry/index', {
    orgId: f.org,
    entryId: teamA.entryId,
  });
  await otherLeaderDevice.settle(foreign);
  assert.equal(foreign.page.data.entry, null);
  assert.deepEqual(foreign.page.data.files, []);
  foreign.unload();
  // The organizer (administrator) may read it.
  assert.equal((await raw(f.ownerCookie)).status, 200);

  // Revoke through the page with a reason; reads stop for everyone, the row keeps its record.
  entry.page.reason(tap({}, { value: '误传的保险凭证' }));
  d.approve();
  await entry.page.revoke(tap({ id: file.id }));
  await d.settle(entry);
  assert.equal(entry.page.data.fileError, '', entry.page.data.fileError);
  assert.equal(entry.page.data.files[0].status, 'REVOKED');
  const revoked = (
    await server.pool.query(
      'SELECT revoked_at IS NOT NULL AS revoked FROM media_files WHERE id=$1',
      [file.id],
    )
  ).rows[0];
  assert.equal(revoked.revoked, true);
  for (const cookie of [leader.cookie, f.ownerCookie])
    assert.ok([404, 410].includes((await raw(cookie)).status));
  previewed.length = 0;
  await entry.page.viewFile(tap({ id: file.id }));
  assert.equal(previewed.length, 0, 'a revoked file cannot be opened from the page');

  // Account switch clears the private file list.
  const account = d.open('pages/account/index');
  await d.settle(account);
  account.page.switchAccount();
  await d.settle(account);
  entry.page.onShow();
  await d.settle(entry);
  assert.deepEqual(entry.page.data.files, []);
  entry.unload();
});

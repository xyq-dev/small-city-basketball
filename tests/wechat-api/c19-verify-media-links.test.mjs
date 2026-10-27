import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  device,
  enableViewingFixture,
  frozenEventFixture,
  organizationFixture,
  publishedEventFixture,
  register,
  signIn,
  startServerWith,
  tap,
} from './support.mjs';

// C19 F: trusted external media links through the real match-media page -> real API -> owned
// PostgreSQL. The isolated service gets a SYNTHETIC trusted host list (createApi `media`
// option); no production configuration or video provider is involved. Actual playback inside
// WeChat is a separate device check and is not claimed here.
const TRUSTED = 'media.example.com';
let server, f, event, match, publicEventId, publicMatchId;

before(async () => {
  server = await startServerWith({ media: { trustedExternalHosts: [TRUSTED] } });
  f = await organizationFixture(server);
  const leaderDevice = device(server);
  await register(leaderDevice, 'leader@example.test', '合成领队');
  const leader = {
    id: (await leaderDevice.client.request('/v1/auth/session')).data.user.id,
    cookie: await f.login('leader@example.test'),
  };
  event = await frozenEventFixture(f, leader, [
    { name: '合成石鼓青锋', members: ['甲一', '甲二', '甲三'] },
    { name: '合成高州猛龙', members: ['乙一', '乙二', '乙三'] },
  ]);
  [match] = await publishedEventFixture(f, event);
  publicEventId = await enableViewingFixture(f, event);
  publicMatchId = (await f.call(`/v1/public/events/${publicEventId}/schedule?limit=50`)).data[0]
    .publicMatchId;
});
after(async () => {
  await server?.close();
});

const mediaRows = async () =>
  (
    await server.pool.query(
      'SELECT id,kind,status,external_url,title,version FROM match_media WHERE match_id=$1 ORDER BY created_at',
      [match.id],
    )
  ).rows;

test('trusted external link: illegal links refused by page and server, then create, publish, revoke', async () => {
  const owner = device(server);
  await signIn(owner, 'owner@example.test');
  const page = owner.open('pages/match-media/index', { orgId: f.org, matchId: match.id });
  await owner.settle(page);
  assert.equal(page.page.data.caps.manage, true, page.page.data.error);
  assert.deepEqual(page.page.data.trustedHosts, [TRUSTED], 'synthetic host list reaches the page');
  page.page.setDraftMode(tap({ mode: 'LINK' }));
  assert.equal(page.page.data.draftMode, 'LINK');
  page.page.titleInput(tap({}, { value: '决赛直播回看' }));
  page.page.rightsInput(tap({}, { value: '主办方自有直播间，仅限本届公开观赛' }));

  const illegal = [
    'http://media.example.com/live/1',
    'https://evil.example.org/live/1',
    'https://media.example.com:8443/live/1',
    'https://user@media.example.com/live/1',
    'https://media.example.com/live/1#t=10',
    'https://127.0.0.1/live/1',
    'https://localhost/live/1',
    'javascript:alert(1)',
  ];
  const posts = () =>
    owner.wx.calls.filter(
      (c) => c.type === 'request' && c.method === 'POST' && /\/media$/.test(c.url),
    ).length;
  for (const url of illegal) {
    page.page.externalInput(tap({}, { value: url }));
    await page.page.createDraft();
    assert.match(page.page.data.error, /受信列表/, url);
  }
  assert.equal(posts(), 0, 'no illegal link ever leaves the page');
  // The server enforces the same rule independently of the page (direct request, same session).
  for (const url of illegal) {
    const response = await f.call(`${f.root}/matches/${match.id}/media`, {
      method: 'POST',
      cookie: f.ownerCookie,
      body: {
        kind: 'EXTERNAL_LINK',
        title: '非法',
        externalUrl: url,
        rightsDeclaration: '合成权利声明',
      },
      expect: [422],
    });
    assert.equal(response.status, 422, url);
  }
  assert.deepEqual(await mediaRows(), [], 'nothing stored for any illegal link');

  // A legal trusted link creates a private draft.
  const legal = `https://${TRUSTED}/live/final?replay=1`;
  page.page.externalInput(tap({}, { value: '  ' + legal + '  ' }));
  await page.page.createDraft();
  await owner.settle(page);
  assert.equal(page.page.data.error, '', page.page.data.error);
  assert.equal(posts(), 1, 'exactly one create request');
  const draft = page.page.data.items.find((m) => m.externalUrl === legal);
  assert.equal(draft?.status, 'DRAFT');
  let rows = await mediaRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].kind, rows[0].status, rows[0].external_url],
    ['EXTERNAL_LINK', 'DRAFT', legal],
  );

  // Public: an anonymous spectator page sees nothing while it is a draft.
  const spectator = device(server);
  const publicPage = () =>
    spectator.open('pages/match/index', { event: publicEventId, match: publicMatchId });
  let watch = publicPage();
  await spectator.settle(watch);
  assert.ok(watch.page.data.snapshot, watch.page.data.error);
  assert.deepEqual(watch.page.data.media, [], 'a draft link is not public');
  watch.unload();

  owner.approve();
  await page.page.publish(tap({ id: draft.id }));
  await owner.settle(page);
  assert.equal(
    page.page.data.items.find((m) => m.id === draft.id).status,
    'PUBLISHED',
    page.page.data.error,
  );
  watch = publicPage();
  await spectator.settle(watch);
  assert.deepEqual(
    watch.page.data.media.map((m) => [m.kind, m.title, m.externalUrl]),
    [['EXTERNAL_LINK', '决赛直播回看', legal]],
  );
  watch.unload();

  owner.approve();
  await page.page.revoke(tap({ id: draft.id }));
  await owner.settle(page);
  assert.equal(page.page.data.items.find((m) => m.id === draft.id).status, 'REVOKED');
  rows = await mediaRows();
  assert.equal(rows[0].status, 'REVOKED');
  watch = publicPage();
  await spectator.settle(watch);
  assert.deepEqual(watch.page.data.media, [], 'revoked link disappears publicly');
  watch.unload();
  assert.equal(
    spectator.wx.calls.some((c) => c.type === 'request' && c.url.includes('/v1/orgs/')),
    false,
    'the spectator never calls private endpoints',
  );

  // A revoked link cannot be published again.
  const republish = await f.call(`${f.root}/matches/${match.id}/media/${draft.id}/commands`, {
    method: 'POST',
    cookie: f.ownerCookie,
    body: { type: 'PUBLISH', expectedVersion: (await mediaRows())[0].version },
    expect: [409, 422],
  });
  assert.ok([409, 422].includes(republish.status));

  // Permission isolation: a signed-in participant outside the organization cannot manage it.
  const stranger = device(server);
  await register(stranger, 'stranger@example.test', '合成路人');
  const denied = stranger.open('pages/match-media/index', { orgId: f.org, matchId: match.id });
  await stranger.settle(denied);
  assert.equal(denied.page.data.unavailable, true, JSON.stringify(denied.page.data.caps));
  page.unload();
});

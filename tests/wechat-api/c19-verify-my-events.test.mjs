import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, device, http, signIn, startServerWith } from './support.mjs';

// C19 F: "我的赛事" (watch tab) through the real page -> real API -> owned PostgreSQL:
// multi-page reading (50 per page), the 500-per-organization truncation notice, and a later
// page failing without discarding the pages already read. Events are prepared over HTTP
// (fixture); every assertion about the list is about what the real page requested and showed.
let server, call, orgA, orgB, cookieA, cookieB, viewerId;

async function createEvents(root, cookie, count, prefix) {
  for (let i = 0; i < count; i++) {
    const day = String((i % 27) + 1).padStart(2, '0');
    await call(`${root}/events`, {
      method: 'POST',
      cookie,
      body: {
        name: `${prefix}${String(i + 1).padStart(3, '0')}`,
        startDate: `2029-03-${day}`,
        endDate: `2029-03-${day}`,
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
        venueName: '合成体育馆',
      },
    });
  }
}

before(async () => {
  // Organization self-registration on the isolated service only, to own a second organization.
  server = await startServerWith({ organizationRegistrationEnabled: true });
  call = http(server);
  const a = await server.bootstrapOwner({
    email: 'owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成甲机构',
  });
  orgA = a.organizationId;
  viewerId = a.userId;
  const b = await call('/v1/auth/register', {
    method: 'POST',
    body: {
      email: 'other@example.test',
      password: PASSWORD,
      displayName: '合成乙负责人',
      organizationName: '合成乙机构',
    },
  });
  orgB = b.data.organizations[0].id;
  const login = async (email) =>
    (await call('/v1/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).cookie;
  cookieA = await login('owner@example.test');
  cookieB = await login('other@example.test');
  // The viewer also administers organization B.
  await call(`/v1/orgs/${orgB}/members/${viewerId}`, {
    method: 'PUT',
    cookie: cookieB,
    body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
  });
  await createEvents(`/v1/orgs/${orgA}`, cookieA, 501, '合成甲赛事');
  await createEvents(`/v1/orgs/${orgB}`, cookieB, 60, '合成乙赛事');
});
after(async () => {
  await server?.close();
});

test('my events: 10 pages per organization, 500 truncation, and a failed later page keeps read rows', async () => {
  const d = device(server);
  await signIn(d, 'owner@example.test');
  const eventRequests = (org) =>
    d.wx.calls.filter(
      (c) => c.type === 'request' && c.url.includes(`/v1/orgs/${org}/events?limit=50`),
    );
  // The second page of organization B is applied by the server but its response is lost.
  d.dropNextResponse((o) => o.url.includes(`/v1/orgs/${orgB}/events?limit=50&cursor=`));
  const watch = d.open('pages/watch/index');
  await d.settle(watch, 60000);
  const data = watch.page.data;
  assert.equal(data.signedIn, true, data.eventsError);
  assert.equal(eventRequests(orgA).length, 10, 'exactly 10 pages read for organization A');
  assert.ok(
    eventRequests(orgA)
      .slice(1)
      .every((c) => /&cursor=/.test(c.url)),
    'later pages follow the server cursor',
  );
  assert.deepEqual(data.truncated, ['合成甲机构'], 'organization A is named as truncated');
  assert.equal(eventRequests(orgB).length, 2);
  assert.equal(data.failures.length, 1);
  assert.equal(data.failures[0].orgName, '合成乙机构');
  assert.match(data.failures[0].message, /后续赛事读取未完成，仅显示已读取的 50 届/);
  const shown = data.sections.flatMap((s) => s.events);
  const byOrg = (org) => shown.filter((e) => e.orgId === org);
  assert.equal(byOrg(orgA).length, 500, 'first 500 of 501');
  assert.equal(byOrg(orgB).length, 50, 'the page read before the failure is kept');
  assert.equal(data.total, 550);
  assert.equal(new Set(shown.map((e) => e.key)).size, 550, 'no duplicates across pages');
  // The 500 shown for A are exactly the newest-first first 500 server rows.
  const serverA = (
    await server.pool.query('SELECT count(*)::int n FROM events WHERE org_id=$1', [orgA])
  ).rows[0].n;
  assert.equal(serverA, 501);
  const first500 = (
    await server.pool.query(
      'SELECT id FROM events WHERE org_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500',
      [orgA],
    )
  ).rows
    .map((e) => e.id)
    .sort();
  assert.deepEqual(
    byOrg(orgA)
      .map((e) => e.id)
      .sort(),
    first500,
    'the displayed set is exactly the first 500 rows, not just any 500 distinct events',
  );

  // Refresh without loss: B is complete (60), A still truncated at 500.
  watch.page.onShow();
  await d.settle(watch, 60000);
  const again = watch.page.data;
  assert.deepEqual(again.failures, []);
  assert.deepEqual(again.truncated, ['合成甲机构']);
  assert.equal(again.sections.flatMap((s) => s.events).filter((e) => e.orgId === orgB).length, 60);
  assert.equal(again.total, 560);

  // Losing access in the middle: B removes the viewer; B now fails as a permission error and A
  // is unaffected.
  await call(`/v1/orgs/${orgB}/members/${viewerId}`, {
    method: 'PUT',
    cookie: cookieB,
    body: { role: 'ORG_ADMIN', status: 'DISABLED' },
  });
  watch.page.onShow();
  await d.settle(watch, 60000);
  const revoked = watch.page.data;
  assert.equal(
    revoked.sections.flatMap((s) => s.events).filter((e) => e.orgId === orgB).length,
    0,
    'no rows from an organization the viewer can no longer see',
  );
  assert.equal(revoked.total, 500, JSON.stringify(revoked.failures));

  // Account switch clears the private list immediately.
  const account = d.open('pages/account/index');
  await d.settle(account);
  account.page.switchAccount();
  await d.settle(account);
  assert.deepEqual(watch.page.data.sections, []);
  assert.equal(watch.page.data.total, 0);
  assert.equal(watch.page.data.signedIn, false);
});

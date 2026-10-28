import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, device, http, register, signIn, snapshot, startServer } from './support.mjs';

// C19 follows against the real API: the actual event and follows pages run in the VM harness,
// every wx.request reaches a loopback API on an owned isolated PostgreSQL database. The public
// event itself is prepared over HTTP as a fixture (organizer Web steps); every follow, list,
// cancel and account switch is a page interaction, checked against the database rows.
let server, call, org, ownerCookie, leaderCookie, leaderId;

before(async () => {
  server = await startServer();
  call = http(server);
  const owner = await server.bootstrapOwner({
    email: 'owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成关注篮协',
  });
  org = owner.organizationId;
  ownerCookie = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.test', password: PASSWORD },
    })
  ).cookie;
  const leader = await call('/v1/auth/register-participant', {
    method: 'POST',
    body: { email: 'leader@example.test', password: PASSWORD, displayName: '合成领队' },
  });
  leaderCookie = leader.cookie;
  leaderId = leader.data.user.id;
});
after(async () => {
  await server?.close();
});

/** Fixture: a two-team round robin with locked standings and LIVE public viewing. */
async function publicEvent(name) {
  const root = `/v1/orgs/${org}`;
  const as = (cookie) => ({ cookie });
  let event = (
    await call(`${root}/events`, {
      method: 'POST',
      ...as(ownerCookie),
      body: {
        name,
        startDate: '2029-05-01',
        endDate: '2029-05-03',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
        venueName: '合成体育馆',
      },
    })
  ).data;
  const eventPath = `${root}/events/${event.id}`;
  let reg = (
    await call(`${eventPath}/registration-rules`, {
      method: 'PUT',
      ...as(ownerCookie),
      body: {
        expectedVersion: event.version,
        minPlayers: 2,
        maxPlayers: 2,
        zeroAndDoubleZeroDistinct: false,
        requireIdentity: false,
        requireInsurance: false,
      },
    })
  ).data;
  const regCommand = async (type) =>
    (reg = (
      await call(`${eventPath}/registration-commands`, {
        method: 'POST',
        ...as(ownerCookie),
        body: { type, expectedVersion: reg.event.version },
      })
    ).data);
  await regCommand('OPEN_REGISTRATION');
  for (const label of ['甲队', '乙队']) {
    let team = (
      await call(`${root}/teams`, {
        method: 'POST',
        ...as(ownerCookie),
        body: { name: `${name}${label}` },
      })
    ).data;
    team = (
      await call(`${root}/teams/${team.id}/members`, {
        method: 'PUT',
        ...as(ownerCookie),
        body: { expectedVersion: team.version, members: [{ name: '合成一' }, { name: '合成二' }] },
      })
    ).data;
    await call(`${root}/teams/${team.id}/grants/${leaderId}`, {
      method: 'PUT',
      ...as(ownerCookie),
      body: { status: 'ACTIVE' },
    });
    let entry = (
      await call(`${eventPath}/entries`, {
        method: 'POST',
        ...as(leaderCookie),
        body: { teamId: team.id },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/roster`, {
        method: 'PUT',
        ...as(leaderCookie),
        body: {
          expectedVersion: entry.version,
          players: team.members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 1) })),
        },
      })
    ).data;
    for (const [type, cookie] of [
      ['SUBMIT', leaderCookie],
      ['APPROVE', ownerCookie],
    ])
      entry = (
        await call(`${root}/entries/${entry.id}/commands`, {
          method: 'POST',
          ...as(cookie),
          body: { type, expectedVersion: entry.version },
        })
      ).data;
  }
  await regCommand('CLOSE_REGISTRATION');
  await regCommand('FREEZE_REGISTRATION');
  const court = (
    await call(`${root}/courts`, {
      method: 'POST',
      ...as(ownerCookie),
      body: { name: `${name}场地` },
    })
  ).data;
  let schedule = (
    await call(`${eventPath}/schedule-revisions`, {
      method: 'POST',
      ...as(ownerCookie),
      body: {
        expectedEventVersion: reg.event.version,
        freezeId: reg.freeze.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 0,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2029-05-01T00:00:00+08:00',
              endsAt: '2029-05-04T02:00:00+08:00',
            },
          ],
        },
      },
    })
  ).data;
  const versions = () => ({
    expectedEventVersion: schedule.eventVersion,
    expectedRevisionVersion: schedule.version,
  });
  schedule = (
    await call(`${root}/schedule-revisions/${schedule.id}/allocations`, {
      method: 'PUT',
      ...as(ownerCookie),
      body: {
        ...versions(),
        allocations: schedule.fixtures.map((f, i) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: new Date(Date.parse('2029-05-01T09:00:00+08:00') + i * 3600000).toISOString(),
        })),
      },
    })
  ).data;
  const published = (
    await call(`${root}/schedule-revisions/${schedule.id}/publish`, {
      method: 'POST',
      ...as(ownerCookie),
      body: versions(),
    })
  ).data;
  await call(`${eventPath}/scoring-rules`, {
    method: 'PUT',
    ...as(ownerCookie),
    body: {
      expectedEventVersion: published.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 1,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'ALLOW_DRAW',
      overtimeDurationSeconds: null,
    },
  });
  const standings = async () => (await call(`${eventPath}/standings`, as(ownerCookie))).data;
  await call(`${eventPath}/standings-rules`, {
    method: 'PUT',
    ...as(ownerCookie),
    body: {
      expectedEventVersion: (await standings()).event.version,
      winPoints: 3,
      lossPoints: 0,
      drawPoints: 1,
      tiebreakers: [],
    },
  });
  const saved = await standings();
  await call(`${eventPath}/standings-rule-commands`, {
    method: 'POST',
    ...as(ownerCookie),
    body: {
      type: 'PUBLISH_STANDINGS_RULES',
      rulesetId: saved.rules.id,
      expectedEventVersion: saved.event.version,
    },
  });
  event = { id: event.id, path: eventPath };
  return { ...event, publicEventId: await viewing(event, 'ENABLE'), standings };
}
async function viewing(event, type) {
  const current = (await call(`${event.path}/standings`, { cookie: ownerCookie })).data;
  const result = (
    await call(`${event.path}/public-viewing-commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type, expectedEventVersion: current.event.version },
    })
  ).data;
  return result.publication?.status === 'ACTIVE' ? result.publication.publicEventId : null;
}
const followRows = async (email) =>
  (
    await server.pool.query(
      `SELECT f.id,f.status,p.public_event_id FROM event_follows f JOIN users u ON u.id=f.user_id
       JOIN public_event_publications p ON p.id=f.publication_id WHERE u.email=$1 ORDER BY f.created_at,f.id`,
      [email],
    )
  ).rows;
const requestsOf = (d) => d.wx.calls.filter((c) => c.type === 'request');

test('follow from a shared public event, list it, survive revocation as invalid, cancel, switch account', async () => {
  const ev = await publicEvent('合成关注杯');

  // A signed-out spectator: the public page works cookie-less and only offers sign-in.
  const spectator = device(server);
  const anon = spectator.open('pages/event/index', { event: ev.publicEventId });
  await spectator.settle(anon);
  assert.equal(anon.page.data.event?.name, '合成关注杯', anon.page.data.error);
  assert.equal(anon.page.data.follow.state, 'signedOut');
  for (const c of requestsOf(spectator)) {
    assert.ok(!c.url.includes('/v1/me/'), 'no private request when signed out: ' + c.url);
    assert.equal(c.header.Cookie, undefined);
  }

  // The fan opens the shared link signed in and follows through the page.
  const fan = device(server);
  await register(fan, 'fan@example.test', '合成球迷');
  const page = fan.open('pages/event/index', { event: ev.publicEventId });
  await fan.settle(page);
  assert.equal(page.page.data.follow.state, 'none', page.page.data.follow.error);
  fan.approve();
  await page.page.followEvent();
  await fan.settle(page);
  assert.equal(page.page.data.follow.state, 'active', page.page.data.follow.error);
  assert.match(page.page.data.follow.notice, /关注成功/);
  assert.match(page.page.data.reminderOff, /微信提醒未启用/);
  snapshot(page, 'c19-event-followed');
  let rows = await followRows('fan@example.test');
  assert.deepEqual(
    rows.map((r) => [r.status, r.public_event_id]),
    [['ACTIVE', ev.publicEventId]],
  );
  // Following again from the page is refused locally (already active) and writes nothing.
  await page.page.followEvent();
  assert.equal((await followRows('fan@example.test')).length, 1);

  // My follows lists it with the public whitelist.
  const list = fan.open('pages/follows/index');
  await fan.settle(list);
  assert.deepEqual(
    list.page.data.items.map((i) => [i.status, i.event?.name, i.publicEventId]),
    [['ACTIVE', '合成关注杯', ev.publicEventId]],
  );
  snapshot(list, 'c19-follows-active');

  // The organizer revokes public viewing (Web step).
  assert.equal(await viewing(ev, 'DISABLE'), null);
  await list.page.load();
  await fan.settle(list);
  assert.deepEqual(
    list.page.data.items.map((i) => [i.status, i.event]),
    [['INVALID', null]],
  );
  assert.ok(!JSON.stringify(list.page.data).includes('合成关注杯'), 'no withdrawn details');
  snapshot(list, 'c19-follows-invalid');
  // The old link stops working; the event page offers only "my follows".
  const old = fan.open('pages/event/index', { event: ev.publicEventId });
  await fan.settle(old);
  assert.equal(old.page.data.unavailable, true);
  assert.equal(old.page.data.event, null);
  assert.equal(old.page.data.follow.state, 'unavailable');

  // Cancel the invalid follow from my follows.
  fan.approve();
  await list.page.cancel({ currentTarget: { dataset: { id: rows[0].id } } });
  await fan.settle(list);
  assert.deepEqual(list.page.data.items, [], list.page.data.error);
  rows = await followRows('fan@example.test');
  assert.deepEqual(
    rows.map((r) => r.status),
    ['CANCELLED'],
  );

  // Re-enabling makes a new key; it inherits nothing, the page shows "not followed".
  const newKey = await viewing(ev, 'ENABLE');
  assert.notEqual(newKey, ev.publicEventId);
  const renewed = fan.open('pages/event/index', { event: newKey });
  await fan.settle(renewed);
  assert.equal(renewed.page.data.follow.state, 'none');
  fan.approve();
  await renewed.page.followEvent();
  await fan.settle(renewed);
  assert.equal(renewed.page.data.follow.state, 'active');
  await list.page.load();
  await fan.settle(list);
  assert.equal(list.page.data.items.length, 1);

  // Switching account on this device clears the list and the event follow block for the new one.
  const other = device(server);
  await register(other, 'fan2@example.test', '合成球迷二');
  const before = requestsOf(fan).length;
  await signIn(fan, 'fan2@example.test');
  assert.deepEqual(list.page.data.items, [], 'cleared on the account change');
  await fan.settle(list);
  await fan.settle(renewed);
  assert.deepEqual(list.page.data.items, []);
  assert.equal(renewed.page.data.follow.state, 'none');
  assert.equal(renewed.page.data.follow.followId, '');
  const after = requestsOf(fan).slice(before);
  const listReads = after.filter((c) => c.url.includes('/v1/me/follows'));
  assert.ok(listReads.length >= 2, 'the new account re-read its own follows');
  assert.equal(
    after.filter((c) => (c.method || 'GET') === 'POST' && c.url.includes('/v1/me/follows')).length,
    0,
    'no follow write on the account change',
  );
  // fan's follow is untouched; fan2 owns nothing.
  assert.deepEqual(
    (await followRows('fan@example.test')).map((r) => r.status),
    ['CANCELLED', 'ACTIVE'],
  );
  assert.deepEqual(await followRows('fan2@example.test'), []);
});

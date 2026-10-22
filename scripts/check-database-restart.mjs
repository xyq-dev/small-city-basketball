import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createApi } from '../apps/api/dist/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/^scb_test_[A-Za-z0-9_]+$/.test(new URL(databaseUrl).pathname.slice(1))) {
  throw new Error(
    'Database restart check requires TEST_DATABASE_URL with an isolated scb_test_* database',
  );
}
const stateFile = process.env.SCB_PERSISTENCE_FILE;
if (!stateFile)
  throw new Error('SCB_PERSISTENCE_FILE must be a private temporary file outside the repository');
const mode = process.argv[2];
if (!['capture', 'verify'].includes(mode)) throw new Error('Use capture or verify');
const instance = await createApi({ databaseUrl, appOrigin: 'http://127.0.0.1:5173' });
await instance.app.listen(0, '127.0.0.1');
const baseUrl = await instance.app.getUrl();
async function call(route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(baseUrl + route, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:5173',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `Restart check ${method} ${route} returned ${response.status}`);
  return { response, data: (await response.json()).data };
}
async function fingerprint() {
  const hash = createHash('sha256');
  for (const [table, order] of [
    ['users', 'id'],
    ['organizations', 'id'],
    ['organization_memberships', 'org_id,user_id'],
    ['sessions', 'id'],
    ['events', 'id'],
    ['event_staff', 'org_id,event_id,user_id'],
    ['teams', 'id'],
    ['team_members', 'id'],
    ['team_access_grants', 'org_id,team_id,user_id'],
    ['team_invitations', 'id'],
    ['event_rulesets', 'id'],
    ['entries', 'id'],
    ['entry_roster_revisions', 'id'],
    ['entry_roster_players', 'org_id,revision_id,member_id'],
    ['entry_review_history', 'id'],
    ['registration_freezes', 'id'],
    ['courts', 'id'],
    ['org_schedule_mutex', 'org_id'],
    ['schedule_revisions', 'id'],
    ['schedule_fixtures', 'org_id,revision_id,fixture_key'],
    ['schedule_publications', 'id'],
    ['published_matches', 'id'],
    ['court_reservations', 'org_id,match_id'],
    ['team_reservations', 'org_id,team_id,match_id'],
    ['audit_logs', 'id'],
    ['schema_migrations', 'name'],
  ]) {
    // Table and order names are fixed source constants; no request input is interpolated.
    const rows = await instance.pool.query(`SELECT * FROM ${table} ORDER BY ${order}`);
    hash.update(table + '\n' + JSON.stringify(rows.rows) + '\n');
  }
  return hash.digest('hex');
}
async function captureRegistration(orgId, ownerCookie, suffix) {
  const root = `/v1/orgs/${orgId}`;
  const leader = await call('/v1/auth/register-participant', {
    method: 'POST',
    body: {
      email: `restart-leader-${suffix}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: '重启验证领队',
    },
  });
  assert.deepEqual(leader.data.organizations, []);
  const leaderCookie = leader.response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(leaderCookie, 'Participant registration must create a persistent session');
  const event = await call(`${root}/events`, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      name: `冻结重启验证-${suffix}`,
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      timezone: 'Asia/Shanghai',
      format: 'ROUND_ROBIN',
    },
  });
  const path = `${root}/events/${event.data.id}`;
  let workspace = (
    await call(`${path}/registration-rules`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        expectedVersion: event.data.version,
        minPlayers: 2,
        maxPlayers: 3,
        zeroAndDoubleZeroDistinct: true,
        requireIdentity: false,
        requireInsurance: false,
      },
    })
  ).data;
  async function eventCommand(type) {
    workspace = (
      await call(`${path}/registration-commands`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { type, expectedVersion: workspace.event.version },
      })
    ).data;
  }
  await eventCommand('OPEN_REGISTRATION');
  const entries = [];
  const teams = [];
  for (let index = 0; index < 2; index += 1) {
    let team = (
      await call(`${root}/teams`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { name: `重启验证球队${index + 1}` },
      })
    ).data;
    team = (
      await call(`${root}/teams/${team.id}/members`, {
        method: 'PUT',
        cookie: ownerCookie,
        body: {
          expectedVersion: team.version,
          members: [{ name: '合成球员甲' }, { name: '合成球员乙' }],
        },
      })
    ).data;
    teams.push(team);
    const issued = await call(`${root}/teams/${team.id}/invitations`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { targetUserId: leader.data.user.id, expiresInHours: 1 },
    });
    await call(`/v1/invitations/${issued.data.invitation.id}/accept`, {
      method: 'POST',
      cookie: leaderCookie,
      body: { token: issued.data.token },
    });
    let entry = (
      await call(`${path}/entries`, {
        method: 'POST',
        cookie: leaderCookie,
        body: { teamId: team.id },
      })
    ).data;
    const entryPath = `${root}/entries/${entry.id}`;
    entry = (
      await call(`${entryPath}/roster`, {
        method: 'PUT',
        cookie: leaderCookie,
        body: {
          expectedVersion: entry.version,
          players: team.members.map((member, memberIndex) => ({
            memberId: member.id,
            jerseyNo: memberIndex === 0 ? '0' : '00',
          })),
        },
      })
    ).data;
    entry = (
      await call(`${entryPath}/commands`, {
        method: 'POST',
        cookie: leaderCookie,
        body: { type: 'SUBMIT', expectedVersion: entry.version },
      })
    ).data;
    await call(`${entryPath}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'APPROVE', expectedVersion: entry.version },
    });
    entries.push((await call(entryPath, { cookie: ownerCookie })).data);
  }
  // Each new entry is serialized on the event but does not change its command version.
  workspace = (await call(`${path}/registration`, { cookie: ownerCookie })).data;
  await eventCommand('CLOSE_REGISTRATION');
  await eventCommand('FREEZE_REGISTRATION');
  assert.equal(workspace.freeze.entries.length, 2);
  const snapshot = structuredClone(workspace.freeze);
  const team = teams[0];
  await call(`${root}/teams/${team.id}/members`, {
    method: 'PUT',
    cookie: leaderCookie,
    body: {
      expectedVersion: team.version,
      members: team.members.map((member) => ({ id: member.id, name: '更名后的合成球员' })),
    },
  });
  workspace = (await call(`${path}/registration`, { cookie: ownerCookie })).data;
  assert.deepEqual(workspace.freeze, snapshot, 'Long-term member changes must preserve the freeze');
  // Capabilities change at freeze time; capture the final, authoritative response.
  for (let index = 0; index < entries.length; index += 1) {
    entries[index] = (
      await call(`${root}/entries/${entries[index].id}`, { cookie: ownerCookie })
    ).data;
  }
  return {
    leaderCookie,
    leaderSession: (await call('/v1/auth/session', { cookie: leaderCookie })).data,
    workspace,
    entries,
  };
}
async function captureScheduling(orgId, cookie, registration) {
  const root = `/v1/orgs/${orgId}`;
  const eventId = registration.workspace.event.id;
  const path = `${root}/events/${eventId}`;
  const court = (
    await call(`${root}/courts`, {
      method: 'POST',
      cookie,
      body: { name: '赛程重启验证球场' },
    })
  ).data;
  let revision = (
    await call(`${path}/schedule-revisions`, {
      method: 'POST',
      cookie,
      body: {
        expectedEventVersion: registration.workspace.event.version,
        freezeId: registration.workspace.freeze.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 30,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2026-12-01T01:00:00.000Z',
              endsAt: '2026-12-01T10:00:00.000Z',
            },
          ],
        },
      },
    })
  ).data;
  assert.equal(revision.fixtures.length, 1);
  assert.deepEqual(revision.source, registration.workspace.freeze);
  const revisionPath = `${root}/schedule-revisions/${revision.id}`;
  revision = (
    await call(`${revisionPath}/allocations`, {
      method: 'PUT',
      cookie,
      body: {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
        allocations: revision.fixtures.map((fixture) => ({
          fixtureKey: fixture.fixtureKey,
          courtId: court.id,
          startsAt: '2026-12-01T01:00:00.000Z',
        })),
      },
    })
  ).data;
  const versions = {
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
  };
  const validation = (
    await call(`${revisionPath}/validate`, { method: 'POST', cookie, body: versions })
  ).data;
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.conflicts, []);
  const publication = (
    await call(`${revisionPath}/publish`, { method: 'POST', cookie, body: versions })
  ).data;
  const workspace = (await call(`${path}/scheduling`, { cookie })).data;
  revision = (await call(revisionPath, { cookie })).data;
  const matches = (await call(`${path}/matches`, { cookie })).data;
  assert.equal(workspace.event.status, 'SCHEDULED');
  assert.equal(revision.status, 'PUBLISHED');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'SCHEDULED');
  assert.equal(matches[0].courtId, court.id);
  assert.equal(matches[0].startsAt, '2026-12-01T01:00:00.000Z');
  assert.equal(matches[0].endsAt, '2026-12-01T02:00:00.000Z');
  const frozenBefore = registration.workspace.freeze;
  registration.workspace = (await call(`${path}/registration`, { cookie })).data;
  assert.deepEqual(registration.workspace.freeze, frozenBefore);
  return { court, workspace, revision, matches, publication };
}
try {
  if (mode === 'capture') {
    const suffix = randomUUID();
    const registration = await call('/v1/auth/register', {
      method: 'POST',
      body: {
        email: `restart-${suffix}@example.test`,
        password: randomBytes(24).toString('base64url'),
        displayName: '重启验证员',
        organizationName: '隔离重启验证机构',
      },
    });
    const cookie = registration.response.headers.getSetCookie()[0]?.split(';')[0];
    assert.ok(cookie, 'Registration must create a server-side session');
    const orgId = registration.data.organizations[0].id;
    const created = await call(`/v1/orgs/${orgId}/events`, {
      method: 'POST',
      cookie,
      body: {
        name: `数据库重启验证-${suffix}`,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    });
    const frozenRegistration = await captureRegistration(orgId, cookie, suffix);
    const scheduling = await captureScheduling(orgId, cookie, frozenRegistration);
    const state = {
      cookie,
      userId: registration.data.user.id,
      orgId,
      event: created.data,
      registration: frozenRegistration,
      scheduling,
      fingerprint: await fingerprint(),
    };
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log(
      'Captured authenticated events, a frozen registration, a published schedule and the isolated database fingerprint.',
    );
  } else {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    const session = await call('/v1/auth/session', { cookie: state.cookie });
    assert.equal(session.data.user.id, state.userId);
    const event = await call(`/v1/orgs/${state.orgId}/events/${state.event.id}`, {
      cookie: state.cookie,
    });
    assert.deepEqual(event.data, state.event);
    const registration = state.registration;
    const teamSession = await call('/v1/auth/session', { cookie: registration.leaderCookie });
    assert.deepEqual(teamSession.data, registration.leaderSession);
    const workspace = await call(
      `/v1/orgs/${state.orgId}/events/${registration.workspace.event.id}/registration`,
      { cookie: state.cookie },
    );
    assert.deepEqual(workspace.data, registration.workspace);
    for (const saved of registration.entries) {
      const entry = await call(`/v1/orgs/${state.orgId}/entries/${saved.id}`, {
        cookie: state.cookie,
      });
      assert.deepEqual(entry.data, saved);
    }
    const scheduling = state.scheduling;
    const scheduledEventPath = `/v1/orgs/${state.orgId}/events/${scheduling.workspace.event.id}`;
    const scheduleWorkspace = await call(`${scheduledEventPath}/scheduling`, {
      cookie: state.cookie,
    });
    assert.deepEqual(scheduleWorkspace.data, scheduling.workspace);
    const revision = await call(
      `/v1/orgs/${state.orgId}/schedule-revisions/${scheduling.revision.id}`,
      { cookie: state.cookie },
    );
    assert.deepEqual(revision.data, scheduling.revision);
    const matches = await call(`${scheduledEventPath}/matches`, { cookie: state.cookie });
    assert.deepEqual(matches.data, scheduling.matches);
    const courts = await call(`/v1/orgs/${state.orgId}/courts`, { cookie: state.cookie });
    assert.deepEqual(courts.data, [scheduling.court]);
    assert.equal(await fingerprint(), state.fingerprint);
    console.log(
      'PostgreSQL restart retained sessions, events, grants, immutable rosters, the registration freeze, published schedule, reservations, audit history and migration checksums.',
    );
  }
} finally {
  await instance.app.close();
  await instance.pool.end();
}

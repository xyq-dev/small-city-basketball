import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createApi } from '../apps/api/dist/app.js';
import pg from 'pg';

// The production package runs this same synthetic business chain against its real TLS API.
// SQL remains read-only here; use the separately scoped backup role for the 39-table digest.
async function privateValue(name) {
  const inline = process.env[name];
  const file = process.env[name + '_FILE'];
  if (inline && file) throw new Error('Conflicting check credential configuration');
  try {
    return file ? (await readFile(file, 'utf8')).trimEnd() : inline;
  } catch {
    throw new Error('Check credential file is unavailable');
  }
}
const databaseUrl = await privateValue('TEST_DATABASE_URL');
let databaseName;
try {
  databaseName = new URL(databaseUrl).pathname.slice(1);
} catch {
  throw new Error('Database check requires an isolated database');
}
if (
  !/^scb_test_[A-Za-z0-9_]+$/.test(databaseName) &&
  !(process.env.SCB_CHECK_RECOVERY === '1' && /^scb_restore_[A-Za-z0-9_]+$/.test(databaseName))
)
  throw new Error('Database check requires an isolated scb_test_* or explicit recovery database');
const stateFile = process.env.SCB_PERSISTENCE_FILE;
if (!stateFile)
  throw new Error('SCB_PERSISTENCE_FILE must be a private temporary file outside the repository');
const mode = process.argv[2];
if (!['capture', 'verify', 'freeze'].includes(mode))
  throw new Error('Use capture, verify or freeze');
const remoteUrl = process.env.SCB_CHECK_BASE_URL;
if (remoteUrl) {
  let url;
  try {
    url = new URL(remoteUrl);
  } catch {
    throw new Error('Invalid isolated TLS check origin');
  }
  if (
    url.protocol !== 'https:' ||
    !['localhost', '127.0.0.1', 'web'].includes(url.hostname) ||
    url.origin !== remoteUrl
  )
    throw new Error('External check requires an isolated TLS origin');
}
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const instance = remoteUrl
  ? { app: null, pool: new pg.Pool({ connectionString: databaseUrl }) }
  : await createApi({ databaseUrl, appOrigin: origin });
if (instance.app) await instance.app.listen(0, '127.0.0.1');
const baseUrl = remoteUrl ?? (await instance.app.getUrl());
const readUrl = await privateValue('SCB_FINGERPRINT_DATABASE_URL');
const readPool = readUrl ? new pg.Pool({ connectionString: readUrl }) : instance.pool;
async function call(route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(baseUrl + route, {
    method,
    headers: {
      Origin: origin,
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
    ['auth_rate_limits', 'key'],
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
    ['scoring_rulesets', 'id'],
    ['match_staff', 'org_id,match_id,user_id'],
    ['scoring_states', 'org_id,match_id'],
    ['scoring_leases', 'org_id,match_id'],
    ['scoring_commands', 'org_id,actor_id,match_id,command_id'],
    ['scoring_events', 'id'],
    ['result_confirmations', 'id'],
    ['standings_rulesets', 'id'],
    ['public_event_publications', 'id'],
    ['public_match_links', 'publication_id,match_id'],
    ['overlay_grants', 'id'],
    ['overlay_sessions', 'id'],
    ['audit_logs', 'id'],
    ['schema_migrations', 'name'],
  ]) {
    // Table and order names are fixed source constants; no request input is interpolated.
    const rows = await readPool.query(
      `SELECT row_to_json(record_row)::text AS exact_row FROM (SELECT * FROM ${table} ORDER BY ${order}) record_row`,
    );
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
  for (let index = 0; index < 3; index += 1) {
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
  assert.equal(workspace.freeze.entries.length, 3);
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
  assert.equal(revision.fixtures.length, 3);
  assert.deepEqual(revision.source, registration.workspace.freeze);
  const revisionPath = `${root}/schedule-revisions/${revision.id}`;
  revision = (
    await call(`${revisionPath}/allocations`, {
      method: 'PUT',
      cookie,
      body: {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
        allocations: revision.fixtures.map((fixture, index) => ({
          fixtureKey: fixture.fixtureKey,
          courtId: court.id,
          startsAt: `2026-12-01T0${1 + index * 2}:00:00.000Z`,
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
  assert.equal(matches.length, 3);
  assert.equal(matches[0].status, 'SCHEDULED');
  assert.equal(matches[0].courtId, court.id);
  assert.equal(matches[0].startsAt, '2026-12-01T01:00:00.000Z');
  assert.equal(matches[0].endsAt, '2026-12-01T02:00:00.000Z');
  const frozenBefore = registration.workspace.freeze;
  registration.workspace = (await call(`${path}/registration`, { cookie })).data;
  assert.deepEqual(registration.workspace.freeze, frozenBefore);
  return { court, workspace, revision, matches, publication };
}
async function captureScoring(orgId, ownerCookie, scheduling, suffix) {
  const root = `/v1/orgs/${orgId}`;
  const eventPath = `${root}/events/${scheduling.workspace.event.id}`;
  const writer = await call('/v1/auth/register-participant', {
    method: 'POST',
    body: {
      email: `restart-writer-${suffix}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: '重启验证场次记分员',
    },
  });
  const writerCookie = writer.response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(writerCookie);
  await call(`${root}/members/${writer.data.user.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { role: 'SCORER', status: 'ACTIVE' },
  });
  await call(`${eventPath}/scoring-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedEventVersion: scheduling.workspace.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 3600,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'ALLOW_DRAW',
      overtimeDurationSeconds: null,
    },
  });
  const receipts = [];
  async function command(matchId, cookie, type, payload = {}, control) {
    const path = `${root}/matches/${matchId}`;
    const workbench = (await call(`${path}/scoring`, { cookie })).data;
    const envelope = {
      commandId: randomUUID(),
      expectedVersion: workbench.match.version,
      type,
      payload: ['PREPARE_MATCH', 'START_MATCH'].includes(type)
        ? { expectedEventVersion: workbench.event.version }
        : payload,
      capturedAt: new Date().toISOString(),
      ...(control ? { control } : {}),
    };
    const response = (await call(`${path}/commands`, { method: 'POST', cookie, body: envelope }))
      .data;
    receipts.push({ matchId, cookie, receipt: response.receipt });
    return response;
  }
  const controls = [];
  for (const match of scheduling.matches.slice(0, 2)) {
    await call(`${root}/matches/${match.id}/staff/${writer.data.user.id}`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { expectedMatchVersion: match.version, role: 'SCORER', status: 'ACTIVE' },
    });
    await command(match.id, ownerCookie, 'PREPARE_MATCH');
    const acquired = (
      await call(`${root}/matches/${match.id}/scorekeeper-lease`, {
        method: 'POST',
        cookie: writerCookie,
        body: { clientInstanceId: randomUUID() },
      })
    ).data;
    const control = {
      leaseId: acquired.leaseId,
      fencingToken: acquired.fencingToken,
      clientInstanceId: acquired.clientInstanceId,
    };
    controls.push(control);
    await command(match.id, writerCookie, 'START_MATCH', {}, control);
  }
  const runningId = scheduling.matches[0].id;
  const finalId = scheduling.matches[1].id;
  await command(
    runningId,
    writerCookie,
    'RECORD_STAT',
    { kind: 'SCORE', side: 'HOME', value: 2 },
    controls[0],
  );
  await command(runningId, writerCookie, 'CLOCK_START', {}, controls[0]);
  await call(`${root}/matches/${runningId}/scorekeeper-lease`, {
    method: 'DELETE',
    cookie: writerCookie,
    body: { control: controls[0] },
  });
  await command(
    finalId,
    writerCookie,
    'RECORD_STAT',
    { kind: 'SCORE', side: 'HOME', value: 3 },
    controls[1],
  );
  await command(
    finalId,
    writerCookie,
    'CLOCK_SET',
    { remainingMs: 0, reason: '隔离重启验证节末归零' },
    controls[1],
  );
  await command(finalId, writerCookie, 'END_MATCH', {}, controls[1]);
  await command(finalId, ownerCookie, 'CONFIRM_RESULT');
  await command(finalId, ownerCookie, 'REOPEN_RESULT', { reason: '隔离重启验证保留已确认历史' });
  await command(
    finalId,
    writerCookie,
    'ADD_CORRECTION',
    { kind: 'SCORE', side: 'HOME', value: 1, period: 1, reason: '隔离重启验证补录' },
    controls[1],
  );
  await command(finalId, ownerCookie, 'CONFIRM_RESULT');
  const saved = [];
  for (const id of [runningId, finalId]) {
    const path = `${root}/matches/${id}`;
    saved.push({
      id,
      snapshot: (await call(`${path}/snapshot`, { cookie: ownerCookie })).data,
      events: (await call(`${path}/scoring-events?limit=100`, { cookie: ownerCookie })).data,
      confirmations: (await call(`${path}/result-confirmations?limit=100`, { cookie: ownerCookie }))
        .data,
    });
  }
  assert.equal(saved[0].snapshot.status, 'LIVE');
  assert.equal(saved[0].snapshot.clock.running, true);
  assert.equal(saved[0].snapshot.totals.home.score, 2);
  assert.equal(saved[1].snapshot.status, 'FINAL');
  assert.equal(saved[1].snapshot.totals.home.score, 4);
  assert.equal(saved[1].confirmations.length, 2);
  assert.equal(saved[1].snapshot.requiresReconfirmation, false);
  const rules = (await call(`${eventPath}/scoring`, { cookie: ownerCookie })).data;
  assert.equal(rules.locked, true);
  return { rules, saved, writerCookie, receipts, previousFence: controls[0].fencingToken };
}

// Public projections have fresh read timestamps; all persisted business fields,
// including raw running-clock anchors, public identities and source hashes, must match.
function withoutReadTimes(value) {
  if (Array.isArray(value)) return value.map(withoutReadTimes);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'serverTime' && key !== 'asOf')
        .map(([key, nested]) => [key, withoutReadTimes(nested)]),
    );
  return value;
}
async function assertPublicMissing(path) {
  assert.equal(
    (await fetch(baseUrl + path)).status,
    404,
    'Revoked public identity must stay unavailable',
  );
}
async function captureViewing(orgId, cookie, scheduling) {
  const eventPath = `/v1/orgs/${orgId}/events/${scheduling.workspace.event.id}`;
  let workspace = (await call(`${eventPath}/standings`, { cookie })).data;
  workspace = (
    await call(`${eventPath}/standings-rules`, {
      method: 'PUT',
      cookie,
      body: {
        expectedEventVersion: workspace.event.version,
        winPoints: 3,
        lossPoints: 0,
        drawPoints: 1,
        tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
      },
    })
  ).data;
  workspace = (
    await call(`${eventPath}/standings-rule-commands`, {
      method: 'POST',
      cookie,
      body: {
        type: 'PUBLISH_STANDINGS_RULES',
        rulesetId: workspace.rules.id,
        expectedEventVersion: workspace.event.version,
      },
    })
  ).data;
  async function publicationCommand(type) {
    workspace = (
      await call(`${eventPath}/public-viewing-commands`, {
        method: 'POST',
        cookie,
        body: { type, expectedEventVersion: workspace.event.version },
      })
    ).data;
  }
  await publicationCommand('ENABLE');
  const revokedId = workspace.publication.publicEventId;
  const revokedMatchId = (await call(`/v1/public/events/${revokedId}/schedule`)).data[0]
    .publicMatchId;
  await publicationCommand('DISABLE');
  await publicationCommand('ENABLE');
  const publicId = workspace.publication.publicEventId;
  assert.notEqual(publicId, revokedId);
  await assertPublicMissing(`/v1/public/events/${revokedId}`);
  await assertPublicMissing(`/v1/public/events/${revokedId}/matches/${revokedMatchId}`);
  workspace = (await call(`${eventPath}/standings`, { cookie })).data;
  const publicPath = `/v1/public/events/${publicId}`;
  const overview = (await call(publicPath)).data;
  const schedule = (await call(`${publicPath}/schedule`)).data;
  const standings = (await call(`${publicPath}/standings`)).data;
  const matches = [];
  for (const match of schedule)
    matches.push((await call(`${publicPath}/matches/${match.publicMatchId}`)).data);
  assert.equal(workspace.locked, true);
  assert.equal(standings.confirmedMatchCount, 1);
  assert.equal(standings.totalMatchCount, 3);
  assert.equal(standings.isComplete, false);
  assert.equal(matches.find((match) => match.status === 'LIVE').clock.running, true);
  assert.equal(matches.find((match) => match.status === 'FINAL').resultStatus, 'CONFIRMED');
  const unprepared = matches.find((match) => match.status === 'SCHEDULED');
  assert.equal(unprepared.score, null);
  assert.equal(unprepared.clock, null);
  assert.equal(unprepared.collected.teamScore, false);
  return { workspace, publicId, revokedId, revokedMatchId, overview, schedule, standings, matches };
}

async function assertOverlayRevoked(saved) {
  assert.equal(
    (
      await fetch(`${baseUrl}/v1/overlays/${saved.overlayId}/snapshot`, {
        headers: { Cookie: saved.cookie },
      })
    ).status,
    404,
    'A revoked overlay session must stay unavailable',
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/v1/overlays/${saved.overlayId}/bootstrap`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: saved.token }),
      })
    ).status,
    404,
    'A revoked overlay secret must stay unavailable',
  );
}

async function captureOverlays(orgId, cookie, scheduling) {
  const root = `/v1/orgs/${orgId}`;
  // These grants are deliberately issued before public viewing/ranking is enabled.
  const published = await instance.pool.query(
    'SELECT count(*)::int AS count FROM public_event_publications WHERE org_id=$1 AND event_id=$2',
    [orgId, scheduling.workspace.event.id],
  );
  assert.equal(published.rows[0].count, 0);
  const active = [];
  let revoked;
  for (const match of scheduling.matches) {
    const path = `${root}/matches/${match.id}`;
    let workspace = (await call(`${path}/overlay`, { cookie })).data;
    let response = (
      await call(`${path}/overlay-commands`, {
        method: 'POST',
        cookie,
        body: {
          type: 'ISSUE',
          expectedEventVersion: workspace.event.version,
          expiresInMinutes: 60,
        },
      })
    ).data;
    const original = response.credential;
    assert.ok(original);
    const first = await call(`/v1/overlays/${original.overlayId}/bootstrap`, {
      method: 'POST',
      body: { token: original.token },
    });
    const firstCookie = first.response.headers.getSetCookie()[0]?.split(';')[0];
    assert.ok(firstCookie);
    if (!revoked) {
      revoked = { ...original, cookie: firstCookie };
      response = (
        await call(`${path}/overlay-commands`, {
          method: 'POST',
          cookie,
          body: {
            type: 'ROTATE',
            expectedEventVersion: response.event.version,
            overlayId: response.currentGrant.overlayId,
            expectedGrantVersion: response.currentGrant.version,
            expiresInMinutes: 60,
            reason: '重启验证永久关闭旧包装身份',
          },
        })
      ).data;
      await assertOverlayRevoked(revoked);
    }
    const credential = response.credential;
    assert.ok(credential);
    const current = await call(`/v1/overlays/${credential.overlayId}/bootstrap`, {
      method: 'POST',
      body: { token: credential.token },
      ...(credential.overlayId === original.overlayId ? { cookie: firstCookie } : {}),
    });
    const sourceCookie = current.response.headers.getSetCookie()[0]?.split(';')[0] ?? firstCookie;
    assert.ok(sourceCookie);
    assert.deepEqual(Object.keys(current.data).sort(), ['expiresAt', 'overlayId', 'serverTime']);
    active.push({ matchId: match.id, ...credential, cookie: sourceCookie });
  }
  for (const saved of active) {
    saved.workspace = (await call(`${root}/matches/${saved.matchId}/overlay`, { cookie })).data;
    saved.snapshot = (
      await call(`/v1/overlays/${saved.overlayId}/snapshot`, { cookie: saved.cookie })
    ).data;
    assert.equal(Object.hasOwn(saved.workspace, 'credential'), false);
  }
  assert.equal(
    active.find((saved) => saved.snapshot.status === 'LIVE').snapshot.clock.running,
    true,
  );
  assert.equal(
    active.find((saved) => saved.snapshot.status === 'FINAL').snapshot.resultStatus,
    'CONFIRMED',
  );
  const unprepared = active.find((saved) => saved.snapshot.status === 'SCHEDULED').snapshot;
  assert.equal(unprepared.score, null);
  assert.equal(unprepared.clock, null);
  assert.equal(unprepared.collected.teamScore, false);
  return { active, revoked };
}
try {
  if (mode === 'capture') {
    const suffix = randomUUID();
    const ownerFile = process.env.SCB_CHECK_OWNER_FILE;
    const owner = ownerFile ? JSON.parse(await readFile(ownerFile, 'utf8')) : null;
    const registration = await call(owner ? '/v1/auth/login' : '/v1/auth/register', {
      method: 'POST',
      body: {
        ...(owner
          ? { email: owner.email, password: owner.password }
          : {
              email: `restart-${suffix}@example.test`,
              password: randomBytes(24).toString('base64url'),
              displayName: '重启验证员',
              organizationName: '隔离重启验证机构',
            }),
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
    const scoring = await captureScoring(orgId, cookie, scheduling, suffix);
    const overlays = await captureOverlays(orgId, cookie, scheduling);
    const viewing = await captureViewing(orgId, cookie, scheduling);
    const scheduledEventPath = `/v1/orgs/${orgId}/events/${scheduling.workspace.event.id}`;
    scoring.rules = (await call(`${scheduledEventPath}/scoring`, { cookie })).data;
    scheduling.workspace = (await call(`${scheduledEventPath}/scheduling`, { cookie })).data;
    scheduling.revision = (
      await call(`/v1/orgs/${orgId}/schedule-revisions/${scheduling.revision.id}`, { cookie })
    ).data;
    scheduling.matches = (await call(`${scheduledEventPath}/matches`, { cookie })).data;
    frozenRegistration.workspace = (
      await call(`${scheduledEventPath}/registration`, { cookie })
    ).data;
    // Public-viewing writes also raise Event.version; retain the final metadata.
    for (const saved of overlays.active)
      saved.workspace = (
        await call(`/v1/orgs/${orgId}/matches/${saved.matchId}/overlay`, { cookie })
      ).data;
    const state = {
      cookie,
      userId: registration.data.user.id,
      orgId,
      event: created.data,
      registration: frozenRegistration,
      scheduling,
      scoring,
      viewing,
      overlays,
      fingerprint: await fingerprint(),
    };
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log(
      'Captured sessions, frozen registration, schedule, raw clock, results, standings, public identities, independent active/revoked overlay grants and read sessions, and the isolated database fingerprint.',
    );
  } else if (mode === 'freeze') {
    // The caller has stopped every API writer before this point and keeps them stopped until dump finishes.
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    state.fingerprint = await fingerprint();
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log('Captured the quiescent 39-table backup baseline.');
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
    const scoring = state.scoring;
    assert.deepEqual(
      (await call(`${scheduledEventPath}/scoring`, { cookie: state.cookie })).data,
      scoring.rules,
    );
    const writerSession = await call('/v1/auth/session', { cookie: scoring.writerCookie });
    assert.ok(writerSession.data.organizations.some((org) => org.id === state.orgId));
    for (const saved of scoring.saved) {
      const path = `/v1/orgs/${state.orgId}/matches/${saved.id}`;
      const snapshot = (await call(`${path}/snapshot`, { cookie: state.cookie })).data;
      const { serverTime: oldTime, ...oldSnapshot } = saved.snapshot;
      const { serverTime: newTime, ...newSnapshot } = snapshot;
      assert.deepEqual(newSnapshot, oldSnapshot);
      if (snapshot.clock.running) {
        assert.ok(Date.parse(newTime) > Date.parse(oldTime));
        const effective = Math.max(
          0,
          snapshot.clock.remainingMs -
            (Date.parse(newTime) - Date.parse(snapshot.clock.anchorServerTime)),
        );
        assert.ok(
          effective < snapshot.clock.remainingMs,
          'Running clock continues from its persisted anchor after restart',
        );
      }
      assert.deepEqual(
        (await call(`${path}/scoring-events?limit=100`, { cookie: state.cookie })).data,
        saved.events,
      );
      assert.deepEqual(
        (await call(`${path}/result-confirmations?limit=100`, { cookie: state.cookie })).data,
        saved.confirmations,
      );
    }
    for (const saved of scoring.receipts) {
      const path = `/v1/orgs/${state.orgId}/matches/${saved.matchId}/commands/${saved.receipt.commandId}`;
      const response = (await call(path, { cookie: saved.cookie })).data;
      assert.deepEqual(response.receipt, saved.receipt);
      assert.equal(response.snapshot.matchId, saved.matchId);
    }
    const viewing = state.viewing;
    const publicPath = `/v1/public/events/${viewing.publicId}`;
    const comparisons = [
      [
        (await call(`${scheduledEventPath}/standings`, { cookie: state.cookie })).data,
        viewing.workspace,
      ],
      [(await call(publicPath)).data, viewing.overview],
      [(await call(`${publicPath}/schedule`)).data, viewing.schedule],
      [(await call(`${publicPath}/standings`)).data, viewing.standings],
    ];
    for (const saved of viewing.matches)
      comparisons.push([(await call(`${publicPath}/matches/${saved.publicMatchId}`)).data, saved]);
    for (const [current, saved] of comparisons)
      assert.deepEqual(withoutReadTimes(current), withoutReadTimes(saved));
    await assertPublicMissing(`/v1/public/events/${viewing.revokedId}`);
    await assertPublicMissing(
      `/v1/public/events/${viewing.revokedId}/matches/${viewing.revokedMatchId}`,
    );
    for (const saved of state.overlays.active) {
      const workbench = (
        await call(`/v1/orgs/${state.orgId}/matches/${saved.matchId}/overlay`, {
          cookie: state.cookie,
        })
      ).data;
      const sourcePath = `/v1/overlays/${saved.overlayId}`;
      const snapshot = (await call(`${sourcePath}/snapshot`, { cookie: saved.cookie })).data;
      assert.deepEqual(withoutReadTimes(workbench), withoutReadTimes(saved.workspace));
      assert.deepEqual(withoutReadTimes(snapshot), withoutReadTimes(saved.snapshot));
      const reused = await call(`${sourcePath}/bootstrap`, {
        method: 'POST',
        cookie: saved.cookie,
        body: { token: saved.token },
      });
      assert.equal(reused.data.expiresAt, saved.snapshot.expiresAt);
      const returnedCookie = reused.response.headers.getSetCookie()[0]?.split(';')[0];
      if (returnedCookie)
        assert.ok(returnedCookie === saved.cookie, 'Existing overlay session must be reused');
    }
    await assertOverlayRevoked(state.overlays.revoked);
    assert.equal(await fingerprint(), state.fingerprint);
    const acquired = (
      await call(`/v1/orgs/${state.orgId}/matches/${scoring.saved[0].id}/scorekeeper-lease`, {
        method: 'POST',
        cookie: scoring.writerCookie,
        body: { clientInstanceId: randomUUID() },
      })
    ).data;
    assert.ok(
      BigInt(acquired.fencingToken) > BigInt(scoring.previousFence),
      'Lease fence remains monotonic across PostgreSQL restart',
    );
    console.log(
      'PostgreSQL restart retained sessions, grants, frozen rosters, schedule/reservations, scoring rules/events/receipts/results, raw clock and monotonic fence, standings/source hashes, public identities, independent overlay grants/read sessions/revocation and exact expiry, audit and migration checksums across all 39 tables.',
    );
  }
} finally {
  await instance.app?.close();
  await instance.pool.end();
  if (readPool !== instance.pool) await readPool.end();
}

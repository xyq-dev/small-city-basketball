import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { loadManifest } from '../ops/db/privileges.mjs';
import { exactTableRows } from '../ops/recovery/fingerprint-rows.mjs';
import {
  captureExpansion,
  verifyExpansion,
  verifyExpansionQuarantine,
  assertExpansionQuarantineCounts,
} from './expansion-recovery-check.mjs';
import { captureEventTemplates, verifyEventTemplates } from './x03-template-check.mjs';
import {
  configureX02AdjudicationRules,
  captureX02Adjudication,
  verifyX02Adjudication,
  verifyX02AdjudicationQuarantine,
} from './x02-adjudication-check.mjs';
import {
  captureX12Local,
  captureX12CompletedService,
  verifyX12Local,
  verifyX12LocalQuarantine,
} from './x12-local-check.mjs';
import {
  captureX18Governance,
  verifyX18Governance,
  verifyX18GovernanceQuarantine,
} from './x18-governance-check.mjs';
import {
  captureX22AccountRecovery,
  verifyX22AccountRecovery,
  verifyX22AccountRecoveryQuarantine,
} from './x22-account-recovery-check.mjs';
import {
  captureX05Recruitment,
  verifyX05Recruitment,
  verifyX05RecruitmentQuarantine,
} from './x05-recruitment-check.mjs';
import {
  captureX08Archive,
  verifyX08Archive,
  verifyX08ArchiveQuarantine,
} from './x08-archive-check.mjs';
import { syntheticPdf, syntheticPng, syntheticMp4 } from './c05-media-fixtures.mjs';
import {
  captureParticipantMaterials,
  verifyParticipantMaterials,
  verifyParticipantQuarantine,
} from './c23-participant-material-check.mjs';
import {
  captureCommerceSetup,
  ensureCommercialEntitlement,
  captureCommerceEnd,
  verifyCommerce,
} from './c05-commerce-check.mjs';

// The production package runs this same synthetic business chain against its real TLS API.
// SQL remains read-only here; use the separately scoped backup role for the complete manifest-table digest.
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
if (!['capture', 'verify', 'freeze', 'quarantine'].includes(mode))
  throw new Error('Use capture, verify, freeze or quarantine');
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
// Synthetic key derivation is limited to a locally constructed scb_test_* API.
// A cloned restore reuses the capture's nonsecret source-name reference instead of
// deriving a different key from its target name. TLS package checks use private CI files.
const configuredParticipantKey = await privateValue('SCB_PARTICIPANT_DATA_KEY');
let participantKeyFixtureDatabase = null;
if (!configuredParticipantKey && !remoteUrl) {
  participantKeyFixtureDatabase =
    mode === 'capture'
      ? databaseName
      : JSON.parse(await readFile(stateFile, 'utf8')).participantKeyFixtureDatabase;
  if (
    typeof participantKeyFixtureDatabase !== 'string' ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(participantKeyFixtureDatabase)
  )
    throw new Error('Local material recovery requires its captured isolated key reference');
}
const participantDataKey =
  configuredParticipantKey ??
  (participantKeyFixtureDatabase
    ? createHash('sha256')
        .update(`synthetic-c23-restart:${participantKeyFixtureDatabase}`)
        .digest('base64')
    : undefined);
if (!participantDataKey)
  throw new Error('Participant restart checks require their private isolated key');
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const instance = remoteUrl
  ? { app: null, pool: new pg.Pool({ connectionString: databaseUrl }) }
  : await (
      await import('../apps/api/dist/app.js')
    ).createApi({
      databaseUrl,
      appOrigin: origin,
      commerceMode: 'ENFORCED',
      participantDataKey,
      backgroundWorkersEnabled: false,
    });
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
  const payload = await response.json();
  return { response, data: payload.data, meta: payload.meta };
}
async function fingerprint() {
  const hash = createHash('sha256');
  const manifest = await loadManifest();
  for (const table of Object.keys(manifest.tables).sort()) {
    const rows = await exactTableRows(readPool, table);
    hash.update(table + '\n' + JSON.stringify(rows) + '\n');
  }
  return hash.digest('hex');
}
async function completionTableCounts() {
  const directory = new URL('../apps/api/migrations/', import.meta.url),
    manifest = await loadManifest(),
    names = new Set();
  for (const file of (await readdir(directory)).filter(
    (name) => /^\d+_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, name.indexOf('_'))) >= 25,
  )) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    for (const match of sql.matchAll(/\bCREATE TABLE\s+([a-z][a-z0-9_]+)\s*\(/g))
      names.add(match[1]);
  }
  assert.ok(names.size > 0, 'Completion migration table inventory must not be empty');
  const counts = {};
  for (const table of [...names].sort()) {
    assert.ok(
      manifest.tables[table],
      'Every completion table must have exact reviewed runtime privileges',
    );
    const result = await readPool.query(`SELECT count(*)::integer AS count FROM public."${table}"`);
    assert.ok(
      result.rows[0].count > 0,
      `Completion table ${table} requires a real nonempty acceptance fixture`,
    );
    counts[table] = result.rows[0].count;
  }
  return counts;
}
async function captureCompletedReview(state, completed) {
  const input = {
    commandId: randomUUID(),
    sourceKind: 'LOCAL_BOOKING',
    sourceId: completed.bookingId,
    score: 5,
    body: '合成真实双方完成短时服务后评价',
    publicConsent: true,
  };
  const created = (
    await call('/v1/me/governance/reviews', {
      method: 'POST',
      cookie: state.registration.leaderCookie,
      body: input,
    })
  ).data;
  const published = (
    await call(`/v1/me/governance/reviews/${created.id}/commands`, {
      method: 'POST',
      cookie: state.commerce.operators[0].cookie,
      body: {
        commandId: randomUUID(),
        expectedVersion: created.version,
        type: 'PUBLISH',
        reason: '独立核对真实合成履约评价',
      },
    })
  ).data;
  assert.equal(published.status, 'PUBLISHED');
  const row = (
    await readPool.query(
      `SELECT public_key,status,version,encode(sha256(convert_to((to_jsonb(r)-ARRAY['status','version','review_reason','updated_at'])::text,'UTF8')),'hex') AS core_hash FROM governance_reviews r WHERE id=$1`,
      [created.id],
    )
  ).rows[0];
  const publicData = (await call('/v1/public/governance/reviews/' + row.public_key)).data;
  return {
    id: created.id,
    bookingId: completed.bookingId,
    version: published.version,
    keyHash: createHash('sha256').update(row.public_key).digest('hex'),
    coreHash: row.core_hash,
    publicHash: createHash('sha256').update(JSON.stringify(publicData)).digest('hex'),
  };
}
async function verifyCompletedReview(saved, quarantined = false) {
  const row = (
    await readPool.query(
      `SELECT public_key,status,version,encode(sha256(convert_to((to_jsonb(r)-ARRAY['status','version','review_reason','updated_at'])::text,'UTF8')),'hex') AS core_hash FROM governance_reviews r WHERE id=$1`,
      [saved.id],
    )
  ).rows[0];
  assert.equal(row.core_hash, saved.coreHash);
  assert.equal(createHash('sha256').update(row.public_key).digest('hex'), saved.keyHash);
  assert.equal(row.version, saved.version + (quarantined ? 1 : 0));
  assert.equal(row.status, quarantined ? 'WITHDRAWN' : 'PUBLISHED');
  const path = '/v1/public/governance/reviews/' + row.public_key;
  if (quarantined) await assertPublicMissing(path);
  else
    assert.equal(
      createHash('sha256')
        .update(JSON.stringify((await call(path)).data))
        .digest('hex'),
      saved.publicHash,
    );
}
let commerceSetup;
async function captureRegistration(
  orgId,
  ownerCookie,
  suffix,
  existingLeader,
  format = 'ROUND_ROBIN',
  teamCount = 3,
  configureEvent = null,
) {
  const root = `/v1/orgs/${orgId}`;
  const leader = existingLeader
    ? { data: existingLeader.leaderSession }
    : await call('/v1/auth/register-participant', {
        method: 'POST',
        body: {
          email: `restart-leader-${suffix}@example.test`,
          password: randomBytes(24).toString('base64url'),
          displayName: '重启验证领队',
        },
      });
  assert.deepEqual(leader.data.organizations, []);
  const leaderCookie =
    existingLeader?.leaderCookie ?? leader.response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(leaderCookie, 'Participant registration must create a persistent session');
  const event = await call(`${root}/events`, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      name: `冻结重启验证-${suffix}`,
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      timezone: 'Asia/Shanghai',
      format,
    },
  });
  const path = `${root}/events/${event.data.id}`;
  if (configureEvent) {
    await configureEvent(event.data);
    event.data = (await call(path, { cookie: ownerCookie })).data;
  }
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
  for (let index = 0; index < teamCount; index += 1) {
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
  assert.equal(workspace.freeze.entries.length, teamCount);
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
  if (registration.workspace.event.format === 'GROUP_KNOCKOUT') {
    let standings = (
      await call(`${path}/standings-rules`, {
        method: 'PUT',
        cookie,
        body: {
          expectedEventVersion: registration.workspace.event.version,
          winPoints: 2,
          lossPoints: 1,
          drawPoints: 1,
          tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'],
        },
      })
    ).data;
    standings = (
      await call(`${path}/standings-rule-commands`, {
        method: 'POST',
        cookie,
        body: {
          type: 'PUBLISH_STANDINGS_RULES',
          rulesetId: standings.rules.id,
          expectedEventVersion: standings.event.version,
        },
      })
    ).data;
    registration.workspace = (await call(`${path}/registration`, { cookie })).data;
  }
  const court = (
    await call(`${root}/courts`, {
      method: 'POST',
      cookie,
      body: { name: `赛程重启验证球场-${eventId}` },
    })
  ).data;
  let revision = (
    await call(`${path}/schedule-revisions`, {
      method: 'POST',
      cookie,
      body: {
        expectedEventVersion: registration.workspace.event.version,
        freezeId: registration.workspace.freeze.id,
        algorithmVersion:
          registration.workspace.event.format === 'SINGLE_ELIMINATION'
            ? 'SE_SEEDED_V1'
            : registration.workspace.event.format === 'GROUP_KNOCKOUT'
              ? 'GK_BALANCED_V1'
              : 'RR_CIRCLE_V1',
        ...(registration.workspace.event.format === 'GROUP_KNOCKOUT'
          ? { groupConfig: { groupCount: 2, seededEntryIds: [] } }
          : {}),
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
  const firstMatchCount =
    registration.workspace.event.format === 'SINGLE_ELIMINATION'
      ? 1
      : registration.workspace.event.format === 'GROUP_KNOCKOUT'
        ? 2
        : 3;
  assert.equal(revision.fixtures.length, firstMatchCount);
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
  const unpaid = await fetch(baseUrl + `${revisionPath}/publish`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(versions),
  });
  assert.equal(unpaid.status, 402, 'Unpaid publication must fail before all schedule effects');
  assert.equal((await call(`${path}/matches`, { cookie })).data.length, 0);
  await ensureCommercialEntitlement({ call, cookie, orgId, eventId, setup: commerceSetup });
  const publication = (
    await call(`${revisionPath}/publish`, { method: 'POST', cookie, body: versions })
  ).data;
  const workspace = (await call(`${path}/scheduling`, { cookie })).data;
  revision = (await call(revisionPath, { cookie })).data;
  const matches = (await call(`${path}/matches`, { cookie })).data;
  assert.equal(workspace.event.status, 'SCHEDULED');
  assert.equal(revision.status, 'PUBLISHED');
  assert.equal(matches.length, firstMatchCount);
  assert.equal(matches[0].status, 'SCHEDULED');
  assert.equal(matches[0].courtId, court.id);
  assert.equal(matches[0].startsAt, '2026-12-01T01:00:00.000Z');
  assert.equal(matches[0].endsAt, '2026-12-01T02:00:00.000Z');
  const frozenBefore = registration.workspace.freeze;
  registration.workspace = (await call(`${path}/registration`, { cookie })).data;
  assert.deepEqual(registration.workspace.freeze, frozenBefore);
  return { court, workspace, revision, matches, publication };
}
async function captureScoring(orgId, ownerCookie, scheduling, suffix, existingWriter) {
  const root = `/v1/orgs/${orgId}`;
  const eventPath = `${root}/events/${scheduling.workspace.event.id}`;
  const writer = existingWriter
    ? { data: { user: { id: existingWriter.writerUserId } } }
    : await call('/v1/auth/register-participant', {
        method: 'POST',
        body: {
          email: `restart-writer-${suffix}@example.test`,
          password: randomBytes(24).toString('base64url'),
          displayName: '重启验证场次记分员',
        },
      });
  const writerCookie =
    existingWriter?.writerCookie ?? writer.response.headers.getSetCookie()[0]?.split(';')[0];
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
        ? { ...payload, expectedEventVersion: workbench.event.version }
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
  let attributedMemberId;
  for (const [index, match] of scheduling.matches.slice(0, 2).entries()) {
    await call(`${root}/matches/${match.id}/staff/${writer.data.user.id}`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { expectedMatchVersion: match.version, role: 'SCORER', status: 'ACTIVE' },
    });
    // Preserve the legacy TEAM_ONLY running-clock fixture. The confirmed match
    // exercises PLAYER_BASIC through this same restart and full-restore chain.
    const prepared = await command(
      match.id,
      ownerCookie,
      'PREPARE_MATCH',
      index === 1 ? { collectionMode: 'PLAYER_BASIC' } : {},
    );
    assert.equal(prepared.snapshot.collected.playerStatistics, index === 1);
    if (index === 1) {
      attributedMemberId = prepared.snapshot.playerStatistics?.home.players[0]?.memberId;
      assert.ok(attributedMemberId, 'Player attribution must use the actual frozen home roster');
    }
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
    { kind: 'SCORE', side: 'HOME', value: 3, memberId: attributedMemberId },
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
  assert.equal(saved[0].snapshot.playerStatistics, null);
  assert.equal(saved[0].snapshot.collected.playerStatistics, false);
  assert.equal(saved[1].snapshot.status, 'FINAL');
  assert.equal(saved[1].snapshot.totals.home.score, 4);
  const playerStatistics = saved[1].snapshot.playerStatistics;
  assert.equal(playerStatistics.mode, 'PLAYER_BASIC');
  assert.equal(saved[1].snapshot.collected.playerStatistics, true);
  assert.equal(
    playerStatistics.home.players.find((player) => player.memberId === attributedMemberId)?.score,
    3,
  );
  assert.equal(playerStatistics.home.unassigned.score, 1);
  assert.equal(
    playerStatistics.home.players.reduce(
      (score, player) => score + player.score,
      playerStatistics.home.unassigned.score,
    ),
    saved[1].snapshot.totals.home.score,
  );
  assert.deepEqual(saved[1].snapshot.latestConfirmation.playerStatistics, playerStatistics);
  assert.equal(saved[1].confirmations.length, 2);
  const previousConfirmation = saved[1].confirmations.find(
    (confirmation) => confirmation.id !== saved[1].snapshot.latestConfirmation.id,
  );
  assert.equal(previousConfirmation.playerStatistics.home.unassigned.score, 0);
  assert.equal(
    previousConfirmation.playerStatistics.home.players.find(
      (player) => player.memberId === attributedMemberId,
    )?.score,
    3,
  );
  assert.equal(saved[1].snapshot.requiresReconfirmation, false);
  const rules = (await call(`${eventPath}/scoring`, { cookie: ownerCookie })).data;
  assert.equal(rules.locked, true);
  return {
    rules,
    saved,
    writerCookie,
    writerUserId: writer.data.user.id,
    receipts,
    previousFence: controls[0].fencingToken,
  };
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

async function captureRescheduling(orgId, cookie, scheduling, viewing, overlays) {
  const currentMatches = (
    await call(`/v1/orgs/${orgId}/events/${scheduling.workspace.event.id}/matches`, { cookie })
  ).data;
  const match = currentMatches.find((item) => item.status === 'SCHEDULED');
  assert.ok(match, 'Rescheduling proof needs an unprepared match');
  const path = `/v1/orgs/${orgId}/matches/${match.id}/rescheduling`;
  const original = (await call(path, { cookie })).data;
  const publicPath = `/v1/public/events/${viewing.publicId}`;
  const oldPage = await call(`${publicPath}/schedule?limit=1`);
  assert.ok(oldPage.meta.nextCursor, 'Capture a real public cursor before changing ordering');
  const savedOverlay = overlays.active.find((item) => item.matchId === match.id);
  const credentialBefore = structuredClone(savedOverlay.workspace.currentGrant);
  const snapshotBefore = savedOverlay.snapshot;
  let current = original;
  for (const [startsAt, reason] of [
    ['2026-12-01T07:00:00.000Z', '隔离重启验证首次改期'],
    ['2026-12-01T08:00:00.000Z', '隔离恢复验证再次改期'],
  ]) {
    current = (
      await call(`/v1/orgs/${orgId}/matches/${match.id}/reschedule-commands`, {
        method: 'POST',
        cookie,
        body: {
          type: 'RESCHEDULE',
          expectedEventVersion: current.event.version,
          expectedMatchVersion: current.match.version,
          courtId: match.courtId,
          startsAt,
          reason,
        },
      })
    ).data;
  }
  assert.equal(current.match.version, original.match.version + 2);
  assert.equal(current.event.version, original.event.version + 2);
  assert.equal(current.history.length, 2);
  assert.equal(current.history[0].from.startsAt, current.history[1].to.startsAt);
  assert.equal(current.match.startsAt, '2026-12-01T08:00:00.000Z');
  assert.equal(current.match.endsAt, '2026-12-01T09:00:00.000Z');
  assert.deepEqual(
    (await call(`/v1/orgs/${orgId}/schedule-revisions/${scheduling.revision.id}`, { cookie })).data,
    { ...scheduling.revision, eventVersion: current.event.version },
    'Original publication source, fixtures and hashes remain immutable',
  );
  const stale = await fetch(
    `${baseUrl}${publicPath}/schedule?limit=1&cursor=${encodeURIComponent(oldPage.meta.nextCursor)}`,
  );
  assert.equal(stale.status, 422, 'A pre-reschedule pagination cursor must not skip matches');
  viewing.workspace = (
    await call(`/v1/orgs/${orgId}/events/${match.eventId}/standings`, { cookie })
  ).data;
  const schedule = (await call(`${publicPath}/schedule`)).data;
  assert.deepEqual(
    schedule.map((item) => item.publicMatchId).sort(),
    viewing.schedule.map((item) => item.publicMatchId).sort(),
    'Rescheduling retains public identities',
  );
  const publicMatch = schedule.find((item) => item.status === 'SCHEDULED');
  assert.equal(publicMatch.startsAt, current.match.startsAt);
  assert.equal(publicMatch.version, current.match.version);
  viewing.schedule = schedule;
  viewing.matches = await Promise.all(
    schedule.map(async (item) => (await call(`${publicPath}/matches/${item.publicMatchId}`)).data),
  );
  savedOverlay.workspace = (
    await call(`/v1/orgs/${orgId}/matches/${match.id}/overlay`, { cookie })
  ).data;
  savedOverlay.snapshot = (
    await call(`/v1/overlays/${savedOverlay.overlayId}/snapshot`, { cookie: savedOverlay.cookie })
  ).data;
  assert.deepEqual(savedOverlay.workspace.currentGrant, credentialBefore);
  const { serverTime: oldTime, matchVersion: oldVersion, ...before } = snapshotBefore;
  const { serverTime: newTime, matchVersion: newVersion, ...after } = savedOverlay.snapshot;
  assert.deepEqual(after, before, 'Existing read grant and scoring facts remain unchanged');
  assert.equal(newVersion, oldVersion + 2);
  return current;
}

// Keep the original running-clock/reschedule fixture untouched. This separate
// event reuses its synthetic leader/scorer identities and has a closed history.
async function captureLifecycle(orgId, cookie, suffix, existingRegistration, existingScoring) {
  const registration = await captureRegistration(
    orgId,
    cookie,
    `${suffix}-history`,
    existingRegistration,
  );
  const scheduling = await captureScheduling(orgId, cookie, registration);
  const scoring = await captureScoring(
    orgId,
    cookie,
    scheduling,
    `${suffix}-history`,
    existingScoring,
  );
  const eventPath = `/v1/orgs/${orgId}/events/${scheduling.workspace.event.id}`;
  const root = `/v1/orgs/${orgId}`;
  const viewing = await captureViewing(orgId, cookie, scheduling);
  const initialSummary = (await call(`${eventPath}/player-statistics`, { cookie })).data.summary;
  assert.equal(initialSummary.includedMatchCount, 1);
  assert.equal(initialSummary.pendingMatchCount, 2);
  assert.equal(initialSummary.coverageComplete, false);
  for (const match of scheduling.matches) {
    const path = `${root}/matches/${match.id}`;
    let workbench = (await call(`${path}/scoring`, { cookie })).data;
    if (workbench.match.status === 'FINAL') continue;
    if (workbench.match.status === 'SCHEDULED') {
      await call(`${path}/staff/${scoring.writerUserId}`, {
        method: 'PUT',
        cookie,
        body: { expectedMatchVersion: workbench.match.version, role: 'SCORER', status: 'ACTIVE' },
      });
    }
    async function command(actor, type, payload = {}, control) {
      workbench = (await call(`${path}/scoring`, { cookie: actor })).data;
      return (
        await call(`${path}/commands`, {
          method: 'POST',
          cookie: actor,
          body: {
            commandId: randomUUID(),
            expectedVersion: workbench.match.version,
            type,
            capturedAt: new Date().toISOString(),
            payload: ['PREPARE_MATCH', 'START_MATCH'].includes(type)
              ? { ...payload, expectedEventVersion: workbench.event.version }
              : payload,
            ...(control ? { control } : {}),
          },
        })
      ).data;
    }
    if (workbench.match.status === 'SCHEDULED')
      await command(cookie, 'PREPARE_MATCH', { collectionMode: 'PLAYER_BASIC' });
    const lease = (
      await call(`${path}/scorekeeper-lease`, {
        method: 'POST',
        cookie: scoring.writerCookie,
        body: { clientInstanceId: randomUUID() },
      })
    ).data;
    const control = {
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      clientInstanceId: lease.clientInstanceId,
    };
    workbench = (await call(`${path}/scoring`, { cookie: scoring.writerCookie })).data;
    if (workbench.match.status === 'READY')
      await command(scoring.writerCookie, 'START_MATCH', {}, control);
    if (workbench.snapshot.clock.running)
      await command(scoring.writerCookie, 'CLOCK_PAUSE', {}, control);
    await command(
      scoring.writerCookie,
      'CLOCK_SET',
      { remainingMs: 0, reason: '历史验收节末归零' },
      control,
    );
    await command(scoring.writerCookie, 'END_MATCH', {}, control);
    await command(cookie, 'CONFIRM_RESULT');
    await call(`${path}/scorekeeper-lease`, {
      method: 'DELETE',
      cookie: scoring.writerCookie,
      body: { control },
    });
  }
  let lifecycle = (await call(`${eventPath}/lifecycle`, { cookie })).data;
  assert.equal(lifecycle.completion.ready, true);
  assert.equal(lifecycle.completion.confirmedMatchCount, 3);
  const overlayPath = `${root}/matches/${scheduling.matches[1].id}/overlay`;
  const overlayWorkspace = (await call(overlayPath, { cookie })).data;
  const issued = (
    await call(`${root}/matches/${scheduling.matches[1].id}/overlay-commands`, {
      method: 'POST',
      cookie,
      body: {
        type: 'ISSUE',
        expectedEventVersion: overlayWorkspace.event.version,
        expiresInMinutes: 60,
      },
    })
  ).data;
  const credential = issued.credential;
  const bootstrap = await call(`/v1/overlays/${credential.overlayId}/bootstrap`, {
    method: 'POST',
    body: { token: credential.token },
  });
  const overlayCookie = bootstrap.response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(overlayCookie);
  async function lifecycleCommand(type) {
    lifecycle = (await call(`${eventPath}/lifecycle`, { cookie })).data;
    lifecycle = (
      await call(`${eventPath}/lifecycle-commands`, {
        method: 'POST',
        cookie,
        body: {
          type,
          expectedEventVersion: lifecycle.event.version,
          reason: `隔离恢复验证 ${type}`,
        },
      })
    ).data;
    return lifecycle;
  }
  async function historyCommand(type) {
    const current = (await call(`${eventPath}/standings`, { cookie })).data;
    return (
      await call(`${eventPath}/public-viewing-commands`, {
        method: 'POST',
        cookie,
        body: { type, expectedEventVersion: current.event.version },
      })
    ).data;
  }
  await lifecycleCommand('COMPLETE');
  assert.equal(lifecycle.event.status, 'COMPLETED');
  await assertPublicMissing(`/v1/public/events/${viewing.publicId}`);
  const firstHistory = await historyCommand('ENABLE_HISTORY');
  assert.equal(firstHistory.publication.purpose, 'HISTORY');
  const revokedHistoryId = firstHistory.publication.publicEventId;
  const revokedHistoryMatchId = (await call(`/v1/public/events/${revokedHistoryId}/schedule`))
    .data[0].publicMatchId;
  await lifecycleCommand('ARCHIVE');
  assert.equal((await call(`/v1/public/events/${revokedHistoryId}`)).data.status, 'ARCHIVED');
  await lifecycleCommand('REOPEN');
  assert.equal(lifecycle.event.status, 'RUNNING');
  await assertPublicMissing(`/v1/public/events/${revokedHistoryId}`);
  await lifecycleCommand('COMPLETE');
  const history = await historyCommand('ENABLE_HISTORY');
  assert.notEqual(history.publication.publicEventId, revokedHistoryId);
  await lifecycleCommand('ARCHIVE');
  const publicPath = `/v1/public/events/${history.publication.publicEventId}`;
  const summary = (await call(`${eventPath}/player-statistics`, { cookie })).data;
  assert.equal(summary.summary.totalMatchCount, 3);
  assert.equal(summary.summary.includedMatchCount, 2);
  assert.equal(summary.summary.teamOnlyConfirmedMatchCount, 1);
  assert.equal(summary.summary.pendingMatchCount, 0);
  assert.equal(summary.summary.coverageComplete, false);
  assert.equal(summary.summary.attributionComplete, false);
  assert.ok(summary.summary.rows.some((row) => row.score === 3));
  const closedWorkbench = (
    await call(`${root}/matches/${scheduling.matches[1].id}/scoring`, { cookie })
  ).data;
  assert.equal(closedWorkbench.capabilities.canReopen, false);
  const closedLease = await fetch(
    `${baseUrl}${root}/matches/${scheduling.matches[1].id}/scorekeeper-lease`,
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: scoring.writerCookie },
      body: JSON.stringify({ clientInstanceId: randomUUID() }),
    },
  );
  assert.equal(closedLease.status, 409, 'Archived event must not issue new scorer control');
  assert.equal((await closedLease.json()).error.code, 'INVALID_EVENT_STATE');
  const overlay = {
    ...credential,
    cookie: overlayCookie,
    matchId: scheduling.matches[1].id,
    workspace: (await call(overlayPath, { cookie })).data,
    snapshot: (
      await call(`/v1/overlays/${credential.overlayId}/snapshot`, { cookie: overlayCookie })
    ).data,
  };
  assert.deepEqual(
    overlay.workspace.currentGrant,
    issued.currentGrant,
    'History transitions must not renew or revoke the independent OBS grant',
  );
  const snapshots = [];
  for (const match of scheduling.matches)
    snapshots.push((await call(`${root}/matches/${match.id}/snapshot`, { cookie })).data);
  return {
    eventPath,
    court: scheduling.court,
    lifecycle: (await call(`${eventPath}/lifecycle`, { cookie })).data,
    privateStandings: (await call(`${eventPath}/standings`, { cookie })).data,
    summary,
    snapshots,
    overlay,
    liveId: viewing.publicId,
    liveMatchId: viewing.schedule[0].publicMatchId,
    revokedHistoryId,
    revokedHistoryMatchId,
    publicId: history.publication.publicEventId,
    overview: (await call(publicPath)).data,
    schedule: (await call(`${publicPath}/schedule`)).data,
    standings: (await call(`${publicPath}/standings`)).data,
  };
}

async function verifyLifecycle(saved, cookie, orgId) {
  const comparisons = [
    [(await call(`${saved.eventPath}/lifecycle`, { cookie })).data, saved.lifecycle],
    [(await call(`${saved.eventPath}/player-statistics`, { cookie })).data, saved.summary],
    [(await call(`${saved.eventPath}/standings`, { cookie })).data, saved.privateStandings],
    [(await call(`/v1/public/events/${saved.publicId}`)).data, saved.overview],
    [(await call(`/v1/public/events/${saved.publicId}/schedule`)).data, saved.schedule],
    [(await call(`/v1/public/events/${saved.publicId}/standings`)).data, saved.standings],
    [
      (await call(`/v1/orgs/${orgId}/matches/${saved.overlay.matchId}/overlay`, { cookie })).data,
      saved.overlay.workspace,
    ],
    [
      (
        await call(`/v1/overlays/${saved.overlay.overlayId}/snapshot`, {
          cookie: saved.overlay.cookie,
        })
      ).data,
      saved.overlay.snapshot,
    ],
  ];
  for (const snapshot of saved.snapshots)
    comparisons.push([
      (await call(`/v1/orgs/${orgId}/matches/${snapshot.matchId}/snapshot`, { cookie })).data,
      snapshot,
    ]);
  for (const [current, expected] of comparisons)
    assert.deepEqual(withoutReadTimes(current), withoutReadTimes(expected));
  assert.equal(saved.lifecycle.event.status, 'ARCHIVED');
  assert.equal(saved.privateStandings.publication.purpose, 'HISTORY');
  for (const [publicId, publicMatchId] of [
    [saved.liveId, saved.liveMatchId],
    [saved.revokedHistoryId, saved.revokedHistoryMatchId],
  ]) {
    for (const suffix of ['', '/schedule', '/standings', `/matches/${publicMatchId}`])
      await assertPublicMissing(`/v1/public/events/${publicId}${suffix}`);
  }
}

// A third, separately scheduled event exercises real byes and the append-only
// advancement proof across the same actual PostgreSQL restart/full restore.
async function finishSyntheticMatch(orgId, cookie, writer, matchId) {
  const root = `/v1/orgs/${orgId}`;
  const matchPath = `${root}/matches/${matchId}`;
  let workbench = (await call(`${matchPath}/scoring`, { cookie })).data;
  await call(`${matchPath}/staff/${writer.writerUserId}`, {
    method: 'PUT',
    cookie,
    body: { expectedMatchVersion: workbench.match.version, role: 'SCORER', status: 'ACTIVE' },
  });
  async function command(actor, type, payload = {}, control) {
    workbench = (await call(`${matchPath}/scoring`, { cookie: actor })).data;
    return (
      await call(`${matchPath}/commands`, {
        method: 'POST',
        cookie: actor,
        body: {
          commandId: randomUUID(),
          type,
          expectedVersion: workbench.match.version,
          capturedAt: new Date().toISOString(),
          payload: ['PREPARE_MATCH', 'START_MATCH'].includes(type)
            ? { ...payload, expectedEventVersion: workbench.event.version }
            : payload,
          ...(control ? { control } : {}),
        },
      })
    ).data;
  }
  const prepared = await command(cookie, 'PREPARE_MATCH', { collectionMode: 'PLAYER_BASIC' });
  const memberId = prepared.snapshot.playerStatistics.home.players[0].memberId;
  const lease = (
    await call(`${matchPath}/scorekeeper-lease`, {
      method: 'POST',
      cookie: writer.writerCookie,
      body: { clientInstanceId: randomUUID() },
    })
  ).data;
  const control = {
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    clientInstanceId: lease.clientInstanceId,
  };
  await command(writer.writerCookie, 'START_MATCH', {}, control);
  await command(
    writer.writerCookie,
    'RECORD_STAT',
    { kind: 'SCORE', side: 'HOME', value: 2, memberId },
    control,
  );
  await command(
    writer.writerCookie,
    'CLOCK_SET',
    { remainingMs: 0, reason: '淘汰赛恢复验证节末归零' },
    control,
  );
  await command(writer.writerCookie, 'END_MATCH', {}, control);
  await command(cookie, 'CONFIRM_RESULT');
  await call(`${matchPath}/scorekeeper-lease`, {
    method: 'DELETE',
    cookie: writer.writerCookie,
    body: { control },
  });
}
async function captureKnockout(orgId, cookie, suffix, existingRegistration, writer) {
  const registration = await captureRegistration(
    orgId,
    cookie,
    `${suffix}-knockout`,
    existingRegistration,
    'SINGLE_ELIMINATION',
  );
  const scheduling = await captureScheduling(orgId, cookie, registration);
  const root = `/v1/orgs/${orgId}`;
  const path = `${root}/events/${scheduling.workspace.event.id}`;
  await call(`${path}/scoring-rules`, {
    method: 'PUT',
    cookie,
    body: {
      expectedEventVersion: scheduling.workspace.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 60,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'OVERTIME',
      overtimeDurationSeconds: 60,
    },
  });
  const finish = (matchId) => finishSyntheticMatch(orgId, cookie, writer, matchId);
  await finish(scheduling.matches[0].id);
  let knockout = (await call(`${path}/knockout`, { cookie })).data;
  assert.equal(knockout.bracket.totalMatchCount, 2);
  assert.equal(knockout.bracket.publishedMatchCount, 1);
  assert.equal(knockout.bracket.rounds[0].slots.filter((s) => s.status === 'BYE').length, 1);
  assert.equal(
    (await call(`${path}/player-statistics`, { cookie })).data.summary.coverageComplete,
    false,
  );
  const live = (
    await call(`${path}/public-viewing-commands`, {
      method: 'POST',
      cookie,
      body: { type: 'ENABLE', expectedEventVersion: knockout.event.version },
    })
  ).data;
  const oldPublicId = live.publication.publicEventId;
  const oldMatchId = (await call(`/v1/public/events/${oldPublicId}/schedule`)).data[0]
    .publicMatchId;
  knockout = (await call(`${path}/knockout`, { cookie })).data;
  const next = knockout.bracket.nextRound;
  assert.equal(next.roundNo, 2);
  await call(`${path}/knockout-round-commands`, {
    method: 'POST',
    cookie,
    body: {
      type: 'PUBLISH_ROUND',
      expectedEventVersion: knockout.event.version,
      expectedSourceHash: next.sourceHash,
      roundNo: next.roundNo,
      reason: '独立确认晋级恢复验收',
      allocations: next.fixtures.map((f) => ({
        fixtureKey: f.fixtureKey,
        courtId: scheduling.court.id,
        startsAt: '2026-12-01T03:00:00.000Z',
      })),
    },
  });
  await assertPublicMissing(`/v1/public/events/${oldPublicId}`);
  const matches = (await call(`${path}/matches`, { cookie })).data;
  assert.equal(matches.length, 2);
  const original = (await call(`${root}/matches/${scheduling.matches[0].id}/scoring`, { cookie }))
    .data;
  assert.equal(
    original.capabilities.canReopen,
    false,
    'A published descendant pins its source result',
  );
  await finish(matches.find((m) => m.roundNo === 2).id);
  let lifecycle = (await call(`${path}/lifecycle`, { cookie })).data;
  assert.equal(lifecycle.completion.ready, true);
  for (const type of ['COMPLETE', 'ARCHIVE']) {
    lifecycle = (
      await call(`${path}/lifecycle-commands`, {
        method: 'POST',
        cookie,
        body: { type, expectedEventVersion: lifecycle.event.version, reason: '淘汰赛完整恢复验收' },
      })
    ).data;
  }
  const history = (
    await call(`${path}/public-viewing-commands`, {
      method: 'POST',
      cookie,
      body: { type: 'ENABLE_HISTORY', expectedEventVersion: lifecycle.event.version },
    })
  ).data;
  const publicId = history.publication.publicEventId;
  const publicPath = `/v1/public/events/${publicId}`;
  const bracket = (await call(`${publicPath}/knockout`)).data;
  assert.equal(bracket.isComplete, true);
  assert.deepEqual(
    bracket.placements.map((p) => p.rank),
    [1, 2, 3],
  );
  const proof = await instance.pool.query(
    'SELECT round_no,sources FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2',
    [orgId, scheduling.workspace.event.id],
  );
  assert.equal(proof.rows.length, 1);
  assert.equal(proof.rows[0].sources.length, 1);
  return {
    eventPath: path,
    court: scheduling.court,
    oldPublicId,
    oldMatchId,
    publicId,
    knockout: (await call(`${path}/knockout`, { cookie })).data,
    lifecycle: (await call(`${path}/lifecycle`, { cookie })).data,
    summary: (await call(`${path}/player-statistics`, { cookie })).data,
    overview: (await call(publicPath)).data,
    bracket,
    schedule: (await call(`${publicPath}/schedule`)).data,
    snapshots: await Promise.all(
      matches.map(async (m) => (await call(`${root}/matches/${m.id}/snapshot`, { cookie })).data),
    ),
    proof: proof.rows,
  };
}

async function captureGroups(orgId, cookie, suffix, existingRegistration, writer) {
  const registration = await captureRegistration(
    orgId,
    cookie,
    `${suffix}-groups`,
    existingRegistration,
    'GROUP_KNOCKOUT',
    4,
  );
  const scheduling = await captureScheduling(orgId, cookie, registration);
  const root = `/v1/orgs/${orgId}`;
  const path = `${root}/events/${scheduling.workspace.event.id}`;
  let work = (await call(`${path}/scoring`, { cookie })).data;
  await call(`${path}/scoring-rules`, {
    method: 'PUT',
    cookie,
    body: {
      expectedEventVersion: work.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 60,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'OVERTIME',
      overtimeDurationSeconds: 60,
    },
  });
  for (const match of scheduling.matches)
    await finishSyntheticMatch(orgId, cookie, writer, match.id);
  let groups = (await call(`${path}/groups`, { cookie })).data;
  assert.equal(groups.competition.qualification.status, 'READY');
  const oldGrant = (
    await call(`${path}/public-viewing-commands`, {
      method: 'POST',
      cookie,
      body: { type: 'ENABLE', expectedEventVersion: groups.event.version },
    })
  ).data;
  const oldPublicId = oldGrant.publication.publicEventId;
  groups = (await call(`${path}/groups`, { cookie })).data;
  const next = groups.competition.nextRound;
  await call(`${path}/group-qualification-commands`, {
    method: 'POST',
    cookie,
    body: {
      type: 'PUBLISH_QUALIFICATION',
      expectedEventVersion: groups.event.version,
      expectedSourceHash: next.sourceHash,
      reason: '分组资格真实数据库恢复验收',
      allocations: next.fixtures.map((f, i) => ({
        fixtureKey: f.fixtureKey,
        courtId: scheduling.court.id,
        startsAt: `2026-12-01T0${5 + i * 2}:00:00.000Z`,
      })),
    },
  });
  await assertPublicMissing(`/v1/public/events/${oldPublicId}`);
  let matches = (await call(`${path}/matches`, { cookie })).data;
  for (const match of matches.filter((m) => m.roundNo === 2))
    await finishSyntheticMatch(orgId, cookie, writer, match.id);
  groups = (await call(`${path}/groups`, { cookie })).data;
  const final = groups.competition.nextRound;
  assert.equal(final.roundNo, 3);
  await call(`${path}/knockout-round-commands`, {
    method: 'POST',
    cookie,
    body: {
      type: 'PUBLISH_ROUND',
      expectedEventVersion: groups.event.version,
      expectedSourceHash: final.sourceHash,
      roundNo: final.roundNo,
      reason: '分组接淘汰决赛恢复验收',
      allocations: final.fixtures.map((f) => ({
        fixtureKey: f.fixtureKey,
        courtId: scheduling.court.id,
        startsAt: '2026-12-01T09:00:00.000Z',
      })),
    },
  });
  matches = (await call(`${path}/matches`, { cookie })).data;
  await finishSyntheticMatch(orgId, cookie, writer, matches.find((m) => m.roundNo === 3).id);
  groups = (await call(`${path}/groups`, { cookie })).data;
  assert.equal(groups.competition.isComplete, true);
  assert.equal(groups.competition.totalMatchCount, 5);
  const original = (await call(`${root}/matches/${scheduling.matches[0].id}/scoring`, { cookie }))
    .data;
  assert.equal(original.capabilities.canReopen, false);
  let lifecycle = (await call(`${path}/lifecycle`, { cookie })).data;
  assert.equal(lifecycle.completion.ready, true);
  for (const type of ['COMPLETE', 'ARCHIVE'])
    lifecycle = (
      await call(`${path}/lifecycle-commands`, {
        method: 'POST',
        cookie,
        body: {
          type,
          expectedEventVersion: lifecycle.event.version,
          reason: '分组接淘汰完整闭环归档',
        },
      })
    ).data;
  const history = (
    await call(`${path}/public-viewing-commands`, {
      method: 'POST',
      cookie,
      body: { type: 'ENABLE_HISTORY', expectedEventVersion: lifecycle.event.version },
    })
  ).data;
  const publicId = history.publication.publicEventId;
  const publicPath = `/v1/public/events/${publicId}`;
  const publicGroups = (await call(`${publicPath}/groups`)).data;
  assert.equal(publicGroups.isComplete, true);
  const proof = (
    await instance.pool.query(
      'SELECT source_hash,sources,slots,fixtures FROM group_qualification_publications WHERE org_id=$1 AND event_id=$2',
      [orgId, scheduling.workspace.event.id],
    )
  ).rows;
  assert.equal(proof.length, 1);
  return {
    eventPath: path,
    court: scheduling.court,
    oldPublicId,
    publicId,
    groups: (await call(`${path}/groups`, { cookie })).data,
    lifecycle: (await call(`${path}/lifecycle`, { cookie })).data,
    summary: (await call(`${path}/player-statistics`, { cookie })).data,
    overview: (await call(publicPath)).data,
    publicGroups,
    schedule: (await call(`${publicPath}/schedule`)).data,
    proof,
  };
}
async function verifyGroups(saved, cookie, orgId) {
  const publicPath = `/v1/public/events/${saved.publicId}`;
  for (const [path, value] of [
    [`${saved.eventPath}/groups`, saved.groups],
    [`${saved.eventPath}/lifecycle`, saved.lifecycle],
    [`${saved.eventPath}/player-statistics`, saved.summary],
    [publicPath, saved.overview],
    [`${publicPath}/groups`, saved.publicGroups],
    [`${publicPath}/schedule`, saved.schedule],
  ]) {
    const current = (await call(path, { ...(path.startsWith('/v1/public/') ? {} : { cookie }) }))
      .data;
    assert.deepEqual(withoutReadTimes(current), withoutReadTimes(value));
  }
  await assertPublicMissing(`/v1/public/events/${saved.oldPublicId}`);
  assert.deepEqual(
    (
      await instance.pool.query(
        'SELECT source_hash,sources,slots,fixtures FROM group_qualification_publications WHERE org_id=$1 AND event_id=$2',
        [orgId, saved.groups.event.id],
      )
    ).rows,
    saved.proof,
  );
}

async function fileBytes(path, cookie, range) {
  const response = await fetch(baseUrl + path, {
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(range ? { Range: range } : {}) },
  });
  assert.equal(response.status, range ? 206 : 200, `Media content ${path} status`);
  assert.match(response.headers.get('cache-control') ?? '', /(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return Buffer.from(await response.arrayBuffer());
}
async function captureMedia(orgId, cookie, registration, scheduling, scoring, viewing) {
  const root = `/v1/orgs/${orgId}`;
  const entry = registration.entries[0];
  const entryRoot = `${root}/entries/${entry.id}/media-files`;
  const doc = (
    await call(entryRoot, {
      method: 'POST',
      cookie: registration.leaderCookie,
      body: {
        purpose: 'PRIVATE_INSURANCE',
        fileName: 'synthetic-insurance.pdf',
        contentType: 'application/pdf',
        base64: syntheticPdf.toString('base64'),
        expectedEntryVersion: entry.version,
      },
    })
  ).data;
  const privatePath = `${entryRoot}/${doc.id}/content`;
  assert.deepEqual(await fileBytes(privatePath, registration.leaderCookie), syntheticPdf);
  assert.equal((await fetch(baseUrl + privatePath)).status, 401);
  const matchId = scoring.saved[1].id;
  const matchRoot = `${root}/matches/${matchId}`;
  const files = [];
  const items = [];
  for (const [kind, purpose, fileName, contentType, bytes] of [
    ['IMAGE', 'MATCH_IMAGE', 'synthetic-image.png', 'image/png', syntheticPng],
    ['VIDEO', 'MATCH_VIDEO', 'synthetic-video.mp4', 'video/mp4', syntheticMp4],
  ]) {
    const file = (
      await call(`${matchRoot}/media-files`, {
        method: 'POST',
        cookie,
        body: { purpose, fileName, contentType, base64: bytes.toString('base64') },
      })
    ).data;
    const path = `${matchRoot}/media-files/${file.id}/content`;
    assert.deepEqual(await fileBytes(path, cookie), bytes);
    let item = (
      await call(`${matchRoot}/media`, {
        method: 'POST',
        cookie,
        body: {
          kind,
          title: kind === 'VIDEO' ? '合成视频片段' : '合成比赛图片',
          fileId: file.id,
          rightsDeclaration: '本素材为隔离验收自行生成，不含真实人员资料',
        },
      })
    ).data;
    if (kind === 'VIDEO') {
      const work = (await call(`${matchRoot}/media`, { cookie })).data;
      const source =
        work.sourceEvents.find((e) => e.type === 'STAT_RECORDED') ?? work.sourceEvents[0];
      assert.ok(source);
      await call(`${matchRoot}/media/${item.id}/markers`, {
        method: 'POST',
        cookie,
        body: {
          expectedVersion: item.version,
          expectedConfirmationId: work.currentConfirmationId,
          sourceEventId: source.id,
          label: '合成计分定位',
          startMs: 0,
          endMs: 500,
        },
      });
      item = (await call(`${matchRoot}/media`, { cookie })).data.media.find(
        (m) => m.id === item.id,
      );
    }
    item = (
      await call(`${matchRoot}/media/${item.id}/commands`, {
        method: 'POST',
        cookie,
        body: { type: 'PUBLISH', expectedVersion: item.version },
      })
    ).data;
    files.push({
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      length: bytes.length,
    });
    items.push(item);
  }
  const privateMatch = scheduling.matches.find((m) => m.id === matchId);
  const publicMatch = viewing.schedule.find(
    (m) => m.roundNo === privateMatch.roundNo && m.positionNo === privateMatch.positionNo,
  );
  assert.ok(publicMatch);
  const publicPath = `/v1/public/events/${viewing.publicId}/matches/${publicMatch.publicMatchId}/media`;
  const published = (await call(publicPath)).data;
  assert.equal(published.media.length, 2);
  for (const item of published.media) {
    assert.ok(item.contentPath);
    const bytes = await fileBytes(item.contentPath);
    assert.deepEqual(bytes, item.kind === 'VIDEO' ? syntheticMp4 : syntheticPng);
    assert.deepEqual(
      await fileBytes(item.contentPath, undefined, 'bytes=0-15'),
      bytes.subarray(0, 16),
    );
    assert.equal(Object.hasOwn(item, 'fileId'), false);
  }
  assert.equal(published.media.find((m) => m.kind === 'VIDEO').markers.length, 1);
  return {
    entryRoot,
    privatePath,
    privateHash: createHash('sha256').update(syntheticPdf).digest('hex'),
    files,
    publicPath,
    published,
    entryWorkspace: (await call(entryRoot, { cookie: registration.leaderCookie })).data,
    matchWorkspace: (await call(`${matchRoot}/media`, { cookie })).data,
    matchRoot,
  };
}
async function verifyMedia(saved, cookie, leaderCookie) {
  assert.equal(
    createHash('sha256')
      .update(await fileBytes(saved.privatePath, leaderCookie))
      .digest('hex'),
    saved.privateHash,
  );
  assert.equal((await fetch(baseUrl + saved.privatePath)).status, 401);
  for (const file of saved.files) {
    const bytes = await fileBytes(file.path, cookie);
    assert.equal(bytes.length, file.length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.deepEqual((await call(saved.publicPath)).data, saved.published);
  assert.deepEqual(
    (await call(saved.entryRoot, { cookie: leaderCookie })).data,
    saved.entryWorkspace,
  );
  assert.deepEqual((await call(`${saved.matchRoot}/media`, { cookie })).data, saved.matchWorkspace);
  for (const item of saved.published.media) {
    const expected = item.kind === 'VIDEO' ? syntheticMp4 : syntheticPng;
    assert.deepEqual(await fileBytes(item.contentPath), expected);
    assert.deepEqual(
      await fileBytes(item.contentPath, undefined, 'bytes=0-15'),
      expected.subarray(0, 16),
    );
  }
}

async function verifyKnockout(saved, cookie, orgId) {
  const comparisons = [
    [(await call(`${saved.eventPath}/knockout`, { cookie })).data, saved.knockout],
    [(await call(`${saved.eventPath}/lifecycle`, { cookie })).data, saved.lifecycle],
    [(await call(`${saved.eventPath}/player-statistics`, { cookie })).data, saved.summary],
    [(await call(`/v1/public/events/${saved.publicId}`)).data, saved.overview],
    [(await call(`/v1/public/events/${saved.publicId}/knockout`)).data, saved.bracket],
    [(await call(`/v1/public/events/${saved.publicId}/schedule`)).data, saved.schedule],
  ];
  for (const snapshot of saved.snapshots)
    comparisons.push([
      (await call(`/v1/orgs/${orgId}/matches/${snapshot.matchId}/snapshot`, { cookie })).data,
      snapshot,
    ]);
  for (const [actual, expected] of comparisons)
    assert.deepEqual(withoutReadTimes(actual), withoutReadTimes(expected));
  assert.deepEqual(
    (
      await instance.pool.query(
        'SELECT round_no,sources FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2',
        [orgId, saved.knockout.event.id],
      )
    ).rows,
    saved.proof,
  );
  for (const suffix of ['', '/schedule', '/knockout', `/matches/${saved.oldMatchId}`])
    await assertPublicMissing(`/v1/public/events/${saved.oldPublicId}${suffix}`);
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
    commerceSetup = await captureCommerceSetup({
      call,
      databaseUrl,
      maintenanceUrl: (await privateValue('SCB_CHECK_MAINTENANCE_URL')) ?? databaseUrl,
    });
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
    const rescheduling = await captureRescheduling(orgId, cookie, scheduling, viewing, overlays);
    const lifecycle = await captureLifecycle(orgId, cookie, suffix, frozenRegistration, scoring);
    const knockout = await captureKnockout(orgId, cookie, suffix, frozenRegistration, scoring);
    const groups = await captureGroups(orgId, cookie, suffix, frozenRegistration, scoring);
    const media = await captureMedia(
      orgId,
      cookie,
      frozenRegistration,
      scheduling,
      scoring,
      viewing,
    );
    const participantMaterials = await captureParticipantMaterials({
      call,
      readPool,
      orgId,
      ownerCookie: cookie,
      suffix,
    });
    // New purposes use their own fixtures. Finishing the main event's last unprepared
    // match would invalidate the independently captured rescheduling/viewing/OBS proofs.
    const x03Templates = await captureEventTemplates({ call, state: { orgId, cookie } });
    const x08Registration = await captureRegistration(orgId, cookie, `${suffix}-x08`);
    const x08Scheduling = await captureScheduling(orgId, cookie, x08Registration);
    await call(`/v1/orgs/${orgId}/events/${x08Scheduling.workspace.event.id}/scoring-rules`, {
      method: 'PUT',
      cookie,
      body: {
        expectedEventVersion: x08Scheduling.workspace.event.version,
        regulationPeriods: 1,
        periodDurationSeconds: 3600,
        allowedScoreValues: [1, 2, 3],
        tiePolicy: 'ALLOW_DRAW',
        overtimeDurationSeconds: null,
      },
    });
    const x08 = await captureX08Archive({
      call,
      state: { orgId, cookie, scoring, scheduling: x08Scheduling },
      readPool,
      assertPublicMissing,
    });
    const x05 = await captureX05Recruitment({
      call,
      state: {
        orgId,
        cookie,
        userId: registration.data.user.id,
        registration: frozenRegistration,
        scheduling,
        scoring,
      },
      readPool,
      assertPublicMissing,
      fetchFile: (route, actorCookie) =>
        fetch(baseUrl + route, { headers: { Cookie: actorCookie } }),
    });
    const fixtureState = {
      orgId,
      cookie,
      userId: registration.data.user.id,
      registration: frozenRegistration,
      scheduling,
      scoring,
      commerce: { operators: commerceSetup.operators },
    };
    const x18 = await captureX18Governance({
      call,
      state: fixtureState,
      readPool,
      fetchFile: (route, actorCookie) =>
        fetch(baseUrl + route, { headers: { Cookie: actorCookie } }),
    });
    const x12 = await captureX12Local({ call, state: fixtureState, readPool, assertPublicMissing });
    const completedService = await captureX12CompletedService({
      call,
      state: fixtureState,
      readPool,
      saved: x12,
    });
    const x18Review = await captureCompletedReview(fixtureState, completedService);
    x18.coverage.verifiedBookingReview = true;
    const x22 = await captureX22AccountRecovery({
      call,
      state: fixtureState,
      runtimePool: instance.pool,
      readPool,
      databaseUrl,
      appOrigin: origin,
      requireRuntimeRole: !!remoteUrl,
    });
    const x02Registration = await captureRegistration(
      orgId,
      cookie,
      `${suffix}-x02`,
      frozenRegistration,
      'ROUND_ROBIN',
      3,
      (event) => configureX02AdjudicationRules({ call, state: fixtureState, event }),
    );
    const x02Scheduling = await captureScheduling(orgId, cookie, x02Registration);
    const x02 = await captureX02Adjudication({
      call,
      state: { ...fixtureState, x02Scheduling },
      readPool,
    });
    const materialBytesBeforeExpansion = (
      await readPool.query(
        'SELECT COALESCE(sum(payload_byte_length),0)::int AS used FROM participant_material_revisions WHERE org_id=$1 AND payload_ciphertext IS NOT NULL',
        [orgId],
      )
    ).rows[0].used;
    const expansion = await captureExpansion({
      call,
      state: {
        cookie,
        userId: registration.data.user.id,
        orgId,
        registration: frozenRegistration,
        scheduling,
        scoring,
        commerce: { operators: commerceSetup.operators },
      },
      runtimePool: instance.pool,
      readPool,
      databaseUrl,
      appOrigin: origin,
      participantDataKey,
      requireRuntimeRole: !!remoteUrl,
      createScheduledSource: async (actor, writer) => {
        const registration = await captureRegistration(orgId, cookie, `${suffix}-expansion-live`, {
          leaderCookie: actor.cookie,
          leaderSession: actor.session,
        });
        const schedule = await captureScheduling(orgId, cookie, registration);
        const results = await captureScoring(orgId, cookie, schedule, `${suffix}-expansion-live`, {
          writerUserId: writer.id,
          writerCookie: writer.cookie,
        });
        return { ...schedule, highlightMatchId: results.saved[1].id };
      },
    });
    const materialBytesAfterExpansion = (
      await readPool.query(
        'SELECT COALESCE(sum(payload_byte_length),0)::int AS used FROM participant_material_revisions WHERE org_id=$1 AND payload_ciphertext IS NOT NULL',
        [orgId],
      )
    ).rows[0].used;
    const expansionMaterialBytes = materialBytesAfterExpansion - materialBytesBeforeExpansion;
    assert.ok(
      expansionMaterialBytes > 0,
      'Independent insurance/youth fixtures must retain additional encrypted material',
    );
    const commerce = await captureCommerceEnd({
      call,
      cookie,
      orgId,
      eventId: created.data.id,
      setup: commerceSetup,
      organizationReviewerId: commerceSetup.operators[0].userId,
    });
    // Every byte-producing fixture is complete now. Media DTO usage is org-wide and
    // therefore includes the later C23 ciphertext; retain its exact final baseline.
    const previousMediaUsedBytes = media.matchWorkspace.usage.usedBytes;
    media.entryWorkspace = (
      await call(media.entryRoot, { cookie: frozenRegistration.leaderCookie })
    ).data;
    media.matchWorkspace = (await call(`${media.matchRoot}/media`, { cookie })).data;
    assert.deepEqual(media.entryWorkspace.usage, media.matchWorkspace.usage);
    assert.equal(
      media.matchWorkspace.usage.usedBytes,
      previousMediaUsedBytes + participantMaterials.snapshot.stored_length + expansionMaterialBytes,
      'Final shared media quota must include original C23 and independent insurance/youth ciphertext exactly once',
    );
    frozenRegistration.leaderSession = (
      await call('/v1/auth/session', { cookie: frozenRegistration.leaderCookie })
    ).data;
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
    const courts = (await call(`/v1/orgs/${orgId}/courts`, { cookie })).data;
    assert.deepEqual(
      courts.map((c) => c.id).sort(),
      [
        scheduling.court.id,
        lifecycle.court.id,
        knockout.court.id,
        groups.court.id,
        x08Scheduling.court.id,
        x12.courtId,
        x02Scheduling.court.id,
        expansion.streaming.courtId,
      ].sort(),
      'Capture every original and explicitly added owned court with no extra rows',
    );
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
      rescheduling,
      lifecycle,
      knockout,
      groups,
      media,
      commerce,
      participantMaterials,
      x03Templates,
      x08,
      x05,
      x18,
      x18Review,
      x12,
      x22,
      x02,
      courts,
      participantKeyFixtureDatabase,
      expansion,
      completionTableCounts: await completionTableCounts(),
      fingerprint: await fingerprint(),
    };
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log(
      'Captured sessions, frozen registration, schedule, raw clock, TEAM_ONLY and PLAYER_BASIC results with attributed/unassigned points and confirmation history, standings, public identities, independent active/revoked overlay grants and read sessions, closed/archived event history, explicit HISTORY grants, private player summary/sourceHash, and the isolated database fingerprint.',
    );
  } else if (mode === 'quarantine') {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    await verifyParticipantQuarantine({ readPool, saved: state.participantMaterials });
    await verifyX08ArchiveQuarantine({ readPool, saved: state.x08, assertPublicMissing });
    await verifyX05RecruitmentQuarantine({ readPool, saved: state.x05, assertPublicMissing });
    await verifyX18GovernanceQuarantine({ readPool, saved: state.x18, assertPublicMissing });
    await verifyCompletedReview(state.x18Review, true);
    assertExpansionQuarantineCounts(state.completionTableCounts, await completionTableCounts());
    await verifyExpansionQuarantine({ readPool, saved: state.expansion, baseUrl });
    await verifyX22AccountRecoveryQuarantine({ readPool, saved: state.x22 });
    await verifyX02AdjudicationQuarantine({ readPool, saved: state.x02 });
    await verifyX12LocalQuarantine({ readPool, saved: state.x12, assertPublicMissing });
    const denied = await fetch(baseUrl + state.participantMaterials.materialPath + '/mine', {
      headers: { Cookie: state.participantMaterials.cookie },
    });
    assert.equal(denied.status, 401);
    console.log(
      'Restored participant consent was withdrawn; ciphertext and permanent request tombstones retained, old session rejected.',
    );
  } else if (mode === 'freeze') {
    // The caller has stopped every API writer before this point and keeps them stopped until dump finishes.
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    await verifyExpansion({ readPool, saved: state.expansion });
    state.fingerprint = await fingerprint();
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log('Captured the quiescent full manifest-table backup baseline.');
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
    assert.deepEqual(
      (
        await call(`/v1/orgs/${state.orgId}/matches/${state.rescheduling.match.id}/rescheduling`, {
          cookie: state.cookie,
        })
      ).data,
      state.rescheduling,
      'Current plan, versions and both immutable reschedules survive restart and full restore',
    );
    const courts = await call(`/v1/orgs/${state.orgId}/courts`, { cookie: state.cookie });
    const byId = (a, b) => a.id.localeCompare(b.id);
    assert.deepEqual(
      [...courts.data].sort(byId),
      [...state.courts].sort(byId),
      'All owned scenario courts survive restart and full restore without extra rows',
    );
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
      // Includes the PLAYER_BASIC roster, personal/unassigned totals and latest
      // confirmation, as well as the unchanged legacy TEAM_ONLY representation.
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
    await verifyLifecycle(state.lifecycle, state.cookie, state.orgId);
    await verifyKnockout(state.knockout, state.cookie, state.orgId);
    await verifyGroups(state.groups, state.cookie, state.orgId);
    await verifyMedia(state.media, state.cookie, state.registration.leaderCookie);
    await verifyCommerce({ call, saved: state.commerce, cookie: state.cookie, orgId: state.orgId });
    assert.equal(await fingerprint(), state.fingerprint);
    await verifyExpansion({ readPool, saved: state.expansion });
    await verifyEventTemplates({ call, state });
    await verifyX08Archive({ call, state, readPool, saved: state.x08, assertPublicMissing });
    await verifyX05Recruitment({
      call,
      state,
      readPool,
      saved: state.x05,
      fetchFile: (route, actorCookie) =>
        fetch(baseUrl + route, { headers: { Cookie: actorCookie } }),
    });
    await verifyX18Governance({
      call,
      state,
      readPool,
      saved: state.x18,
      fetchFile: (route, actorCookie) =>
        fetch(baseUrl + route, { headers: { Cookie: actorCookie } }),
    });
    await verifyX22AccountRecovery({ readPool, saved: state.x22 });
    await verifyCompletedReview(state.x18Review);
    assert.deepEqual(await completionTableCounts(), state.completionTableCounts);
    await verifyX02Adjudication({ readPool, saved: state.x02 });
    await verifyX12Local({ call, state, readPool, saved: state.x12, assertPublicMissing });
    await verifyParticipantMaterials({
      call,
      readPool,
      saved: state.participantMaterials,
      fetchFile: (route, cookie) => fetch(baseUrl + route, { headers: { Cookie: cookie } }),
    });
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
      'PostgreSQL restart retained sessions, grants, frozen rosters, schedule/reservations, scoring rules/events/receipts/results including TEAM_ONLY and PLAYER_BASIC attribution and confirmation history, raw clock and monotonic fence, standings/source hashes, public identities, independent overlay grants/read sessions/revocation and exact expiry, closed/archived event history with permanent old-key revocation, private player summary/sourceHash and independent OBS grant, audit and migration checksums across every manifest table.',
    );
  }
} finally {
  await instance.app?.close();
  await instance.pool.end();
  if (readPool !== instance.pool) await readPool.end();
}

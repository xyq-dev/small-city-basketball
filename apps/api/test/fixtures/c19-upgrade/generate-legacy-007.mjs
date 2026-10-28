// Generator for the C19 legacy 001–007 upgrade fixture (legacy-007.json).
//
// It is NOT run by the test suite. It drives the REAL historical API, built from commit
// 1534216 (the last commit whose migration set is exactly 001–007), over loopback HTTP
// against an owned, isolated PostgreSQL database migrated by that historical code, and
// then exports every persisted row of every table exactly (to_jsonb text, ordered).
//
// Usage (all paths absolute; nothing here is a production endpoint):
//   git worktree add --detach <tmp>/hist-007 1534216      # then build apps/api there
//   TEST_DATABASE_URL=<owned scb_test_* control DB> \
//   HIST_API_DIST=<tmp>/hist-007/apps/api/dist \
//   node apps/api/test/fixtures/c19-upgrade/generate-legacy-007.mjs
//
// Every identity, team, password and token is synthetic and valid only inside the
// throw-away database the generator creates and drops again.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const HISTORICAL_COMMIT = '1534216';
const ORIGIN = 'https://legacy.example.test';
const PASSWORD = 'Scb legacy 007 synthetic password 2026';
const out = new URL('./legacy-007.json', import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const base = new URL(process.env.TEST_DATABASE_URL ?? '');
if (!/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(base.pathname.slice(1))))
  throw new Error('TEST_DATABASE_URL must name an owned scb_test_* control database');
const dist = process.env.HIST_API_DIST;
if (!dist) throw new Error('HIST_API_DIST must point at the built historical apps/api/dist');
const load = (file) => import(pathToFileURL(`${dist}/${file}`).href);

const owned = `scb_test_c19_legacy_${randomBytes(6).toString('hex')}`;
const admin = new pg.Pool({ connectionString: base.href, max: 1 });
await admin.query(`CREATE DATABASE "${owned}"`);
const target = new URL(base);
target.pathname = '/' + owned;

let instance;
try {
  const { migrate } = await load('database/migrate.js');
  const { createApi } = await load('app.js');
  const { bootstrapOwner } = await load('bootstrap-owner.js');
  const schemaPool = new pg.Pool({ connectionString: target.href, max: 1 });
  const applied = await migrate(schemaPool);
  await schemaPool.end();
  if (applied.length !== 7) throw new Error('historical migrate() must apply exactly 001–007');
  // 30-day sessions (the historical maximum) keep the replayed credentials checkable later.
  instance = await createApi({
    databaseUrl: target.href,
    appOrigin: ORIGIN,
    participantRegistrationEnabled: true,
    sessionTtlSeconds: 2592000,
  });
  await instance.app.listen(0, '127.0.0.1');
  const url = (await instance.app.getUrl()).replace('[::1]', '127.0.0.1');

  async function call(route, { method = 'GET', body, cookie, expect = [200, 201] } = {}) {
    const response = await fetch(url + route, {
      method,
      headers: {
        Origin: ORIGIN,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!expect.includes(response.status))
      throw new Error(`${method} ${route} -> ${response.status} ${JSON.stringify(payload)}`);
    const set = response.headers.getSetCookie()[0];
    return { status: response.status, data: payload?.data, cookie: set?.split(';')[0] };
  }

  const owner = await bootstrapOwner(instance.pool, {
    email: 'legacy-owner@example.test',
    password: PASSWORD,
    displayName: '历史合成负责人',
    organizationName: '历史合成篮协',
  });
  const org = owner.organizationId;
  const root = `/v1/orgs/${org}`;
  const login = async (email) =>
    (await call('/v1/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).cookie;
  const ownerCookie = await login('legacy-owner@example.test');
  const people = {};
  for (const [key, email, name] of [
    ['leader', 'legacy-leader@example.test', '历史合成领队'],
    ['scorer', 'legacy-scorer@example.test', '历史合成记分员'],
    ['invitee', 'legacy-invitee@example.test', '历史合成受邀人'],
  ]) {
    const r = await call('/v1/auth/register-participant', {
      method: 'POST',
      body: { email, password: PASSWORD, displayName: name },
    });
    people[key] = { id: r.data.user.id, email, cookie: r.cookie };
  }
  await call(`${root}/members/${people.scorer.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { role: 'SCORER', status: 'ACTIVE' },
  });

  const event = (
    await call(`${root}/events`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name: '历史合成青锋杯',
        startDate: '2028-05-01',
        endDate: '2028-05-02',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
        venueName: '历史合成体育馆',
      },
    })
  ).data;
  const eventPath = `${root}/events/${event.id}`;
  const version = async () => (await call(eventPath, { cookie: ownerCookie })).data.version;
  await call(`${eventPath}/registration-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedVersion: await version(),
      minPlayers: 2,
      maxPlayers: 3,
      zeroAndDoubleZeroDistinct: false,
      requireIdentity: false,
      requireInsurance: false,
    },
  });
  const stage = async (type) =>
    (
      await call(`${eventPath}/registration-commands`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { type, expectedVersion: await version() },
      })
    ).data;
  await stage('OPEN_REGISTRATION');
  const teams = [];
  for (const name of ['历史合成石鼓', '历史合成猛龙']) {
    let team = (
      await call(`${root}/teams`, { method: 'POST', cookie: ownerCookie, body: { name } })
    ).data;
    team = (
      await call(`${root}/teams/${team.id}/members`, {
        method: 'PUT',
        cookie: ownerCookie,
        body: {
          expectedVersion: team.version,
          members: [{ name: name + '甲' }, { name: name + '乙' }, { name: name + '丙' }],
        },
      })
    ).data;
    const issued = (
      await call(`${root}/teams/${team.id}/invitations`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { targetUserId: people.leader.id, expiresInHours: 24 },
      })
    ).data;
    await call(`/v1/invitations/${issued.invitation.id}/accept`, {
      method: 'POST',
      cookie: people.leader.cookie,
      body: { token: issued.token },
    });
    let entry = (
      await call(`${eventPath}/entries`, {
        method: 'POST',
        cookie: people.leader.cookie,
        body: { teamId: team.id },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/roster`, {
        method: 'PUT',
        cookie: people.leader.cookie,
        body: {
          expectedVersion: entry.version,
          players: team.members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 4) })),
        },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/commands`, {
        method: 'POST',
        cookie: people.leader.cookie,
        body: { type: 'SUBMIT', expectedVersion: entry.version },
      })
    ).data;
    await call(`${root}/entries/${entry.id}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'APPROVE', expectedVersion: entry.version },
    });
    teams.push(team);
  }
  await stage('CLOSE_REGISTRATION');
  const frozen = await stage('FREEZE_REGISTRATION');

  // A still-pending invitation: a valid, unaccepted legacy authorization.
  const pending = (
    await call(`${root}/teams/${teams[0].id}/invitations`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { targetUserId: people.invitee.id, expiresInHours: 168 },
    })
  ).data;

  // Schedule: one court, round-robin draft, explicit allocation, validate, publish.
  const court = (
    await call(`${root}/courts`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { name: '历史合成一号场' },
    })
  ).data;
  let revision = (
    await call(`${eventPath}/schedule-revisions`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: await version(),
        freezeId: frozen.freeze.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 0,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2028-05-01T00:00:00+08:00',
              endsAt: '2028-05-03T02:00:00+08:00',
            },
          ],
        },
      },
    })
  ).data;
  const versions = () => ({
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
  });
  revision = (
    await call(`${root}/schedule-revisions/${revision.id}/allocations`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        ...versions(),
        allocations: revision.fixtures.map((f, i) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: new Date(Date.parse('2028-05-01T09:00:00+08:00') + i * 3600000).toISOString(),
        })),
      },
    })
  ).data;
  const validation = (
    await call(`${root}/schedule-revisions/${revision.id}/validate`, {
      method: 'POST',
      cookie: ownerCookie,
      body: versions(),
    })
  ).data;
  if (validation.conflicts?.length) throw new Error('legacy schedule did not validate');
  await call(`${root}/schedule-revisions/${revision.id}/publish`, {
    method: 'POST',
    cookie: ownerCookie,
    body: versions(),
  });
  const [match] = (await call(`${eventPath}/matches?limit=50`, { cookie: ownerCookie })).data;

  await call(`${eventPath}/scoring-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedEventVersion: await version(),
      regulationPeriods: 1,
      periodDurationSeconds: 1,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'ALLOW_DRAW',
      overtimeDurationSeconds: null,
    },
  });
  const standings = (
    await call(`${eventPath}/standings-rules`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: await version(),
        winPoints: 3,
        lossPoints: 0,
        drawPoints: 1,
        tiebreakers: [],
      },
    })
  ).data;
  await call(`${eventPath}/standings-rule-commands`, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      type: 'PUBLISH_STANDINGS_RULES',
      rulesetId: standings.rules.id,
      expectedEventVersion: await version(),
    },
  });

  // Scoring through the real historical command API; every envelope is kept for replay.
  const matchBase = `${root}/matches/${match.id}`;
  const workbench = async (cookie = ownerCookie) =>
    (await call(`${matchBase}/scoring`, { cookie })).data;
  let wb = await workbench();
  await call(`${matchBase}/staff/${people.scorer.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { expectedMatchVersion: wb.match.version, role: 'SCORER', status: 'ACTIVE' },
  });
  const commands = [];
  async function command(actorKey, cookie, type, payload = {}, control) {
    const current = await workbench(cookie);
    const body = {
      commandId: randomUUID(),
      expectedVersion: current.match.version,
      capturedAt: new Date().toISOString(),
      type,
      payload,
      ...(control ? { control } : {}),
    };
    const result = (await call(`${matchBase}/commands`, { method: 'POST', cookie, body })).data;
    commands.push({ actor: actorKey, body, response: result });
    return result;
  }
  wb = await workbench();
  await command('owner', ownerCookie, 'PREPARE_MATCH', {
    expectedEventVersion: wb.event.version,
  });
  const lease = (
    await call(`${matchBase}/scorekeeper-lease`, {
      method: 'POST',
      cookie: people.scorer.cookie,
      body: { clientInstanceId: randomUUID() },
    })
  ).data;
  const control = {
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    clientInstanceId: lease.clientInstanceId,
  };
  wb = await workbench(people.scorer.cookie);
  await command(
    'scorer',
    people.scorer.cookie,
    'START_MATCH',
    { expectedEventVersion: wb.event.version },
    control,
  );
  await command(
    'scorer',
    people.scorer.cookie,
    'RECORD_STAT',
    { kind: 'SCORE', side: 'HOME', value: 2 },
    control,
  );
  const wrong = await command(
    'scorer',
    people.scorer.cookie,
    'RECORD_STAT',
    { kind: 'SCORE', side: 'AWAY', value: 3 },
    control,
  );
  await command(
    'scorer',
    people.scorer.cookie,
    'RECORD_STAT',
    { kind: 'FOUL', side: 'AWAY', value: 1 },
    control,
  );
  const events = (await call(`${matchBase}/scoring-events?limit=100`, { cookie: ownerCookie }))
    .data;
  const voided =
    events.find((e) => e.commandId === wrong.receipt?.commandId) ??
    events.find(
      (e) =>
        e.type === 'STAT_RECORDED' && e.payload?.side === 'AWAY' && e.payload?.kind === 'SCORE',
    );
  await command(
    'scorer',
    people.scorer.cookie,
    'VOID_STAT',
    { targetEventId: voided.id, reason: '历史合成：记错球队' },
    control,
  );
  await command('scorer', people.scorer.cookie, 'CLOCK_START', {}, control);
  await sleep(1300);
  await command('scorer', people.scorer.cookie, 'CLOCK_PAUSE', {}, control);
  await command('scorer', people.scorer.cookie, 'END_MATCH', {}, control);
  await call(`${matchBase}/scorekeeper-lease`, {
    method: 'DELETE',
    cookie: people.scorer.cookie,
    body: { control },
    expect: [200, 204],
  });
  const confirmed = await command('owner', ownerCookie, 'CONFIRM_RESULT');
  if (confirmed.snapshot.status !== 'FINAL') throw new Error('legacy match did not reach FINAL');

  // Public identity and a read-only overlay grant: the valid legacy authorizations.
  const viewing = (
    await call(`${eventPath}/public-viewing-commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'ENABLE', expectedEventVersion: await version() },
    })
  ).data;
  const publicEventId = viewing.publication.publicEventId;
  const overlayBench = (await call(`${matchBase}/overlay`, { cookie: ownerCookie })).data;
  const overlay = (
    await call(`${matchBase}/overlay-commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        type: 'ISSUE',
        expectedEventVersion: overlayBench.event.version,
        expiresInMinutes: 10080,
      },
    })
  ).data;
  // Bootstrap the overlay once: a live overlay session cookie exists in the legacy rows.
  const overlaySession = (
    await call(`/v1/overlays/${overlay.credential.overlayId}/bootstrap`, {
      method: 'POST',
      body: { token: overlay.credential.token },
    })
  ).cookie;
  const publicEvent = (await call(`/v1/public/events/${publicEventId}`)).data;
  const publicSchedule = (await call(`/v1/public/events/${publicEventId}/schedule?limit=50`)).data;
  const publicStandings = (await call(`/v1/public/events/${publicEventId}/standings`)).data;
  const publicMatchId = publicSchedule[0]?.publicMatchId;
  const publicMatch = publicMatchId
    ? (await call(`/v1/public/events/${publicEventId}/matches/${publicMatchId}`)).data
    : null;

  // One explicitly signed-out session: revoked before the upgrade, must stay revoked.
  const signedOut = await login('legacy-leader@example.test');
  await call('/v1/auth/logout', { method: 'POST', cookie: signedOut, expect: [200, 204] });

  // Export every table exactly. Generated columns are recomputed on load and excluded.
  const pool = instance.pool;
  const migrations = (await pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name'))
    .rows;
  const tableNames = (
    await pool.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
    )
  ).rows.map((r) => r.relname);
  const tables = {};
  for (const name of tableNames) {
    const columns = (
      await pool.query(
        "SELECT a.attname,a.attgenerated<>'' AS generated FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
        [name],
      )
    ).rows;
    const list = columns.map((c) => `"${c.attname}"`).join(',');
    const rows = (
      await pool.query(
        `SELECT to_jsonb(t)::text AS value FROM (SELECT ${list} FROM public."${name}") t ORDER BY to_jsonb(t)::text COLLATE "C"`,
      )
    ).rows.map((r) => r.value);
    const hash = createHash('sha256');
    for (const row of rows) hash.update(row).update('\n');
    tables[name] = {
      columns: columns.map((c) => c.attname),
      generated: columns.filter((c) => c.generated).map((c) => c.attname),
      rowCount: rows.length,
      sha256: hash.digest('hex'),
      rows: rows.map((r) => JSON.parse(r)),
    };
  }
  const fixture = {
    format: 'SCB_C19_LEGACY_007_V1',
    note: 'Generated by generate-legacy-007.mjs from the real historical API; synthetic data only.',
    historicalCommit: HISTORICAL_COMMIT,
    generatedAt: new Date().toISOString(),
    databaseTimeZone: (await pool.query('SHOW TimeZone')).rows[0].TimeZone,
    origin: ORIGIN,
    password: PASSWORD,
    organizationId: org,
    eventId: event.id,
    matchId: match.id,
    teamIds: teams.map((t) => t.id),
    users: {
      owner: { id: owner.userId, email: 'legacy-owner@example.test' },
      ...Object.fromEntries(
        Object.entries(people).map(([k, v]) => [k, { id: v.id, email: v.email }]),
      ),
    },
    credentials: {
      ownerSession: ownerCookie,
      scorerSession: people.scorer.cookie,
      leaderSession: people.leader.cookie,
      signedOutSession: signedOut,
      pendingInvitation: { id: pending.invitation.id, token: pending.token },
      overlay: { ...overlay.credential, session: overlaySession },
    },
    commands,
    public: {
      publicEventId,
      publicMatchId,
      event: publicEvent,
      schedule: publicSchedule,
      standings: publicStandings,
      match: publicMatch,
    },
    migrations,
    tables,
  };
  await writeFile(out, JSON.stringify(fixture, null, 1) + '\n');
  console.log(
    `legacy-007.json written: ${tableNames.length} tables, ${commands.length} commands, ` +
      `${Object.values(tables).reduce((n, t) => n + t.rowCount, 0)} rows`,
  );
} finally {
  await instance?.app.close().catch(() => {});
  await instance?.pool.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${owned}" WITH (FORCE)`);
  await admin.end();
}

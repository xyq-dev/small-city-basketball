import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Real-API checks for the native mini program: actual Page/utils code runs in the VM harness
// and every wx.request is forwarded to a real API on loopback, backed by an owned isolated
// PostgreSQL database. Never a production origin; the mini program's fixed origin is only
// rewritten inside this test transport.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
export const programRoot = path.join(root, 'apps', 'wechat');
const { createWx, loadPage } = require(
  path.join(programRoot, 'test', 'helpers', 'native-page.cjs'),
);
export const APP_ORIGIN = 'https://basketball.playhubs.cn';
export const PASSWORD = 'Scb wechat real api 2026 合成';

export function isolatedBase() {
  let url;
  try {
    url = new URL(process.env.TEST_DATABASE_URL ?? '');
  } catch {
    throw new Error('Real-API mini program checks require TEST_DATABASE_URL (scb_test_*)');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(name) ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Real-API mini program checks require an isolated scb_test_* database');
  return url;
}

/** Owned database + migrated schema + real API on 127.0.0.1. */
export async function startServer() {
  const base = isolatedBase();
  const owned = `${decodeURIComponent(base.pathname.slice(1)).slice(0, 30)}_w_${randomBytes(6).toString('hex')}`;
  assert.match(owned, /^scb_test_[A-Za-z0-9_]+$/);
  const admin = new pg.Pool({ connectionString: base.href, max: 1 });
  await admin.query(`CREATE DATABASE "${owned}"`);
  const target = new URL(base);
  target.pathname = '/' + owned;
  const { migrate } = await import('../../apps/api/dist/database/migrate.js');
  const { createApi } = await import('../../apps/api/dist/app.js');
  const { bootstrapOwner } = await import('../../apps/api/dist/bootstrap-owner.js');
  const schemaPool = new pg.Pool({ connectionString: target.href, max: 1 });
  await migrate(schemaPool);
  await schemaPool.end();
  const instance = await createApi({
    databaseUrl: target.href,
    appOrigin: APP_ORIGIN,
    participantRegistrationEnabled: true,
  });
  await instance.app.listen(0, '127.0.0.1');
  const url = (await instance.app.getUrl()).replace('[::1]', '127.0.0.1');
  return {
    url,
    pool: instance.pool,
    bootstrapOwner: (body) => bootstrapOwner(instance.pool, body),
    async grantOperator(email) {
      const { maintainPlatformOperator } =
        await import('../../apps/api/dist/commerce/platform-operator.js');
      await maintainPlatformOperator(instance.pool, {
        email,
        status: 'ACTIVE',
        reason: '隔离真实API联调的合成平台运营账号',
      });
    },
    async close() {
      await instance.app.close();
      await instance.pool.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${owned}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Direct HTTP for steps that remain Web-only (event setup, scheduling, staff assignment). */
export function http(server) {
  return async function call(route, { method = 'GET', body, cookie, expect = [200, 201] } = {}) {
    const response = await fetch(server.url + route, {
      method,
      headers: {
        Origin: APP_ORIGIN,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    assert.ok(
      expect.includes(response.status),
      `${method} ${route} -> ${response.status} ${JSON.stringify(payload && payload.error)}`,
    );
    const set = response.headers.getSetCookie()[0];
    return {
      status: response.status,
      data: payload?.data,
      meta: payload?.meta,
      cookie: set?.split(';')[0],
    };
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One device: one wx double and one shared api client, so the session cookie carries across
 * every page this actor opens, exactly as a single mini program instance would.
 */
export function device(server) {
  const app = { globalData: {} };
  const globals = { getApp: () => app };
  const modalAnswers = [];
  const navigations = [];
  const drops = [];
  let inflight = 0;
  const wx = createWx({
    modalAnswers,
    async request(options) {
      assert.ok(options.url.startsWith(APP_ORIGIN + '/v1/'), 'unexpected origin ' + options.url);
      inflight++;
      try {
        const response = await fetch(server.url + options.url.slice(APP_ORIGIN.length), {
          method: options.method || 'GET',
          headers: options.header,
          body:
            options.data === undefined || (options.method || 'GET') === 'GET'
              ? undefined
              : JSON.stringify(options.data),
        });
        const cookies = response.headers.getSetCookie();
        // Binary downloads (private file content) are returned as an ArrayBuffer, like wx.request.
        const binary = options.responseType === 'arraybuffer';
        const raw = binary ? await response.arrayBuffer() : await response.text();
        // Simulate a lost response: the server applied the request, the device never heard.
        const drop = drops.findIndex((match) => match(options));
        if (drop >= 0) {
          drops.splice(drop, 1);
          throw new Error('response lost');
        }
        return {
          statusCode: response.status,
          header: {
            ...(cookies.length ? { 'Set-Cookie': cookies.join(', ') } : {}),
            ...(binary ? { 'Content-Type': response.headers.get('content-type') || '' } : {}),
          },
          cookies,
          data: binary ? raw : raw ? JSON.parse(raw) : null,
        };
      } finally {
        inflight--;
      }
    },
  });
  const original = { navigateTo: wx.navigateTo, redirectTo: wx.redirectTo };
  wx.navigateTo = (options) => {
    navigations.push(options.url);
    original.navigateTo(options);
  };
  wx.redirectTo = (options) => {
    navigations.push(options.url);
    original.redirectTo(options);
  };
  const apiFile = path.join(programRoot, 'utils', 'api.js');
  const first = loadPage({ root: programRoot, route: 'pages/account/index', wx, globals });
  const apiModule = first.requireLocal('utils/api.js');
  const modules = { [apiFile]: apiModule };
  return {
    wx,
    modalAnswers,
    navigations,
    client: apiModule.getClient(),
    open(route, query = {}) {
      const h = loadPage({ root: programRoot, route, wx, modules, globals });
      h.page.onLoad?.(query);
      h.page.onShow?.();
      return h;
    },
    /** Wait until the real network is idle and the page is not busy for several ticks. */
    async settle(h, timeout = 15000) {
      const started = Date.now();
      let quiet = 0;
      while (Date.now() - started < timeout) {
        await sleep(15);
        const busy = h && (h.page.data.busy === true || h.page.data.loading === true);
        quiet = inflight === 0 && wx.pendingRequests === 0 && !busy ? quiet + 1 : 0;
        if (quiet >= 4) return;
      }
      throw new Error(
        'Page did not settle: ' +
          JSON.stringify({ inflight, busy: h?.page.data.busy, loading: h?.page.data.loading }),
      );
    },
    dropNextResponse(match) {
      drops.push(match);
    },
    approve(count = 1) {
      for (let i = 0; i < count; i++) modalAnswers.push(true);
    },
  };
}

/** Sign in through the real account page, as a person would. */
export async function signIn(d, email, password = PASSWORD) {
  const account = d.open('pages/account/index');
  await d.settle(account);
  account.page.setData({ email, password });
  account.page.login();
  await d.settle(account);
  assert.equal(account.page.data.user?.email, email, account.page.data.message);
  return account;
}
export async function register(d, email, displayName) {
  const account = d.open('pages/account/index');
  await d.settle(account);
  assert.equal(account.page.data.canRegister, true, 'participant registration must be enabled');
  account.page.setData({ email, password: PASSWORD, displayName, registerMode: true });
  account.page.register();
  await d.settle(account);
  assert.equal(account.page.data.user?.email, email, account.page.data.message);
  return account;
}
export const tap = (dataset = {}, detail = {}) => ({ currentTarget: { dataset }, detail });

/**
 * Optional self-review aid: with SCB_WECHAT_API_SNAPSHOTS=<dir>, write the static
 * compatibility rendering of a page's current real-API data. Not a WeChat runtime capture.
 */
export function snapshot(h, name) {
  const dir = process.env.SCB_WECHAT_API_SNAPSHOTS;
  if (!dir) return;
  const fs = require('node:fs');
  const { buildPreview } = require(path.join(programRoot, 'test', 'helpers', 'native-preview.cjs'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.data.json`),
    JSON.stringify({ route: h.page.route, data: h.page.data }, null, 2),
  );
  for (const width of [390, 320]) {
    const preview = buildPreview({
      root: programRoot,
      route: h.page.route,
      data: structuredClone(h.page.data),
      width,
      height: 844,
    });
    fs.writeFileSync(path.join(dir, `${name}-w${width}.html`), preview.phone);
  }
}

/**
 * C19: like startServer, with extra createApi options for the isolated service only (for
 * example a synthetic `media: { trustedExternalHosts }`). Never a production configuration.
 */
export async function startServerWith(options = {}) {
  const base = isolatedBase();
  const owned = `${decodeURIComponent(base.pathname.slice(1)).slice(0, 30)}_w_${randomBytes(6).toString('hex')}`;
  assert.match(owned, /^scb_test_[A-Za-z0-9_]+$/);
  const admin = new pg.Pool({ connectionString: base.href, max: 1 });
  await admin.query(`CREATE DATABASE "${owned}"`);
  const target = new URL(base);
  target.pathname = '/' + owned;
  const { migrate } = await import('../../apps/api/dist/database/migrate.js');
  const { createApi } = await import('../../apps/api/dist/app.js');
  const { bootstrapOwner } = await import('../../apps/api/dist/bootstrap-owner.js');
  const schemaPool = new pg.Pool({ connectionString: target.href, max: 1 });
  await migrate(schemaPool);
  await schemaPool.end();
  const instance = await createApi({
    databaseUrl: target.href,
    appOrigin: APP_ORIGIN,
    participantRegistrationEnabled: true,
    ...options,
  });
  await instance.app.listen(0, '127.0.0.1');
  const url = (await instance.app.getUrl()).replace('[::1]', '127.0.0.1');
  return {
    url,
    pool: instance.pool,
    bootstrapOwner: (body) => bootstrapOwner(instance.pool, body),
    async grantOperator(email) {
      const { maintainPlatformOperator } =
        await import('../../apps/api/dist/commerce/platform-operator.js');
      await maintainPlatformOperator(instance.pool, {
        email,
        status: 'ACTIVE',
        reason: '隔离真实API联调的合成平台运营账号',
      });
    },
    async close() {
      await instance.app.close();
      await instance.pool.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${owned}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** C19 fixture: owner + organization, the owner's HTTP cookie, and a call helper. */
export async function organizationFixture(server, organizationName = '合成高州篮协') {
  const call = http(server);
  const org = (
    await server.bootstrapOwner({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: '合成负责人',
      organizationName,
    })
  ).organizationId;
  const login = async (email) =>
    (await call('/v1/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).cookie;
  return {
    call,
    org,
    root: `/v1/orgs/${org}`,
    ownerCookie: await login('owner@example.test'),
    login,
  };
}

/**
 * C19 fixture (HTTP preparation only, never counted as page acceptance): an event with the
 * given teams registered by `leader` ({id, cookie}), approved and frozen. A spec is either
 * {name, members: [names]} (new team, leader invited) or {id} (existing team the leader runs).
 */
export async function frozenEventFixture(f, leader, teamSpecs, name = '合成青锋杯', month = '06') {
  const { call, root, ownerCookie } = f;
  const event = (
    await call(`${root}/events`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name,
        startDate: `2028-${month}-01`,
        endDate: `2028-${month}-02`,
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
        venueName: '合成体育馆',
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
  for (const spec of teamSpecs) {
    let team;
    if (spec.id) team = (await call(`${root}/teams/${spec.id}`, { cookie: ownerCookie })).data;
    else {
      team = (
        await call(`${root}/teams`, {
          method: 'POST',
          cookie: ownerCookie,
          body: { name: spec.name },
        })
      ).data;
      team = (
        await call(`${root}/teams/${team.id}/members`, {
          method: 'PUT',
          cookie: ownerCookie,
          body: { expectedVersion: team.version, members: spec.members.map((n) => ({ name: n })) },
        })
      ).data;
      const issued = (
        await call(`${root}/teams/${team.id}/invitations`, {
          method: 'POST',
          cookie: ownerCookie,
          body: { targetUserId: leader.id, expiresInHours: 1 },
        })
      ).data;
      await call(`/v1/invitations/${issued.invitation.id}/accept`, {
        method: 'POST',
        cookie: leader.cookie,
        body: { token: issued.token },
      });
    }
    let entry = (
      await call(`${eventPath}/entries`, {
        method: 'POST',
        cookie: leader.cookie,
        body: { teamId: team.id },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/roster`, {
        method: 'PUT',
        cookie: leader.cookie,
        body: {
          expectedVersion: entry.version,
          players: team.members
            .slice(0, 3)
            .map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 4) })),
        },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/commands`, {
        method: 'POST',
        cookie: leader.cookie,
        body: { type: 'SUBMIT', expectedVersion: entry.version },
      })
    ).data;
    await call(`${root}/entries/${entry.id}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'APPROVE', expectedVersion: entry.version },
    });
    teams.push({ ...team, entryId: entry.id });
  }
  await stage('CLOSE_REGISTRATION');
  const frozen = await stage('FREEZE_REGISTRATION');
  return { id: event.id, path: eventPath, teams, frozen, version };
}

/** C19 fixture (HTTP): publish a one-court schedule, 1-second scoring and standings rules. */
export async function publishedEventFixture(f, event) {
  const { call, root, ownerCookie } = f;
  const court = (
    await call(`${root}/courts`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { name: '合成场地-' + randomBytes(3).toString('hex') },
    })
  ).data;
  const month = event.frozen.event.startDate.slice(0, 7);
  let revision = (
    await call(`${event.path}/schedule-revisions`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: await event.version(),
        freezeId: event.frozen.freeze.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 0,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: `${month}-01T00:00:00+08:00`,
              endsAt: `${month}-03T02:00:00+08:00`,
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
        allocations: revision.fixtures.map((x, i) => ({
          fixtureKey: x.fixtureKey,
          courtId: court.id,
          startsAt: new Date(Date.parse(`${month}-01T09:00:00+08:00`) + i * 3600000).toISOString(),
        })),
      },
    })
  ).data;
  await call(`${root}/schedule-revisions/${revision.id}/validate`, {
    method: 'POST',
    cookie: ownerCookie,
    body: versions(),
  });
  await call(`${root}/schedule-revisions/${revision.id}/publish`, {
    method: 'POST',
    cookie: ownerCookie,
    body: versions(),
  });
  await call(`${event.path}/scoring-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedEventVersion: await event.version(),
      regulationPeriods: 1,
      periodDurationSeconds: 1,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'ALLOW_DRAW',
      overtimeDurationSeconds: null,
    },
  });
  const standings = (
    await call(`${event.path}/standings-rules`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: await event.version(),
        winPoints: 3,
        lossPoints: 0,
        drawPoints: 1,
        tiebreakers: [],
      },
    })
  ).data;
  await call(`${event.path}/standings-rule-commands`, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      type: 'PUBLISH_STANDINGS_RULES',
      rulesetId: standings.rules.id,
      expectedEventVersion: await event.version(),
    },
  });
  return (await call(`${event.path}/matches?limit=100`, { cookie: ownerCookie })).data;
}

/**
 * C19 fixture (HTTP): one scorer ({id, cookie}) records per-player scores, the organizer
 * confirms independently. `stats` items: { side: 'HOME'|'AWAY', value, memberId }.
 */
export async function finalMatchFixture(f, matchId, scorer, stats) {
  const { call, root, ownerCookie } = f;
  const base = `${root}/matches/${matchId}`;
  let wb = (await call(`${base}/scoring`, { cookie: ownerCookie })).data;
  if (!wb.staff.some((s) => s.userId === scorer.id && s.status === 'ACTIVE')) {
    await call(`${base}/staff/${scorer.id}`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { expectedMatchVersion: wb.match.version, role: 'SCORER', status: 'ACTIVE' },
    });
    wb = (await call(`${base}/scoring`, { cookie: ownerCookie })).data;
  }
  const command = async (cookie, expectedVersion, type, payload = {}, control) =>
    (
      await call(`${base}/commands`, {
        method: 'POST',
        cookie,
        body: {
          commandId: globalThis.crypto.randomUUID(),
          expectedVersion,
          type,
          payload,
          capturedAt: new Date().toISOString(),
          ...(control ? { control } : {}),
        },
      })
    ).data.snapshot;
  let snap = await command(ownerCookie, wb.match.version, 'PREPARE_MATCH', {
    expectedEventVersion: wb.event.version,
    collectionMode: 'PLAYER_BASIC',
  });
  const lease = (
    await call(`${base}/scorekeeper-lease`, {
      method: 'POST',
      cookie: scorer.cookie,
      body: { clientInstanceId: globalThis.crypto.randomUUID() },
    })
  ).data;
  const control = {
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    clientInstanceId: lease.clientInstanceId,
  };
  const eventVersion = (await call(`${base}/scoring`, { cookie: ownerCookie })).data.event.version;
  snap = await command(
    scorer.cookie,
    snap.version,
    'START_MATCH',
    { expectedEventVersion: eventVersion },
    control,
  );
  for (const s of stats)
    snap = await command(
      scorer.cookie,
      snap.version,
      'RECORD_STAT',
      { kind: 'SCORE', side: s.side, value: s.value, memberId: s.memberId },
      control,
    );
  snap = await command(scorer.cookie, snap.version, 'CLOCK_START', {}, control);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  snap = await command(scorer.cookie, snap.version, 'CLOCK_PAUSE', {}, control);
  snap = await command(scorer.cookie, snap.version, 'END_MATCH', {}, control);
  await call(`${base}/scorekeeper-lease`, {
    method: 'DELETE',
    cookie: scorer.cookie,
    body: { control },
    expect: [200, 204],
  });
  snap = await command(ownerCookie, snap.version, 'CONFIRM_RESULT');
  assert.equal(snap.status, 'FINAL');
  return snap;
}

/** C19 fixture (HTTP): enable public viewing; returns the public event id. */
export async function enableViewingFixture(f, event) {
  const r = await f.call(`${event.path}/public-viewing-commands`, {
    method: 'POST',
    cookie: f.ownerCookie,
    body: { type: 'ENABLE', expectedEventVersion: await event.version() },
  });
  return r.data.publication.publicEventId;
}

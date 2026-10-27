import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type {
  EventDirectoryData,
  EventKnockoutData,
  EventScoringData,
  PublicDirectoryEventData,
  TeamData,
} from '@small-city-basketball/contracts';
import { call, data, error, staff } from './support.js';
import type { User } from './support.js';
import { allocate, court, frozen, fullAllocations, publish, revision } from './p04-support.js';
import { defaultRules, scoringRulesPath } from './p05-support.js';
import {
  anonymous,
  closeHarness,
  confirmMatch,
  createScoringHarness,
  disable,
  enable,
  liveMatch,
  privateStandings,
  publicEventPath,
  published,
  savePublishRules,
  viewingCommand,
} from './p05b-support.js';
import type { Harness, PublishedFixture } from './p05b-support.js';
import {
  confirmKnockoutMatch,
  knockoutFixture,
  publishRound,
  readKnockout,
  roundInput,
} from './c04-support.js';

// C18 public event directory on isolated PostgreSQL: explicit listing only, anonymous
// whitelisted keyset pages, automatic withdrawal with every publication revocation and
// organization disable, and CAS/audit/concurrency behaviour of LIST/UNLIST.
const WHITELIST = [
  'publicEventId',
  'name',
  'startDate',
  'endDate',
  'venueName',
  'status',
  'purpose',
  'displayCity',
].sort();

describe('C18 public event directory on isolated PostgreSQL', { concurrent: false }, () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(8);
  }, 180000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  // The anonymous limiter (60/min per client IP) is exercised by its own test; other tests
  // start from an empty window so their own reads never trip it.
  beforeEach(async () => {
    await h.api.pool.query("DELETE FROM auth_rate_limits WHERE key LIKE 'directory-ip:%'");
  });

  const base = (eventId: string, org = h.owner.orgId) => `/v1/orgs/${org}/events/${eventId}`;
  const reject = (response: Response, status: number, code?: string) => {
    error(response, status);
    if (code) expect(response.body.error.code).toBe(code);
  };
  const directory = async (eventId: string, actor: User = h.owner) =>
    data<EventDirectoryData>(
      await call(h.api, 'get', `${base(eventId)}/directory`, { cookie: actor.cookie }),
    );
  const command = async (
    eventId: string,
    type: 'LIST' | 'UNLIST',
    extra: Record<string, unknown> = {},
    actor: User = h.owner,
    expectedEventVersion?: number,
  ) =>
    call(h.api, 'post', `${base(eventId)}/directory-commands`, {
      cookie: actor.cookie,
      body: {
        type,
        expectedEventVersion: expectedEventVersion ?? (await directory(eventId)).event.version,
        reason: '合成目录操作原因',
        ...extra,
      },
    });
  const list = async (eventId: string, displayCity?: string) =>
    data<EventDirectoryData>(
      await command(eventId, 'LIST', displayCity === undefined ? {} : { displayCity }),
    );
  const page = (query = '') => anonymous(h, `/v1/public/directory${query}`);
  const ids = async (query = '') =>
    data<PublicDirectoryEventData[]>(await page(query)).map((e) => e.publicEventId);
  const listings = async (eventId: string) =>
    (
      await h.api.pool.query(
        'SELECT * FROM event_directory_listings WHERE event_id=$1 ORDER BY listed_at,id',
        [eventId],
      )
    ).rows;
  const lifecycle = async (eventId: string, type: 'COMPLETE' | 'ARCHIVE' | 'REOPEN') =>
    data(
      await call(h.api, 'post', `${base(eventId)}/lifecycle-commands`, {
        cookie: h.owner.cookie,
        body: {
          type,
          expectedEventVersion: (await privateStandings(h, eventId)).event.version,
          reason: '合成赛事生命周期',
        },
      }),
    );

  /** Round-robin event with locked standings and LIVE public viewing (UPCOMING group). */
  async function upcoming(teams: TeamData[], startDate?: string) {
    const registration = await frozen(h, h.owner, teams, startDate ? { startDate } : {});
    const resource = await court(h.api, h.owner, '目录场地');
    let schedule = await revision(h.api, h.owner, registration, [resource]);
    schedule = await allocate(
      h.api,
      h.owner,
      schedule,
      fullAllocations(schedule, resource, `${registration.event.startDate}T09:00:00+08:00`),
    );
    const publication = data<{ event: { version: number } }>(
      await publish(h.api, h.owner, schedule),
    );
    data<EventScoringData>(
      await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
        cookie: h.owner.cookie,
        body: { expectedEventVersion: publication.event.version, ...defaultRules() },
      }),
    );
    const eventId = registration.event.id;
    await savePublishRules(h, eventId);
    const viewing = await enable(h, eventId);
    return { eventId, publicEventId: viewing.publication!.publicEventId };
  }
  /** One-match round robin ready for completion (LIVE publication). */
  async function finishedEvent(teams: TeamData[]) {
    const fixture: PublishedFixture = await published(h, teams);
    const eventId = fixture.event.event.id;
    await savePublishRules(h, eventId);
    const viewing = await enable(h, eventId);
    return { fixture, eventId, publicEventId: viewing.publication!.publicEventId };
  }

  test('enabling public viewing lists nothing; only managers list; inputs and the public whitelist are strict', async () => {
    const { eventId, publicEventId } = await upcoming(h.teams.slice(0, 2));
    expect(await ids('?status=UPCOMING')).not.toContain(publicEventId);
    const before = await directory(eventId);
    expect(before).toMatchObject({
      group: 'UPCOMING',
      listing: null,
      capabilities: { canList: true, canUnlist: false },
    });
    // No membership: hidden. A scorer on the event: visible but not allowed. Cross-org path: hidden.
    reject(
      await call(h.api, 'get', `${base(eventId)}/directory`, { cookie: h.leader.cookie }),
      404,
    );
    reject(await command(eventId, 'LIST', {}, h.leader, before.event.version), 404);
    await staff(h.api, h.owner, { id: eventId } as never, h.otherOwner, 'SCORER');
    reject(await command(eventId, 'LIST', {}, h.otherOwner), 403, 'FORBIDDEN');
    reject(
      await call(h.api, 'post', `${base(eventId, h.otherOwner.orgId)}/directory-commands`, {
        cookie: h.otherOwner.cookie,
        body: { type: 'LIST', expectedEventVersion: before.event.version, reason: '跨机构尝试' },
      }),
      404,
    );
    for (const [extra, field] of [
      [{ displayCity: '茂名!' }, 'city'],
      [{ displayCity: '一二三四五六七八九十一二三四五六七八九十一' }, 'city'],
      [{ reason: '短' }, 'reason'],
      [{ note: 'x' }, 'unknown'],
    ] as const)
      (reject(await command(eventId, 'LIST', extra), 422, 'VALIDATION_ERROR'), void field);
    reject(await command(eventId, 'UNLIST', { displayCity: '茂名' }), 422);
    expect(await listings(eventId)).toHaveLength(0);
    // An event EVENT_MANAGER may list; the city is normalized.
    await staff(h.api, h.owner, { id: eventId } as never, h.otherOwner, 'EVENT_MANAGER');
    const version = (await directory(eventId)).event.version;
    const listed = data<EventDirectoryData>(
      await command(eventId, 'LIST', { displayCity: ' 茂名　 高州 ' }, h.otherOwner, version),
    );
    expect(listed.event.version).toBe(version + 1);
    expect(listed.listing).toMatchObject({
      status: 'ACTIVE',
      displayCity: '茂名 高州',
      publicEventId,
    });
    expect(listed.capabilities).toEqual({ canList: false, canUnlist: true });
    const audit = await h.api.pool.query(
      "SELECT actor_id,metadata FROM audit_logs WHERE resource_id=$1 AND action='directory.listed'",
      [eventId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(h.otherOwner.id);
    expect(audit.rows[0].metadata).toMatchObject({
      reason: '合成目录操作原因',
      eventVersion: version + 1,
    });
    reject(await command(eventId, 'LIST'), 409, 'DIRECTORY_ALREADY_LISTED');
    // Anonymous: exact whitelist, no cookie read or set, same result with any cookie.
    const anonymousPage = await page('?status=UPCOMING&city=' + encodeURIComponent('茂名 高州'));
    expect(anonymousPage.headers['set-cookie']).toBeUndefined();
    expect(anonymousPage.headers['cache-control']).toBe('no-store');
    const rows = data<PublicDirectoryEventData[]>(anonymousPage);
    expect(rows.map((r) => r.publicEventId)).toEqual([publicEventId]);
    expect(Object.keys(rows[0]!).sort()).toEqual(WHITELIST);
    expect(rows[0]).toMatchObject({
      status: 'SCHEDULED',
      purpose: 'LIVE',
      displayCity: '茂名 高州',
    });
    expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|合成目录操作原因/);
    const withCookie = await anonymous(
      h,
      '/v1/public/directory?status=UPCOMING&city=' + encodeURIComponent('茂名 高州'),
      h.owner.cookie,
    );
    expect(data<PublicDirectoryEventData[]>(withCookie)).toEqual(rows);
    expect(withCookie.headers['set-cookie']).toBeUndefined();
  });

  test('UNLIST withdraws the listing only; the share link stays; relisting inserts a new row', async () => {
    const { eventId, publicEventId } = await upcoming(h.teams.slice(0, 2));
    await list(eventId, '湛江');
    expect(await ids('?status=UPCOMING')).toContain(publicEventId);
    const unlisted = data<EventDirectoryData>(await command(eventId, 'UNLIST'));
    expect(unlisted.listing).toBeNull();
    expect(unlisted.lastListing).toMatchObject({ status: 'REVOKED', revokeSource: 'UNLIST' });
    expect(await ids('?status=UPCOMING')).not.toContain(publicEventId);
    data(await anonymous(h, publicEventPath(publicEventId)));
    reject(await command(eventId, 'UNLIST'), 409, 'DIRECTORY_NOT_LISTED');
    await list(eventId);
    const rows = await listings(eventId);
    expect(rows.map((r) => r.status)).toEqual(['REVOKED', 'ACTIVE']);
    expect(rows[0].revoked_by).toBe(h.owner.id);
    // History is permanent and one-way, even for the database owner.
    await expect(
      h.api.pool.query(
        "UPDATE event_directory_listings SET status='ACTIVE',revoked_at=NULL,revoked_by=NULL,revoke_source=NULL,revoke_reason=NULL WHERE id=$1",
        [rows[0].id],
      ),
    ).rejects.toThrow(/ACTIVE to REVOKED/);
    await expect(
      h.api.pool.query('DELETE FROM event_directory_listings WHERE id=$1', [rows[0].id]),
    ).rejects.toThrow(/immutable/);
    await command(eventId, 'UNLIST');
  });

  test('groups come from status and purpose; same-day keyset pages neither repeat nor skip; cursors are bound to the filter', async () => {
    const day = '2031-05-01';
    const city = '分页城';
    const events = [];
    for (const pair of [
      [2, 3],
      [4, 5],
      [6, 7],
    ])
      events.push(await upcoming([h.teams[pair[0]!]!, h.teams[pair[1]!]!], day));
    for (const e of events) await list(e.eventId, city);
    const expected = events
      .map((e) => e.publicEventId)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const seen: string[] = [];
    let cursor: string | null = null;
    let first = '';
    do {
      const query = `?status=UPCOMING&limit=1&city=${encodeURIComponent(city)}${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await page(query);
      const rows = data<PublicDirectoryEventData[]>(response);
      expect(rows.length).toBeLessThanOrEqual(1);
      seen.push(...rows.map((r) => r.publicEventId));
      cursor = response.body.meta.nextCursor;
      if (!first && cursor) first = cursor;
    } while (cursor);
    expect(seen).toEqual(expected);
    // Bound to status and city; malformed, non-canonical or impossible positions are rejected.
    reject(await page(`?status=UPCOMING&limit=1&city=湛江&cursor=${first}`), 400, 'INVALID_CURSOR');
    reject(
      await page(`?status=LIVE&limit=1&city=${encodeURIComponent(city)}&cursor=${first}`),
      400,
      'INVALID_CURSOR',
    );
    const forged = Buffer.from(
      JSON.stringify({ v: 1, s: 'UPCOMING', c: city, d: '2031-02-30', k: expected[0] }),
    ).toString('base64url');
    reject(
      await page(`?status=UPCOMING&city=${encodeURIComponent(city)}&cursor=${forged}`),
      400,
      'INVALID_CURSOR',
    );
    reject(await page('?cursor=%%%'), 400);
    for (const query of [
      '?limit=0',
      '?limit=51',
      '?limit=abc',
      '?status=OPEN',
      '?q=x',
      '?status=LIVE&status=LIVE',
      '?city=' + encodeURIComponent('<b>'),
    ])
      reject(await page(query), 400, 'INVALID_QUERY');
    // A started match moves the event from UPCOMING to LIVE without touching the listing.
    const live = events[0]!;
    const fixtureMatches = data<{ id: string }[]>(
      await call(h.api, 'get', `${base(live.eventId)}/matches?limit=100`, {
        cookie: h.owner.cookie,
      }),
    );
    await liveMatch(
      h,
      { event: { event: { id: live.eventId } }, matches: fixtureMatches } as never,
      0,
    );
    expect(await ids(`?status=LIVE&city=${encodeURIComponent(city)}`)).toEqual([
      live.publicEventId,
    ]);
    expect(await ids(`?status=UPCOMING&city=${encodeURIComponent(city)}`)).not.toContain(
      live.publicEventId,
    );
    for (const e of events) await command(e.eventId, 'UNLIST');
  });

  test('DISABLE withdraws in the same transaction; a new publication does not inherit the listing', async () => {
    const { eventId, publicEventId } = await upcoming(h.teams.slice(0, 2));
    await list(eventId);
    const versionBefore = (await directory(eventId)).event.version;
    await disable(h, eventId);
    expect((await directory(eventId)).event.version).toBe(versionBefore + 1);
    expect(await ids('?status=UPCOMING')).not.toContain(publicEventId);
    reject(await anonymous(h, publicEventPath(publicEventId)), 404);
    const [row] = await listings(eventId);
    expect(row).toMatchObject({
      status: 'REVOKED',
      revoke_source: 'PUBLICATION_REVOKED',
      revoked_by: h.owner.id,
    });
    const again = await enable(h, eventId);
    const now = await directory(eventId);
    expect(now.listing).toBeNull();
    expect(now.capabilities.canList).toBe(true);
    expect(await ids('?status=UPCOMING')).not.toContain(again.publication!.publicEventId);
    await disable(h, eventId);
  });

  test('COMPLETE and REOPEN withdraw; a HISTORY listing is allowed and survives ARCHIVE', async () => {
    const { fixture, eventId, publicEventId } = await finishedEvent(h.teams.slice(0, 2));
    await list(eventId);
    await confirmMatch(h, fixture);
    await lifecycle(eventId, 'COMPLETE');
    expect((await listings(eventId)).map((r) => r.revoke_source)).toEqual(['PUBLICATION_REVOKED']);
    reject(await anonymous(h, publicEventPath(publicEventId)), 404);
    expect((await directory(eventId)).group).toBeNull();
    const history = data<{ publication: { publicEventId: string } }>(
      await viewingCommand(h, eventId, 'ENABLE_HISTORY'),
    ).publication.publicEventId;
    await list(eventId, '历史城');
    expect(await ids('?status=HISTORY&city=' + encodeURIComponent('历史城'))).toEqual([history]);
    await lifecycle(eventId, 'ARCHIVE');
    const archived = data<PublicDirectoryEventData[]>(
      await page('?status=HISTORY&city=' + encodeURIComponent('历史城')),
    );
    expect(archived.map((r) => [r.publicEventId, r.status])).toEqual([[history, 'ARCHIVED']]);
    // A closed event never blocks a legitimate withdrawal or relisting.
    data(await command(eventId, 'UNLIST'));
    await list(eventId, '历史城');
    await lifecycle(eventId, 'REOPEN');
    expect(await ids('?status=HISTORY')).not.toContain(history);
    expect((await listings(eventId)).at(-1)).toMatchObject({
      revoke_source: 'PUBLICATION_REVOKED',
    });
  });

  test('publishing the next knockout round withdraws the LIVE listing', async () => {
    const fixture = await knockoutFixture(h, 3);
    const eventId = fixture.event.event.id;
    const viewing = await enable(h, eventId);
    await list(eventId);
    for (const match of fixture.matches) await confirmKnockoutMatch(h, match.id);
    const current: EventKnockoutData = await readKnockout(h, eventId);
    data(await publishRound(h, eventId, await roundInput(h, current, fixture.court)));
    expect((await listings(eventId)).map((r) => r.revoke_source)).toEqual(['PUBLICATION_REVOKED']);
    expect(await ids('?status=LIVE')).not.toContain(viewing.publication!.publicEventId);
  });

  test('CAS, duplicate LIST, LIST racing DISABLE and an audit failure never leave a partial write', async () => {
    const { eventId } = await upcoming(h.teams.slice(0, 2));
    const stale = (await directory(eventId)).event.version;
    await list(eventId);
    data(await command(eventId, 'UNLIST'));
    reject(await command(eventId, 'LIST', {}, h.owner, stale), 409, 'VERSION_CONFLICT');
    const version = (await directory(eventId)).event.version;
    const duplicate = await Promise.all([
      command(eventId, 'LIST', {}, h.owner, version),
      command(eventId, 'LIST', {}, h.owner, version),
    ]);
    expect(duplicate.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await listings(eventId)).filter((r) => r.status === 'ACTIVE')).toHaveLength(1);
    data(await command(eventId, 'UNLIST'));
    const raceVersion = (await directory(eventId)).event.version;
    await Promise.all([
      command(eventId, 'LIST', {}, h.owner, raceVersion),
      viewingCommand(h, eventId, 'DISABLE', raceVersion),
    ]);
    const orphans = await h.api.pool.query(
      `SELECT count(*)::int AS n FROM event_directory_listings l JOIN public_event_publications p
       ON p.id=l.publication_id WHERE l.status='ACTIVE' AND p.revoked_at IS NOT NULL`,
    );
    expect(orphans.rows[0].n).toBe(0);
    // Audit failure: nothing of the command survives.
    const fresh = await upcoming(h.teams.slice(0, 2));
    const before = await directory(fresh.eventId);
    const identifier = `scb_c18_audit_${randomUUID().replaceAll('-', '')}`;
    await h.api.pool.query(
      `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id::text=TG_ARGV[0] AND NEW.action LIKE 'directory.%' THEN RAISE EXCEPTION 'c18 synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await h.api.pool.query(
        `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${fresh.eventId}')`,
      );
      const failed = await command(fresh.eventId, 'LIST', {}, h.owner, before.event.version);
      reject(failed, 500, 'INTERNAL_ERROR');
      expect(JSON.stringify(failed.body)).not.toMatch(/c18 synthetic|audit_logs|postgres/i);
      expect(await listings(fresh.eventId)).toHaveLength(0);
      expect((await directory(fresh.eventId)).event.version).toBe(before.event.version);
    } finally {
      await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
      await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
    }
    await disable(h, fresh.eventId);
  });

  test('the migration lists nothing by itself and the runtime manifest grants no DELETE on listings', async () => {
    const sql = await readFile(
      new URL('../migrations/018_c18_public_event_directory.sql', import.meta.url),
      'utf8',
    );
    // Data statements only appear inside trigger function bodies.
    const topLevel = sql
      .split('$$')
      .filter((_, index) => index % 2 === 0)
      .join('\n');
    expect(topLevel).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i);
    const manifest = JSON.parse(
      await readFile(
        new URL('../../../packages/contracts/runtime-privileges.json', import.meta.url),
        'utf8',
      ),
    ) as { tables: Record<string, { privileges: string[]; updateColumns: string[] }> };
    expect(manifest.tables.event_directory_listings).toEqual({
      privileges: ['SELECT', 'INSERT'],
      updateColumns: ['status', 'revoked_at', 'revoked_by', 'revoke_source', 'revoke_reason'],
    });
  });

  test('anonymous reads are limited to 60 per minute per client address', async () => {
    for (let index = 0; index < 60; index++) data(await page('?limit=1'));
    reject(await page('?limit=1'), 429, 'RATE_LIMITED');
  });

  test('disabling the organization withdraws permanently; re-enabling relists nothing', async () => {
    const { eventId, publicEventId } = await upcoming(h.teams.slice(0, 2));
    await list(eventId);
    const second = await upcoming(h.teams.slice(2, 4));
    const version = (await directory(second.eventId)).event.version;
    // LIST racing the organization disable: whichever commits first, nothing stays ACTIVE.
    await Promise.all([
      command(second.eventId, 'LIST', {}, h.owner, version),
      h.api.pool.query(
        "UPDATE organizations SET status='DISABLED',updated_at=clock_timestamp() WHERE id=$1",
        [h.owner.orgId],
      ),
    ]);
    const active = await h.api.pool.query(
      "SELECT count(*)::int AS n FROM event_directory_listings WHERE org_id=$1 AND status='ACTIVE'",
      [h.owner.orgId],
    );
    expect(active.rows[0].n).toBe(0);
    const [row] = await listings(eventId);
    expect(row).toMatchObject({
      status: 'REVOKED',
      revoke_source: 'ORGANIZATION_DISABLED',
      revoked_by: null,
    });
    await h.api.pool.query(
      "UPDATE organizations SET status='ACTIVE',updated_at=clock_timestamp() WHERE id=$1",
      [h.owner.orgId],
    );
    expect(await ids('?status=UPCOMING')).not.toContain(publicEventId);
    expect((await directory(eventId)).capabilities.canList).toBe(true);
  });
});

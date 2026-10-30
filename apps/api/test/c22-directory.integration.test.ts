import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type {
  EventDirectoryData,
  EventScoringData,
  PublicDirectoryEventData,
  PublicRegionCatalogData,
  RegionSelection,
} from '@small-city-basketball/contracts';
import { REGION_CATALOG_VERSION, REGION_PARTIAL_ROOT_IDS } from '../src/region-catalog-data.js';
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
  publicEventPath,
  published,
  savePublishRules,
  viewingCommand,
} from './p05b-support.js';
import type { Harness } from './p05b-support.js';
import {
  confirmKnockoutMatch,
  knockoutFixture,
  publishRound,
  readKnockout,
  roundInput,
} from './c04-support.js';

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

describe('C22 standard regions on isolated PostgreSQL', { concurrent: false }, () => {
  let h: Harness;
  let catalog: PublicRegionCatalogData;
  beforeAll(async () => {
    h = await createScoringHarness(8);
    catalog = data<PublicRegionCatalogData>(await anonymous(h, '/v1/public/regions'));
  }, 180000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  beforeEach(async () => {
    await h.api.pool.query(
      "DELETE FROM auth_rate_limits WHERE key LIKE 'directory-ip:%' OR key LIKE 'regions-ip:%'",
    );
  });
  const base = (id: string, org = h.owner.orgId) => `/v1/orgs/${org}/events/${id}`;
  const reject = (r: Response, status: number, code: string) => {
    error(r, status);
    expect(r.body.error.code).toBe(code);
  };
  const region = (name: string): RegionSelection => {
    const candidates = catalog.regions.filter((node) => node.name === name);
    expect(candidates).toHaveLength(1);
    return { catalogVersion: catalog.catalogVersion, regionId: candidates[0]!.id };
  };
  const directory = async (id: string, actor: User = h.owner) =>
    data<EventDirectoryData>(
      await call(h.api, 'get', `${base(id)}/directory`, { cookie: actor.cookie }),
    );
  const command = async (
    id: string,
    type: 'LIST' | 'UNLIST' | 'REPLACE_REGION',
    extra: Record<string, unknown> = {},
    expectedEventVersion?: number,
    actor: User = h.owner,
  ) =>
    call(h.api, 'post', `${base(id)}/directory-commands`, {
      cookie: actor.cookie,
      body: {
        type,
        reason: '合成标准地区操作',
        expectedEventVersion: expectedEventVersion ?? (await directory(id)).event.version,
        ...extra,
      },
    });
  const listings = async (id: string) =>
    (
      await h.api.pool.query(
        'SELECT * FROM event_directory_listings WHERE event_id=$1 ORDER BY listed_at,id',
        [id],
      )
    ).rows;
  const params = (selection?: RegionSelection, extra: Record<string, string> = {}) =>
    new URLSearchParams({
      status: 'UPCOMING',
      limit: '50',
      ...selection,
      ...extra,
    });
  const page = (p = params()) => anonymous(h, '/v1/public/directory?' + p);
  const collect = async (p = params()) => {
    const result: PublicDirectoryEventData[] = [];
    const query = new URLSearchParams(p);
    for (let i = 0; i < 60; i++) {
      const response = await page(query);
      const rows = data<PublicDirectoryEventData[]>(response);
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(WHITELIST);
      result.push(...rows);
      const cursor = response.body.meta.nextCursor;
      if (!cursor) return result;
      query.set('cursor', cursor);
    }
    throw new Error('Synthetic directory fixture exceeded bounded pagination');
  };
  const replacement = (current: EventDirectoryData, name = '高州市') => ({
    expectedListingId: current.listing!.id,
    region: region(name),
  });
  async function upcoming() {
    const registration = await frozen(h, h.owner, h.teams.slice(0, 2));
    const resource = await court(h.api, h.owner, '标准地区场地');
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
    const id = registration.event.id;
    data<EventScoringData>(
      await call(h.api, 'put', scoringRulesPath(h.owner.orgId, id), {
        cookie: h.owner.cookie,
        body: { expectedEventVersion: publication.event.version, ...defaultRules() },
      }),
    );
    await savePublishRules(h, id);
    const viewing = await enable(h, id);
    return { id, publicEventId: viewing.publication!.publicEventId };
  }
  const lifecycle = (id: string, type: 'COMPLETE' | 'REOPEN', expectedEventVersion: number) =>
    call(h.api, 'post', `${base(id)}/lifecycle-commands`, {
      cookie: h.owner.cookie,
      body: { type, expectedEventVersion, reason: '合成地区并发撤出' },
    });
  async function noActive(id: string) {
    expect((await listings(id)).filter((row) => row.status === 'ACTIVE')).toHaveLength(0);
  }

  test('public catalog is complete, correctly linked, bounded, cookie independent and uncached', async () => {
    const response = await anonymous(h, '/v1/public/regions');
    const current = data<PublicRegionCatalogData>(response);
    expect(Object.keys(current).sort()).toEqual([
      'catalogVersion',
      'dataDate',
      'partialRootIds',
      'regions',
    ]);
    expect(Object.keys(response.body.meta)).toEqual(['requestId']);
    expect(current.catalogVersion).toBe(REGION_CATALOG_VERSION);
    expect(current.dataDate).toBe('2025-12-31');
    expect(current.regions).toHaveLength(3212);
    expect(new Set(current.regions.map((node) => node.id)).size).toBe(3212);
    expect(current.partialRootIds).toEqual([...REGION_PARTIAL_ROOT_IDS]);
    expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThan(1024 * 1024);
    for (const node of current.regions)
      expect(Object.keys(node).sort()).toEqual(['id', 'level', 'name', 'parentId']);
    const find = (name: string) => current.regions.find((node) => node.name === name)!;
    expect(find('茂名市').parentId).toBe(find('广东省').id);
    expect(find('高州市').parentId).toBe(find('茂名市').id);
    expect(find('东城区').parentId).toBe(find('北京市').id);
    expect(find('济源市').parentId).toBe(find('河南省').id);
    expect(find('东莞市').level).toBe('PREFECTURE');
    expect(current.regions.some((node) => node.parentId === find('东莞市').id)).toBe(false);
    for (const name of ['台湾省', '香港特别行政区', '澳门特别行政区']) {
      expect(current.partialRootIds).toContain(find(name).id);
      expect(current.regions.some((node) => node.parentId === find(name).id)).toBe(false);
    }
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    for (const cookie of [h.owner.cookie, 'scb.sid=invalid']) {
      const other = await anonymous(h, '/v1/public/regions', cookie);
      expect(data(other)).toEqual(current);
      expect(other.headers['set-cookie']).toBeUndefined();
    }
    reject(await anonymous(h, '/v1/public/regions?regionId=x'), 400, 'INVALID_QUERY');
    reject(
      await page(params({ catalogVersion: 'cn-admin-2024-r1', regionId: randomUUID() })),
      409,
      'REGION_CATALOG_CHANGED',
    );
    reject(
      await page(params({ catalogVersion: catalog.catalogVersion, regionId: randomUUID() })),
      400,
      'INVALID_REGION',
    );
  });

  test('country/province/prefecture/county use one range, exact old aliases and no guessed or rewritten labels', async () => {
    const labels: (string | null)[] = ['高州', '高州市', '茂名', '朝阳区', '高州·石鼓', null];
    const fixtures: { id: string; publicEventId: string; label: string | null }[] = [];
    for (const label of labels) {
      const event = await upcoming();
      const listed = data<EventDirectoryData>(
        await command(event.id, 'LIST', { displayCity: label }),
      );
      expect(listed.listing!.region).toBeNull();
      fixtures.push({ ...event, label });
    }
    const explicit = await upcoming();
    const listed = data<EventDirectoryData>(
      await command(explicit.id, 'LIST', { region: region('高州市') }),
    );
    expect(listed.listing).toMatchObject({ displayCity: '高州市', region: region('高州市') });
    fixtures.push({ ...explicit, label: '高州市' });
    const own = new Set(fixtures.map((event) => event.publicEventId));
    const ownIds = async (p: URLSearchParams) =>
      (await collect(p))
        .map((row) => row.publicEventId)
        .filter((id) => own.has(id))
        .sort();
    const countyIds = [
      fixtures[0]!.publicEventId,
      fixtures[1]!.publicEventId,
      explicit.publicEventId,
    ].sort();
    const cityIds = [...countyIds, fixtures[2]!.publicEventId].sort();
    expect(await ownIds(params())).toEqual([...own].sort());
    expect(await ownIds(params(region('广东省')))).toEqual(cityIds);
    expect(await ownIds(params(region('茂名市')))).toEqual(cityIds);
    expect(await ownIds(params(region('高州市')))).toEqual(countyIds);
    for (const name of ['北京市', '吉林省']) {
      expect(await ownIds(params(region(name)))).toEqual([]); // Ambiguous 朝阳区 is never inferred.
    }
    expect(await ownIds(params(undefined, { city: '高州' }))).toEqual([fixtures[0]!.publicEventId]);
    expect(await ownIds(params(undefined, { city: '高州市' }))).toEqual(
      [fixtures[1]!.publicEventId, explicit.publicEventId].sort(),
    );
    expect(await ownIds(params(undefined, { city: '高州·石鼓' }))).toEqual([
      fixtures[4]!.publicEventId,
    ]);
    for (const event of fixtures) {
      const [row] = await listings(event.id);
      expect(row.display_city).toBe(event.label);
      expect(row.region_id).toBe(event.id === explicit.id ? region('高州市').regionId : null);
      data(await command(event.id, 'UNLIST'));
    }
  }, 120000);

  test('v2 keyset pages are unique and filter-bound; withdrawal is checked on every page and share access survives', async () => {
    const fixtures = [];
    for (let index = 0; index < 3; index++) {
      const event = await upcoming();
      data(
        await command(
          event.id,
          'LIST',
          index % 2 ? { displayCity: '高州' } : { region: region('高州市') },
        ),
      );
      fixtures.push(event);
    }
    const query = params(region('茂名市'), { limit: '1' });
    const first = await page(query);
    const firstRows = data<PublicDirectoryEventData[]>(first);
    expect(firstRows).toHaveLength(1);
    const cursor = first.body.meta.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toMatchObject({
      v: 2,
      l: 1,
      r: region('茂名市').regionId,
    });
    for (const p of [
      params(region('广东省'), { limit: '1', cursor }),
      params(region('茂名市'), { limit: '2', cursor }),
      params(region('茂名市'), { limit: '1', status: 'LIVE', cursor }),
      params(undefined, { limit: '1', cursor }),
    ])
      reject(await page(p), 400, 'INVALID_CURSOR');
    const all = await collect(query);
    expect(new Set(all.map((row) => row.publicEventId)).size).toBe(all.length);
    for (const event of fixtures)
      expect(all.map((row) => row.publicEventId)).toContain(event.publicEventId);
    const later = fixtures.find((event) => event.publicEventId !== firstRows[0]!.publicEventId)!;
    data(await command(later.id, 'UNLIST'));
    const resumed = await collect(params(region('茂名市'), { limit: '1', cursor }));
    expect(resumed.map((row) => row.publicEventId)).not.toContain(later.publicEventId);
    data(await anonymous(h, publicEventPath(later.publicEventId)));
    for (const event of fixtures.filter((value) => value.id !== later.id))
      data(await command(event.id, 'UNLIST'));
  }, 90000);

  test('region LIST and REPLACE require existing manager authority and reject invalid or outdated selectors', async () => {
    const event = await upcoming();
    const before = await directory(event.id);
    expect(before.regionCatalogVersion).toBe(REGION_CATALOG_VERSION);
    expect(before.capabilities.canReplaceRegion).toBe(false);
    await staff(h.api, h.owner, { id: event.id } as never, h.otherOwner, 'SCORER');
    reject(
      await command(
        event.id,
        'LIST',
        { region: region('高州市') },
        before.event.version,
        h.otherOwner,
      ),
      403,
      'FORBIDDEN',
    );
    reject(
      await command(event.id, 'LIST', {
        region: { ...region('高州市'), catalogVersion: 'cn-admin-2024-r1' },
      }),
      409,
      'REGION_CATALOG_CHANGED',
    );
    reject(
      await command(event.id, 'LIST', { region: { ...region('高州市'), regionId: randomUUID() } }),
      400,
      'INVALID_REGION',
    );
    const listed = data<EventDirectoryData>(
      await command(event.id, 'LIST', { region: region('高州市') }),
    );
    expect(listed.event.version).toBe(before.event.version + 1);
    expect(listed.capabilities.canReplaceRegion).toBe(true);
    reject(
      await command(
        event.id,
        'REPLACE_REGION',
        replacement(listed, '茂名市'),
        listed.event.version,
        h.otherOwner,
      ),
      403,
      'FORBIDDEN',
    );
    reject(
      await command(
        event.id,
        'REPLACE_REGION',
        replacement(listed, '茂名市'),
        listed.event.version,
        h.leader,
      ),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const cross = await call(
      h.api,
      'post',
      `${base(event.id, h.otherOwner.orgId)}/directory-commands`,
      {
        cookie: h.otherOwner.cookie,
        body: {
          type: 'REPLACE_REGION',
          expectedEventVersion: listed.event.version,
          reason: '合成跨机构更正',
          ...replacement(listed, '茂名市'),
        },
      },
    );
    reject(cross, 404, 'RESOURCE_NOT_FOUND');
    reject(
      await command(event.id, 'REPLACE_REGION', replacement(listed)),
      409,
      'DIRECTORY_REGION_UNCHANGED',
    );
    reject(
      await command(event.id, 'REPLACE_REGION', {
        ...replacement(listed),
        expectedListingId: randomUUID(),
      }),
      409,
      'DIRECTORY_LISTING_CHANGED',
    );
    expect((await directory(event.id)).event.version).toBe(listed.event.version);
    data(await command(event.id, 'UNLIST'));
  });

  test('REPLACE atomically keeps history, touches once, preserves sharing and exposes the committed outcome on reread', async () => {
    const event = await upcoming();
    const old = data<EventDirectoryData>(await command(event.id, 'LIST', { displayCity: '高州' }));
    const changed = data<EventDirectoryData>(
      await command(event.id, 'REPLACE_REGION', replacement(old), old.event.version),
    );
    expect(changed.event.version).toBe(old.event.version + 1);
    expect(changed.listing!.id).not.toBe(old.listing!.id);
    expect(changed.listing).toMatchObject({
      publicEventId: event.publicEventId,
      displayCity: '高州市',
      region: region('高州市'),
    });
    const rows = await listings(event.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === old.listing!.id)).toMatchObject({
      status: 'REVOKED',
      display_city: '高州',
      region_id: null,
      revoke_source: 'UNLIST',
      revoke_reason: '合成标准地区操作',
    });
    expect(rows.find((row) => row.id === changed.listing!.id)).toMatchObject({
      status: 'ACTIVE',
      listed_event_version: old.event.version + 1,
      region_id: region('高州市').regionId,
    });
    const audits = await h.api.pool.query(
      "SELECT metadata FROM audit_logs WHERE resource_id=$1 AND action='directory.region_replaced'",
      [event.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].metadata).toMatchObject({
      previousListingId: old.listing!.id,
      previousDisplayCity: '高州',
      previousRegion: null,
      listingId: changed.listing!.id,
      displayCity: '高州市',
      region: region('高州市'),
      eventVersion: old.event.version + 1,
    });
    expect(await directory(event.id)).toEqual(changed);
    reject(
      await command(event.id, 'REPLACE_REGION', replacement(old), old.event.version),
      409,
      'VERSION_CONFLICT',
    );
    expect(await listings(event.id)).toHaveLength(2);
    data(await anonymous(h, publicEventPath(event.publicEventId)));
    data(await command(event.id, 'UNLIST'));
    expect((await collect(params(region('茂名市')))).map((row) => row.publicEventId)).not.toContain(
      event.publicEventId,
    );
    expect(
      (await collect(params(undefined, { city: '高州市' }))).map((row) => row.publicEventId),
    ).not.toContain(event.publicEventId);
    data(await anonymous(h, publicEventPath(event.publicEventId)));
    await disable(h, event.id);
    reject(await anonymous(h, publicEventPath(event.publicEventId)), 404, 'RESOURCE_NOT_FOUND');
  });

  test('insert and audit failure roll back both sides of replacement and the event version', async () => {
    const event = await upcoming();
    const before = data<EventDirectoryData>(
      await command(event.id, 'LIST', { displayCity: '高州' }),
    );
    const original = await listings(event.id);
    for (const table of ['event_directory_listings', 'audit_logs']) {
      const identifier = `scb_c22_failure_${randomUUID().replaceAll('-', '')}`;
      const predicate =
        table === 'audit_logs'
          ? "NEW.resource_id::text=TG_ARGV[0] AND NEW.action='directory.region_replaced'"
          : 'NEW.event_id::text=TG_ARGV[0] AND NEW.region_id IS NOT NULL';
      await h.api.pool.query(
        `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'c22 synthetic failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await h.api.pool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${identifier}('${event.id}')`,
        );
        const failed = await command(
          event.id,
          'REPLACE_REGION',
          replacement(before),
          before.event.version,
        );
        reject(failed, 500, 'INTERNAL_ERROR');
        expect(JSON.stringify(failed.body)).not.toMatch(/synthetic|audit_logs|postgres/i);
        expect(await directory(event.id)).toEqual(before);
        expect(await listings(event.id)).toEqual(original);
        expect(
          (
            await h.api.pool.query(
              "SELECT id FROM audit_logs WHERE resource_id=$1 AND action='directory.region_replaced'",
              [event.id],
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON ${table}`);
        await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
      }
    }
    data(await command(event.id, 'UNLIST'));
  });

  test('replacement races replacement, UNLIST and public DISABLE without duplicate history or revived listings', async () => {
    for (const competing of ['REPLACE_REGION', 'UNLIST', 'DISABLE'] as const) {
      const event = await upcoming();
      const before = data<EventDirectoryData>(
        await command(event.id, 'LIST', { displayCity: '高州' }),
      );
      const other =
        competing === 'DISABLE'
          ? viewingCommand(h, event.id, 'DISABLE', before.event.version)
          : command(
              event.id,
              competing,
              competing === 'REPLACE_REGION' ? replacement(before, '茂名市') : {},
              before.event.version,
            );
      const results = await Promise.all([
        command(event.id, 'REPLACE_REGION', replacement(before), before.event.version),
        other,
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(
        (await listings(event.id)).filter((row) => row.status === 'ACTIVE').length,
      ).toBeLessThanOrEqual(1);
      if (competing === 'DISABLE') {
        const current = await directory(event.id);
        if (current.publication?.status === 'ACTIVE') await disable(h, event.id);
        reject(await anonymous(h, publicEventPath(event.publicEventId)), 404, 'RESOURCE_NOT_FOUND');
        await enable(h, event.id);
        expect((await directory(event.id)).listing).toBeNull();
      } else if ((await directory(event.id)).listing) data(await command(event.id, 'UNLIST'));
      await noActive(event.id);
    }
  }, 90000);

  test('COMPLETE and REOPEN competing with replacement keep publication revocation final', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const id = fixture.event.event.id;
    await savePublishRules(h, id);
    await enable(h, id);
    data(await command(id, 'LIST', { displayCity: '高州' }));
    await confirmMatch(h, fixture);
    for (const type of ['COMPLETE', 'REOPEN'] as const) {
      const before = await directory(id);
      const results = await Promise.all([
        command(id, 'REPLACE_REGION', replacement(before), before.event.version),
        lifecycle(id, type, before.event.version),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      const current = await directory(id);
      if (current.listing) data(await lifecycle(id, type, current.event.version));
      await noActive(id);
      if (type === 'COMPLETE') {
        data(await viewingCommand(h, id, 'ENABLE_HISTORY'));
        const listed = data<EventDirectoryData>(await command(id, 'LIST', { displayCity: '高州' }));
        expect(listed.group).toBe('HISTORY');
        const history = await collect(params(region('广东省'), { status: 'HISTORY' }));
        expect(history.map((row) => row.publicEventId)).toContain(listed.listing!.publicEventId);
      }
    }
  }, 90000);

  test('publishing another round races replacement under the existing event lock and withdraws it', async () => {
    const fixture = await knockoutFixture(h, 3);
    const id = fixture.event.event.id;
    await enable(h, id);
    data(await command(id, 'LIST', { displayCity: '高州' }));
    for (const match of fixture.matches) await confirmKnockoutMatch(h, match.id);
    const before = await directory(id);
    const input = await roundInput(h, await readKnockout(h, id), fixture.court);
    const results = await Promise.all([
      command(id, 'REPLACE_REGION', replacement(before), before.event.version),
      publishRound(h, id, input),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    if ((await directory(id)).listing)
      data(
        await publishRound(h, id, await roundInput(h, await readKnockout(h, id), fixture.court)),
      );
    await noActive(id);
  }, 120000);

  test('organization disable and publication revocation racing replacement cannot resurrect a listing', async () => {
    for (const kind of ['organization', 'publication'] as const) {
      const event = await upcoming();
      const before = data<EventDirectoryData>(
        await command(event.id, 'LIST', { displayCity: '高州' }),
      );
      const revoke =
        kind === 'organization'
          ? h.api.pool.query(
              "UPDATE organizations SET status='DISABLED',updated_at=clock_timestamp() WHERE id=$1",
              [h.owner.orgId],
            )
          : h.api.pool.query(
              'UPDATE public_event_publications SET revoked_at=GREATEST(clock_timestamp(),created_at),revoked_by=$2 WHERE event_id=$1 AND revoked_at IS NULL',
              [event.id, h.owner.id],
            );
      try {
        const [response] = await Promise.all([
          command(event.id, 'REPLACE_REGION', replacement(before), before.event.version),
          revoke,
        ]);
        expect([200, 404, 409]).toContain(response.status);
        await noActive(event.id);
        expect(
          (await collect(params(region('广东省')))).map((row) => row.publicEventId),
        ).not.toContain(event.publicEventId);
      } finally {
        if (kind === 'organization')
          await h.api.pool.query(
            "UPDATE organizations SET status='ACTIVE',updated_at=clock_timestamp() WHERE id=$1",
            [h.owner.orgId],
          );
      }
      expect((await directory(event.id)).listing).toBeNull();
    }
  }, 90000);

  test('catalog limiter is independent from the public directory and permits exactly sixty reads', async () => {
    for (let index = 0; index < 60; index++) data(await anonymous(h, '/v1/public/regions'));
    reject(await anonymous(h, '/v1/public/regions'), 429, 'RATE_LIMITED');
    data(await page(params(undefined, { limit: '1' })));
  }, 60000);
});

/** Isolated real-PG query and HTTP contract checks; all inventory is synthetic. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { LocalServicesService } from '../src/local-services-service.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { createHarness, closeHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';
import { ORIGIN, call, data } from './support.js';

describe(
  'R6MAP exact viewport inventory, publication and continuation',
  { concurrent: false },
  () => {
    let h: Harness, service: LocalServicesService, regionId: string, otherRegionId: string;
    const keyword = `R6MAP-${randomUUID().slice(0, 8)}`;
    const viewport = {
      southwest: { latitude: 30.2, longitude: 120.1 },
      northeast: { latitude: 30.3, longitude: 120.2 },
      coordinateSystem: 'GCJ02',
    };
    const query = () => ({ viewport, searchVersion: 2, q: keyword });
    const ids: string[] = [];
    let removed: string, outside: string, privateId: string, noPoint: string;
    beforeAll(async () => {
      h = await createHarness(2);
      service = new LocalServicesService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        undefined,
        undefined,
        undefined,
        { cursorKey: Buffer.alloc(32, 63) },
      );
      const regions = (
        await h.api.pool.query(
          "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 2",
          [REGION_CATALOG_VERSION],
        )
      ).rows;
      [regionId, otherRegionId] = regions.map((r) => r.region_id);
      async function insert(
        lat: number | null,
        lng: number | null,
        published = true,
        region = regionId,
      ) {
        const id = randomUUID();
        await h.api.pool.query(
          `INSERT INTO local_listings
        (id,org_id,provider_user_id,created_by,kind,title,description,address,region_catalog_version,region_id,coverage_region_ids,latitude,longitude,qualification_note,terms,provider_confirmed,status,published,qualified_until,reviewed_by,reviewed_at)
        VALUES($1,$2,$3,$3,'SCORER',$4,'仅用于视野查询隔离测试','合成公开服务地点',$5,$6,ARRAY[$6]::uuid[],$7,$8,'合成资质独立核验','合成服务约定，无收费',true,'APPROVED',$9,clock_timestamp()+interval '1 year',$10,clock_timestamp())`,
          [
            id,
            h.owner.orgId,
            h.owner.id,
            keyword,
            REGION_CATALOG_VERSION,
            region,
            lat,
            lng,
            published,
            h.otherOwner.id,
          ],
        );
        return id;
      }
      for (let n = 0; n < 53; n++) ids.push(await insert(30.25, 120.15));
      for (const [lat, lng] of [
        [30.2, 120.1],
        [30.2, 120.2],
        [30.3, 120.1],
        [30.3, 120.2],
      ] as const)
        ids.push(await insert(lat, lng));
      removed = await insert(30.25, 120.15, true, otherRegionId);
      ids.push(removed);
      outside = await insert(30.199999, 120.15);
      privateId = await insert(30.25, 120.15, false);
      noPoint = await insert(null, null);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    });

    test('filters actual rectangular edges, omits private and unlocated supply, derives center', async () => {
      const r = await service.publicList({ ...query(), limit: 50 }, 'r6map-edges');
      expect(r.items).toHaveLength(50);
      expect(r).toMatchObject({
        queryOrigin: 'VIEWPORT',
        truncated: false,
        searchArea: { mode: 'VIEWPORT', bounds: viewport, scopeLabel: 'MAP_AREA' },
        locationCapability: { viewportSearch: true, enabled: false },
      });
      const seen = r.items.map((i) => i.id);
      const tail = await service.publicList(
        { ...query(), limit: 50, cursor: r.nextCursor },
        'r6map-edges',
      );
      seen.push(...tail.items.map((i) => i.id));
      expect(new Set(seen).size).toBe(ids.length);
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(seen).not.toContain(outside);
      expect(seen).not.toContain(privateId);
      expect(seen).not.toContain(noPoint);
      expect(tail.nextCursor).toBeNull();
    });
    test('many identical distances paginate without duplicates and signed cursors reject changed filters', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const r = await service.publicList(
          { ...query(), limit: 7, ...(cursor ? { cursor } : {}) },
          'r6map-pages',
        );
        seen.push(...r.items.map((i) => i.id));
        cursor = r.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(ids.length);
      const first = await service.publicList({ ...query(), limit: 1 }, 'r6map-cursor');
      await expect(
        service.publicList({ ...query(), q: 'changed', cursor: first.nextCursor }, 'r6map-cursor'),
      ).rejects.toMatchObject({ code: 'CURSOR_SCOPE_MISMATCH' });
      const value = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
      value.distance = 0;
      value.id = outside;
      await expect(
        service.publicList(
          { ...query(), cursor: Buffer.from(JSON.stringify(value)).toString('base64url') },
          'r6map-cursor',
        ),
      ).rejects.toMatchObject({ code: 'CURSOR_SCOPE_MISMATCH' });
    });
    test('explicit selected region intersects viewport; revocation is checked on each page', async () => {
      const local = await service.publicList(
        { ...query(), limit: 50, regionId, catalogVersion: REGION_CATALOG_VERSION },
        'r6map-region',
      );
      const tail = await service.publicList(
        {
          ...query(),
          limit: 50,
          regionId,
          catalogVersion: REGION_CATALOG_VERSION,
          cursor: local.nextCursor,
        },
        'r6map-region',
      );
      expect([...local.items, ...tail.items].map((i) => i.id)).not.toContain(removed);
      await h.api.pool.query('UPDATE local_listings SET published=false WHERE id=$1', [removed]);
      const r = await service.publicList({ ...query(), limit: 50 }, 'r6map-revoke');
      const page = await service.publicList(
        { ...query(), limit: 50, cursor: r.nextCursor },
        'r6map-revoke',
      );
      expect([...r.items, ...page.items].map((i) => i.id)).not.toContain(removed);
    });
    test('HTTP keeps coordinates in POST and sends no-store; legacy response contract remains intact', async () => {
      const response = await call(h.api, 'post', '/v1/public/local-search', { body: query() });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(data(response)).toMatchObject({
        queryOrigin: 'VIEWPORT',
        searchArea: { mode: 'VIEWPORT' },
      });
      const legacy = await service.publicList({ q: keyword }, 'r6map-legacy');
      expect(legacy).not.toHaveProperty('searchArea');
      expect(legacy.queryOrigin).toBe('REGION');
      const disabled = new LocalServicesService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        undefined,
        undefined,
        undefined,
        { enabled: false },
      );
      await expect(disabled.publicList(query(), 'r6map-disabled')).rejects.toMatchObject({
        code: 'VIEWPORT_SEARCH_DISABLED',
      });
    });
  },
);

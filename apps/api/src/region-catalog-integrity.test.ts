import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The dependency-free source generator is an intentionally plain .mjs script.
import { buildCatalog } from '../../../scripts/build-region-catalog.mjs';
import { readVerifiedRegionCatalog } from './region-catalog-integrity.js';
import type { CatalogNode } from './region-catalog-integrity.js';
import {
  REGION_ALIAS_COUNT,
  REGION_ALIASES_SHA256,
  REGION_CATALOG_VERSION,
  REGION_DATA_DATE,
  REGION_LICENSE,
  REGION_NODE_COUNT,
  REGION_NODES_SHA256,
  REGION_PARTIAL_ROOT_IDS,
  REGION_SOURCE_BLOB,
  REGION_SOURCE_COMMIT,
  REGION_SOURCE_REPO,
  REGION_SOURCE_SHA256,
} from './region-catalog-data.js';

type Alias = { label: string; regionId: string; kind: string; provenance: string };
const metadata = {
  version: REGION_CATALOG_VERSION,
  data_date: REGION_DATA_DATE,
  source_repo: REGION_SOURCE_REPO,
  source_commit: REGION_SOURCE_COMMIT,
  source_blob: REGION_SOURCE_BLOB,
  source_sha256: REGION_SOURCE_SHA256,
  license: REGION_LICENSE,
  normalized_sha256: REGION_NODES_SHA256,
  alias_sha256: REGION_ALIASES_SHA256,
  node_count: REGION_NODE_COUNT,
  alias_count: REGION_ALIAS_COUNT,
};
describe('published catalog integrity', () => {
  let nodes: CatalogNode[];
  let aliases: Alias[];
  beforeAll(async () => {
    const built = buildCatalog(
      await readFile(new URL('../data/regions/2025.txt', import.meta.url), 'utf8'),
    );
    nodes = built.nodes;
    aliases = built.aliases;
  });
  const pool = (rows = [metadata] as Record<string, unknown>[], n = nodes, a = aliases) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: n })
      .mockResolvedValueOnce({ rows: a });
    return { db: { query } as unknown as Pick<Pool, 'query'>, query };
  };
  const unavailable = {
    status: 503,
    code: 'REGION_CATALOG_UNAVAILABLE',
    message: '地区目录暂不可用，请稍后重试',
  };
  it('validates every pinned field and returns only the complete public node projection', async () => {
    const { db, query } = pool();
    const result = await readVerifiedRegionCatalog(db);
    expect(result.nodes).toEqual(nodes);
    expect(result.data).toEqual({
      catalogVersion: REGION_CATALOG_VERSION,
      dataDate: REGION_DATA_DATE,
      partialRootIds: [...REGION_PARTIAL_ROOT_IDS],
      regions: nodes.map((n) => ({
        id: n.regionId,
        parentId: n.parentRegionId,
        name: n.name,
        level: n.level,
      })),
    });
    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, values] of query.mock.calls) {
      expect(sql.trim().startsWith('SELECT ')).toBe(true);
      expect(values).toEqual([REGION_CATALOG_VERSION]);
    }
    expect(JSON.stringify(result.data)).not.toContain('sourceCode');
  });
  it('fails closed for absent version metadata or any mismatched source/version fingerprint', async () => {
    await expect(readVerifiedRegionCatalog(pool([]).db)).rejects.toMatchObject(unavailable);
    for (const key of Object.keys(metadata)) {
      const changed = {
        ...metadata,
        [key]: typeof metadata[key as keyof typeof metadata] === 'number' ? -1 : 'wrong',
      };
      const { db, query } = pool([changed]);
      await expect(readVerifiedRegionCatalog(db)).rejects.toMatchObject(unavailable);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects missing, reordered or altered nodes even when metadata still declares the expected hash', async () => {
    const altered = structuredClone(nodes);
    altered[0]!.name += '变更';
    const reparented = structuredClone(nodes);
    reparented[1]!.parentRegionId = nodes[2]!.regionId;
    for (const n of [nodes.slice(1), [...nodes].reverse(), altered, reparented]) {
      await expect(readVerifiedRegionCatalog(pool([metadata], n).db)).rejects.toMatchObject(
        unavailable,
      );
    }
  });
  it('rejects missing or retargeted aliases without trusting an unchanged row count', async () => {
    const changed = structuredClone(aliases);
    changed[0]!.regionId = nodes[0]!.regionId;
    changed[0]!.label += '变更';
    const provenance = structuredClone(aliases);
    provenance[0]!.provenance = 'unreviewed';
    for (const a of [aliases.slice(1), [...aliases].reverse(), changed, provenance]) {
      await expect(readVerifiedRegionCatalog(pool([metadata], nodes, a).db)).rejects.toMatchObject(
        unavailable,
      );
    }
  });
  it('maps database errors to a fixed unavailable error without exposing connection diagnostics', async () => {
    const db = {
      query: vi.fn().mockRejectedValue(new Error('postgresql://private-marker@host/db')),
    } as unknown as Pick<Pool, 'query'>;
    await expect(readVerifiedRegionCatalog(db)).rejects.toMatchObject(unavailable);
    try {
      await readVerifiedRegionCatalog(db);
    } catch (err) {
      expect(String(err)).not.toContain('private-marker');
      expect((err as Error).cause).toBeUndefined();
    }
  });
});

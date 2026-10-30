import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { PublicRegionCatalogData, RegionLevel } from '@small-city-basketball/contracts';
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
import { ApiError } from './errors.js';

type Database = Pick<Pool, 'query'>;
export interface CatalogNode {
  regionId: string;
  sourceCode: string;
  name: string;
  level: RegionLevel;
  parentRegionId: string | null;
}
interface Alias {
  label: string;
  regionId: string;
  kind: string;
  provenance: string;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only; no persisted identity or location is inferred or updated here. */
export async function readVerifiedRegionCatalog(db: Database): Promise<{
  data: PublicRegionCatalogData;
  nodes: CatalogNode[];
}> {
  try {
    const metadata = (
      await db.query(
        `SELECT version,data_date::text,source_repo,source_commit,source_blob,source_sha256,license,
          normalized_sha256,alias_sha256,node_count,alias_count
         FROM region_catalog_versions WHERE version=$1`,
        [REGION_CATALOG_VERSION],
      )
    ).rows[0];
    if (
      !metadata ||
      metadata.version !== REGION_CATALOG_VERSION ||
      metadata.data_date !== REGION_DATA_DATE ||
      metadata.source_repo !== REGION_SOURCE_REPO ||
      metadata.source_commit !== REGION_SOURCE_COMMIT ||
      metadata.source_blob !== REGION_SOURCE_BLOB ||
      metadata.source_sha256 !== REGION_SOURCE_SHA256 ||
      metadata.license !== REGION_LICENSE ||
      metadata.normalized_sha256 !== REGION_NODES_SHA256 ||
      metadata.alias_sha256 !== REGION_ALIASES_SHA256 ||
      metadata.node_count !== REGION_NODE_COUNT ||
      metadata.alias_count !== REGION_ALIAS_COUNT
    )
      throw new Error('Catalog metadata differs from this release');
    const nodes = (
      await db.query<CatalogNode>(
        `SELECT region_id AS "regionId",source_code AS "sourceCode",name,level,
          parent_region_id AS "parentRegionId" FROM region_catalog_nodes
         WHERE catalog_version=$1 ORDER BY source_code COLLATE "C"`,
        [REGION_CATALOG_VERSION],
      )
    ).rows;
    const aliases = (
      await db.query<Alias>(
        `SELECT label,region_id AS "regionId",kind,provenance FROM region_legacy_aliases
         WHERE catalog_version=$1 ORDER BY label COLLATE "C"`,
        [REGION_CATALOG_VERSION],
      )
    ).rows;
    // Reconstruct field order explicitly. Object order from the driver is not a contract.
    const canonicalNodes = nodes.map((n) => ({
      regionId: n.regionId,
      sourceCode: n.sourceCode,
      name: n.name,
      level: n.level,
      parentRegionId: n.parentRegionId,
    }));
    const canonicalAliases = aliases.map((a) => ({
      label: a.label,
      regionId: a.regionId,
      kind: a.kind,
      provenance: a.provenance,
    }));
    if (
      nodes.length !== REGION_NODE_COUNT ||
      nodes.length > 10000 ||
      aliases.length !== REGION_ALIAS_COUNT ||
      digest(canonicalNodes) !== REGION_NODES_SHA256 ||
      digest(canonicalAliases) !== REGION_ALIASES_SHA256
    )
      throw new Error('Catalog content differs from this release');
    const data: PublicRegionCatalogData = {
      catalogVersion: REGION_CATALOG_VERSION,
      dataDate: REGION_DATA_DATE,
      partialRootIds: [...REGION_PARTIAL_ROOT_IDS],
      regions: nodes.map((n) => ({
        id: n.regionId,
        parentId: n.parentRegionId,
        name: n.name,
        level: n.level,
      })),
    };
    // Leave enough room for the response envelope; never truncate a "complete" directory.
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 1024 * 1024 - 1024)
      throw new Error('Catalog exceeds bounded response');
    return { data, nodes };
  } catch {
    throw new ApiError(503, 'REGION_CATALOG_UNAVAILABLE', '地区目录暂不可用，请稍后重试');
  }
}

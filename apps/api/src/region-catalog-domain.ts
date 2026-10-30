import type { RegionSelection } from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { REGION_CATALOG_VERSION } from './region-catalog-data.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseRegionSelection(
  raw: unknown,
  fail: (message: string) => never,
): RegionSelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('地区格式无效');
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(',') !== 'catalogVersion,regionId' ||
    typeof r.regionId !== 'string' ||
    !UUID.test(r.regionId) ||
    typeof r.catalogVersion !== 'string' ||
    !VERSION.test(r.catalogVersion)
  )
    return fail('请提供有效地区ID和目录版本');
  return { catalogVersion: r.catalogVersion, regionId: r.regionId };
}

export function assertCurrentRegionVersion(version: string) {
  if (version !== REGION_CATALOG_VERSION)
    throw new ApiError(409, 'REGION_CATALOG_CHANGED', '地区目录已更新，请重新选择并确认');
}

export function parseRegionCatalogQuery(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)
    throw new ApiError(400, 'INVALID_QUERY', '地区目录不接受查询参数');
}

import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { objectInput, resourceId } from './validation.js';
import { assertCurrentRegionVersion } from './region-catalog-domain.js';
const fail = (): never => {
  throw new ApiError(422, 'INVALID_SEARCH', '请检查搜索词、分类和地区');
};
export const searchHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function literalSearchPattern(value: string) {
  return '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
}
export function parsePublicSearch(raw: unknown) {
  const b = objectInput(raw, [
    'q',
    'kind',
    'city',
    'regionId',
    'catalogVersion',
    'limit',
    'cursor',
  ]);
  if (typeof b.q !== 'string' || /[\u0000-\u001f\u007f]/.test(b.q)) fail();
  const q = (b.q as string).normalize('NFC').trim();
  if (!q || Array.from(q).length > 80 || /[\u0000-\u001f\u007f]/.test(q)) fail();
  const kind = b.kind === undefined ? 'ALL' : b.kind;
  if (!['ALL', 'EVENT', 'TEAM', 'PLAYER'].includes(String(kind))) fail();
  let city: string | null = null;
  if (b.city !== undefined) {
    if (typeof b.city !== 'string') fail();
    city = (b.city as string).trim();
    if (!city || Array.from(city).length > 40 || /[\u0000-\u001f\u007f]/.test(city)) fail();
  }
  if (
    (b.regionId === undefined) !== (b.catalogVersion === undefined) ||
    (city && b.regionId !== undefined)
  )
    fail();
  let regionId: string | null = null,
    catalogVersion: string | null = null;
  if (b.regionId !== undefined) {
    regionId = resourceId(typeof b.regionId === 'string' ? b.regionId : '');
    if (typeof b.catalogVersion !== 'string') fail();
    catalogVersion = b.catalogVersion as string;
    assertCurrentRegionVersion(catalogVersion);
  }
  const limit = b.limit === undefined ? 20 : Number(b.limit);
  if (typeof b.limit !== 'string' && b.limit !== undefined) fail();
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    (b.limit !== undefined && !/^(?:[1-9]|1[0-9]|20)$/.test(String(b.limit)))
  )
    fail();
  const context = searchHash({ q, kind, city, regionId, catalogVersion, limit });
  let after = '';
  if (b.cursor !== undefined) {
    if (typeof b.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(b.cursor)) fail();
    try {
      const bytes = Buffer.from(b.cursor as string, 'base64url');
      if (bytes.toString('base64url') !== b.cursor) fail();
      const value = JSON.parse(bytes.toString('utf8'));
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'context,key,v' ||
        value.v !== 1 ||
        value.context !== context ||
        !/^[EPT]:[A-Za-z0-9_-]{43}$/.test(value.key)
      )
        fail();
      after = value.key;
    } catch {
      fail();
    }
  }
  return { q, kind: String(kind), city, regionId, catalogVersion, limit, context, after };
}
export function publicSearchCursor(context: string, key: string) {
  return Buffer.from(JSON.stringify({ v: 1, context, key })).toString('base64url');
}

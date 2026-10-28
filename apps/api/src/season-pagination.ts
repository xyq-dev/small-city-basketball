import { ApiError } from './errors.js';
import { objectInput } from './validation.js';

export const SEASON_PAGE_LIMIT = 50;
export function seasonPage(raw: unknown, kind: 'DATE' | 'TIMESTAMP' = 'TIMESTAMP') {
  const query = objectInput(raw ?? {}, ['limit', 'cursor']);
  const limit = query.limit === undefined ? SEASON_PAGE_LIMIT : Number(query.limit);
  if (
    (query.limit !== undefined &&
      (typeof query.limit !== 'string' || !/^[1-9][0-9]*$/.test(query.limit))) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > SEASON_PAGE_LIMIT
  )
    throw new ApiError(400, 'INVALID_QUERY', '每页记录数量须为1至50');
  let cursor: { at: string; id: string } | null = null;
  if (query.cursor !== undefined) {
    try {
      if (
        typeof query.cursor !== 'string' ||
        query.cursor.length > 512 ||
        !/^[A-Za-z0-9_-]+$/.test(query.cursor)
      )
        throw new Error();
      const decoded = Buffer.from(query.cursor, 'base64url').toString('utf8');
      const value = JSON.parse(decoded);
      const pattern =
        kind === 'DATE'
          ? /^\d{4}-\d{2}-\d{2}$/
          : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/;
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'at,id' ||
        typeof value.at !== 'string' ||
        !pattern.test(value.at) ||
        !Number.isFinite(Date.parse(value.at)) ||
        new Date(value.at.slice(0, 10)).toISOString().slice(0, 10) !== value.at.slice(0, 10) ||
        typeof value.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id) ||
        Buffer.from(decoded).toString('base64url') !== query.cursor
      )
        throw new Error();
      cursor = value;
    } catch {
      throw new ApiError(400, 'INVALID_CURSOR', '分页游标无效，请重新读取');
    }
  }
  return { limit, cursor };
}
export function seasonCursor(at: string, id: string) {
  return Buffer.from(JSON.stringify({ at, id })).toString('base64url');
}

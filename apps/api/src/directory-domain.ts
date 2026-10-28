import type {
  DirectoryCommandInput,
  DirectoryGroup,
  EventStatus,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { invalid, objectInput, text } from './validation.js';
import { expectedVersion } from './registration-validation.js';

// C18 public event directory: pure rules shared by the private commands and the anonymous list.
export const DIRECTORY_GROUPS: readonly DirectoryGroup[] = ['LIVE', 'UPCOMING', 'HISTORY'];
export const DIRECTORY_DEFAULT_LIMIT = 20;
export const DIRECTORY_MAX_LIMIT = 50;
const CITY = /^[A-Za-z0-9 ·一-鿿]+$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{43}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Only event status + publication purpose decide the group; dates are never consulted. */
export function directoryGroup(status: EventStatus, purpose: unknown): DirectoryGroup | null {
  if (purpose === 'LIVE' && status === 'RUNNING') return 'LIVE';
  if (purpose === 'LIVE' && status === 'SCHEDULED') return 'UPCOMING';
  if (purpose === 'HISTORY' && (status === 'COMPLETED' || status === 'ARCHIVED')) return 'HISTORY';
  return null;
}

/**
 * Canonical city: NFC, trimmed, inner whitespace (incl. full-width) collapsed to one space;
 * 1–20 characters of Chinese, letters, digits, spaces and "·". Empty means "no city".
 */
export function normalizeCity(raw: unknown, onError: (message: string) => never): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw.includes('\u0000')) return onError('城市格式无效');
  const value = raw
    .normalize('NFC')
    .replace(/[\s　]+/g, ' ')
    .trim();
  if (!value) return null;
  if (Array.from(value).length > 20 || !CITY.test(value))
    return onError('城市须为1至20个中文、字母、数字、空格或“·”');
  return value;
}

export function parseDirectoryCommand(raw: unknown): DirectoryCommandInput & {
  displayCity: string | null;
} {
  const input = objectInput(raw, ['type', 'expectedEventVersion', 'displayCity', 'reason']);
  if (input.type !== 'LIST' && input.type !== 'UNLIST') invalid('不支持的目录操作');
  const type = input.type as 'LIST' | 'UNLIST';
  if (type === 'UNLIST' && input.displayCity !== undefined) invalid('撤出目录不接受城市字段');
  return {
    type,
    expectedEventVersion: expectedVersion(input.expectedEventVersion),
    displayCity: type === 'LIST' ? normalizeCity(input.displayCity, invalid) : null,
    reason: text(input.reason, 'reason', 4, 500),
  };
}

const badQuery = (message: string): never => {
  throw new ApiError(400, 'INVALID_QUERY', message);
};
const badCursor = (): never => {
  throw new ApiError(400, 'INVALID_CURSOR', '分页游标无效或与当前筛选不一致，请从第一页重新读取');
};

export interface DirectoryCursor {
  sortDate: string;
  publicEventId: string;
}
export interface DirectoryQuery {
  group: DirectoryGroup;
  limit: number;
  city: string | null;
  cursor: DirectoryCursor | null;
}

/** The cursor only marks a page start; it grants nothing and is re-filtered every page. */
export function encodeDirectoryCursor(
  group: DirectoryGroup,
  city: string | null,
  sortDate: string,
  publicEventId: string,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, s: group, c: city, d: sortDate, k: publicEventId }),
  ).toString('base64url');
}

function realDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function decodeCursor(raw: unknown, group: DirectoryGroup, city: string | null): DirectoryCursor {
  if (
    typeof raw !== 'string' ||
    raw.length < 1 ||
    raw.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  )
    return badCursor();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return badCursor();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return badCursor();
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join(',');
  if (
    keys !== 'c,d,k,s,v' ||
    v.v !== 1 ||
    v.s !== group ||
    (v.c !== null && typeof v.c !== 'string') ||
    v.c !== city ||
    typeof v.d !== 'string' ||
    !realDate(v.d) ||
    typeof v.k !== 'string' ||
    !PUBLIC_ID.test(v.k)
  )
    return badCursor();
  // Re-encoding must reproduce the same token: no alternative spellings of one position.
  if (encodeDirectoryCursor(group, city, v.d, v.k) !== raw) return badCursor();
  return { sortDate: v.d, publicEventId: v.k };
}

export function parseDirectoryQuery(raw: unknown): DirectoryQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return badQuery('查询参数无效');
  const q = raw as Record<string, unknown>;
  if (Object.keys(q).some((key) => !['status', 'limit', 'city', 'cursor'].includes(key)))
    return badQuery('查询包含不支持的参数');
  for (const key of Object.keys(q))
    if (typeof q[key] !== 'string') return badQuery('查询参数只能出现一次');
  const group = (q.status ?? 'LIVE') as DirectoryGroup;
  if (!DIRECTORY_GROUPS.includes(group)) return badQuery('目录分组须为LIVE、UPCOMING或HISTORY');
  let limit = DIRECTORY_DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(q.limit as string)) return badQuery('limit须为1至50的整数');
    limit = Number(q.limit);
    if (limit > DIRECTORY_MAX_LIMIT) return badQuery('limit须为1至50的整数');
  }
  const city = q.city === undefined ? null : normalizeCity(q.city, badQuery);
  const cursor = q.cursor === undefined ? null : decodeCursor(q.cursor, group, city);
  return { group, limit, city, cursor };
}

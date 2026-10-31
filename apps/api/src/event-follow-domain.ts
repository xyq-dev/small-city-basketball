import type { EventStatus, FollowData } from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { publicViewingAllowed } from './event-lifecycle-domain.js';
import { invalid, objectInput } from './validation.js';

// C19 event follows: pure rules shared by the service and its unit tests.
export const FOLLOW_DEFAULT_LIMIT = 20;
export const FOLLOW_MAX_LIMIT = 50;
const PUBLIC_ID = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Cursor timestamps keep PostgreSQL's microseconds so equal-millisecond rows never skip.
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
export const PUBLIC_FORMATS = [
  'ROUND_ROBIN',
  'DOUBLE_ROUND_ROBIN',
  'SINGLE_ELIMINATION',
  'GROUP_KNOCKOUT',
];

const badQuery = (message: string): never => {
  throw new ApiError(400, 'INVALID_QUERY', message);
};
const badCursor = (): never => {
  throw new ApiError(400, 'INVALID_CURSOR', '分页游标无效，请从第一页重新读取');
};

export function parseFollowInput(raw: unknown): { publicEventId: string } {
  const input = objectInput(raw, ['publicEventId']);
  if (typeof input.publicEventId !== 'string' || !PUBLIC_ID.test(input.publicEventId))
    invalid('公开赛事编号无效', { publicEventId: '请从有效的公开赛事页面关注' });
  return { publicEventId: input.publicEventId as string };
}

/** Cancel carries no fields; an absent body and {} are the same command. */
export function parseCancelInput(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  objectInput(raw, []);
}

function onlyStrings(raw: unknown, allowed: string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return badQuery('查询参数无效');
  const q = raw as Record<string, unknown>;
  if (Object.keys(q).some((key) => !allowed.includes(key))) return badQuery('查询包含不支持的参数');
  for (const key of Object.keys(q))
    if (typeof q[key] !== 'string') return badQuery('查询参数只能出现一次');
  return q as Record<string, string>;
}

export function parseLookupQuery(raw: unknown): string {
  const q = onlyStrings(raw, ['publicEventId']);
  if (!q.publicEventId || !PUBLIC_ID.test(q.publicEventId)) return badQuery('公开赛事编号无效');
  return q.publicEventId;
}

export interface FollowCursor {
  createdAt: string;
  id: string;
}

/** The cursor only marks a page start inside the caller's own rows; it grants nothing. */
export function encodeFollowCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, t: createdAt, i: id })).toString('base64url');
}

function realStamp(value: string): boolean {
  const m = STAMP.exec(value);
  if (!m) return false;
  const time = Date.parse(`${m[1]}T00:00:00Z`);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === m[1] &&
    Number(m[2]) < 24 &&
    Number(m[3]) < 60 &&
    Number(m[4]) < 60
  );
}

export function decodeFollowCursor(raw: string): FollowCursor {
  if (raw.length < 1 || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return badCursor();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return badCursor();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return badCursor();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'i,t,v' ||
    v.v !== 1 ||
    typeof v.t !== 'string' ||
    !realStamp(v.t) ||
    typeof v.i !== 'string' ||
    !UUID.test(v.i)
  )
    return badCursor();
  // Re-encoding must reproduce the same token: no alternative spellings of one position.
  if (encodeFollowCursor(v.t, v.i) !== raw) return badCursor();
  return { createdAt: v.t, id: v.i };
}

export function parseFollowListQuery(raw: unknown): {
  limit: number;
  cursor: FollowCursor | null;
} {
  const q = onlyStrings(raw, ['limit', 'cursor']);
  let limit = FOLLOW_DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(q.limit)) return badQuery('limit须为1至50的整数');
    limit = Number(q.limit);
    if (limit > FOLLOW_MAX_LIMIT) return badQuery('limit须为1至50的整数');
  }
  return { limit, cursor: q.cursor === undefined ? null : decodeFollowCursor(q.cursor) };
}

/** One joined row: the follow plus the current state of its publication chain. */
export interface FollowRow {
  id: string;
  status: 'ACTIVE' | 'CANCELLED';
  created_at: Date | string;
  cancelled_at: Date | string | null;
  public_event_id: string;
  purpose: string;
  publication_revoked: boolean;
  org_status: string;
  event_name: string;
  event_start_date: string;
  event_end_date: string;
  event_status: EventStatus;
  event_format: string;
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/** Same gate as the anonymous public read: organization, format, publication, purpose. */
export function publiclyReadable(r: FollowRow): boolean {
  return (
    r.org_status === 'ACTIVE' &&
    !r.publication_revoked &&
    PUBLIC_FORMATS.includes(r.event_format) &&
    publicViewingAllowed(r.event_status, r.purpose)
  );
}

export function followDto(r: FollowRow): FollowData {
  const status =
    r.status === 'CANCELLED' ? 'CANCELLED' : publiclyReadable(r) ? 'ACTIVE' : 'INVALID';
  return {
    followId: r.id,
    publicEventId: r.public_event_id,
    status,
    // Withdrawn details never leave the server once the publication stops being readable.
    event:
      status === 'ACTIVE'
        ? {
            name: r.event_name,
            startDate: r.event_start_date,
            endDate: r.event_end_date,
            status: r.event_status,
            purpose: r.purpose as 'LIVE' | 'HISTORY',
          }
        : null,
    createdAt: iso(r.created_at),
    cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
    wechatReminder: 'NOT_ENABLED',
  };
}

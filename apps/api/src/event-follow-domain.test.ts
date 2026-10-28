import { describe, expect, test } from 'vitest';
import { ApiError } from './errors.js';
import {
  decodeFollowCursor,
  encodeFollowCursor,
  followDto,
  parseCancelInput,
  parseFollowInput,
  parseFollowListQuery,
  parseLookupQuery,
  publiclyReadable,
} from './event-follow-domain.js';
import type { FollowRow } from './event-follow-domain.js';

const key = 'k'.repeat(43);
const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
const stamp = '2026-10-28T01:02:03.456789Z';
const row = (over: Partial<FollowRow> = {}): FollowRow => ({
  id,
  status: 'ACTIVE',
  created_at: '2026-10-28T01:02:03.456Z',
  cancelled_at: null,
  public_event_id: key,
  purpose: 'LIVE',
  publication_revoked: false,
  org_status: 'ACTIVE',
  event_name: '合成冬季杯',
  event_start_date: '2026-11-01',
  event_end_date: '2026-11-02',
  event_status: 'RUNNING',
  event_format: 'ROUND_ROBIN',
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return `${(error as ApiError).status} ${(error as ApiError).code}`;
  }
  throw new Error('expected a rejection');
};

describe('event follow inputs', () => {
  test('follow accepts exactly one well-formed public key', () => {
    expect(parseFollowInput({ publicEventId: key })).toEqual({ publicEventId: key });
    for (const bad of [
      null,
      [],
      {},
      { publicEventId: 'short' },
      { publicEventId: key + 'x' },
      { publicEventId: key, orgId: id },
      { publicEventId: 'k'.repeat(42) + '/' },
    ])
      expect(code(() => parseFollowInput(bad))).toBe('422 VALIDATION_ERROR');
  });
  test('cancel takes no fields', () => {
    expect(() => parseCancelInput(undefined)).not.toThrow();
    expect(() => parseCancelInput({})).not.toThrow();
    expect(code(() => parseCancelInput({ reason: 'x' }))).toBe('422 VALIDATION_ERROR');
  });
  test('lookup and list queries are exact', () => {
    expect(parseLookupQuery({ publicEventId: key })).toBe(key);
    expect(code(() => parseLookupQuery({}))).toBe('400 INVALID_QUERY');
    expect(code(() => parseLookupQuery({ publicEventId: [key, key] }))).toBe('400 INVALID_QUERY');
    expect(code(() => parseLookupQuery({ publicEventId: key, x: '1' }))).toBe('400 INVALID_QUERY');
    expect(parseFollowListQuery({})).toEqual({ limit: 20, cursor: null });
    expect(parseFollowListQuery({ limit: '50' }).limit).toBe(50);
    for (const limit of ['0', '51', '-1', '1.5', '01', 'x'])
      expect(code(() => parseFollowListQuery({ limit }))).toBe('400 INVALID_QUERY');
    expect(code(() => parseFollowListQuery({ userId: id }))).toBe('400 INVALID_QUERY');
  });
});

describe('follow cursors', () => {
  test('round-trip keeps microseconds and the id', () => {
    const cursor = encodeFollowCursor(stamp, id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFollowCursor(cursor)).toEqual({ createdAt: stamp, id });
    expect(parseFollowListQuery({ cursor }).cursor).toEqual({ createdAt: stamp, id });
  });
  test('tampered, alternative or malformed cursors are rejected', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const bad of [
      '',
      'a.b',
      'x'.repeat(513),
      enc({ v: 2, t: stamp, i: id }),
      enc({ v: 1, t: '2026-10-28T01:02:03.456Z', i: id }),
      enc({ v: 1, t: '2026-02-30T01:02:03.456789Z', i: id }),
      enc({ v: 1, t: '2026-10-28T25:02:03.456789Z', i: id }),
      enc({ v: 1, t: stamp, i: id.toUpperCase() }),
      enc({ v: 1, t: stamp, i: id, u: 'someone' }),
      enc({ i: id, t: stamp, v: 1 }),
      enc([1, stamp, id]),
    ])
      expect(code(() => decodeFollowCursor(bad))).toBe('400 INVALID_CURSOR');
  });
});

describe('follow DTO', () => {
  test('an ACTIVE readable follow carries only the public whitelist', () => {
    const dto = followDto(row());
    expect(dto).toEqual({
      followId: id,
      publicEventId: key,
      status: 'ACTIVE',
      event: {
        name: '合成冬季杯',
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        status: 'RUNNING',
        purpose: 'LIVE',
      },
      createdAt: '2026-10-28T01:02:03.456Z',
      cancelledAt: null,
      wechatReminder: 'NOT_ENABLED',
    });
  });
  test('any unreadable link in the chain makes it INVALID with no event details', () => {
    for (const over of [
      { publication_revoked: true },
      { org_status: 'DISABLED' },
      { event_status: 'COMPLETED' as const },
      { purpose: 'HISTORY' },
      { event_format: 'LEAGUE' },
    ]) {
      expect(publiclyReadable(row(over))).toBe(false);
      const dto = followDto(row(over));
      expect(dto.status).toBe('INVALID');
      expect(dto.event).toBeNull();
      expect(JSON.stringify(dto)).not.toContain('合成冬季杯');
    }
    expect(followDto(row({ purpose: 'HISTORY', event_status: 'ARCHIVED' })).status).toBe('ACTIVE');
  });
  test('CANCELLED wins over readability and hides the event', () => {
    const dto = followDto(
      row({ status: 'CANCELLED', cancelled_at: new Date('2026-10-28T02:00:00Z') }),
    );
    expect(dto).toMatchObject({
      status: 'CANCELLED',
      event: null,
      cancelledAt: '2026-10-28T02:00:00.000Z',
    });
  });
});

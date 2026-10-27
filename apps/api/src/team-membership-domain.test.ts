import { describe, expect, test } from 'vitest';
import {
  base32,
  claimStatus,
  joinCodeInput,
  joinCodeStatus,
  joinInput,
  linkInput,
  linkStatus,
  newJoinCode,
  newLinkToken,
  normalizeJoinCode,
  reviewInput,
  statusFilter,
  submitInput,
} from './team-membership-domain.js';

const fixed = (byte: number) => (size: number) => new Uint8Array(size).fill(byte);
const uuid4 = '0b4c8b1e-6f1a-4c2d-9e3f-1a2b3c4d5e6f';

describe('C19 team membership domain', () => {
  test('Base32 follows RFC 4648 known vectors (no padding)', () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foo')).toBe('MZXW6');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
  });
  test('join codes are 128-bit, 26 Base32 characters; link tokens 22 base64url', () => {
    expect(newJoinCode(fixed(0))).toBe('A'.repeat(26));
    expect(newJoinCode()).toMatch(/^[A-Z2-7]{26}$/);
    expect(newJoinCode()).not.toBe(newJoinCode());
    expect(newLinkToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(newLinkToken(), 'base64url')).toHaveLength(16);
  });
  test('join code input ignores case, spaces and hyphens and rejects anything else', () => {
    const code = newJoinCode();
    const grouped = code
      .toLowerCase()
      .replace(/(.{4})/g, '$1-')
      .replace(/-$/, '');
    expect(normalizeJoinCode(' ' + grouped + ' ')).toBe(code);
    for (const bad of ['', code.slice(1), code + 'A', code.slice(0, 25) + '1', 42, null])
      expect(() => normalizeJoinCode(bad)).toThrow(
        expect.objectContaining({ code: 'JOIN_CODE_INVALID' }),
      );
    expect(joinInput({ code, displayName: ' 张三 ' })).toEqual({ code, displayName: '张三' });
    expect(() => joinInput({ code, displayName: '张三', userId: uuid4 })).toThrow();
  });
  test('limits: links 1–168 h / 1–200 uses with a 4–500 reason; codes default 7 days / 30 uses', () => {
    expect(linkInput({ expiresInHours: 24, maxUses: 5, reason: ' 春季联赛 ' })).toEqual({
      expiresInHours: 24,
      maxUses: 5,
      reason: '春季联赛',
    });
    for (const body of [
      { expiresInHours: 0, maxUses: 5, reason: '春季联赛' },
      { expiresInHours: 169, maxUses: 5, reason: '春季联赛' },
      { expiresInHours: 24, maxUses: 201, reason: '春季联赛' },
      { expiresInHours: 24, maxUses: 5, reason: '短' },
      { expiresInHours: 24, maxUses: 5, reason: '春季联赛', orgId: uuid4 },
    ])
      expect(() => linkInput(body)).toThrow();
    expect(joinCodeInput(undefined)).toEqual({ expiresInHours: 168, maxUses: 30 });
    expect(() => joinCodeInput({ maxUses: 31 })).toThrow();
    expect(() => joinCodeInput({ expiresInHours: 1.5 })).toThrow();
  });
  test('team request inputs: UUID v4 request id, no client org id, review reason 4–500', () => {
    const token = newLinkToken();
    expect(submitInput({ token, clientRequestId: uuid4, teamName: ' 青锋 ' })).toEqual({
      token,
      clientRequestId: uuid4,
      teamName: '青锋',
      note: null,
    });
    expect(() =>
      submitInput({ token, clientRequestId: uuid4, teamName: '青锋', orgId: uuid4 }),
    ).toThrow();
    expect(() =>
      submitInput({ token, clientRequestId: uuid4.replace('-4c2d', '-1c2d'), teamName: '青锋' }),
    ).toThrow();
    expect(() => submitInput({ token: 'x', clientRequestId: uuid4, teamName: '青锋' })).toThrow(
      expect.objectContaining({ code: 'TEAM_REQUEST_LINK_INVALID' }),
    );
    expect(
      reviewInput({ decision: 'APPROVE', reason: '资料齐全', expectedVersion: 1 }).decision,
    ).toBe('APPROVE');
    expect(() => reviewInput({ decision: 'APPROVE', reason: '好', expectedVersion: 1 })).toThrow();
    expect(() =>
      reviewInput({ decision: 'MAYBE', reason: '资料齐全', expectedVersion: 1 }),
    ).toThrow();
    expect(statusFilter({})).toBeNull();
    expect(statusFilter({ status: 'PENDING' })).toBe('PENDING');
    expect(() => statusFilter({ status: 'ALL' })).toThrow();
  });
  test('derived statuses: revoked > expired > exhausted; issuer loss; claim expiry', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    const later = new Date('2026-10-29T00:00:00Z');
    const base = { max_uses: 2, use_count: 0, expires_at: later, revoked_at: null };
    expect(linkStatus(base, now)).toBe('ACTIVE');
    expect(linkStatus({ ...base, use_count: 2 }, now)).toBe('EXHAUSTED');
    expect(linkStatus({ ...base, expires_at: now }, now)).toBe('EXPIRED');
    expect(linkStatus({ ...base, revoked_at: now, expires_at: now }, now)).toBe('REVOKED');
    expect(joinCodeStatus(base, now, false)).toBe('ISSUER_INVALID');
    expect(joinCodeStatus({ ...base, revoked_at: now }, now, false)).toBe('REVOKED');
    expect(claimStatus({ status: 'PENDING', expires_at: now }, now)).toBe('EXPIRED');
    expect(claimStatus({ status: 'ACCEPTED', expires_at: now }, now)).toBe('ACCEPTED');
  });
});

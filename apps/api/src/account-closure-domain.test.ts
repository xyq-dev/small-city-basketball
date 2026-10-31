import { describe, expect, test } from 'vitest';
import {
  closureBlockers,
  closureCancelInput,
  closureDecision,
  closureRequestInput,
  closureSecurityFingerprint,
} from './account-closure-domain.js';
const id = '00000000-0000-4000-8000-000000000001';
const password = 'Synthetic closure password 2026';
const security = { password_hash: 'salted synthetic hash', credential_reset_at: null };
const identity = { id, app_id: 'wx0123456789abcdef', status: 'ACTIVE', version: 1 };
describe('explicit self-service closure choices and authorization', () => {
  test('default zero days is preserved and every user choice through seven days is accepted', () => {
    expect(closureRequestInput({ clientRequestId: id, password }).coolingOffDays).toBe(0);
    for (let days = 0; days <= 7; days++)
      expect(
        closureRequestInput({ clientRequestId: id, password, coolingOffDays: days }).coolingOffDays,
      ).toBe(days);
  });
  test.each([-1, 8, 1.5, '0', null, true])(
    'rejects malformed delay without coercion: %j',
    (value) => {
      expect(() =>
        closureRequestInput({ clientRequestId: id, password, coolingOffDays: value }),
      ).toThrow();
    },
  );
  test('rejects client user/roles and requires password for cancellation', () => {
    expect(() => closureRequestInput({ clientRequestId: id, password, userId: id })).toThrow();
    expect(() =>
      closureCancelInput({ clientRequestId: id, requestId: id, expectedVersion: 1 }),
    ).toThrow();
  });
  test('credential reset and WeChat binding version/status changes invalidate delayed authorization', () => {
    const fp = closureSecurityFingerprint(security, [identity]);
    expect(
      closureSecurityFingerprint({ ...security, password_hash: 'other' }, [identity]),
    ).not.toBe(fp);
    expect(
      closureSecurityFingerprint({ ...security, credential_reset_at: '2026-10-31T00:00:00Z' }, [
        identity,
      ]),
    ).not.toBe(fp);
    expect(
      closureSecurityFingerprint(security, [{ ...identity, version: 2, status: 'REVOKED' }]),
    ).not.toBe(fp);
    expect(closureSecurityFingerprint(security, [])).not.toBe(fp);
  });
  test('binding query order does not create artificial security changes', () => {
    const other = { ...identity, id: '00000000-0000-4000-8000-000000000002' };
    expect(closureSecurityFingerprint(security, [identity, other])).toBe(
      closureSecurityFingerprint(security, [other, identity]),
    );
  });
  const base = {
    status: 'PENDING' as const,
    executeAfter: '2026-11-01T00:00:00Z',
    now: '2026-10-31T00:00:00Z',
    storedFingerprint: 'a',
    currentFingerprint: 'a',
    blockers: [],
  };
  test('does not close early; exact due time may close and unresolved money blocks', () => {
    expect(closureDecision(base)).toBe('PENDING');
    expect(closureDecision({ ...base, now: base.executeAfter })).toBe('CLOSED');
    expect(
      closureDecision({ ...base, now: base.executeAfter, blockers: ['MONEY_UNRESOLVED'] }),
    ).toBe('BLOCKED');
  });
  test('a security change expires authorization before its due time', () => {
    expect(closureDecision({ ...base, currentFingerprint: 'b' })).toBe('EXPIRED_AUTH');
  });
  test.each(['CANCELLED', 'EXPIRED_AUTH', 'CLOSED'] as const)(
    'terminal %s cannot revive',
    (status) => {
      expect(closureDecision({ ...base, status, now: base.executeAfter })).toBe(status);
    },
  );
  test('blocker facts contain bounded public codes only and no hidden resource or personal data', () => {
    expect(
      closureBlockers(['OWNER_TRANSFER_REQUIRED', 'MONEY_UNRESOLVED', 'MONEY_UNRESOLVED']),
    ).toEqual(['MONEY_UNRESOLVED', 'OWNER_TRANSFER_REQUIRED']);
    expect(() => closureBlockers(['person@example.test'])).toThrow();
    expect(() => closureBlockers(Array(33).fill('MONEY_UNRESOLVED'))).toThrow();
  });
});

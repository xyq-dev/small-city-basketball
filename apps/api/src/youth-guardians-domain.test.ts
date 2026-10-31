import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  ageOn,
  identityBirthDate,
  openGuardian,
  sealGuardian,
  youthFingerprint,
  youthPolicyInput,
  youthPurposes,
} from './youth-guardians-domain.js';
import type { GuardianPayload } from './youth-guardians-domain.js';
const key = Buffer.alloc(32, 8);
const proof: GuardianPayload = {
  realName: '合成监护人',
  identityNumber: 'synthetic-only',
  relationship: 'PARENT',
  relationshipExplanation: '合成关系核验材料',
  proof: {
    fileName: 'proof.pdf',
    contentType: 'application/pdf',
    base64: Buffer.from('synthetic-only').toString('base64'),
    byteLength: 14,
    sha256: '0'.repeat(64),
  },
};
describe('youth age, purpose isolation and private proof envelope', () => {
  test('age uses the decision date and exact birthday rather than claimed ages', () => {
    expect(ageOn('2008-10-31', '2026-10-30')).toBe(17);
    expect(ageOn('2008-10-31', '2026-10-31')).toBe(18);
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    expect(() => ageOn('2027-01-01', '2026-10-31')).toThrow();
    expect(() => ageOn('2008-02-30', '2026-10-31')).toThrow();
  });
  test('arbitrary claimed birthday and invalid identity are not authoritative', () => {
    expect(() => identityBirthDate('2008-10-31', '2026-10-31')).toThrow();
    expect(() => identityBirthDate('990000200801010001', '2026-10-31')).toThrow();
  });
  test('participation never implies publicity, profile or recording permission', () => {
    expect(youthPurposes({})).toEqual(['PARTICIPATION']);
    expect(youthPurposes({ publicityConsent: true })).toEqual(['PARTICIPATION', 'PUBLICITY']);
    expect(youthPurposes({ archiveConsent: true, liveConsent: true })).toEqual([
      'PARTICIPATION',
      'PUBLIC_ARCHIVE',
      'LIVE_RECORDING',
    ]);
    expect(() => youthPurposes({ publicityConsent: 'true' })).toThrow();
    expect(() => youthPurposes({ acceptEverything: true })).toThrow();
  });
  test('event configuration cannot lower the guardian threshold below eighteen', () => {
    const p = {
      clientRequestId: randomUUID(),
      expectedVersion: null,
      enabled: true,
      guardianAgeThreshold: 18,
    };
    expect(youthPolicyInput(p).enabled).toBe(true);
    expect(() => youthPolicyInput({ ...p, guardianAgeThreshold: 14 })).toThrow();
    expect(() => youthPolicyInput({ ...p, guardianAgeThreshold: 18.5 })).toThrow();
    expect(() => youthPolicyInput({ ...p, enabled: 'yes' })).toThrow();
  });
  test('private proof authenticates the exact organization, request, guardian and version', () => {
    const org = randomUUID(),
      request = randomUUID(),
      guardian = randomUUID();
    const sealed = sealGuardian(proof, key, org, request, guardian, 1);
    expect(sealed).not.toContain(proof.realName);
    expect(openGuardian(sealed, key, org, request, guardian, 1)).toEqual(proof);
    expect(() => openGuardian(sealed, key, randomUUID(), request, guardian, 1)).toThrow();
    expect(() => openGuardian(sealed, key, org, randomUUID(), guardian, 1)).toThrow();
    expect(() => openGuardian(sealed, key, org, request, randomUUID(), 1)).toThrow();
    expect(() => openGuardian(sealed, key, org, request, guardian, 2)).toThrow();
    expect(() => openGuardian(sealed, Buffer.alloc(32, 9), org, request, guardian, 1)).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => openGuardian(parts.join('.'), key, org, request, guardian, 1)).toThrow();
  });
  test('private request digest is keyed and changes with confirmed content', () => {
    expect(youthFingerprint(key, { proof: 'a' })).not.toEqual(
      youthFingerprint(key, { proof: 'b' }),
    );
    expect(youthFingerprint(key, { proof: 'a' })).not.toEqual(
      youthFingerprint(Buffer.alloc(32, 9), { proof: 'a' }),
    );
  });
});

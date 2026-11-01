import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertInsuranceAdmission,
  insuranceEventHash,
  insuranceProviderOrigin,
  normalizeInsuranceAdmission,
} from './insurance-admission.js';
import type { InsuranceAdmission } from './insurance-admission.js';
const provider = { id: 'synthetic-reviewed', allowedOrigins: ['https://synthetic.invalid'] };
const input = {
  providerId: provider.id,
  productHash: 'b'.repeat(64),
  orgId: randomUUID(),
  eventId: randomUUID(),
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  timezone: 'Asia/Shanghai',
  venueName: '合成场地',
  birthDate: '2000-01-01',
  now: Date.parse('2026-10-30T00:00:00Z'),
};
function manifest(): InsuranceAdmission {
  return {
    id: randomUUID(),
    providerId: provider.id,
    protocolVersion: 'synthetic-only-v1',
    evidenceHash: 'a'.repeat(64),
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: '2026-11-30T00:00:00Z',
    salesMode: 'APPROVED_API',
    allowedOrigins: provider.allowedOrigins,
    products: [
      {
        sourceHash: input.productHash,
        minAge: 18,
        maxAge: 65,
        timezone: input.timezone,
        coverageTimeBasis: 'EVENT_LOCAL_CALENDAR_DAYS',
        events: [
          { orgId: input.orgId, eventId: input.eventId, eventHash: insuranceEventHash(input) },
        ],
      },
    ],
  };
}
describe('reviewed insurance admission', () => {
  it('admits only the exact reviewed product, organization, event and evidence release', () => {
    const a = normalizeInsuranceAdmission(manifest(), provider);
    expect(() => assertInsuranceAdmission(a, { ...input, releaseId: a.id })).not.toThrow();
    for (const change of [
      { orgId: randomUUID() },
      { eventId: randomUUID() },
      { venueName: '另一场地' },
      { endDate: '2026-11-03' },
      { productHash: 'c'.repeat(64) },
      { releaseId: randomUUID() },
      { releaseId: null },
      { timezone: 'UTC' },
    ])
      expect(() => assertInsuranceAdmission(a, { ...input, ...change })).toThrow();
  });
  it('fails closed without review, outside its validity, or for hosted-only sales', () => {
    expect(() => assertInsuranceAdmission(undefined, input)).toThrow();
    const a = normalizeInsuranceAdmission(manifest(), provider);
    for (const now of [Date.parse(a.validFrom) - 1, Date.parse(a.validUntil)])
      expect(() => assertInsuranceAdmission(a, { ...input, now })).toThrow();
    const hosted = normalizeInsuranceAdmission(
      {
        ...manifest(),
        salesMode: 'PROVIDER_HOSTED',
        providerEntryUrl: 'https://synthetic.invalid/start',
      },
      provider,
    );
    expect(() => assertInsuranceAdmission(hosted, input)).toThrow();
  });
  it('enforces adult age at start and maximum age throughout coverage', () => {
    const a = normalizeInsuranceAdmission(manifest(), provider);
    expect(() => assertInsuranceAdmission(a, { ...input, birthDate: '2008-11-02' })).toThrow();
    expect(() => assertInsuranceAdmission(a, { ...input, birthDate: '2008-11-01' })).not.toThrow();
    expect(() => assertInsuranceAdmission(a, { ...input, birthDate: '1960-11-02' })).toThrow();
    expect(() =>
      normalizeInsuranceAdmission(
        { ...manifest(), products: [{ ...manifest().products[0]!, minAge: 17 }] },
        provider,
      ),
    ).toThrow();
  });
  it('copies reviewed configuration and refuses forged origins, missing host rules and mutated product identities', () => {
    const raw = manifest(),
      a = normalizeInsuranceAdmission(raw, provider);
    raw.products[0]!.events[0]!.eventHash = 'd'.repeat(64);
    expect(() => assertInsuranceAdmission(a, input)).not.toThrow();
    for (const origin of [
      'http://synthetic.invalid',
      'https://127.0.0.1',
      'https://[::1]',
      'https://localhost',
      'https://insurer.local',
      'https://a.internal',
      'https://user@synthetic.invalid',
      'https://synthetic.invalid:444',
      'https://synthetic.invalid/path',
      'https://synthetic.invalid#x',
      'https://synthetic.invalid?x=1',
    ])
      expect(() => insuranceProviderOrigin(origin)).toThrow();
    expect(insuranceProviderOrigin('https://synthetic.invalid')).toBe('https://synthetic.invalid');
    expect(() =>
      normalizeInsuranceAdmission(
        { ...manifest(), allowedOrigins: ['https://other.invalid'] },
        provider,
      ),
    ).toThrow();
    expect(() =>
      normalizeInsuranceAdmission({ ...manifest(), salesMode: 'PROVIDER_HOSTED' }, provider),
    ).toThrow();
    expect(() =>
      normalizeInsuranceAdmission(
        { ...manifest(), products: [...manifest().products, ...manifest().products] },
        provider,
      ),
    ).toThrow();
  });
});

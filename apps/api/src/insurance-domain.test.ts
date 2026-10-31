import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  INSURANCE_TERMS_VERSION,
  insuranceCoverageEligible,
  insuranceKey,
  openInsurance,
  parseInsurancePurchase,
  sealInsurance,
  trustedInsuranceUrl,
  verifyInsuranceNotice,
} from './insurance-domain.js';
import { checkInsurancePolicy, checkInsuranceQuote } from './insurance-provider.js';
import type { InsurancePolicyFact, InsuranceQuote } from './insurance-provider.js';
const key = Buffer.alloc(32, 7),
  now = Date.parse('2026-10-31T00:00:00.000Z');
const quote: InsuranceQuote = {
  quoteReference: 'synthetic-quote',
  productExternalId: 'basketball',
  productVersion: 'v1',
  termsVersion: 'terms1',
  applicantReference: 'a'.repeat(64),
  premiumFen: 1200,
  currency: 'CNY',
  coverageStartDate: '2026-11-01',
  coverageEndDate: '2026-11-08',
  expiresAt: '2026-10-31T00:05:00.000Z',
};
const operation = randomUUID();
const fact: InsurancePolicyFact = {
  ...quote,
  operationId: operation,
  providerOrderId: 'synthetic-provider-order',
  paymentStatus: 'PAID',
  policyStatus: 'ISSUED',
  policyNumber: 'synthetic-policy',
  document: null,
  checkoutUrl: null,
};
describe('insurance trust and qualification domain', () => {
  it('requires current, paid, issued basketball coverage, current authorization and fresh evidence', () => {
    const base = {
      paymentStatus: 'PAID' as const,
      policyStatus: 'ISSUED' as const,
      coverageStartDate: '2026-11-01',
      coverageEndDate: '2026-11-08',
      eventStartDate: '2026-11-02',
      eventEndDate: '2026-11-07',
      currentMaterial: true,
      authorized: true,
      basketballCovered: true,
      verifiedAt: '2026-10-30T23:59:00Z',
      now: new Date(now).toISOString(),
    };
    expect(insuranceCoverageEligible(base)).toBe(true);
    for (const change of [
      { paymentStatus: 'PENDING' },
      { policyStatus: 'CANCEL_PENDING' },
      { currentMaterial: false },
      { authorized: false },
      { basketballCovered: false },
      { eventEndDate: '2026-11-09' },
      { verifiedAt: '2026-10-30T23:50:00Z' },
      { verifiedAt: '2026-10-31T00:01:00Z' },
    ])
      expect(insuranceCoverageEligible({ ...base, ...change } as typeof base)).toBe(false);
  });
  it('binds encrypted applicant/policy evidence to the exact resource and key', () => {
    const id = randomUUID(),
      envelope = sealInsurance(key, id, { syntheticIdentity: 'not a real identity' });
    expect(openInsurance(key, id, envelope)).toEqual({ syntheticIdentity: 'not a real identity' });
    expect(envelope).not.toContain('not a real identity');
    expect(() => openInsurance(key, randomUUID(), envelope)).toThrow();
    expect(() => openInsurance(Buffer.alloc(32, 8), id, envelope)).toThrow();
    expect(() => insuranceKey('bad')).toThrow();
  });
  it('rejects changed price, insured person, terms, coverage or currency from query', () => {
    expect(checkInsurancePolicy(fact, quote, operation, ['https://insurer.example.test'])).toEqual(
      fact,
    );
    for (const change of [
      { premiumFen: 1201 },
      { applicantReference: 'b'.repeat(64) },
      { termsVersion: 'other' },
      { currency: 'USD' },
      { coverageEndDate: '2026-11-07' },
      { operationId: randomUUID() },
      { policyNumber: null },
      { paymentStatus: 'PENDING' },
    ])
      expect(() =>
        checkInsurancePolicy({ ...fact, ...change } as InsurancePolicyFact, quote, operation, []),
      ).toThrow();
  });
  it('validates quote expiry and server-pinned product/coverage', () => {
    expect(checkInsuranceQuote(quote, quote, now)).toEqual(quote);
    expect(() =>
      checkInsuranceQuote({ ...quote, expiresAt: '2026-10-31T00:00:00Z' }, quote, now),
    ).toThrow();
    expect(() =>
      checkInsuranceQuote({ ...quote, expiresAt: '2026-10-31T00:16:00Z' }, quote, now),
    ).toThrow();
    expect(() => checkInsuranceQuote({ ...quote, productVersion: 'v2' }, quote, now)).toThrow();
  });
  it('requires explicit current purchase consent and refuses client-controlled prices', () => {
    const p = {
      clientRequestId: randomUUID(),
      quoteId: randomUUID(),
      acceptedTermsVersion: INSURANCE_TERMS_VERSION,
    };
    expect(parseInsurancePurchase(p)).toEqual(p);
    expect(() => parseInsurancePurchase({ ...p, acceptedTermsVersion: 'old' })).toThrow();
    expect(() => parseInsurancePurchase({ ...p, premiumFen: 1 })).toThrow();
  });
  it('accepts configured https supplier origins only, without credentials/fragments', () => {
    expect(
      trustedInsuranceUrl('https://insurer.example.test/pay/123', ['https://insurer.example.test']),
    ).toContain('/pay/123');
    for (const u of [
      'http://insurer.example.test/pay',
      'https://evil.test/pay',
      'https://a:b@insurer.example.test/pay',
      'https://insurer.example.test/pay#secret',
    ])
      expect(() => trustedInsuranceUrl(u, ['https://insurer.example.test'])).toThrow();
  });
  it('authenticates only a bounded-age wakeup reference, never supplied policy facts', () => {
    const notice = {
      providerId: 'synthetic',
      eventId: 'event1',
      operationId: operation,
      timestamp: new Date(now).toISOString(),
    };
    const signature = createHmac('sha256', key).update(JSON.stringify(notice)).digest('hex');
    expect(verifyInsuranceNotice(notice, signature, key, now)).toEqual(notice);
    expect(() =>
      verifyInsuranceNotice({ ...notice, policyStatus: 'ISSUED' }, signature, key, now),
    ).toThrow();
    expect(() => verifyInsuranceNotice(notice, signature, key, now + 300001)).toThrow();
    expect(() =>
      verifyInsuranceNotice({ ...notice, operationId: randomUUID() }, signature, key, now),
    ).toThrow();
  });
});

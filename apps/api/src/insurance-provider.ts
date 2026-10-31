import type {
  InsurancePaymentStatus,
  InsurancePolicyStatus,
} from '../../../packages/contracts/insurance.js';
import {
  insuranceDate,
  insuranceFail,
  insuranceFen,
  insuranceText,
  trustedInsuranceUrl,
} from './insurance-domain.js';

export interface InsuranceApplicant {
  realName: string;
  identityNumber: string;
  applicantReference: string;
  coverageStartDate: string;
  coverageEndDate: string;
}
export interface InsuranceProduct {
  externalId: string;
  version: string;
  name: string;
  insurer: string;
  termsVersion: string;
  termsUrl: string;
  basketballCovered: boolean;
}
export interface InsuranceQuote {
  quoteReference: string;
  productExternalId: string;
  productVersion: string;
  termsVersion: string;
  applicantReference: string;
  premiumFen: number;
  currency: 'CNY';
  coverageStartDate: string;
  coverageEndDate: string;
  expiresAt: string;
}
export interface InsurancePolicyFact extends Omit<InsuranceQuote, 'quoteReference' | 'expiresAt'> {
  operationId: string;
  providerOrderId: string;
  paymentStatus: InsurancePaymentStatus;
  policyStatus: InsurancePolicyStatus;
  policyNumber: string | null;
  document: { contentType: 'application/pdf'; base64: string } | null;
  checkoutUrl: string | null;
}
/** Only a reviewed supplier driver may implement this port; no default/fake production insurer. */
export interface InsuranceProvider {
  readonly id: string;
  readonly allowedOrigins: readonly string[];
  catalog(): Promise<InsuranceProduct[]>;
  quote(
    input: InsuranceApplicant & { productExternalId: string; productVersion: string },
  ): Promise<InsuranceQuote>;
  apply(
    operationId: string,
    input: InsuranceApplicant & { quote: InsuranceQuote },
  ): Promise<'ACCEPTED' | 'UNKNOWN' | 'REJECTED'>;
  query(operationId: string): Promise<InsurancePolicyFact | null>;
  cancel(cancellationId: string, operationId: string): Promise<'ACCEPTED' | 'UNKNOWN' | 'REJECTED'>;
}
const invalid = (): never =>
  insuranceFail('INVALID_INSURANCE_PROVIDER_RESULT', '保险服务返回资料无法核验', 502);
export function checkInsuranceProduct(
  p: InsuranceProduct,
  origins: readonly string[],
): InsuranceProduct {
  if (typeof p?.basketballCovered !== 'boolean') invalid();
  return {
    externalId: insuranceText(p.externalId, 120),
    version: insuranceText(p.version, 100),
    name: insuranceText(p.name, 120),
    insurer: insuranceText(p.insurer, 120),
    termsVersion: insuranceText(p.termsVersion, 120),
    termsUrl: trustedInsuranceUrl(p.termsUrl, origins),
    basketballCovered: p.basketballCovered,
  };
}
export function checkInsuranceQuote(
  q: InsuranceQuote,
  expected: Omit<InsuranceQuote, 'quoteReference' | 'expiresAt' | 'premiumFen'>,
  now: number,
): InsuranceQuote {
  if (
    !q ||
    q.currency !== 'CNY' ||
    !Number.isFinite(Date.parse(q.expiresAt)) ||
    Date.parse(q.expiresAt) <= now ||
    Date.parse(q.expiresAt) > now + 15 * 60000
  )
    invalid();
  for (const key of [
    'productExternalId',
    'productVersion',
    'termsVersion',
    'applicantReference',
    'coverageStartDate',
    'coverageEndDate',
    'currency',
  ] as const)
    if (q[key] !== expected[key]) invalid();
  insuranceDate(q.coverageStartDate);
  insuranceDate(q.coverageEndDate);
  insuranceFen(q.premiumFen);
  insuranceText(q.quoteReference, 200);
  return q;
}
export function checkInsurancePolicy(
  f: InsurancePolicyFact,
  expected: InsuranceQuote,
  operationId: string,
  origins: readonly string[],
): InsurancePolicyFact {
  if (!f || f.operationId !== operationId || f.currency !== 'CNY') invalid();
  for (const key of [
    'productExternalId',
    'productVersion',
    'termsVersion',
    'applicantReference',
    'coverageStartDate',
    'coverageEndDate',
    'premiumFen',
    'currency',
  ] as const)
    if (f[key] !== expected[key]) invalid();
  insuranceText(f.providerOrderId, 200);
  if (
    !['UNPAID', 'PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'FAILED'].includes(
      f.paymentStatus,
    ) ||
    !['PENDING', 'ISSUED', 'FAILED', 'CANCEL_PENDING', 'CANCELLED'].includes(f.policyStatus)
  )
    invalid();
  if (f.policyStatus === 'ISSUED' && (f.paymentStatus !== 'PAID' || !f.policyNumber)) invalid();
  if (f.policyNumber !== null) insuranceText(f.policyNumber, 200);
  if (f.checkoutUrl !== null) trustedInsuranceUrl(f.checkoutUrl, origins);
  if (f.document !== null) {
    if (f.document.contentType !== 'application/pdf' || typeof f.document.base64 !== 'string')
      invalid();
    const b = Buffer.from(f.document.base64, 'base64');
    if (
      b.length < 8 ||
      b.length > 2 * 1024 * 1024 ||
      b.toString('base64') !== f.document.base64 ||
      b.subarray(0, 5).toString() !== '%PDF-'
    )
      invalid();
  }
  return f;
}

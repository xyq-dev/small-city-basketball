import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ApiError } from './errors.js';
import { calendarDate, objectInput, resourceId } from './validation.js';
import type {
  InsurancePaymentStatus,
  InsurancePolicyStatus,
} from '../../../packages/contracts/insurance.js';

export const INSURANCE_TERMS_VERSION = 'insurance-purchase-consent-v1';
export const INSURANCE_PROOF_MAX_AGE_SECONDS = 300;
export const INSURANCE_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const insuranceFail = (code: string, message: string, status = 422): never => {
  throw new ApiError(status, code, message);
};
export const insuranceHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function insuranceKey(raw: unknown): Buffer {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(raw))
    insuranceFail('INSURANCE_UNAVAILABLE', '保险安全配置尚未就绪', 503);
  const bytes = Buffer.from(raw as string, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== raw)
    insuranceFail('INSURANCE_UNAVAILABLE', '保险安全配置尚未就绪', 503);
  return bytes;
}
export const insuranceKeyId = (key: Buffer) =>
  createHash('sha256').update('scb-insurance-key-v1\0').update(key).digest('hex');
export const insuranceFingerprint = (key: Buffer, value: unknown) =>
  createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
export function sealInsurance(key: Buffer, resource: string, value: unknown): string {
  resourceId(resource);
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`scb-insurance:v1:${resource}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'i1',
    insuranceKeyId(key),
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function openInsurance<T>(key: Buffer, resource: string, envelope: string): T {
  try {
    resourceId(resource);
    const p = envelope.split('.');
    if (p.length !== 5 || p[0] !== 'i1' || p[1] !== insuranceKeyId(key)) throw Error();
    const decode = (s: string, size?: number) => {
      if (!/^[A-Za-z0-9_-]+$/.test(s)) throw Error();
      const b = Buffer.from(s, 'base64url');
      if (b.toString('base64url') !== s || (size !== undefined && b.length !== size)) throw Error();
      return b;
    };
    const cipher = createDecipheriv('aes-256-gcm', key, decode(p[2]!, 12));
    cipher.setAAD(Buffer.from(`scb-insurance:v1:${resource}`));
    cipher.setAuthTag(decode(p[3]!, 16));
    return JSON.parse(
      Buffer.concat([cipher.update(decode(p[4]!)), cipher.final()]).toString('utf8'),
    ) as T;
  } catch {
    return insuranceFail('INSURANCE_UNAVAILABLE', '保险资料暂不可用', 503);
  }
}
export function insuranceText(value: unknown, maximum = 120): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    insuranceFail('INVALID_INSURANCE_INPUT', '请核对保险资料');
  return value as string;
}
export function insuranceDate(value: unknown): string {
  return calendarDate(value, '保障日期');
}
export function insuranceFen(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100000000)
    insuranceFail('INVALID_INSURANCE_PROVIDER_RESULT', '保险服务返回资料无法核验', 502);
  return value as number;
}
export function trustedInsuranceUrl(value: unknown, allowedOrigins: readonly string[]): string {
  const raw = insuranceText(value, 2048);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return insuranceFail('INVALID_INSURANCE_PROVIDER_RESULT', '保险服务地址无法核验', 502);
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.hash ||
    !allowedOrigins.includes(u.origin)
  )
    insuranceFail('INVALID_INSURANCE_PROVIDER_RESULT', '保险服务地址无法核验', 502);
  return u.toString();
}
export function insuranceId(value: unknown): string {
  if (typeof value !== 'string') insuranceFail('INVALID_INSURANCE_INPUT', '请核对资料编号');
  return resourceId(value as string);
}
export function parseInsuranceQuote(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'entryId', 'memberId', 'productId']);
  return {
    clientRequestId: insuranceId(b.clientRequestId),
    entryId: insuranceId(b.entryId),
    memberId: insuranceId(b.memberId),
    productId: insuranceId(b.productId),
  };
}
export function parseInsurancePurchase(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'quoteId', 'acceptedTermsVersion']);
  if (b.acceptedTermsVersion !== INSURANCE_TERMS_VERSION)
    insuranceFail('INSURANCE_CONSENT_REQUIRED', '请阅读并明确同意当前投保条款');
  return {
    clientRequestId: insuranceId(b.clientRequestId),
    quoteId: insuranceId(b.quoteId),
    acceptedTermsVersion: INSURANCE_TERMS_VERSION,
  };
}
export function parseInsuranceCommand(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'expectedVersion', 'type']);
  if (
    !Number.isInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 1 ||
    !['REFRESH', 'REQUEST_CANCELLATION'].includes(String(b.type))
  )
    insuranceFail('INVALID_INSURANCE_INPUT', '请重新读取保单资料');
  return {
    clientRequestId: insuranceId(b.clientRequestId),
    expectedVersion: b.expectedVersion as number,
    type: b.type as 'REFRESH' | 'REQUEST_CANCELLATION',
  };
}
export interface InsuranceCoverageFact {
  paymentStatus: InsurancePaymentStatus;
  policyStatus: InsurancePolicyStatus;
  coverageStartDate: string;
  coverageEndDate: string;
  eventStartDate: string;
  eventEndDate: string;
  currentMaterial: boolean;
  authorized: boolean;
  basketballCovered: boolean;
  verifiedAt: string | null;
  now: string;
}
export function insuranceCoverageEligible(f: InsuranceCoverageFact): boolean {
  const now = Date.parse(f.now),
    verified = f.verifiedAt ? Date.parse(f.verifiedAt) : NaN;
  return (
    f.authorized &&
    f.currentMaterial &&
    f.basketballCovered &&
    f.paymentStatus === 'PAID' &&
    f.policyStatus === 'ISSUED' &&
    f.coverageStartDate <= f.eventStartDate &&
    f.coverageEndDate >= f.eventEndDate &&
    Number.isFinite(now) &&
    Number.isFinite(verified) &&
    verified <= now &&
    now - verified <= INSURANCE_PROOF_MAX_AGE_SECONDS * 1000
  );
}
/** Own integration-gateway notice protocol, not an invented insurer-specific API. */
export function verifyInsuranceNotice(raw: unknown, signature: unknown, key: Buffer, now: number) {
  const b = objectInput(raw, ['providerId', 'eventId', 'operationId', 'timestamp']);
  const v = {
    providerId: insuranceText(b.providerId, 80),
    eventId: insuranceText(b.eventId, 120),
    operationId: insuranceId(b.operationId),
    timestamp: insuranceText(b.timestamp, 40),
  };
  const at = Date.parse(v.timestamp);
  if (
    !Number.isFinite(at) ||
    Math.abs(now - at) > 300000 ||
    typeof signature !== 'string' ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    insuranceFail('INSURANCE_NOTICE_INVALID', '保险通知无法核验', 401);
  const expected = createHmac('sha256', key).update(JSON.stringify(v)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature as string, 'hex')))
    insuranceFail('INSURANCE_NOTICE_INVALID', '保险通知无法核验', 401);
  return v;
}

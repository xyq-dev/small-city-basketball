import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';
import { calendarDate, objectInput, resourceId, text } from './validation.js';
import { participantIdentityNumber } from './participant-materials-domain.js';
import type { YouthPurpose } from '../../../packages/contracts/youth-guardians.js';
import type { StoredParticipantFile } from './participant-materials-domain.js';

export const YOUTH_TERMS_VERSION = 'youth-participation-v1';
export const YOUTH_DATA_TERMS_VERSION = 'youth-data-processing-v1';
export const youthFail = (code: string, message: string, status = 409): never => {
  throw new ApiError(status, code, message);
};
export function youthId(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(422, 'YOUTH_INPUT_INVALID', '资料编号无效');
  return resourceId(value);
}
export function ageOn(birthDate: string, asOf: string): number {
  calendarDate(birthDate, 'birthDate');
  calendarDate(asOf, 'asOf');
  if (birthDate > asOf || birthDate < '1900-01-01')
    youthFail('YOUTH_SOURCE_INVALID', '年龄来源无法核验');
  return (
    Number(asOf.slice(0, 4)) -
    Number(birthDate.slice(0, 4)) -
    (asOf.slice(5) < birthDate.slice(5) ? 1 : 0)
  );
}
export function identityBirthDate(identity: unknown, today: string): string {
  const n = participantIdentityNumber(identity, today);
  return `${n.slice(6, 10)}-${n.slice(10, 12)}-${n.slice(12, 14)}`;
}
/** Participation uses event age; public processing additionally needs today's minor consent. */
export function guardianRequestRequired(input: {
  birthDate: string;
  policyDate: string;
  processingDate: string;
  threshold: number;
  purposes: YouthPurpose[];
}): boolean {
  return (
    ageOn(input.birthDate, input.policyDate) < input.threshold ||
    (ageOn(input.birthDate, input.processingDate) < input.threshold &&
      input.purposes.some((p) => p !== 'PARTICIPATION'))
  );
}
/** ageOn reaches a non-leap-year birthday for February 29 on March 1. */
export function guardianThresholdDate(birthDate: string, threshold: number): string {
  calendarDate(birthDate, 'birthDate');
  if (!Number.isInteger(threshold) || threshold < 18 || threshold > 21)
    youthFail('YOUTH_SOURCE_INVALID', '年龄规则无法核验');
  const year = Number(birthDate.slice(0, 4)) + threshold,
    candidate = String(year).padStart(4, '0') + birthDate.slice(4);
  try {
    calendarDate(candidate, 'thresholdDate');
    return candidate;
  } catch {
    if (birthDate.slice(5) === '02-29') return String(year).padStart(4, '0') + '-03-01';
    return youthFail('YOUTH_SOURCE_INVALID', '年龄来源无法核验');
  }
}
export function youthVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    youthFail('YOUTH_INPUT_INVALID', '请重新读取当前版本', 422);
  return Number(value);
}
export function youthCommand(raw: unknown, fields: string[]) {
  const b = objectInput(raw, ['clientRequestId', 'expectedVersion', ...fields]);
  return { b, id: youthId(b.clientRequestId), expectedVersion: youthVersion(b.expectedVersion) };
}
export function youthPolicyInput(raw: unknown) {
  const b = objectInput(raw, [
    'clientRequestId',
    'expectedVersion',
    'enabled',
    'guardianAgeThreshold',
  ]);
  if (
    typeof b.enabled !== 'boolean' ||
    !Number.isInteger(b.guardianAgeThreshold) ||
    Number(b.guardianAgeThreshold) < 18 ||
    Number(b.guardianAgeThreshold) > 21
  )
    youthFail('YOUTH_INPUT_INVALID', '请选择青年规则及18至21岁的业务年龄阈值', 422);
  if (
    b.expectedVersion !== null &&
    (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 1)
  )
    youthFail('YOUTH_INPUT_INVALID', '请重新读取当前规则版本', 422);
  return {
    clientRequestId: youthId(b.clientRequestId),
    expectedVersion: b.expectedVersion as number | null,
    enabled: b.enabled,
    guardianAgeThreshold: Number(b.guardianAgeThreshold),
  };
}
export interface GuardianPayload {
  realName: string;
  identityNumber: string;
  relationship: 'PARENT' | 'LEGAL_GUARDIAN';
  relationshipExplanation: string;
  proof: StoredParticipantFile;
}
const assertKey = (key: Buffer) => {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    youthFail('YOUTH_PRIVATE_DATA_UNAVAILABLE', '监护证明安全存储尚未配置', 503);
};
const encryptionKey = (key: Buffer) => {
  assertKey(key);
  return createHmac('sha256', key).update('scb-youth-guardian-encryption-v1').digest();
};
export function youthPurposes(raw: unknown): YouthPurpose[] {
  const b = objectInput(raw, ['publicityConsent', 'archiveConsent', 'liveConsent']);
  const out: YouthPurpose[] = ['PARTICIPATION'];
  for (const [field, purpose] of [
    ['publicityConsent', 'PUBLICITY'],
    ['archiveConsent', 'PUBLIC_ARCHIVE'],
    ['liveConsent', 'LIVE_RECORDING'],
  ] as const) {
    if (b[field] !== undefined && typeof b[field] !== 'boolean')
      youthFail('YOUTH_INPUT_INVALID', '请分别确认资料用途', 422);
    if (b[field] === true) out.push(purpose);
  }
  return out;
}
const aad = (orgId: string, requestId: string, guardianId: string, version: number) =>
  Buffer.from(
    JSON.stringify([
      'youth-guardian-v1',
      resourceId(orgId),
      resourceId(requestId),
      resourceId(guardianId),
      youthVersion(version),
    ]),
  );
export function youthFingerprint(key: Buffer, value: unknown): string {
  return createHmac('sha256', key)
    .update('scb-youth-guardian-command-v1\0')
    .update(JSON.stringify(value))
    .digest('hex');
}
export function sealGuardian(
  payload: GuardianPayload,
  key: Buffer,
  orgId: string,
  requestId: string,
  guardianId: string,
  version: number,
): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(aad(orgId, requestId, guardianId, version));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return [
    'yg1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    bytes.toString('base64'),
  ].join('.');
}
export function openGuardian(
  value: string,
  key: Buffer,
  orgId: string,
  requestId: string,
  guardianId: string,
  version: number,
): GuardianPayload {
  try {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'yg1') throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(key),
      Buffer.from(parts[1]!, 'base64'),
    );
    decipher.setAAD(aad(orgId, requestId, guardianId, version));
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64'));
    const p = JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64')), decipher.final()]).toString(
        'utf8',
      ),
    );
    if (
      typeof p.realName !== 'string' ||
      typeof p.identityNumber !== 'string' ||
      !['PARENT', 'LEGAL_GUARDIAN'].includes(p.relationship) ||
      typeof p.relationshipExplanation !== 'string' ||
      typeof p.proof?.base64 !== 'string'
    )
      throw new Error();
    return p;
  } catch {
    return youthFail('YOUTH_PRIVATE_DATA_UNAVAILABLE', '监护证明暂不可读取', 503);
  }
}
export function guardianText(raw: unknown, today: string) {
  const b = objectInput(raw, [
    'clientRequestId',
    'expectedVersion',
    'acceptedTerms',
    'termsVersion',
    'realName',
    'identityNumber',
    'relationship',
    'relationshipExplanation',
    'proof',
    'publicityConsent',
    'archiveConsent',
    'liveConsent',
  ]);
  if (
    b.acceptedTerms !== true ||
    b.termsVersion !== YOUTH_TERMS_VERSION ||
    !['PARENT', 'LEGAL_GUARDIAN'].includes(String(b.relationship))
  )
    youthFail('YOUTH_CONSENT_REQUIRED', '请本人阅读本届条款并确认监护关系', 422);
  const identityNumber = participantIdentityNumber(b.identityNumber, today);
  if (ageOn(identityBirthDate(identityNumber, today), today) < 18)
    youthFail('GUARDIAN_ADULT_REQUIRED', '监护人须完成当前成年身份核验', 422);
  return {
    clientRequestId: youthId(b.clientRequestId),
    expectedVersion: youthVersion(b.expectedVersion),
    realName: text(b.realName, 'realName', 1, 80),
    identityNumber,
    relationship: b.relationship as GuardianPayload['relationship'],
    relationshipExplanation: text(b.relationshipExplanation, 'relationshipExplanation', 4, 500),
    proof: b.proof,
    purposes: youthPurposes({
      publicityConsent: b.publicityConsent,
      archiveConsent: b.archiveConsent,
      liveConsent: b.liveConsent,
    }),
  };
}

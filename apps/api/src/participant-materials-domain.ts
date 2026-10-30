import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { ApiError } from './errors.js';
import { MAX_MEDIA_FILE_BYTES, parseMediaUpload } from './media-domain.js';
import { calendarDate, invalid, objectInput, resourceId, text } from './validation.js';

export const PARTICIPANT_TERMS_VERSION = 'registration-materials-v1';
export const PARTICIPANT_MAX_PIXELS = 16777216;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENVELOPE_VERSION = 'pm1';

export type ParticipantMaterialStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
export interface ParticipantResource {
  orgId: string;
  eventId: string;
  entryId: string;
  memberId: string;
  userId: string;
  revisionId: string;
}
export interface ParticipantFileInput {
  fileName: string;
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
  base64: string;
}
export interface StoredParticipantFile extends ParticipantFileInput {
  byteLength: number;
  sha256: string;
}
export interface ParticipantInsurance {
  insurer: string | null;
  policyNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  document: StoredParticipantFile | null;
}
export interface ParticipantPrivatePayload {
  realName: string | null;
  identityNumber: string | null;
  portrait: StoredParticipantFile | null;
  insurance: ParticipantInsurance | null;
  acceptedTerms: boolean;
  termsVersion: string | null;
  publicityConsent: boolean;
}
export interface ParticipantDraftInput {
  clientRequestId: string;
  expectedVersion: number;
  realName?: string | null;
  identityNumber?: string | null;
  portrait?: ParticipantFileInput | null;
  insurance?: {
    insurer?: string | null;
    policyNumber?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    document?: ParticipantFileInput | null;
  } | null;
  acceptedTerms?: boolean;
  publicityConsent?: boolean;
}

const unavailable = () => new ApiError(503, 'PARTICIPANT_DATA_UNAVAILABLE', '本人资料服务暂不可用');

/** Only a canonical, dedicated 256-bit base64 key is accepted; never print the supplied value. */
export function participantKey(raw?: string): Buffer {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw unavailable();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw unavailable();
  return key;
}
function assertKey(key: Buffer) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw unavailable();
}
export function participantKeyId(key: Buffer): string {
  assertKey(key);
  return createHash('sha256').update('scb-participant-key-id-v1\0').update(key).digest('hex');
}
function aadBytes(aad: ParticipantResource): Buffer {
  const parts = [aad.orgId, aad.eventId, aad.entryId, aad.memberId, aad.userId, aad.revisionId];
  // A fixed ordered tuple avoids object order, concatenation and cross-resource ambiguity.
  return Buffer.from(JSON.stringify([ENVELOPE_VERSION, ...parts.map(resourceId)]), 'utf8');
}
function derivedKey(key: Buffer, purpose: string): Buffer {
  assertKey(key);
  return createHmac('sha256', key).update(`scb-participant-${purpose}-v1\0`).digest();
}
export function encryptParticipantPayload(
  payload: ParticipantPrivatePayload,
  key: Buffer,
  aad: ParticipantResource,
): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(key, 'encryption'), iv);
  cipher.setAAD(aadBytes(aad));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [
    ENVELOPE_VERSION,
    participantKeyId(key),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
function decodeCanonical(value: string, length?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw unavailable();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length))
    throw unavailable();
  return bytes;
}
export function decryptParticipantPayload(
  envelope: string,
  key: Buffer,
  aad: ParticipantResource,
): ParticipantPrivatePayload {
  try {
    assertKey(key);
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION || parts[1] !== participantKeyId(key))
      throw unavailable();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      derivedKey(key, 'encryption'),
      decodeCanonical(parts[2]!, 12),
    );
    decipher.setAAD(aadBytes(aad));
    decipher.setAuthTag(decodeCanonical(parts[3]!, 16));
    const plaintext = Buffer.concat([
      decipher.update(decodeCanonical(parts[4]!)),
      decipher.final(),
    ]);
    const payload: unknown = JSON.parse(plaintext.toString('utf8'));
    // The envelope is authenticated, but corrupted/application-incompatible data must fail closed.
    if (!isStoredPayload(payload)) throw unavailable();
    return payload;
  } catch {
    throw unavailable();
  }
}
function isStoredFile(file: unknown): file is StoredParticipantFile {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return false;
  const f = file as Record<string, unknown>;
  return (
    typeof f.fileName === 'string' &&
    ['image/jpeg', 'application/pdf'].includes(f.contentType as string) &&
    typeof f.base64 === 'string' &&
    typeof f.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(f.sha256) &&
    Number.isSafeInteger(f.byteLength) &&
    Number(f.byteLength) > 0 &&
    Number(f.byteLength) <= MAX_MEDIA_FILE_BYTES
  );
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isStoredPayload(value: unknown): value is ParticipantPrivatePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (
    !nullableString(p.realName) ||
    !nullableString(p.identityNumber) ||
    !(p.portrait === null || isStoredFile(p.portrait)) ||
    typeof p.acceptedTerms !== 'boolean' ||
    !nullableString(p.termsVersion) ||
    typeof p.publicityConsent !== 'boolean'
  )
    return false;
  if (p.insurance === null) return true;
  if (!p.insurance || typeof p.insurance !== 'object' || Array.isArray(p.insurance)) return false;
  const i = p.insurance as Record<string, unknown>;
  return (
    ['insurer', 'policyNumber', 'startDate', 'endDate'].every((k) => nullableString(i[k])) &&
    (i.document === null || isStoredFile(i.document))
  );
}

export function participantIdentityDigest(
  identity: string,
  key: Buffer,
  orgId: string,
  eventId: string,
): string {
  return createHmac('sha256', derivedKey(key, 'identity'))
    .update(JSON.stringify([resourceId(orgId), resourceId(eventId), identity]))
    .digest('hex');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function participantRequestFingerprint(
  input: unknown,
  key: Buffer,
  scope: readonly string[],
): string {
  return createHmac('sha256', derivedKey(key, 'request'))
    .update(JSON.stringify(['draft-v1', scope, canonical(input)]))
    .digest('hex');
}

/** Format/checksum/date checks only; this does not claim government identity verification. */
export function participantIdentityNumber(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): string {
  if (typeof value !== 'string')
    return invalid('请填写有效身份证号码', { identityNumber: '请检查身份证号码' });
  const number = value.trim().toUpperCase();
  const fail = () => invalid('请填写有效身份证号码', { identityNumber: '请检查身份证号码' });
  if (!/^[1-9]\d{16}[0-9X]$/.test(number) || number.slice(14, 17) === '000') return fail();
  const birth = `${number.slice(6, 10)}-${number.slice(10, 12)}-${number.slice(12, 14)}`;
  try {
    calendarDate(birth, 'identityNumber');
  } catch {
    return fail();
  }
  if (birth < '1900-01-01' || birth > today) return fail();
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((total, weight, i) => total + Number(number[i]) * weight, 0);
  if ('10X98765432'[sum % 11] !== number[17]) return fail();
  return number;
}
export function maskParticipantIdentity(identity: string | null): string | null {
  return identity ? `${identity.slice(0, 3)}***********${identity.slice(-4)}` : null;
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  return value === null || value === '' ? null : text(value, field, 1, maximum);
}
function fileInput(value: unknown, kind: 'portrait' | 'insurance'): ParticipantFileInput | null {
  if (value === null) return null;
  const raw = objectInput(value, ['fileName', 'contentType', 'base64']);
  if (kind === 'portrait' && !['image/jpeg', 'image/png'].includes(raw.contentType as string))
    invalid('本人照片仅支持JPEG或PNG');
  // Reuse exact base64, filename, declared type and structural validation, not ENTRY authorization.
  const file = parseMediaUpload(
    { ...raw, purpose: kind === 'portrait' ? 'REGISTRATION_DOC' : 'PRIVATE_INSURANCE' },
    'ENTRY',
  );
  return {
    fileName: file.fileName,
    contentType: file.contentType as ParticipantFileInput['contentType'],
    base64: file.payload.toString('base64'),
  };
}
export function parseParticipantDraft(value: unknown): ParticipantDraftInput {
  const raw = objectInput(value, [
    'clientRequestId',
    'expectedVersion',
    'realName',
    'identityNumber',
    'portrait',
    'insurance',
    'acceptedTerms',
    'publicityConsent',
  ]);
  if (typeof raw.clientRequestId !== 'string' || !UUID_V4.test(raw.clientRequestId))
    invalid('请求编号无效');
  if (
    !Number.isInteger(raw.expectedVersion) ||
    Number(raw.expectedVersion) < 0 ||
    Number(raw.expectedVersion) > 2147483647
  )
    invalid('请提供有效资料版本');
  const input: ParticipantDraftInput = {
    clientRequestId: raw.clientRequestId,
    expectedVersion: raw.expectedVersion as number,
  };
  if (raw.realName !== undefined) input.realName = optionalText(raw.realName, 'realName', 80);
  if (raw.identityNumber !== undefined)
    input.identityNumber =
      raw.identityNumber === null || raw.identityNumber === ''
        ? null
        : participantIdentityNumber(raw.identityNumber);
  if (raw.portrait !== undefined) input.portrait = fileInput(raw.portrait, 'portrait');
  if (raw.insurance !== undefined) {
    if (raw.insurance === null) input.insurance = null;
    else {
      const insurance = objectInput(raw.insurance, [
        'insurer',
        'policyNumber',
        'startDate',
        'endDate',
        'document',
      ]);
      const item: NonNullable<ParticipantDraftInput['insurance']> = {};
      for (const field of ['insurer', 'policyNumber'] as const)
        if (insurance[field] !== undefined)
          item[field] = optionalText(insurance[field], `insurance.${field}`, 120);
      for (const field of ['startDate', 'endDate'] as const)
        if (insurance[field] !== undefined)
          item[field] =
            insurance[field] === null || insurance[field] === ''
              ? null
              : calendarDate(insurance[field], `insurance.${field}`);
      if (insurance.document !== undefined)
        item.document = fileInput(insurance.document, 'insurance');
      if (item.startDate && item.endDate && item.startDate > item.endDate)
        invalid('保单结束日期不能早于开始日期');
      input.insurance = item;
    }
  }
  for (const field of ['acceptedTerms', 'publicityConsent'] as const)
    if (raw[field] !== undefined) {
      if (typeof raw[field] !== 'boolean')
        invalid('请明确确认资料用途', { [field]: '请选择是或否' });
      input[field] = raw[field];
    }
  return input;
}

/** Full pixel decoding/re-encoding removes EXIF, XMP, ICC and appended data by construction. */
export async function sanitizeParticipantFile(
  file: ParticipantFileInput,
  kind: 'portrait' | 'insurance',
): Promise<StoredParticipantFile> {
  const checked = fileInput(file, kind)!;
  const bytes = Buffer.from(checked.base64, 'base64');
  let output: Buffer;
  let contentType: StoredParticipantFile['contentType'];
  if (checked.contentType === 'application/pdf') {
    // PDF remains a private download attachment; do not render it as trusted HTML or an image.
    output = bytes;
    contentType = 'application/pdf';
  } else {
    try {
      const image = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: PARTICIPANT_MAX_PIXELS,
        animated: false,
      });
      const metadata = await image.metadata();
      const declared = checked.contentType === 'image/jpeg' ? 'jpeg' : 'png';
      if (
        metadata.format !== declared ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > 8192 ||
        metadata.height > 8192 ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error('Invalid image');
      const max = kind === 'portrait' ? 2048 : 4096;
      output = await image
        .rotate()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 88, mozjpeg: false })
        .toBuffer();
      contentType = 'image/jpeg';
    } catch {
      return invalid('图片无法完整读取，请重新选择清晰的JPEG或PNG文件');
    }
  }
  if (!output.length || output.length > MAX_MEDIA_FILE_BYTES) invalid('处理后的文件不得超过8MiB');
  return {
    fileName: `${kind === 'portrait' ? 'portrait' : 'insurance'}.${contentType === 'application/pdf' ? 'pdf' : 'jpg'}`,
    contentType,
    base64: output.toString('base64'),
    byteLength: output.length,
    sha256: createHash('sha256').update(output).digest('hex'),
  };
}
export async function mergeParticipantDraft(
  previous: ParticipantPrivatePayload | null,
  input: ParticipantDraftInput,
): Promise<ParticipantPrivatePayload> {
  const result: ParticipantPrivatePayload = previous
    ? structuredClone(previous)
    : {
        realName: null,
        identityNumber: null,
        portrait: null,
        insurance: null,
        acceptedTerms: false,
        termsVersion: null,
        publicityConsent: false,
      };
  if (input.realName !== undefined) result.realName = input.realName;
  if (input.identityNumber !== undefined) result.identityNumber = input.identityNumber;
  if (input.portrait !== undefined) {
    result.portrait =
      input.portrait === null ? null : await sanitizeParticipantFile(input.portrait, 'portrait');
    // Consent for one photograph never silently authorizes its replacement.
    result.publicityConsent = input.publicityConsent === true && result.portrait !== null;
  }
  if (input.insurance !== undefined) {
    if (input.insurance === null) result.insurance = null;
    else {
      const insurance: ParticipantInsurance = result.insurance ?? {
        insurer: null,
        policyNumber: null,
        startDate: null,
        endDate: null,
        document: null,
      };
      for (const field of ['insurer', 'policyNumber', 'startDate', 'endDate'] as const)
        if (input.insurance[field] !== undefined) insurance[field] = input.insurance[field]!;
      if (input.insurance.document !== undefined)
        insurance.document =
          input.insurance.document === null
            ? null
            : await sanitizeParticipantFile(input.insurance.document, 'insurance');
      if (insurance.startDate && insurance.endDate && insurance.startDate > insurance.endDate)
        invalid('保单结束日期不能早于开始日期');
      result.insurance = insurance;
    }
  }
  if (input.acceptedTerms !== undefined) {
    result.acceptedTerms = input.acceptedTerms;
    result.termsVersion = input.acceptedTerms ? PARTICIPANT_TERMS_VERSION : null;
  }
  if (input.publicityConsent !== undefined)
    result.publicityConsent = input.publicityConsent && result.portrait !== null;
  return result;
}

export interface ParticipantEligibilityMaterial {
  status: ParticipantMaterialStatus;
  rulesetId: string;
  rosterRevisionId: string;
  jerseyNo: string;
  termsVersion: string | null;
  hasIdentity: boolean;
  hasRealName: boolean;
  hasPortrait: boolean;
  hasInsurance: boolean;
  insuranceStartDate: string | null;
  insuranceEndDate: string | null;
  reviewedStartDate: string | null;
  reviewedEndDate: string | null;
  purged?: boolean;
}
export interface ParticipantEligibilityContext {
  required: boolean;
  requireInsurance: boolean;
  keyAvailable: boolean;
  bindingActive: boolean;
  rulesetId: string;
  rosterRevisionId: string;
  jerseyNo: string;
  eventStartDate: string;
  eventEndDate: string;
  requireApproval?: boolean;
  material: ParticipantEligibilityMaterial | null;
}
export interface ParticipantEligibilityBlocker {
  code: string;
  message: string;
}
export function participantEligibility(input: ParticipantEligibilityContext): {
  eligible: boolean;
  blockers: ParticipantEligibilityBlocker[];
} {
  if (!input.required) return { eligible: true, blockers: [] };
  const blockers: ParticipantEligibilityBlocker[] = [];
  const add = (code: string, message: string) => blockers.push({ code, message });
  if (!input.keyAvailable) add('PARTICIPANT_DATA_UNAVAILABLE', '本人资料服务未就绪');
  if (!input.bindingActive) add('BINDING_REQUIRED', '需由当前绑定球员本人确认');
  const m = input.material;
  if (!m) add('MATERIALS_REQUIRED', '请先填写本人报名资料');
  else {
    if (m.purged) add('MATERIALS_EXPIRED', '私有资料已按保留规则清除');
    if (
      m.rulesetId !== input.rulesetId ||
      m.rosterRevisionId !== input.rosterRevisionId ||
      m.jerseyNo !== input.jerseyNo
    )
      add('MATERIALS_OUTDATED', '报名规则或名单已更新，请本人重新确认');
    if (!m.hasRealName || !m.hasIdentity)
      add('IDENTITY_REQUIRED', '需填写本人姓名和有效身份证号码');
    if (!m.hasPortrait) add('PORTRAIT_REQUIRED', '需上传本人清晰正面照片');
    if (m.termsVersion !== PARTICIPANT_TERMS_VERSION)
      add('TERMS_REQUIRED', '需本人确认当前规程与资料用途');
    if (input.requireInsurance) {
      if (!m.hasInsurance || !m.insuranceStartDate || !m.insuranceEndDate)
        add('INSURANCE_REQUIRED', '需补齐外部保单资料');
      else if (
        m.insuranceStartDate > input.eventStartDate ||
        m.insuranceEndDate < input.eventEndDate
      )
        add('INSURANCE_PERIOD_INVALID', '保单期间须覆盖当前完整赛事日期');
    }
    if (input.requireApproval !== false) {
      if (m.status === 'CHANGES_REQUESTED')
        add('CHANGES_REQUESTED', '资料已退回，请按审核意见补充');
      else if (m.status !== 'APPROVED') add('APPROVAL_REQUIRED', '本人资料须经独立人工审核通过');
      if (
        m.status === 'APPROVED' &&
        (m.reviewedStartDate !== input.eventStartDate || m.reviewedEndDate !== input.eventEndDate)
      )
        add('REVIEW_OUTDATED', '赛事日期已改变，需重新核验资料');
    }
  }
  return { eligible: blockers.length === 0, blockers };
}

export function parseParticipantVersion(body: unknown): { expectedVersion: number } {
  const input = objectInput(body, ['expectedVersion']);
  if (
    !Number.isInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1 ||
    Number(input.expectedVersion) > 2147483647
  )
    invalid('请提供有效资料版本');
  return { expectedVersion: input.expectedVersion as number };
}
export function parseParticipantReview(body: unknown) {
  const input = objectInput(body, [
    'expectedVersion',
    'decision',
    'reason',
    'identityChecked',
    'portraitChecked',
    'insuranceChecked',
  ]);
  const version = parseParticipantVersion({ expectedVersion: input.expectedVersion });
  if (!['APPROVE', 'REQUEST_CHANGES'].includes(input.decision as string))
    invalid('请选择有效审核结果');
  for (const field of ['identityChecked', 'portraitChecked', 'insuranceChecked'])
    if (input[field] !== undefined && typeof input[field] !== 'boolean') invalid('请明确核对结果');
  return {
    ...version,
    decision: input.decision as 'APPROVE' | 'REQUEST_CHANGES',
    reason: text(input.reason, 'reason', 1, 500),
    identityChecked: input.identityChecked === true,
    portraitChecked: input.portraitChecked === true,
    insuranceChecked: input.insuranceChecked === true,
  };
}

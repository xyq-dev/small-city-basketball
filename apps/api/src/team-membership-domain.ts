import { randomBytes } from 'node:crypto';
import type {
  TeamJoinCodeStatus,
  TeamMemberClaimStatus,
  TeamRequestLinkStatus,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { invalid, objectInput, resourceId, text } from './validation.js';

// C19 team requests, join codes and claims: pure rules shared by the service and unit tests.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const JOIN_CODE_LENGTH = 26;
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** RFC 4648 Base32 without padding. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

/** 128-bit random join code: 26 Base32 characters. Only its SHA-256 is stored. */
export const newJoinCode = (random: (size: number) => Uint8Array = randomBytes) =>
  base32(random(16));
/** 128-bit random share-link token: 22 base64url characters. Only its SHA-256 is stored. */
export const newLinkToken = (random: (size: number) => Uint8Array = randomBytes) =>
  Buffer.from(random(16)).toString('base64url');

export const joinCodeInvalid = () =>
  new ApiError(422, 'JOIN_CODE_INVALID', '加入码无效、已过期、已撤销或次数已用完');
export const linkInvalid = () =>
  new ApiError(404, 'TEAM_REQUEST_LINK_INVALID', '申请入口无效、已过期、已撤销或名额已满');

/** Case, spaces and hyphens are ignored so a code read aloud or grouped still matches. */
export function normalizeJoinCode(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) throw joinCodeInvalid();
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== JOIN_CODE_LENGTH || !/^[A-Z2-7]+$/.test(code)) throw joinCodeInvalid();
  return code;
}
export function linkToken(value: unknown): string {
  if (typeof value !== 'string' || !LINK_TOKEN_PATTERN.test(value)) throw linkInvalid();
  return value;
}

export function reasonInput(value: unknown, field = 'reason'): string {
  return text(value, field, 4, 500);
}
function integerIn(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
    invalid('请检查填写的资料', { [field]: `请输入${min}–${max}的整数` });
  return value as number;
}
export function expectedVersionInput(value: unknown): number {
  return integerIn(value, 'expectedVersion', 1, 2147483647);
}
export function clientRequestIdInput(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value))
    invalid('请求编号无效', { clientRequestId: '需为小写 UUID v4' });
  return value;
}

export function linkInput(body: unknown) {
  const input = objectInput(body, ['expiresInHours', 'maxUses', 'reason']);
  return {
    expiresInHours: integerIn(input.expiresInHours, 'expiresInHours', 1, 168),
    maxUses: integerIn(input.maxUses, 'maxUses', 1, 200),
    reason: reasonInput(input.reason),
  };
}
export function revokeLinkInput(body: unknown) {
  return { reason: reasonInput(objectInput(body, ['reason']).reason) };
}
export function resolveInput(body: unknown) {
  return { token: linkToken(objectInput(body, ['token']).token) };
}
export function submitInput(body: unknown) {
  const input = objectInput(body, ['token', 'clientRequestId', 'teamName', 'note']);
  const note =
    input.note === undefined || input.note === null || input.note === ''
      ? null
      : text(input.note, 'note', 1, 500);
  return {
    token: linkToken(input.token),
    clientRequestId: clientRequestIdInput(input.clientRequestId),
    teamName: text(input.teamName, 'teamName', 1, 80),
    note,
  };
}
export function withdrawInput(body: unknown) {
  return {
    expectedVersion: expectedVersionInput(objectInput(body, ['expectedVersion']).expectedVersion),
  };
}
export function reviewInput(body: unknown) {
  const input = objectInput(body, ['decision', 'reason', 'expectedVersion']);
  if (input.decision !== 'APPROVE' && input.decision !== 'REJECT')
    invalid('请选择审核结果', { decision: '仅支持 APPROVE 或 REJECT' });
  return {
    decision: input.decision as 'APPROVE' | 'REJECT',
    reason: reasonInput(input.reason),
    expectedVersion: expectedVersionInput(input.expectedVersion),
  };
}
export const STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export function statusFilter(query: unknown): (typeof STATUS_FILTERS)[number] | null {
  const input = objectInput(query ?? {}, ['status']);
  if (input.status === undefined) return null;
  if (!STATUS_FILTERS.includes(input.status as (typeof STATUS_FILTERS)[number]))
    invalid('无效筛选', { status: '无效申请状态' });
  return input.status as (typeof STATUS_FILTERS)[number];
}
export function joinCodeInput(body: unknown) {
  const input = objectInput(body ?? {}, ['expiresInHours', 'maxUses']);
  return {
    expiresInHours: integerIn(input.expiresInHours, 'expiresInHours', 1, 168, 168),
    maxUses: integerIn(input.maxUses, 'maxUses', 1, 30, 30),
  };
}
export function joinInput(body: unknown) {
  const input = objectInput(body, ['code', 'displayName']);
  return {
    code: normalizeJoinCode(input.code),
    displayName: text(input.displayName, 'displayName', 1, 80),
  };
}
export function claimInput(body: unknown) {
  const input = objectInput(body, ['targetUserId']);
  if (typeof input.targetUserId !== 'string')
    invalid('请填写目标账号编号', { targetUserId: '需为账号编号' });
  return { targetUserId: resourceId(input.targetUserId) };
}
export function emptyInput(body: unknown) {
  objectInput(body ?? {}, []);
}

interface LimitedSecret {
  max_uses: number;
  use_count: number;
  expires_at: Date;
  revoked_at: Date | null;
}
export function linkStatus(row: LimitedSecret, now: Date): TeamRequestLinkStatus {
  if (row.revoked_at) return 'REVOKED';
  if (row.expires_at.getTime() <= now.getTime()) return 'EXPIRED';
  if (row.use_count >= row.max_uses) return 'EXHAUSTED';
  return 'ACTIVE';
}
export function joinCodeStatus(
  row: LimitedSecret,
  now: Date,
  issuerQualified: boolean,
): TeamJoinCodeStatus {
  const status = linkStatus(row, now);
  return status === 'ACTIVE' && !issuerQualified ? 'ISSUER_INVALID' : status;
}
export function claimStatus(
  row: { status: TeamMemberClaimStatus; expires_at: Date },
  now: Date,
): TeamMemberClaimStatus {
  return row.status === 'PENDING' && row.expires_at.getTime() <= now.getTime()
    ? 'EXPIRED'
    : row.status;
}

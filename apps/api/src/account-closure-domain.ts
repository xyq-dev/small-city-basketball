import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { objectInput, passwordInput, resourceId } from './validation.js';
import type { AccountClosureStatus } from '../../../packages/contracts/account-closure.js';

export const ACCOUNT_CLOSURE_DOMAINS = Object.freeze([
  'STREAMING',
  'INSURANCE',
  'TRADE',
  'NOTIFICATIONS',
  'GUARDIANS',
  'PARTICIPANT_PUBLICITY',
] as const);
export function closureFail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export function closureId(value: unknown): string {
  if (typeof value !== 'string') closureFail('INVALID_CLOSURE_INPUT', '请检查操作编号', 422);
  const result = resourceId(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result))
    closureFail('INVALID_CLOSURE_INPUT', '请检查操作编号', 422);
  return result;
}
export function closureRequestInput(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'password', 'coolingOffDays']);
  const days = b.coolingOffDays === undefined ? 0 : b.coolingOffDays;
  if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 0 || days > 7)
    closureFail('INVALID_CLOSURE_INPUT', '冷静期应为0至7天', 422);
  return {
    clientRequestId: closureId(b.clientRequestId),
    password: passwordInput(b.password),
    coolingOffDays: days as number,
  };
}
export function closureCancelInput(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'requestId', 'expectedVersion', 'password']);
  if (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 1)
    closureFail('INVALID_CLOSURE_INPUT', '请重新读取注销申请', 422);
  return {
    clientRequestId: closureId(b.clientRequestId),
    requestId: closureId(b.requestId),
    expectedVersion: Number(b.expectedVersion),
    password: passwordInput(b.password),
  };
}
export const closureHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function closureSecurityFingerprint(
  user: { password_hash: string; credential_reset_at: string | null },
  identities: { id: string; app_id: string; status: string; version: number }[],
): string {
  return closureHash({
    version: 1,
    credential: user.password_hash,
    reset: user.credential_reset_at,
    identities: identities
      .map(({ id, app_id, status, version }) => ({ id, appId: app_id, status, version }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function closureBlockers(raw: unknown): string[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 32 ||
    raw.some((x) => typeof x !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(x))
  )
    closureFail('CLOSURE_INSPECTION_UNAVAILABLE', '注销检查暂不可用', 503);
  return [...new Set(raw as string[])].sort();
}
export function closureDecision(input: {
  status: AccountClosureStatus;
  executeAfter: string;
  now: string;
  storedFingerprint: string;
  currentFingerprint: string;
  blockers: string[];
}): AccountClosureStatus {
  if (['CANCELLED', 'EXPIRED_AUTH', 'CLOSED'].includes(input.status)) return input.status;
  if (input.storedFingerprint !== input.currentFingerprint) return 'EXPIRED_AUTH';
  const due = Date.parse(input.executeAfter),
    now = Date.parse(input.now);
  if (!Number.isFinite(due) || !Number.isFinite(now))
    closureFail('CLOSURE_INSPECTION_UNAVAILABLE', '注销检查暂不可用', 503);
  if (now < due) return 'PENDING';
  return closureBlockers(input.blockers).length ? 'BLOCKED' : 'CLOSED';
}

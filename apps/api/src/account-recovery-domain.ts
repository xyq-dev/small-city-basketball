import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';
import { emailInput, objectInput, passwordInput } from './validation.js';

export type AccountAction = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
export function recoveryId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    throw new ApiError(422, 'INVALID_ACCOUNT_ACTION', '请检查操作编号');
  return value;
}
export function recoveryToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  )
    throw new ApiError(422, 'INVALID_ACCOUNT_ACTION', '操作码无效或已失效');
  return value;
}
export function parseRecoveryRequest(raw: unknown) {
  const r = objectInput(raw, ['clientRequestId', 'email']);
  return { clientRequestId: recoveryId(r.clientRequestId), email: emailInput(r.email) };
}
export function parseRecoveryConsume(raw: unknown) {
  const r = objectInput(raw, ['clientRequestId', 'token', 'newPassword']);
  return {
    clientRequestId: recoveryId(r.clientRequestId),
    token: recoveryToken(r.token),
    newPassword: r.newPassword === undefined ? undefined : passwordInput(r.newPassword),
  };
}
export const accountTokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function deliveryKey(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
    Buffer.from(value, 'base64').toString('base64') !== value
  )
    throw new Error('Account mail encryption configuration is invalid');
  return Buffer.from(value, 'base64');
}
export function recoveryFingerprint(key: Buffer, value: unknown): string {
  return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
}
export function sealMail(key: Buffer, id: string, payload: unknown): Buffer {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`scb-account-mail:v1:${id}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
}
export function openMail(key: Buffer, id: string, value: Buffer): unknown {
  if (!Buffer.isBuffer(value) || value.length < 30 || value[0] !== 1)
    throw new Error('Invalid mail envelope');
  const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(1, 13));
  cipher.setAAD(Buffer.from(`scb-account-mail:v1:${id}`));
  cipher.setAuthTag(value.subarray(13, 29));
  return JSON.parse(
    Buffer.concat([cipher.update(value.subarray(29)), cipher.final()]).toString('utf8'),
  );
}

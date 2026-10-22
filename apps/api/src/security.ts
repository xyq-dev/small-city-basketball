import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const COST = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LENGTH = 64;
// One derivation uses roughly 128 MiB. All login, signup and owner-bootstrap
// paths share this process-wide slot; the queue also has a fixed memory bound.
const MAX_WAITING_DERIVATIONS = 16;
let derivationActive = false;
const waitingDerivations: (() => void)[] = [];
const passwordUnavailable = () => new ApiError(503, 'AUTH_UNAVAILABLE', '认证服务繁忙，请稍后重试');

async function passwordSlot(): Promise<() => void> {
  if (derivationActive) {
    if (waitingDerivations.length >= MAX_WAITING_DERIVATIONS) throw passwordUnavailable();
    await new Promise<void>((resolve) => waitingDerivations.push(resolve));
  } else derivationActive = true;
  return () => {
    const next = waitingDerivations.shift();
    if (next) next();
    else derivationActive = false;
  };
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  const release = await passwordSlot();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, KEY_LENGTH, COST, (error, key) =>
        error ? reject(error) : resolve(key),
      );
    });
  } catch {
    throw passwordUnavailable();
  } finally {
    release();
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const match =
    encoded && /^scrypt\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(encoded);
  const salt = match ? Buffer.from(match[1]!, 'base64url') : Buffer.alloc(16);
  const expected = match ? Buffer.from(match[2]!, 'base64url') : Buffer.alloc(KEY_LENGTH);
  const actual = await derive(password, salt);
  return Boolean(match) && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');

export function readSessionToken(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const values = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('scb.sid='));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice('scb.sid='.length);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export function sessionCookie(token: string, ttlSeconds: number, secure: boolean): string {
  return `scb.sid=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `scb.sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

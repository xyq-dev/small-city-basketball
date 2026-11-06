import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readRequiredSecret } from '../env.js';
import { ApiError } from '../errors.js';

export interface StoredCredentials {
  secretId: string;
  secretKey: string;
}
export interface EncryptedCredentials {
  credentials_ciphertext: Buffer;
  credentials_nonce: Buffer;
  credentials_tag: Buffer;
}
export interface RevisionIdentity {
  id: string;
  version: number;
  mode: string;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
}
const unavailable = () =>
  new ApiError(503, 'STORAGE_CONFIG_KEY_UNAVAILABLE', '对象存储配置密钥不可用，请联系部署维护人员');
export function readStorageConfigKey(): Buffer {
  try {
    const value = readRequiredSecret('SCB_STORAGE_CONFIG_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error();
    return Buffer.from(value, 'hex');
  } catch {
    throw unavailable();
  }
}
export function storageConfigKeyAvailable(): boolean {
  try {
    readStorageConfigKey();
    return true;
  } catch {
    return false;
  }
}
function aad(revision: RevisionIdentity): Buffer {
  return Buffer.from(
    JSON.stringify([
      'scb-storage-config-v1',
      revision.id,
      revision.version,
      revision.mode,
      revision.bucket,
      revision.region,
      revision.prefix,
    ]),
  );
}
function validCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as StoredCredentials;
  return [v.secretId, v.secretKey].every(
    (secret) =>
      typeof secret === 'string' &&
      secret.length > 0 &&
      secret.length <= 16384 &&
      !/\s/.test(secret),
  );
}
export function encryptStorageCredentials(
  identity: RevisionIdentity,
  credentials: StoredCredentials,
): EncryptedCredentials {
  if (!validCredentials(credentials)) throw unavailable();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readStorageConfigKey(), nonce);
  cipher.setAAD(aad(identity));
  return {
    credentials_ciphertext: Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]),
    credentials_nonce: nonce,
    credentials_tag: cipher.getAuthTag(),
  };
}
export function decryptStorageCredentials(
  revision: RevisionIdentity & EncryptedCredentials,
): StoredCredentials {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      readStorageConfigKey(),
      revision.credentials_nonce,
    );
    decipher.setAAD(aad(revision));
    decipher.setAuthTag(revision.credentials_tag);
    const decoded: unknown = JSON.parse(
      Buffer.concat([decipher.update(revision.credentials_ciphertext), decipher.final()]).toString(
        'utf8',
      ),
    );
    if (!validCredentials(decoded)) throw new Error();
    return decoded;
  } catch {
    throw unavailable();
  }
}
/** A keyed digest permits idempotency comparison without storing credentials or an offline verifier. */
export function storageCommandDigest(value: unknown): string {
  return createHmac('sha256', readStorageConfigKey()).update(JSON.stringify(value)).digest('hex');
}

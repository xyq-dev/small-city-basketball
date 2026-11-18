import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readRequiredSecret } from '../env.js';
import { ApiError } from '../errors.js';

export interface LocationSecrets {
  webKey: string;
  privateKey: string | null;
}
export interface EncryptedLocationSecrets {
  credentials_ciphertext: Buffer;
  credentials_nonce: Buffer;
  credentials_tag: Buffer;
}
export interface LocationRevisionIdentity {
  id: string;
  version: number;
  provider: string;
  signatureEnabled: boolean;
}
const unavailable = () =>
  new ApiError(503, 'LOCATION_CONFIG_KEY_UNAVAILABLE', '地图配置密钥不可用，请联系部署维护人员');
export function readLocationConfigKey(): Buffer {
  try {
    const value = readRequiredSecret('SCB_LOCATION_CONFIG_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error();
    return Buffer.from(value, 'hex');
  } catch {
    throw unavailable();
  }
}
export function locationConfigKeyAvailable(): boolean {
  try {
    readLocationConfigKey();
    return true;
  } catch {
    return false;
  }
}
function aad(revision: LocationRevisionIdentity): Buffer {
  return Buffer.from(
    JSON.stringify([
      'scb-location-config-v1',
      revision.id,
      revision.version,
      revision.provider,
      revision.signatureEnabled,
    ]),
  );
}
function validSecret(value: string | null): boolean {
  return (
    value === null || (value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f]/.test(value))
  );
}
function validSecrets(value: unknown): value is LocationSecrets {
  if (!value || typeof value !== 'object') return false;
  const secrets = value as LocationSecrets;
  return (
    validSecret(secrets.webKey) && secrets.webKey.length > 0 && validSecret(secrets.privateKey)
  );
}
export function encryptLocationSecrets(
  identity: LocationRevisionIdentity,
  secrets: LocationSecrets,
): EncryptedLocationSecrets {
  if (!validSecrets(secrets)) throw unavailable();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readLocationConfigKey(), nonce);
  cipher.setAAD(aad(identity));
  return {
    credentials_ciphertext: Buffer.concat([
      cipher.update(JSON.stringify(secrets), 'utf8'),
      cipher.final(),
    ]),
    credentials_nonce: nonce,
    credentials_tag: cipher.getAuthTag(),
  };
}
export function decryptLocationSecrets(
  revision: LocationRevisionIdentity & EncryptedLocationSecrets,
): LocationSecrets {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      readLocationConfigKey(),
      revision.credentials_nonce,
    );
    decipher.setAAD(aad(revision));
    decipher.setAuthTag(revision.credentials_tag);
    const decoded: unknown = JSON.parse(
      Buffer.concat([decipher.update(revision.credentials_ciphertext), decipher.final()]).toString(
        'utf8',
      ),
    );
    if (!validSecrets(decoded)) throw new Error();
    return decoded;
  } catch {
    throw unavailable();
  }
}
export function locationCommandDigest(value: unknown): string {
  return createHmac('sha256', readLocationConfigKey()).update(JSON.stringify(value)).digest('hex');
}

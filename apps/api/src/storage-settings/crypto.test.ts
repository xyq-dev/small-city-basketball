import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  decryptStorageCredentials,
  encryptStorageCredentials,
  readStorageConfigKey,
  storageCommandDigest,
  storageConfigKeyAvailable,
} from './crypto.js';
const identity = {
  id: '1a28c450-eac5-471f-b920-5b83ec4384fb',
  version: 1,
  mode: 'COS',
  bucket: 'synthetic-12345',
  region: 'ap-guangzhou',
  prefix: 'scb-media/v1',
};
afterEach(() => vi.unstubAllEnvs());
describe('storage configuration envelope encryption', () => {
  test('randomized AES-GCM round trip binds revision, version and destination', () => {
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', '22'.repeat(32));
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY_FILE', undefined);
    const credentials = { secretId: 'synthetic-id', secretKey: 'synthetic-secret' };
    const encrypted = encryptStorageCredentials(identity, credentials);
    const second = encryptStorageCredentials(identity, credentials);
    expect(encrypted.credentials_ciphertext.equals(second.credentials_ciphertext)).toBe(false);
    expect(encrypted.credentials_ciphertext.includes(Buffer.from(credentials.secretKey))).toBe(
      false,
    );
    expect(decryptStorageCredentials({ ...identity, ...encrypted })).toEqual(credentials);
    for (const changed of [
      { version: 2 },
      { bucket: 'other-12345' },
      { id: '8a1cb59e-2b72-454d-a3ee-13ecce96fe03' },
    ]) {
      expect(() => decryptStorageCredentials({ ...identity, ...encrypted, ...changed })).toThrow(
        '对象存储配置密钥不可用',
      );
    }
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', '33'.repeat(32));
    expect(() => decryptStorageCredentials({ ...identity, ...encrypted })).toThrow(
      '对象存储配置密钥不可用',
    );
  });
  test('strict independent key and keyed request digest', () => {
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY_FILE', undefined);
    for (const invalid of ['', 'x'.repeat(64), '11'.repeat(31)]) {
      vi.stubEnv('SCB_STORAGE_CONFIG_KEY', invalid);
      expect(storageConfigKeyAvailable()).toBe(false);
      expect(() => readStorageConfigKey()).toThrow();
    }
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', '11'.repeat(32));
    expect(readStorageConfigKey()).toHaveLength(32);
    const digest = storageCommandDigest({ secretKey: 'synthetic' });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(storageCommandDigest({ secretKey: 'synthetic' })).toBe(digest);
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', '22'.repeat(32));
    expect(storageCommandDigest({ secretKey: 'synthetic' })).not.toBe(digest);
  });
});

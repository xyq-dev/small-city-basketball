import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCosObjectStore } from './cos-runtime.js';

const names = [
  'SCB_MEDIA_STORAGE',
  'SCB_COS_BUCKET',
  'SCB_COS_REGION',
  'SCB_COS_PREFIX',
  'SCB_COS_SECRET_ID',
  'SCB_COS_SECRET_ID_FILE',
  'SCB_COS_SECRET_KEY',
  'SCB_COS_SECRET_KEY_FILE',
  'SCB_COS_SESSION_TOKEN',
  'SCB_COS_SESSION_TOKEN_FILE',
];
const directories: string[] = [];
const enable = () => {
  vi.stubEnv('SCB_MEDIA_STORAGE', 'COS');
  vi.stubEnv('SCB_COS_BUCKET', 'synthetic-media-1250000000');
  vi.stubEnv('SCB_COS_REGION', 'ap-guangzhou');
  vi.stubEnv('SCB_COS_SECRET_ID', 'synthetic-id');
  vi.stubEnv('SCB_COS_SECRET_KEY', 'synthetic-key');
};
describe('COS runtime configuration', () => {
  beforeEach(() => names.forEach((name) => vi.stubEnv(name, undefined)));
  afterEach(() => {
    vi.unstubAllEnvs();
    directories.splice(0).forEach((path) => rmSync(path, { force: true, recursive: true }));
  });
  it('defaults to database storage and does not read secrets when disabled', () => {
    vi.stubEnv('SCB_COS_SECRET_KEY_FILE', '/missing/private-file');
    expect(readCosObjectStore()).toBeUndefined();
    vi.stubEnv('SCB_MEDIA_STORAGE', 'DATABASE');
    expect(readCosObjectStore()).toBeUndefined();
  });
  it('constructs COS only with complete, valid explicit configuration', () => {
    enable();
    expect(readCosObjectStore()).toMatchObject({
      bucket: 'synthetic-media-1250000000',
      region: 'ap-guangzhou',
      prefix: 'scb-media/v1',
    });
    vi.stubEnv('SCB_COS_PREFIX', 'production/scb-media');
    vi.stubEnv('SCB_COS_SESSION_TOKEN', 'synthetic-temporary-session');
    expect(readCosObjectStore()?.prefix).toBe('production/scb-media');
  });
  it('loads file-backed credentials and rejects ambiguous or unavailable credentials', () => {
    enable();
    const directory = mkdtempSync(join(tmpdir(), 'scb-cos-runtime-'));
    directories.push(directory);
    const idFile = join(directory, 'id');
    const keyFile = join(directory, 'key');
    const tokenFile = join(directory, 'token');
    writeFileSync(idFile, 'synthetic-id\n');
    writeFileSync(keyFile, 'synthetic-key\n');
    writeFileSync(tokenFile, 'synthetic-token\n');
    vi.stubEnv('SCB_COS_SECRET_ID', undefined);
    vi.stubEnv('SCB_COS_SECRET_KEY', undefined);
    vi.stubEnv('SCB_COS_SECRET_ID_FILE', idFile);
    vi.stubEnv('SCB_COS_SECRET_KEY_FILE', keyFile);
    vi.stubEnv('SCB_COS_SESSION_TOKEN_FILE', tokenFile);
    expect(readCosObjectStore()).toBeDefined();
    vi.stubEnv('SCB_COS_SECRET_KEY', 'synthetic-sensitive-marker');
    expect(() => readCosObjectStore()).toThrow('COS configuration is unavailable or invalid');
    vi.stubEnv('SCB_COS_SECRET_KEY', undefined);
    vi.stubEnv('SCB_COS_SECRET_KEY_FILE', '/missing/synthetic-sensitive-marker');
    expect(() => readCosObjectStore()).toThrow('COS configuration is unavailable or invalid');
  });
  it('fails closed for wrong modes, missing credentials, and invalid bucket/region/prefix', () => {
    for (const mode of ['', 'cos', ' COS', 'LOCAL']) {
      vi.stubEnv('SCB_MEDIA_STORAGE', mode);
      expect(() => readCosObjectStore()).toThrow('Invalid media storage configuration');
    }
    for (const [name, value] of [
      ['SCB_COS_BUCKET', 'invalid.bucket-1250000000'],
      ['SCB_COS_REGION', 'ap-guangzhou.evil.test'],
      ['SCB_COS_PREFIX', '../private'],
      ['SCB_COS_SECRET_ID', ''],
      ['SCB_COS_SECRET_KEY', ''],
      ['SCB_COS_SESSION_TOKEN', ''],
    ]) {
      enable();
      vi.stubEnv('SCB_COS_SESSION_TOKEN', undefined);
      vi.stubEnv(name!, value!);
      expect(() => readCosObjectStore()).toThrow('COS configuration is unavailable or invalid');
    }
  });
});

import { createHash } from 'node:crypto';
import type { Writable } from 'node:stream';
import type COS from 'cos-nodejs-sdk-v5';
import { describe, expect, it, vi } from 'vitest';
import { TencentCosObjectStore, validCosDestination } from './cos-storage.js';
import { MAX_MEDIA_FILE_BYTES } from './media-domain.js';

const { sdkOptions } = vi.hoisted(() => ({ sdkOptions: vi.fn() }));
vi.mock('cos-nodejs-sdk-v5', () => ({
  default: class {
    constructor(options: unknown) {
      sdkOptions(options);
    }
  },
}));
const options = {
  bucket: 'synthetic-media-1250000000',
  region: 'ap-guangzhou',
  prefix: 'scb-media/v1',
  secretId: 'synthetic-secret-id',
  secretKey: 'synthetic-private-key',
};
const key = `${options.prefix}/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333`;
const location = { bucket: options.bucket, region: options.region, key };
function fixture() {
  const client = {
    putObject: vi.fn().mockResolvedValue({ Location: 'must-never-return-this' }),
    getObject: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue({}),
    getBucketVersioning: vi.fn().mockResolvedValue({ VersioningConfiguration: {} }),
  };
  const store = new TencentCosObjectStore(options, client as unknown as COS);
  return { client, store };
}
function stream(chunks: Buffer[]) {
  return (params: COS.GetObjectParams, callback: (error: unknown) => void) => {
    const output = params.Output as Writable;
    output.once('finish', () => callback(null));
    for (const chunk of chunks) output.write(chunk);
    output.end();
  };
}
describe('private Tencent COS object adapter', () => {
  it('uses the official HTTPS endpoint, verifies TLS/host and disables redirects/host switching', () => {
    new TencentCosObjectStore({ ...options, sessionToken: 'synthetic-session-token' });
    expect(sdkOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        Domain: '{Bucket}.cos.{Region}.myqcloud.com',
        Protocol: 'https:',
        StrictSsl: true,
        ForceSignHost: true,
        FollowRedirect: false,
        AutoSwitchHost: false,
        Timeout: 30000,
        ChunkRetryTimes: 0,
        UploadCheckContentMd5: true,
        SecurityToken: 'synthetic-session-token',
      }),
    );
  });
  it('uploads private bytes with integrity and overwrite protections without returning COS data', async () => {
    const { store, client } = fixture();
    const body = Buffer.from('synthetic file');
    await expect(store.put(key, body, 'image/png')).resolves.toBeUndefined();
    expect(client.putObject).toHaveBeenCalledExactlyOnceWith({
      Bucket: options.bucket,
      Region: options.region,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: 'image/png',
      ACL: 'private',
      CacheControl: 'private, no-store',
      ServerSideEncryption: 'AES256',
      Headers: {
        'Content-MD5': createHash('md5').update(body).digest('base64'),
        'x-cos-forbid-overwrite': 'true',
      },
    });
  });
  it('checks versioning without creating objects and redacts SDK verification errors', async () => {
    const { store, client } = fixture();
    await expect(store.verifyConfiguration()).resolves.toBeUndefined();
    expect(client.getBucketVersioning).toHaveBeenCalledExactlyOnceWith({
      Bucket: options.bucket,
      Region: options.region,
    });
    expect(client.putObject).not.toHaveBeenCalled();
    expect(client.getObject).not.toHaveBeenCalled();
    expect(client.deleteObject).not.toHaveBeenCalled();
    for (const status of ['Enabled', 'Suspended', null, '']) {
      client.getBucketVersioning.mockResolvedValue({ VersioningConfiguration: { Status: status } });
      await expect(store.verifyConfiguration()).rejects.toMatchObject({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
      });
    }
    client.getBucketVersioning.mockRejectedValue(new Error('synthetic-signed-secret-header'));
    const error: unknown = await store.verifyConfiguration().catch((value: unknown) => value);
    expect(String(error)).not.toContain('synthetic-signed-secret-header');
    expect(error).not.toHaveProperty('cause');
  });
  it('uses a bounded server-selected probe timeout without weakening endpoint protections', () => {
    new TencentCosObjectStore({ ...options, timeoutMs: 5000 });
    expect(sdkOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ Timeout: 5000, StrictSsl: true, FollowRedirect: false }),
    );
    for (const timeoutMs of [0, 999, 30001, 1.5, NaN, Infinity])
      expect(() => new TencentCosObjectStore({ ...options, timeoutMs })).toThrow(
        'Invalid COS configuration',
      );
  });
  it('applies the same probe timeout to the overall download stream deadline', async () => {
    vi.useFakeTimers();
    try {
      const { client } = fixture();
      const store = new TencentCosObjectStore(
        { ...options, timeoutMs: 5000 },
        client as unknown as COS,
      );
      let settled = false;
      const pending = expect(store.get(location)).rejects.toMatchObject({ status: 503 });
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects invalid destinations and credentials before constructing the SDK', () => {
    for (const patch of [
      { bucket: 'x.evil.test-1250000000' },
      { bucket: 'https://evil.test' },
      { bucket: 'a'.repeat(64) },
      { region: 'ap-guangzhou.evil.test' },
      { prefix: '' },
      { prefix: '/scb-media/v1' },
      { prefix: 'scb-media/../v1' },
      { prefix: 'scb-media//v1' },
      { prefix: 'a'.repeat(129) },
      { secretId: '' },
      { secretKey: 'newline\nkey' },
      { sessionToken: '' },
    ])
      expect(() => new TencentCosObjectStore({ ...options, ...patch })).toThrow(
        'Invalid COS configuration',
      );
    expect(validCosDestination(options.bucket, options.region, options.prefix)).toBe(true);
  });
  it('blocks paths, other prefixes, buckets, and regions without contacting COS', async () => {
    const { client, store } = fixture();
    for (const bad of [
      { ...location, bucket: 'other-media-1250000000' },
      { ...location, region: 'ap-shanghai' },
      { ...location, key: key.replace('scb-media/v1', 'scb-media/v10') },
      { ...location, key: `${options.prefix}/../file` },
      { ...location, key: `${key}?versionId=old` },
      { ...location, key: `${key}/child` },
      { ...location, key: key.toUpperCase() },
    ]) {
      await expect(store.get(bad)).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' });
      await expect(store.delete(bad)).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' });
    }
    for (const bad of [Buffer.alloc(0), Buffer.alloc(MAX_MEDIA_FILE_BYTES + 1)])
      await expect(store.put(key, bad, 'image/png')).rejects.toMatchObject({ status: 503 });
    await expect(store.put(key, Buffer.from('x'), 'text/html')).rejects.toMatchObject({
      status: 503,
    });
    await expect(store.put('arbitrary-key', Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      status: 503,
    });
    expect(client.getObject).not.toHaveBeenCalled();
    expect(client.deleteObject).not.toHaveBeenCalled();
    expect(client.putObject).not.toHaveBeenCalled();
  });
  it('collects actual streamed bytes without relying on content length', async () => {
    const { store, client } = fixture();
    client.getObject.mockImplementation(stream([Buffer.from('first'), Buffer.from('second')]));
    await expect(store.get(location)).resolves.toEqual(Buffer.from('firstsecond'));
    expect(client.getObject).toHaveBeenCalledWith(
      { Bucket: options.bucket, Region: options.region, Key: key, Output: expect.anything() },
      expect.any(Function),
    );
  });
  it('destroys an oversized download using actual received bytes and rejects an empty object', async () => {
    const { store, client } = fixture();
    let output: Writable | undefined;
    client.getObject.mockImplementation((params: COS.GetObjectParams) => {
      output = params.Output as Writable;
      output.write(Buffer.alloc(MAX_MEDIA_FILE_BYTES));
      output.write(Buffer.alloc(1));
    });
    await expect(store.get(location)).rejects.toMatchObject({
      status: 503,
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(output?.destroyed).toBe(true);
    client.getObject.mockImplementation(stream([]));
    await expect(store.get(location)).rejects.toMatchObject({ status: 503 });
  });
  it('deletes only its own object and treats NoSuchKey as already deleted', async () => {
    const { store, client } = fixture();
    await store.delete(location);
    expect(client.deleteObject).toHaveBeenCalledExactlyOnceWith({
      Bucket: options.bucket,
      Region: options.region,
      Key: key,
    });
    client.deleteObject.mockRejectedValue({ statusCode: 404, code: 'NoSuchKey' });
    await expect(store.delete(location)).resolves.toBeUndefined();
    client.deleteObject.mockRejectedValue({ statusCode: 404, code: 'NoSuchBucket' });
    await expect(store.delete(location)).rejects.toMatchObject({ status: 503 });
    client.deleteObject.mockResolvedValue({ BucketNotFound: true, statusCode: 404 });
    await expect(store.delete(location)).rejects.toMatchObject({ status: 503 });
  });
  it('refuses mutation when versioning is enabled, suspended, malformed, or unavailable', async () => {
    const { store, client } = fixture();
    for (const status of ['Enabled', 'Suspended', '', null, 'unknown']) {
      client.getBucketVersioning.mockResolvedValue({ VersioningConfiguration: { Status: status } });
      await expect(store.put(key, Buffer.from('x'), 'image/png')).rejects.toMatchObject({
        status: 503,
      });
      await expect(store.delete(location)).rejects.toMatchObject({ status: 503 });
    }
    client.getBucketVersioning.mockResolvedValue({});
    await expect(store.delete(location)).rejects.toMatchObject({ status: 503 });
    client.getBucketVersioning.mockRejectedValue(new Error('synthetic-sensitive-marker'));
    await expect(store.put(key, Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      status: 503,
    });
    expect(client.putObject).not.toHaveBeenCalled();
    expect(client.deleteObject).not.toHaveBeenCalled();
  });
  it('bounds a stalled streamed download with an overall deadline', async () => {
    vi.useFakeTimers();
    try {
      const { store } = fixture();
      const pending = expect(store.get(location)).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
  it('removes sensitive SDK error contents and causes from all operations', async () => {
    const { store, client } = fixture();
    const cloudError = Object.assign(new Error('signed-url&secret=synthetic-sensitive-marker'), {
      headers: { Authorization: 'synthetic-sensitive-marker' },
      statusCode: 403,
    });
    client.putObject.mockRejectedValue(cloudError);
    client.deleteObject.mockRejectedValue(cloudError);
    client.getObject.mockImplementation((_params, callback) => callback(cloudError));
    for (const pending of [
      store.put(key, Buffer.from('x'), 'image/png'),
      store.get(location),
      store.delete(location),
    ]) {
      const error: unknown = await pending.catch((value: unknown) => value);
      expect(error).toMatchObject({ status: 503, code: 'MEDIA_STORAGE_UNAVAILABLE' });
      expect(error).not.toHaveProperty('cause');
      expect(error).not.toHaveProperty('headers');
      expect(String(error)).not.toContain('synthetic-sensitive-marker');
    }
  });
});

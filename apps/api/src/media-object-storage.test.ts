import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { CosObjectStore } from './cos-storage.js';
const registration = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({
  Pool: class {
    query = registration.query;
    end = registration.end;
    on() {}
  },
}));
import { MediaObjectStorage } from './media-object-storage.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const location = {
  bucket: 'scb-test-12345',
  region: 'ap-guangzhou',
  key: `scb-media/v1/${orgId}/${fileId}/33333333-3333-4333-8333-333333333333`,
};
const object = {
  id: fileId,
  org_id: orgId,
  bucket: location.bucket,
  region: location.region,
  object_key: location.key,
};
const body = Buffer.from('synthetic media bytes');
const file = {
  org_id: orgId,
  cos_object_id: fileId,
  payload: null,
  byte_length: body.length,
  sha256: createHash('sha256').update(body).digest('hex'),
};
const query = vi.fn();
const release = vi.fn();
const client = { query, release } as unknown as PoolClient;
const connect = vi.fn(async () => client);
const pool = { connect } as unknown as Pool;
const put = vi.fn(),
  get = vi.fn(),
  remove = vi.fn();
const store = { ...location, prefix: 'scb-media/v1', put, get, delete: remove } as CosObjectStore;
let storage: MediaObjectStorage;

beforeEach(() => {
  vi.clearAllMocks();
  registration.query.mockResolvedValue({ rowCount: 1 });
  registration.end.mockResolvedValue(undefined);
  query.mockImplementation(async (sql: string) => ({
    rowCount: 1,
    rows: sql.includes('count(*)') ? [{ total: 0, pending: 0 }] : [object],
  }));
  put.mockResolvedValue(undefined);
  get.mockResolvedValue(body);
  remove.mockResolvedValue(undefined);
  storage = new MediaObjectStorage(pool, 'postgresql://synthetic/scb_test_cos', store);
});
afterEach(async () => {
  await storage.onModuleDestroy();
});

describe('private COS persistence boundary', () => {
  it('does not resolve credentials or an injected provider for a restored runtime', async () => {
    const resolveStore = vi.fn(() => store);
    const restored = MediaObjectStorage.forRuntime(
      pool,
      'postgresql://synthetic/scb_test_cos',
      true,
      resolveStore,
    );
    expect(resolveStore).not.toHaveBeenCalled();
    expect(restored.store).toBeUndefined();
    await expect(restored.cleanup()).resolves.toEqual({ deleted: 0, failed: 0 });
    await expect(restored.read(client, file)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(get).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await restored.onModuleDestroy();
  });
  it('registers durable cleanup identity before uploading and stores no database payload', async () => {
    const result = await storage.save(client, orgId, fileId, body, 'image/png');
    expect(result).toEqual({ payload: null, cosObjectId: fileId });
    expect(registration.query).toHaveBeenCalledOnce();
    const values = registration.query.mock.calls[0]![1];
    expect(values.slice(0, 4)).toEqual([fileId, orgId, store.bucket, store.region]);
    expect(values[4]).toMatch(new RegExp(`^scb-media/v1/${orgId}/${fileId}/[0-9a-f-]{36}$`));
    expect(registration.query.mock.invocationCallOrder[0]).toBeLessThan(
      put.mock.invocationCallOrder[0]!,
    );
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]!);
    expect(put).toHaveBeenCalledWith(values[4], body, 'image/png');
  });

  it('does not write COS if cleanup identity cannot be committed or locked', async () => {
    registration.query.mockRejectedValueOnce(new Error('synthetic secret details'));
    await expect(storage.save(client, orgId, fileId, body, 'image/png')).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
      status: 503,
    });
    expect(put).not.toHaveBeenCalled();
    query.mockResolvedValueOnce({ rows: [{ total: 0, pending: 0 }] });
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(storage.save(client, orgId, fileId, body, 'image/png')).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps cleanup identity after an ambiguous PUT failure and returns no cloud error details', async () => {
    put.mockRejectedValueOnce(new Error('synthetic private endpoint or credential'));
    await expect(storage.save(client, orgId, fileId, body, 'image/png')).rejects.toMatchObject({
      message: '媒体存储暂不可用，请稍后重试',
    });
    expect(registration.query).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it('bounds failed registrations before another durable INSERT or cloud write', async () => {
    for (const counts of [
      { total: 32, pending: 32 },
      { total: 8192, pending: 0 },
    ]) {
      query.mockResolvedValueOnce({ rows: [counts] });
      await expect(storage.save(client, orgId, fileId, body, 'image/png')).rejects.toMatchObject({
        status: 409,
        code: 'MEDIA_STORAGE_LIMIT',
      });
    }
    expect(registration.query).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('retains old database files and makes no cloud request for them', async () => {
    await expect(
      storage.read(client, { ...file, cos_object_id: null, payload: body }),
    ).resolves.toEqual(body);
    expect(get).not.toHaveBeenCalled();
    const disabled = new MediaObjectStorage(pool, 'postgresql://synthetic/scb_test_cos');
    await expect(disabled.save(client, orgId, fileId, body, 'image/png')).resolves.toEqual({
      payload: body,
      cosObjectId: null,
    });
    await expect(disabled.read(client, file)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    await expect(disabled.cleanup()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(put).not.toHaveBeenCalled();
  });

  it('checks the complete cloud bytes against committed file length and SHA256', async () => {
    await expect(storage.read(client, file)).resolves.toEqual(body);
    expect(get).toHaveBeenCalledWith(location);
    get.mockResolvedValueOnce(Buffer.alloc(body.length));
    await expect(storage.read(client, file)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    get.mockResolvedValueOnce(Buffer.concat([body, Buffer.from('extra')]));
    await expect(storage.read(client, file)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(storage.read(client, file)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
  });
});

describe('retryable COS cleanup', () => {
  function cleanupQueries(retained = false) {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.id')) return { rows: [object] };
      if (sql.startsWith('SELECT 1 FROM media_files'))
        return { rowCount: retained ? 1 : 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
  }

  it('does not delete a file that was linked while waiting for its cleanup lock', async () => {
    cleanupQueries(true);
    await expect(storage.cleanup()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('marks deletion only after COS success and retries a failed delete on the next drain', async () => {
    cleanupQueries();
    remove.mockRejectedValueOnce(new Error('temporary failure'));
    await expect(storage.cleanup()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(query.mock.calls.some(([sql]) => sql.includes('SET deleted_at='))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('SET cleanup_attempted_at='))).toBe(true);
    await expect(storage.cleanup()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => sql.includes('SET deleted_at='))).toBe(true);
  });

  it('does not acknowledge a failed batch when persisting retry rotation fails', async () => {
    cleanupQueries();
    remove.mockRejectedValueOnce(new Error('synthetic cloud denial'));
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.id')) return { rows: [object] };
      if (sql.startsWith('SELECT 1 FROM media_files')) return { rowCount: 0, rows: [] };
      if (sql.includes('SET cleanup_attempted_at='))
        throw new Error('synthetic retry metadata error');
      return { rowCount: 1, rows: [] };
    });
    await expect(storage.cleanup()).rejects.toThrow('synthetic retry metadata error');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      query.mock.calls.some(([sql]) => sql === 'COMMIT' || sql.includes('SET deleted_at=')),
    ).toBe(false);
  });

  it('rejects unbounded cleanup batches before opening a connection', async () => {
    for (const limit of [0, 101, 1.5, NaN])
      await expect(storage.cleanup(limit)).rejects.toThrow('Invalid cleanup limit');
    expect(connect).not.toHaveBeenCalled();
  });

  it('rolls back and reports no successful batch if a database check fails', async () => {
    cleanupQueries();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.id')) return { rows: [object] };
      if (sql.startsWith('SELECT 1 FROM media_files'))
        throw new Error('synthetic database timeout');
      return { rows: [], rowCount: 1 };
    });
    await expect(storage.cleanup()).rejects.toThrow('synthetic database timeout');
    expect(remove).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  release: vi.fn(),
  resolveStore: vi.fn(),
  createResolver: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    query = runtime.query;
    end = runtime.end;
    async connect() {
      return { query: runtime.query, release: runtime.release };
    }
    on() {}
  },
}));
vi.mock('./storage-settings/runtime.js', () => ({
  createStorageSettingsResolver: runtime.createResolver,
}));
import { runCosCleanup } from './cos-cleanup-cli.js';
const originalArgs = process.argv;

describe('COS maintenance permission and restore boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'cos-cleanup-cli.js'];
    vi.stubEnv('DATABASE_URL', 'postgresql://scb_runtime:synthetic@127.0.0.1/scb_test_cos');
    vi.stubEnv('DATABASE_URL_FILE', undefined);
    runtime.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('quarantined')
        ? [{ quarantined: true }]
        : sql.includes('pg_try_advisory_xact_lock_shared')
          ? [{ acquired: true }]
          : [],
      rowCount: 1,
    }));
    runtime.end.mockResolvedValue(undefined);
    runtime.createResolver.mockReturnValue(runtime.resolveStore);
    runtime.resolveStore.mockResolvedValue(undefined);
  });
  afterEach(() => {
    process.argv = originalArgs;
    vi.unstubAllEnvs();
  });

  it('rejects elevated database identities and command arguments before database/cloud work', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://scb_admin:synthetic@127.0.0.1/scb_test_cos');
    await expect(runCosCleanup()).rejects.toThrow('runtime identity');
    expect(runtime.query).not.toHaveBeenCalled();
    vi.stubEnv('DATABASE_URL', 'postgresql://scb_runtime:synthetic@127.0.0.1/scb_test_cos');
    process.argv.push('unexpected');
    await expect(runCosCleanup()).rejects.toThrow('no arguments');
    expect(runtime.createResolver).not.toHaveBeenCalled();
  });

  it('never loads cloud credentials in quarantine or when the database cannot be verified', async () => {
    await expect(runCosCleanup()).rejects.toThrow('restore quarantine');
    runtime.query.mockResolvedValueOnce({ rows: [] });
    await expect(runCosCleanup()).rejects.toThrow('restore quarantine');
    runtime.query.mockRejectedValueOnce(new Error('synthetic database unavailable'));
    await expect(runCosCleanup()).rejects.toThrow('database unavailable');
    expect(runtime.createResolver).not.toHaveBeenCalled();
    expect(runtime.resolveStore).not.toHaveBeenCalled();
    expect(runtime.end).toHaveBeenCalledTimes(3);
  });

  it('fails closed when neither database nor legacy runtime configuration selects COS', async () => {
    runtime.query.mockResolvedValueOnce({ rows: [{ quarantined: false }] });
    await expect(runCosCleanup()).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(runtime.createResolver).toHaveBeenCalledOnce();
    expect(runtime.resolveStore).toHaveBeenCalledOnce();
    expect(runtime.query).toHaveBeenCalledWith('ROLLBACK');
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(runtime.end).toHaveBeenCalledTimes(2);
  });

  it('uses the same transactional active-configuration resolver as media requests', async () => {
    const store = {
      bucket: 'synthetic-cos-1250000000',
      region: 'ap-guangzhou',
      prefix: 'scb-media/v1',
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };
    runtime.resolveStore.mockResolvedValue(store);
    runtime.query.mockImplementation(async (sql: string) => {
      if (sql.includes('quarantined')) return { rows: [{ quarantined: false }] };
      if (sql.includes('pg_try_advisory_xact_lock_shared')) return { rows: [{ acquired: true }] };
      return { rows: [], rowCount: 0 };
    });
    await expect(runCosCleanup()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(runtime.resolveStore).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ query: runtime.query, release: runtime.release }),
    );
    const sharedLock = runtime.query.mock.calls.findIndex(([sql]) =>
      sql.includes('pg_try_advisory_xact_lock_shared'),
    );
    const candidateRead = runtime.query.mock.calls.findIndex(([sql]) =>
      sql.includes('SELECT o.id'),
    );
    expect(sharedLock).toBeGreaterThan(0);
    expect(candidateRead).toBeGreaterThan(sharedLock);
    expect(runtime.query).toHaveBeenCalledWith('COMMIT');
    expect(runtime.end).toHaveBeenCalledTimes(2);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('does not queue or resolve credentials when another process owns the configuration lock', async () => {
    runtime.query.mockImplementation(async (sql: string) => {
      if (sql.includes('quarantined')) return { rows: [{ quarantined: false }] };
      if (sql.includes('pg_try_advisory_xact_lock_shared')) return { rows: [{ acquired: false }] };
      return { rows: [], rowCount: 0 };
    });
    await expect(runCosCleanup()).rejects.toMatchObject({
      status: 503,
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(runtime.resolveStore).not.toHaveBeenCalled();
    expect(runtime.query.mock.calls.some(([sql]) => sql.includes('SELECT o.id'))).toBe(false);
    expect(runtime.query).toHaveBeenCalledWith('ROLLBACK');
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it('redacts active-configuration decryption failures and never falls back to an old provider', async () => {
    runtime.query.mockResolvedValueOnce({ rows: [{ quarantined: false }] });
    runtime.resolveStore.mockRejectedValue(new Error('synthetic-secret-root-key-failure'));
    const error: unknown = await runCosCleanup().catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' });
    expect(String(error)).not.toContain('synthetic-secret-root-key-failure');
    expect(runtime.query.mock.calls.some(([sql]) => sql.includes('SELECT o.id'))).toBe(false);
    expect(runtime.query).toHaveBeenCalledWith('ROLLBACK');
    expect(runtime.end).toHaveBeenCalledTimes(2);
  });
});

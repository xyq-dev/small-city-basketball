import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), readStore: vi.fn() }));
vi.mock('pg', () => ({
  Pool: class {
    query = runtime.query;
    end = runtime.end;
    on() {}
  },
}));
vi.mock('./cos-runtime.js', () => ({ readCosObjectStore: runtime.readStore }));
import { runCosCleanup } from './cos-cleanup-cli.js';
const originalArgs = process.argv;

describe('COS maintenance permission and restore boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'cos-cleanup-cli.js'];
    vi.stubEnv('DATABASE_URL', 'postgresql://scb_runtime:synthetic@127.0.0.1/scb_test_cos');
    vi.stubEnv('DATABASE_URL_FILE', undefined);
    runtime.query.mockResolvedValue({ rows: [{ quarantined: true }] });
    runtime.end.mockResolvedValue(undefined);
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
    expect(runtime.readStore).not.toHaveBeenCalled();
  });

  it('never loads cloud credentials in quarantine or when the database cannot be verified', async () => {
    await expect(runCosCleanup()).rejects.toThrow('restore quarantine');
    runtime.query.mockResolvedValueOnce({ rows: [] });
    await expect(runCosCleanup()).rejects.toThrow('restore quarantine');
    runtime.query.mockRejectedValueOnce(new Error('synthetic database unavailable'));
    await expect(runCosCleanup()).rejects.toThrow('database unavailable');
    expect(runtime.readStore).not.toHaveBeenCalled();
    expect(runtime.end).toHaveBeenCalledTimes(3);
  });

  it('requires explicit cloud configuration after verifying the database', async () => {
    runtime.query.mockResolvedValueOnce({ rows: [{ quarantined: false }] });
    runtime.readStore.mockReturnValue(undefined);
    await expect(runCosCleanup()).rejects.toThrow('requires COS configuration');
    expect(runtime.readStore).toHaveBeenCalledOnce();
    expect(runtime.end).toHaveBeenCalledOnce();
  });
});

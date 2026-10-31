import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingService } from './streaming-service.js';
afterEach(() => vi.useRealTimers());
describe('E01 explicit application worker lifetime', () => {
  it('never starts work from construction, starts once on explicit init and clears the timer before shutdown', async () => {
    vi.useFakeTimers();
    const pool = {
      query: vi.fn(() => {
        throw Error('A constructor must not query or execute jobs');
      }),
    } as unknown as Pool;
    const service = new StreamingService(
      pool,
      {
        databaseUrl: 'postgresql://synthetic@localhost/scb_test_lifecycle',
        appOrigin: 'http://localhost:5173',
      },
      { autoDispatch: true },
    );
    expect(vi.getTimerCount()).toBe(0);
    service.startWorker();
    service.startWorker();
    expect(vi.getTimerCount()).toBe(1);
    await Promise.all([service.onModuleDestroy(), service.onModuleDestroy()]);
    expect(vi.getTimerCount()).toBe(0);
    service.startWorker();
    expect(vi.getTimerCount()).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

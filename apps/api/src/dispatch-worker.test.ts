import { afterEach, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { DispatchService } from './dispatch-service.js';

const options = {
  databaseUrl: 'postgres://unused/scb_test_dispatch',
  appOrigin: 'http://localhost',
};
afterEach(() => vi.useRealTimers());

test('closing dispatch stops its timer and rejects future worker calls before database I/O', async () => {
  vi.useFakeTimers();
  const query = vi.fn(async () => ({ rows: [] }));
  const service = new DispatchService({ query } as unknown as Pool, options, {
    enabled: true,
    autoDispatch: true,
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(query).toHaveBeenCalledTimes(1);
  service.onModuleDestroy();
  await vi.advanceTimersByTimeAsync(30000);
  expect(await service.dispatchDue()).toBe(0);
  expect(query).toHaveBeenCalledTimes(1);
});

test('a tick already reading its bounded queue cannot start transactions after close', async () => {
  let finish!: (value: { rows: Array<{ id: string }> }) => void;
  const query = vi.fn(() => new Promise<{ rows: Array<{ id: string }> }>((r) => (finish = r)));
  const connect = vi.fn();
  const service = new DispatchService({ query, connect } as unknown as Pool, options, {
    enabled: true,
  });
  const running = service.dispatchDue();
  expect(await service.dispatchDue()).toBe(0);
  expect(query).toHaveBeenCalledTimes(1);
  service.close();
  finish({ rows: [{ id: '10000000-0000-4000-8000-000000000001' }] });
  expect(await running).toBe(0);
  expect(connect).not.toHaveBeenCalled();
  expect(await service.dispatchDue()).toBe(0);
  expect(query).toHaveBeenCalledTimes(1);
});

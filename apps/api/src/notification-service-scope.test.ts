import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { NotificationService } from './notification-service.js';
const sourceId = '00000000-0000-4000-8000-000000000001';
function fixture(enabled = false) {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const pool = { query } as unknown as Pool;
  const options = {
    databaseUrl: 'postgresql://test@127.0.0.1/scb_test_scope',
    appOrigin: 'http://localhost:5173',
  };
  const service = new NotificationService(
    pool,
    options,
    enabled
      ? {
          appId: 'wx1234567890abcdef',
          encryptionKey: Buffer.alloc(32, 55).toString('base64'),
          exchange: {
            exchange: async () => ({ appId: 'wx1234567890abcdef', openid: 'synthetic-scope' }),
          },
          provider: { send: async () => ({ state: 'UNKNOWN' }) },
          templates: { MATCH_STARTING: { id: 'synthetic', fields: { thing1: 'event' } } },
          autoDispatch: false,
        }
      : { autoDispatch: false },
  );
  return { service, query };
}
describe('trusted internal notification source scope', () => {
  it('restricts fanout, recovery and candidate delivery SQL and does not scan other schedules', async () => {
    const { service, query } = fixture(true);
    const scheduler = vi.spyOn(service, 'scheduleStarts');
    await service.drain(sourceId);
    expect(scheduler).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(3);
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0]![0]).toContain('AND s.id=$1');
    expect(calls[1]![0]).toContain('AND m.source_id=$1');
    expect(calls[2]![0]).toContain('AND m.source_id=$1');
    for (const [, params] of calls) expect(params).toEqual([sourceId]);
  });
  it('keeps ordinary worker scheduling and global operation unchanged without a scope', async () => {
    const { service, query } = fixture();
    const scheduler = vi.spyOn(service, 'scheduleStarts').mockResolvedValue();
    await service.drain();
    expect(scheduler).toHaveBeenCalledOnce();
    for (const call of query.mock.calls as unknown as [string, unknown[]][])
      expect(call[1]).toEqual([]);
  });
  it.each(['not-a-uuid', '', sourceId + "' OR true --"])(
    'rejects malformed source scope before any persistence: %s',
    async (value) => {
      const { service, query } = fixture();
      await expect(service.fanout(value)).rejects.toHaveProperty('status', 404);
      await expect(service.drain(value)).rejects.toHaveProperty('status', 404);
      await expect(service.recoverExpiredLeases(value)).rejects.toHaveProperty('status', 404);
      expect(query).not.toHaveBeenCalled();
    },
  );
});

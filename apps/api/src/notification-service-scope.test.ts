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
    expect(query).toHaveBeenCalledTimes(5);
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0]![0]).toContain('AND s.id=$1');
    expect(calls[0]![0]).toContain('LIMIT 100 FOR UPDATE OF f SKIP LOCKED');
    expect(calls[1]![0]).toContain('AND s.id=$1');
    expect(calls[1]![0]).toContain("interval '2 hours' THEN 0 ELSE 1 END");
    expect(calls[1]![0]).toContain('f.updated_at,s.expires_at,s.id LIMIT 10');
    expect(calls[2]![0]).toContain('m.source_id=$1');
    expect(calls[3]![0]).toContain('m.source_id=$1');
    expect(calls[4]![0]).toContain('m.source_id=$1');
    expect(calls[4]![0]).toContain("g.status='AVAILABLE'");
    expect(calls[4]![0]).toContain("i.status='ACTIVE'");
    expect(calls[4]![0]).toContain('permission_position=1');
    for (const [, params] of calls) expect(params[0]).toEqual(sourceId);
    expect(calls[4]![1]).toHaveLength(4);
    expect(calls[4]![0]).toContain('make_interval(mins=>$4)');
  });
  it('keeps ordinary worker scheduling and global operation unchanged without a scope', async () => {
    const { service, query } = fixture();
    const scheduler = vi.spyOn(service, 'scheduleStarts').mockResolvedValue();
    await service.drain();
    expect(scheduler).toHaveBeenCalledOnce();
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0]![1]).toEqual([]);
    expect(calls[1]![1]).toEqual([]);
    expect(calls[2]![1]).toEqual([]);
    expect(calls[3]![1]).toEqual([null, 15]);
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

describe('visible notification pagination', () => {
  const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const at = (n: number) => '2028-01-01T00:00:00.' + String(999999 - n).padStart(6, '0') + 'Z';
  function pager(visible: (n: number) => boolean) {
    const { service } = fixture();
    const query = vi.fn(async () => ({ rows: [] as { id: string; cursor_at: string }[] }));
    vi.spyOn(service as any, 'transaction').mockImplementation((run: any) => run({ query }));
    vi.spyOn(service as any, 'lockActor').mockResolvedValue({ user: { id: id(999) } });
    vi.spyOn(service as any, 'ensureFreshSession').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'message').mockImplementation(
      async (_c: any, _user: any, messageId: any) => {
        const n = Number(String(messageId).slice(-12));
        return visible(n)
          ? {
              row: {
                id: messageId,
                created_at: new Date('2028-01-01T00:00:00Z'),
                read_at: null,
                delivery_state: 'WAITING_PERMISSION',
              },
              source: {
                kind: 'REGISTRATION_REVIEW',
                title: '审核更新',
                detail: '当前可见内容',
                eventName: '合成赛事',
                time: '2028-01-01T00:00:00Z',
                location: null,
              },
            }
          : null;
      },
    );
    return { service, query };
  }
  it('continues past a hidden raw page and preserves microseconds without skipping the next visible row', async () => {
    const { service, query } = pager((n) => n > 20);
    query.mockResolvedValueOnce({
      rows: Array.from({ length: 21 }, (_, i) => ({ id: id(i + 1), cursor_at: at(i + 1) })),
    });
    query.mockResolvedValueOnce({
      rows: Array.from({ length: 21 }, (_, i) => ({ id: id(i + 21), cursor_at: at(i + 21) })),
    });
    query.mockResolvedValueOnce({ rows: [{ id: id(41), cursor_at: at(41) }] });
    const first = await service.list('synthetic-cookie', {});
    expect(first.items.map((v) => v.id)).toEqual(Array.from({ length: 20 }, (_, i) => id(i + 21)));
    expect(JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString())).toEqual([
      at(40),
      id(40),
    ]);
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[1]![1]).toEqual([id(999), at(20), id(20)]);
    const next = await service.list('synthetic-cookie', { cursor: first.nextCursor });
    expect(next.items.map((v) => v.id)).toEqual([id(41)]);
    expect(next.nextCursor).toBeNull();
  });
  it('caps invisible-reference scanning and returns an advancing exact cursor rather than false exhaustion', async () => {
    const { service, query } = pager(() => false);
    let batch = 0;
    query.mockImplementation(async () => {
      const start = batch++ * 20 + 1;
      return {
        rows: Array.from({ length: 21 }, (_, i) => ({
          id: id(start + i),
          cursor_at: at(start + i),
        })),
      };
    });
    const result = await service.list('synthetic-cookie', {});
    expect(result.items).toEqual([]);
    expect(query).toHaveBeenCalledTimes(10);
    expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString())).toEqual([
      at(200),
      id(200),
    ]);
  });
});

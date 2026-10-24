import { describe, expect, it, vi } from 'vitest';
import {
  createPlayerPerformanceApi,
  parsePlayerPerformance,
  parsePerformanceWorkspace,
} from './player-performance';
import type { ApiClient } from './client';
import { createDemoBookingRepository } from '../booking/demo';
import { createDemoPerformanceRepository } from '../booking/performance-demo';
import { emptyPerformance } from '../booking/performance-model';
const response = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId: 'test' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const client: ApiClient = {
  request: async () => {
    throw new Error('不应进入私有API');
  },
};
describe('公开统计与私有授权API边界', () => {
  it('公开有限批量使用omit凭据，且拒绝超过20人的请求', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        players: [emptyPerformance('one'), emptyPerformance('two')],
        unavailableProfileIds: [],
      }),
    );
    const api = createPlayerPerformanceApi(client, fetcher);
    expect((await api.performances(['one', 'two'])).players).toHaveLength(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      '/v1/player-bookings/players/performance?ids=one%2Ctwo',
    );
    await expect(api.performances(Array.from({ length: 21 }, (_, i) => String(i)))).rejects.toThrow(
      '1至20名',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('NO_SOURCE保持null，拒绝未采集指标、TEAM_ONLY伪0和私有标识混入', async () => {
    expect(parsePlayerPerformance(emptyPerformance('none')).pointsPerRecordedMatch).toBeNull();
    const booking = createDemoBookingRepository(),
      repo = createDemoPerformanceRepository(booking),
      data = await repo.performance('demo-guard-two');
    expect(parsePlayerPerformance(data).recentRecords.some((r) => r.points === null)).toBe(true);
    expect(() => parsePlayerPerformance({ ...data, assists: 4 })).toThrow('不完整');
    const zero = structuredClone(data);
    const team = zero.recentRecords.find((r) => r.collectionMode === 'TEAM_ONLY')!;
    team.points = 0;
    expect(() => parsePlayerPerformance(zero)).toThrow('不完整');
    expect(() => parsePlayerPerformance({ ...data, privateEventId: 'secret' })).toThrow('不完整');
    expect(() =>
      parsePlayerPerformance({
        ...data,
        recentRecords: [{ ...data.recentRecords[0], memberId: 'secret' }],
      }),
    ).toThrow('不完整');
  });
  it('批量缺失或返回非请求球员时整体拒绝，不补演示', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ players: [emptyPerformance('other')], unavailableProfileIds: [] }),
      );
    await expect(createPlayerPerformanceApi(client, fetcher).performances(['one'])).rejects.toThrow(
      '不完整',
    );
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ players: [], unavailableProfileIds: ['one'] }));
    expect(await createPlayerPerformanceApi(client, unavailable).performances(['one'])).toEqual({
      players: [],
      unavailableProfileIds: ['one'],
    });
  });
  it('私有授权工作区必须包含服务端能力，命令保留版本与明确同意', async () => {
    const booking = createDemoBookingRepository();
    booking.setRole('player');
    const repo = createDemoPerformanceRepository(booking),
      workspace = await repo.workspace();
    expect(parsePerformanceWorkspace(workspace).manageableEvents).toEqual([]);
    const bad = structuredClone(workspace);
    delete (bad.links[0]!.capabilities as unknown as Record<string, unknown>).canRevoke;
    expect(() => parsePerformanceWorkspace(bad)).toThrow('不完整');
    const request = vi
      .fn<ApiClient['request']>()
      .mockResolvedValue({ data: workspace.links[1], meta: { requestId: 'test' } });
    const api = createPlayerPerformanceApi({ request: request as ApiClient['request'] });
    const input = {
      commandId: 'stable-command',
      expectedVersion: 1,
      type: 'CONSENT' as const,
      reason: '本人同意',
      playerConsent: true as const,
    };
    await api.command(workspace.links[1]!.id, input);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(input);
  });
});

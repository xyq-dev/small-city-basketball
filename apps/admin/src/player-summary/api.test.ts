import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { createPlayerStatisticsApi } from '../api/player-statistics';
import { statistics, response } from './test-fixtures';

describe('private event player statistics adapter', () => {
  it('uses credentialed organization paths and accepts a missing formal schedule without fabricating data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ ...statistics, event: { ...statistics.event, id: 'event/a' }, summary: null }),
      );
    const api = createPlayerStatisticsApi(createApiClient({ fetcher }), 'org/a');
    expect((await api.event('event/a')).summary).toBeNull();
    expect(fetcher.mock.calls[0][0]).toBe('/v1/orgs/org%2Fa/events/event%2Fa/player-statistics');
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('same-origin');
    expect(fetcher.mock.calls[0][1]?.cache).toBe('no-store');
    expect(() => createPlayerStatisticsApi(createApiClient({ fetcher }), ' ')).toThrow('请先选择');
  });
  it('accepts independent collection and attribution coverage including shared ranks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(statistics));
    const result = await createPlayerStatisticsApi(createApiClient({ fetcher }), 'org-a').event(
      'event-a',
    );
    expect(result.summary?.rows.map((row) => [row.rank, row.fouls])).toEqual([
      [1, 3],
      [1, 0],
    ]);
    expect(result.summary?.attributionComplete).toBe(false);
  });
  it.each([
    [
      'private field outside DTO',
      (value: Record<string, any>) => {
        value.secret = 'forbidden';
      },
    ],
    [
      'nested contact field',
      (value: Record<string, any>) => {
        value.summary.rows[0].phone = 'private';
      },
    ],
    [
      'event context field',
      (value: Record<string, any>) => {
        value.event.orgId = 'other-org';
      },
    ],
    [
      'negative personal metric',
      (value: Record<string, any>) => {
        value.summary.rows[0].score = -1;
      },
    ],
    [
      'unsafe counter',
      (value: Record<string, any>) => {
        value.summary.pendingMatchCount = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'missing count sample',
      (value: Record<string, any>) => {
        value.summary.includedMatchCount = 2;
      },
    ],
    [
      'unsupported algorithm',
      (value: Record<string, any>) => {
        value.summary.algorithmVersion = 'UNKNOWN';
      },
    ],
    [
      'fake coverage',
      (value: Record<string, any>) => {
        value.summary.coverageComplete = true;
      },
    ],
    [
      'fake attribution',
      (value: Record<string, any>) => {
        value.summary.attributionComplete = true;
      },
    ],
    [
      'duplicate frozen identity',
      (value: Record<string, any>) => {
        value.summary.rows.push(value.summary.rows[0]);
      },
    ],
    [
      'missing team identity',
      (value: Record<string, any>) => {
        value.summary.teams.pop();
      },
    ],
    [
      'invalid frozen sample count',
      (value: Record<string, any>) => {
        value.summary.rows[0].rosterSampleMatchCount = 2;
      },
    ],
    [
      'invalid timestamp',
      (value: Record<string, any>) => {
        value.summary.asOf = 'not-a-time';
      },
    ],
    [
      'unsupported status',
      (value: Record<string, any>) => {
        value.event.status = 'UNKNOWN';
      },
    ],
  ])('rejects %s instead of rendering unproven personal data', async (_label, mutate) => {
    const malformed = structuredClone(statistics);
    mutate(malformed);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(malformed));
    await expect(
      createPlayerStatisticsApi(createApiClient({ fetcher }), 'org-a').event('event-a'),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('preserves revoked or unauthorized server errors and refreshes an expired session', async () => {
    const refresh = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ code: 'UNAUTHENTICATED', message: '登录已失效' }, 401))
      .mockResolvedValueOnce(response({ code: 'NOT_FOUND', message: '赛事不可用' }, 404));
    const api = createPlayerStatisticsApi(
      createApiClient({ fetcher, onUnauthorized: refresh }),
      'org-a',
    );
    await expect(api.event('event-a')).rejects.toMatchObject({ apiCode: 'UNAUTHENTICATED' });
    expect(refresh).toHaveBeenCalledOnce();
    await expect(api.event('event-a')).rejects.toMatchObject({ status: 404 });
  });
  it('rejects an otherwise valid response for a different event', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(statistics));
    await expect(
      createPlayerStatisticsApi(createApiClient({ fetcher }), 'org-a').event('event-b'),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('accepts zero included samples with all published teams at zero but rejects a claim of complete attribution', async () => {
    const empty = {
      ...statistics,
      summary: {
        ...statistics.summary!,
        includedMatchCount: 0,
        pendingMatchCount: 2,
        attributionComplete: false,
        rows: [],
        teams: statistics.summary!.teams.map((team) => ({
          ...team,
          attributedScore: 0,
          unassignedScore: 0,
          attributedFouls: 0,
          unassignedFouls: 0,
        })),
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(empty))
      .mockResolvedValueOnce(
        response({ ...empty, summary: { ...empty.summary, attributionComplete: true } }),
      );
    const api = createPlayerStatisticsApi(createApiClient({ fetcher }), 'org-a');
    expect((await api.event('event-a')).summary?.teams).toHaveLength(2);
    await expect(api.event('event-a')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
});

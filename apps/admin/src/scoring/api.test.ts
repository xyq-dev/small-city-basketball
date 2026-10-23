// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { createScoringApi } from '../api/scoring';
import { response, snapshot, workbench, playerSnapshot, playerWorkbench } from './test-fixtures';
const summary = {
  matchId: 'match-a',
  eventId: 'event-a',
  eventName: '合成联赛',
  homeTeamName: '甲队',
  awayTeamName: '乙队',
  courtName: '球场',
  startsAt: '2026-10-22T08:00:00Z',
  status: 'LIVE',
  version: 3,
  score: { home: 0, away: 0 },
};
describe('strict scoring HTTP adapter', () => {
  it('uses local organization paths, cookie client and takes every page', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([summary], { nextCursor: 'next page' }))
      .mockResolvedValueOnce(response([{ ...summary, matchId: 'match-b' }], { nextCursor: null }));
    const api = createScoringApi(createApiClient({ fetcher }), 'org/a');
    expect(await api.matches()).toHaveLength(2);
    expect(fetcher.mock.calls[0][0]).toBe('/v1/orgs/org%2Fa/scoring-matches?limit=100');
    expect(String(fetcher.mock.calls[1][0])).toContain('cursor=next+page');
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('same-origin');
  });
  it('later page failure never returns the first page as the full list', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([summary], { nextCursor: 'next' }))
      .mockResolvedValueOnce(response({ code: 'INTERNAL_ERROR', message: '分页失败' }, {}, 503));
    await expect(
      createScoringApi(createApiClient({ fetcher }), 'org').matches(),
    ).rejects.toMatchObject({ apiCode: 'INTERNAL_ERROR' });
  });
  it('requires all capabilities and never invents a snapshot before preparation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...workbench, snapshot: null }))
      .mockResolvedValueOnce(response({ ...workbench, capabilities: { canRecord: true } }));
    const api = createScoringApi(createApiClient({ fetcher }), 'org');
    expect((await api.workbench('match-a')).snapshot).toBeNull();
    await expect(api.workbench('match-a')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('rejects empty context, malformed cursor and incomplete private snapshot', async () => {
    const client = createApiClient({ fetcher: vi.fn() });
    expect(() => createScoringApi(client, '')).toThrow('请先选择');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([summary], { nextCursor: 3 }));
    await expect(
      createScoringApi(createApiClient({ fetcher }), 'org').matches(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_CURSOR' });
    const broken = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ ...snapshot, collected: { teamScore: true } }));
    await expect(
      createScoringApi(createApiClient({ fetcher: broken }), 'org').snapshot('match-a'),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('accepts player basic statistics only when all player and unassigned totals reconcile', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(playerSnapshot));
    const api = createScoringApi(createApiClient({ fetcher }), 'org');
    expect((await api.snapshot('match-a')).playerStatistics?.mode).toBe('PLAYER_BASIC');
    const changed = structuredClone(playerSnapshot);
    changed.playerStatistics!.home.players[0].score = 2;
    fetcher.mockResolvedValue(response(changed));
    await expect(api.snapshot('match-a')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    changed.totals.home.score = 2;
    fetcher.mockResolvedValue(response(changed));
    expect((await api.snapshot('match-a')).totals.home.score).toBe(2);
  });
  it.each(['flag', 'negative', 'duplicate', 'missing-roster'] as const)(
    'rejects malformed player collection: %s',
    async (problem) => {
      const changed = structuredClone(playerWorkbench);
      if (problem === 'flag') changed.snapshot!.collected.playerStatistics = false;
      if (problem === 'negative') changed.snapshot!.playerStatistics!.away.unassigned.fouls = -1;
      if (problem === 'duplicate')
        changed.snapshot!.playerStatistics!.home.players.push(
          changed.snapshot!.playerStatistics!.home.players[0],
        );
      const body = problem === 'missing-roster' ? { ...changed, playerRoster: undefined } : changed;
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body));
      await expect(
        createScoringApi(createApiClient({ fetcher }), 'org').workbench('match-a'),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    },
  );
});

import { describe, expect, it, vi } from 'vitest';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import { createApiClient } from './client';
import { createSchedulingApi } from './scheduling';

const participant = {
  entryId: 'entry-a',
  teamId: 'team-a',
  teamName: '合成篮球队',
  rosterRevisionId: 'roster-a',
};
const scheduledMatch = {
  id: 'match-a',
  eventId: 'event-a',
  publicationId: 'publication-a',
  fixtureKey: 'R1-P1',
  roundNo: 1,
  positionNo: 1,
  home: participant,
  away: { ...participant, entryId: 'entry-b', teamId: 'team-b' },
  courtId: 'court-a',
  courtName: '合成球场',
  startsAt: '2026-12-01T01:00:00.000Z',
  endsAt: '2026-12-01T02:00:00.000Z',
  version: 1,
};
function apiFor(value: unknown) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ data: [value], meta: { requestId: 'test', nextCursor: null } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  return createSchedulingApi(createApiClient({ fetcher }), 'org-a');
}

describe('正式赛程与记分状态兼容', () => {
  it.each(MATCH_STATUSES)('读取%s状态仍保留不可变计划事实', async (status) => {
    const match = { ...scheduledMatch, status, version: 8 };
    expect(await apiFor(match).matches('event-a')).toEqual([match]);
  });
  it('拒绝未知运行状态，避免把错误响应强转为正式赛程', async () => {
    await expect(
      apiFor({ ...scheduledMatch, status: 'MADE_UP' }).matches('event-a'),
    ).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
  });
});

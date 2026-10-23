import type { EventPlayerStatisticsData } from '@small-city-basketball/contracts';

export const statistics: EventPlayerStatisticsData = {
  event: {
    id: 'event-a',
    name: '合成测试篮球赛',
    format: 'ROUND_ROBIN',
    status: 'RUNNING',
    version: 8,
    startDate: '2026-10-23',
    endDate: '2026-10-24',
    timezone: 'Asia/Shanghai',
    venueName: null,
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T08:00:00Z',
  },
  summary: {
    algorithmVersion: 'EVENT_PLAYER_BASIC_V1',
    sourceHash: 'a'.repeat(64),
    asOf: '2026-10-23T08:00:00Z',
    totalMatchCount: 3,
    includedMatchCount: 1,
    teamOnlyConfirmedMatchCount: 1,
    pendingMatchCount: 1,
    coverageComplete: false,
    attributionComplete: false,
    rows: [
      {
        entryId: 'entry-a',
        rosterRevisionId: 'revision-a',
        memberId: 'player-a',
        teamName: '合成甲队',
        name: '测试甲',
        jerseyNo: '7',
        score: 4,
        fouls: 3,
        rosterSampleMatchCount: 1,
        rank: 1,
        tied: true,
      },
      {
        entryId: 'entry-b',
        rosterRevisionId: 'revision-b',
        memberId: 'player-b',
        teamName: '合成乙队',
        name: '测试乙',
        jerseyNo: '8',
        score: 4,
        fouls: 0,
        rosterSampleMatchCount: 1,
        rank: 1,
        tied: true,
      },
    ],
    teams: [
      {
        entryId: 'entry-a',
        teamName: '合成甲队',
        attributedScore: 4,
        unassignedScore: 2,
        attributedFouls: 3,
        unassignedFouls: 1,
      },
      {
        entryId: 'entry-b',
        teamName: '合成乙队',
        attributedScore: 4,
        unassignedScore: 0,
        attributedFouls: 0,
        unassignedFouls: 0,
      },
    ],
  },
};
export function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status < 400 ? { data, meta: { requestId: 'synthetic-request' } } : { error: data },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

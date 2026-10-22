import type {
  EventStandingsData,
  PublicEventData,
  PublicStandingsData,
  PublicScheduleMatchData,
  PublicMatchSnapshotData,
  PublicStandingsRules,
} from '@small-city-basketball/contracts';
export const time = '2026-10-22T08:00:00.000Z';
export const publicRules: PublicStandingsRules = {
  winPoints: 2,
  lossPoints: 0,
  drawPoints: 1,
  tiebreakers: ['SCORE_DIFFERENCE'],
  version: 1,
  algorithmVersion: 'RR_STANDINGS_V1',
};
const metrics = {
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  scoreDifference: 0,
  leaguePoints: 0,
};
export const publicStandings: PublicStandingsData = {
  publicEventId: 'public-event-a',
  rules: publicRules,
  sourceHash: 'public-source-hash',
  asOf: time,
  confirmedMatchCount: 0,
  totalMatchCount: 1,
  isComplete: false,
  hasSharedRanks: false,
  rows: [
    { ...metrics, teamKey: 'public-team-home', teamName: '合成主队', rank: null, tied: false },
    { ...metrics, teamKey: 'public-team-away', teamName: '合成客队', rank: null, tied: false },
  ],
};
export const publicEvent: PublicEventData = {
  publicEventId: 'public-event-a',
  name: '合成城市公开联赛',
  startDate: '2026-10-22',
  endDate: '2026-10-23',
  timezone: 'Asia/Shanghai',
  venueName: '合成城市球馆',
  status: 'SCHEDULED',
  rules: publicRules,
  confirmedMatchCount: 0,
  totalMatchCount: 1,
  isComplete: false,
  serverTime: time,
};
export const publicMatch: PublicScheduleMatchData = {
  publicMatchId: 'public-match-a',
  roundNo: 1,
  positionNo: 1,
  home: { teamKey: 'public-team-home', teamName: '合成主队' },
  away: { teamKey: 'public-team-away', teamName: '合成客队' },
  courtName: '合成一号场',
  startsAt: time,
  endsAt: '2026-10-22T09:00:00.000Z',
  status: 'SCHEDULED',
  version: 1,
  score: null,
  resultStatus: 'UNCONFIRMED',
};
export const unprepared: PublicMatchSnapshotData = {
  ...publicMatch,
  publicEventId: publicEvent.publicEventId,
  eventName: publicEvent.name,
  totals: null,
  periods: null,
  rules: null,
  clock: null,
  collected: { teamScore: false, teamFouls: false, teamTimeouts: false, playerStatistics: false },
  serverTime: time,
};
export const live: PublicMatchSnapshotData = {
  ...unprepared,
  status: 'LIVE',
  version: 3,
  score: { home: 2, away: 0 },
  totals: { home: { score: 2, fouls: 0, timeouts: 0 }, away: { score: 0, fouls: 0, timeouts: 0 } },
  periods: [
    {
      period: 1,
      home: { score: 2, fouls: 0, timeouts: 0 },
      away: { score: 0, fouls: 0, timeouts: 0 },
    },
  ],
  rules: {
    regulationPeriods: 1,
    periodDurationSeconds: 60,
    allowedScoreValues: [1, 2, 3],
    tiePolicy: 'ALLOW_DRAW',
    overtimeDurationSeconds: null,
    version: 1,
  },
  clock: { period: 1, remainingMs: 60000, running: true, anchorServerTime: time, clockVersion: 1 },
  collected: { teamScore: true, teamFouls: true, teamTimeouts: true, playerStatistics: false },
  serverTime: '2026-10-22T08:00:10.000Z',
};
export const overview: EventStandingsData = {
  event: {
    id: 'private-event-a',
    name: '合成城市联赛',
    startDate: publicEvent.startDate,
    endDate: publicEvent.endDate,
    timezone: 'Asia/Shanghai',
    venueName: publicEvent.venueName,
    format: 'ROUND_ROBIN',
    status: 'SCHEDULED',
    version: 7,
    createdAt: time,
    updatedAt: time,
  },
  rules: { ...publicRules, id: 'private-rules-a', eventId: 'private-event-a', createdAt: time },
  locked: false,
  standings: {
    ...publicStandings,
    mode: 'DRAFT_PREVIEW',
    rulesetVersion: 1,
    rows: publicStandings.rows.map((row, index) => ({
      ...row,
      entryId: `private-entry-${index}`,
      teamId: `private-team-${index}`,
    })),
  },
  publication: null,
  capabilities: {
    canManageRules: true,
    canPublishRules: true,
    canEnablePublicViewing: false,
    canDisablePublicViewing: false,
  },
};
export function response(data: unknown, meta: Record<string, unknown> = {}, status = 200) {
  return new Response(
    JSON.stringify(
      status >= 400
        ? { error: data }
        : { data, meta: { requestId: 'test', nextCursor: null, ...meta } },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

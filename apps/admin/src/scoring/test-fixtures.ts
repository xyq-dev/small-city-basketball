import type {
  EventScoringData,
  ScoringWorkbenchData,
  ScoreSnapshot,
  ScoringCommandResponse,
  ScorekeeperLeaseData,
  ScoringCommandInput,
} from '@small-city-basketball/contracts';
import type { ScoringApi } from '../api/scoring';
import { vi } from 'vitest';
export const now = '2026-10-22T08:00:00.000Z';
export const rules = {
  id: 'rules-a',
  eventId: 'event-a',
  version: 1,
  createdAt: now,
  regulationPeriods: 1,
  periodDurationSeconds: 60,
  allowedScoreValues: [1, 2, 3] as (1 | 2 | 3)[],
  tiePolicy: 'ALLOW_DRAW' as const,
  overtimeDurationSeconds: null,
};
const participant = (side: string) => ({
  entryId: `entry-${side}`,
  teamId: `team-${side}`,
  teamName: `合成${side === 'a' ? '甲' : '乙'}队`,
  rosterRevisionId: `roster-${side}`,
});
export const snapshot: ScoreSnapshot = {
  matchId: 'match-a',
  eventId: 'event-a',
  eventName: '合成城市联赛',
  status: 'LIVE',
  version: 3,
  home: participant('a'),
  away: participant('b'),
  totals: { home: { score: 0, fouls: 0, timeouts: 0 }, away: { score: 0, fouls: 0, timeouts: 0 } },
  periods: [
    {
      period: 1,
      home: { score: 0, fouls: 0, timeouts: 0 },
      away: { score: 0, fouls: 0, timeouts: 0 },
    },
  ],
  rules,
  clock: { period: 1, remainingMs: 60000, running: false, anchorServerTime: now, clockVersion: 1 },
  lastEventSeq: 2,
  latestConfirmation: null,
  requiresReconfirmation: false,
  playerStatistics: null,
  collected: { teamScore: true, teamFouls: true, teamTimeouts: true, playerStatistics: false },
  serverTime: now,
};
export const workbench: ScoringWorkbenchData = {
  match: {
    id: 'match-a',
    eventId: 'event-a',
    publicationId: 'publication-a',
    fixtureKey: 'round-1-match-1',
    roundNo: 1,
    positionNo: 1,
    home: snapshot.home,
    away: snapshot.away,
    courtId: 'court-a',
    courtName: '合成球场',
    startsAt: now,
    endsAt: '2026-10-22T09:00:00Z',
    status: 'LIVE',
    version: 3,
  },
  event: { id: 'event-a', name: '合成城市联赛', status: 'RUNNING', version: 8 },
  rules,
  rulesLocked: true,
  snapshot,
  playerRoster: { home: [], away: [] },
  staff: [{ userId: 'writer-a', displayName: '合成记分员', role: 'SCORER', status: 'ACTIVE' }],
  lease: { held: true, expiresAt: '2026-10-22T08:00:30Z', holderUserId: 'writer-a' },
  capabilities: {
    canManageStaff: false,
    canPrepare: false,
    canAcquireControl: true,
    canRecord: true,
    canCorrect: true,
    canConfirm: false,
    canReopen: false,
  },
};
export const eventScoring: EventScoringData = {
  event: {
    id: 'event-a',
    name: '合成城市联赛',
    status: 'SCHEDULED',
    version: 7,
    startDate: '2026-10-22',
    endDate: '2026-10-23',
    timezone: 'Asia/Shanghai',
    venueName: null,
    format: 'ROUND_ROBIN',
    createdAt: now,
    updatedAt: now,
  },
  rules: null,
  locked: false,
  capabilities: { canManageRules: true },
};
export const playerRoster = {
  home: [
    { memberId: '10000000-0000-4000-8000-000000000001', name: '合成球员甲', jerseyNo: '7' },
    { memberId: '10000000-0000-4000-8000-000000000002', name: '合成球员乙', jerseyNo: '12' },
  ],
  away: [{ memberId: '20000000-0000-4000-8000-000000000001', name: '合成球员丙', jerseyNo: '9' }],
};
export const playerStatistics = {
  mode: 'PLAYER_BASIC' as const,
  home: {
    players: playerRoster.home.map((player) => ({ ...player, score: 0, fouls: 0 })),
    unassigned: { score: 0, fouls: 0 },
  },
  away: {
    players: playerRoster.away.map((player) => ({ ...player, score: 0, fouls: 0 })),
    unassigned: { score: 0, fouls: 0 },
  },
};
export const playerSnapshot: ScoreSnapshot = {
  ...snapshot,
  playerStatistics,
  collected: { ...snapshot.collected, playerStatistics: true },
};
export const playerWorkbench: ScoringWorkbenchData = {
  ...workbench,
  playerRoster,
  snapshot: playerSnapshot,
};
export const lease: ScorekeeperLeaseData = {
  leaseId: 'lease-a',
  fencingToken: '1',
  clientInstanceId: 'client-a',
  expiresAt: '2026-10-22T08:00:30Z',
  serverTime: now,
};
export function ack(input: ScoringCommandInput): ScoringCommandResponse {
  return {
    receipt: {
      commandId: input.commandId,
      matchId: 'match-a',
      type: input.type,
      appliedVersion: 4,
      firstEventSeq: 3,
      lastEventSeq: 3,
      acceptedAt: now,
    },
    snapshot: {
      ...snapshot,
      version: 4,
      totals: { ...snapshot.totals, home: { ...snapshot.totals.home, score: 2 } },
    },
  };
}
export function mockApi(): ScoringApi {
  return {
    matches: vi.fn().mockResolvedValue([]),
    event: vi.fn().mockResolvedValue(eventScoring),
    rules: vi.fn().mockResolvedValue(eventScoring),
    workbench: vi.fn().mockResolvedValue(workbench),
    staff: vi.fn().mockResolvedValue(workbench),
    acquire: vi
      .fn()
      .mockImplementation(async (_id, clientInstanceId) => ({ ...lease, clientInstanceId })),
    renew: vi.fn().mockResolvedValue(lease),
    release: vi.fn().mockResolvedValue(undefined),
    command: vi.fn().mockImplementation(async (_id, input) => ack(input)),
    receipt: vi.fn(),
    snapshot: vi.fn().mockResolvedValue(snapshot),
    events: vi.fn().mockResolvedValue([]),
    confirmations: vi.fn().mockResolvedValue([]),
  };
}
export function response(data: unknown, meta: Record<string, unknown> = {}, status = 200) {
  return new Response(
    JSON.stringify(
      status >= 400
        ? { error: data, meta: { requestId: 'test', ...meta } }
        : { data, meta: { requestId: 'test', ...meta } },
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

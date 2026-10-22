import type {
  OverlayGrantData,
  OverlaySnapshotData,
  OverlayWorkbenchData,
} from '@small-city-basketball/contracts';
export const serverTime = '2026-10-22T01:00:00.000Z';
export const snapshot: OverlaySnapshotData = {
  overlayId: 'overlay-a',
  template: 'SCOREBAR_1080P_V1',
  expiresAt: '2026-10-22T02:00:00.000Z',
  serverTime,
  eventName: '城市邀请赛',
  home: { teamName: '青峰队' },
  away: { teamName: '北城队' },
  status: 'LIVE',
  matchVersion: 5,
  score: { home: 12, away: 9 },
  totals: { home: { score: 12, fouls: 1, timeouts: 0 }, away: { score: 9, fouls: 2, timeouts: 1 } },
  periods: [
    {
      period: 1,
      home: { score: 12, fouls: 1, timeouts: 0 },
      away: { score: 9, fouls: 2, timeouts: 1 },
    },
  ],
  rules: {
    regulationPeriods: 4,
    periodDurationSeconds: 600,
    allowedScoreValues: [1, 2, 3],
    tiePolicy: 'ALLOW_DRAW',
    overtimeDurationSeconds: null,
    version: 1,
  },
  clock: {
    period: 1,
    remainingMs: 600000,
    running: true,
    anchorServerTime: '2026-10-22T00:59:57.000Z',
    clockVersion: 2,
  },
  collected: { teamScore: true, teamFouls: true, teamTimeouts: true, playerStatistics: false },
  resultStatus: 'UNCONFIRMED',
};
export const grant: OverlayGrantData = {
  overlayId: 'overlay-a',
  template: 'SCOREBAR_1080P_V1',
  status: 'ACTIVE',
  version: 1,
  createdAt: serverTime,
  expiresAt: snapshot.expiresAt,
  revokedAt: null,
  revocationReason: null,
};
const { overlayId: _id, template: _template, expiresAt: _expiry, ...preview } = snapshot;
void _id;
void _template;
void _expiry;
export const workbench: OverlayWorkbenchData = {
  event: { id: 'event-a', name: '城市邀请赛', version: 7 },
  matchId: 'match-a',
  preview,
  previewError: null,
  currentGrant: null,
  history: [],
  historyLimit: 20,
  historyTruncated: false,
  capabilities: { canIssue: true, canRotate: false, canRevoke: false },
  serverTime,
};
export function response(data: unknown) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'overlay-test' } }), {
    status: 200,
  });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

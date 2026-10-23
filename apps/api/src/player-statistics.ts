import type {
  MatchPlayerRoster,
  MatchPlayerStatistics,
  MatchSidePlayerStatistics,
  ScoringCollectionMode,
  ScoringEventData,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import type { ReplayedScoringStats } from './scoring-domain.js';

export function scoringCollectionMode(value: unknown): ScoringCollectionMode {
  if (value !== 'TEAM_ONLY' && value !== 'PLAYER_BASIC')
    throw new ApiError(422, 'PLAYER_STATISTICS_INVALID', '球员统计采集模式无效');
  return value;
}

/** The original prepare event is the durable source; omitted mode preserves old matches. */
export function recordedCollectionMode(events: ScoringEventData[]): ScoringCollectionMode {
  const prepared = events.find((event) => event.type === 'PREPARE_MATCH');
  const mode = prepared?.payload.collectionMode;
  return scoringCollectionMode(mode === undefined ? 'TEAM_ONLY' : mode);
}

function invalidSource(): never {
  throw new ApiError(422, 'PLAYER_STATISTICS_INVALID', '球员统计来源无效');
}
function sourceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidSource();
  return value as Record<string, unknown>;
}
function sourceCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidSource();
  return value as number;
}
/** Rebuild the DTO whitelist rather than passing stored JSON objects through to a client. */
export function playerStatisticsDto(value: unknown): MatchPlayerStatistics | null {
  if (value === null) return null;
  const raw = sourceObject(value);
  if (raw.mode !== 'PLAYER_BASIC') invalidSource();
  const seen = new Set<string>();
  function side(value: unknown): MatchSidePlayerStatistics {
    const raw = sourceObject(value);
    if (!Array.isArray(raw.players) || !raw.players.length || raw.players.length > 60)
      invalidSource();
    const unassigned = sourceObject(raw.unassigned);
    return {
      players: raw.players.map((value) => {
        const player = sourceObject(value);
        if (
          typeof player.memberId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            player.memberId,
          ) ||
          seen.has(player.memberId.toLowerCase()) ||
          typeof player.name !== 'string' ||
          !player.name.trim() ||
          Array.from(player.name).length > 80 ||
          player.name.includes('\u0000') ||
          typeof player.jerseyNo !== 'string' ||
          !/^(?:0|00|[1-9][0-9]?)$/.test(player.jerseyNo)
        )
          invalidSource();
        seen.add(player.memberId.toLowerCase());
        return {
          memberId: player.memberId.toLowerCase(),
          name: player.name,
          jerseyNo: player.jerseyNo,
          score: sourceCount(player.score),
          fouls: sourceCount(player.fouls),
        };
      }),
      unassigned: { score: sourceCount(unassigned.score), fouls: sourceCount(unassigned.fouls) },
    };
  }
  return { mode: 'PLAYER_BASIC', home: side(raw.home), away: side(raw.away) };
}

/** This is a projection of the existing scoring stream, never a second writable score. */
export function projectPlayerStatistics(
  mode: ScoringCollectionMode,
  stats: ReplayedScoringStats,
  roster: MatchPlayerRoster,
): MatchPlayerStatistics | null {
  scoringCollectionMode(mode);
  const build = (players: MatchPlayerRoster['home']): MatchSidePlayerStatistics => ({
    players: players.map((player) => ({ ...player, score: 0, fouls: 0 })),
    unassigned: { score: 0, fouls: 0 },
  });
  const home = build(roster.home);
  const away = build(roster.away);
  const maps = {
    HOME: new Map(home.players.map((player) => [player.memberId, player])),
    AWAY: new Map(away.players.map((player) => [player.memberId, player])),
  };
  if (
    maps.HOME.size !== home.players.length ||
    maps.AWAY.size !== away.players.length ||
    new Set([...maps.HOME.keys(), ...maps.AWAY.keys()]).size !==
      home.players.length + away.players.length
  )
    throw new ApiError(422, 'PLAYER_STATISTICS_INVALID', '本场冻结名单重复');
  for (const stat of stats.activeStats.values()) {
    if (stat.memberId && (mode !== 'PLAYER_BASIC' || stat.kind === 'TIMEOUT'))
      throw new ApiError(422, 'PLAYER_ATTRIBUTION_NOT_ALLOWED', '本场或该统计不允许球员归属');
    if (mode === 'TEAM_ONLY' || stat.kind === 'TIMEOUT') continue;
    const side = stat.side === 'HOME' ? home : away;
    const target = stat.memberId ? maps[stat.side].get(stat.memberId) : side.unassigned;
    if (!target)
      throw new ApiError(422, 'PLAYER_NOT_IN_MATCH_ROSTER', '球员不属于该方本场冻结名单');
    const key = stat.kind === 'SCORE' ? 'score' : 'fouls';
    target[key] += stat.value;
    if (!Number.isSafeInteger(target[key]))
      throw new ApiError(422, 'PLAYER_STATISTICS_INVALID', '球员统计超出可表示范围');
  }
  return mode === 'TEAM_ONLY' ? null : { mode: 'PLAYER_BASIC', home, away };
}

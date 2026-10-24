import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  MatchPlayerStatistics,
  PlayerPerformanceData,
  PlayerPerformanceRecord,
} from '@small-city-basketball/contracts';
import { confirmedPlayerStatistics } from '../confirmed-player-statistics.js';
import { ApiError } from '../errors.js';
import type { ResultRow } from '../standings-domain.js';
import { resultSourceInvalid } from '../standings-domain.js';

export const PERFORMANCE_SAMPLE_LIMIT = 1000;
export interface PerformanceSample {
  teamId: string;
  memberId: string;
  eventName: string;
  format: string;
  date: string;
  startsAt: string;
  proof: ResultRow;
}
function fixedRoster(raw: unknown): { memberId: string; name: string; jerseyNo: string }[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 60) resultSourceInvalid();
  const players = raw
    .map((p) => {
      if (
        !p ||
        typeof p.memberId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(p.memberId) ||
        typeof p.name !== 'string' ||
        !p.name.trim() ||
        typeof p.jerseyNo !== 'string' ||
        !/^(?:0|00|[1-9][0-9]?)$/.test(p.jerseyNo)
      )
        resultSourceInvalid();
      return { memberId: p.memberId.toLowerCase(), name: p.name, jerseyNo: p.jerseyNo };
    })
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
  if (new Set(players.map((p) => p.memberId)).size !== players.length) resultSourceInvalid();
  return players;
}
function validateFrozenRoster(m: ResultRow, stats: MatchPlayerStatistics | null) {
  const home = fixedRoster(m.home_roster),
    away = fixedRoster(m.away_roster);
  if (new Set([...home, ...away].map((p) => p.memberId)).size !== home.length + away.length)
    resultSourceInvalid();
  if (stats) {
    for (const side of ['home', 'away'] as const) {
      const actual = stats[side].players
        .map(({ memberId, name, jerseyNo }) => ({ memberId, name, jerseyNo }))
        .sort((a, b) => a.memberId.localeCompare(b.memberId));
      if (!isDeepStrictEqual(actual, side === 'home' ? home : away)) resultSourceInvalid();
    }
  }
  return { home, away };
}

/** Only explicitly authorized, current confirmation proofs reach this function. */
export function performanceProjection(input: {
  profileId: string;
  sourceCount: number;
  completedServiceCount: number;
  samples: PerformanceSample[];
  asOf: string;
  truncated?: boolean;
}): PlayerPerformanceData {
  let pending = 0,
    invalid = 0,
    teamOnly = 0,
    partialAttribution = 0,
    totalPoints = 0,
    totalFouls = 0,
    recorded = 0;
  const seen = new Set<string>();
  const records: { record: PlayerPerformanceRecord; startsAt: string; matchId: string }[] = [];
  for (const sample of input.samples.slice(0, PERFORMANCE_SAMPLE_LIMIT)) {
    const m = sample.proof;
    if (!m || typeof m.id !== 'string') {
      invalid++;
      continue;
    }
    // Independent of SQL uniqueness, a match can contribute at most one sample per profile.
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.status !== 'FINAL') {
      pending++;
      continue;
    }
    try {
      const stats = confirmedPlayerStatistics(m);
      const rosters = validateFrozenRoster(m, stats);
      const side =
        m.home_team_id === sample.teamId
          ? 'home'
          : m.away_team_id === sample.teamId
            ? 'away'
            : null;
      if (!side || !rosters[side].some((p) => p.memberId === sample.memberId))
        resultSourceInvalid();
      let points: number | null = null,
        fouls: number | null = null;
      const attributionComplete = stats
        ? stats[side].unassigned.score === 0 && stats[side].unassigned.fouls === 0
        : null;
      if (attributionComplete === false) partialAttribution++;
      if (stats) {
        const player = stats[side].players.find((p) => p.memberId === sample.memberId);
        if (!player) resultSourceInvalid();
        points = player.score;
        fouls = player.fouls;
        if (
          !Number.isSafeInteger(totalPoints + points) ||
          !Number.isSafeInteger(totalFouls + fouls)
        )
          resultSourceInvalid();
        totalPoints += points;
        totalFouls += fouls;
        recorded++;
      } else teamOnly++;
      records.push({
        startsAt: sample.startsAt,
        matchId: m.id,
        record: {
          recordKey: createHash('sha256')
            .update(`${input.profileId}:${m.id}:${m.confirmation.id}`)
            .digest('hex')
            .slice(0, 32),
          eventName: sample.eventName,
          date: sample.date,
          format: sample.format,
          collectionMode: stats ? 'PLAYER_BASIC' : 'TEAM_ONLY',
          attributionComplete,
          points,
          fouls,
          source: 'INDEPENDENT_CONFIRMATION',
        },
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'RESULT_SOURCE_INVALID') throw error;
      invalid++;
    }
  }
  const truncated = input.truncated === true || input.samples.length > PERFORMANCE_SAMPLE_LIMIT;
  const partial = pending > 0 || invalid > 0 || teamOnly > 0 || partialAttribution > 0 || truncated;
  return {
    profileId: input.profileId,
    dataStatus:
      input.sourceCount === 0
        ? 'NO_AUTHORIZED_SOURCE'
        : invalid > 0 || truncated
          ? 'PARTIAL'
          : recorded === 0
            ? 'NO_PERSONAL_STATS'
            : partial
              ? 'PARTIAL'
              : 'AVAILABLE',
    sourceCount: input.sourceCount,
    recordedMatchCount: recorded,
    confirmedMatchCount: recorded + teamOnly,
    teamOnlyMatchCount: teamOnly,
    pendingMatchCount: pending,
    invalidMatchCount: invalid,
    partialAttributionMatchCount: partialAttribution,
    totalPoints: recorded ? totalPoints : null,
    totalFouls: recorded ? totalFouls : null,
    pointsPerRecordedMatch: recorded ? Number((totalPoints / recorded).toFixed(1)) : null,
    foulsPerRecordedMatch: recorded ? Number((totalFouls / recorded).toFixed(1)) : null,
    rebounds: null,
    assists: null,
    minutes: null,
    fieldGoalPercentage: null,
    completedServiceCount: input.completedServiceCount,
    sampleLimit: 1000,
    truncated,
    recentRecords: records
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || b.matchId.localeCompare(a.matchId))
      .slice(0, 5)
      .map((r) => r.record),
    denominatorNotice:
      '统计场次指本人进入该场冻结名单且存在当前有效独立确认的PLAYER_BASIC记录，包含真实记录为0的名单项，不代表实际出场次数。每场记录得分/犯规仅以这些统计场次为分母。',
    completenessNotice:
      input.sourceCount === 0
        ? '尚无经主办方提名及本人同意的有效公开来源。未授权或未统计不代表球员能力差。'
        : `${recorded}场有个人记录，${teamOnly}场仅球队统计，${pending}场尚无有效确认，${invalid}场来源暂无法核验，${partialAttribution}场本队仍有未归属得分或犯规，个人记录可能不完整。${truncated ? '当前仅展示最新1000项已授权比赛样本。' : ''}助攻、篮板、时间和命中率尚未采集；完成服务记录不代表付费成交。`,
    asOf: input.asOf,
  };
}

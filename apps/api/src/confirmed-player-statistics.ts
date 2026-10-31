import { isDeepStrictEqual } from 'node:util';
import type { MatchPlayerStatistics } from '@small-city-basketball/contracts';
import { professionalStatisticsDto } from './professional-statistics.js';
import { playerStatisticsDto } from './player-statistics.js';
import { confirmedResult, resultSourceInvalid } from './standings-domain.js';
import type { ResultRow } from './standings-domain.js';

/** Validate the current confirmation; never use an earlier confirmation after reopening. */
export function confirmedPlayerStatistics(match: ResultRow): MatchPlayerStatistics | null {
  if (!confirmedResult(match)) return null;
  const state = match.state;
  const confirmation = match.confirmation;
  if (state.collection_mode !== confirmation.collection_mode) resultSourceInvalid();
  const technical = state.technical_collection === undefined ? false : state.technical_collection;
  const confirmedTechnical =
    confirmation.technical_collection === undefined ? false : confirmation.technical_collection;
  if (
    (technical !== true && technical !== false) ||
    (confirmedTechnical !== true && confirmedTechnical !== false) ||
    technical !== confirmedTechnical ||
    !isDeepStrictEqual(state.professional_stats ?? null, confirmation.professional_stats ?? null)
  )
    resultSourceInvalid();

  if (state.collection_mode === 'TEAM_ONLY') {
    if (
      state.player_stats !== null ||
      confirmation.player_stats !== null ||
      technical ||
      state.professional_stats != null ||
      confirmation.professional_stats != null
    )
      resultSourceInvalid();
    return null;
  }
  if (
    state.collection_mode !== 'PLAYER_BASIC' ||
    !isDeepStrictEqual(state.player_stats, confirmation.player_stats)
  )
    resultSourceInvalid();
  let stats: MatchPlayerStatistics | null;
  try {
    stats = playerStatisticsDto(confirmation.player_stats);
  } catch {
    return resultSourceInvalid();
  }
  // Stored sources must also have the exact C02 shape, while the returned value is rebuilt.
  if (!stats || !isDeepStrictEqual(stats, confirmation.player_stats)) resultSourceInvalid();
  if (technical) {
    let professional;
    try {
      professional = professionalStatisticsDto(confirmation.professional_stats);
    } catch {
      return resultSourceInvalid();
    }
    if (!professional || !isDeepStrictEqual(professional, confirmation.professional_stats))
      resultSourceInvalid();
    for (const side of ['home', 'away'] as const) {
      if (
        stats[side].unassigned.score !== 0 ||
        stats[side].players.length !== professional[side].players.length
      )
        resultSourceInvalid();
      for (const player of stats[side].players) {
        const p = professional[side].players.find((p) => p.memberId === player.memberId);
        if (
          !p ||
          p.name !== player.name ||
          p.jerseyNo !== player.jerseyNo ||
          p.fieldGoalsMade * 2 + p.threePointersMade + p.freeThrowsMade !== player.score
        )
          resultSourceInvalid();
      }
    }
  } else if (state.professional_stats != null || confirmation.professional_stats != null)
    resultSourceInvalid();
  for (const side of ['home', 'away'] as const)
    for (const field of ['score', 'fouls'] as const) {
      const total = stats[side].players.reduce(
        (sum, player) => sum + player[field],
        stats[side].unassigned[field],
      );
      if (
        !Number.isSafeInteger(total) ||
        !Number.isSafeInteger(confirmation[`${side}_${field}`]) ||
        total !== confirmation[`${side}_${field}`]
      )
        resultSourceInvalid();
    }
  return stats;
}

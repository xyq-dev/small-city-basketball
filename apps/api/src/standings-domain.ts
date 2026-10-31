import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  STANDINGS_ALGORITHM_VERSION,
  STANDINGS_TIEBREAKERS,
} from '@small-city-basketball/contracts';
import type {
  StandingsData,
  StandingsRow,
  StandingsRules,
  StandingsRulesetData,
  StandingsTiebreaker,
} from '@small-city-basketball/contracts';
import { administrativeResult } from './match-exception-domain.js';
import { ApiError } from './errors.js';
import { invalid, objectInput } from './validation.js';
export type ResultRow = Record<string, any>;
export interface StandingParticipant {
  entryId: string;
  teamId: string;
  teamName: string;
}
export interface ConfirmedResult {
  matchId: string;
  confirmationId: string;
  sourceMatchVersion: number;
  lastEventSeq: number;
  homeEntryId: string;
  awayEntryId: string;
  homeScore: number;
  awayScore: number;
}
export function resultSourceInvalid(): never {
  throw new ApiError(409, 'RESULT_SOURCE_INVALID', '赛果来源暂时无法核验，请稍后重试');
}
export function parseStandingsRules(raw: unknown): StandingsRules {
  const i = objectInput(raw, ['winPoints', 'lossPoints', 'drawPoints', 'tiebreakers']);
  for (const field of ['winPoints', 'lossPoints', 'drawPoints'])
    if (!Number.isInteger(i[field]) || Number(i[field]) < 0 || Number(i[field]) > 1000)
      invalid('积分须为0至1000的整数', { [field]: '请显式填写0至1000整数' });
  if (
    !Array.isArray(i.tiebreakers) ||
    i.tiebreakers.length > 3 ||
    i.tiebreakers.some((v) => !(STANDINGS_TIEBREAKERS as readonly unknown[]).includes(v)) ||
    new Set(i.tiebreakers).size !== i.tiebreakers.length
  )
    invalid('请显式选择不重复的已支持排序项，可为空');
  return {
    winPoints: i.winPoints as number,
    lossPoints: i.lossPoints as number,
    drawPoints: i.drawPoints as number,
    tiebreakers: [...i.tiebreakers] as StandingsTiebreaker[],
  };
}
export function confirmedResult(m: ResultRow): ConfirmedResult | null {
  if (m.status !== 'FINAL') return null;
  const s = m.state,
    c = m.confirmation,
    e = m.last_event,
    r = m.last_command,
    rules = m.scoring_rules;
  if (
    !s ||
    !c ||
    !e ||
    !r ||
    !rules ||
    s.requires_reconfirmation !== false ||
    s.clock_running !== false ||
    s.remaining_ms !== 0 ||
    !Number.isInteger(rules.regulation_periods) ||
    s.period < rules.regulation_periods ||
    s.source_version !== m.version ||
    s.latest_confirmation_id !== c.id ||
    c.match_id !== m.id ||
    s.ruleset_id !== c.ruleset_id ||
    rules.id !== c.ruleset_id ||
    rules.version !== c.ruleset_version ||
    s.last_event_seq !== c.last_event_seq + 1 ||
    e.seq !== s.last_event_seq ||
    e.type !== 'CONFIRM_RESULT' ||
    e.actor_id !== c.confirming_user_id ||
    e.target_event_id !== null ||
    !e.payload ||
    Object.keys(e.payload).length !== 0 ||
    r.command_id !== e.command_id ||
    r.actor_id !== c.confirming_user_id ||
    r.command_type !== 'CONFIRM_RESULT' ||
    r.applied_version !== c.source_match_version + 1 ||
    r.applied_version > m.version ||
    r.first_event_seq !== e.seq ||
    r.last_event_seq !== e.seq ||
    !Array.isArray(c.period_stats) ||
    !isDeepStrictEqual(s.period_stats, c.period_stats)
  )
    resultSourceInvalid();
  for (const field of [
    'home_score',
    'away_score',
    'home_fouls',
    'away_fouls',
    'home_timeouts',
    'away_timeouts',
  ])
    if (!Number.isInteger(c[field]) || c[field] < 0 || s[field] !== c[field]) resultSourceInvalid();
  if (!Number.isInteger(s.period) || s.period < 1 || c.period_stats.length !== s.period)
    resultSourceInvalid();
  const sum = {
    home_score: 0,
    away_score: 0,
    home_fouls: 0,
    away_fouls: 0,
    home_timeouts: 0,
    away_timeouts: 0,
  };
  for (let i = 0; i < c.period_stats.length; i++) {
    const period = c.period_stats[i];
    if (!period || period.period !== i + 1) resultSourceInvalid();
    for (const side of ['home', 'away'] as const)
      for (const field of ['score', 'fouls', 'timeouts'] as const) {
        const value = period[side]?.[field];
        if (!Number.isInteger(value) || value < 0) resultSourceInvalid();
        sum[`${side}_${field}`] += value;
      }
  }
  for (const field of Object.keys(sum) as (keyof typeof sum)[])
    if (sum[field] !== c[field]) resultSourceInvalid();
  if (rules.tie_policy === 'OVERTIME' && c.home_score === c.away_score) resultSourceInvalid();
  return {
    matchId: m.id,
    confirmationId: c.id,
    sourceMatchVersion: c.source_match_version,
    lastEventSeq: c.last_event_seq,
    homeEntryId: m.home_entry_id,
    awayEntryId: m.away_entry_id,
    homeScore: c.home_score,
    awayScore: c.away_score,
  };
}
export function calculateStandings(input: {
  participants: StandingParticipant[];
  matches: ResultRow[];
  rules: StandingsRulesetData;
  publicationId: string;
  asOf: string;
  mode: StandingsData['mode'];
  format?: 'ROUND_ROBIN' | 'DOUBLE_ROUND_ROBIN';
}): StandingsData {
  const { participants, matches, rules } = input;
  parseStandingsRules({
    winPoints: rules.winPoints,
    lossPoints: rules.lossPoints,
    drawPoints: rules.drawPoints,
    tiebreakers: rules.tiebreakers,
  });
  if (
    participants.length < 2 ||
    participants.length > 32 ||
    new Set(participants.map((p) => p.entryId)).size !== participants.length ||
    new Set(participants.map((p) => p.teamId)).size !== participants.length ||
    matches.length !==
      (participants.length * (participants.length - 1)) /
        (input.format === 'DOUBLE_ROUND_ROBIN' ? 1 : 2)
  )
    resultSourceInvalid();
  const rows: StandingsRow[] = participants.map((p) => ({
    ...p,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    scoreDifference: 0,
    leaguePoints: 0,
    rank: null,
    tied: false,
  }));
  const byId = new Map(rows.map((r) => [r.entryId, r]));
  const results: ConfirmedResult[] = [];
  const administrative: unknown[] = [];
  let adjudicated = 0,
    cancelled = 0;
  const pairs = new Set<string>();
  const matchIds = new Set<string>();
  for (const m of matches) {
    if (matchIds.has(m.id)) resultSourceInvalid();
    matchIds.add(m.id);
    const home = byId.get(m.home_entry_id),
      away = byId.get(m.away_entry_id);
    if (!home || !away || home === away) resultSourceInvalid();
    const pair = (
      input.format === 'DOUBLE_ROUND_ROBIN'
        ? [m.home_entry_id, m.away_entry_id]
        : [m.home_entry_id, m.away_entry_id].sort()
    ).join('|');
    if (pairs.has(pair)) resultSourceInvalid();
    pairs.add(pair);
    const admin = administrativeResult(m);
    if (admin) {
      administrative.push([
        m.id,
        admin.adjudicationId,
        admin.adjudicationVersion,
        admin.kind,
        admin.winnerEntryId,
        admin.loserEntryId,
        admin.homeLeaguePoints,
        admin.awayLeaguePoints,
      ]);
      if (admin.kind === 'CANCELLED') {
        cancelled++;
        continue;
      }
      adjudicated++;
      home.played++;
      away.played++;
      const win = admin.winnerEntryId === home.entryId ? home : away,
        loss = win === home ? away : home;
      win.wins++;
      loss.losses++;
      home.leaguePoints += admin.homeLeaguePoints!;
      away.leaguePoints += admin.awayLeaguePoints!;
      continue;
    }
    const result = confirmedResult(m);
    if (!result) continue;
    results.push(result);
    home.played++;
    away.played++;
    home.pointsFor += result.homeScore;
    home.pointsAgainst += result.awayScore;
    away.pointsFor += result.awayScore;
    away.pointsAgainst += result.homeScore;
    if (result.homeScore === result.awayScore) {
      home.draws++;
      away.draws++;
      home.leaguePoints += rules.drawPoints;
      away.leaguePoints += rules.drawPoints;
    } else {
      const win = result.homeScore > result.awayScore ? home : away;
      const loss = win === home ? away : home;
      win.wins++;
      loss.losses++;
      win.leaguePoints += rules.winPoints;
      loss.leaguePoints += rules.lossPoints;
    }
  }
  for (const row of rows) row.scoreDifference = row.pointsFor - row.pointsAgainst;
  const fields = {
    SCORE_DIFFERENCE: 'scoreDifference',
    POINTS_FOR: 'pointsFor',
    WINS: 'wins',
  } as const;
  const compare = (a: StandingsRow, b: StandingsRow) => {
    let d = b.leaguePoints - a.leaguePoints;
    for (const key of rules.tiebreakers) if (!d) d = b[fields[key]] - a[fields[key]];
    return d;
  };
  rows.sort(compare);
  if (results.length + adjudicated + cancelled) {
    for (let start = 0; start < rows.length;) {
      let end = start + 1;
      while (end < rows.length && compare(rows[start]!, rows[end]!) === 0) end++;
      for (let i = start; i < end; i++) {
        rows[i]!.rank = start + 1;
        rows[i]!.tied = end - start > 1;
      }
      start = end;
    }
  }
  const canonical = {
    algorithmVersion: STANDINGS_ALGORITHM_VERSION,
    publicationId: input.publicationId,
    rulesetId: rules.id,
    rulesetVersion: rules.version,
    rules: parseStandingsRules({
      winPoints: rules.winPoints,
      lossPoints: rules.lossPoints,
      drawPoints: rules.drawPoints,
      tiebreakers: rules.tiebreakers,
    }),
    ...(input.format === 'DOUBLE_ROUND_ROBIN' ? { format: input.format } : {}),
    ...(administrative.length
      ? {
          administrative: administrative.sort((a: any, b: any) =>
            String(a[0]).localeCompare(String(b[0])),
          ),
        }
      : {}),
    participants: participants.map((p) => [p.entryId, p.teamId, p.teamName]),
    results: results
      .sort((a, b) => (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0))
      .map((r) => [
        r.matchId,
        r.confirmationId,
        r.sourceMatchVersion,
        r.lastEventSeq,
        r.homeEntryId,
        r.awayEntryId,
        r.homeScore,
        r.awayScore,
      ]),
  };
  return {
    mode: input.mode,
    rulesetVersion: rules.version,
    sourceHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    asOf: input.asOf,
    confirmedMatchCount: results.length,
    totalMatchCount: matches.length,
    isComplete: matches.length > 0 && results.length + adjudicated + cancelled === matches.length,
    ...(administrative.length
      ? {
          resolvedMatchCount: results.length + adjudicated + cancelled,
          adjudicatedMatchCount: adjudicated,
          cancelledMatchCount: cancelled,
        }
      : {}),
    hasSharedRanks: rows.some((r) => r.tied),
    rows,
  };
}

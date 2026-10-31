import { administrativeResult } from './match-exception-domain.js';
import { createHash } from 'node:crypto';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import type {
  EventPlayerStatisticsData,
  EventPlayerStatisticsRow,
  MatchPlayerRoster,
  EventFormat,
  RegistrationFreezeData,
  SchedulePolicy,
  KnockoutSource,
} from '@small-city-basketball/contracts';
import { calculateGroupKnockout } from './group-knockout-domain.js';
import type {
  GroupKnockoutConfig,
  GroupTieDrawData,
  GroupQualificationProof,
  StandingsRulesetData,
} from '@small-city-basketball/contracts';
import { calculateKnockout } from './knockout-domain.js';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';
import { resultSourceInvalid } from './standings-domain.js';
import type { ResultRow } from './standings-domain.js';

type Summary = NonNullable<EventPlayerStatisticsData['summary']>;
interface Participant {
  entryId: string;
  teamId: string;
  teamName: string;
  rosterRevisionId: string;
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function add(a: number, b: number) {
  const value = a + b;
  if (!Number.isSafeInteger(value) || value < 0) resultSourceInvalid();
  return value;
}
function participants(source: unknown): Participant[] {
  const entries = (source as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 32) resultSourceInvalid();
  const rows = entries.map((entry): Participant => {
    if (
      !entry ||
      !uuid(entry.entryId) ||
      !uuid(entry.teamId) ||
      !uuid(entry.rosterRevisionId) ||
      typeof entry.teamName !== 'string' ||
      !entry.teamName.trim()
    )
      resultSourceInvalid();
    return {
      entryId: entry.entryId,
      teamId: entry.teamId,
      teamName: entry.teamName,
      rosterRevisionId: entry.rosterRevisionId,
    };
  });
  if (
    new Set(rows.map((r) => r.entryId)).size !== rows.length ||
    new Set(rows.map((r) => r.teamId)).size !== rows.length
  )
    resultSourceInvalid();
  return rows.sort((a, b) => compareId(a.entryId, b.entryId));
}
function roster(raw: unknown): MatchPlayerRoster['home'] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 60) resultSourceInvalid();
  const rows = raw.map((p) => {
    if (
      !p ||
      !uuid(p.memberId) ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      Array.from(p.name).length > 80 ||
      p.name.includes('\u0000') ||
      typeof p.jerseyNo !== 'string' ||
      !/^(?:0|00|[1-9][0-9]?)$/.test(p.jerseyNo)
    )
      resultSourceInvalid();
    return { memberId: p.memberId, name: p.name, jerseyNo: p.jerseyNo };
  });
  if (new Set(rows.map((p) => p.memberId)).size !== rows.length) resultSourceInvalid();
  return rows.sort((a, b) => compareId(a.memberId, b.memberId));
}

/** A private projection of effective confirmations, with no new writable statistics state. */
export function calculateEventPlayerStatistics(input: {
  publicationId: string;
  source: unknown;
  matches: ResultRow[];
  asOf: string;
  format?: EventFormat;
  seed?: string;
  policy?: SchedulePolicy;
  roundPublications?: { roundNo: number; sources: KnockoutSource[] }[];
  groupConfig?: GroupKnockoutConfig;
  groupRules?: StandingsRulesetData;
  groupDraws?: GroupTieDrawData[];
  groupQualification?: GroupQualificationProof | null;
}): Summary {
  if (!uuid(input.publicationId)) resultSourceInvalid();
  const entrants = participants(input.source);
  const group = input.format === 'GROUP_KNOCKOUT';
  const competition = group
    ? calculateGroupKnockout({
        publicationId: input.publicationId,
        source: input.source as RegistrationFreezeData,
        seed: input.seed!,
        policy: input.policy!,
        config: input.groupConfig!,
        rules: input.groupRules!,
        matches: input.matches,
        asOf: input.asOf,
        draws: input.groupDraws,
        qualification: input.groupQualification,
        roundPublications: input.roundPublications,
      })
    : null;
  const doubleRoundRobin = String(input.format) === 'DOUBLE_ROUND_ROBIN';
  const knockout = input.format === 'SINGLE_ELIMINATION';
  const bracket = knockout
    ? calculateKnockout({
        publicationId: input.publicationId,
        source: input.source as RegistrationFreezeData,
        seed: input.seed!,
        policy: input.policy!,
        roundPublications: input.roundPublications,
        matches: input.matches,
        asOf: input.asOf,
      })
    : null;
  const totalMatchCount = competition
    ? competition.totalMatchCount
    : knockout
      ? bracket!.totalMatchCount
      : (entrants.length * (entrants.length - 1)) / (doubleRoundRobin ? 1 : 2);
  if (!knockout && !group && input.matches.length !== totalMatchCount) resultSourceInvalid();
  if (
    input.format &&
    !['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(
      input.format,
    )
  )
    resultSourceInvalid();
  const byEntry = new Map(entrants.map((p) => [p.entryId, p]));
  const teams: Summary['teams'] = entrants.map((p) => ({
    entryId: p.entryId,
    teamName: p.teamName,
    attributedScore: 0,
    unassignedScore: 0,
    attributedFouls: 0,
    unassignedFouls: 0,
  }));
  const byTeam = new Map(teams.map((p) => [p.entryId, p]));
  const rows = new Map<string, EventPlayerStatisticsRow>();
  const rosterSources = new Map<string, string>();
  const matchIds = new Set<string>();
  const pairs = new Set<string>();
  const sources: unknown[] = [];
  let included = 0;
  let teamOnly = 0;
  let excludedAdministrative = 0;
  // Unmaterialized knockout rounds still belong to the complete event's coverage denominator.
  let pending = totalMatchCount - input.matches.length;
  const matches = [...input.matches].sort((a, b) => compareId(a.id, b.id));
  for (const m of matches) {
    if (
      !uuid(m.id) ||
      matchIds.has(m.id) ||
      !(MATCH_STATUSES as readonly unknown[]).includes(m.status)
    )
      resultSourceInvalid();
    matchIds.add(m.id);
    const home = byEntry.get(m.home_entry_id);
    const away = byEntry.get(m.away_entry_id);
    if (!home || !away || home === away) resultSourceInvalid();
    const pair = doubleRoundRobin
      ? [home.entryId, away.entryId].join('|')
      : [home.entryId, away.entryId].sort().join('|');
    if (!group && pairs.has(pair)) resultSourceInvalid();
    pairs.add(pair);
    const administration = administrativeResult(m);
    const stats = administration ? null : confirmedPlayerStatistics(m);
    const fixed: MatchPlayerRoster = { home: roster(m.home_roster), away: roster(m.away_roster) };
    if (
      new Set([...fixed.home, ...fixed.away].map((p) => p.memberId)).size !==
      fixed.home.length + fixed.away.length
    )
      resultSourceInvalid();
    for (const side of ['home', 'away'] as const) {
      const participant = side === 'home' ? home : away;
      if (
        m[`${side}_team_id`] !== participant.teamId ||
        m[`${side}_team_name`] !== participant.teamName ||
        m[`${side}_roster_revision_id`] !== participant.rosterRevisionId
      )
        resultSourceInvalid();
      const key = `${participant.entryId}|${participant.rosterRevisionId}`;
      const canonicalRoster = JSON.stringify(fixed[side]);
      const previous = rosterSources.get(key);
      if (previous !== undefined && previous !== canonicalRoster) resultSourceInvalid();
      rosterSources.set(key, canonicalRoster);
      if (!stats) continue;
      const players = new Map(stats[side].players.map((p) => [p.memberId, p]));
      if (players.size !== fixed[side].length) resultSourceInvalid();
      const team = byTeam.get(participant.entryId)!;
      team.unassignedScore = add(team.unassignedScore, stats[side].unassigned.score);
      team.unassignedFouls = add(team.unassignedFouls, stats[side].unassigned.fouls);
      for (const frozen of fixed[side]) {
        const player = players.get(frozen.memberId);
        if (!player || player.name !== frozen.name || player.jerseyNo !== frozen.jerseyNo)
          resultSourceInvalid();
        const rowKey = `${key}|${frozen.memberId}`;
        const row = rows.get(rowKey) ?? {
          entryId: participant.entryId,
          rosterRevisionId: participant.rosterRevisionId,
          memberId: frozen.memberId,
          teamName: participant.teamName,
          name: frozen.name,
          jerseyNo: frozen.jerseyNo,
          score: 0,
          fouls: 0,
          rosterSampleMatchCount: 0,
          rank: 0,
          tied: false,
        };
        row.score = add(row.score, player.score);
        row.fouls = add(row.fouls, player.fouls);
        row.rosterSampleMatchCount = add(row.rosterSampleMatchCount, 1);
        rows.set(rowKey, row);
        team.attributedScore = add(team.attributedScore, player.score);
        team.attributedFouls = add(team.attributedFouls, player.fouls);
      }
    }
    if (administration) excludedAdministrative++;
    else if (stats) included++;
    else if (m.status === 'FINAL') teamOnly++;
    else pending++;
    // Live score/clock changes do not alter a confirmed-only source. Reconfirmation does.
    sources.push({
      matchId: m.id,
      homeEntryId: home.entryId,
      awayEntryId: away.entryId,
      coverage: administration
        ? administration.kind
        : stats
          ? 'PLAYER_BASIC'
          : m.status === 'FINAL'
            ? 'TEAM_ONLY'
            : 'PENDING',
      ...(administration ? { administration } : {}),
      confirmation:
        m.status === 'FINAL'
          ? {
              id: m.confirmation.id,
              sourceMatchVersion: m.confirmation.source_match_version,
              lastEventSeq: m.confirmation.last_event_seq,
            }
          : null,
      statistics: stats
        ? {
            mode: stats.mode,
            home: {
              players: [...stats.home.players].sort((a, b) => compareId(a.memberId, b.memberId)),
              unassigned: stats.home.unassigned,
            },
            away: {
              players: [...stats.away.players].sort((a, b) => compareId(a.memberId, b.memberId)),
              unassigned: stats.away.unassigned,
            },
          }
        : null,
    });
  }
  const ranked = [...rows.values()].sort(
    (a, b) =>
      b.score - a.score ||
      compareId(a.entryId, b.entryId) ||
      compareId(a.rosterRevisionId, b.rosterRevisionId) ||
      Number(a.jerseyNo) - Number(b.jerseyNo) ||
      compareId(a.jerseyNo, b.jerseyNo) ||
      compareId(a.memberId, b.memberId),
  );
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && ranked[end]!.score === ranked[start]!.score) end++;
    for (let i = start; i < end; i++) {
      ranked[i]!.rank = start + 1;
      ranked[i]!.tied = end - start > 1;
    }
    start = end;
  }
  const algorithmVersion = 'EVENT_PLAYER_BASIC_V1';
  const canonical = {
    algorithmVersion,
    publicationId: input.publicationId,
    participants: entrants,
    rosters: [...rosterSources].sort(([a], [b]) => compareId(a, b)),
    matches: sources,
    ...(doubleRoundRobin ? { format: 'DOUBLE_ROUND_ROBIN', totalMatchCount } : {}),
    ...(competition
      ? {
          format: 'GROUP_KNOCKOUT',
          competitionAlgorithmVersion: competition.algorithmVersion,
          totalMatchCount,
        }
      : {}),
    ...(bracket
      ? { format: input.format, bracketAlgorithmVersion: bracket.algorithmVersion, totalMatchCount }
      : {}),
  };
  return {
    algorithmVersion,
    sourceHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    asOf: input.asOf,
    totalMatchCount,
    includedMatchCount: included,
    teamOnlyConfirmedMatchCount: teamOnly,
    pendingMatchCount: pending,
    ...(excludedAdministrative
      ? {
          excludedAdministrativeMatchCount: excludedAdministrative,
          recordableMatchCount: totalMatchCount - excludedAdministrative,
        }
      : {}),
    coverageComplete:
      totalMatchCount - excludedAdministrative > 0 &&
      included === totalMatchCount - excludedAdministrative,
    attributionComplete:
      included > 0 && teams.every((t) => !t.unassignedScore && !t.unassignedFouls),
    rows: ranked,
    teams,
  };
}

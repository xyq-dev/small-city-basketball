import { administrativeResult } from './match-exception-domain.js';
import type { GroupResultSource } from '../../../packages/contracts/match-exceptions.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  RegistrationFreezeData,
  SchedulePolicy,
  ScheduleFixtureData,
  StandingsRulesetData,
  KnockoutSource,
  KnockoutBracket,
} from '@small-city-basketball/contracts';
import type {
  GroupKnockoutConfig,
  GroupKnockoutProjection,
  GroupTieDrawData,
  GroupQualificationProof,
} from '@small-city-basketball/contracts';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import { invalid, objectInput, resourceId } from './validation.js';
import { canonicalFreeze, generatePairings, parseSchedulePolicy } from './scheduling-domain.js';
import {
  canonicalKnockoutSources,
  calculateKnockout,
  generateKnockoutPairings,
} from './knockout-domain.js';
import { calculateStandings, confirmedResult, resultSourceInvalid } from './standings-domain.js';
import type { ResultRow } from './standings-domain.js';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';

const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key = (r: number, p: number) => `R${r}-P${p}`;
const canonicalSources = (sources: GroupResultSource[]): GroupResultSource[] =>
  sources
    .map((s) => {
      if ('kind' in s && s.kind === 'CANCELLATION') {
        if (
          Object.keys(s).sort().join('|') !==
            [
              'kind',
              'fixtureKey',
              'matchId',
              'adjudicationId',
              'adjudicationVersion',
              'matchVersion',
              'winnerEntryId',
              'loserEntryId',
            ]
              .sort()
              .join('|') ||
          s.winnerEntryId !== null ||
          s.loserEntryId !== null ||
          s.adjudicationVersion !== 2 ||
          !Number.isInteger(s.matchVersion) ||
          s.matchVersion < 1
        )
          resultSourceInvalid();
        return {
          kind: 'CANCELLATION' as const,
          fixtureKey: s.fixtureKey,
          matchId: s.matchId,
          adjudicationId: s.adjudicationId,
          adjudicationVersion: s.adjudicationVersion,
          matchVersion: s.matchVersion,
          winnerEntryId: null,
          loserEntryId: null,
        };
      }
      return canonicalKnockoutSources([s as KnockoutSource])[0]!;
    })
    .sort((a, b) => ascii(a.fixtureKey, b.fixtureKey));
export function parseGroupConfig(
  freeze: RegistrationFreezeData,
  raw: unknown,
): GroupKnockoutConfig {
  const input = objectInput(raw, ['groupCount', 'seededEntryIds']);
  if (![2, 4, 8].includes(Number(input.groupCount)) || !Number.isInteger(input.groupCount))
    invalid('分组数须为2、4或8');
  const groupCount = input.groupCount as 2 | 4 | 8;
  const seeded = input.seededEntryIds;
  if (
    !Array.isArray(seeded) ||
    seeded.length > groupCount ||
    seeded.some((id) => typeof id !== 'string')
  )
    invalid('种子队数量不能超过组数');
  const seededEntryIds = (seeded as string[]).map(resourceId);
  const entries = new Set(freeze.entries.map((e) => e.entryId));
  if (
    freeze.entries.length < groupCount * 2 ||
    freeze.entries.length > 32 ||
    new Set(seededEntryIds).size !== seededEntryIds.length ||
    seededEntryIds.some((id) => !entries.has(id))
  )
    invalid('每组至少2队，种子队须为不重复冻结球队');
  return { groupCount, seededEntryIds: [...seededEntryIds].sort(ascii) };
}
export function groupTieOrder(seed: string, tiedEntryIds: string[]): string[] {
  if (
    !/^[0-9a-f]{64}$/.test(seed) ||
    tiedEntryIds.length < 2 ||
    new Set(tiedEntryIds).size !== tiedEntryIds.length
  )
    invalid('同分抽签来源无效');
  return [...tiedEntryIds].sort((a, b) => ascii(hash([seed, a]), hash([seed, b])) || ascii(a, b));
}
export function generateGroupPairings(
  freeze: RegistrationFreezeData,
  policy: SchedulePolicy,
  seed: string,
  raw: unknown,
) {
  const source = canonicalFreeze(freeze),
    config = parseGroupConfig(source, raw),
    normalizedPolicy = parseSchedulePolicy(policy);
  generateKnockoutPairings(source, normalizedPolicy, seed); // shared strict frozen-source validation
  const seeded = new Set(config.seededEntryIds);
  const ranked = (ids: string[]) =>
    ids.sort((a, b) => ascii(hash([seed, a]), hash([seed, b])) || ascii(a, b));
  const orderedEntryIds = [
    ...ranked([...seeded]),
    ...ranked(source.entries.map((e) => e.entryId).filter((id) => !seeded.has(id))),
  ];
  const groups = Array.from({ length: config.groupCount }, (_, i) => ({
    groupKey: String.fromCharCode(65 + i),
    entryIds: [] as string[],
  }));
  orderedEntryIds.forEach((id, i) => {
    const band = Math.floor(i / config.groupCount),
      col = i % config.groupCount;
    groups[band % 2 ? config.groupCount - 1 - col : col]!.entryIds.push(id);
  });
  const stride = Math.ceil(Math.max(...groups.map((g) => g.entryIds.length)) / 2);
  const fixtures: ScheduleFixtureData[] = [];
  const roundByes = new Map<number, string[]>();
  let groupRoundCount = 0;
  groups.forEach((g, i) => {
    const entries = source.entries.filter((e) => g.entryIds.includes(e.entryId));
    const rr = generatePairings({ ...source, entries }, normalizedPolicy, hash([seed, g.groupKey]));
    groupRoundCount = Math.max(groupRoundCount, rr.rounds.length);
    for (const r of rr.rounds)
      if (r.byeEntryId)
        roundByes.set(r.roundNo, [...(roundByes.get(r.roundNo) ?? []), r.byeEntryId]);
    for (const f of rr.fixtures) {
      const positionNo = i * stride + f.positionNo;
      fixtures.push({ ...f, positionNo, fixtureKey: key(f.roundNo, positionNo) });
    }
  });
  fixtures.sort((a, b) => a.roundNo - b.roundNo || a.positionNo - b.positionNo);
  const rounds = Array.from({ length: groupRoundCount }, (_, i) => ({
    roundNo: i + 1,
    byeEntryId: null,
    byeEntryIds: roundByes.get(i + 1) ?? [],
  }));
  return {
    inputHash: hash({
      algorithmVersion: 'GK_BALANCED_V1',
      freeze: source,
      policy: normalizedPolicy,
      config,
    }),
    pairingHash: hash({
      algorithmVersion: 'GK_BALANCED_V1',
      seed,
      groups,
      orderedEntryIds,
      rounds,
      fixtures,
    }),
    orderedEntryIds,
    fixtures,
    rounds,
    groups,
    groupRoundCount,
    config,
  };
}
function shiftKey(value: string, delta: number) {
  const m = /^R(\d+)-P(\d+)$/.exec(value);
  if (!m) return resultSourceInvalid();
  return key(Number(m[1]) + delta, Number(m[2]));
}
function fixedBracket(input: {
  publicationId: string;
  source: RegistrationFreezeData;
  seed: string;
  policy: SchedulePolicy;
  seats: string[];
  offset: number;
  matches: ResultRow[];
  asOf: string;
  roundPublications: { roundNo: number; sources: GroupResultSource[] }[];
}): KnockoutBracket {
  const toLocal = (s: KnockoutSource) => ({
    ...s,
    fixtureKey: shiftKey(s.fixtureKey, -input.offset),
  });
  const bracket = calculateKnockout({
    publicationId: input.publicationId,
    source: {
      ...input.source,
      entries: input.source.entries.filter((e) => input.seats.includes(e.entryId)),
    },
    seed: input.seed,
    policy: input.policy,
    fixedSeats: input.seats,
    matches: input.matches.map((m) => ({
      ...m,
      fixture_key: shiftKey(m.fixture_key, -input.offset),
      round_no: m.round_no - input.offset,
    })),
    asOf: input.asOf,
    roundPublications: input.roundPublications.map((p) => ({
      roundNo: p.roundNo - input.offset,
      sources: p.sources.map(toLocal),
    })),
  });
  const globalSource = (s: KnockoutSource) => ({
    ...s,
    fixtureKey: shiftKey(s.fixtureKey, input.offset),
  });
  return {
    ...bracket,
    rounds: bracket.rounds.map((r) => ({
      ...r,
      roundNo: r.roundNo + input.offset,
      slots: r.slots.map((s) => ({
        ...s,
        roundNo: s.roundNo + input.offset,
        fixtureKey: shiftKey(s.fixtureKey, input.offset),
        homeSource: s.homeSource ? shiftKey(s.homeSource, input.offset) : null,
        awaySource: s.awaySource ? shiftKey(s.awaySource, input.offset) : null,
      })),
    })),
    nextRound: bracket.nextRound
      ? {
          ...bracket.nextRound,
          roundNo: bracket.nextRound.roundNo + input.offset,
          sources: bracket.nextRound.sources.map(globalSource),
          fixtures: bracket.nextRound.fixtures.map((f) => ({
            ...f,
            roundNo: f.roundNo + input.offset,
            fixtureKey: shiftKey(f.fixtureKey, input.offset),
          })),
        }
      : null,
  };
}
export function calculateGroupKnockout(input: {
  publicationId: string;
  source: RegistrationFreezeData;
  seed: string;
  policy: SchedulePolicy;
  config: GroupKnockoutConfig;
  rules: StandingsRulesetData;
  matches: ResultRow[];
  asOf: string;
  draws?: GroupTieDrawData[];
  qualification?: GroupQualificationProof | null;
  roundPublications?: { roundNo: number; sources: GroupResultSource[] }[];
}): GroupKnockoutProjection {
  let draw: ReturnType<typeof generateGroupPairings>;
  try {
    draw = generateGroupPairings(input.source, input.policy, input.seed, input.config);
  } catch {
    return resultSourceInvalid();
  }
  if (!input.rules || input.rules.eventId !== input.source.eventId) resultSourceInvalid();
  const expected = new Map(draw.fixtures.map((f) => [f.fixtureKey, f]));
  const entrants = new Map(input.source.entries.map((e) => [e.entryId, e]));
  const groupMatches = input.matches.filter((m) => m.round_no <= draw.groupRoundCount),
    elimination = input.matches.filter((m) => m.round_no > draw.groupRoundCount);
  if (
    groupMatches.length !== expected.size ||
    new Set(input.matches.map((m) => m.id)).size !== input.matches.length ||
    new Set(input.matches.map((m) => m.fixture_key)).size !== input.matches.length ||
    new Set(input.matches.map((m) => m.revision_id)).size !== 1
  )
    resultSourceInvalid();
  const sources: GroupResultSource[] = [];
  for (const m of groupMatches) {
    const f = expected.get(m.fixture_key);
    if (
      !f ||
      f.roundNo !== m.round_no ||
      f.positionNo !== m.position_no ||
      f.homeEntryId !== m.home_entry_id ||
      f.awayEntryId !== m.away_entry_id ||
      m.event_id !== input.source.eventId ||
      m.publication_id !== input.publicationId
    )
      resultSourceInvalid();
    if (
      !/^[0-9a-f-]{36}$/i.test(m.id) ||
      !Number.isInteger(m.version) ||
      m.version < 1 ||
      !(MATCH_STATUSES as readonly string[]).includes(m.status) ||
      !m.court_id ||
      typeof m.court_name !== 'string' ||
      !Number.isFinite(new Date(m.starts_at).getTime()) ||
      !Number.isFinite(new Date(m.ends_at).getTime()) ||
      new Date(m.starts_at) >= new Date(m.ends_at)
    )
      resultSourceInvalid();
    for (const side of ['home', 'away'] as const) {
      const frozen = entrants.get(m[`${side}_entry_id`]);
      if (
        !frozen ||
        m[`${side}_team_id`] !== frozen.teamId ||
        m[`${side}_team_name`] !== frozen.teamName ||
        m[`${side}_roster_revision_id`] !== frozen.rosterRevisionId
      )
        resultSourceInvalid();
    }
    if (m.state && m.scoring_rules?.tie_policy !== 'OVERTIME') resultSourceInvalid();
    const admin = administrativeResult(m);
    const result = admin ? null : confirmedResult(m),
      stats = admin ? null : confirmedPlayerStatistics(m);
    if (admin)
      sources.push(
        admin.source ?? {
          kind: 'CANCELLATION',
          fixtureKey: m.fixture_key,
          matchId: m.id,
          adjudicationId: admin.adjudicationId,
          adjudicationVersion: admin.adjudicationVersion,
          matchVersion: m.exception_request.source_match_version,
          winnerEntryId: null,
          loserEntryId: null,
        },
      );
    if (stats)
      for (const side of ['home', 'away'] as const) {
        const expectedPlayers = [...entrants.get(m[`${side}_entry_id`])!.players].sort((a, b) =>
          ascii(a.memberId, b.memberId),
        );
        const actual = stats[side].players
          .map(({ memberId, name, jerseyNo }) => ({ memberId, name, jerseyNo }))
          .sort((a, b) => ascii(a.memberId, b.memberId));
        if (!isDeepStrictEqual(expectedPlayers, actual)) resultSourceInvalid();
      }
    if (result) {
      if (result.homeScore === result.awayScore) resultSourceInvalid();
      sources.push({
        fixtureKey: m.fixture_key,
        matchId: m.id,
        confirmationId: result.confirmationId,
        matchVersion: result.sourceMatchVersion + 1,
        winnerEntryId: result.homeScore > result.awayScore ? m.home_entry_id : m.away_entry_id,
      });
    }
  }
  const usedDrawIds: string[] = [];
  const groups = draw.groups.map((g) => {
    const participants = g.entryIds.map((id) => {
      const { entryId, teamId, teamName, rosterRevisionId } = entrants.get(id)!;
      return { entryId, teamId, teamName, rosterRevisionId };
    });
    const standings = calculateStandings({
      participants,
      matches: groupMatches.filter((m) => g.entryIds.includes(m.home_entry_id)),
      rules: input.rules,
      publicationId: input.publicationId,
      asOf: input.asOf,
      mode: 'PUBLISHED',
    });
    let qualifiedEntryIds: string[] | null = null,
      unresolvedTieEntryIds: string[] = [],
      applied: GroupTieDrawData | null = null;
    if (standings.isComplete) {
      const topRanks = new Set(
        standings.rows
          .slice(0, 2)
          .filter((r) => r.tied)
          .map((r) => r.rank),
      );
      const tied = standings.rows
        .filter((r) => topRanks.has(r.rank))
        .map((r) => r.entryId)
        .sort(ascii);
      const candidates = (input.draws ?? []).filter(
        (d) => d.groupKey === g.groupKey && d.sourceHash === standings.sourceHash,
      );
      if (candidates.length > 1) resultSourceInvalid();
      if (tied.length) {
        const candidate = candidates[0];
        if (candidate) {
          if (!/^[0-9a-f]{64}$/.test(candidate.seed)) resultSourceInvalid();
          if (
            !isDeepStrictEqual([...candidate.tiedEntryIds].sort(ascii), tied) ||
            !isDeepStrictEqual(candidate.orderedEntryIds, groupTieOrder(candidate.seed, tied))
          )
            resultSourceInvalid();
          applied = candidate;
          usedDrawIds.push(candidate.id);
        } else unresolvedTieEntryIds = tied;
      } else if (candidates.length) resultSourceInvalid();
      if (!unresolvedTieEntryIds.length) {
        const ordered = [...standings.rows];
        if (applied) {
          const order = new Map(applied.orderedEntryIds.map((id, i) => [id, i]));
          ordered.sort(
            (a, b) =>
              a.rank! - b.rank! || (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0),
          );
        }
        qualifiedEntryIds = ordered.slice(0, 2).map((r) => r.entryId);
      }
    }
    return {
      groupKey: g.groupKey,
      label: `${g.groupKey}组`,
      participants,
      standings,
      qualifiedEntryIds,
      unresolvedTieEntryIds,
      draw: applied,
    };
  });
  const allComplete = groups.every((g) => g.standings.isComplete),
    ready = allComplete && groups.every((g) => !!g.qualifiedEntryIds);
  const slots: string[] = [];
  if (ready) {
    for (let i = 0; i < groups.length; i += 2)
      slots.push(groups[i]!.qualifiedEntryIds![0]!, groups[i + 1]!.qualifiedEntryIds![1]!);
    for (let i = 0; i < groups.length; i += 2)
      slots.push(groups[i + 1]!.qualifiedEntryIds![0]!, groups[i]!.qualifiedEntryIds![1]!);
  }
  const qualificationHash = hash({
    algorithmVersion: 'GK_BALANCED_V1',
    publicationId: input.publicationId,
    inputHash: draw.inputHash,
    pairingHash: draw.pairingHash,
    groups: groups.map((g) => [
      g.groupKey,
      g.standings.sourceHash,
      g.draw?.id ?? null,
      g.qualifiedEntryIds,
    ]),
    sources: canonicalSources(sources),
    slots,
  });
  const qualification = input.qualification ?? null;
  if (
    qualification &&
    (!ready ||
      qualification.sourceHash !== qualificationHash ||
      !isDeepStrictEqual(qualification.slots, slots) ||
      !isDeepStrictEqual(canonicalSources(qualification.sources), canonicalSources(sources)) ||
      !isDeepStrictEqual([...qualification.drawIds].sort(ascii), usedDrawIds.sort(ascii)))
  )
    resultSourceInvalid();
  if (!qualification && (elimination.length || (input.roundPublications ?? []).length))
    resultSourceInvalid();
  const bracket = qualification
    ? fixedBracket({
        publicationId: input.publicationId,
        source: input.source,
        seed: input.seed,
        policy: input.policy,
        seats: slots,
        offset: draw.groupRoundCount,
        matches: elimination,
        roundPublications: input.roundPublications ?? [],
        asOf: input.asOf,
      })
    : null;
  if (qualification) {
    for (const m of elimination.filter((m) => m.round_no === draw.groupRoundCount + 1)) {
      for (const entry of [m.home_entry_id, m.away_entry_id]) {
        const prior = groupMatches.filter(
          (g) => g.home_entry_id === entry || g.away_entry_id === entry,
        );
        if (prior.some((g) => new Date(m.starts_at) < new Date(g.ends_at))) resultSourceInvalid();
      }
    }
  }
  const totalMatchCount =
    draw.fixtures.length +
    draw.config.groupCount * 2 -
    1 +
    ((input.policy as SchedulePolicy & { thirdPlaceMatch?: boolean }).thirdPlaceMatch ? 1 : 0);
  const isComplete = !!bracket?.isComplete && allComplete;
  const placements: GroupKnockoutProjection['placements'] = [];
  if (isComplete) {
    const qualified = new Map(bracket!.placements.map((p) => [p.entryId, p]));
    for (const g of groups)
      for (const row of g.standings.rows) {
        const p = qualified.get(row.entryId);
        placements.push({
          entryId: row.entryId,
          teamName: row.teamName,
          groupKey: g.groupKey,
          groupRank: row.rank,
          stage: p ? 'KNOCKOUT' : 'GROUP_ELIMINATED',
          rank: p?.rank ?? null,
          tied: p?.tied ?? row.tied,
        });
      }
    placements.sort(
      (a, b) =>
        (a.rank ?? 999) - (b.rank ?? 999) ||
        ascii(a.groupKey, b.groupKey) ||
        ascii(a.entryId, b.entryId),
    );
  }
  const sourceHash = hash({
    qualificationHash,
    qualificationId: qualification?.id ?? null,
    bracket: bracket?.sourceHash ?? null,
  });
  const initialFixtures = ready
    ? Array.from({ length: slots.length / 2 }, (_, i): ScheduleFixtureData => ({
        fixtureKey: key(draw.groupRoundCount + 1, i + 1),
        roundNo: draw.groupRoundCount + 1,
        positionNo: i + 1,
        homeEntryId: slots[i * 2]!,
        awayEntryId: slots[i * 2 + 1]!,
        courtId: null,
        startsAt: null,
        endsAt: null,
      }))
    : [];
  const nextRound = qualification
    ? (bracket?.nextRound ?? null)
    : ready
      ? {
          roundNo: draw.groupRoundCount + 1,
          sourceHash: qualificationHash,
          sources: canonicalSources(sources),
          fixtures: initialFixtures,
        }
      : null;
  const adjudicatedMatchCount =
      groups.reduce((sum, g) => sum + (g.standings.adjudicatedMatchCount ?? 0), 0) +
      (bracket?.adjudicatedMatchCount ?? 0),
    cancelledMatchCount =
      groups.reduce((sum, g) => sum + (g.standings.cancelledMatchCount ?? 0), 0) +
      (bracket?.cancelledMatchCount ?? 0);
  return {
    ...(adjudicatedMatchCount + cancelledMatchCount
      ? {
          adjudicatedMatchCount,
          cancelledMatchCount,
          resolvedMatchCount:
            groups.reduce(
              (sum, g) => sum + (g.standings.resolvedMatchCount ?? g.standings.confirmedMatchCount),
              0,
            ) + (bracket?.resolvedMatchCount ?? bracket?.confirmedMatchCount ?? 0),
        }
      : {}),
    algorithmVersion: 'GK_BALANCED_V1',
    groupCount: draw.config.groupCount,
    sourceHash,
    asOf: input.asOf,
    groupRoundCount: draw.groupRoundCount,
    totalMatchCount,
    publishedMatchCount: input.matches.length,
    confirmedMatchCount:
      sources.filter((s) => !('kind' in s)).length + (bracket?.confirmedMatchCount ?? 0),
    isComplete,
    groups,
    qualification: {
      status: qualification
        ? 'PUBLISHED'
        : !allComplete
          ? 'WAITING'
          : !ready
            ? 'TIE_BREAK_REQUIRED'
            : 'READY',
      sourceHash: qualificationHash,
      sources: canonicalSources(sources),
      slots,
      unresolvedGroups: groups.filter((g) => g.unresolvedTieEntryIds.length).map((g) => g.groupKey),
      publicationId: qualification?.id ?? null,
    },
    bracket,
    placements,
    nextRound,
  };
}

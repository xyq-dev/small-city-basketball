import { administrativeResult } from './match-exception-domain.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import type {
  KnockoutBracket,
  KnockoutPlacement,
  KnockoutRoundData,
  KnockoutSlotData,
  KnockoutSource,
  RegistrationFreezeData,
  ScheduleFixtureData,
  SchedulePolicy,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { invalid } from './validation.js';
import { canonicalFreeze, parseSchedulePolicy } from './scheduling-domain.js';
import { confirmedResult, resultSourceInvalid } from './standings-domain.js';
import type { ResultRow } from './standings-domain.js';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';

const ALGORITHM = 'SE_SEEDED_V1' as const;
const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const key = (roundNo: number, positionNo: number) => `R${roundNo}-P${positionNo}`;
type PlacementSlot = KnockoutSlotData & {
  kind?: 'CHAMPIONSHIP' | 'THIRD_PLACE';
  sourceOutcome?: 'WINNER' | 'LOSER';
};
const label = (remaining: number, roundNo: number) =>
  remaining === 0
    ? '决赛'
    : remaining === 1
      ? '半决赛'
      : remaining === 2
        ? '四分之一决赛'
        : `第${roundNo}轮`;

function canonicalSource(freeze: RegistrationFreezeData): RegistrationFreezeData {
  if (
    !freeze ||
    !uuid(freeze.id) ||
    !uuid(freeze.eventId) ||
    !uuid(freeze.rulesetId) ||
    !Number.isInteger(freeze.rulesetVersion) ||
    freeze.rulesetVersion < 1 ||
    !Number.isInteger(freeze.eventVersion) ||
    freeze.eventVersion < 1 ||
    !Array.isArray(freeze.entries) ||
    freeze.entries.length < 2 ||
    freeze.entries.length > 32 ||
    freeze.entries.some(
      (e) =>
        !e ||
        !uuid(e.entryId) ||
        !uuid(e.teamId) ||
        !uuid(e.rosterRevisionId) ||
        typeof e.teamName !== 'string' ||
        !e.teamName.trim() ||
        Array.from(e.teamName).length > 80 ||
        !Array.isArray(e.players) ||
        e.players.length < 1 ||
        e.players.length > 60 ||
        e.players.some(
          (p) =>
            !p ||
            !uuid(p.memberId) ||
            typeof p.name !== 'string' ||
            !p.name.trim() ||
            Array.from(p.name).length > 80 ||
            p.name.includes('\u0000') ||
            typeof p.jerseyNo !== 'string' ||
            !/^(?:0|00|[1-9][0-9]?)$/.test(p.jerseyNo),
        ) ||
        new Set(e.players.map((p) => p.memberId)).size !== e.players.length ||
        new Set(e.players.map((p) => p.jerseyNo)).size !== e.players.length,
    ) ||
    new Set(freeze.entries.map((e) => e.entryId)).size !== freeze.entries.length ||
    new Set(freeze.entries.map((e) => e.teamId)).size !== freeze.entries.length
  )
    throw new ApiError(
      422,
      'INVALID_SCHEDULE_FREEZE',
      '冻结参赛队需为2–32支且来源完整、编号不重复',
    );
  return canonicalFreeze(freeze);
}
function layout(orderedEntryIds: string[]) {
  let positions = [1, 2];
  while (positions.length < orderedEntryIds.length) {
    const complement = positions.length * 2 + 1;
    positions = positions.flatMap((position) => [position, complement - position]);
  }
  return positions.map((position) => orderedEntryIds[position - 1] ?? null);
}

/** Initial publication contains real first-round games only; byes remain bracket sources. */
export function generateKnockoutPairings(
  freeze: RegistrationFreezeData,
  policy: SchedulePolicy,
  seed: string,
) {
  const source = canonicalSource(freeze);
  if (!/^[0-9a-f]{64}$/.test(seed)) invalid('抽签种子必须是256bit十六进制值');
  const normalizedPolicy = parseSchedulePolicy(policy);
  if (
    (normalizedPolicy as SchedulePolicy & { thirdPlaceMatch?: boolean }).thirdPlaceMatch &&
    source.entries.length < 4
  )
    invalid('季军赛至少需要4支冻结参赛队');
  const orderedEntryIds = source.entries
    .map((e) => ({ id: e.entryId, rank: hashSeed(seed, e.entryId) }))
    .sort((a, b) => ascii(a.rank, b.rank) || ascii(a.id, b.id))
    .map((e) => e.id);
  const seats = layout(orderedEntryIds);
  const totalRounds = Math.log2(seats.length);
  const fixtures: ScheduleFixtureData[] = [];
  const byes: string[] = [];
  for (let index = 0; index < seats.length; index += 2) {
    const home = seats[index]!;
    const away = seats[index + 1]!;
    if (!home || !away) {
      byes.push((home ?? away)!);
    } else {
      fixtures.push({
        fixtureKey: key(1, index / 2 + 1),
        roundNo: 1,
        positionNo: index / 2 + 1,
        homeEntryId: home,
        awayEntryId: away,
        courtId: null,
        startsAt: null,
        endsAt: null,
      });
    }
  }
  const rounds = Array.from({ length: totalRounds }, (_, index) => ({
    roundNo: index + 1,
    byeEntryId: null,
    byeEntryIds: index === 0 ? byes : [],
  }));
  return {
    inputHash: hash({ algorithmVersion: ALGORITHM, freeze: source, policy: normalizedPolicy }),
    pairingHash: hash({
      algorithmVersion: ALGORITHM,
      seed,
      orderedEntryIds,
      seats,
      rounds,
      fixtures: fixtures.map(({ fixtureKey, roundNo, positionNo, homeEntryId, awayEntryId }) => ({
        fixtureKey,
        roundNo,
        positionNo,
        homeEntryId,
        awayEntryId,
      })),
    }),
    rounds,
    fixtures,
    orderedEntryIds,
  };
}
function hashSeed(seed: string, entry: string) {
  return createHash('sha256').update(`${seed}|${entry}`).digest('hex');
}
function iso(value: unknown): string {
  if (!(typeof value === 'string' || value instanceof Date)) resultSourceInvalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) resultSourceInvalid();
  return parsed.toISOString();
}
export function canonicalKnockoutSources(sources: KnockoutSource[]): KnockoutSource[] {
  if (!Array.isArray(sources)) resultSourceInvalid();
  return sources
    .map((source) => {
      if ('kind' in source) {
        if (
          source.kind !== 'ADJUDICATION' ||
          Object.keys(source).sort().join('|') !==
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
          !uuid(source.matchId) ||
          !uuid(source.adjudicationId) ||
          source.adjudicationVersion !== 2 ||
          !uuid(source.winnerEntryId) ||
          !uuid(source.loserEntryId) ||
          source.winnerEntryId === source.loserEntryId ||
          typeof source.fixtureKey !== 'string' ||
          !Number.isInteger(source.matchVersion) ||
          source.matchVersion < 1
        )
          resultSourceInvalid();
        return {
          kind: 'ADJUDICATION' as const,
          fixtureKey: source.fixtureKey,
          matchId: source.matchId,
          adjudicationId: source.adjudicationId,
          adjudicationVersion: source.adjudicationVersion,
          matchVersion: source.matchVersion,
          winnerEntryId: source.winnerEntryId,
          loserEntryId: source.loserEntryId,
        };
      }
      if (
        !source ||
        Object.keys(source).sort().join('|') !==
          ['fixtureKey', 'matchId', 'confirmationId', 'matchVersion', 'winnerEntryId']
            .sort()
            .join('|') ||
        !uuid(source.matchId) ||
        !uuid(source.confirmationId) ||
        !uuid(source.winnerEntryId) ||
        typeof source.fixtureKey !== 'string' ||
        !Number.isInteger(source.matchVersion) ||
        source.matchVersion < 1
      )
        resultSourceInvalid();
      return {
        fixtureKey: source.fixtureKey,
        matchId: source.matchId,
        confirmationId: source.confirmationId,
        matchVersion: source.matchVersion,
        winnerEntryId: source.winnerEntryId,
      };
    })
    .sort((a, b) => ascii(a.fixtureKey, b.fixtureKey));
}

/** Validate the fixed tree against original matches and current independent confirmations. */
export function calculateKnockout(input: {
  publicationId: string;
  source: RegistrationFreezeData;
  seed: string;
  policy: SchedulePolicy;
  matches: ResultRow[];
  asOf: string;
  roundPublications?: { roundNo: number; sources: KnockoutSource[] }[];
  /** Internal GROUP qualification supplies fixed power-of-two seats, never client input. */
  fixedSeats?: string[];
}): KnockoutBracket {
  if (!uuid(input.publicationId) || !Array.isArray(input.matches)) resultSourceInvalid();
  let draw: ReturnType<typeof generateKnockoutPairings>;
  let source: RegistrationFreezeData;
  try {
    source = canonicalSource(input.source);
    draw = generateKnockoutPairings(source, input.policy, input.seed);
  } catch {
    return resultSourceInvalid();
  }
  const participants = new Map(source.entries.map((entry) => [entry.entryId, entry]));
  const seats = input.fixedSeats ?? layout(draw.orderedEntryIds);
  if (
    input.fixedSeats &&
    (seats.length !== source.entries.length ||
      ![2, 4, 8, 16, 32].includes(seats.length) ||
      new Set(seats).size !== seats.length ||
      input.fixedSeats.some((id) => !participants.has(id)))
  )
    resultSourceInvalid();
  const totalRounds = Math.log2(seats.length);
  const thirdPlaceMatch =
    (input.policy as SchedulePolicy & { thirdPlaceMatch?: boolean }).thirdPlaceMatch === true;
  if (thirdPlaceMatch && source.entries.length < 4) resultSourceInvalid();
  const matches = new Map<string, ResultRow>();
  const ids = new Set<string>();
  const revisions = new Set<string>();
  const proofs = new Map<number, KnockoutSource[]>();
  if (input.roundPublications !== undefined && !Array.isArray(input.roundPublications))
    resultSourceInvalid();
  for (const proof of input.roundPublications ?? []) {
    if (
      !proof ||
      !Number.isInteger(proof.roundNo) ||
      proof.roundNo < 2 ||
      proof.roundNo > totalRounds ||
      proofs.has(proof.roundNo)
    )
      resultSourceInvalid();
    proofs.set(proof.roundNo, canonicalKnockoutSources(proof.sources));
  }
  for (const match of input.matches) {
    if (
      !match ||
      !uuid(match.id) ||
      ids.has(match.id) ||
      matches.has(match.fixture_key) ||
      !uuid(match.revision_id) ||
      match.publication_id !== input.publicationId ||
      match.event_id !== source.eventId ||
      !Number.isInteger(match.round_no) ||
      match.round_no < 1 ||
      match.round_no > totalRounds ||
      !Number.isInteger(match.position_no) ||
      match.position_no < 1 ||
      match.position_no >
        (thirdPlaceMatch && match.round_no === totalRounds
          ? 2
          : seats.length / 2 ** match.round_no) ||
      match.fixture_key !== key(match.round_no, match.position_no) ||
      !(MATCH_STATUSES as readonly unknown[]).includes(match.status) ||
      !Number.isInteger(match.version) ||
      match.version < 1 ||
      !uuid(match.court_id) ||
      typeof match.court_name !== 'string' ||
      !match.court_name.trim() ||
      iso(match.starts_at) >= iso(match.ends_at)
    )
      resultSourceInvalid();
    revisions.add(match.revision_id);
    ids.add(match.id);
    matches.set(match.fixture_key, match);
  }
  if (revisions.size !== 1) resultSourceInvalid();
  const rounds: KnockoutRoundData[] = [];
  const sourcesByRound: KnockoutSource[][] = [];
  const effectiveResults: { roundNo: number; loserEntryId: string; thirdPlace: boolean }[] = [];
  const plans: unknown[] = [];
  let previous: PlacementSlot[] = [];
  let previousComplete = true;
  let confirmedMatchCount = 0;
  let adjudicatedMatchCount = 0;
  let cancelledMatchCount = 0;
  let publishedMatchCount = 0;
  let nextRound: KnockoutBracket['nextRound'] = null;
  for (let roundNo = 1; roundNo <= totalRounds; roundNo++) {
    const slots: PlacementSlot[] = [];
    const count = thirdPlaceMatch && roundNo === totalRounds ? 2 : seats.length / 2 ** roundNo;
    const current = input.matches.filter((match) => match.round_no === roundNo);
    const published = current.length > 0;
    if ((roundNo === 1 && !published) || (published && !previousComplete)) resultSourceInvalid();
    const roundSources: KnockoutSource[] = [];
    let realCount = 0;
    for (let positionNo = 1; positionNo <= count; positionNo++) {
      const isThirdPlace = thirdPlaceMatch && roundNo === totalRounds && positionNo === 2;
      const sourcePosition = isThirdPlace ? 1 : positionNo;
      const homeSource = roundNo === 1 ? null : key(roundNo - 1, sourcePosition * 2 - 1);
      const awaySource = roundNo === 1 ? null : key(roundNo - 1, sourcePosition * 2);
      const loser = (slot: PlacementSlot) =>
        slot.winnerEntryId && slot.homeEntryId && slot.awayEntryId
          ? slot.winnerEntryId === slot.homeEntryId
            ? slot.awayEntryId
            : slot.homeEntryId
          : null;
      const homeEntryId =
        roundNo === 1
          ? seats[(positionNo - 1) * 2]!
          : isThirdPlace
            ? loser(previous[0]!)
            : previous[positionNo * 2 - 2]!.winnerEntryId;
      const awayEntryId =
        roundNo === 1
          ? seats[(positionNo - 1) * 2 + 1]!
          : isThirdPlace
            ? loser(previous[1]!)
            : previous[positionNo * 2 - 1]!.winnerEntryId;
      const fixtureKey = key(roundNo, positionNo);
      const match = matches.get(fixtureKey);
      const byeEntryId =
        roundNo === 1 && (!homeEntryId || !awayEntryId) ? (homeEntryId ?? awayEntryId) : null;
      if (byeEntryId && match) resultSourceInvalid();
      let winnerEntryId = byeEntryId;
      if (!byeEntryId) realCount++;
      let administrativeKind: 'FORFEIT' | 'CANCELLED' | null = null;
      if (match) {
        if (!homeEntryId || !awayEntryId) resultSourceInvalid();
        if (roundNo > 1) {
          for (const sourceKey of [homeSource!, awaySource!]) {
            const parent = matches.get(sourceKey);
            if (parent && iso(match.starts_at) < iso(parent.ends_at)) resultSourceInvalid();
          }
        }
        const home = participants.get(homeEntryId)!;
        const away = participants.get(awayEntryId)!;
        for (const side of ['home', 'away'] as const) {
          const frozen = side === 'home' ? home : away;
          if (
            match[`${side}_entry_id`] !== frozen.entryId ||
            match[`${side}_team_id`] !== frozen.teamId ||
            match[`${side}_team_name`] !== frozen.teamName ||
            match[`${side}_roster_revision_id`] !== frozen.rosterRevisionId
          )
            resultSourceInvalid();
        }
        if (match.state && match.scoring_rules?.tie_policy !== 'OVERTIME') resultSourceInvalid();
        const admin = administrativeResult(match);
        administrativeKind = admin?.kind ?? null;
        if (admin?.kind === 'CANCELLED') cancelledMatchCount++;
        const result = admin ? null : confirmedResult(match);
        const playerStatistics = admin ? null : confirmedPlayerStatistics(match);
        if (playerStatistics) {
          for (const side of ['home', 'away'] as const) {
            const frozen = side === 'home' ? home : away;
            const expected = [...frozen.players].sort((a, b) => ascii(a.memberId, b.memberId));
            const actual = playerStatistics[side].players
              .map(({ memberId, name, jerseyNo }) => ({ memberId, name, jerseyNo }))
              .sort((a, b) => ascii(a.memberId, b.memberId));
            if (!isDeepStrictEqual(actual, expected)) resultSourceInvalid();
          }
        }
        if (admin?.kind === 'FORFEIT') {
          winnerEntryId = admin.winnerEntryId!;
          effectiveResults.push({
            roundNo,
            loserEntryId: admin.loserEntryId!,
            thirdPlace: isThirdPlace,
          });
          roundSources.push(admin.source!);
          adjudicatedMatchCount++;
        }
        if (result) {
          if (
            match.scoring_rules?.tie_policy !== 'OVERTIME' ||
            result.homeScore === result.awayScore
          )
            resultSourceInvalid();
          winnerEntryId = result.homeScore > result.awayScore ? homeEntryId : awayEntryId;
          const loserEntryId = winnerEntryId === homeEntryId ? awayEntryId : homeEntryId;
          effectiveResults.push({ roundNo, loserEntryId, thirdPlace: isThirdPlace });
          roundSources.push({
            fixtureKey,
            matchId: match.id,
            confirmationId: result.confirmationId,
            matchVersion: result.sourceMatchVersion + 1,
            winnerEntryId,
          });
          confirmedMatchCount++;
        }
        publishedMatchCount++;
        plans.push({
          fixtureKey,
          matchId: match.id,
          revisionId: match.revision_id,
          homeEntryId,
          awayEntryId,
          courtId: match.court_id,
          courtName: match.court_name,
          startsAt: iso(match.starts_at),
          endsAt: iso(match.ends_at),
          status: match.status,
          ...(admin
            ? {
                adjudication: {
                  kind: admin.kind,
                  id: admin.adjudicationId,
                  version: admin.adjudicationVersion,
                },
              }
            : {}),
          confirmation: result ? { ...result, matchVersion: result.sourceMatchVersion + 1 } : null,
        });
      }
      slots.push({
        ...(administrativeKind ? { adjudication: { kind: administrativeKind } } : {}),
        ...(thirdPlaceMatch && roundNo === totalRounds
          ? {
              kind: isThirdPlace ? ('THIRD_PLACE' as const) : ('CHAMPIONSHIP' as const),
              sourceOutcome: isThirdPlace ? ('LOSER' as const) : ('WINNER' as const),
            }
          : {}),
        fixtureKey,
        roundNo,
        positionNo,
        homeEntryId,
        awayEntryId,
        homeSource,
        awaySource,
        byeEntryId,
        matchId: match?.id ?? null,
        status: byeEntryId ? 'BYE' : match ? match.status : 'WAITING',
        winnerEntryId,
      });
    }
    if (published && current.length !== realCount) resultSourceInvalid();
    if (roundNo > 1) {
      const proof = proofs.get(roundNo);
      if (published) {
        if (
          !proof ||
          !isDeepStrictEqual(proof, canonicalKnockoutSources(sourcesByRound[roundNo - 2]!))
        )
          resultSourceInvalid();
      } else if (proof) resultSourceInvalid();
      if (!published && previousComplete && !nextRound) {
        const fixtures = slots.map((slot): ScheduleFixtureData => {
          if (!slot.homeEntryId || !slot.awayEntryId) return resultSourceInvalid();
          return {
            fixtureKey: slot.fixtureKey,
            roundNo,
            positionNo: slot.positionNo,
            homeEntryId: slot.homeEntryId,
            awayEntryId: slot.awayEntryId,
            courtId: null,
            startsAt: null,
            endsAt: null,
          };
        });
        nextRound = {
          roundNo,
          sourceHash: '',
          sources: canonicalKnockoutSources(sourcesByRound[roundNo - 2]!),
          fixtures,
        };
      }
    }
    previousComplete = published && slots.every((slot) => !!slot.winnerEntryId);
    previous = slots;
    sourcesByRound.push(roundSources);
    rounds.push({
      roundNo,
      label:
        thirdPlaceMatch && roundNo === totalRounds
          ? '决赛与季军赛'
          : label(totalRounds - roundNo, roundNo),
      published,
      slots,
    });
  }
  const isComplete =
    previousComplete &&
    publishedMatchCount === source.entries.length - 1 + (thirdPlaceMatch ? 1 : 0) &&
    confirmedMatchCount + adjudicatedMatchCount === publishedMatchCount;
  const placements: KnockoutPlacement[] = [];
  if (isComplete) {
    const champion = previous[0]!.winnerEntryId!;
    placements.push({
      entryId: champion,
      teamName: participants.get(champion)!.teamName,
      rank: 1,
      tied: false,
    });
    for (const result of effectiveResults) {
      if (result.thirdPlace || (thirdPlaceMatch && result.roundNo === totalRounds - 1)) continue;
      const rank = 2 ** (totalRounds - result.roundNo) + 1;
      placements.push({
        entryId: result.loserEntryId,
        teamName: participants.get(result.loserEntryId)!.teamName,
        rank,
        tied: false,
      });
    }
    if (thirdPlaceMatch) {
      const bronze = previous[1]!;
      const winner = bronze.winnerEntryId!;
      const loser = winner === bronze.homeEntryId ? bronze.awayEntryId! : bronze.homeEntryId!;
      for (const [entryId, rank] of [
        [winner, 3],
        [loser, 4],
      ] as const)
        placements.push({
          entryId,
          teamName: participants.get(entryId)!.teamName,
          rank,
          tied: false,
        });
    }
    if (
      placements.length !== source.entries.length ||
      new Set(placements.map((p) => p.entryId)).size !== placements.length
    )
      resultSourceInvalid();
    const ranks = new Map<number, number>();
    for (const placement of placements)
      ranks.set(placement.rank, (ranks.get(placement.rank) ?? 0) + 1);
    for (const placement of placements) placement.tied = ranks.get(placement.rank)! > 1;
    placements.sort((a, b) => a.rank - b.rank || ascii(a.entryId, b.entryId));
  }
  const sourceHash = hash({
    algorithmVersion: ALGORITHM,
    publicationId: input.publicationId,
    inputHash: draw.inputHash,
    pairingHash: draw.pairingHash,
    ...(input.fixedSeats ? { fixedSeats: input.fixedSeats } : {}),
    plans,
    roundSources: [...proofs].sort(([a], [b]) => a - b),
  });
  if (nextRound) nextRound.sourceHash = sourceHash;
  return {
    algorithmVersion: ALGORITHM,
    sourceHash,
    asOf: input.asOf,
    participantCount: source.entries.length,
    totalMatchCount: source.entries.length - 1 + (thirdPlaceMatch ? 1 : 0),
    publishedMatchCount,
    confirmedMatchCount,
    ...(adjudicatedMatchCount + cancelledMatchCount
      ? {
          adjudicatedMatchCount,
          cancelledMatchCount,
          resolvedMatchCount: confirmedMatchCount + adjudicatedMatchCount + cancelledMatchCount,
        }
      : {}),
    isComplete,
    rounds,
    placements,
    nextRound,
  };
}

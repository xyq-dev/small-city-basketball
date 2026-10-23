import { describe, expect, it } from 'vitest';
import type {
  KnockoutBracket,
  KnockoutSource,
  RegistrationFreezeData,
  ScheduleFixtureData,
  SchedulePolicy,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import type { ResultRow } from './standings-domain.js';
import { calculateKnockout, generateKnockoutPairings } from './knockout-domain.js';
import { generatePairings } from './scheduling-domain.js';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const seed = '00'.repeat(32);
const asOf = '2026-10-23T02:00:00.000Z';
const publicationId = id(900);
const policy: SchedulePolicy = {
  slotDurationMinutes: 60,
  minRestMinutes: 0,
  minLocalDayGap: 0,
  courtWindows: [
    { courtId: id(600), startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' },
  ],
};
function freeze(count: number): RegistrationFreezeData {
  return {
    id: id(500),
    eventId: id(501),
    rulesetId: id(502),
    rulesetVersion: 1,
    eventVersion: 7,
    entries: Array.from({ length: count }, (_, index) => ({
      entryId: id(index + 1),
      teamId: id(index + 101),
      teamName: `队${index + 1}`,
      rosterRevisionId: id(index + 201),
      players: [
        { memberId: id(index + 301), name: `合成球员${index + 1}`, jerseyNo: String(index + 1) },
      ],
    })),
    excludedCounts: { DRAFT: 0, REJECTED: 0, WITHDRAWN: 0 },
    createdAt: asOf,
  };
}
function scheduled(source: RegistrationFreezeData, fixture: ScheduleFixtureData): ResultRow {
  const home = source.entries.find((e) => e.entryId === fixture.homeEntryId)!;
  const away = source.entries.find((e) => e.entryId === fixture.awayEntryId)!;
  const startsAt = new Date(
    Date.parse('2026-11-01T00:00:00Z') + (fixture.roundNo * 24 + fixture.positionNo) * 3_600_000,
  );
  return {
    id: id(1000 + fixture.roundNo * 100 + fixture.positionNo),
    event_id: source.eventId,
    publication_id: publicationId,
    revision_id: id(901),
    fixture_key: fixture.fixtureKey,
    round_no: fixture.roundNo,
    position_no: fixture.positionNo,
    home_entry_id: home.entryId,
    home_team_id: home.teamId,
    home_team_name: home.teamName,
    home_roster_revision_id: home.rosterRevisionId,
    away_entry_id: away.entryId,
    away_team_id: away.teamId,
    away_team_name: away.teamName,
    away_roster_revision_id: away.rosterRevisionId,
    court_id: id(600),
    court_name: '合成场地',
    starts_at: startsAt,
    ends_at: new Date(startsAt.getTime() + 3_600_000),
    status: 'SCHEDULED',
    version: 1,
    state: null,
    confirmation: null,
    last_event: null,
    last_command: null,
    scoring_rules: null,
  };
}
function final(match: ResultRow, homeScore = 10, awayScore = 8): ResultRow {
  const totals = (score: number) => ({ score, fouls: 0, timeouts: 0 });
  const statistics = {
    home_score: homeScore,
    away_score: awayScore,
    home_fouls: 0,
    away_fouls: 0,
    home_timeouts: 0,
    away_timeouts: 0,
    period_stats: [{ period: 1, home: totals(homeScore), away: totals(awayScore) }],
    collection_mode: 'TEAM_ONLY',
    player_stats: null,
  };
  const confirmationId = id(5000 + match.round_no * 100 + match.position_no);
  const commandId = id(6000 + match.round_no * 100 + match.position_no);
  return {
    ...match,
    status: 'FINAL',
    version: 9,
    state: {
      ...structuredClone(statistics),
      source_version: 9,
      ruleset_id: id(800),
      period: 1,
      clock_running: false,
      remaining_ms: 0,
      last_event_seq: 7,
      latest_confirmation_id: confirmationId,
      requires_reconfirmation: false,
    },
    confirmation: {
      ...structuredClone(statistics),
      id: confirmationId,
      match_id: match.id,
      ruleset_id: id(800),
      ruleset_version: 1,
      confirming_user_id: id(9000),
      source_match_version: 8,
      last_event_seq: 6,
    },
    last_event: {
      seq: 7,
      type: 'CONFIRM_RESULT',
      actor_id: id(9000),
      target_event_id: null,
      payload: {},
      command_id: commandId,
    },
    last_command: {
      command_id: commandId,
      actor_id: id(9000),
      command_type: 'CONFIRM_RESULT',
      applied_version: 9,
      first_event_seq: 7,
      last_event_seq: 7,
    },
    scoring_rules: {
      id: id(800),
      version: 1,
      tie_policy: 'OVERTIME',
      regulation_periods: 1,
      period_duration_seconds: 60,
      allowed_score_values: [1, 2, 3],
      overtime_duration_seconds: 60,
    },
  };
}
type Proof = { roundNo: number; sources: KnockoutSource[] };
function fixture(count: number) {
  const source = freeze(count);
  const draw = generateKnockoutPairings(source, policy, seed);
  const matches = draw.fixtures.map((f) => scheduled(source, f));
  const roundPublications: Proof[] = [];
  const read = (overrides: Partial<Parameters<typeof calculateKnockout>[0]> = {}) =>
    calculateKnockout({
      publicationId,
      source,
      seed,
      policy,
      matches,
      asOf,
      roundPublications,
      ...overrides,
    });
  return { source, draw, matches, roundPublications, read };
}
function finishRound(f: ReturnType<typeof fixture>, roundNo: number) {
  for (let i = 0; i < f.matches.length; i++)
    if (f.matches[i]!.round_no === roundNo) f.matches[i] = final(f.matches[i]!);
  return f.read();
}
function publishNext(f: ReturnType<typeof fixture>, bracket: KnockoutBracket) {
  const next = bracket.nextRound!;
  f.roundPublications.push({ roundNo: next.roundNo, sources: structuredClone(next.sources) });
  f.matches.push(...next.fixtures.map((game) => scheduled(f.source, game)));
  return f.read();
}
function invalid(fn: () => unknown) {
  expect(fn).toThrowError(expect.objectContaining({ status: 409, code: 'RESULT_SOURCE_INVALID' }));
}

describe('SE_SEEDED_V1 reproducible initial draw', () => {
  it('three-team known draw uses seed positions 1,4,2,3 and never creates a bye match', () => {
    const draw = generateKnockoutPairings(freeze(3), policy, seed);
    expect(draw.orderedEntryIds).toEqual([id(1), id(2), id(3)]);
    expect(draw.rounds).toEqual([
      { roundNo: 1, byeEntryId: null, byeEntryIds: [id(1)] },
      { roundNo: 2, byeEntryId: null, byeEntryIds: [] },
    ]);
    expect(draw.fixtures).toEqual([
      {
        fixtureKey: 'R1-P2',
        roundNo: 1,
        positionNo: 2,
        homeEntryId: id(2),
        awayEntryId: id(3),
        courtId: null,
        startsAt: null,
        endsAt: null,
      },
    ]);
  });
  it.each(Array.from({ length: 31 }, (_, index) => index + 2))(
    '%i teams: byes and actual games cover each frozen entry exactly once',
    (count) => {
      const source = freeze(count);
      const before = structuredClone(source);
      const draw = generateKnockoutPairings(source, policy, seed);
      const size = 2 ** Math.ceil(Math.log2(count));
      const participants = [
        ...draw.fixtures.flatMap((f) => [f.homeEntryId, f.awayEntryId]),
        ...draw.rounds[0]!.byeEntryIds,
      ];
      expect(draw.fixtures).toHaveLength(count - size / 2);
      expect(draw.rounds).toHaveLength(Math.log2(size));
      expect(draw.rounds[0]!.byeEntryIds).toHaveLength(size - count);
      expect(participants.sort()).toEqual(source.entries.map((e) => e.entryId).sort());
      expect(new Set(participants).size).toBe(count);
      expect(source).toEqual(before);
      expect(
        generateKnockoutPairings(
          { ...source, entries: [...source.entries].reverse() },
          policy,
          seed,
        ),
      ).toEqual(draw);
    },
  );
  it('hashes separate algorithm identities and policy from pairing, and a fixed redraw replays', () => {
    const source = freeze(5);
    const draw = generateKnockoutPairings(source, policy, seed);
    const otherPolicy = generateKnockoutPairings(source, { ...policy, minRestMinutes: 30 }, seed);
    expect(otherPolicy.pairingHash).toBe(draw.pairingHash);
    expect(otherPolicy.inputHash).not.toBe(draw.inputHash);
    expect(draw.inputHash).not.toBe(generatePairings(source, policy, seed).inputHash);
    const redraw = generateKnockoutPairings(source, policy, '11'.repeat(32));
    expect(redraw.orderedEntryIds).not.toEqual(draw.orderedEntryIds);
    expect(redraw).toEqual(generateKnockoutPairings(source, policy, '11'.repeat(32)));
  });
  it('rejects unsupported counts, duplicate identity, malformed seed and policy', () => {
    for (const count of [0, 1, 33])
      expect(() => generateKnockoutPairings(freeze(count), policy, seed)).toThrow(ApiError);
    const source = freeze(3);
    source.entries[1]!.teamId = source.entries[0]!.teamId;
    expect(() => generateKnockoutPairings(source, policy, seed)).toThrow(ApiError);
    expect(() => generateKnockoutPairings(freeze(3), policy, 'short')).toThrow(ApiError);
    expect(() =>
      generateKnockoutPairings(freeze(3), { ...policy, slotDurationMinutes: 0 }, seed),
    ).toThrow(ApiError);
  });
});

describe('knockout projection uses authoritative confirmations, never copied scores', () => {
  it.each([2, 3, 5, 17, 32])(
    '%i-team complete tree has n−1 real matches, final-only placements and each eliminated entry exactly once',
    (count) => {
      const f = fixture(count);
      let bracket = f.read();
      expect(bracket.placements).toEqual([]);
      expect(bracket.totalMatchCount).toBe(count - 1);
      expect(bracket.isComplete).toBe(false);
      const rounds = f.draw.rounds.length;
      for (let round = 1; round <= rounds; round++) {
        bracket = finishRound(f, round);
        if (round < rounds) {
          expect(bracket.isComplete).toBe(false);
          expect(bracket.placements).toEqual([]);
          expect(bracket.nextRound!.sources).toHaveLength(
            f.matches.filter((m) => m.round_no === round).length,
          );
          bracket = publishNext(f, bracket);
        }
      }
      expect(bracket).toMatchObject({
        participantCount: count,
        totalMatchCount: count - 1,
        publishedMatchCount: count - 1,
        confirmedMatchCount: count - 1,
        isComplete: true,
        nextRound: null,
      });
      expect(bracket.placements).toHaveLength(count);
      expect(new Set(bracket.placements.map((p) => p.entryId)).size).toBe(count);
      expect(bracket.placements.slice(0, 2).map((p) => p.rank)).toEqual([1, 2]);
      if (count >= 4) expect(bracket.placements.filter((p) => p.rank === 3)).toHaveLength(2);
      if (count === 5) expect(bracket.placements.map((p) => p.rank)).toEqual([1, 2, 3, 3, 5]);
      expect(f.matches.every((m) => m.home_entry_id && m.away_entry_id)).toBe(true);
    },
  );
  it('a bye resolves one semifinal participant while an unconfirmed source cannot advance', () => {
    const f = fixture(3);
    const initial = f.read();
    expect(initial.rounds[0]!.slots[0]).toMatchObject({
      status: 'BYE',
      byeEntryId: id(1),
      matchId: null,
      winnerEntryId: id(1),
    });
    expect(initial.rounds[1]!.slots[0]).toMatchObject({
      homeEntryId: id(1),
      awayEntryId: null,
      status: 'WAITING',
    });
    expect(initial.nextRound).toBeNull();
    const confirmed = finishRound(f, 1);
    expect(confirmed.nextRound!.fixtures[0]).toMatchObject({
      fixtureKey: 'R2-P1',
      homeEntryId: id(1),
      awayEntryId: id(2),
    });
    expect(confirmed.nextRound!.sources).toHaveLength(1);
    expect(confirmed.nextRound!.sourceHash).toBe(confirmed.sourceHash);
  });
  it('does not mutate input and hashes ignore read time and unconfirmed live score/clock changes', () => {
    const f = fixture(3);
    f.matches[0] = {
      ...f.matches[0],
      status: 'LIVE',
      version: 3,
      state: { home_score: 2, clock_running: true },
      scoring_rules: { tie_policy: 'OVERTIME' },
    };
    const before = structuredClone(f.matches);
    const initial = f.read();
    f.matches[0]!.state.home_score = 8;
    f.matches[0]!.state.anchor_server_time = '2026-11-02T00:00:00Z';
    f.matches[0]!.version = 4;
    expect(f.read({ asOf: '2026-10-24T02:00:00.000Z' }).sourceHash).toBe(initial.sourceHash);
    expect(before[0]!.state.home_score).toBe(2);
    const current = structuredClone(f.matches);
    f.read();
    expect(f.matches).toEqual(current);
  });
  it('reopening removes winner/next round and reconfirmation changes the preview even with the same winner', () => {
    const f = fixture(3);
    const original = finishRound(f, 1);
    const originalHash = original.sourceHash;
    const saved = f.matches[0]!;
    f.matches[0] = {
      ...saved,
      status: 'LIVE',
      version: 10,
      state: { ...saved.state, requires_reconfirmation: true, latest_confirmation_id: null },
    };
    expect(f.read()).toMatchObject({
      confirmedMatchCount: 0,
      nextRound: null,
      isComplete: false,
      placements: [],
    });
    f.matches[0] = structuredClone(saved);
    f.matches[0]!.confirmation.id = id(9800);
    f.matches[0]!.state.latest_confirmation_id = id(9800);
    expect(f.read().sourceHash).not.toBe(originalHash);
  });
  it('validates whole-round atomicity and rejects fabricated byes, skipped rounds and missing publication proof', () => {
    const f = fixture(5);
    invalid(() => f.read({ matches: [] }));
    const four = fixture(4);
    invalid(() => four.read({ matches: four.matches.slice(1) }));
    const complete = finishRound(f, 1);
    publishNext(f, complete);
    invalid(() => f.read({ matches: f.matches.slice(0, -1) }));
    invalid(() => f.read({ roundPublications: [] }));
    const bye = f.read().rounds[0]!.slots.find((slot) => slot.byeEntryId)!;
    invalid(() =>
      f.read({
        matches: [
          ...f.matches,
          {
            ...f.matches[0],
            id: id(9990),
            fixture_key: bye.fixtureKey,
            position_no: bye.positionNo,
          },
        ],
      }),
    );
    const extraProof = { roundNo: 3, sources: [] };
    invalid(() => f.read({ roundPublications: [...f.roundPublications, extraProof] }));
    invalid(() =>
      f.read({ matches: f.matches.map((m) => (m.round_no === 1 ? { ...m, status: 'LIVE' } : m)) }),
    );
  });
  it('rejects a new confirmation with the same winner once the original was cited downstream', () => {
    const f = fixture(3);
    publishNext(f, finishRound(f, 1));
    f.matches[0]!.confirmation.id = id(9800);
    f.matches[0]!.state.latest_confirmation_id = id(9800);
    invalid(() => f.read());
  });
  it.each([
    [
      'duplicated match id',
      (f: ReturnType<typeof fixture>) => {
        f.matches[1]!.id = f.matches[0]!.id;
      },
    ],
    [
      'wrong frozen team',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.home_team_id = id(999);
      },
    ],
    [
      'renamed frozen participant',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.away_team_name = '不是冻结名称';
      },
    ],
    [
      'wrong roster',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.away_roster_revision_id = id(999);
      },
    ],
    [
      'other event',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.event_id = id(999);
      },
    ],
    [
      'other publication',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.publication_id = id(999);
      },
    ],
    [
      'inconsistent revision',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.revision_id = id(999);
      },
    ],
    [
      'backwards plan',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.ends_at = f.matches[0]!.starts_at;
      },
    ],
    [
      'invalid court',
      (f: ReturnType<typeof fixture>) => {
        f.matches[0]!.court_id = 'foreign';
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const f = fixture(4);
    mutate(f);
    invalid(() => f.read());
  });
  it.each([
    [
      'draw policy',
      (m: ResultRow) => {
        m.scoring_rules.tie_policy = 'ALLOW_DRAW';
      },
    ],
    [
      'tied final',
      (m: ResultRow) => {
        m.confirmation.home_score = m.state.home_score = 8;
        m.confirmation.period_stats[0].home.score = m.state.period_stats[0].home.score = 8;
      },
    ],
    [
      'stale state',
      (m: ResultRow) => {
        m.state.source_version--;
      },
    ],
    [
      'old confirmation',
      (m: ResultRow) => {
        m.state.latest_confirmation_id = id(9900);
      },
    ],
    [
      'unproven command',
      (m: ResultRow) => {
        m.last_command.command_type = 'RECORD_STAT';
      },
    ],
    [
      'corrupt personal totals',
      (m: ResultRow) => {
        m.state.collection_mode = 'PLAYER_BASIC';
      },
    ],
  ])('rejects %s even when status is FINAL', (_name, mutate) => {
    const f = fixture(2);
    f.matches[0] = final(f.matches[0]!);
    mutate(f.matches[0]!);
    invalid(() => f.read());
  });
  it('a published child cannot begin before either real source game ends', () => {
    const f = fixture(3);
    publishNext(f, finishRound(f, 1));
    const parent = f.matches[0]!;
    const child = f.matches[1]!;
    child.starts_at = new Date(new Date(parent.ends_at).getTime() - 1);
    child.ends_at = new Date(new Date(child.starts_at).getTime() + 3_600_000);
    invalid(() => f.read());
    child.starts_at = new Date(parent.ends_at);
    expect(f.read().rounds[1]!.published).toBe(true);
  });
  it('safe staff maintenance versions preserve confirmation provenance before and after advancement', () => {
    const f = fixture(3);
    const confirmed = finishRound(f, 1);
    const confirmationVersion = f.matches[0]!.confirmation.source_match_version + 1;
    expect(confirmed.nextRound!.sources[0]!.matchVersion).toBe(confirmationVersion);
    f.matches[0]!.version++;
    f.matches[0]!.state.source_version++;
    const afterStaff = f.read();
    expect(afterStaff.sourceHash).toBe(confirmed.sourceHash);
    expect(afterStaff.nextRound!.sources[0]!.matchVersion).toBe(confirmationVersion);
    publishNext(f, afterStaff);
    const advanced = f.read();
    f.matches[0]!.version++;
    f.matches[0]!.state.source_version++;
    expect(f.read().sourceHash).toBe(advanced.sourceHash);
    expect(f.read().rounds[1]!.published).toBe(true);
  });
  it('PLAYER_BASIC confirmations must retain the exact frozen identities as well as team totals', () => {
    const f = fixture(2);
    const match = final(f.matches[0]!);
    const home = f.source.entries.find((e) => e.entryId === match.home_entry_id)!;
    const away = f.source.entries.find((e) => e.entryId === match.away_entry_id)!;
    const stats = {
      mode: 'PLAYER_BASIC',
      home: {
        players: home.players.map((player) => ({ ...player, score: 10, fouls: 0 })),
        unassigned: { score: 0, fouls: 0 },
      },
      away: {
        players: away.players.map((player) => ({ ...player, score: 8, fouls: 0 })),
        unassigned: { score: 0, fouls: 0 },
      },
    };
    for (const target of [match.state, match.confirmation]) {
      target.collection_mode = 'PLAYER_BASIC';
      target.player_stats = structuredClone(stats);
    }
    f.matches[0] = match;
    expect(f.read().isComplete).toBe(true);
    const original = structuredClone(match);
    for (const target of [match.state, match.confirmation])
      target.player_stats.home.players[0].name = '伪造姓名';
    invalid(() => f.read());
    f.matches[0] = structuredClone(original);
    for (const target of [f.matches[0]!.state, f.matches[0]!.confirmation])
      target.player_stats.away.players[0].memberId = id(8999);
    invalid(() => f.read());
  });
  it('round proofs must exactly cite each current source and cannot be duplicated or silently extended', () => {
    const f = fixture(4);
    publishNext(f, finishRound(f, 1));
    const original = structuredClone(f.roundPublications);
    f.roundPublications[0]!.sources.pop();
    invalid(() => f.read());
    f.roundPublications.splice(0, f.roundPublications.length, ...structuredClone(original));
    f.roundPublications[0]!.sources[0]!.winnerEntryId = id(888);
    invalid(() => f.read());
    invalid(() => f.read({ roundPublications: [...original, ...original] }));
    invalid(() =>
      f.read({
        roundPublications: [
          {
            roundNo: 2,
            sources: [{ ...original[0]!.sources[0]!, copiedScore: 42 } as KnockoutSource],
          },
        ],
      }),
    );
    expect(
      f.read({
        roundPublications: original.map((proof) => ({
          ...proof,
          sources: [...proof.sources].reverse(),
        })),
      }).rounds[1]!.published,
    ).toBe(true);
  });
});

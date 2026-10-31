import { describe, expect, it } from 'vitest';
import type {
  RegistrationFreezeData,
  ScheduleFixtureData,
  SchedulePolicy,
  StandingsRulesetData,
  GroupTieDrawData,
  GroupQualificationProof,
  KnockoutSource,
} from '@small-city-basketball/contracts';
import type { ResultRow } from './standings-domain.js';
import {
  calculateGroupKnockout,
  generateGroupPairings,
  groupTieOrder,
} from './group-knockout-domain.js';
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

const rules: StandingsRulesetData = {
  id: id(700),
  eventId: id(501),
  version: 1,
  algorithmVersion: 'RR_STANDINGS_V1',
  winPoints: 2,
  lossPoints: 1,
  drawPoints: 0,
  tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
  createdAt: asOf,
};
function groupFixture(
  count = 4,
  groupCount: 2 | 4 | 8 = 2,
  selectedPolicy: SchedulePolicy = policy,
) {
  const source = freeze(count),
    config = {
      groupCount,
      seededEntryIds: source.entries.slice(0, groupCount).map((e) => e.entryId),
    },
    draw = generateGroupPairings(source, selectedPolicy, seed, config);
  const matches = draw.fixtures.map((f) => scheduled(source, f)),
    draws: GroupTieDrawData[] = [],
    roundPublications: { roundNo: number; sources: KnockoutSource[] }[] = [];
  let qualification: GroupQualificationProof | null = null;
  const read = () =>
    calculateGroupKnockout({
      publicationId,
      source,
      seed,
      policy: selectedPolicy,
      config,
      rules,
      matches,
      asOf,
      draws,
      qualification,
      roundPublications,
    });
  return {
    source,
    draw,
    matches,
    draws,
    roundPublications,
    read,
    setQualification(q: GroupQualificationProof) {
      qualification = q;
    },
  };
}
function qualify(f: ReturnType<typeof groupFixture>) {
  const current = f.read(),
    next = current.nextRound!;
  f.setQualification({
    id: id(920),
    sourceHash: current.qualification.sourceHash,
    sources: structuredClone(current.qualification.sources),
    slots: [...current.qualification.slots],
    drawIds: current.groups.flatMap((g) => (g.draw ? [g.draw.id] : [])),
  });
  f.matches.push(...next.fixtures.map((m) => scheduled(f.source, m)));
  return f.read();
}
function finishGroupGames(f: ReturnType<typeof groupFixture>) {
  for (let i = 0; i < f.matches.length; i++) f.matches[i] = final(f.matches[i]!);
  return f.read();
}
function bad(fn: () => unknown) {
  expect(fn).toThrowError(expect.objectContaining({ code: 'RESULT_SOURCE_INVALID' }));
}

describe('GK_BALANCED_V1 deterministic group stage', () => {
  it.each([
    [4, 2],
    [5, 2],
    [6, 2],
    [8, 4],
    [11, 4],
    [16, 8],
    [23, 8],
    [32, 2],
    [32, 4],
    [32, 8],
  ] as const)(
    '%i teams / %i groups: balanced, complete unique group pairs, separated seeds',
    (count, g) => {
      const f = groupFixture(count, g),
        again = generateGroupPairings(f.source, policy, seed, f.draw.config);
      expect(again).toEqual(f.draw);
      const sizes = f.draw.groups.map((group) => group.entryIds.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
      const seeded = new Set(f.draw.config.seededEntryIds);
      for (const group of f.draw.groups) {
        expect(group.entryIds.filter((e) => seeded.has(e))).toHaveLength(1);
        const games = f.draw.fixtures.filter((m) => group.entryIds.includes(m.homeEntryId));
        expect(games).toHaveLength((group.entryIds.length * (group.entryIds.length - 1)) / 2);
        expect(games.every((m) => group.entryIds.includes(m.awayEntryId))).toBe(true);
      }
      expect(f.draw.fixtures.every((m) => m.positionNo <= 16)).toBe(true);
      expect(new Set(f.draw.fixtures.map((m) => m.fixtureKey)).size).toBe(f.draw.fixtures.length);
      expect(f.read()).toMatchObject({
        totalMatchCount: f.draw.fixtures.length + g * 2 - 1,
        publishedMatchCount: f.draw.fixtures.length,
        isComplete: false,
        qualification: { status: 'WAITING' },
        nextRound: null,
      });
    },
  );
  it('rejects insufficient group size and invalid/duplicate/excess seed IDs', () => {
    for (const config of [
      { groupCount: 4, seededEntryIds: [] },
      { groupCount: 3, seededEntryIds: [] },
      { groupCount: 2, seededEntryIds: [id(1), id(1)] },
      { groupCount: 2, seededEntryIds: [id(1), id(2), id(3)] },
      { groupCount: 2, seededEntryIds: [id(99)] },
    ])
      expect(() => generateGroupPairings(freeze(4), policy, seed, config)).toThrow();
  });
  it('fixed cross-group seats separate both qualifiers until the final', () => {
    const f = groupFixture();
    const r = finishGroupGames(f);
    expect(r.qualification.status).toBe('READY');
    const [a, b] = r.groups;
    expect(r.qualification.slots).toEqual([
      a!.qualifiedEntryIds![0],
      b!.qualifiedEntryIds![1],
      b!.qualifiedEntryIds![0],
      a!.qualifiedEntryIds![1],
    ]);
    expect(r.nextRound!.roundNo).toBe(f.draw.groupRoundCount + 1);
    bad(() => {
      const q = {
        id: id(920),
        sourceHash: r.qualification.sourceHash,
        sources: r.qualification.sources,
        slots: [...r.qualification.slots].reverse(),
        drawIds: [],
      };
      return calculateGroupKnockout({
        publicationId,
        source: f.source,
        seed,
        policy,
        config: f.draw.config,
        rules,
        matches: f.matches,
        asOf,
        qualification: q,
      });
    });
  });
  it('three-way equal wins/difference/points blocks qualification and replays one persisted draw per group', () => {
    const f = groupFixture(6);
    for (let i = 0; i < f.matches.length; i++) {
      const m = f.matches[i]!,
        group = f.draw.groups.find((g) => g.entryIds.includes(m.home_entry_id))!,
        a = group.entryIds.indexOf(m.home_entry_id),
        b = group.entryIds.indexOf(m.away_entry_id),
        homeWins = (a + 1) % 3 === b;
      f.matches[i] = final(m, homeWins ? 10 : 8, homeWins ? 8 : 10);
    }
    let r = f.read();
    expect(r.qualification.status).toBe('TIE_BREAK_REQUIRED');
    expect(r.nextRound).toBeNull();
    for (const [i, g] of r.groups.entries()) {
      expect(g.unresolvedTieEntryIds).toHaveLength(3);
      const drawSeed = String(i + 1).repeat(64);
      f.draws.push({
        id: id(930 + i),
        groupKey: g.groupKey,
        sourceHash: g.standings.sourceHash,
        seed: drawSeed,
        tiedEntryIds: g.unresolvedTieEntryIds,
        orderedEntryIds: groupTieOrder(drawSeed, g.unresolvedTieEntryIds),
        reason: '合成同分公开抽签记录',
        createdAt: asOf,
      });
    }
    r = f.read();
    expect(r.qualification.status).toBe('READY');
    expect(r.groups.every((g) => g.draw && g.qualifiedEntryIds?.length === 2)).toBe(true);
    const saved = structuredClone(f.draws[0]!);
    f.draws[0]!.orderedEntryIds.reverse();
    bad(() => f.read());
    f.draws[0] = saved;
    qualify(f);
    while (!f.read().isComplete) {
      for (let i = 0; i < f.matches.length; i++)
        if (f.matches[i]!.status !== 'FINAL') f.matches[i] = final(f.matches[i]!);
      r = f.read();
      if (r.nextRound) {
        f.roundPublications.push({
          roundNo: r.nextRound.roundNo,
          sources: structuredClone(r.nextRound.sources),
        });
        f.matches.push(...r.nextRound.fixtures.map((m) => scheduled(f.source, m)));
      }
    }
    const complete = f.read();
    expect(complete.placements.filter((p) => p.stage === 'GROUP_ELIMINATED')).toHaveLength(2);
    expect(
      complete.placements
        .filter((p) => p.stage === 'GROUP_ELIMINATED')
        .every((p) => p.rank === null),
    ).toBe(true);
    expect(complete.placements).toHaveLength(6);
  });
  it('a legal same-group final rematch is retained; consumed sources survive safe staff version increments', () => {
    const f = groupFixture();
    finishGroupGames(f);
    const r = qualify(f),
      a = r.groups[0]!;
    for (let i = 0; i < f.matches.length; i++)
      if (f.matches[i]!.round_no > f.draw.groupRoundCount) {
        const m = f.matches[i]!,
          homeWins = a.participants.some((p) => p.entryId === m.home_entry_id);
        f.matches[i] = final(m, homeWins ? 10 : 8, homeWins ? 8 : 10);
      }
    let next = f.read().nextRound!;
    f.roundPublications.push({ roundNo: next.roundNo, sources: structuredClone(next.sources) });
    f.matches.push(...next.fixtures.map((m) => final(scheduled(f.source, m))));
    const complete = f.read();
    expect(complete.isComplete).toBe(true);
    const finalMatch = f.matches.at(-1)!;
    expect(a.participants.map((p) => p.entryId)).toContain(finalMatch.home_entry_id);
    expect(a.participants.map((p) => p.entryId)).toContain(finalMatch.away_entry_id);
    const hash = complete.sourceHash;
    const first = f.matches[0]!;
    first.version += 3;
    first.state.source_version = first.version;
    expect(f.read().sourceHash).toBe(hash);
    f.roundPublications[0]!.sources[0]!.matchVersion++;
    bad(() => f.read());
  });
  it.each([
    { tiebreakers: [] },
    { tiebreakers: ['SCORE_DIFFERENCE'] },
    { tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'] },
  ] as const)(
    'explicit %j tiebreakers never use stable row order as a qualification decision',
    ({ tiebreakers }) => {
      const f = groupFixture(6);
      for (let i = 0; i < f.matches.length; i++) {
        const m = f.matches[i]!,
          g = f.draw.groups.find((g) => g.entryIds.includes(m.home_entry_id))!,
          a = g.entryIds.indexOf(m.home_entry_id),
          b = g.entryIds.indexOf(m.away_entry_id);
        f.matches[i] = final(m, (a + 1) % 3 === b ? 10 : 8, (a + 1) % 3 === b ? 8 : 10);
      }
      const r = calculateGroupKnockout({
        publicationId,
        source: f.source,
        seed,
        policy,
        config: f.draw.config,
        rules: { ...rules, tiebreakers: [...tiebreakers] },
        matches: f.matches,
        asOf,
      });
      expect(r.qualification.status).toBe('TIE_BREAK_REQUIRED');
      expect(r.qualification.slots).toEqual([]);
    },
  );
  it('32 teams in two groups publish the first knockout at global round16 and final at17', () => {
    const f = groupFixture(32);
    let r = finishGroupGames(f);
    for (const [i, g] of r.groups.entries())
      if (g.unresolvedTieEntryIds.length) {
        const drawSeed = String(i + 1).repeat(64);
        f.draws.push({
          id: id(950 + i),
          groupKey: g.groupKey,
          sourceHash: g.standings.sourceHash,
          seed: drawSeed,
          tiedEntryIds: g.unresolvedTieEntryIds,
          orderedEntryIds: groupTieOrder(drawSeed, g.unresolvedTieEntryIds),
          reason: '合成大组同分审计抽签',
          createdAt: asOf,
        });
      }
    r = f.read();
    expect(r.groupRoundCount).toBe(15);
    expect(r.nextRound!.roundNo).toBe(16);
    qualify(f);
    for (let i = 0; i < f.matches.length; i++)
      if (f.matches[i]!.status !== 'FINAL') f.matches[i] = final(f.matches[i]!);
    r = f.read();
    expect(r.nextRound!.roundNo).toBe(17);
    f.roundPublications.push({ roundNo: r.nextRound!.roundNo, sources: r.nextRound!.sources });
    f.matches.push(...r.nextRound!.fixtures.map((m) => final(scheduled(f.source, m))));
    expect(f.read().isComplete).toBe(true);
    expect(f.read().totalMatchCount).toBe(243);
  });
});

describe('X01 eight-team sixteen-game group and placement flow', () => {
  it('twelve group games, two semifinals, final and genuine loser bronze', () => {
    const f = groupFixture(8, 2, { ...policy, thirdPlaceMatch: true } as SchedulePolicy);
    let c = finishGroupGames(f);
    for (const [i, g] of c.groups.entries()) {
      if (!g.unresolvedTieEntryIds.length) continue;
      const drawSeed = String(i + 1).repeat(64);
      f.draws.push({
        id: id(930 + i),
        groupKey: g.groupKey,
        sourceHash: g.standings.sourceHash,
        seed: drawSeed,
        tiedEntryIds: g.unresolvedTieEntryIds,
        orderedEntryIds: groupTieOrder(drawSeed, g.unresolvedTieEntryIds),
        reason: '合成季军赛组内同分抽签',
        createdAt: asOf,
      });
    }
    c = qualify(f);
    expect(f.draw.fixtures).toHaveLength(12);
    expect(c.totalMatchCount).toBe(16);
    for (let i = 0; i < f.matches.length; i++)
      if (f.matches[i]!.status !== 'FINAL') f.matches[i] = final(f.matches[i]!);
    c = f.read();
    const next = c.nextRound!;
    expect(next.fixtures).toHaveLength(2);
    expect(next.sources).toHaveLength(2);
    f.roundPublications.push({ roundNo: next.roundNo, sources: structuredClone(next.sources) });
    f.matches.push(...next.fixtures.map((m) => scheduled(f.source, m)));
    expect(f.read().bracket!.rounds.at(-1)!.slots[1]).toMatchObject({
      kind: 'THIRD_PLACE',
      sourceOutcome: 'LOSER',
    });
    for (let i = 0; i < f.matches.length; i++)
      if (f.matches[i]!.status !== 'FINAL') f.matches[i] = final(f.matches[i]!);
    c = f.read();
    expect(c.isComplete).toBe(true);
    expect(c.confirmedMatchCount).toBe(16);
    expect(c.publishedMatchCount).toBe(16);
    expect(
      c.placements
        .filter((p) => p.stage === 'KNOCKOUT')
        .map((p) => p.rank)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
    expect(
      c.placements.filter((p) => p.stage === 'GROUP_ELIMINATED').every((p) => p.rank === null),
    ).toBe(true);
  });
});

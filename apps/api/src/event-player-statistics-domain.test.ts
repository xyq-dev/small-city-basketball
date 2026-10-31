import { describe, expect, test } from 'vitest';
import type { RegistrationFreezeData, SchedulePolicy } from '@small-city-basketball/contracts';
import { generateKnockoutPairings } from './knockout-domain.js';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';
import { calculateEventPlayerStatistics } from './event-player-statistics-domain.js';
import type { ResultRow } from './standings-domain.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const participant = (n: number) => ({
  entryId: id(10 + n),
  teamId: id(20 + n),
  teamName: `球队${n}`,
  rosterRevisionId: id(30 + n),
});
const roster = (n: number) => [
  { memberId: id(100 + n * 2), name: '合成同名', jerseyNo: '0' },
  { memberId: id(101 + n * 2), name: `合成${n}乙`, jerseyNo: '00' },
];
function final(n = 1, h = 1, a = 2, mode = 'PLAYER_BASIC'): ResultRow {
  const home = participant(h),
    away = participant(a);
  const stats = {
    mode: 'PLAYER_BASIC',
    home: {
      players: roster(h).map((p, i) => ({ ...p, score: i ? 0 : 2, fouls: i ? 0 : 2 })),
      unassigned: { score: 1, fouls: 0 },
    },
    away: {
      players: roster(a).map((p, i) => ({ ...p, score: i ? 0 : 2, fouls: i ? 0 : 1 })),
      unassigned: { score: 0, fouls: 1 },
    },
  };
  const periods = [
    {
      period: 1,
      home: { score: 3, fouls: 2, timeouts: 0 },
      away: { score: 2, fouls: 2, timeouts: 0 },
    },
  ];
  const totals = {
    home_score: 3,
    away_score: 2,
    home_fouls: 2,
    away_fouls: 2,
    home_timeouts: 0,
    away_timeouts: 0,
    period_stats: periods,
    collection_mode: mode,
    player_stats: mode === 'TEAM_ONLY' ? null : stats,
  };
  return {
    id: id(200 + n),
    status: 'FINAL',
    version: 9,
    home_entry_id: home.entryId,
    away_entry_id: away.entryId,
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_team_name: home.teamName,
    away_team_name: away.teamName,
    home_roster_revision_id: home.rosterRevisionId,
    away_roster_revision_id: away.rosterRevisionId,
    home_roster: roster(h),
    away_roster: roster(a),
    state: {
      ...structuredClone(totals),
      source_version: 9,
      ruleset_id: id(800),
      period: 1,
      clock_running: false,
      remaining_ms: 0,
      last_event_seq: 7,
      latest_confirmation_id: id(1200 + n),
      requires_reconfirmation: false,
    },
    confirmation: {
      ...structuredClone(totals),
      id: id(1200 + n),
      match_id: id(200 + n),
      ruleset_id: id(800),
      ruleset_version: 1,
      confirming_user_id: id(900),
      source_match_version: 8,
      last_event_seq: 6,
    },
    last_event: {
      seq: 7,
      type: 'CONFIRM_RESULT',
      actor_id: id(900),
      target_event_id: null,
      payload: {},
      command_id: id(2200 + n),
    },
    last_command: {
      command_id: id(2200 + n),
      actor_id: id(900),
      command_type: 'CONFIRM_RESULT',
      applied_version: 9,
      first_event_seq: 7,
      last_event_seq: 7,
    },
    scoring_rules: { id: id(800), version: 1, tie_policy: 'ALLOW_DRAW', regulation_periods: 1 },
  };
}
function calculate(matches = [final()], count = 2, asOf = '2026-10-23T12:00:00.000Z') {
  return calculateEventPlayerStatistics({
    publicationId: id(700),
    source: { entries: Array.from({ length: count }, (_, i) => participant(i + 1)) },
    matches,
    asOf,
  });
}
function invalid(run: () => unknown) {
  expect(run).toThrowError(expect.objectContaining({ status: 409, code: 'RESULT_SOURCE_INVALID' }));
}

describe('C03 current personal confirmation proof', () => {
  test('valid personal results are returned as a fresh whitelist, and team-only/pending results have no sample', () => {
    const match = final();
    const result = confirmedPlayerStatistics(match);
    expect(result).toEqual(match.confirmation.player_stats);
    expect(result).not.toBe(match.confirmation.player_stats);
    expect(confirmedPlayerStatistics(final(1, 1, 2, 'TEAM_ONLY'))).toBeNull();
    expect(
      confirmedPlayerStatistics({
        status: 'PENDING_CONFIRMATION',
        confirmation: match.confirmation,
      }),
    ).toBeNull();
  });

  test.each([
    [
      'different mode',
      (m: ResultRow) => {
        m.state.collection_mode = 'TEAM_ONLY';
      },
    ],
    [
      'missing mode',
      (m: ResultRow) => {
        delete m.confirmation.collection_mode;
      },
    ],
    [
      'different current statistics',
      (m: ResultRow) => {
        m.state.player_stats.home.players[0].score++;
      },
    ],
    [
      'unknown stored field',
      (m: ResultRow) => {
        m.state.player_stats.secret = m.confirmation.player_stats.secret = 'private';
      },
    ],
    [
      'wrong team total',
      (m: ResultRow) => {
        m.state.player_stats.home.unassigned.score =
          m.confirmation.player_stats.home.unassigned.score = 2;
      },
    ],
    [
      'negative stat',
      (m: ResultRow) => {
        m.state.player_stats.home.players[0].score =
          m.confirmation.player_stats.home.players[0].score = -1;
      },
    ],
    [
      'unsafe stat',
      (m: ResultRow) => {
        m.state.player_stats.home.players[0].score =
          m.confirmation.player_stats.home.players[0].score = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'wrong confirmation pointer',
      (m: ResultRow) => {
        m.state.latest_confirmation_id = id(999);
      },
    ],
    [
      'missing command receipt',
      (m: ResultRow) => {
        m.last_command = null;
      },
    ],
    [
      'requires reconfirmation',
      (m: ResultRow) => {
        m.state.requires_reconfirmation = true;
      },
    ],
    [
      'null personal results',
      (m: ResultRow) => {
        m.state.player_stats = m.confirmation.player_stats = null;
      },
    ],
    [
      'team-only leaking personal results',
      (m: ResultRow) => {
        m.state.collection_mode = m.confirmation.collection_mode = 'TEAM_ONLY';
      },
    ],
  ])('rejects corrupt FINAL source: %s', (_label, corrupt) => {
    const match = final();
    corrupt(match);
    invalid(() => confirmedPlayerStatistics(match));
  });
});

describe('C03 private confirmed-only event statistics', () => {
  test('tracks coverage separately from unassigned totals and preserves zero-score frozen samples', () => {
    const summary = calculate();
    expect(summary).toMatchObject({
      totalMatchCount: 1,
      includedMatchCount: 1,
      teamOnlyConfirmedMatchCount: 0,
      pendingMatchCount: 0,
      coverageComplete: true,
      attributionComplete: false,
    });
    expect(summary.rows).toHaveLength(4);
    expect(summary.rows.map((p) => [p.score, p.rank, p.tied])).toEqual([
      [2, 1, true],
      [2, 1, true],
      [0, 3, true],
      [0, 3, true],
    ]);
    expect(summary.rows.filter((p) => p.score === 2).map((p) => p.fouls)).toEqual([2, 1]);
    expect(summary.rows.every((p) => p.rosterSampleMatchCount === 1)).toBe(true);
    expect(summary.rows.filter((p) => p.name === '合成同名')).toHaveLength(2);
    expect(summary.rows[0]).not.toHaveProperty('played');
    expect(summary.rows[0]).not.toHaveProperty('average');
    expect(summary.teams).toEqual([
      {
        entryId: participant(1).entryId,
        teamName: '球队1',
        attributedScore: 2,
        unassignedScore: 1,
        attributedFouls: 2,
        unassignedFouls: 0,
      },
      {
        entryId: participant(2).entryId,
        teamName: '球队2',
        attributedScore: 2,
        unassignedScore: 0,
        attributedFouls: 1,
        unassignedFouls: 1,
      },
    ]);
  });

  test('mixed personal, team-only and pending matches only aggregate effective personal samples', () => {
    const pending = { ...final(3, 2, 3), status: 'PENDING_CONFIRMATION' };
    const summary = calculate([final(1, 1, 2), final(2, 1, 3, 'TEAM_ONLY'), pending], 3);
    expect(summary).toMatchObject({
      totalMatchCount: 3,
      includedMatchCount: 1,
      teamOnlyConfirmedMatchCount: 1,
      pendingMatchCount: 1,
      coverageComplete: false,
    });
    expect(summary.rows).toHaveLength(4);
    expect(summary.rows.some((p) => p.entryId === participant(3).entryId)).toBe(false);
    expect(summary.teams).toHaveLength(3);
    expect(summary.teams[2]).toMatchObject({
      attributedScore: 0,
      unassignedScore: 0,
      attributedFouls: 0,
      unassignedFouls: 0,
    });
  });

  test('no personal confirmations means an empty leaderboard and no claim of complete attribution', () => {
    for (const match of [final(1, 1, 2, 'TEAM_ONLY'), { ...final(), status: 'LIVE' }]) {
      const summary = calculate([match]);
      expect(summary).toMatchObject({
        includedMatchCount: 0,
        rows: [],
        coverageComplete: false,
        attributionComplete: false,
      });
      expect(summary.teams).toHaveLength(2);
      expect(summary.teamOnlyConfirmedMatchCount + summary.pendingMatchCount).toBe(1);
    }
  });

  test('complete attribution requires no unassigned points or fouls in collected samples', () => {
    const m = final();
    for (const holder of [m.state, m.confirmation]) {
      holder.player_stats.home.players[0].score++;
      holder.player_stats.home.unassigned.score = 0;
      holder.player_stats.away.players[0].fouls++;
      holder.player_stats.away.unassigned.fouls = 0;
    }
    expect(calculate([m]).attributionComplete).toBe(true);
  });

  test('reopening removes the complete match sample and reconfirmation selects its new identity', () => {
    const original = final();
    const before = calculate([original]);
    const open = structuredClone(original);
    open.status = 'PENDING_CONFIRMATION';
    expect(calculate([open])).toMatchObject({
      rows: [],
      includedMatchCount: 0,
      pendingMatchCount: 1,
    });
    const reconfirmed = structuredClone(original);
    reconfirmed.confirmation.id = reconfirmed.state.latest_confirmation_id = id(9999);
    const after = calculate([reconfirmed]);
    expect(after.rows).toEqual(before.rows);
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });

  test('aggregation and hash are stable under source ordering and asOf changes, and count roster samples per fixed identity', () => {
    const matches = [final(1, 1, 2), final(2, 1, 3), final(3, 2, 3)];
    const before = calculate(matches, 3);
    const reordered = structuredClone(matches).reverse();
    for (const m of reordered) {
      m.home_roster.reverse();
      m.away_roster.reverse();
      for (const source of [m.state, m.confirmation]) {
        source.player_stats.home.players.reverse();
        source.player_stats.away.players.reverse();
      }
    }
    const after = calculate(reordered, 3, '2026-10-24T12:00:00.000Z');
    expect(after.sourceHash).toBe(before.sourceHash);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(6);
    expect(after.rows.every((p) => p.rosterSampleMatchCount === 2)).toBe(true);
    expect(after.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([
    [
      'missing fixed roster',
      (m: ResultRow) => {
        m.home_roster = null;
      },
    ],
    [
      'wrong frozen name',
      (m: ResultRow) => {
        m.home_roster[0].name = '别名';
      },
    ],
    [
      'wrong frozen number',
      (m: ResultRow) => {
        m.home_roster[0].jerseyNo = '99';
      },
    ],
    [
      'wrong roster identity',
      (m: ResultRow) => {
        m.home_roster[0].memberId = id(999);
      },
    ],
    [
      'duplicate roster member',
      (m: ResultRow) => {
        m.home_roster.push(m.home_roster[0]);
      },
    ],
    [
      'wrong revision',
      (m: ResultRow) => {
        m.home_roster_revision_id = id(999);
      },
    ],
    [
      'wrong team identity',
      (m: ResultRow) => {
        m.home_team_id = id(999);
      },
    ],
    [
      'wrong team name',
      (m: ResultRow) => {
        m.home_team_name = '别队';
      },
    ],
  ])('rejects published/frozen identity mismatch: %s', (_label, corrupt) => {
    const match = final();
    corrupt(match);
    invalid(() => calculate([match]));
  });

  test('rejects incomplete or repeated publications rather than producing a partial plausible leaderboard', () => {
    invalid(() => calculate([], 2));
    invalid(() => calculate([final(), final(), final(3, 2, 3)], 3));
    invalid(() => calculate([final(1, 1, 2), final(2, 1, 2), final(3, 2, 3)], 3));
  });
});

const koPolicy: SchedulePolicy = {
  slotDurationMinutes: 30,
  minRestMinutes: 0,
  minLocalDayGap: 0,
  courtWindows: [
    { courtId: id(4500), startsAt: '2026-10-23T00:00:00.000Z', endsAt: '2026-10-23T23:59:00.000Z' },
  ],
};
function knockoutInput(count: number) {
  const source: RegistrationFreezeData = {
    id: id(4000),
    eventId: id(4001),
    rulesetId: id(4002),
    rulesetVersion: 1,
    eventVersion: 3,
    entries: Array.from({ length: count }, (_, index) => ({
      ...participant(index + 1),
      players: roster(index + 1),
    })),
    excludedCounts: { DRAFT: 0, REJECTED: 0, WITHDRAWN: 0 },
    createdAt: '2026-10-23T00:00:00.000Z',
  };
  const seed = '1'.repeat(64);
  const draw = generateKnockoutPairings(source, koPolicy, seed);
  const matches: ResultRow[] = draw.fixtures.map((fixture, index) => {
    const h = source.entries.findIndex((p) => p.entryId === fixture.homeEntryId) + 1;
    const a = source.entries.findIndex((p) => p.entryId === fixture.awayEntryId) + 1;
    const match = final(index + 1, h, a);
    return {
      ...match,
      event_id: source.eventId,
      publication_id: id(700),
      revision_id: id(4003),
      fixture_key: fixture.fixtureKey,
      round_no: fixture.roundNo,
      position_no: fixture.positionNo,
      court_id: id(4500),
      court_name: '合成场地',
      starts_at: '2026-10-23T01:00:00.000Z',
      ends_at: '2026-10-23T01:30:00.000Z',
      scoring_rules: { ...match.scoring_rules, tie_policy: 'OVERTIME' },
    };
  });
  return {
    publicationId: id(700),
    source,
    seed,
    policy: koPolicy,
    matches,
    asOf: '2026-10-23T12:00:00.000Z',
    format: 'SINGLE_ELIMINATION' as const,
  };
}
describe('C04 private player coverage over original knockout results', () => {
  test('first-round completion does not claim complete event coverage, and byes add no samples', () => {
    const result = calculateEventPlayerStatistics(knockoutInput(3));
    expect(result).toMatchObject({
      totalMatchCount: 2,
      includedMatchCount: 1,
      pendingMatchCount: 1,
      coverageComplete: false,
    });
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((row) => row.rosterSampleMatchCount === 1)).toBe(true);
  });
  test('a two-team confirmed final completes coverage without inventing appearances or advanced metrics', () => {
    const result = calculateEventPlayerStatistics(knockoutInput(2));
    expect(result).toMatchObject({
      totalMatchCount: 1,
      includedMatchCount: 1,
      pendingMatchCount: 0,
      coverageComplete: true,
      attributionComplete: false,
    });
    expect(result.rows[0]).not.toHaveProperty('appearances');
    expect(result.rows[0]).not.toHaveProperty('rebounds');
  });
  test('unconfirmed score and clock changes never change the confirmed-only summary hash', () => {
    const input = knockoutInput(3);
    input.matches[0]!.status = 'LIVE';
    const before = calculateEventPlayerStatistics(input);
    input.matches[0]!.state.home_score = 100;
    input.matches[0]!.state.clock_running = true;
    input.matches[0]!.state.remaining_ms = 100;
    expect(calculateEventPlayerStatistics(input).sourceHash).toBe(before.sourceHash);
    expect(before).toMatchObject({
      totalMatchCount: 2,
      includedMatchCount: 0,
      pendingMatchCount: 2,
      coverageComplete: false,
    });
  });
});

describe('X08 double round-robin individual samples', () => {
  const base = () => ({
    publicationId: id(700),
    source: { entries: [participant(1), participant(2)] },
    matches: [final(1, 1, 2), final(2, 2, 1)],
    asOf: '2026-10-31T00:00:00Z',
    format: 'DOUBLE_ROUND_ROBIN' as any,
  });
  test('home/away return leg yields two samples without inventing appearances', () => {
    const result = calculateEventPlayerStatistics(base());
    expect(result.totalMatchCount).toBe(2);
    expect(result.includedMatchCount).toBe(2);
    expect(result.coverageComplete).toBe(true);
    expect(result.rows[0]!.rosterSampleMatchCount).toBe(2);
    expect(result.rows[0]).not.toHaveProperty('appearances');
  });
  test('rejects a missing return leg and two copies of the same home-away orientation', () => {
    const missing = base();
    missing.matches.pop();
    expect(() => calculateEventPlayerStatistics(missing)).toThrow();
    const duplicate = base();
    duplicate.matches[1] = final(2, 1, 2);
    expect(() => calculateEventPlayerStatistics(duplicate)).toThrow();
  });
});

function adjudicated(m: ResultRow, kind = 'FORFEIT') {
  m.status = 'SCHEDULED';
  m.version = 2;
  m.state = null;
  m.confirmation = null;
  m.last_event = null;
  m.last_command = null;
  m.event_id = id(8000);
  m.fixture_key = 'R1-P1';
  const request = {
    id: id(8001),
    match_id: m.id,
    event_id: m.event_id,
    status: 'APPROVED',
    operation: 'DECLARE',
    version: 2,
    proposed_by: id(8002),
    reviewed_by: id(8003),
    reviewed_at: '2026-10-31T00:00:00Z',
    source_match_version: 1,
    rules_id: id(8004),
    rules_version: 1,
    kind,
    forfeiting_side: kind === 'FORFEIT' ? 'HOME' : null,
    winner_entry_id: kind === 'FORFEIT' ? m.away_entry_id : null,
    loser_entry_id: kind === 'FORFEIT' ? m.home_entry_id : null,
  };
  return {
    ...m,
    exception_checked: true,
    exception_head: { version: 2, active_request_id: request.id },
    exception_request: request,
    exception_rules: {
      id: id(8004),
      event_id: m.event_id,
      version: 1,
      forfeit_win_points: 2,
      forfeit_loss_points: 0,
      cancellation_policy: 'EXCLUDE_FROM_TABLE',
    },
  };
}
describe('administrative resolutions excluded from individual statistical samples', () => {
  test.each(['FORFEIT', 'CANCELLED'])(
    '%s never creates a zero-point appearance or pending confirmation',
    (kind) => {
      const result = calculate([adjudicated(final(), kind)]);
      expect(result).toMatchObject({
        totalMatchCount: 1,
        recordableMatchCount: 0,
        excludedAdministrativeMatchCount: 1,
        pendingMatchCount: 0,
        includedMatchCount: 0,
        teamOnlyConfirmedMatchCount: 0,
        coverageComplete: false,
        rows: [],
      });
    },
  );
  test('mixed real and administrative games use only recordable games for coverage', () => {
    const result = calculate([adjudicated(final(1, 1, 2)), final(2, 1, 3), final(3, 2, 3)], 3);
    expect(result).toMatchObject({
      totalMatchCount: 3,
      recordableMatchCount: 2,
      excludedAdministrativeMatchCount: 1,
      pendingMatchCount: 0,
      includedMatchCount: 2,
      coverageComplete: true,
    });
    expect(
      result.rows.filter((p) => p.entryId === id(11)).every((p) => p.rosterSampleMatchCount === 1),
    ).toBe(true);
  });
  test('incomplete explicit administrative join proof fails closed', () => {
    const m = adjudicated(final());
    delete (m as any).exception_rules;
    expect(() => calculate([m])).toThrowError(
      expect.objectContaining({ code: 'RESULT_SOURCE_INVALID' }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../standings-domain.js';
import { performanceProjection } from './performance-domain.js';
import type { PerformanceSample } from './performance-domain.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = (n: number) => ({ memberId: uuid(n), name: `合成球员${n}`, jerseyNo: String(n) });
function match(n = 1, points = 2, mode = 'PLAYER_BASIC', unassigned = 0): ResultRow {
  const stats = {
    mode: 'PLAYER_BASIC',
    home: {
      players: [{ ...member(1), score: points, fouls: 1 }],
      unassigned: { score: unassigned, fouls: 0 },
    },
    away: { players: [{ ...member(2), score: 1, fouls: 0 }], unassigned: { score: 0, fouls: 0 } },
  };
  const periods = [
    {
      period: 1,
      home: { score: points + unassigned, fouls: 1, timeouts: 0 },
      away: { score: 1, fouls: 0, timeouts: 0 },
    },
  ];
  const totals = {
    home_score: points + unassigned,
    home_fouls: 1,
    home_timeouts: 0,
    away_score: 1,
    away_fouls: 0,
    away_timeouts: 0,
    period_stats: periods,
    collection_mode: mode,
    player_stats: mode === 'TEAM_ONLY' ? null : stats,
  };
  return {
    id: uuid(100 + n),
    status: 'FINAL',
    version: 9,
    home_team_id: uuid(10),
    away_team_id: uuid(20),
    home_entry_id: uuid(30),
    away_entry_id: uuid(40),
    home_roster: [member(1)],
    away_roster: [member(2)],
    state: {
      ...structuredClone(totals),
      source_version: 9,
      ruleset_id: uuid(50),
      period: 1,
      clock_running: false,
      remaining_ms: 0,
      last_event_seq: 7,
      latest_confirmation_id: uuid(200 + n),
      requires_reconfirmation: false,
    },
    confirmation: {
      ...structuredClone(totals),
      id: uuid(200 + n),
      match_id: uuid(100 + n),
      ruleset_id: uuid(50),
      ruleset_version: 1,
      confirming_user_id: uuid(60),
      source_match_version: 8,
      last_event_seq: 6,
    },
    last_event: {
      seq: 7,
      type: 'CONFIRM_RESULT',
      actor_id: uuid(60),
      target_event_id: null,
      payload: {},
      command_id: uuid(300 + n),
    },
    last_command: {
      command_id: uuid(300 + n),
      actor_id: uuid(60),
      command_type: 'CONFIRM_RESULT',
      applied_version: 9,
      first_event_seq: 7,
      last_event_seq: 7,
    },
    scoring_rules: { id: uuid(50), version: 1, tie_policy: 'ALLOW_DRAW', regulation_periods: 1 },
  };
}
function sample(proof = match(), day = 1): PerformanceSample {
  return {
    teamId: uuid(10),
    memberId: uuid(1),
    eventName: '合成比赛',
    format: 'ROUND_ROBIN',
    date: `2026-10-${String(day).padStart(2, '0')}`,
    startsAt: `2026-10-${String(day).padStart(2, '0')}T11:30:00.000Z`,
    proof,
  };
}
function project(samples = [sample()], sourceCount = 1) {
  return performanceProjection({
    profileId: uuid(70),
    sourceCount,
    completedServiceCount: 3,
    samples,
    asOf: '2026-10-24T00:00:00.000Z',
  });
}

describe('C07 limited personal performance projection', () => {
  it('reuses the current independent confirmation and exposes no private identity or proof fields', () => {
    const proof = match();
    proof.private_email = 'never@example.test';
    proof.lease_secret = 'never-public';
    const result = project([sample(proof)]);
    expect(result).toMatchObject({
      dataStatus: 'AVAILABLE',
      recordedMatchCount: 1,
      totalPoints: 2,
      totalFouls: 1,
      pointsPerRecordedMatch: 2,
      completedServiceCount: 3,
      rebounds: null,
      assists: null,
      minutes: null,
      fieldGoalPercentage: null,
    });
    expect(result.recentRecords[0]).toMatchObject({
      points: 2,
      fouls: 1,
      attributionComplete: true,
      source: 'INDEPENDENT_CONFIRMATION',
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('never-public');
    expect(json).not.toContain('never@example.test');
    expect(json).not.toContain(uuid(1));
    expect(json).not.toContain(uuid(101));
    expect(json).not.toContain('confirmation');
  });
  it('shows null rather than invented zero when there is no authorized personal sample', () => {
    expect(project([], 0)).toMatchObject({
      dataStatus: 'NO_AUTHORIZED_SOURCE',
      recordedMatchCount: 0,
      totalPoints: null,
      totalFouls: null,
      pointsPerRecordedMatch: null,
      recentRecords: [],
    });
    expect(project([])).toMatchObject({
      dataStatus: 'NO_PERSONAL_STATS',
      recordedMatchCount: 0,
      totalPoints: null,
    });
  });
  it('distinguishes a real recorded zero from unknown playing time or no sample', () => {
    const result = project([sample(match(1, 0))]);
    expect(result.totalPoints).toBe(0);
    expect(result.recordedMatchCount).toBe(1);
    expect(result.recentRecords[0]?.points).toBe(0);
    expect(result.minutes).toBeNull();
    expect(result.denominatorNotice).toContain('不代表实际出场次数');
  });
  it('does not treat a TEAM_ONLY confirmation as a zero-valued personal appearance', () => {
    const result = project([sample(match(1, 7, 'TEAM_ONLY'))]);
    expect(result).toMatchObject({
      dataStatus: 'NO_PERSONAL_STATS',
      confirmedMatchCount: 1,
      teamOnlyMatchCount: 1,
      recordedMatchCount: 0,
      totalPoints: null,
    });
    expect(result.recentRecords[0]).toMatchObject({
      collectionMode: 'TEAM_ONLY',
      points: null,
      fouls: null,
      attributionComplete: null,
    });
  });
  it('drops the old confirmation immediately after reopening even if old data remains stored', () => {
    const proof = match();
    proof.status = 'PENDING_CONFIRMATION';
    expect(project([sample(proof)])).toMatchObject({
      recordedMatchCount: 0,
      pendingMatchCount: 1,
      totalPoints: null,
      recentRecords: [],
    });
  });
  it('marks an invalid current confirmation partial and never falls back to stale scores', () => {
    const proof = match();
    proof.state.requires_reconfirmation = true;
    expect(project([sample(proof)])).toMatchObject({
      dataStatus: 'PARTIAL',
      invalidMatchCount: 1,
      recordedMatchCount: 0,
      totalPoints: null,
      recentRecords: [],
    });
  });
  it('deduplicates the same current match across repeated source rows', () => {
    const s = sample();
    expect(project([s, structuredClone(s)])).toMatchObject({
      recordedMatchCount: 1,
      totalPoints: 2,
      confirmedMatchCount: 1,
    });
    expect(project([s, s]).recentRecords).toHaveLength(1);
  });
  it('requires exact frozen-roster identity even if state and confirmation agree on a forged member', () => {
    const proof = match();
    proof.state.player_stats.home.players[0].memberId = uuid(99);
    proof.confirmation.player_stats.home.players[0].memberId = uuid(99);
    expect(project([sample(proof)])).toMatchObject({
      dataStatus: 'PARTIAL',
      invalidMatchCount: 1,
      totalPoints: null,
    });
  });
  it('cannot attribute the other team member to the nominated team', () => {
    const s = sample();
    s.memberId = uuid(2);
    expect(project([s])).toMatchObject({
      invalidMatchCount: 1,
      recordedMatchCount: 0,
      totalPoints: null,
    });
  });
  it('keeps unassigned team points separate and marks attribution incomplete', () => {
    const result = project([sample(match(1, 2, 'PLAYER_BASIC', 3))]);
    expect(result).toMatchObject({
      dataStatus: 'PARTIAL',
      totalPoints: 2,
      partialAttributionMatchCount: 1,
      recordedMatchCount: 1,
    });
    expect(result.recentRecords[0]?.attributionComplete).toBe(false);
    expect(result.completenessNotice).toContain('未归属');
  });
  it('uses recorded roster samples as the denominator and returns only the most recent five', () => {
    const samples = Array.from({ length: 7 }, (_, i) => sample(match(i + 1, i), i + 1));
    const result = project(samples);
    expect(result).toMatchObject({
      recordedMatchCount: 7,
      totalPoints: 21,
      pointsPerRecordedMatch: 3,
    });
    expect(result.recentRecords).toHaveLength(5);
    expect(result.recentRecords[0]?.date).toBe('2026-10-07');
    expect(result.recentRecords.at(-1)?.date).toBe('2026-10-03');
  });
});

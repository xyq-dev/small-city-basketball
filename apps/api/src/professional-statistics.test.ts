import { describe, expect, it } from 'vitest';
import type {
  MatchPlayerRoster,
  ScoringEventData,
  ScoringRules,
  ScoringCommandInput,
} from '@small-city-basketball/contracts';
import {
  projectProfessionalStatistics,
  professionalStatisticsDto,
} from './professional-statistics.js';
import { parseScoringCommand, planCommand, replayStats } from './scoring-domain.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rules: ScoringRules = {
  regulationPeriods: 2,
  periodDurationSeconds: 60,
  allowedScoreValues: [1, 2, 3],
  tiePolicy: 'OVERTIME',
  overtimeDurationSeconds: 30,
};
const roster: MatchPlayerRoster = {
  home: [
    { memberId: id(1), name: '甲', jerseyNo: '1' },
    { memberId: id(2), name: '乙', jerseyNo: '2' },
  ],
  away: [{ memberId: id(3), name: '丙', jerseyNo: '3' }],
};
const time = (n: number) => new Date(Date.parse('2026-10-31T00:00:00Z') + n * 1000).toISOString();
function history() {
  const events: ScoringEventData[] = [];
  const add = (
    type: string,
    payload: Record<string, unknown> = {},
    second = 0,
    targetEventId: string | null = null,
  ) => {
    const e: ScoringEventData = {
      id: id(100 + events.length),
      seq: events.length + 1,
      type,
      payload,
      actorId: id(80),
      commandId: id(200 + events.length),
      capturedAt: time(second),
      serverTime: time(second),
      targetEventId,
    };
    events.push(e);
    return e;
  };
  add('PREPARE_MATCH', { collectionMode: 'PLAYER_BASIC', technicalCollection: true });
  add('SET_LINEUP', { side: 'HOME', memberIds: [id(1)] });
  add('SET_LINEUP', { side: 'AWAY', memberIds: [id(3)] });
  add('START_MATCH');
  return { events, add };
}
function command(type: string, payload: unknown): ScoringCommandInput {
  return parseScoringCommand({
    type,
    payload,
    commandId: id(90),
    expectedVersion: 1,
    capturedAt: time(0),
    control: { leaseId: id(91), fencingToken: '1', clientInstanceId: id(92) },
  });
}
describe('professional statistics over the original scoring stream', () => {
  it('does not invent collection or professional zeroes for old games', () => {
    expect(projectProfessionalStatistics([], rules, roster)).toBeNull();
    const h = history();
    h.events[0]!.payload = { collectionMode: 'PLAYER_BASIC' };
    expect(projectProfessionalStatistics(h.events, rules, roster)).toBeNull();
  });
  it('rejects technical acquisition without explicit player mode', () => {
    const h = history();
    h.events[0]!.payload.collectionMode = 'TEAM_ONLY';
    expect(() => projectProfessionalStatistics(h.events, rules, roster)).toThrow();
  });
  it('counts attempts separately and never adds assist/rebound points', () => {
    const h = history();
    h.add('STAT_RECORDED', {
      kind: 'SCORE',
      side: 'HOME',
      memberId: id(1),
      value: 3,
      period: 1,
      shot: { shotValue: 3, made: true },
    });
    h.add('PRO_STAT_RECORDED', {
      kind: 'SHOT',
      side: 'HOME',
      memberId: id(1),
      shotValue: 2,
      made: false,
      period: 1,
    });
    h.add('PRO_STAT_RECORDED', { kind: 'ASSIST', side: 'HOME', memberId: id(1), period: 1 });
    h.add('PRO_STAT_RECORDED', { kind: 'REBOUND', side: 'HOME', memberId: id(1), period: 1 });
    const p = projectProfessionalStatistics(h.events, rules, roster)!.home.players[0]!;
    expect(p).toMatchObject({
      fieldGoalsMade: 1,
      fieldGoalsAttempted: 2,
      fieldGoalPercentage: 50,
      threePointersMade: 1,
      threePointersAttempted: 1,
      threePointPercentage: 100,
      freeThrowPercentage: null,
      assists: 1,
      rebounds: 1,
    });
    expect(replayStats(h.events, rules, 1).home.score).toBe(3);
  });
  it('voiding a made shot removes both score and shooting statistics', () => {
    const h = history();
    const shot = h.add('STAT_RECORDED', {
      kind: 'SCORE',
      side: 'HOME',
      memberId: id(1),
      value: 2,
      period: 1,
      shot: { shotValue: 2, made: true },
    });
    h.add('STAT_VOIDED', { reason: '错误' }, 0, shot.id);
    expect(replayStats(h.events, rules, 1).home.score).toBe(0);
    expect(
      projectProfessionalStatistics(h.events, rules, roster)!.home.players[0]!.fieldGoalsAttempted,
    ).toBe(0);
  });
  it('voids a missed shot or technical count without touching the score', () => {
    const h = history();
    const shot = h.add('PRO_STAT_RECORDED', {
      kind: 'SHOT',
      side: 'HOME',
      memberId: id(1),
      shotValue: 1,
      made: false,
      period: 1,
    });
    h.add('PRO_STAT_VOIDED', { reason: '错误' }, 0, shot.id);
    expect(
      projectProfessionalStatistics(h.events, rules, roster)!.home.players[0]!.freeThrowsAttempted,
    ).toBe(0);
    expect(replayStats(h.events, rules, 1).home.score).toBe(0);
  });
  it('tracks actual clock-running segments; clock corrections never add or subtract time', () => {
    const h = history();
    h.add('CLOCK_START', {}, 0);
    h.add('CLOCK_PAUSE', {}, 10);
    h.add('CLOCK_SET', { remainingMs: 60000, reason: '校时' }, 12);
    h.add('SUBSTITUTE_PLAYER', { side: 'HOME', outMemberId: id(1), inMemberId: id(2) }, 15);
    h.add('CLOCK_START', {}, 20);
    h.add('CLOCK_PAUSE', {}, 25);
    const p = projectProfessionalStatistics(h.events, rules, roster)!;
    expect(p.elapsedPlayingMs).toBe(15000);
    expect(
      p.home.players.map((p) => ({ time: p.playingMs, starter: p.starter, appeared: p.appeared })),
    ).toEqual([
      { time: 10000, starter: true, appeared: true },
      { time: 5000, starter: false, appeared: true },
    ]);
    expect(p.away.players[0]!.playingMs).toBe(15000);
  });
  it('caps running time at period zero and supports independent live-time projection', () => {
    const h = history();
    h.add('CLOCK_START', {}, 0);
    expect(
      projectProfessionalStatistics(h.events, rules, roster, time(80))!.home.players[0]!.playingMs,
    ).toBe(60000);
    expect(projectProfessionalStatistics(h.events, rules, roster)!.home.players[0]!.playingMs).toBe(
      0,
    );
  });
  it('rejects duplicate, wrong-side or more than five lineup entries and running substitutions', () => {
    for (const memberIds of [[id(1), id(1)], [id(3)], [id(1), id(2), id(3), id(4), id(5), id(6)]]) {
      const h = history();
      h.events[1]!.payload.memberIds = memberIds;
      expect(() => projectProfessionalStatistics(h.events, rules, roster)).toThrow();
    }
    const h = history();
    h.add('CLOCK_START');
    h.add('SUBSTITUTE_PLAYER', { side: 'HOME', outMemberId: id(1), inMemberId: id(2) }, 3);
    expect(() => projectProfessionalStatistics(h.events, rules, roster)).toThrow();
  });
  it('rejects a forged made-shot score and malformed stored percentages', () => {
    const h = history();
    h.add('STAT_RECORDED', {
      kind: 'SCORE',
      side: 'HOME',
      memberId: id(1),
      value: 2,
      period: 1,
      shot: { shotValue: 3, made: true },
    });
    expect(() => projectProfessionalStatistics(h.events, rules, roster)).toThrow();
    const valid = projectProfessionalStatistics(history().events, rules, roster)!;
    expect(professionalStatisticsDto(valid)).toEqual(valid);
    valid.home.players[0]!.fieldGoalPercentage = 0;
    expect(() => professionalStatisticsDto(valid)).toThrow();
  });
  it('made-shot planning atomically derives exactly one scoring event', () => {
    const h = history();
    const plan = planCommand({
      status: 'LIVE',
      clock: {
        period: 1,
        remainingMs: 60000,
        running: false,
        anchorServerTime: time(0),
        clockVersion: 1,
      },
      events: h.events,
      rules,
      roster,
      now: time(0),
      command: command('RECORD_SHOT', { side: 'HOME', memberId: id(1), shotValue: 2, made: true }),
    });
    expect(plan.events).toEqual([
      {
        type: 'STAT_RECORDED',
        payload: {
          kind: 'SCORE',
          side: 'HOME',
          memberId: id(1),
          value: 2,
          period: 1,
          shot: { shotValue: 2, made: true },
        },
      },
    ]);
  });
  it('rejects double entry via basic score commands and an off-court technical event', () => {
    const h = history();
    const context = {
      status: 'LIVE' as const,
      clock: {
        period: 1,
        remainingMs: 60000,
        running: false,
        anchorServerTime: time(0),
        clockVersion: 1,
      },
      events: h.events,
      rules,
      roster,
      now: time(0),
    };
    expect(() =>
      planCommand({
        ...context,
        command: command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2, memberId: id(1) }),
      }),
    ).toThrow();
    expect(() =>
      planCommand({
        ...context,
        command: command('RECORD_TECHNICAL', { kind: 'ASSIST', side: 'HOME', memberId: id(2) }),
      }),
    ).toThrow();
  });
  it('requires complete strict professional payloads and excludes unknown actor fields', () => {
    expect(() => command('RECORD_SHOT', { side: 'HOME', memberId: id(1), shotValue: 2 })).toThrow();
    expect(() => command('SET_LINEUP', { side: 'HOME', memberIds: [id(1), id(1)] })).toThrow();
    expect(() =>
      command('RECORD_TECHNICAL', { side: 'HOME', memberId: id(1), kind: 'ASSIST', made: true }),
    ).toThrow();
  });
  it('append-only historical lineup correction recalculates time without rewriting the original event', () => {
    const h = history();
    const original = JSON.stringify(h.events[1]);
    h.add('CLOCK_START', {}, 0);
    h.add('CLOCK_PAUSE', {}, 10);
    h.add(
      'LINEUP_CORRECTED',
      { side: 'HOME', memberIds: [id(2)], reason: '首发名单录入错误' },
      12,
      h.events[1]!.id,
    );
    const result = projectProfessionalStatistics(h.events, rules, roster)!;
    expect(result.home.players[0]).toMatchObject({ starter: false, appeared: false, playingMs: 0 });
    expect(result.home.players[1]).toMatchObject({
      starter: true,
      appeared: true,
      playingMs: 10000,
    });
    expect(JSON.stringify(h.events[1])).toBe(original);
  });
  it('rejects a historical lineup correction that contradicts an actual recorded on-court statistic', () => {
    const h = history();
    h.add(
      'STAT_RECORDED',
      {
        kind: 'SCORE',
        side: 'HOME',
        memberId: id(1),
        value: 2,
        period: 1,
        shot: { shotValue: 2, made: true },
      },
      2,
    );
    h.add(
      'LINEUP_CORRECTED',
      { side: 'HOME', memberIds: [id(2)], reason: '不能将有现场数据的球员静默移出当时阵容' },
      3,
      h.events[1]!.id,
    );
    expect(() => projectProfessionalStatistics(h.events, rules, roster)).toThrow();
  });
});

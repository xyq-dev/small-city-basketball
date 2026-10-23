import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  MatchPlayerRoster,
  ScoringEventData,
  ScoringRules,
} from '@small-city-basketball/contracts';
import { commandHash, parseScoringCommand, planCommand, replayStats } from './scoring-domain.js';
import {
  playerStatisticsDto,
  projectPlayerStatistics,
  recordedCollectionMode,
} from './player-statistics.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-23T00:00:00.000Z';
const rules: ScoringRules = {
  regulationPeriods: 1,
  periodDurationSeconds: 60,
  allowedScoreValues: [1, 2, 3],
  tiePolicy: 'ALLOW_DRAW',
  overtimeDurationSeconds: null,
};
const control = { leaseId: id(90), fencingToken: '1', clientInstanceId: id(91) };
const roster: MatchPlayerRoster = {
  home: [{ memberId: id(1), name: '合成主队球员', jerseyNo: '00' }],
  away: [{ memberId: id(2), name: '合成客队球员', jerseyNo: '0' }],
};
function command(type: string, payload: object) {
  return parseScoringCommand({
    commandId: id(99),
    expectedVersion: 5,
    capturedAt: now,
    type,
    payload,
    ...(type === 'PREPARE_MATCH' ? {} : { control }),
  });
}
function event(
  seq: number,
  kind: string,
  side: string,
  value: number,
  memberId?: string | null,
): ScoringEventData {
  return {
    id: id(10 + seq),
    seq,
    type: 'STAT_RECORDED',
    payload: { kind, side, value, period: 1, ...(memberId !== undefined ? { memberId } : {}) },
    actorId: id(80),
    commandId: id(100 + seq),
    capturedAt: now,
    serverTime: now,
    targetEventId: null,
  };
}
const clock = {
  period: 1,
  remainingMs: 60000,
  running: false,
  anchorServerTime: now,
  clockVersion: 1,
};

describe('player statistics remain a projection of the existing scoring stream', () => {
  it('keeps old omitted command fields and canonical hashes unchanged', () => {
    const legacy = command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2 });
    expect(legacy.payload).not.toHaveProperty('memberId');
    const oldHash = createHash('sha256')
      .update(
        JSON.stringify({
          commandId: id(99),
          expectedVersion: 5,
          capturedAt: now,
          type: 'RECORD_STAT',
          payload: { kind: 'SCORE', side: 'HOME', value: 2 },
          control,
        }),
      )
      .digest('hex');
    expect(commandHash(legacy)).toBe(oldHash);
    expect(
      commandHash(
        command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2, memberId: null }),
      ),
    ).not.toBe(oldHash);
  });
  it('locks mode in the original prepare event while keeping legacy prepare payloads empty', () => {
    const base = { status: 'SCHEDULED' as const, clock: null, rules, events: [], now };
    expect(
      planCommand({ ...base, command: command('PREPARE_MATCH', { expectedEventVersion: 4 }) })
        .events[0]!.payload,
    ).toEqual({});
    expect(
      planCommand({
        ...base,
        command: command('PREPARE_MATCH', {
          expectedEventVersion: 4,
          collectionMode: 'PLAYER_BASIC',
        }),
      }).events[0]!.payload,
    ).toEqual({ collectionMode: 'PLAYER_BASIC' });
    expect(() =>
      command('START_MATCH', { expectedEventVersion: 4, collectionMode: 'PLAYER_BASIC' }),
    ).toThrow();
    expect(() =>
      command('PREPARE_MATCH', { expectedEventVersion: 4, collectionMode: 'invented' }),
    ).toThrow();
  });
  it('keeps legacy team-only statistics uncollected instead of assigning invented player data', () => {
    const history = [event(1, 'SCORE', 'HOME', 2)];
    expect(recordedCollectionMode(history)).toBe('TEAM_ONLY');
    expect(projectPlayerStatistics('TEAM_ONLY', replayStats(history, rules, 1), roster)).toBeNull();
    expect(() =>
      projectPlayerStatistics(
        'TEAM_ONLY',
        replayStats([event(1, 'SCORE', 'HOME', 2, id(1))], rules, 1),
        roster,
      ),
    ).toThrow();
  });
  it('attributes points and fouls from the frozen side while retaining explicit unassigned totals', () => {
    const history = [
      event(1, 'SCORE', 'HOME', 2, id(1)),
      event(2, 'SCORE', 'HOME', 3, null),
      event(3, 'FOUL', 'AWAY', 1, id(2)),
      event(4, 'TIMEOUT', 'HOME', 1),
    ];
    const totals = replayStats(history, rules, 1);
    const player = projectPlayerStatistics('PLAYER_BASIC', totals, roster)!;
    expect(player.home.players[0]).toMatchObject({ score: 2, fouls: 0, jerseyNo: '00' });
    expect(player.home.unassigned).toEqual({ score: 3, fouls: 0 });
    expect(player.away.players[0]!.fouls).toBe(1);
    expect(player.home.players.reduce((n, p) => n + p.score, player.home.unassigned.score)).toBe(
      totals.home.score,
    );
    expect(player).not.toHaveProperty('rebounds');
    expect(player.home.players[0]).not.toHaveProperty('assists');
    expect(roster.home[0]).not.toHaveProperty('score');
  });
  it('rejects a valid member ID from the other side and an unknown member ID', () => {
    for (const member of [id(2), id(400)])
      expect(() =>
        projectPlayerStatistics(
          'PLAYER_BASIC',
          replayStats([event(1, 'SCORE', 'HOME', 2, member)], rules, 1),
          roster,
        ),
      ).toThrow();
    expect(() =>
      command('RECORD_STAT', { kind: 'TIMEOUT', side: 'HOME', value: 1, memberId: id(1) }),
    ).toThrow();
    expect(() =>
      command('ADD_CORRECTION', {
        kind: 'SCORE',
        side: 'HOME',
        value: 1,
        period: 1,
        reason: '纠正',
        memberId: 'not-a-uuid',
      }),
    ).toThrow();
  });
  it('void and replacement replay change team and personal totals together and preserve prior history', () => {
    const original = event(1, 'SCORE', 'HOME', 2, id(1));
    const replacement = planCommand({
      status: 'LIVE',
      clock,
      rules,
      events: [original],
      command: command('REPLACE_STAT', {
        targetEventId: original.id,
        side: 'HOME',
        value: 3,
        reason: '修正分值',
      }),
      now,
    });
    expect(replacement.events[1]!.payload.memberId).toBe(id(1));
    const history = [
      original,
      ...replacement.events.map((e, index) => ({
        ...original,
        id: id(index + 20),
        seq: index + 2,
        type: e.type,
        payload: e.payload,
        targetEventId: e.targetEventId ?? null,
      })),
    ];
    const totals = replayStats(history, rules, 1);
    expect(totals.home.score).toBe(3);
    expect(projectPlayerStatistics('PLAYER_BASIC', totals, roster)!.home.players[0]!.score).toBe(3);
    expect(original.payload.value).toBe(2);
    const voided = [
      ...history,
      {
        ...original,
        id: id(30),
        seq: 4,
        type: 'STAT_VOIDED',
        payload: { reason: '取消' },
        targetEventId: history[2]!.id,
      },
    ];
    expect(
      projectPlayerStatistics('PLAYER_BASIC', replayStats(voided, rules, 1), roster)!.home
        .players[0]!.score,
    ).toBe(0);
  });
  it('requires explicit attribution when a replacement moves an attributed event to the other side', () => {
    const base = {
      status: 'LIVE' as const,
      clock,
      rules,
      events: [event(1, 'SCORE', 'HOME', 2, id(1))],
      now,
    };
    expect(() =>
      planCommand({
        ...base,
        command: command('REPLACE_STAT', {
          targetEventId: base.events[0]!.id,
          side: 'AWAY',
          value: 2,
          reason: '更正队伍',
        }),
      }),
    ).toThrow();
    const planned = planCommand({
      ...base,
      command: command('REPLACE_STAT', {
        targetEventId: base.events[0]!.id,
        side: 'AWAY',
        value: 2,
        reason: '更正队伍',
        memberId: null,
      }),
    });
    expect(planned.events[1]!.payload.memberId).toBeNull();
  });
  it('copies stored confirmation JSON through a whitelist and refuses invalid counts or duplicated identities', () => {
    const stats = projectPlayerStatistics(
      'PLAYER_BASIC',
      replayStats([event(1, 'SCORE', 'HOME', 2, id(1))], rules, 1),
      roster,
    )!;
    const dirty = structuredClone(stats) as unknown as Record<string, any>;
    dirty.privatePhone = 'not-returned';
    dirty.home.players[0].contact = 'not-returned';
    const clean = playerStatisticsDto(dirty)!;
    expect(clean).toEqual(stats);
    expect(clean).not.toBe(dirty);
    dirty.home.players[0].score = -1;
    expect(() => playerStatisticsDto(dirty)).toThrow();
    dirty.home.players[0].score = 2;
    dirty.away.players[0].memberId = id(1);
    expect(() => playerStatisticsDto(dirty)).toThrow();
    dirty.away.players[0].memberId = 'AAAAAAAA-0000-4000-8000-000000000000';
    dirty.home.players[0].memberId = 'aaaaaaaa-0000-4000-8000-000000000000';
    expect(() => playerStatisticsDto(dirty)).toThrow();
    dirty.away.players[0].memberId = id(2);
    dirty.home.players[0].name = 'x'.repeat(81);
    expect(() => playerStatisticsDto(dirty)).toThrow();
    expect(() =>
      recordedCollectionMode([
        {
          ...event(1, 'SCORE', 'HOME', 2),
          type: 'PREPARE_MATCH',
          payload: { collectionMode: null },
        },
      ]),
    ).toThrow();
  });
});

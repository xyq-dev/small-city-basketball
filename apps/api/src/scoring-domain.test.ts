import { describe, expect, it } from 'vitest';
import type {
  MatchStatus,
  ScoringClock,
  ScoringCommandInput,
  ScoringEventData,
  ScoringRules,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import {
  ACTUAL_SCORING_COMMANDS,
  commandHash,
  effectiveClock,
  parseScoringCommand,
  parseScoringRules,
  planCommand,
  replayStats,
} from './scoring-domain.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const now = '2026-10-22T01:00:00.000Z';
const control = { leaseId: id(700), fencingToken: '9007199254740993', clientInstanceId: id(701) };
const rules: ScoringRules = {
  regulationPeriods: 2,
  periodDurationSeconds: 60,
  allowedScoreValues: [1, 2, 3],
  tiePolicy: 'ALLOW_DRAW',
  overtimeDurationSeconds: null,
};
const overtime: ScoringRules = { ...rules, tiePolicy: 'OVERTIME', overtimeDurationSeconds: 30 };
const paused: ScoringClock = {
  period: 1,
  remainingMs: 60_000,
  running: false,
  anchorServerTime: now,
  clockVersion: 1,
};
const zero: ScoringClock = { ...paused, period: 2, remainingMs: 0 };
const totals = (score = 0, fouls = 0, timeouts = 0) => ({ score, fouls, timeouts });
function command(
  type: string,
  payload: object = {},
  extra: Record<string, unknown> = {},
): ScoringCommandInput {
  return parseScoringCommand({
    commandId: id(42),
    expectedVersion: 7,
    capturedAt: now,
    type,
    payload,
    ...(['PREPARE_MATCH', 'CONFIRM_RESULT', 'REOPEN_RESULT'].includes(type) ? {} : { control }),
    ...extra,
  });
}
function event(
  seq: number,
  type: string,
  payload: Record<string, unknown> = {},
  targetEventId: string | null = null,
): ScoringEventData {
  return {
    id: id(seq),
    seq,
    type,
    payload,
    actorId: id(900),
    commandId: id(1000 + seq),
    capturedAt: now,
    serverTime: now,
    targetEventId,
  };
}
const scored = [event(1, 'STAT_RECORDED', { kind: 'SCORE', side: 'HOME', value: 2, period: 1 })];
function plan(
  type: string,
  payload: object = {},
  extra: {
    status?: MatchStatus;
    clock?: ScoringClock | null;
    events?: ScoringEventData[];
    rules?: ScoringRules;
    now?: string;
  } = {},
) {
  return planCommand({
    status: 'LIVE',
    clock: paused,
    rules,
    events: [],
    command: command(type, payload),
    now,
    ...extra,
  });
}
function expectCode(attempt: () => unknown, code: string) {
  try {
    attempt();
    expect.fail(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  }
}

describe('显式规则及规范命令', () => {
  it('规则没有默认值，分值非空子集且规范排序', () => {
    expect(parseScoringRules({ ...rules, allowedScoreValues: [3, 1] }).allowedScoreValues).toEqual([
      1, 3,
    ]);
    expect(
      parseScoringRules({ ...rules, regulationPeriods: 8, periodDurationSeconds: 3600 }),
    ).toMatchObject({ regulationPeriods: 8, periodDurationSeconds: 3600 });
    for (const delta of [
      { regulationPeriods: 0 },
      { regulationPeriods: 9 },
      { periodDurationSeconds: 3601 },
      { periodDurationSeconds: undefined },
      { allowedScoreValues: [] },
      { allowedScoreValues: [1, 1] },
      { allowedScoreValues: [4] },
      { allowedScoreValues: ['1'] },
      { tiePolicy: 'FIBA' },
      { overtimeDurationSeconds: 30 },
      { overtimeDurationSeconds: undefined },
      { defaultClock: true },
    ])
      expect(() => parseScoringRules({ ...rules, ...delta })).toThrow(ApiError);
    expect(parseScoringRules(overtime).overtimeDurationSeconds).toBe(30);
    for (const duration of [null, 0, 1801, '30'])
      expect(() => parseScoringRules({ ...overtime, overtimeDurationSeconds: duration })).toThrow(
        ApiError,
      );
  });
  it('管理命令不带控制，实际动作必须控制，完整白名单拒绝伪造', () => {
    expect(command('PREPARE_MATCH', { expectedEventVersion: 3 }).control).toBeUndefined();
    expect(command('START_MATCH', { expectedEventVersion: 3 }).control).toEqual(control);
    expect(() => command('CLOCK_START', {}, { control: undefined })).toThrow(ApiError);
    expect(() => command('CONFIRM_RESULT', {}, { control })).toThrow(ApiError);
    expect(() => command('CLOCK_START', { absoluteScore: 99 })).toThrow(ApiError);
    expect(() =>
      command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2, actorId: id(1) }),
    ).toThrow(ApiError);
    expect(() => command('CLOCK_START', {}, { expectedVersion: '7' })).toThrow(ApiError);
    expect(() => command('CLOCK_START', {}, { actorId: id(1) })).toThrow(ApiError);
    expect(() => command('START_MATCH', {})).toThrow(ApiError);
    expect(() => command('UNKNOWN')).toThrow(ApiError);
    for (const changed of [
      { leaseId: 'bad' },
      { clientInstanceId: 'bad' },
      { fencingToken: '01' },
      { fencingToken: '0' },
      { fencingToken: '9223372036854775808' },
      { fencingToken: 1 },
    ])
      expect(() => command('CLOCK_START', {}, { control: { ...control, ...changed } })).toThrow(
        ApiError,
      );
  });
  it('统计及理由按类型验证，不能通过替换改写kind/period', () => {
    for (const payload of [
      { kind: 'SCORE', side: 'HOME', value: 0 },
      { kind: 'FOUL', side: 'HOME', value: 2 },
      { kind: 'TIMEOUT', side: 'AWAY', value: 3 },
      { kind: 'REBOUND', side: 'HOME', value: 1 },
      { kind: 'SCORE', side: 'OTHER', value: 1 },
    ])
      expect(() => command('RECORD_STAT', payload)).toThrow(ApiError);
    expect(() =>
      command('REPLACE_STAT', {
        targetEventId: id(1),
        side: 'AWAY',
        value: 1,
        kind: 'SCORE',
        reason: '更正',
      }),
    ).toThrow(ApiError);
    expect(() =>
      command('REPLACE_STAT', {
        targetEventId: id(1),
        side: 'AWAY',
        value: 1,
        period: 2,
        reason: '更正',
      }),
    ).toThrow(ApiError);
    for (const reason of ['', ' ', '字'.repeat(501), '空\u0000字符'])
      expect(() => command('VOID_STAT', { targetEventId: id(1), reason })).toThrow(ApiError);
    expect(() => command('CLOCK_SET', { remainingMs: 1 })).toThrow(ApiError);
    expect(() => command('CLOCK_START', {}, { capturedAt: '2026-02-29T00:00:00Z' })).toThrow(
      ApiError,
    );
  });
  it('固定UTF8 JSON哈希向量、键序与等价offset不变，修改内容/版本/控制则冲突', () => {
    const parsed = command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 3 });
    // Independently calculated with Python hashlib/json, separators=(',', ':').
    expect(commandHash(parsed)).toBe(
      'cb75154dd0e48e31cfd856937ace5d6030da56ff0607bd82bea2b9aacdda0b41',
    );
    const reordered = command(
      'RECORD_STAT',
      { value: 3, side: 'HOME', kind: 'SCORE' },
      {
        capturedAt: '2026-10-22T09:00:00+08:00',
        control: {
          clientInstanceId: control.clientInstanceId,
          fencingToken: control.fencingToken,
          leaseId: control.leaseId,
        },
      },
    );
    expect(commandHash(reordered)).toBe(commandHash(parsed));
    expect(commandHash(command('RECORD_STAT', { kind: 'SCORE', side: 'AWAY', value: 3 }))).not.toBe(
      commandHash(parsed),
    );
    expect(
      commandHash(
        command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 3 }, { expectedVersion: 8 }),
      ),
    ).not.toBe(commandHash(parsed));
    expect(
      commandHash(
        command(
          'RECORD_STAT',
          { kind: 'SCORE', side: 'HOME', value: 3 },
          { control: { ...control, fencingToken: '9007199254740994' } },
        ),
      ),
    ).not.toBe(commandHash(parsed));
  });
});

describe('不可变统计事件重放', () => {
  it('全场/当节分别汇总基础统计，不因capturedAt逆序改变服务器seq', () => {
    const history = [
      ...scored,
      event(2, 'STAT_RECORDED', { kind: 'SCORE', side: 'AWAY', value: 3, period: 2 }),
      event(3, 'STAT_RECORDED', { kind: 'FOUL', side: 'HOME', value: 1, period: 2 }),
      event(4, 'STAT_RECORDED', { kind: 'TIMEOUT', side: 'HOME', value: 1, period: 1 }),
    ];
    history[0] = { ...history[0]!, capturedAt: '2030-01-01T00:00:00.000Z' };
    const result = replayStats([...history].reverse(), rules, 2);
    expect(result.home).toEqual(totals(2, 1, 1));
    expect(result.away).toEqual(totals(3));
    expect(result.periods).toEqual([
      { period: 1, home: totals(2, 0, 1), away: totals() },
      { period: 2, home: totals(0, 1), away: totals(3) },
    ]);
  });
  it('void不删除历史，替换是void+新stat，失效目标和重复void拒绝', () => {
    const replacement = plan(
      'REPLACE_STAT',
      { targetEventId: id(1), side: 'AWAY', value: 3, reason: '记错队伍与分值' },
      { events: scored, clock: { ...paused, period: 2 } },
    );
    expect(replacement.events).toEqual([
      { type: 'STAT_VOIDED', targetEventId: id(1), payload: { reason: '记错队伍与分值' } },
      {
        type: 'STAT_RECORDED',
        payload: { kind: 'SCORE', side: 'AWAY', value: 3, period: 1, reason: '记错队伍与分值' },
      },
    ]);
    const history = [
      ...scored,
      event(2, replacement.events[0]!.type, replacement.events[0]!.payload, id(1)),
      event(3, replacement.events[1]!.type, replacement.events[1]!.payload),
    ];
    const result = replayStats(history, rules, 2);
    expect(result.home).toEqual(totals());
    expect(result.away).toEqual(totals(3));
    expect(result.activeStats.has(id(1))).toBe(false);
    expect(result.activeStats.get(id(3))?.period).toBe(1);
    expect(scored[0]!.payload.value).toBe(2);
    expectCode(
      () => plan('VOID_STAT', { targetEventId: id(1), reason: '重复' }, { events: history }),
      'INVALID_MATCH_STATE',
    );
    expectCode(
      () => plan('VOID_STAT', { targetEventId: id(999), reason: '其他场次' }, { events: scored }),
      'INVALID_STAT_TARGET',
    );
    expectCode(
      () => replayStats([...history, event(4, 'STAT_VOIDED', { reason: '重复' }, id(1))], rules, 2),
      'INVALID_MATCH_STATE',
    );
  });
  it('更正只能用已有period及合法分值，替换犯规仍只能为1', () => {
    const added = plan(
      'ADD_CORRECTION',
      { kind: 'TIMEOUT', side: 'HOME', value: 1, period: 1, reason: '补录' },
      { status: 'PENDING_CONFIRMATION', clock: zero },
    );
    expect(added.events[0]!.payload.period).toBe(1);
    expect(() =>
      plan(
        'ADD_CORRECTION',
        { kind: 'SCORE', side: 'HOME', value: 1, period: 3, reason: '未来节' },
        { clock: zero },
      ),
    ).toThrow(ApiError);
    expectCode(
      () =>
        plan(
          'RECORD_STAT',
          { kind: 'SCORE', side: 'HOME', value: 3 },
          { rules: { ...rules, allowedScoreValues: [1, 2] } },
        ),
      'RULE_CONFLICT',
    );
    const foul = [event(1, 'STAT_RECORDED', { kind: 'FOUL', side: 'HOME', value: 1, period: 1 })];
    expectCode(
      () =>
        plan(
          'REPLACE_STAT',
          { targetEventId: id(1), side: 'AWAY', value: 2, reason: '错误值' },
          { events: foul },
        ),
      'RULE_CONFLICT',
    );
  });
  it('序列连续、事件ID不重复，全部撤销后仍有当节零统计', () => {
    expectCode(
      () =>
        replayStats(
          [event(2, 'STAT_RECORDED', { kind: 'SCORE', side: 'HOME', value: 1, period: 1 })],
          rules,
          1,
        ),
      'SCORING_HISTORY_INVALID',
    );
    expectCode(
      () => replayStats([scored[0]!, { ...event(2, 'CLOCK_START'), id: id(1) }], rules, 1),
      'SCORING_HISTORY_INVALID',
    );
    expect(
      replayStats([...scored, event(2, 'STAT_VOIDED', { reason: '误记' }, id(1))], rules, 2)
        .periods,
    ).toEqual([
      { period: 1, home: totals(), away: totals() },
      { period: 2, home: totals(), away: totals() },
    ]);
  });
});

describe('DB时间锚点与显式比赛状态', () => {
  it('prepare/开始分离，START不自动走时，capturedAt不作为时钟依据', () => {
    const prepared = plan(
      'PREPARE_MATCH',
      { expectedEventVersion: 4 },
      { status: 'SCHEDULED', clock: null },
    );
    expect(prepared).toMatchObject({ status: 'READY', clock: paused, isActualScoring: false });
    const started = plan(
      'START_MATCH',
      { expectedEventVersion: 4 },
      { status: 'READY', clock: prepared.clock },
    );
    expect(started).toMatchObject({ status: 'LIVE', clock: paused, isActualScoring: true });
    const futureCapture = planCommand({
      status: 'LIVE',
      rules,
      events: [],
      clock: paused,
      now,
      command: command('CLOCK_START', {}, { capturedAt: '2099-01-01T00:00:00Z' }),
    });
    expect(futureCapture.clock.anchorServerTime).toBe(now);
  });
  it('clock clamp不自动停钟或改变比赛，倒退DB时间不会增加超过锚点值', () => {
    const running = { ...paused, running: true };
    expect(effectiveClock(running, '2026-10-22T01:00:01.234Z')).toBe(58_766);
    expect(effectiveClock(running, '2026-10-22T01:02:00Z')).toBe(0);
    expect(running.running).toBe(true);
    expect(effectiveClock(running, '2026-10-22T00:59:59Z')).toBe(60_000);
    expect(effectiveClock(paused, '2027-01-01T00:00:00Z')).toBe(60_000);
  });
  it('暂停物化服务器剩余，running校时保留running并重锚，统计不改clockVersion', () => {
    const running = { ...paused, running: true };
    const stopped = plan('CLOCK_PAUSE', {}, { clock: running, now: '2026-10-22T01:00:10Z' });
    expect(stopped.clock).toEqual({
      ...paused,
      remainingMs: 50_000,
      anchorServerTime: '2026-10-22T01:00:10.000Z',
      clockVersion: 2,
    });
    const corrected = plan(
      'CLOCK_SET',
      { remainingMs: 40_000, reason: '校正比赛时钟' },
      { clock: running, now: '2026-10-22T01:00:10Z' },
    );
    expect(corrected.clock).toMatchObject({
      remainingMs: 40_000,
      running: true,
      clockVersion: 2,
      anchorServerTime: '2026-10-22T01:00:10.000Z',
    });
    expectCode(() => plan('CLOCK_SET', { remainingMs: 60_001, reason: '超界' }), 'RULE_CONFLICT');
    expect(
      plan('RECORD_STAT', { kind: 'FOUL', side: 'HOME', value: 1 }, { clock: running }).clock,
    ).toEqual(running);
    expect(
      plan('RECORD_STAT', { kind: 'TIMEOUT', side: 'HOME', value: 1 }, { clock: running }).clock
        .running,
    ).toBe(true);
  });
  it('换节需要真实归零并显式暂停；不能跳过末常规节进入下一常规节', () => {
    expectCode(() => plan('NEXT_PERIOD'), 'INVALID_MATCH_STATE');
    expectCode(
      () =>
        plan(
          'NEXT_PERIOD',
          {},
          { clock: { ...paused, running: true }, now: '2026-10-22T01:02:00Z' },
        ),
      'INVALID_MATCH_STATE',
    );
    const next = plan('NEXT_PERIOD', {}, { clock: { ...paused, remainingMs: 0 } });
    expect(next.clock).toEqual({ ...paused, period: 2, clockVersion: 2 });
    expectCode(() => plan('NEXT_PERIOD', {}, { clock: zero }), 'INVALID_MATCH_STATE');
    expectCode(
      () => plan('END_MATCH', {}, { clock: { ...paused, remainingMs: 0 } }),
      'INVALID_MATCH_STATE',
    );
  });
  it('加时及结束服从平分规则，归零不会自动FINAL', () => {
    const added = plan('START_OVERTIME', {}, { rules: overtime, clock: zero });
    expect(added.clock).toMatchObject({
      period: 3,
      remainingMs: 30_000,
      running: false,
      clockVersion: 2,
    });
    expectCode(() => plan('END_MATCH', {}, { rules: overtime, clock: zero }), 'RULE_CONFLICT');
    expectCode(
      () => plan('START_OVERTIME', {}, { rules: overtime, clock: zero, events: scored }),
      'RULE_CONFLICT',
    );
    expectCode(() => plan('START_OVERTIME', {}, { clock: zero }), 'RULE_CONFLICT');
    const ended = plan('END_MATCH', {}, { rules: overtime, clock: zero, events: scored });
    expect(ended.status).toBe('PENDING_CONFIRMATION');
    expect(ended.clock.running).toBe(false);
    expect(plan('END_MATCH', {}, { clock: zero }).status).toBe('PENDING_CONFIRMATION');
  });
  it('待确认只可更正/确认，FINAL须理由重开；平分更正不绕过加时确认守卫', () => {
    for (const type of ['CLOCK_START', 'CLOCK_PAUSE', 'NEXT_PERIOD', 'START_OVERTIME', 'END_MATCH'])
      expectCode(
        () => plan(type, {}, { status: 'PENDING_CONFIRMATION', clock: zero }),
        'INVALID_MATCH_STATE',
      );
    expectCode(
      () =>
        plan(
          'RECORD_STAT',
          { kind: 'SCORE', side: 'HOME', value: 1 },
          { status: 'PENDING_CONFIRMATION', clock: zero },
        ),
      'INVALID_MATCH_STATE',
    );
    const confirmed = plan(
      'CONFIRM_RESULT',
      {},
      { status: 'PENDING_CONFIRMATION', clock: zero, events: scored },
    );
    expect(confirmed).toMatchObject({
      status: 'FINAL',
      isConfirmation: true,
      isActualScoring: false,
    });
    const reopened = plan(
      'REOPEN_RESULT',
      { reason: '正式结果需更正' },
      { status: 'FINAL', clock: zero, events: scored },
    );
    expect(reopened).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      isReopen: true,
      isActualScoring: false,
    });
    expectCode(
      () =>
        plan(
          'CONFIRM_RESULT',
          {},
          { status: 'PENDING_CONFIRMATION', clock: zero, rules: overtime },
        ),
      'RULE_CONFLICT',
    );
    expectCode(
      () =>
        plan(
          'VOID_STAT',
          { targetEventId: id(1), reason: '未先重开' },
          { status: 'FINAL', clock: zero, events: scored },
        ),
      'INVALID_MATCH_STATE',
    );
  });
  it('实际记分命令包括开始/结束/所有clock/统计修正，不把管理操作列入', () => {
    expect(ACTUAL_SCORING_COMMANDS).toEqual(
      expect.arrayContaining([
        'START_MATCH',
        'END_MATCH',
        'CLOCK_SET',
        'NEXT_PERIOD',
        'START_OVERTIME',
        'RECORD_STAT',
        'VOID_STAT',
        'REPLACE_STAT',
        'ADD_CORRECTION',
      ]),
    );
    for (const type of ['PREPARE_MATCH', 'CONFIRM_RESULT', 'REOPEN_RESULT'])
      expect(ACTUAL_SCORING_COMMANDS).not.toContain(type);
  });
});

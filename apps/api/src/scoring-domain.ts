import { createHash } from 'node:crypto';
import { SCORING_COMMAND_TYPES } from '@small-city-basketball/contracts';
import type {
  MatchStatus,
  ScoringClock,
  ScoringCommandInput,
  ScoringCommandPayload,
  ScoringCommandType,
  ScoringControl,
  ScoringEventData,
  ScoringPeriodTotals,
  ScoringRules,
  ScoringSide,
  ScoringStatKind,
  ScoringTotals,
  ScoringCollectionMode,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { invalid, objectInput, text } from './validation.js';
import { parseScheduleTimestamp } from './scheduling-domain.js';

const INT_MAX = 2_147_483_647;
const MANAGEMENT_COMMANDS = new Set<ScoringCommandType>([
  'PREPARE_MATCH',
  'CONFIRM_RESULT',
  'REOPEN_RESULT',
]);
export const ACTUAL_SCORING_COMMANDS = SCORING_COMMAND_TYPES.filter(
  (type) => !MANAGEMENT_COMMANDS.has(type),
);
function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    invalid('请检查记分输入', { [field]: `请输入${min}–${max}的整数` });
  return value as number;
}
function uuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid('无效编号', { [field]: '请使用有效编号' });
  return value.toLowerCase();
}
function timestamp(value: unknown, field: string): string {
  try {
    return parseScheduleTimestamp(value);
  } catch {
    return invalid('时间必须是真实且带明确时区偏移的ISO时间', { [field]: '请检查时间格式' });
  }
}
function kind(value: unknown): ScoringStatKind {
  if (value !== 'SCORE' && value !== 'FOUL' && value !== 'TIMEOUT') invalid('无效基础统计类型');
  return value;
}
function side(value: unknown): ScoringSide {
  if (value !== 'HOME' && value !== 'AWAY') invalid('无效记分方');
  return value;
}
function statValue(statKind: ScoringStatKind, value: unknown, rules?: ScoringRules): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 3)
    throw new ApiError(422, 'RULE_CONFLICT', '统计值不符合本场锁定规则');
  const parsed = value as number;
  if (
    (statKind !== 'SCORE' && parsed !== 1) ||
    (statKind === 'SCORE' && rules && !rules.allowedScoreValues.includes(parsed as 1 | 2 | 3))
  )
    throw new ApiError(422, 'RULE_CONFLICT', '统计值不符合本场锁定规则');
  return parsed;
}
export function parseScoringRules(raw: unknown): ScoringRules {
  const input = objectInput(raw, [
    'regulationPeriods',
    'periodDurationSeconds',
    'allowedScoreValues',
    'tiePolicy',
    'overtimeDurationSeconds',
  ]);
  const regulationPeriods = integer(input.regulationPeriods, 'regulationPeriods', 1, 8);
  const periodDurationSeconds = integer(
    input.periodDurationSeconds,
    'periodDurationSeconds',
    1,
    3600,
  );
  if (
    !Array.isArray(input.allowedScoreValues) ||
    input.allowedScoreValues.length < 1 ||
    input.allowedScoreValues.length > 3 ||
    input.allowedScoreValues.some((value) => ![1, 2, 3].includes(value)) ||
    new Set(input.allowedScoreValues).size !== input.allowedScoreValues.length
  )
    invalid('得分分值需为1、2、3的非空不重复子集');
  const allowedScoreValues = [...input.allowedScoreValues].sort((a, b) => a - b) as (1 | 2 | 3)[];
  if (input.tiePolicy !== 'ALLOW_DRAW' && input.tiePolicy !== 'OVERTIME')
    invalid('请明确选择平分处置');
  const overtimeDurationSeconds =
    input.tiePolicy === 'OVERTIME'
      ? integer(input.overtimeDurationSeconds, 'overtimeDurationSeconds', 1, 1800)
      : null;
  if (input.tiePolicy === 'ALLOW_DRAW' && input.overtimeDurationSeconds !== null)
    invalid('允许平局时加时时长须为null');
  return {
    regulationPeriods,
    periodDurationSeconds,
    allowedScoreValues,
    tiePolicy: input.tiePolicy,
    overtimeDurationSeconds,
  };
}

function parseControl(raw: unknown): ScoringControl {
  const input = objectInput(raw, ['leaseId', 'fencingToken', 'clientInstanceId']);
  if (
    typeof input.fencingToken !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(input.fencingToken) ||
    BigInt(input.fencingToken) > 9_223_372_036_854_775_807n
  )
    invalid('主写栅栏版本无效');
  return {
    leaseId: uuid(input.leaseId, 'leaseId'),
    fencingToken: input.fencingToken,
    clientInstanceId: uuid(input.clientInstanceId, 'clientInstanceId'),
  };
}
function memberAttribution(
  value: Record<string, unknown>,
  statKind?: ScoringStatKind,
): { memberId?: string | null } {
  if (!Object.prototype.hasOwnProperty.call(value, 'memberId')) return {};
  const memberId = value.memberId === null ? null : uuid(value.memberId, 'memberId');
  if (statKind === 'TIMEOUT' && memberId !== null) invalid('暂停不能归属球员');
  return { memberId };
}
export function parseScoringCommand(raw: unknown): ScoringCommandInput {
  const input = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'capturedAt',
    'type',
    'payload',
    'control',
  ]);
  if (!(SCORING_COMMAND_TYPES as readonly unknown[]).includes(input.type)) invalid('无效记分命令');
  const type = input.type as ScoringCommandType;
  const commandId = uuid(input.commandId, 'commandId');
  const expectedVersion = integer(input.expectedVersion, 'expectedVersion', 1, INT_MAX);
  const capturedAt = timestamp(input.capturedAt, 'capturedAt');
  if (MANAGEMENT_COMMANDS.has(type) && input.control !== undefined)
    invalid('管理命令不能携带主写控制凭据');
  const control = MANAGEMENT_COMMANDS.has(type) ? undefined : parseControl(input.control);
  let payload: ScoringCommandPayload['payload'];
  if (type === 'PREPARE_MATCH' || type === 'START_MATCH') {
    const value = objectInput(
      input.payload,
      type === 'PREPARE_MATCH'
        ? ['expectedEventVersion', 'collectionMode']
        : ['expectedEventVersion'],
    );
    if (
      value.collectionMode !== undefined &&
      value.collectionMode !== 'TEAM_ONLY' &&
      value.collectionMode !== 'PLAYER_BASIC'
    )
      invalid('无效统计采集模式');
    payload = {
      expectedEventVersion: integer(value.expectedEventVersion, 'expectedEventVersion', 1, INT_MAX),
      ...(value.collectionMode !== undefined
        ? { collectionMode: value.collectionMode as ScoringCollectionMode }
        : {}),
    };
  } else if (type === 'RECORD_STAT' || type === 'ADD_CORRECTION') {
    const value = objectInput(
      input.payload,
      type === 'RECORD_STAT'
        ? ['kind', 'side', 'value', 'memberId']
        : ['kind', 'side', 'value', 'period', 'reason', 'memberId'],
    );
    const statKind = kind(value.kind);
    const base = {
      kind: statKind,
      side: side(value.side),
      value: statValue(statKind, value.value),
      ...memberAttribution(value, statKind),
    };
    payload =
      type === 'ADD_CORRECTION'
        ? {
            ...base,
            period: integer(value.period, 'period', 1, INT_MAX),
            reason: text(value.reason, 'reason', 1, 500),
          }
        : base;
  } else if (type === 'VOID_STAT' || type === 'REPLACE_STAT') {
    const value = objectInput(
      input.payload,
      type === 'VOID_STAT'
        ? ['targetEventId', 'reason']
        : ['targetEventId', 'side', 'value', 'reason', 'memberId'],
    );
    const targetEventId = uuid(value.targetEventId, 'targetEventId');
    payload =
      type === 'VOID_STAT'
        ? { targetEventId, reason: text(value.reason, 'reason', 1, 500) }
        : {
            targetEventId,
            side: side(value.side),
            value: integer(value.value, 'value', 1, 3),
            reason: text(value.reason, 'reason', 1, 500),
            ...memberAttribution(value),
          };
  } else if (type === 'CLOCK_SET') {
    const value = objectInput(input.payload, ['remainingMs', 'reason']);
    payload = {
      remainingMs: integer(value.remainingMs, 'remainingMs', 0, 3_600_000),
      reason: text(value.reason, 'reason', 1, 500),
    };
  } else if (type === 'REOPEN_RESULT') {
    const value = objectInput(input.payload, ['reason']);
    payload = { reason: text(value.reason, 'reason', 1, 500) };
  } else payload = objectInput(input.payload, []) as Record<string, never>;
  return {
    commandId,
    expectedVersion,
    capturedAt,
    type,
    payload,
    ...(control ? { control } : {}),
  } as ScoringCommandInput;
}
/** Canonical UTF-8 JSON has this envelope order; each payload/control is rebuilt by the parser. */
export function commandHash(command: ScoringCommandInput): string {
  const input = parseScoringCommand(command);
  return createHash('sha256')
    .update(
      JSON.stringify({
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        capturedAt: input.capturedAt,
        type: input.type,
        payload: input.payload,
        control: input.control ?? null,
      }),
    )
    .digest('hex');
}

export interface ActiveStat {
  memberId?: string | null;
  kind: ScoringStatKind;
  side: ScoringSide;
  value: number;
  period: number;
}
export interface ReplayedScoringStats {
  home: ScoringTotals;
  away: ScoringTotals;
  periods: ScoringPeriodTotals[];
  activeStats: Map<string, ActiveStat>;
}
const emptyTotals = (): ScoringTotals => ({ score: 0, fouls: 0, timeouts: 0 });
export function replayStats(
  events: ScoringEventData[],
  rules: ScoringRules,
  currentPeriod: number,
): ReplayedScoringStats {
  integer(currentPeriod, 'period', 1, INT_MAX);
  const activeStats = new Map<string, ActiveStat>();
  const seenIds = new Set<string>();
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index]!;
    if (event.seq !== index + 1 || seenIds.has(event.id))
      throw new ApiError(422, 'SCORING_HISTORY_INVALID', '记分事件序列不连续或重复');
    seenIds.add(event.id);
    if (event.type === 'STAT_RECORDED') {
      const statKind = kind(event.payload.kind);
      activeStats.set(event.id, {
        kind: statKind,
        side: side(event.payload.side),
        value: statValue(statKind, event.payload.value, rules),
        period: integer(event.payload.period, 'period', 1, currentPeriod),
        ...memberAttribution(event.payload, statKind),
      });
    } else if (event.type === 'STAT_VOIDED') {
      if (!event.targetEventId)
        throw new ApiError(422, 'INVALID_STAT_TARGET', '统计更正目标不存在');
      if (!activeStats.has(event.targetEventId)) {
        if (seenIds.has(event.targetEventId)) state('统计更正目标已经失效');
        throw new ApiError(422, 'INVALID_STAT_TARGET', '统计更正目标不存在');
      }
      activeStats.delete(event.targetEventId);
    }
  }
  const home = emptyTotals();
  const away = emptyTotals();
  const byPeriod = new Map<number, ScoringPeriodTotals>();
  for (const stat of activeStats.values()) {
    let period = byPeriod.get(stat.period);
    if (!period) {
      period = { period: stat.period, home: emptyTotals(), away: emptyTotals() };
      byPeriod.set(stat.period, period);
    }
    const field = stat.kind === 'SCORE' ? 'score' : stat.kind === 'FOUL' ? 'fouls' : 'timeouts';
    const total = stat.side === 'HOME' ? home : away;
    const periodTotal = stat.side === 'HOME' ? period.home : period.away;
    total[field] += stat.value;
    periodTotal[field] += stat.value;
    if (!Number.isSafeInteger(total[field]))
      throw new ApiError(422, 'RULE_CONFLICT', '统计总数超出可表示范围');
  }
  // Every existing period has explicit collected zeroes, including periods whose last stat was voided.
  const periods: ScoringPeriodTotals[] = [];
  for (let period = 1; period <= currentPeriod; period++)
    periods.push(byPeriod.get(period) ?? { period, home: emptyTotals(), away: emptyTotals() });
  return { home, away, periods, activeStats };
}
export function effectiveClock(clock: ScoringClock, now: string): number {
  const remaining = integer(clock.remainingMs, 'remainingMs', 0, 3_600_000);
  const anchor = Date.parse(timestamp(clock.anchorServerTime, 'anchorServerTime'));
  const at = Date.parse(timestamp(now, 'serverTime'));
  if (typeof clock.running !== 'boolean') invalid('比赛时钟状态无效');
  return clock.running ? Math.max(0, remaining - Math.max(0, at - anchor)) : remaining;
}

export interface PlannedScoringEvent {
  type: string;
  payload: Record<string, unknown>;
  targetEventId?: string;
}
export interface ScoringCommandPlan {
  status: MatchStatus;
  clock: ScoringClock;
  events: PlannedScoringEvent[];
  isConfirmation: boolean;
  isReopen: boolean;
  isActualScoring: boolean;
}
export interface ScoringPlanContext {
  status: MatchStatus;
  clock: ScoringClock | null;
  rules: ScoringRules;
  events: ScoringEventData[];
  command: ScoringCommandInput;
  now: string;
}
function state(message: string): never {
  throw new ApiError(409, 'INVALID_MATCH_STATE', message);
}
function rule(message: string): never {
  throw new ApiError(422, 'RULE_CONFLICT', message);
}
function duration(rules: ScoringRules, period: number): number {
  if (period <= rules.regulationPeriods) return rules.periodDurationSeconds * 1000;
  if (rules.tiePolicy !== 'OVERTIME' || rules.overtimeDurationSeconds === null)
    rule('本场不允许加时节');
  return rules.overtimeDurationSeconds * 1000;
}
export function planCommand(context: ScoringPlanContext): ScoringCommandPlan {
  const command = parseScoringCommand(context.command);
  const rules = parseScoringRules({
    regulationPeriods: context.rules.regulationPeriods,
    periodDurationSeconds: context.rules.periodDurationSeconds,
    allowedScoreValues: context.rules.allowedScoreValues,
    tiePolicy: context.rules.tiePolicy,
    overtimeDurationSeconds: context.rules.overtimeDurationSeconds,
  });
  const now = timestamp(context.now, 'serverTime');
  const events: PlannedScoringEvent[] = [];
  if (command.type === 'PREPARE_MATCH') {
    if (context.status !== 'SCHEDULED' || context.clock !== null)
      state('仅尚未准备的正式比赛可以准备');
    return {
      status: 'READY',
      clock: {
        period: 1,
        remainingMs: rules.periodDurationSeconds * 1000,
        running: false,
        anchorServerTime: now,
        clockVersion: 1,
      },
      events: [
        {
          type: command.type,
          payload:
            command.payload.collectionMode === undefined
              ? {}
              : { collectionMode: command.payload.collectionMode },
        },
      ],
      isConfirmation: false,
      isReopen: false,
      isActualScoring: false,
    };
  }
  if (!context.clock) state('请先准备比赛');
  const clock = { ...context.clock };
  integer(clock.period, 'period', 1, INT_MAX);
  integer(clock.clockVersion, 'clockVersion', 1, INT_MAX);
  const maxRemaining = duration(rules, clock.period);
  if (clock.remainingMs > maxRemaining) rule('当前时钟超出本节规则时长');
  const remaining = effectiveClock(clock, now);
  const stats = replayStats(context.events, rules, clock.period);
  let status = context.status;
  const actual = (ACTUAL_SCORING_COMMANDS as readonly string[]).includes(command.type);
  const appendStat = (stat: ActiveStat, reason?: string) => {
    events.push({
      type: 'STAT_RECORDED',
      payload: {
        kind: stat.kind,
        side: stat.side,
        value: stat.value,
        period: stat.period,
        ...(reason ? { reason } : {}),
        ...memberAttribution(stat as unknown as Record<string, unknown>, stat.kind),
      },
    });
  };
  const requireLive = () => {
    if (status !== 'LIVE') state('当前比赛不处于现场记分状态');
  };
  const requirePausedZero = () => {
    if (clock.running || remaining !== 0) state('请在本节时钟归零并暂停后操作');
  };
  if (command.type === 'START_MATCH') {
    if (status !== 'READY') state('仅已准备比赛可以开始');
    if (clock.running) state('开始比赛时比赛时钟须暂停');
    status = 'LIVE';
  } else if (command.type === 'RECORD_STAT') {
    requireLive();
    appendStat({
      kind: command.payload.kind,
      side: command.payload.side,
      value: statValue(command.payload.kind, command.payload.value, rules),
      period: clock.period,
      ...memberAttribution(command.payload),
    });
  } else if (
    command.type === 'ADD_CORRECTION' ||
    command.type === 'VOID_STAT' ||
    command.type === 'REPLACE_STAT'
  ) {
    if (status !== 'LIVE' && status !== 'PENDING_CONFIRMATION') state('当前比赛不允许统计修正');
    if (command.type === 'ADD_CORRECTION')
      appendStat(
        {
          kind: command.payload.kind,
          side: command.payload.side,
          value: statValue(command.payload.kind, command.payload.value, rules),
          period: integer(command.payload.period, 'period', 1, clock.period),
          ...memberAttribution(command.payload),
        },
        command.payload.reason,
      );
    else {
      const target = stats.activeStats.get(command.payload.targetEventId);
      if (!target) {
        if (context.events.some((event) => event.id === command.payload.targetEventId))
          state('统计更正目标已经失效');
        throw new ApiError(422, 'INVALID_STAT_TARGET', '统计更正目标不存在');
      }
      events.push({
        type: 'STAT_VOIDED',
        targetEventId: command.payload.targetEventId,
        payload: { reason: command.payload.reason },
      });
      if (
        command.type === 'REPLACE_STAT' &&
        target.memberId &&
        command.payload.side !== target.side &&
        !Object.prototype.hasOwnProperty.call(command.payload, 'memberId')
      )
        invalid('换队更正须明确球员归属');
      if (command.type === 'REPLACE_STAT')
        appendStat(
          {
            ...target,
            side: command.payload.side,
            value: statValue(target.kind, command.payload.value, rules),
            ...memberAttribution(command.payload, target.kind),
          },
          command.payload.reason,
        );
    }
  } else if (command.type === 'CONFIRM_RESULT') {
    if (status !== 'PENDING_CONFIRMATION') state('仅待确认比赛可以确认赛果');
    requirePausedZero();
    if (rules.tiePolicy === 'OVERTIME' && stats.home.score === stats.away.score)
      rule('本场不允许将平分确认为正式赛果');
    status = 'FINAL';
  } else if (command.type === 'REOPEN_RESULT') {
    if (status !== 'FINAL') state('仅正式赛果可以重开');
    status = 'PENDING_CONFIRMATION';
  } else {
    requireLive();
    if (command.type === 'CLOCK_START') {
      if (clock.running || remaining === 0) state('仅暂停且尚未归零的时钟可以启动');
      clock.running = true;
      clock.remainingMs = remaining;
      clock.anchorServerTime = now;
      clock.clockVersion++;
    } else if (command.type === 'CLOCK_PAUSE') {
      if (!clock.running) state('当前时钟已经暂停');
      clock.running = false;
      clock.remainingMs = remaining;
      clock.anchorServerTime = now;
      clock.clockVersion++;
    } else if (command.type === 'CLOCK_SET') {
      if (command.payload.remainingMs > maxRemaining) rule('校时不能超过本节规则时长');
      clock.remainingMs = command.payload.remainingMs;
      clock.anchorServerTime = now;
      clock.clockVersion++;
    } else if (command.type === 'NEXT_PERIOD') {
      requirePausedZero();
      if (clock.period >= rules.regulationPeriods) state('常规节已完成，请按比分结束或进入加时');
      clock.period++;
      clock.remainingMs = duration(rules, clock.period);
      clock.anchorServerTime = now;
      clock.clockVersion++;
    } else if (command.type === 'START_OVERTIME') {
      requirePausedZero();
      if (
        clock.period < rules.regulationPeriods ||
        rules.tiePolicy !== 'OVERTIME' ||
        stats.home.score !== stats.away.score
      )
        rule('仅常规节后或加时后平分且规则允许时可以加时');
      clock.period++;
      clock.remainingMs = duration(rules, clock.period);
      clock.anchorServerTime = now;
      clock.clockVersion++;
    } else if (command.type === 'END_MATCH') {
      requirePausedZero();
      if (clock.period < rules.regulationPeriods) state('常规节尚未完成，不能结束比赛');
      if (rules.tiePolicy === 'OVERTIME' && stats.home.score === stats.away.score)
        rule('平分比赛需继续加时');
      status = 'PENDING_CONFIRMATION';
      clock.remainingMs = 0;
    }
  }
  if (!events.length) events.push({ type: command.type, payload: { ...command.payload } });
  return {
    status,
    clock,
    events,
    isConfirmation: command.type === 'CONFIRM_RESULT',
    isReopen: command.type === 'REOPEN_RESULT',
    isActualScoring: actual,
  };
}

import { createHash, randomBytes } from 'node:crypto';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import type {
  MatchStatus,
  OverlayCommandInput,
  OverlayPreviewData,
  ScoringPeriodTotals,
  ScoringTotals,
} from '@small-city-basketball/contracts';
import { notFound } from './errors.js';
import { parseScoringRules } from './scoring-domain.js';
import { confirmedResult, resultSourceInvalid } from './standings-domain.js';
import type { ResultRow } from './standings-domain.js';
import { invalid, objectInput, text } from './validation.js';

const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_NAME = 'scb.overlay';

function positiveVersion(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    invalid('请提供有效版本', { [field]: '版本须为正整数' });
  return value as number;
}
function ttl(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10080)
    invalid('请明确填写授权时长', { expiresInMinutes: '请输入1–10080整数分钟' });
  return value as number;
}
function commandOverlayId(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE.test(value))
    invalid('请提供有效包装编号', { overlayId: '请使用有效包装编号' });
  return value;
}
export function parseOverlayCommand(body: unknown): OverlayCommandInput {
  const input = objectInput(body, [
    'type',
    'expectedEventVersion',
    'overlayId',
    'expectedGrantVersion',
    'expiresInMinutes',
    'reason',
  ]);
  const expectedEventVersion = positiveVersion(input.expectedEventVersion, 'expectedEventVersion');
  if (input.type === 'ISSUE') {
    objectInput(body, ['type', 'expectedEventVersion', 'expiresInMinutes']);
    return { type: 'ISSUE', expectedEventVersion, expiresInMinutes: ttl(input.expiresInMinutes) };
  }
  if (input.type !== 'ROTATE' && input.type !== 'REVOKE') invalid('不支持的包装授权操作');
  objectInput(
    body,
    input.type === 'ROTATE'
      ? [
          'type',
          'expectedEventVersion',
          'overlayId',
          'expectedGrantVersion',
          'expiresInMinutes',
          'reason',
        ]
      : ['type', 'expectedEventVersion', 'overlayId', 'expectedGrantVersion', 'reason'],
  );
  const overlayId = commandOverlayId(input.overlayId);
  const expectedGrantVersion = positiveVersion(input.expectedGrantVersion, 'expectedGrantVersion');
  const reason = text(input.reason, 'reason', 1, 200);
  return input.type === 'ROTATE'
    ? {
        type: 'ROTATE',
        expectedEventVersion,
        overlayId,
        expectedGrantVersion,
        expiresInMinutes: ttl(input.expiresInMinutes),
        reason,
      }
    : { type: 'REVOKE', expectedEventVersion, overlayId, expectedGrantVersion, reason };
}
export function parseOverlayBootstrap(body: unknown): { token: string } {
  const input = objectInput(body, ['token']);
  if (typeof input.token !== 'string' || !OPAQUE.test(input.token)) throw notFound();
  return { token: input.token };
}
export function opaqueOverlayId(value: string): string {
  if (typeof value !== 'string' || !OPAQUE.test(value)) throw notFound();
  return value;
}
export const newOverlayToken = (): string => randomBytes(32).toString('base64url');
export const hashOverlayToken = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export function readOverlayCookie(header?: string): string | null {
  if (!header) return null;
  const candidates: string[] = [];
  for (const part of header.split(';')) {
    // Leading OWS after a Cookie separator is normal; whitespace inside a name/value is not.
    const segment = part.replace(/^[ \t]+/, '');
    const equals = segment.indexOf('=');
    const name = equals < 0 ? segment : segment.slice(0, equals);
    const resemblesName =
      name.replace(/[\s"']/g, '') === COOKIE_NAME || /^scb\.overlay(?:[\s"']|$)/.test(name);
    if (!resemblesName) continue;
    if (name !== COOKIE_NAME || equals < 0) throw notFound();
    candidates.push(segment.slice(equals + 1));
  }
  if (candidates.length > 1) throw notFound();
  const token = candidates[0];
  if (token === undefined) return null;
  if (/[\s"',]/.test(token)) throw notFound();
  return OPAQUE.test(token) ? token : null;
}

type Instant = Date | string;
function milliseconds(value: Instant): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) throw new Error('Invalid overlay server timestamp');
  return result;
}
export function overlayCookie(
  token: string,
  id: string,
  now: Instant,
  expires: Instant,
  secure: boolean,
): string {
  opaqueOverlayId(id);
  if (!OPAQUE.test(token)) throw notFound();
  // PG supplies microseconds. Round the sampled current time upwards, rather than
  // allowing Date.parse's truncation to round a sub-second remainder up to one second.
  const fraction = typeof now === 'string' ? /\.(\d{4,})/.exec(now)?.[1] : undefined;
  const sampledNow = milliseconds(now) + (fraction && /[1-9]/.test(fraction.slice(3)) ? 1 : 0);
  const maximumAge = Math.max(0, Math.floor((milliseconds(expires) - sampledNow) / 1000));
  return `${COOKIE_NAME}=${token}; Path=/v1/overlays/${id}/; Max-Age=${maximumAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function sourceObject(value: unknown): ResultRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) resultSourceInvalid();
  return value as ResultRow;
}
function sourceInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) resultSourceInvalid();
  return value as number;
}
function totals(value: unknown): ScoringTotals {
  const input = sourceObject(value);
  return {
    score: sourceInteger(input.score),
    fouls: sourceInteger(input.fouls),
    timeouts: sourceInteger(input.timeouts),
  };
}
function stateTotals(state: ResultRow, side: 'home' | 'away'): ScoringTotals {
  return totals({
    score: state[`${side}_score`],
    fouls: state[`${side}_fouls`],
    timeouts: state[`${side}_timeouts`],
  });
}
function periods(value: unknown): ScoringPeriodTotals[] {
  if (!Array.isArray(value) || value.length === 0) resultSourceInvalid();
  return value.map((raw) => {
    const period = sourceObject(raw);
    return {
      period: sourceInteger(period.period, 1),
      home: totals(period.home),
      away: totals(period.away),
    };
  });
}
export function overlayPreview(
  row: ResultRow,
  eventName: string,
  serverTime: string,
): OverlayPreviewData {
  if (
    !(MATCH_STATUSES as readonly unknown[]).includes(row.status) ||
    typeof row.home_team_name !== 'string' ||
    typeof row.away_team_name !== 'string'
  )
    resultSourceInvalid();
  if (row.status === 'FINAL') confirmedResult(row);
  let score: OverlayPreviewData['score'] = null;
  let collectedTotals: OverlayPreviewData['totals'] = null;
  let collectedPeriods: OverlayPreviewData['periods'] = null;
  let rules: OverlayPreviewData['rules'] = null;
  let clock: OverlayPreviewData['clock'] = null;
  const prepared = row.state != null;
  if (prepared) {
    const state = sourceObject(row.state);
    const storedRules = sourceObject(row.scoring_rules);
    if (
      typeof state.clock_running !== 'boolean' ||
      typeof state.requires_reconfirmation !== 'boolean'
    )
      resultSourceInvalid();
    let parsedRules;
    try {
      parsedRules = parseScoringRules({
        regulationPeriods: storedRules.regulation_periods,
        periodDurationSeconds: storedRules.period_duration_seconds,
        allowedScoreValues: storedRules.allowed_score_values,
        tiePolicy: storedRules.tie_policy,
        overtimeDurationSeconds: storedRules.overtime_duration_seconds,
      });
    } catch {
      resultSourceInvalid();
    }
    const home = stateTotals(state, 'home');
    const away = stateTotals(state, 'away');
    score = { home: home.score, away: away.score };
    collectedTotals = { home, away };
    collectedPeriods = periods(state.period_stats);
    rules = {
      version: sourceInteger(storedRules.version, 1),
      regulationPeriods: parsedRules.regulationPeriods,
      periodDurationSeconds: parsedRules.periodDurationSeconds,
      allowedScoreValues: [...parsedRules.allowedScoreValues],
      tiePolicy: parsedRules.tiePolicy,
      overtimeDurationSeconds: parsedRules.overtimeDurationSeconds,
    };
    let anchorServerTime: string;
    try {
      const value = state.anchor_server_time;
      if (typeof value !== 'string' && !(value instanceof Date)) resultSourceInvalid();
      anchorServerTime = new Date(milliseconds(value)).toISOString();
    } catch {
      resultSourceInvalid();
    }
    clock = {
      period: sourceInteger(state.period, 1),
      remainingMs: sourceInteger(state.remaining_ms),
      running: state.clock_running,
      anchorServerTime,
      clockVersion: sourceInteger(state.clock_version),
    };
  } else if (row.scoring_rules != null) resultSourceInvalid();
  return {
    eventName,
    home: { teamName: row.home_team_name },
    away: { teamName: row.away_team_name },
    status: row.status as MatchStatus,
    matchVersion: sourceInteger(row.version, 1),
    score,
    totals: collectedTotals,
    periods: collectedPeriods,
    rules,
    clock,
    collected: {
      teamScore: prepared,
      teamFouls: prepared,
      teamTimeouts: prepared,
      playerStatistics: false,
    },
    resultStatus:
      row.status === 'FINAL'
        ? 'CONFIRMED'
        : row.state?.requires_reconfirmation === true
          ? 'REQUIRES_RECONFIRMATION'
          : 'UNCONFIRMED',
    serverTime,
  };
}

import { createHash } from 'node:crypto';
import type {
  AdministrativeMatchOutcome,
  MatchExceptionKind,
  MatchExceptionOperation,
} from '../../../packages/contracts/match-exceptions.js';
import { ApiError } from './errors.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
import { expectedVersion } from './registration-validation.js';

export const exceptionFail = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};
export const exceptionHash = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
const proofUuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const commandId = (v: unknown) => {
  if (
    typeof v !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
  )
    invalid('操作编号须为小写UUIDv4');
  return v;
};
export function exceptionRulesInput(raw: unknown) {
  const x = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'expectedVersion',
    'forfeitWinPoints',
    'forfeitLossPoints',
    'cancellationPolicy',
  ]);
  if (
    !Number.isInteger(x.expectedVersion) ||
    Number(x.expectedVersion) < 0 ||
    Number(x.expectedVersion) > 2147483647
  )
    invalid('规则版本无效');
  for (const k of ['forfeitWinPoints', 'forfeitLossPoints'] as const)
    if (!Number.isInteger(x[k]) || Number(x[k]) < 0 || Number(x[k]) > 1000)
      invalid('弃权积分须显式填写0–1000整数');
  if (x.cancellationPolicy !== 'EXCLUDE_FROM_TABLE') invalid('取消场次只支持明确排除出积分表');
  return {
    clientRequestId: commandId(x.clientRequestId),
    expectedEventVersion: expectedVersion(x.expectedEventVersion),
    expectedVersion: x.expectedVersion as number,
    forfeitWinPoints: x.forfeitWinPoints as number,
    forfeitLossPoints: x.forfeitLossPoints as number,
    cancellationPolicy: 'EXCLUDE_FROM_TABLE' as const,
  };
}
export function exceptionProposalInput(raw: unknown) {
  const x = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'expectedMatchVersion',
    'operation',
    'kind',
    'forfeitingSide',
    'targetAdjudicationId',
    'reason',
  ]);
  if (
    !['DECLARE', 'REVOKE'].includes(String(x.operation)) ||
    !['FORFEIT', 'CANCELLED'].includes(String(x.kind))
  )
    invalid('裁定类型无效');
  if (x.kind === 'FORFEIT' && !['HOME', 'AWAY'].includes(String(x.forfeitingSide)))
    invalid('弃权须明确弃权方');
  if (x.kind === 'CANCELLED' && x.forfeitingSide !== undefined && x.forfeitingSide !== null)
    invalid('取消不产生胜负方');
  if (x.operation === 'REVOKE' && !x.targetAdjudicationId) invalid('撤销须引用当前裁定');
  if (
    x.operation === 'DECLARE' &&
    x.targetAdjudicationId !== undefined &&
    x.targetAdjudicationId !== null
  )
    invalid('新裁定不能引用撤销目标');
  return {
    clientRequestId: commandId(x.clientRequestId),
    expectedEventVersion: expectedVersion(x.expectedEventVersion),
    expectedMatchVersion: expectedVersion(x.expectedMatchVersion),
    operation: x.operation as MatchExceptionOperation,
    kind: x.kind as MatchExceptionKind,
    forfeitingSide: x.kind === 'FORFEIT' ? (x.forfeitingSide as 'HOME' | 'AWAY') : null,
    targetAdjudicationId:
      x.operation === 'REVOKE' ? resourceId(x.targetAdjudicationId as string) : null,
    reason: text(x.reason, 'reason', 4, 500),
  };
}
export function exceptionReviewInput(raw: unknown) {
  const x = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'expectedMatchVersion',
    'expectedRequestVersion',
    'type',
    'reason',
  ]);
  if (x.type !== 'APPROVE' && x.type !== 'REJECT') invalid('审核操作无效');
  return {
    clientRequestId: commandId(x.clientRequestId),
    expectedEventVersion: expectedVersion(x.expectedEventVersion),
    expectedMatchVersion: expectedVersion(x.expectedMatchVersion),
    expectedRequestVersion: expectedVersion(x.expectedRequestVersion),
    type: x.type as 'APPROVE' | 'REJECT',
    reason: text(x.reason, 'reason', 4, 500),
  };
}
export interface AdministrativeEvidence {
  /** Must come from the repository's explicit head/decision/rules join. */
  checked: true;
  head: null | { version: number; active_request_id: string | null };
  request: null | Record<string, any>;
  rules: null | Record<string, any>;
}
/** Strict, explicit evidence argument: missing joins are not silently read as no exception. */
export function administrativeOutcome(
  match: {
    id: string;
    fixture_key: string;
    event_id: string;
    version: number;
    home_entry_id: string;
    away_entry_id: string;
    status: string;
    state?: Record<string, any> | null;
  },
  evidence: AdministrativeEvidence,
): AdministrativeMatchOutcome | null {
  const bad = () => exceptionFail('RESULT_SOURCE_INVALID', '行政裁定来源无法核验');
  if (
    !evidence ||
    evidence.checked !== true ||
    !Object.hasOwn(evidence, 'head') ||
    !Object.hasOwn(evidence, 'request') ||
    !Object.hasOwn(evidence, 'rules')
  )
    bad();
  const { head, request: r, rules } = evidence;
  if (head === undefined || r === undefined || rules === undefined) bad();
  if (!head) {
    if (r) bad();
    return null;
  }
  if (!Number.isInteger(head.version) || head.version < 1) bad();
  if (!head.active_request_id) {
    if (r) bad();
    return null;
  }
  if (!r || !rules) bad();
  if (
    !['SCHEDULED', 'READY'].includes(match.status) ||
    (match.status === 'SCHEDULED' && match.state != null) ||
    (match.status === 'READY' &&
      (!match.state ||
        match.state.source_version !== match.version ||
        match.state.clock_running !== false ||
        match.state.latest_confirmation_id))
  )
    bad();
  if (
    ![
      match.id,
      match.event_id,
      match.home_entry_id,
      match.away_entry_id,
      head.active_request_id,
      r!.id,
      r!.proposed_by,
      r!.reviewed_by,
      rules!.id,
    ].every(proofUuid)
  )
    bad();
  if (
    r!.id !== head.active_request_id ||
    r!.match_id !== match.id ||
    r!.event_id !== match.event_id ||
    r!.status !== 'APPROVED' ||
    r!.operation !== 'DECLARE' ||
    r!.version !== 2 ||
    !r!.reviewed_by ||
    !r!.proposed_by ||
    !r!.reviewed_at ||
    !Number.isFinite(new Date(r!.reviewed_at).getTime()) ||
    r!.reviewed_by === r!.proposed_by ||
    !Number.isInteger(r!.source_match_version) ||
    r!.source_match_version < 1 ||
    r!.source_match_version > match.version ||
    r!.rules_id !== rules!.id ||
    r!.rules_version !== rules!.version ||
    rules!.event_id !== match.event_id
  )
    bad();
  for (const k of ['forfeit_win_points', 'forfeit_loss_points'])
    if (!Number.isInteger(rules![k]) || rules![k] < 0 || rules![k] > 1000) bad();
  if (rules!.cancellation_policy !== 'EXCLUDE_FROM_TABLE') bad();
  if (r!.kind === 'CANCELLED') {
    if (r!.forfeiting_side !== null || r!.winner_entry_id !== null || r!.loser_entry_id !== null)
      bad();
    return {
      kind: 'CANCELLED',
      adjudicationId: r!.id,
      adjudicationVersion: r!.version,
      winnerEntryId: null,
      loserEntryId: null,
      homeLeaguePoints: null,
      awayLeaguePoints: null,
      contributesRecordedStatistics: false,
      source: null,
    };
  }
  if (r!.kind !== 'FORFEIT' || !['HOME', 'AWAY'].includes(r!.forfeiting_side)) bad();
  const homeLoses = r!.forfeiting_side === 'HOME';
  const winner = homeLoses ? match.away_entry_id : match.home_entry_id,
    loser = homeLoses ? match.home_entry_id : match.away_entry_id;
  if (r!.winner_entry_id !== winner || r!.loser_entry_id !== loser || winner === loser) bad();
  return {
    kind: 'FORFEIT',
    adjudicationId: r!.id,
    adjudicationVersion: r!.version,
    winnerEntryId: winner,
    loserEntryId: loser,
    homeLeaguePoints: homeLoses ? rules!.forfeit_loss_points : rules!.forfeit_win_points,
    awayLeaguePoints: homeLoses ? rules!.forfeit_win_points : rules!.forfeit_loss_points,
    contributesRecordedStatistics: false,
    source: {
      kind: 'ADJUDICATION',
      fixtureKey: match.fixture_key,
      matchId: match.id,
      adjudicationId: r!.id,
      adjudicationVersion: r!.version,
      matchVersion: r!.source_match_version,
      winnerEntryId: winner,
      loserEntryId: loser,
    },
  };
}

/** One-statement projection used by all result consumers. */
export const exceptionResultSelect = `true AS exception_checked,to_jsonb(xh) AS exception_head,to_jsonb(xr) AS exception_request,to_jsonb(xrules) AS exception_rules`;
export const exceptionResultJoins = `LEFT JOIN match_exception_heads xh ON xh.org_id=m.org_id AND xh.match_id=m.id
 LEFT JOIN match_exception_requests xr ON xr.org_id=xh.org_id AND xr.id=xh.active_request_id
 LEFT JOIN match_exception_rules xrules ON xrules.org_id=xr.org_id AND xrules.id=xr.rules_id AND xrules.version=xr.rules_version`;
export function administrativeResult(m: Record<string, any>): AdministrativeMatchOutcome | null {
  // Legacy pure-domain fixtures have no administrative data. Repository rows always mark the explicit join.
  if (
    m.exception_checked === undefined &&
    m.exception_head === undefined &&
    m.exception_request === undefined &&
    m.exception_rules === undefined
  )
    return null;
  return administrativeOutcome(m as any, {
    checked: m.exception_checked,
    head: m.exception_head,
    request: m.exception_request,
    rules: m.exception_rules,
  });
}

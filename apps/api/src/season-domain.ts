import { createHash } from 'node:crypto';
import type {
  CreateSeasonInput,
  EventPlayerStatisticsData,
  NominateSeasonGrantInput,
  SeasonCommandInput,
  SeasonEventCoverage,
  SeasonEventCoverageState,
  SeasonGrantCommandInput,
  SeasonGrantDisclosure,
  SeasonGrantIneffectiveReason,
  SeasonGrantStatus,
  SeasonPlayerRow,
  SeasonStatisticsSummary,
  UpdateSeasonInput,
  WithdrawSeasonGrantInput,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { calendarDate, invalid, objectInput, text } from './validation.js';
import { expectedVersion } from './registration-validation.js';

export const SEASON_ALGORITHM = 'SEASON_PRIVATE_BASIC_V1' as const;
export const MAX_SEASON_EVENTS = 50;
export const MAX_SEASON_DAYS = 731;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const seasonFail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
export const versionConflict = (currentVersion?: number): never => {
  throw new ApiError(
    409,
    'VERSION_CONFLICT',
    '资料已更新，请重新读取后再操作',
    currentVersion === undefined ? undefined : { currentVersion },
  );
};
export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    invalid('请检查填写的资料', { [field]: '编号无效' });
  return value.toLowerCase();
}
function clientRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value))
    invalid('请检查填写的资料', { clientRequestId: '请求编号须为 UUID v4' });
  return value.toLowerCase();
}
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
function range(startDate: string, endDate: string) {
  const span = dayNumber(endDate) - dayNumber(startDate);
  if (span < 0) invalid('请检查赛季日期', { endDate: '结束日期不能早于开始日期' });
  if (span > MAX_SEASON_DAYS)
    invalid('请检查赛季日期', { endDate: `赛季跨度不能超过 ${MAX_SEASON_DAYS} 天` });
}
/** Reason text: 4–500 characters after trimming (C19 §0). */
export const reasonText = (value: unknown, field = 'reason') => text(value, field, 4, 500);

export function createSeasonInput(raw: unknown): CreateSeasonInput {
  const v = objectInput(raw, ['clientRequestId', 'name', 'startDate', 'endDate']);
  const input = {
    clientRequestId: clientRequestId(v.clientRequestId),
    name: text(v.name, 'name', 1, 80),
    startDate: calendarDate(v.startDate, 'startDate'),
    endDate: calendarDate(v.endDate, 'endDate'),
  };
  range(input.startDate, input.endDate);
  return input;
}
export function updateSeasonInput(
  raw: unknown,
  current: { name: string; startDate: string; endDate: string },
): Required<UpdateSeasonInput> {
  const v = objectInput(raw, ['expectedVersion', 'name', 'startDate', 'endDate']);
  if (v.name === undefined && v.startDate === undefined && v.endDate === undefined)
    invalid('请至少修改一项赛季资料');
  const next = {
    expectedVersion: expectedVersion(v.expectedVersion),
    name: v.name === undefined ? current.name : text(v.name, 'name', 1, 80),
    startDate:
      v.startDate === undefined ? current.startDate : calendarDate(v.startDate, 'startDate'),
    endDate: v.endDate === undefined ? current.endDate : calendarDate(v.endDate, 'endDate'),
  };
  range(next.startDate, next.endDate);
  return next;
}
export function seasonCommandInput(raw: unknown): SeasonCommandInput {
  const v = objectInput(raw, ['type', 'eventId', 'expectedVersion']);
  if (!['ACTIVATE', 'CLOSE', 'ATTACH_EVENT', 'DETACH_EVENT'].includes(v.type as string))
    invalid('不支持的赛季操作', { type: '操作类型无效' });
  const type = v.type as SeasonCommandInput['type'];
  const needsEvent = type === 'ATTACH_EVENT' || type === 'DETACH_EVENT';
  if (!needsEvent && v.eventId !== undefined) invalid('该操作不接受赛事编号');
  return {
    type,
    ...(needsEvent ? { eventId: id(v.eventId, 'eventId') } : {}),
    expectedVersion: expectedVersion(v.expectedVersion),
  };
}
/** The status a command moves a season to, or a 409 when the current state forbids it. */
export function seasonCommandTarget(
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED',
  type: SeasonCommandInput['type'],
) {
  if (status === 'CLOSED') seasonFail(409, 'SEASON_CLOSED', '赛季已关闭，配置和赛事归属已锁定');
  if (type === 'ACTIVATE') {
    if (status !== 'DRAFT') seasonFail(409, 'SEASON_STATE', '只有草稿赛季可以激活');
    return 'ACTIVE' as const;
  }
  if (type === 'CLOSE') {
    if (status !== 'ACTIVE') seasonFail(409, 'SEASON_STATE', '只有进行中的赛季可以关闭');
    return 'CLOSED' as const;
  }
  return status;
}
export function eventWithinSeason(
  event: { startDate: string; endDate: string },
  season: { startDate: string; endDate: string },
) {
  return event.startDate >= season.startDate && event.endDate <= season.endDate;
}

export function nominateInput(raw: unknown): NominateSeasonGrantInput {
  const v = objectInput(raw, ['clientRequestId', 'teamId', 'memberId', 'targetUserId', 'reason']);
  return {
    clientRequestId: clientRequestId(v.clientRequestId),
    teamId: id(v.teamId, 'teamId'),
    memberId: id(v.memberId, 'memberId'),
    targetUserId: id(v.targetUserId, 'targetUserId'),
    reason: reasonText(v.reason),
  };
}
export function withdrawInput(raw: unknown): WithdrawSeasonGrantInput {
  const v = objectInput(raw, ['reason', 'expectedVersion']);
  return { reason: reasonText(v.reason), expectedVersion: expectedVersion(v.expectedVersion) };
}
export function grantCommandInput(raw: unknown): SeasonGrantCommandInput {
  const v = objectInput(raw, ['type', 'expectedVersion']);
  if (!['CONSENT', 'DECLINE', 'REVOKE'].includes(v.type as string))
    invalid('不支持的授权操作', { type: '操作类型无效' });
  return {
    type: v.type as SeasonGrantCommandInput['type'],
    expectedVersion: expectedVersion(v.expectedVersion),
  };
}
/** PENDING -> ACTIVE|DECLINED|WITHDRAWN, ACTIVE -> REVOKED|WITHDRAWN; terminal rows never move. */
export function grantTransition(
  status: SeasonGrantStatus,
  command: 'CONSENT' | 'DECLINE' | 'REVOKE' | 'WITHDRAW',
): SeasonGrantStatus {
  const next: Record<string, SeasonGrantStatus | undefined> = {
    'PENDING:CONSENT': 'ACTIVE',
    'PENDING:DECLINE': 'DECLINED',
    'PENDING:WITHDRAW': 'WITHDRAWN',
    'ACTIVE:REVOKE': 'REVOKED',
    'ACTIVE:WITHDRAW': 'WITHDRAWN',
  };
  const result = next[`${status}:${command}`];
  if (!result)
    return seasonFail(
      409,
      'SEASON_GRANT_STATE',
      '该授权已处理；已结束的授权不能恢复，如需继续请由主办方重新提名',
    );
  return result;
}

export interface GrantConditions {
  status: SeasonGrantStatus;
  bindingActive: boolean;
  nominatorAuthorized: boolean;
  sourceFrozen: boolean;
  targetActive: boolean;
  organizationActive: boolean;
  /** The first prerequisite loss is permanent, even after permissions are restored. */
  invalidationReason?: SeasonGrantIneffectiveReason | null;
}
/** Every current condition; the same rule decides consent eligibility and aggregation. */
export function ineffectiveReasons(c: GrantConditions): SeasonGrantIneffectiveReason[] {
  const reasons: SeasonGrantIneffectiveReason[] = [];
  if (c.status === 'PENDING') reasons.push('NOT_CONSENTED');
  else if (c.status !== 'ACTIVE') reasons.push('TERMINATED');
  if (!c.bindingActive) reasons.push('BINDING_ENDED');
  if (!c.nominatorAuthorized) reasons.push('NOMINATOR_UNAUTHORIZED');
  if (!c.sourceFrozen) reasons.push('SOURCE_NOT_FROZEN');
  if (!c.targetActive) reasons.push('TARGET_INACTIVE');
  if (!c.organizationActive) reasons.push('ORGANIZATION_INACTIVE');
  if (c.invalidationReason && !reasons.includes(c.invalidationReason))
    reasons.push(c.invalidationReason);
  return reasons;
}
/** Upstream conditions only (status aside): whether a pending nomination may be consented now. */
export const upstreamValid = (c: GrantConditions) =>
  !c.invalidationReason &&
  c.bindingActive &&
  c.nominatorAuthorized &&
  c.sourceFrozen &&
  c.targetActive &&
  c.organizationActive;

export const DISCLOSURE: SeasonGrantDisclosure = {
  purpose:
    '用途：私有赛季统计（PRIVATE_SEASON）。仅用于本机构内部赛季汇总，不公开、不进入预约档案、不生成匿名球员榜。',
  scope:
    '范围：仅限提名中写明的机构、这一届赛事、这支球队、这名冻结名单成员与您的账号；同一机构内按您的账号汇总，不跨机构合并。',
  readers:
    '读者：您本人；该机构当前的负责人/管理员（OWNER/ADMIN）。只管理某一届的赛事负责人不能读取赛季汇总；没有匿名或公开查询。',
  metrics:
    '统计口径：只采用记分员逐人记录并经独立确认的得分与犯规；比赛重开即剔除，重新确认只计当前一次。“名单场次”是您在冻结名单内且该场有逐人记录的场次，不代表实际出场。篮板、助攻、出场时间未采集，显示“未统计”。',
  revocation:
    '撤销：同意后可随时在本页撤销，下一次读取即不再计入；主办方也可撤回提名。您的成员绑定结束、提名人失去提名权、账号或机构停用时，原授权永久失效，恢复权限也不会恢复原授权。来源不再属于冻结名单时也停止计入。如需重新授权，只能由主办方重新提名并再次同意。',
  independence:
    '本授权与“公开到预约档案”的授权相互独立：同意其中一项不会自动产生或替代另一项；账号绑定本身也不产生本授权。',
};

// ---------- aggregation ----------
type EventSummary = NonNullable<EventPlayerStatisticsData['summary']>;
export interface SeasonEventInput {
  eventId: string;
  name: string;
  state: SeasonEventCoverageState;
  /** entryId -> teamId from the event's own published source (only for INCLUDED). */
  teamByEntry?: Map<string, string>;
  summary?: EventSummary;
}
export interface EffectiveGrant {
  grantId: string;
  version: number;
  bindingId: string;
  eventId: string;
  teamId: string;
  memberId: string;
  userId: string;
  displayName: string;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function add(a: number, b: number) {
  const value = a + b;
  if (!Number.isSafeInteger(value) || value < 0)
    seasonFail(409, 'RESULT_SOURCE_INVALID', '赛果来源暂时无法核验，请稍后重试');
  return value;
}

/**
 * A projection of each event's existing confirmed per-player statistics, filtered by effective
 * PRIVATE_SEASON grants and grouped by account. Nothing is cached or written.
 */
export function aggregateSeason(input: {
  seasonId: string;
  seasonVersion: number;
  asOf: string;
  events: SeasonEventInput[];
  grants: EffectiveGrant[];
}): SeasonStatisticsSummary {
  const events = [...input.events].sort((a, b) => compare(a.eventId, b.eventId));
  const byEvent = new Map(events.map((e) => [e.eventId, e]));
  const grants = [...input.grants].sort((a, b) => compare(a.grantId, b.grantId));
  const players = new Map<string, SeasonPlayerRow & { eventIds: Set<string> }>();
  // One source row (event, entry, roster revision, member) is counted at most once.
  const counted = new Set<string>();
  const usedGrants: EffectiveGrant[] = [];
  for (const grant of grants) {
    const event = byEvent.get(grant.eventId);
    if (!event) continue;
    usedGrants.push(grant);
    if (event.state !== 'INCLUDED' || !event.summary || !event.teamByEntry) continue;
    for (const row of event.summary.rows) {
      if (row.memberId !== grant.memberId || event.teamByEntry.get(row.entryId) !== grant.teamId)
        continue;
      const key = `${event.eventId}|${row.entryId}|${row.rosterRevisionId}|${row.memberId}`;
      if (counted.has(key)) continue;
      if (row.rosterSampleMatchCount < 1) continue;
      counted.add(key);
      let player = players.get(grant.userId);
      if (!player) {
        player = {
          userId: grant.userId,
          displayName: grant.displayName,
          score: 0,
          fouls: 0,
          rosterSampleMatchCount: 0,
          eventCount: 0,
          rank: 0,
          tied: false,
          sources: [],
          rebounds: null,
          assists: null,
          minutesPlayed: null,
          eventIds: new Set(),
        };
        players.set(grant.userId, player);
      }
      player.score = add(player.score, row.score);
      player.fouls = add(player.fouls, row.fouls);
      player.rosterSampleMatchCount = add(
        player.rosterSampleMatchCount,
        row.rosterSampleMatchCount,
      );
      player.eventIds.add(event.eventId);
      player.sources.push({
        eventId: event.eventId,
        eventName: event.name,
        teamName: row.teamName,
        memberName: row.name,
        jerseyNo: row.jerseyNo,
        score: row.score,
        fouls: row.fouls,
        rosterSampleMatchCount: row.rosterSampleMatchCount,
      });
    }
  }
  const rows = [...players.values()]
    .map(({ eventIds, ...row }) => ({ ...row, eventCount: eventIds.size }))
    .sort((a, b) => b.score - a.score || compare(a.userId, b.userId));
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && rows[end]!.score === rows[start]!.score) end++;
    for (let i = start; i < end; i++) {
      rows[i]!.rank = start + 1;
      rows[i]!.tied = end - start > 1;
    }
    start = end;
  }
  const coverage: SeasonEventCoverage[] = events.map((e) => ({
    eventId: e.eventId,
    name: e.name,
    state: e.state,
    totalMatchCount: e.summary?.totalMatchCount ?? 0,
    includedMatchCount: e.summary?.includedMatchCount ?? 0,
    teamOnlyConfirmedMatchCount: e.summary?.teamOnlyConfirmedMatchCount ?? 0,
    pendingMatchCount: e.summary?.pendingMatchCount ?? 0,
    ...(e.summary?.excludedAdministrativeMatchCount
      ? {
          excludedAdministrativeMatchCount: e.summary.excludedAdministrativeMatchCount,
          recordableMatchCount: e.summary.recordableMatchCount,
        }
      : {}),
    coverageComplete: e.state === 'INCLUDED' && e.summary?.coverageComplete === true,
    attributionComplete: e.state === 'INCLUDED' && e.summary?.attributionComplete === true,
  }));
  const canonical = {
    algorithmVersion: SEASON_ALGORITHM,
    seasonId: input.seasonId,
    seasonVersion: input.seasonVersion,
    events: events.map((e) => ({
      eventId: e.eventId,
      state: e.state,
      sourceHash: e.summary?.sourceHash ?? null,
    })),
    grants: usedGrants.map((g) => ({
      grantId: g.grantId,
      version: g.version,
      bindingId: g.bindingId,
      eventId: g.eventId,
      teamId: g.teamId,
      memberId: g.memberId,
      userId: g.userId,
    })),
  };
  return {
    algorithmVersion: SEASON_ALGORITHM,
    sourceHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    asOf: input.asOf,
    seasonVersion: input.seasonVersion,
    events: coverage,
    effectiveGrantCount: usedGrants.length,
    rankingComplete:
      coverage.length > 0 && coverage.every((e) => e.coverageComplete && e.attributionComplete),
    rows,
    notCollected: ['REBOUNDS', 'ASSISTS', 'MINUTES'],
  };
}

/** entryId -> teamId from a published schedule source (the frozen registration entries). */
export function teamsByEntry(source: unknown): Map<string, string> {
  const entries = (source as { entries?: unknown } | null)?.entries;
  const map = new Map<string, string>();
  if (!Array.isArray(entries)) return map;
  for (const entry of entries)
    if (entry && typeof entry.entryId === 'string' && typeof entry.teamId === 'string')
      map.set(entry.entryId, entry.teamId);
  return map;
}

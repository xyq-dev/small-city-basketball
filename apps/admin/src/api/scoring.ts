import { MATCH_STATUSES, SCORING_COMMAND_TYPES } from '@small-city-basketball/contracts';
import type {
  EventScoringData,
  UpdateScoringRulesInput,
  ScoringWorkbenchData,
  ScoringMatchSummary,
  ScoringCommandInput,
  ScoringCommandResponse,
  ScoreSnapshot,
  ScorekeeperLeaseData,
  ScoringControl,
  UpdateMatchStaffInput,
  ScoringEventData,
  ResultConfirmationData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, keys: string[]) => obj(v) && keys.every((k) => typeof v[k] === 'string');
const ints = (v: unknown, keys: string[]) =>
  obj(v) && keys.every((k) => Number.isInteger(v[k]) && Number(v[k]) >= 0);
const bool = (v: unknown, keys: string[]) => obj(v) && keys.every((k) => typeof v[k] === 'boolean');
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const status = (v: unknown) =>
  typeof v === 'string' && (MATCH_STATUSES as readonly string[]).includes(v);
const party = (v: unknown) => str(v, ['entryId', 'teamId', 'teamName', 'rosterRevisionId']);
const totals = (v: unknown) => ints(v, ['score', 'fouls', 'timeouts']);
const periods = (v: unknown) =>
  Array.isArray(v) &&
  v.every((p) => ints(p, ['period']) && obj(p) && totals(p.home) && totals(p.away));
function administrativeMarker(v: Obj) {
  if (!Object.hasOwn(v, 'adjudication')) return true;
  return (
    obj(v.adjudication) &&
    Object.keys(v.adjudication).length === 1 &&
    ['FORFEIT', 'CANCELLED'].includes(String(v.adjudication.kind))
  );
}
function rosterPlayers(v: unknown) {
  if (!Array.isArray(v)) return false;
  const ids = new Set<string>();
  return v.every((player) => {
    if (!str(player, ['memberId', 'name', 'jerseyNo']) || !obj(player)) return false;
    const id = player.memberId as string;
    if (!id || ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}
function playerStatistics(v: unknown, home: unknown, away: unknown) {
  // Older TEAM_ONLY responses did not include this additive field.
  if (v === null || v === undefined) return true;
  if (!obj(v) || v.mode !== 'PLAYER_BASIC') return false;
  const seen = new Set<string>();
  return (
    [
      ['home', home],
      ['away', away],
    ] as const
  ).every(([side, total]) => {
    const team = v[side];
    if (
      !obj(team) ||
      !rosterPlayers(team.players) ||
      !Array.isArray(team.players) ||
      !obj(team.unassigned) ||
      !obj(total)
    )
      return false;
    const unassigned = team.unassigned;
    if (
      !['score', 'fouls'].every(
        (kind) => Number.isSafeInteger(unassigned[kind]) && Number(unassigned[kind]) >= 0,
      )
    )
      return false;
    let score = Number(unassigned.score),
      fouls = Number(unassigned.fouls);
    for (const player of team.players) {
      if (
        !obj(player) ||
        !['score', 'fouls'].every(
          (kind) => Number.isSafeInteger(player[kind]) && Number(player[kind]) >= 0,
        ) ||
        seen.has(String(player.memberId))
      )
        return false;
      seen.add(String(player.memberId));
      score += Number(player.score);
      fouls += Number(player.fouls);
    }
    return (
      Number.isSafeInteger(score) &&
      Number.isSafeInteger(fouls) &&
      score === total.score &&
      fouls === total.fouls
    );
  });
}
function rules(v: unknown) {
  return (
    obj(v) &&
    str(v, ['id', 'eventId', 'createdAt']) &&
    ints(v, ['version', 'regulationPeriods', 'periodDurationSeconds']) &&
    Array.isArray(v.allowedScoreValues) &&
    v.allowedScoreValues.length > 0 &&
    v.allowedScoreValues.every((n) => [1, 2, 3].includes(Number(n)) && typeof n === 'number') &&
    ['ALLOW_DRAW', 'OVERTIME'].includes(String(v.tiePolicy)) &&
    (v.tiePolicy === 'ALLOW_DRAW'
      ? v.overtimeDurationSeconds === null
      : Number.isInteger(v.overtimeDurationSeconds))
  );
}
function confirmation(v: unknown) {
  return (
    obj(v) &&
    str(v, ['id', 'matchId', 'confirmingUserId', 'rulesetId', 'confirmedAt']) &&
    ints(v, ['rulesetVersion', 'sourceMatchVersion', 'lastEventSeq']) &&
    totals(v.home) &&
    totals(v.away) &&
    periods(v.periods) &&
    playerStatistics(v.playerStatistics, v.home, v.away)
  );
}
function snapshot(v: unknown) {
  return (
    obj(v) &&
    administrativeMarker(v) &&
    str(v, ['matchId', 'eventId', 'eventName', 'serverTime']) &&
    time(v.serverTime) &&
    ints(v, ['version', 'lastEventSeq']) &&
    status(v.status) &&
    party(v.home) &&
    party(v.away) &&
    obj(v.totals) &&
    totals(v.totals.home) &&
    totals(v.totals.away) &&
    periods(v.periods) &&
    rules(v.rules) &&
    obj(v.clock) &&
    ints(v.clock, ['period', 'remainingMs', 'clockVersion']) &&
    bool(v.clock, ['running']) &&
    str(v.clock, ['anchorServerTime']) &&
    time(v.clock.anchorServerTime) &&
    (v.latestConfirmation === null || confirmation(v.latestConfirmation)) &&
    bool(v, ['requiresReconfirmation']) &&
    obj(v.collected) &&
    v.collected.teamScore === true &&
    v.collected.teamFouls === true &&
    v.collected.teamTimeouts === true &&
    typeof v.collected.playerStatistics === 'boolean' &&
    v.collected.playerStatistics === Boolean(v.playerStatistics) &&
    playerStatistics(v.playerStatistics, v.totals.home, v.totals.away)
  );
}
function staff(v: unknown) {
  return (
    obj(v) &&
    str(v, ['userId', 'displayName']) &&
    ['SCORER', 'RESULT_REVIEWER'].includes(String(v.role)) &&
    ['ACTIVE', 'DISABLED'].includes(String(v.status))
  );
}
function match(v: unknown) {
  return (
    obj(v) &&
    administrativeMarker(v) &&
    str(v, [
      'id',
      'eventId',
      'publicationId',
      'fixtureKey',
      'courtId',
      'courtName',
      'startsAt',
      'endsAt',
    ]) &&
    ints(v, ['roundNo', 'positionNo', 'version']) &&
    status(v.status) &&
    party(v.home) &&
    party(v.away)
  );
}
function workbench(v: unknown) {
  return (
    obj(v) &&
    match(v.match) &&
    str(v.event, ['id', 'name', 'status']) &&
    ints(v.event, ['version']) &&
    (v.rules === null || rules(v.rules)) &&
    bool(v, ['rulesLocked']) &&
    (v.snapshot === null || snapshot(v.snapshot)) &&
    (v.playerRoster === undefined
      ? v.snapshot === null ||
        (obj(v.snapshot) &&
          obj(v.snapshot.collected) &&
          v.snapshot.collected.playerStatistics === false)
      : obj(v.playerRoster) &&
        rosterPlayers(v.playerRoster.home) &&
        rosterPlayers(v.playerRoster.away)) &&
    Array.isArray(v.staff) &&
    v.staff.every(staff) &&
    obj(v.lease) &&
    typeof v.lease.held === 'boolean' &&
    (v.lease.expiresAt === null || typeof v.lease.expiresAt === 'string') &&
    (v.lease.holderUserId === null || typeof v.lease.holderUserId === 'string') &&
    bool(v.capabilities, [
      'canManageStaff',
      'canPrepare',
      'canAcquireControl',
      'canRecord',
      'canCorrect',
      'canConfirm',
      'canReopen',
    ])
  );
}
function summary(v: unknown) {
  return (
    obj(v) &&
    administrativeMarker(v) &&
    str(v, [
      'matchId',
      'eventId',
      'eventName',
      'homeTeamName',
      'awayTeamName',
      'courtName',
      'startsAt',
    ]) &&
    status(v.status) &&
    ints(v, ['version']) &&
    (v.score === null || ints(v.score, ['home', 'away']))
  );
}
function event(v: unknown) {
  return (
    obj(v) &&
    str(v, ['id', 'type', 'actorId', 'commandId', 'capturedAt', 'serverTime']) &&
    ints(v, ['seq']) &&
    obj(v.payload) &&
    (v.targetEventId === null || typeof v.targetEventId === 'string')
  );
}
function response(v: unknown) {
  return (
    obj(v) &&
    obj(v.receipt) &&
    str(v.receipt, ['commandId', 'matchId', 'type', 'acceptedAt']) &&
    (SCORING_COMMAND_TYPES as readonly string[]).includes(String(v.receipt.type)) &&
    ints(v.receipt, ['appliedVersion']) &&
    ['firstEventSeq', 'lastEventSeq'].every(
      (k) =>
        v.receipt !== null &&
        obj(v.receipt) &&
        (v.receipt[k] === null || Number.isInteger(v.receipt[k])),
    ) &&
    snapshot(v.snapshot)
  );
}
function lease(v: unknown) {
  return (
    obj(v) &&
    str(v, ['leaseId', 'fencingToken', 'clientInstanceId', 'expiresAt', 'serverTime']) &&
    time(v.serverTime) &&
    time(v.expiresAt)
  );
}
function eventScoring(v: unknown) {
  return (
    obj(v) &&
    str(v.event, ['id', 'name', 'status']) &&
    ints(v.event, ['version']) &&
    (v.rules === null || rules(v.rules)) &&
    bool(v, ['locked']) &&
    bool(v.capabilities, ['canManageRules'])
  );
}
function checked<T>(v: unknown, guard: (v: unknown) => boolean): T {
  if (!guard(v))
    throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的记分资料或操作权限不完整，请重新读取');
  return v as T;
}
export function createScoringApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有场次权限的机构');
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}`;
  const id = (value: string) => encodeURIComponent(value);
  async function request(path: string, method = 'GET', input?: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      return await client.request<unknown>(base + path, {
        method,
        signal: controller.signal,
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  async function read<T>(path: string, guard: (v: unknown) => boolean) {
    return checked<T>((await request(path)).data, guard);
  }
  async function write<T>(
    path: string,
    method: string,
    input: unknown,
    guard: (v: unknown) => boolean,
  ) {
    return checked<T>((await request(path, method, input)).data, guard);
  }
  async function pages<T>(
    path: string,
    guard: (v: unknown) => boolean,
    filters: Record<string, string> = {},
  ) {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ ...filters, limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const page = await request(`${path}?${query}`);
      if (!Array.isArray(page.data))
        throw new ApiError(200, 'INVALID_RESPONSE', '记分列表资料不完整');
      items.push(...page.data.map((item) => checked<T>(item, guard)));
      const next: unknown = page.meta.nextCursor;
      if (next !== null && next !== undefined && (typeof next !== 'string' || !next))
        throw new ApiError(200, 'INVALID_CURSOR', '记分列表分页信息不正确');
      cursor = typeof next === 'string' ? next : null;
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 1000)
          throw new ApiError(200, 'INVALID_CURSOR', '记分列表分页无法继续');
        seen.add(cursor);
      }
    } while (cursor);
    return items;
  }
  return {
    matches: (filters: Record<string, string> = {}) =>
      pages<ScoringMatchSummary>('/scoring-matches', summary, filters),
    event: (eventId: string) =>
      read<EventScoringData>(`/events/${id(eventId)}/scoring`, eventScoring),
    rules: (eventId: string, input: UpdateScoringRulesInput) =>
      write<EventScoringData>(`/events/${id(eventId)}/scoring-rules`, 'PUT', input, eventScoring),
    workbench: (matchId: string) =>
      read<ScoringWorkbenchData>(`/matches/${id(matchId)}/scoring`, workbench),
    staff: (matchId: string, userId: string, input: UpdateMatchStaffInput) =>
      write<ScoringWorkbenchData>(
        `/matches/${id(matchId)}/staff/${id(userId)}`,
        'PUT',
        input,
        workbench,
      ),
    acquire: async (matchId: string, clientInstanceId: string) => {
      const result = await write<ScorekeeperLeaseData>(
        `/matches/${id(matchId)}/scorekeeper-lease`,
        'POST',
        { clientInstanceId },
        lease,
      );
      if (result.clientInstanceId !== clientInstanceId)
        throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的控制权不属于本页');
      return result;
    },
    renew: async (matchId: string, control: ScoringControl) => {
      const result = await write<ScorekeeperLeaseData>(
        `/matches/${id(matchId)}/scorekeeper-lease/renew`,
        'POST',
        { control },
        lease,
      );
      if (
        result.clientInstanceId !== control.clientInstanceId ||
        result.leaseId !== control.leaseId ||
        result.fencingToken !== control.fencingToken
      )
        throw new ApiError(200, 'INVALID_RESPONSE', '控制权续期与本页凭据不匹配');
      return result;
    },
    release: async (matchId: string, control: ScoringControl) => {
      await write<null>(
        `/matches/${id(matchId)}/scorekeeper-lease`,
        'DELETE',
        { control },
        (v) => v === null,
      );
    },
    command: async (matchId: string, input: ScoringCommandInput) => {
      const result = await write<ScoringCommandResponse>(
        `/matches/${id(matchId)}/commands`,
        'POST',
        input,
        response,
      );
      if (
        result.receipt.matchId !== matchId ||
        result.snapshot.matchId !== matchId ||
        result.receipt.commandId !== input.commandId ||
        result.receipt.type !== input.type
      )
        throw new ApiError(200, 'INVALID_RESPONSE', '记分确认与本次命令不匹配，请核对提交结果');
      return result;
    },
    receipt: async (matchId: string, commandId: string) => {
      const result = await read<ScoringCommandResponse>(
        `/matches/${id(matchId)}/commands/${id(commandId)}`,
        response,
      );
      if (
        result.receipt.matchId !== matchId ||
        result.snapshot.matchId !== matchId ||
        result.receipt.commandId !== commandId
      )
        throw new ApiError(200, 'INVALID_RESPONSE', '收据与本次待核对命令不匹配');
      return result;
    },
    snapshot: (matchId: string) =>
      read<ScoreSnapshot>(`/matches/${id(matchId)}/snapshot`, snapshot),
    events: (matchId: string) =>
      pages<ScoringEventData>(`/matches/${id(matchId)}/scoring-events`, event),
    confirmations: (matchId: string) =>
      pages<ResultConfirmationData>(`/matches/${id(matchId)}/result-confirmations`, confirmation),
  };
}
export type ScoringApi = ReturnType<typeof createScoringApi>;

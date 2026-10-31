import { MATCH_STATUSES, STANDINGS_TIEBREAKERS } from '@small-city-basketball/contracts';
import type {
  EventStandingsData,
  UpdateStandingsRulesInput,
  StandingsRuleCommandInput,
  PublicViewingCommandInput,
  PublicEventData,
  PublicScheduleMatchData,
  PublicStandingsData,
  PublicMatchSnapshotData,
  PublicKnockoutData,
  PublicGroupKnockoutData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import { publicKnockout } from './knockout';
import { publicGroups } from './group-knockout';
import type { ApiClient } from './client';
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown, keys: string[]) =>
  obj(v) && keys.every((k) => typeof v[k] === 'string');
const numbers = (v: unknown, keys: string[]) => obj(v) && keys.every((k) => Number.isInteger(v[k]));
const bools = (v: unknown, keys: string[]) =>
  obj(v) && keys.every((k) => typeof v[k] === 'boolean');
const exact = (v: unknown, keys: string[]) =>
  obj(v) && Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => Object.hasOwn(v, k));
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const matchStatus = (v: unknown) =>
  typeof v === 'string' && (MATCH_STATUSES as readonly string[]).includes(v);
const resultStatus = (v: unknown) =>
  ['UNCONFIRMED', 'CONFIRMED', 'REQUIRES_RECONFIRMATION'].includes(String(v));
const configurationKeys = ['winPoints', 'lossPoints', 'drawPoints', 'tiebreakers'];
function configuration(v: unknown) {
  return (
    numbers(v, ['winPoints', 'lossPoints', 'drawPoints']) &&
    obj(v) &&
    ['winPoints', 'lossPoints', 'drawPoints'].every(
      (k) => Number(v[k]) >= 0 && Number(v[k]) <= 1000,
    ) &&
    Array.isArray(v.tiebreakers) &&
    v.tiebreakers.every(
      (k) => typeof k === 'string' && (STANDINGS_TIEBREAKERS as readonly string[]).includes(k),
    ) &&
    new Set(v.tiebreakers).size === v.tiebreakers.length
  );
}
function privateRules(v: unknown) {
  return (
    configuration(v) &&
    obj(v) &&
    strings(v, ['id', 'eventId', 'createdAt']) &&
    numbers(v, ['version']) &&
    v.algorithmVersion === 'RR_STANDINGS_V1'
  );
}
function publicRules(v: unknown) {
  return (
    exact(v, [...configurationKeys, 'version', 'algorithmVersion']) &&
    configuration(v) &&
    obj(v) &&
    numbers(v, ['version']) &&
    v.algorithmVersion === 'RR_STANDINGS_V1'
  );
}
const metrics = [
  'played',
  'wins',
  'draws',
  'losses',
  'pointsFor',
  'pointsAgainst',
  'scoreDifference',
  'leaguePoints',
];
function row(v: unknown, publicOnly: boolean) {
  return (
    obj(v) &&
    numbers(v, metrics) &&
    strings(v, ['teamName', ...(publicOnly ? ['teamKey'] : ['entryId', 'teamId'])]) &&
    (v.rank === null || (Number.isInteger(v.rank) && Number(v.rank) > 0)) &&
    typeof v.tied === 'boolean' &&
    (!publicOnly || exact(v, [...metrics, 'teamKey', 'teamName', 'rank', 'tied']))
  );
}
const standingsKeys = [
  'sourceHash',
  'asOf',
  'confirmedMatchCount',
  'totalMatchCount',
  'isComplete',
  'hasSharedRanks',
  'rows',
];
function standings(v: unknown, publicOnly: boolean) {
  return (
    obj(v) &&
    strings(v, ['sourceHash', 'asOf']) &&
    time(v.asOf) &&
    numbers(v, ['confirmedMatchCount', 'totalMatchCount']) &&
    bools(v, ['isComplete', 'hasSharedRanks']) &&
    Array.isArray(v.rows) &&
    v.rows.every((item) => row(item, publicOnly)) &&
    (publicOnly
      ? exact(v, [...standingsKeys, 'publicEventId', 'rules']) &&
        strings(v, ['publicEventId']) &&
        publicRules(v.rules)
      : numbers(v, ['rulesetVersion']) && ['DRAFT_PREVIEW', 'PUBLISHED'].includes(String(v.mode)))
  );
}
function privateOverview(v: unknown) {
  return (
    obj(v) &&
    strings(v.event, ['id', 'name', 'format', 'status']) &&
    numbers(v.event, ['version']) &&
    (v.rules === null || privateRules(v.rules)) &&
    typeof v.locked === 'boolean' &&
    (v.standings === null || standings(v.standings, false)) &&
    (v.publication === null ||
      (obj(v.publication) &&
        strings(v.publication, ['publicEventId', 'createdAt']) &&
        ['ACTIVE', 'REVOKED'].includes(String(v.publication.status)) &&
        (v.publication.purpose === undefined ||
          v.publication.purpose === 'LIVE' ||
          v.publication.purpose === 'HISTORY') &&
        (v.publication.revokedAt === null || typeof v.publication.revokedAt === 'string'))) &&
    bools(v.capabilities, [
      'canManageRules',
      'canPublishRules',
      'canEnablePublicViewing',
      'canDisablePublicViewing',
    ])
  );
}
function publicEvent(v: unknown) {
  return (
    obj(v) &&
    (v.format === undefined ||
      v.format === 'ROUND_ROBIN' ||
      v.format === 'DOUBLE_ROUND_ROBIN' ||
      v.format === 'SINGLE_ELIMINATION' ||
      v.format === 'GROUP_KNOCKOUT') &&
    exact(v, [
      ...(v.format === undefined ? [] : ['format']),
      'publicEventId',
      'name',
      'startDate',
      'endDate',
      'timezone',
      'venueName',
      'status',
      'rules',
      'confirmedMatchCount',
      'totalMatchCount',
      'isComplete',
      'serverTime',
    ]) &&
    obj(v) &&
    strings(v, [
      'publicEventId',
      'name',
      'startDate',
      'endDate',
      'timezone',
      'status',
      'serverTime',
    ]) &&
    (v.venueName === null || typeof v.venueName === 'string') &&
    (v.format === 'SINGLE_ELIMINATION' ? v.rules === null : publicRules(v.rules)) &&
    numbers(v, ['confirmedMatchCount', 'totalMatchCount']) &&
    typeof v.isComplete === 'boolean' &&
    time(v.serverTime)
  );
}
function team(v: unknown) {
  return exact(v, ['teamKey', 'teamName']) && strings(v, ['teamKey', 'teamName']);
}
const matchKeys = [
  'publicMatchId',
  'roundNo',
  'positionNo',
  'home',
  'away',
  'courtName',
  'startsAt',
  'endsAt',
  'status',
  'version',
  'score',
  'resultStatus',
];
function matchFields(v: unknown) {
  return (
    obj(v) &&
    strings(v, ['publicMatchId', 'courtName', 'startsAt', 'endsAt']) &&
    numbers(v, ['roundNo', 'positionNo', 'version']) &&
    team(v.home) &&
    team(v.away) &&
    matchStatus(v.status) &&
    resultStatus(v.resultStatus) &&
    (v.score === null || (exact(v.score, ['home', 'away']) && numbers(v.score, ['home', 'away'])))
  );
}
function scheduleMatch(v: unknown) {
  return exact(v, matchKeys) && matchFields(v);
}
const totals = (v: unknown) =>
  exact(v, ['score', 'fouls', 'timeouts']) && numbers(v, ['score', 'fouls', 'timeouts']);
function clock(v: unknown) {
  return (
    exact(v, ['period', 'remainingMs', 'running', 'anchorServerTime', 'clockVersion']) &&
    numbers(v, ['period', 'remainingMs', 'clockVersion']) &&
    obj(v) &&
    typeof v.running === 'boolean' &&
    time(v.anchorServerTime) &&
    Number(v.remainingMs) >= 0
  );
}
function scoringRules(v: unknown) {
  return (
    exact(v, [
      'regulationPeriods',
      'periodDurationSeconds',
      'allowedScoreValues',
      'tiePolicy',
      'overtimeDurationSeconds',
      'version',
    ]) &&
    numbers(v, ['regulationPeriods', 'periodDurationSeconds', 'version']) &&
    obj(v) &&
    Array.isArray(v.allowedScoreValues) &&
    v.allowedScoreValues.length > 0 &&
    v.allowedScoreValues.every((n) => typeof n === 'number' && [1, 2, 3].includes(n)) &&
    ['ALLOW_DRAW', 'OVERTIME'].includes(String(v.tiePolicy)) &&
    (v.tiePolicy === 'ALLOW_DRAW'
      ? v.overtimeDurationSeconds === null
      : Number.isInteger(v.overtimeDurationSeconds))
  );
}
function publicSnapshot(v: unknown) {
  if (
    !exact(v, [
      ...matchKeys,
      'publicEventId',
      'eventName',
      'totals',
      'periods',
      'rules',
      'clock',
      'collected',
      'serverTime',
    ]) ||
    !matchFields(v) ||
    !obj(v) ||
    !strings(v, ['publicEventId', 'eventName', 'serverTime']) ||
    !time(v.serverTime) ||
    !exact(v.collected, ['teamScore', 'teamFouls', 'teamTimeouts', 'playerStatistics']) ||
    !obj(v.collected) ||
    v.collected.playerStatistics !== false
  )
    return false;
  if (v.score === null)
    return (
      v.totals === null &&
      v.periods === null &&
      v.rules === null &&
      v.clock === null &&
      v.collected.teamScore === false &&
      v.collected.teamFouls === false &&
      v.collected.teamTimeouts === false
    );
  return (
    exact(v.totals, ['home', 'away']) &&
    obj(v.totals) &&
    totals(v.totals.home) &&
    totals(v.totals.away) &&
    Array.isArray(v.periods) &&
    v.periods.every(
      (p) =>
        exact(p, ['period', 'home', 'away']) &&
        numbers(p, ['period']) &&
        obj(p) &&
        totals(p.home) &&
        totals(p.away),
    ) &&
    scoringRules(v.rules) &&
    clock(v.clock) &&
    v.collected.teamScore === true &&
    v.collected.teamFouls === true &&
    v.collected.teamTimeouts === true
  );
}
function checked<T>(v: unknown, guard: (value: unknown) => boolean): T {
  if (!guard(v)) throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的资料不完整，请重新读取');
  return v as T;
}
export function createViewingApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有赛事权限的机构');
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}/events`;
  async function request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      return await client.request<unknown>(path, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  async function read(eventId: string) {
    return checked<EventStandingsData>(
      (await request(`${base}/${encodeURIComponent(eventId)}/standings`)).data,
      privateOverview,
    );
  }
  async function write(eventId: string, path: string, method: string, input: unknown) {
    return checked<EventStandingsData>(
      (
        await request(`${base}/${encodeURIComponent(eventId)}/${path}`, {
          method,
          body: JSON.stringify(input),
        })
      ).data,
      privateOverview,
    );
  }
  return {
    event: read,
    saveRules: (eventId: string, input: UpdateStandingsRulesInput) =>
      write(eventId, 'standings-rules', 'PUT', input),
    publishRules: (eventId: string, input: StandingsRuleCommandInput) =>
      write(eventId, 'standings-rule-commands', 'POST', input),
    publicViewing: (eventId: string, input: PublicViewingCommandInput) =>
      write(eventId, 'public-viewing-commands', 'POST', input),
  };
}
export function createPublicViewingApi({ fetcher }: { fetcher?: typeof fetch } = {}) {
  async function request(path: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 20000);
    try {
      let response: Response;
      try {
        response = await (fetcher ?? globalThis.fetch)(path, {
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', '无法连接观赛服务，请检查网络后重试');
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        value = undefined;
      }
      if (!response.ok)
        throw new ApiError(
          response.status,
          response.status === 404
            ? 'PUBLIC_NOT_FOUND'
            : obj(value) && obj(value.error) && value.error.code === 'RESULT_SOURCE_INVALID'
              ? 'RESULT_SOURCE_INVALID'
              : 'PUBLIC_UNAVAILABLE',
          response.status === 404 ? '观赛链接不可用或已撤销' : '暂时无法读取公开资料，请稍后重试',
        );
      if (
        !obj(value) ||
        !Object.hasOwn(value, 'data') ||
        !obj(value.meta) ||
        typeof value.meta.requestId !== 'string'
      )
        throw new ApiError(200, 'INVALID_RESPONSE', '观赛资料格式不完整，请稍后重试');
      return { data: value.data, meta: value.meta };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  const base = (eventId: string) => `/v1/public/events/${encodeURIComponent(eventId)}`;
  async function get<T>(path: string, guard: (v: unknown) => boolean, signal?: AbortSignal) {
    return checked<T>((await request(path, signal)).data, guard);
  }
  return {
    event: (publicEventId: string, signal?: AbortSignal) =>
      get<PublicEventData>(base(publicEventId), publicEvent, signal),
    knockout: (publicEventId: string, signal?: AbortSignal) =>
      get<PublicKnockoutData>(`${base(publicEventId)}/knockout`, publicKnockout, signal),
    groups: (publicEventId: string, signal?: AbortSignal) =>
      get<PublicGroupKnockoutData>(`${base(publicEventId)}/groups`, publicGroups, signal),
    standings: (publicEventId: string, signal?: AbortSignal) =>
      get<PublicStandingsData>(
        `${base(publicEventId)}/standings`,
        (v) => standings(v, true),
        signal,
      ),
    match: (publicEventId: string, publicMatchId: string, signal?: AbortSignal) =>
      get<PublicMatchSnapshotData>(
        `${base(publicEventId)}/matches/${encodeURIComponent(publicMatchId)}`,
        publicSnapshot,
        signal,
      ),
    schedule: async (publicEventId: string, filter?: string, signal?: AbortSignal) => {
      const data: PublicScheduleMatchData[] = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (filter) query.set('status', filter);
        if (cursor) query.set('cursor', cursor);
        const page = await request(`${base(publicEventId)}/schedule?${query}`, signal);
        if (!Array.isArray(page.data))
          throw new ApiError(200, 'INVALID_RESPONSE', '赛程资料不完整，请稍后重试');
        data.push(
          ...page.data.map((item) => checked<PublicScheduleMatchData>(item, scheduleMatch)),
        );
        const next = page.meta.nextCursor;
        if (next !== undefined && next !== null && (typeof next !== 'string' || !next))
          throw new ApiError(200, 'INVALID_CURSOR', '赛程分页资料不完整');
        cursor = typeof next === 'string' ? next : null;
        if (cursor) {
          if (seen.has(cursor) || seen.size >= 1000)
            throw new ApiError(200, 'INVALID_CURSOR', '赛程分页无法继续');
          seen.add(cursor);
        }
      } while (cursor);
      return data;
    },
  };
}
export type PublicViewingApi = ReturnType<typeof createPublicViewingApi>;

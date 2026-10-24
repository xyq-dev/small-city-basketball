import type {
  PlayerPerformanceData,
  PlayerPerformanceWorkspaceData,
  PlayerPerformanceSourcesData,
  PlayerPerformanceLinkData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';
import type { PlayerPerformanceRepository } from '../booking/performance-model';
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const positive = (v: unknown) => integer(v) && Number(v) > 0;
const timestamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const exact = (v: unknown, keys: string[]) =>
  object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
function invalid(): never {
  throw new ApiError(
    200,
    'INVALID_PERFORMANCE_RESPONSE',
    '球员统计或授权资料不完整，已停止展示，请重新读取。',
  );
}
const countKeys = [
  'sourceCount',
  'recordedMatchCount',
  'confirmedMatchCount',
  'teamOnlyMatchCount',
  'partialAttributionMatchCount',
  'pendingMatchCount',
  'invalidMatchCount',
  'completedServiceCount',
];
const metricKeys = ['totalPoints', 'totalFouls', 'pointsPerRecordedMatch', 'foulsPerRecordedMatch'];
const missingKeys = ['rebounds', 'assists', 'minutes', 'fieldGoalPercentage'];
export function parsePlayerPerformance(v: unknown): PlayerPerformanceData {
  if (
    !exact(v, [
      'profileId',
      'dataStatus',
      'sampleLimit',
      'truncated',
      ...countKeys,
      ...metricKeys,
      ...missingKeys,
      'recentRecords',
      'denominatorNotice',
      'completenessNotice',
      'asOf',
    ]) ||
    !object(v) ||
    !text(v.profileId) ||
    v.sampleLimit !== 1000 ||
    typeof v.truncated !== 'boolean' ||
    !['NO_AUTHORIZED_SOURCE', 'NO_PERSONAL_STATS', 'AVAILABLE', 'PARTIAL'].includes(
      String(v.dataStatus),
    ) ||
    !countKeys.every((k) => integer(v[k])) ||
    !metricKeys.every(
      (k) =>
        v[k] === null || (typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 0),
    ) ||
    !missingKeys.every((k) => v[k] === null) ||
    !text(v.denominatorNotice) ||
    !text(v.completenessNotice) ||
    !timestamp(v.asOf) ||
    !Array.isArray(v.recentRecords) ||
    v.recentRecords.length > 5 ||
    !v.recentRecords.every(
      (r) =>
        exact(r, [
          'recordKey',
          'eventName',
          'date',
          'format',
          'collectionMode',
          'points',
          'fouls',
          'attributionComplete',
          'source',
        ]) &&
        object(r) &&
        ['recordKey', 'eventName', 'date', 'format'].every((k) => text(r[k])) &&
        timestamp(r.date) &&
        r.source === 'INDEPENDENT_CONFIRMATION' &&
        (r.collectionMode === 'TEAM_ONLY'
          ? r.points === null && r.fouls === null && r.attributionComplete === null
          : r.collectionMode === 'PLAYER_BASIC' &&
            integer(r.points) &&
            integer(r.fouls) &&
            typeof r.attributionComplete === 'boolean'),
    )
  )
    invalid();
  if (Number(v.recordedMatchCount) === 0 && metricKeys.some((k) => v[k] !== null)) invalid();
  if (Number(v.recordedMatchCount) > 0 && metricKeys.some((k) => v[k] === null)) invalid();
  if (Number(v.confirmedMatchCount) !== Number(v.recordedMatchCount) + Number(v.teamOnlyMatchCount))
    invalid();
  if (v.dataStatus === 'NO_AUTHORIZED_SOURCE' && Number(v.sourceCount) !== 0) invalid();
  return v as unknown as PlayerPerformanceData;
}
function link(v: unknown): v is PlayerPerformanceLinkData {
  return (
    object(v) &&
    [
      'id',
      'profileId',
      'profileName',
      'orgId',
      'eventId',
      'eventName',
      'teamId',
      'teamName',
      'memberId',
      'memberName',
      'nominatedByUserId',
      'reason',
    ].every((k) => text(v[k])) &&
    ['PENDING', 'APPROVED', 'REVOKED'].includes(String(v.status)) &&
    positive(v.version) &&
    [v.consentedAt, v.revokedAt].every((t) => t === null || timestamp(t)) &&
    timestamp(v.createdAt) &&
    typeof v.sourceCurrentlyAvailable === 'boolean' &&
    object(v.capabilities) &&
    typeof v.capabilities.canConsent === 'boolean' &&
    typeof v.capabilities.canRevoke === 'boolean'
  );
}
export function parsePerformanceWorkspace(v: unknown): PlayerPerformanceWorkspaceData {
  if (
    !object(v) ||
    !text(v.viewerUserId) ||
    (v.ownProfileId !== null && !text(v.ownProfileId)) ||
    !Array.isArray(v.manageableEvents) ||
    !v.manageableEvents.every(
      (e) => object(e) && ['id', 'orgId', 'name', 'format'].every((k) => text(e[k])),
    ) ||
    !Array.isArray(v.links) ||
    v.links.length > 50 ||
    !v.links.every(link) ||
    new Set(v.links.map((l) => l.id)).size !== v.links.length ||
    typeof v.linksHasMore !== 'boolean' ||
    (v.nextCursor !== null &&
      (!text(v.nextCursor) || v.nextCursor.length < 1 || v.nextCursor.length > 2048)) ||
    v.linksHasMore !== (v.nextCursor !== null) ||
    (v.linksHasMore && v.links.length === 0) ||
    !text(v.disclosureNotice)
  )
    invalid();
  return v as unknown as PlayerPerformanceWorkspaceData;
}
export function parsePerformanceSources(v: unknown): PlayerPerformanceSourcesData {
  if (
    !object(v) ||
    !object(v.event) ||
    !['id', 'orgId', 'name', 'format'].every((k) => text((v.event as Obj)[k])) ||
    !Array.isArray(v.teams) ||
    !v.teams.every(
      (t) =>
        object(t) &&
        text(t.id) &&
        text(t.name) &&
        Array.isArray(t.members) &&
        t.members.every((m) => object(m) && ['id', 'name', 'jerseyNo'].every((k) => text(m[k]))),
    )
  )
    invalid();
  return v as unknown as PlayerPerformanceSourcesData;
}
export function createPlayerPerformanceApi(
  client: ApiClient,
  fetcher: typeof fetch = globalThis.fetch,
): PlayerPerformanceRepository {
  const root = '/v1/player-bookings/performance';
  async function publicRead(path: string) {
    let response: Response;
    try {
      response = await fetcher(path, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', '无法读取球员授权统计，请稍后重试。');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      invalid();
    }
    if (!response.ok)
      throw new ApiError(
        response.status,
        'PERFORMANCE_UNAVAILABLE',
        response.status === 404 ? '球员数据当前不可查看。' : '球员统计服务暂时不可用，请重新读取。',
      );
    if (!object(body) || !object(body.meta) || !text(body.meta.requestId)) invalid();
    return body.data;
  }

  return {
    async performance(id) {
      const data = parsePlayerPerformance(
        await publicRead(`/v1/player-bookings/players/${encodeURIComponent(id)}/performance`),
      );
      if (data.profileId !== id) invalid();
      return data;
    },
    async performances(ids) {
      const unique = Array.from(new Set(ids));
      if (unique.length < 1 || unique.length > 20)
        throw new ApiError(0, 'INVALID_PERFORMANCE_BATCH', '每次只能读取1至20名球员的数据。');
      const raw = await publicRead(
        `/v1/player-bookings/players/performance?${new URLSearchParams({ ids: unique.join(',') })}`,
      );
      if (
        !exact(raw, ['players', 'unavailableProfileIds']) ||
        !object(raw) ||
        !Array.isArray(raw.players) ||
        !Array.isArray(raw.unavailableProfileIds) ||
        !raw.unavailableProfileIds.every(text)
      )
        invalid();
      const players = raw.players.map(parsePlayerPerformance);
      const returned = [...players.map((p) => p.profileId), ...raw.unavailableProfileIds];
      if (
        returned.length !== unique.length ||
        new Set(returned).size !== returned.length ||
        returned.some((id) => !unique.includes(id))
      )
        invalid();
      return { players, unavailableProfileIds: raw.unavailableProfileIds as string[] };
    },
    async workspace(cursor) {
      const query = cursor === undefined ? '' : `?${new URLSearchParams({ cursor })}`;
      const value = parsePerformanceWorkspace(
        (await client.request<unknown>(`${root}/workspace${query}`)).data,
      );
      if (cursor !== undefined && value.nextCursor === cursor) invalid();
      return value;
    },
    async link(id) {
      const value = (await client.request<unknown>(`${root}/links/${encodeURIComponent(id)}`)).data;
      if (!link(value) || value.id !== id) invalid();
      return value;
    },
    async sources(orgId, eventId) {
      const query = new URLSearchParams({ orgId, eventId });
      const data = parsePerformanceSources(
        (await client.request<unknown>(`${root}/sources?${query}`)).data,
      );
      if (data.event.id !== eventId || data.event.orgId !== orgId) invalid();
      return data;
    },
    async nominate(input) {
      const value = (
        await client.request<unknown>(`${root}/links`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data;
      if (!link(value)) invalid();
      return value;
    },
    async command(id, input) {
      const value = (
        await client.request<unknown>(`${root}/links/${encodeURIComponent(id)}/commands`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data;
      if (!link(value) || value.id !== id) invalid();
      return value;
    },
  };
}

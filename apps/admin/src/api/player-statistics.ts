import { EVENT_FORMATS, EVENT_STATUSES } from '@small-city-basketball/contracts';
import type { EventPlayerStatisticsData } from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: unknown, required: readonly string[], optional: readonly string[] = []) =>
  object(v) &&
  required.every((key) => Object.hasOwn(v, key)) &&
  Object.keys(v).every((key) => required.includes(key) || optional.includes(key));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const time = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const strings = (v: Obj, keys: readonly string[]) => keys.every((key) => text(v[key]));
const counts = (v: Obj, keys: readonly string[]) => keys.every((key) => count(v[key]));

function event(v: unknown) {
  return (
    exact(
      v,
      [
        'id',
        'name',
        'startDate',
        'endDate',
        'timezone',
        'venueName',
        'format',
        'status',
        'version',
        'createdAt',
        'updatedAt',
      ],
      ['permissions'],
    ) &&
    object(v) &&
    strings(v, ['id', 'name', 'startDate', 'endDate', 'timezone']) &&
    (v.venueName === null || typeof v.venueName === 'string') &&
    (EVENT_FORMATS as readonly unknown[]).includes(v.format) &&
    (EVENT_STATUSES as readonly unknown[]).includes(v.status) &&
    count(v.version) &&
    v.version > 0 &&
    time(v.createdAt) &&
    time(v.updatedAt) &&
    (!Object.hasOwn(v, 'permissions') ||
      (exact(v.permissions, ['canEditDraft']) &&
        object(v.permissions) &&
        typeof v.permissions.canEditDraft === 'boolean'))
  );
}
const rowKeys = [
  'entryId',
  'rosterRevisionId',
  'memberId',
  'teamName',
  'name',
  'jerseyNo',
  'score',
  'fouls',
  'rosterSampleMatchCount',
  'rank',
  'tied',
];
const teamKeys = [
  'entryId',
  'teamName',
  'attributedScore',
  'unassignedScore',
  'attributedFouls',
  'unassignedFouls',
];
function valid(value: unknown): value is EventPlayerStatisticsData {
  if (!exact(value, ['event', 'summary']) || !object(value) || !event(value.event)) return false;
  const summary = value.summary;
  if (summary === null) return true;
  if (
    !exact(summary, [
      'algorithmVersion',
      'sourceHash',
      'asOf',
      'totalMatchCount',
      'includedMatchCount',
      'teamOnlyConfirmedMatchCount',
      'pendingMatchCount',
      'coverageComplete',
      'attributionComplete',
      'rows',
      'teams',
    ]) ||
    !object(summary) ||
    summary.algorithmVersion !== 'EVENT_PLAYER_BASIC_V1' ||
    typeof summary.sourceHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(summary.sourceHash) ||
    !time(summary.asOf) ||
    !counts(summary, [
      'totalMatchCount',
      'includedMatchCount',
      'teamOnlyConfirmedMatchCount',
      'pendingMatchCount',
    ]) ||
    typeof summary.coverageComplete !== 'boolean' ||
    typeof summary.attributionComplete !== 'boolean' ||
    !Array.isArray(summary.rows) ||
    !Array.isArray(summary.teams)
  )
    return false;
  const total = Number(summary.totalMatchCount),
    included = Number(summary.includedMatchCount);
  if (
    included + Number(summary.teamOnlyConfirmedMatchCount) + Number(summary.pendingMatchCount) !==
      total ||
    summary.coverageComplete !== (total > 0 && included === total)
  )
    return false;
  const identities = new Set<string>(),
    entries = new Set<string>();
  for (const row of summary.rows) {
    if (
      !exact(row, rowKeys) ||
      !object(row) ||
      !strings(row, ['entryId', 'rosterRevisionId', 'memberId', 'teamName', 'name', 'jerseyNo']) ||
      !counts(row, ['score', 'fouls', 'rosterSampleMatchCount', 'rank']) ||
      row.rank === 0 ||
      row.rosterSampleMatchCount === 0 ||
      Number(row.rosterSampleMatchCount) > included ||
      typeof row.tied !== 'boolean'
    )
      return false;
    const identity = JSON.stringify([row.entryId, row.rosterRevisionId, row.memberId]);
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  for (const team of summary.teams) {
    if (
      !exact(team, teamKeys) ||
      !object(team) ||
      !strings(team, ['entryId', 'teamName']) ||
      !counts(team, ['attributedScore', 'unassignedScore', 'attributedFouls', 'unassignedFouls']) ||
      entries.has(String(team.entryId))
    )
      return false;
    entries.add(String(team.entryId));
  }
  return (
    summary.rows.every((row) => object(row) && entries.has(String(row.entryId))) &&
    summary.attributionComplete ===
      (included > 0 &&
        summary.teams.every(
          (team) => object(team) && team.unassignedScore === 0 && team.unassignedFouls === 0,
        ))
  );
}

export function createPlayerStatisticsApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有赛事权限的机构');
  return {
    async event(eventId: string): Promise<EventPlayerStatisticsData> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const value = (
          await client.request<unknown>(
            `/v1/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/player-statistics`,
            { signal: controller.signal },
          )
        ).data;
        if (!valid(value) || value.event.id !== eventId)
          throw new ApiError(200, 'INVALID_RESPONSE', '球员数据格式不完整，请重新读取');
        return value;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

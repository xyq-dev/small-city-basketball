import type {
  CourtData,
  CreateCourtInput,
  UpdateCourtInput,
  EventSchedulingData,
  ScheduleRevisionData,
  CreateScheduleRevisionInput,
  UpdateScheduleAllocationsInput,
  ScheduleVersionInput,
  ScheduleValidationData,
  ScheduledMatchData,
  ScheduleConflict,
} from '@small-city-basketball/contracts';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown, keys: string[]) =>
  object(value) && keys.every((key) => typeof value[key] === 'string');
const bools = (value: unknown, keys: string[]) =>
  object(value) && keys.every((key) => typeof value[key] === 'boolean');
function court(value: unknown) {
  return (
    strings(value, ['id', 'orgId', 'name', 'createdAt', 'updatedAt']) &&
    object(value) &&
    Number.isInteger(value.version) &&
    (value.status === 'ACTIVE' || value.status === 'DISABLED') &&
    bools(value.capabilities, ['canManage'])
  );
}
function summary(value: unknown) {
  return (
    strings(value, [
      'id',
      'eventId',
      'freezeId',
      'seed',
      'inputHash',
      'pairingHash',
      'createdAt',
    ]) &&
    object(value) &&
    Number.isInteger(value.version) &&
    value.algorithmVersion === 'RR_CIRCLE_V1' &&
    ['DRAFT', 'SUPERSEDED', 'PUBLISHED'].includes(String(value.status)) &&
    (value.previousRevisionId === null || typeof value.previousRevisionId === 'string')
  );
}
function scheduling(value: unknown) {
  return (
    object(value) &&
    strings(value.event, ['id', 'name', 'status', 'startDate', 'endDate', 'timezone']) &&
    object(value.event) &&
    Number.isInteger(value.event.version) &&
    (value.freeze === null ||
      (object(value.freeze) &&
        strings(value.freeze, ['id']) &&
        Number.isInteger(value.freeze.entryCount))) &&
    (value.currentRevision === null || summary(value.currentRevision)) &&
    (value.publication === null ||
      strings(value.publication, ['id', 'eventId', 'revisionId', 'publishedAt'])) &&
    bools(value.support, ['supported']) &&
    bools(value.capabilities, ['canGenerate', 'canRedraw', 'canReadMatches'])
  );
}
function revision(value: unknown) {
  return (
    summary(value) &&
    object(value) &&
    Number.isInteger(value.eventVersion) &&
    typeof value.isCurrent === 'boolean' &&
    object(value.policy) &&
    ['slotDurationMinutes', 'minRestMinutes', 'minLocalDayGap'].every((key) =>
      Number.isInteger((value.policy as JsonObject)[key]),
    ) &&
    Array.isArray(value.policy.courtWindows) &&
    value.policy.courtWindows.every((item) => strings(item, ['courtId', 'startsAt', 'endsAt'])) &&
    object(value.source) &&
    Array.isArray(value.source.entries) &&
    Array.isArray(value.participants) &&
    value.participants.every((item) =>
      strings(item, ['entryId', 'teamId', 'teamName', 'rosterRevisionId']),
    ) &&
    Array.isArray(value.rounds) &&
    value.rounds.every(
      (item) =>
        object(item) &&
        Number.isInteger(item.roundNo) &&
        (item.byeEntryId === null || typeof item.byeEntryId === 'string'),
    ) &&
    Array.isArray(value.fixtures) &&
    value.fixtures.every(
      (item) =>
        object(item) &&
        strings(item, ['fixtureKey', 'homeEntryId', 'awayEntryId']) &&
        Number.isInteger(item.roundNo) &&
        Number.isInteger(item.positionNo) &&
        ['courtId', 'startsAt', 'endsAt'].every(
          (key) => item[key] === null || typeof item[key] === 'string',
        ),
    ) &&
    bools(value.capabilities, ['canEditAllocations', 'canValidate', 'canPublish'])
  );
}
const conflictCodes = new Set([
  'UNASSIGNED',
  'OUTSIDE_WINDOW',
  'OUTSIDE_EVENT_DATES',
  'COURT_DISABLED',
  'COURT_OVERLAP',
  'TEAM_OVERLAP',
  'MIN_REST',
  'MIN_LOCAL_DAY_GAP',
]);
export function scheduleConflicts(value: unknown): ScheduleConflict[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        object(item) &&
        typeof item.code === 'string' &&
        conflictCodes.has(item.code) &&
        Array.isArray(item.fixtureKeys) &&
        item.fixtureKeys.every((key) => typeof key === 'string') &&
        (item.external === undefined || typeof item.external === 'boolean'),
    )
  )
    return undefined;
  return value as ScheduleConflict[];
}
function validation(value: unknown) {
  return (
    object(value) &&
    strings(value, ['revisionId', 'checkedAt']) &&
    Number.isInteger(value.expectedEventVersion) &&
    Number.isInteger(value.expectedRevisionVersion) &&
    typeof value.valid === 'boolean' &&
    scheduleConflicts(value.conflicts) !== undefined
  );
}
function match(value: unknown) {
  return (
    strings(value, [
      'id',
      'eventId',
      'publicationId',
      'fixtureKey',
      'courtId',
      'courtName',
      'startsAt',
      'endsAt',
    ]) &&
    object(value) &&
    Number.isInteger(value.roundNo) &&
    Number.isInteger(value.positionNo) &&
    strings(value.home, ['entryId', 'teamId', 'teamName', 'rosterRevisionId']) &&
    strings(value.away, ['entryId', 'teamId', 'teamName', 'rosterRevisionId']) &&
    Number.isInteger(value.version) &&
    MATCH_STATUSES.includes(value.status as (typeof MATCH_STATUSES)[number])
  );
}
function checked<T>(value: unknown, guard: (value: unknown) => boolean): T {
  if (!guard(value))
    throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的排赛资料或操作权限不完整，请重新读取');
  return value as T;
}
export function createSchedulingApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有排赛权限的机构');
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}`;
  async function read<T>(path: string, guard: (value: unknown) => boolean) {
    return checked<T>((await client.request<unknown>(base + path)).data, guard);
  }
  async function write<T>(
    path: string,
    method: string,
    input: unknown,
    guard: (value: unknown) => boolean,
  ) {
    return checked<T>(
      (await client.request<unknown>(base + path, { method, body: JSON.stringify(input) })).data,
      guard,
    );
  }
  async function pages<T>(path: string, guard: (value: unknown) => boolean, requireCreate = false) {
    const data: T[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let canCreateCourt = false;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const page = await client.request<unknown>(`${base}${path}?${query}`);
      if (!Array.isArray(page.data))
        throw new ApiError(200, 'INVALID_RESPONSE', '列表资料格式不正确');
      data.push(...page.data.map((item) => checked<T>(item, guard)));
      if (!cursor) {
        if (requireCreate && typeof page.meta.capabilities?.canCreateCourt !== 'boolean')
          throw new ApiError(200, 'INVALID_RESPONSE', '服务未返回场地创建权限');
        canCreateCourt = page.meta.capabilities?.canCreateCourt === true;
      }
      const next: unknown = page.meta.nextCursor;
      if (next !== null && next !== undefined && (typeof next !== 'string' || !next))
        throw new ApiError(200, 'INVALID_CURSOR', '列表分页信息不正确');
      cursor = typeof next === 'string' ? next : null;
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 1000)
          throw new ApiError(200, 'INVALID_CURSOR', '列表分页无法继续，请重试');
        seen.add(cursor);
      }
    } while (cursor);
    return { data, canCreateCourt };
  }
  return {
    courts: () => pages<CourtData>('/courts', court, true),
    createCourt: (input: CreateCourtInput) => write<CourtData>('/courts', 'POST', input, court),
    updateCourt: (id: string, input: UpdateCourtInput) =>
      write<CourtData>(`/courts/${encodeURIComponent(id)}`, 'PATCH', input, court),
    scheduling: (eventId: string) =>
      read<EventSchedulingData>(`/events/${encodeURIComponent(eventId)}/scheduling`, scheduling),
    revision: (id: string) =>
      read<ScheduleRevisionData>(`/schedule-revisions/${encodeURIComponent(id)}`, revision),
    createRevision: (eventId: string, input: CreateScheduleRevisionInput) =>
      write<ScheduleRevisionData>(
        `/events/${encodeURIComponent(eventId)}/schedule-revisions`,
        'POST',
        input,
        revision,
      ),
    allocations: (id: string, input: UpdateScheduleAllocationsInput) =>
      write<ScheduleRevisionData>(
        `/schedule-revisions/${encodeURIComponent(id)}/allocations`,
        'PUT',
        input,
        revision,
      ),
    validate: (id: string, input: ScheduleVersionInput) =>
      write<ScheduleValidationData>(
        `/schedule-revisions/${encodeURIComponent(id)}/validate`,
        'POST',
        input,
        validation,
      ),
    publish: (id: string, input: ScheduleVersionInput) =>
      write<EventSchedulingData>(
        `/schedule-revisions/${encodeURIComponent(id)}/publish`,
        'POST',
        input,
        scheduling,
      ),
    matches: async (eventId: string) =>
      (await pages<ScheduledMatchData>(`/events/${encodeURIComponent(eventId)}/matches`, match))
        .data,
  };
}
export type SchedulingApi = ReturnType<typeof createSchedulingApi>;

import { EVENT_FORMATS, EVENT_STATUSES } from '@small-city-basketball/contracts';
import type {
  EventLifecycleCommandInput,
  EventLifecycleData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: Obj, keys: string[]) => keys.every((key) => typeof value[key] === 'string');
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
function checked(value: unknown, eventId: string): EventLifecycleData {
  if (
    !object(value) ||
    !object(value.event) ||
    !object(value.completion) ||
    !object(value.capabilities)
  )
    throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的完赛资料不完整，请重新读取');
  const { event, completion, capabilities } = value;
  if (
    event.id !== eventId ||
    !strings(event, ['id', 'name', 'startDate', 'endDate', 'timezone']) ||
    !(event.venueName === null || typeof event.venueName === 'string') ||
    !(EVENT_FORMATS as readonly unknown[]).includes(event.format) ||
    !(EVENT_STATUSES as readonly unknown[]).includes(event.status) ||
    !Number.isSafeInteger(event.version) ||
    Number(event.version) < 1 ||
    !timestamp(event.createdAt) ||
    !timestamp(event.updatedAt) ||
    !count(completion.totalMatchCount) ||
    !count(completion.confirmedMatchCount) ||
    Number(completion.confirmedMatchCount) > Number(completion.totalMatchCount) ||
    typeof completion.ready !== 'boolean' ||
    !Array.isArray(completion.blockers) ||
    !completion.blockers.every((v) => typeof v === 'string') ||
    !(completion.sourceHash === null || typeof completion.sourceHash === 'string') ||
    !['canComplete', 'canArchive', 'canReopen'].every(
      (key) => typeof capabilities[key] === 'boolean',
    )
  )
    throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的完赛资料不完整，请重新读取');
  return structuredClone(value) as unknown as EventLifecycleData;
}
export function createLifecycleApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有赛事权限的机构');
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}/events`;
  async function request(eventId: string, command?: EventLifecycleCommandInput) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const path = `${base}/${encodeURIComponent(eventId)}/${command ? 'lifecycle-commands' : 'lifecycle'}`;
      const result = await client.request<unknown>(path, {
        signal: controller.signal,
        ...(command ? { method: 'POST', body: JSON.stringify(command) } : {}),
      });
      return checked(result.data, eventId);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    event: (eventId: string) => request(eventId),
    command: (eventId: string, command: EventLifecycleCommandInput) => request(eventId, command),
  };
}

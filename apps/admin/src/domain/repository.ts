import { validateEventInput } from './validation';
import type {
  CreateEventInput,
  EventFieldErrors,
  EventFilters,
  EventRecord,
  EventRepository,
} from './types';

export type AppErrorCode =
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'INVALID_EVENT_STATE';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fieldErrors?: EventFieldErrors;

  constructor(code: AppErrorCode, message: string, fieldErrors?: EventFieldErrors) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (fieldErrors) this.fieldErrors = { ...fieldErrors };
  }
}

export interface MemoryEventRepositoryOptions {
  seed?: EventRecord[];
  latencyMs?: number;
}

function demoEvents(): EventRecord[] {
  const common = {
    timezone: 'Asia/Shanghai',
    version: 1,
    createdAt: '2026-10-20T02:00:00.000Z',
    updatedAt: '2026-10-22T02:00:00.000Z',
  };
  return [
    {
      ...common,
      id: 'event-autumn-2026',
      name: '2026 秋季城市联赛',
      startDate: '2026-10-20',
      endDate: '2026-11-08',
      venueName: '石鼓公园球场',
      format: 'GROUP_KNOCKOUT',
      status: 'RUNNING',
    },
    {
      ...common,
      id: 'event-enterprise-2026',
      name: '企业篮球挑战赛',
      startDate: '2026-11-10',
      endDate: '2026-11-22',
      venueName: '高州体育中心',
      format: 'ROUND_ROBIN',
      status: 'REGISTRATION_OPEN',
    },
    {
      ...common,
      id: 'event-qingfeng-draft',
      name: '青锋杯篮球邀请赛',
      startDate: '2026-12-01',
      endDate: '2026-12-12',
      venueName: null,
      format: 'GROUP_KNOCKOUT',
      status: 'DRAFT',
    },
  ];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalize(
  input: CreateEventInput,
): Omit<EventRecord, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'> {
  const errors = validateEventInput(input);
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION_ERROR', '请检查赛事资料中的错误', errors);
  }
  return {
    name: input.name.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    timezone: input.timezone,
    venueName: input.venueName?.trim() || null,
    format: input.format,
  };
}

/** An in-memory demo adapter. It deliberately never writes to browser storage. */
export function createMemoryEventRepository(
  options: MemoryEventRepositoryOptions = {},
): EventRepository {
  const records = new Map<string, EventRecord>();
  for (const event of options.seed ?? demoEvents()) {
    if (records.has(event.id)) {
      throw new AppError('VALIDATION_ERROR', '演示数据包含重复的赛事ID');
    }
    records.set(event.id, clone(event));
  }
  const latencyMs = Math.max(0, options.latencyMs ?? 180);
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, latencyMs));

  function find(id: string): EventRecord {
    const event = records.get(id);
    if (!event) throw new AppError('NOT_FOUND', '未找到该赛事，可能已重置演示数据');
    return event;
  }

  return {
    async list(filters: EventFilters = {}) {
      const query = filters.query?.trim().toLocaleLowerCase() ?? '';
      const status = filters.status;
      await wait();
      return clone(
        [...records.values()]
          .filter((event) => !query || event.name.toLocaleLowerCase().includes(query))
          .filter((event) => !status || status === 'ALL' || event.status === status)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      );
    },

    async get(id) {
      await wait();
      return clone(find(id));
    },

    async create(input) {
      const normalized = normalize(input);
      await wait();
      let id: string;
      do {
        id = `event-${globalThis.crypto.randomUUID()}`;
      } while (records.has(id));
      const now = new Date().toISOString();
      const event: EventRecord = {
        ...normalized,
        id,
        status: 'DRAFT',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      records.set(id, event);
      return clone(event);
    },

    async updateDraft(id, input, expectedVersion) {
      const normalized = normalize(input);
      await wait();
      // This check and write run without an await between them, preserving CAS semantics.
      const current = find(id);
      if (current.status !== 'DRAFT') {
        throw new AppError('INVALID_EVENT_STATE', '只有草稿赛事可以在当前演示中编辑');
      }
      if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
        throw new AppError('VERSION_CONFLICT', '赛事已被更新，请重新读取资料后再保存');
      }
      const updated: EventRecord = {
        ...current,
        ...normalized,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      records.set(id, updated);
      return clone(updated);
    },
  };
}

export const eventRepository = createMemoryEventRepository();

export const EVENT_FORMATS = ['ROUND_ROBIN', 'GROUP_KNOCKOUT', 'SINGLE_ELIMINATION'] as const;

export type EventFormat = (typeof EVENT_FORMATS)[number];

export const EVENT_STATUSES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_FORMAT_LABELS: Record<EventFormat, string> = {
  ROUND_ROBIN: '循环赛',
  GROUP_KNOCKOUT: '分组后淘汰',
  SINGLE_ELIMINATION: '单淘汰',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: '草稿',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名已结束',
  SCHEDULED: '赛程已发布',
  RUNNING: '进行中',
  COMPLETED: '已结束',
  ARCHIVED: '已归档',
  CANCELLED: '已取消',
};

export interface CreateEventInput {
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName?: string;
  format: EventFormat;
}

export interface EventRecord {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName: string | null;
  format: EventFormat;
  status: EventStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventFilters {
  query?: string;
  status?: EventStatus | 'ALL';
}

export type EventFieldErrors = Partial<Record<keyof CreateEventInput, string>>;

export interface EventRepository {
  list(filters?: EventFilters): Promise<EventRecord[]>;
  get(id: string): Promise<EventRecord>;
  create(input: CreateEventInput): Promise<EventRecord>;
  updateDraft(id: string, input: CreateEventInput, expectedVersion: number): Promise<EventRecord>;
}

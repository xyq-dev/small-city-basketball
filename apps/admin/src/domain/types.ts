import { EVENT_FORMATS, EVENT_STATUSES } from '@small-city-basketball/contracts';
import type {
  CreateEventInput,
  EventData,
  EventFormat,
  EventStatus,
} from '@small-city-basketball/contracts';
export { EVENT_FORMATS, EVENT_STATUSES };
export type { CreateEventInput, EventFormat, EventStatus };
export type EventRecord = EventData;

export const EVENT_FORMAT_LABELS: Record<EventFormat, string> = {
  DOUBLE_ROUND_ROBIN: '双循环',
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

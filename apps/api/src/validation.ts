import {
  EVENT_FORMATS,
  EVENT_STATUSES,
  ORG_ROLES,
  STAFF_ROLES,
} from '@small-city-basketball/contracts';
import type {
  CreateEventInput,
  EventFormat,
  EventStatus,
  OrgRole,
  StaffRole,
} from '@small-city-basketball/contracts';
import { ApiError, notFound } from './errors.js';

export function invalid(message: string, fields?: Record<string, string>): never {
  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    message,
    fields ? { fieldErrors: fields } : undefined,
  );
}

export function objectInput(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请求必须是JSON对象');
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key))) invalid('请求包含不允许的字段');
  return object;
}

export function text(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') invalid('请检查填写的资料', { [field]: '请输入有效文字' });
  if (value.includes('\u0000')) invalid('请检查填写的资料', { [field]: '文字不能包含空字符' });
  const trimmed = value.trim();
  const size = Array.from(trimmed).length;
  if (size < minimum || size > maximum)
    invalid('请检查填写的资料', { [field]: `请输入${minimum}–${maximum}个字符` });
  return trimmed;
}

export function passwordInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Array.from(value).length < 12 ||
    Array.from(value).length > 128
  ) {
    invalid('请检查填写的资料', { password: '密码需为12–128个字符' });
  }
  return value;
}

export function emailInput(value: unknown): string {
  const email = text(value, 'email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    invalid('请检查填写的资料', { email: '请输入有效邮箱' });
  return email;
}

export function calendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid('请检查赛事日期', { [field]: '请输入有效日期' });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!)
    invalid('请检查赛事日期', { [field]: '请输入有效日期' });
  return value;
}

export type NormalizedEvent = Omit<CreateEventInput, 'venueName'> & { venueName: string | null };
export function eventInput(
  value: unknown,
  patch = false,
): { input: NormalizedEvent; expectedVersion?: number } {
  const object = objectInput(value, [
    'name',
    'startDate',
    'endDate',
    'timezone',
    'venueName',
    'format',
    ...(patch ? ['expectedVersion'] : []),
  ]);
  const name = text(object.name, 'name', 1, 80);
  const startDate = calendarDate(object.startDate, 'startDate');
  const endDate = calendarDate(object.endDate, 'endDate');
  if (endDate < startDate) invalid('请检查赛事日期', { endDate: '结束日期不能早于开始日期' });
  if (object.timezone !== 'Asia/Shanghai')
    invalid('请检查赛事时区', { timezone: '当前仅支持Asia/Shanghai' });
  if (!EVENT_FORMATS.includes(object.format as EventFormat))
    invalid('请检查赛事赛制', { format: '请选择支持的赛制' });
  let venueName: string | null = null;
  if (object.venueName !== undefined) {
    if (typeof object.venueName !== 'string')
      invalid('请检查比赛地点', { venueName: '请输入有效文字' });
    venueName = text(object.venueName, 'venueName', 0, 100) || null;
  }
  const expectedVersion = patch ? object.expectedVersion : undefined;
  if (
    patch &&
    (!Number.isInteger(expectedVersion) ||
      Number(expectedVersion) < 1 ||
      Number(expectedVersion) > 2147483647)
  ) {
    invalid('请提供有效的赛事版本', { expectedVersion: '版本需为正整数' });
  }
  return {
    input: {
      name,
      startDate,
      endDate,
      timezone: 'Asia/Shanghai',
      venueName,
      format: object.format as EventFormat,
    },
    ...(patch ? { expectedVersion: expectedVersion as number } : {}),
  };
}

export function resourceId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw notFound();
  return value.toLowerCase();
}

export interface EventQuery {
  q: string;
  status: EventStatus | null;
  limit: number;
  cursor?: string;
}
export function eventQuery(value: unknown): EventQuery {
  const object = objectInput(value, ['q', 'status', 'limit', 'cursor']);
  const q = object.q === undefined ? '' : text(object.q, 'q', 0, 80);
  const status = object.status === undefined || object.status === '' ? null : object.status;
  if (status !== null && !EVENT_STATUSES.includes(status as EventStatus)) invalid('无效的状态筛选');
  let limit = 20;
  if (object.limit !== undefined) {
    if (
      typeof object.limit !== 'string' ||
      !/^[1-9]\d{0,2}$/.test(object.limit) ||
      Number(object.limit) > 100
    )
      invalid('分页数量需为1–100');
    limit = Number(object.limit);
  }
  let cursor: string | undefined;
  if (object.cursor !== undefined) {
    if (
      typeof object.cursor !== 'string' ||
      object.cursor.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(object.cursor)
    )
      invalid('无效的分页游标');
    cursor = object.cursor;
  }
  return { q, status: status as EventStatus | null, limit, ...(cursor ? { cursor } : {}) };
}

export function membershipInput(
  value: unknown,
  staff = false,
): { role: OrgRole | StaffRole; status: 'ACTIVE' | 'DISABLED' } {
  const object = objectInput(value, ['role', 'status']);
  const roles = staff ? STAFF_ROLES : ORG_ROLES.filter((role) => role !== 'ORG_OWNER');
  if (
    !(roles as readonly unknown[]).includes(object.role) ||
    !['ACTIVE', 'DISABLED'].includes(object.status as string)
  )
    invalid('无效的角色或成员状态');
  return {
    role: object.role as OrgRole | StaffRole,
    status: object.status as 'ACTIVE' | 'DISABLED',
  };
}

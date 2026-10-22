import { EVENT_FORMATS } from './types';
import type { CreateEventInput, EventFieldErrors } from './types';

/** Validate calendar dates without Date's silent normalization of invalid days. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1]!;
}

export function validateEventInput(input: CreateEventInput): EventFieldErrors {
  const errors: EventFieldErrors = {};
  const value = input as CreateEventInput | null | undefined;
  const name = typeof value?.name === 'string' ? value.name.trim() : '';

  if (!name) errors.name = '请输入赛事名称';
  else if (Array.from(name).length > 80) errors.name = '赛事名称最多80个字符';

  const validStart = isCalendarDate(value?.startDate);
  const validEnd = isCalendarDate(value?.endDate);
  if (!validStart) errors.startDate = '请选择有效的开始日期';
  if (!validEnd) errors.endDate = '请选择有效的结束日期';
  if (validStart && validEnd && value!.endDate < value!.startDate) {
    errors.endDate = '结束日期不能早于开始日期';
  }

  if (value?.timezone !== 'Asia/Shanghai') {
    errors.timezone = '当前演示仅支持 Asia/Shanghai 时区';
  }

  if (value?.venueName !== undefined) {
    if (typeof value.venueName !== 'string') errors.venueName = '请输入有效的比赛地点';
    else if (Array.from(value.venueName.trim()).length > 100) {
      errors.venueName = '比赛地点最多100个字符';
    }
  }

  if (!EVENT_FORMATS.includes(value?.format as (typeof EVENT_FORMATS)[number])) {
    errors.format = '请选择支持的赛制';
  }

  return errors;
}

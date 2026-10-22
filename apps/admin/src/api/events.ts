import { EVENT_FORMATS, EVENT_STATUSES } from '@small-city-basketball/contracts';
import type { EventRecord, EventRepository } from '../domain/types';
import { ApiError } from './client';
import type { ApiClient } from './client';

function record(value: unknown): EventRecord {
  if (typeof value !== 'object' || value === null)
    throw new ApiError(200, 'INVALID_EVENT_RESPONSE', '赛事资料格式不正确');
  const event = value as EventRecord;
  if (
    typeof event.id !== 'string' ||
    typeof event.name !== 'string' ||
    typeof event.startDate !== 'string' ||
    typeof event.endDate !== 'string' ||
    typeof event.timezone !== 'string' ||
    !(event.venueName === null || typeof event.venueName === 'string') ||
    !EVENT_FORMATS.includes(event.format) ||
    !EVENT_STATUSES.includes(event.status) ||
    !Number.isInteger(event.version) ||
    event.version < 1 ||
    typeof event.createdAt !== 'string' ||
    typeof event.updatedAt !== 'string' ||
    typeof event.permissions?.canEditDraft !== 'boolean'
  )
    throw new ApiError(200, 'INVALID_EVENT_RESPONSE', '赛事资料或权限信息不完整');
  return structuredClone(event);
}

export function createHttpEventRepository(
  client: ApiClient,
  organizationId: string,
): EventRepository {
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}/events`;
  return {
    async list(filters = {}) {
      const results: EventRecord[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (filters.query?.trim()) query.set('q', filters.query.trim());
        if (filters.status && filters.status !== 'ALL') query.set('status', filters.status);
        if (cursor) query.set('cursor', cursor);
        const page = await client.request<unknown>(`${base}?${query.toString()}`);
        if (!Array.isArray(page.data))
          throw new ApiError(200, 'INVALID_EVENT_RESPONSE', '赛事列表格式不正确');
        results.push(...page.data.map(record));
        const next: unknown = page.meta.nextCursor;
        if (next !== null && next !== undefined && (typeof next !== 'string' || !next))
          throw new ApiError(200, 'INVALID_CURSOR', '赛事分页信息不正确');
        cursor = typeof next === 'string' ? next : null;
        if (cursor) {
          if (seen.has(cursor) || seen.size >= 1000)
            throw new ApiError(200, 'INVALID_CURSOR', '赛事分页无法继续，请重试');
          seen.add(cursor);
        }
      } while (cursor);
      return results;
    },
    async get(id) {
      return record((await client.request<unknown>(`${base}/${encodeURIComponent(id)}`)).data);
    },
    async create(input) {
      return record(
        (await client.request<unknown>(base, { method: 'POST', body: JSON.stringify(input) })).data,
      );
    },
    async updateDraft(id, input, expectedVersion) {
      return record(
        (
          await client.request<unknown>(`${base}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...input, expectedVersion }),
          })
        ).data,
      );
    },
  };
}

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../domain/repository';
import { ApiError, createApiClient, createAuthApi } from './client';
import { createHttpEventRepository } from './events';
import type { EventRecord } from '../domain/types';

const event: EventRecord = {
  id: 'event-a',
  name: '真实机构赛事',
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  timezone: 'Asia/Shanghai',
  venueName: null,
  format: 'ROUND_ROBIN',
  status: 'DRAFT',
  version: 1,
  createdAt: '2026-10-22T01:00:00Z',
  updatedAt: '2026-10-22T01:00:00Z',
  permissions: { canEditDraft: true },
};
const response = (data: unknown, nextCursor: string | null = null) =>
  new Response(JSON.stringify({ data, meta: { requestId: 'test-request', nextCursor } }), {
    status: 200,
  });
const input = {
  name: event.name,
  startDate: event.startDate,
  endDate: event.endDate,
  timezone: event.timezone,
  format: event.format,
};

describe('同源 HTTP 与错误边界', () => {
  it('只发送HttpOnly Cookie所需的same-origin请求，JSON写入不附token或手写Origin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(event));
    const client = createApiClient({ fetcher });
    await client.request('/v1/orgs/org-a/events', { method: 'POST', body: JSON.stringify(input) });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/v1/orgs/org-a/events');
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'POST' });
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('Origin')).toBe(false);
  });

  it('拒绝外部地址且网络失败不会回退成Mock数据', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const client = createApiClient({ fetcher });
    await expect(client.request('https://example.com/v1/events')).rejects.toMatchObject({
      apiCode: 'INVALID_API_PATH',
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.request('/v1/auth/session')).rejects.toMatchObject({
      apiCode: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('401通知会话失效，校验错误映射AppError并只取允许的字段错误', async () => {
    const onUnauthorized = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '请重新登录' } }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: '字段无效',
              details: { fieldErrors: { name: '名称过长', token: '不应被映射' } },
            },
          }),
          { status: 422 },
        ),
      );
    const client = createApiClient({ fetcher, onUnauthorized });
    await expect(client.request('/v1/auth/session')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    let caught: unknown;
    try {
      await client.request('/v1/orgs/org-a/events');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { name: '名称过长' } });
    expect((caught as AppError).fieldErrors).not.toHaveProperty('token');
  });

  it('成功状态但无合法响应包时拒绝，409保留冲突语义', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: '版本已变化' } }),
          { status: 409 },
        ),
      );
    const client = createApiClient({ fetcher });
    await expect(client.request('/v1/auth/session')).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
    await expect(client.request('/v1/orgs/a/events/e')).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });
  });
});

describe('赛事API适配器', () => {
  it('完整取完游标分页并把过滤条件传入每一页', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([event], 'cursor/+ next'))
      .mockResolvedValueOnce(response([{ ...event, id: 'event-b' }]));
    const repository = createHttpEventRepository(createApiClient({ fetcher }), 'org-a');
    expect(await repository.list({ query: '  城市  ', status: 'DRAFT' })).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [raw] of fetcher.mock.calls) {
      const url = new URL(String(raw), 'http://localhost');
      expect(url.pathname).toBe('/v1/orgs/org-a/events');
      expect(url.searchParams.get('q')).toBe('城市');
      expect(url.searchParams.get('status')).toBe('DRAFT');
      expect(url.searchParams.get('limit')).toBe('100');
    }
    expect(
      new URL(String(fetcher.mock.calls[1]![0]), 'http://localhost').searchParams.get('cursor'),
    ).toBe('cursor/+ next');
  });

  it('第二页失败不返回第一页，重复游标也不会无限请求', async () => {
    const failing = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([event], 'next'))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(
      createHttpEventRepository(createApiClient({ fetcher: failing }), 'org-a').list(),
    ).rejects.toBeInstanceOf(ApiError);
    const looping = vi.fn<typeof fetch>().mockImplementation(async () => response([event], 'same'));
    await expect(
      createHttpEventRepository(createApiClient({ fetcher: looping }), 'org-a').list(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_CURSOR' });
    expect(looping).toHaveBeenCalledTimes(2);
  });

  it('机构适配器互不共享列表，PATCH包含指定版本且不把机构ID混入请求体', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(event));
    const client = createApiClient({ fetcher });
    const a = createHttpEventRepository(client, 'org-a');
    const b = createHttpEventRepository(client, 'org-b');
    await a.create(input);
    await b.updateDraft('event/a', input, 7);
    expect(fetcher.mock.calls[0]![0]).toBe('/v1/orgs/org-a/events');
    expect(fetcher.mock.calls[1]![0]).toBe('/v1/orgs/org-b/events/event%2Fa');
    expect(fetcher.mock.calls[1]![1]?.method).toBe('PATCH');
    const body = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(body).toEqual({ ...input, expectedVersion: 7 });
    expect(body).not.toHaveProperty('orgId');
  });

  it('缺少服务器资源权限时不会凭机构角色推测可编辑', async () => {
    const { permissions: _permissions, ...missingPermission } = event;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(missingPermission));
    await expect(
      createHttpEventRepository(createApiClient({ fetcher }), 'org-a').get('event-a'),
    ).rejects.toMatchObject({ apiCode: 'INVALID_EVENT_RESPONSE' });
  });
});

describe('个人账号与球队上下文', () => {
  const participant = {
    user: { id: 'leader-a', email: 'leader@example.test', displayName: '球队领队' },
    organizations: [],
    teamContexts: [
      { orgId: 'org-a', organizationName: '赛事机构', teamId: 'team-a', teamName: '城市队' },
    ],
  };
  it('外部注册只发送个人字段并保留独立球队上下文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(participant));
    const auth = createAuthApi(createApiClient({ fetcher }));
    const result = await auth.registerParticipant({
      email: participant.user.email,
      password: 'strong-test-password',
      displayName: participant.user.displayName,
    });
    expect(result.organizations).toEqual([]);
    expect(result.teamContexts).toEqual(participant.teamContexts);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/v1/auth/register-participant');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      email: participant.user.email,
      password: 'strong-test-password',
      displayName: participant.user.displayName,
    });
  });
  it('畸形球队上下文使会话明确失败，旧P02响应缺字段保持兼容', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...participant, teamContexts: [{ teamId: 'team-a' }] }))
      .mockResolvedValueOnce(response({ user: participant.user, organizations: [] }));
    const auth = createAuthApi(createApiClient({ fetcher }));
    await expect(auth.session()).rejects.toMatchObject({ apiCode: 'INVALID_SESSION' });
    expect(await auth.session()).toMatchObject({ organizations: [] });
  });
});

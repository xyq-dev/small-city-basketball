import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createSchedulingApi } from './scheduling';
import { court, overview, revision, response, officialMatches } from '../scheduling/test-fixtures';
import { localInput, offsetTime } from '../scheduling/shared';

describe('排赛时间与HTTP边界', () => {
  it('本地输入明确采用UTC+8，不依赖浏览器所在地，并严格拒绝无效日历', () => {
    expect(offsetTime('2026-12-01T09:00')).toBe('2026-12-01T09:00:00.000+08:00');
    expect(new Date(offsetTime('2026-12-01T09:00')).toISOString()).toBe('2026-12-01T01:00:00.000Z');
    expect(localInput('2026-12-01T01:00:00.123Z')).toBe('2026-12-01T09:00:00.123');
    expect(() => offsetTime('2026-02-31T09:00')).toThrow('真实有效');
    expect(() => offsetTime('2026-12-01T24:00')).toThrow('真实有效');
  });
  it('场地完整分页并保留服务端创建能力，后页失败不返回半截', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([court], { nextCursor: 'next/+', capabilities: { canCreateCourt: false } }),
      )
      .mockResolvedValueOnce(response([{ ...court, id: 'court-b' }]));
    const result = await createSchedulingApi(createApiClient({ fetcher }), 'org/a').courts();
    expect(result.data).toHaveLength(2);
    expect(result.canCreateCourt).toBe(false);
    const url = new URL(String(fetcher.mock.calls[1]![0]), 'http://localhost');
    expect(url.pathname).toBe('/v1/orgs/org%2Fa/courts');
    expect(url.searchParams.get('cursor')).toBe('next/+');
    expect(url.searchParams.get('limit')).toBe('100');
    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([court], { nextCursor: 'next', capabilities: { canCreateCourt: true } }),
      )
      .mockResolvedValueOnce(response({ code: 'UNAVAILABLE', message: '后页服务中断' }, {}, 503));
    await expect(
      createSchedulingApi(createApiClient({ fetcher: failed }), 'org-a').courts(),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('缺少Court能力或创建能力明确报错，空机构不发请求', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([], {}))
      .mockResolvedValueOnce(
        response([{ ...court, capabilities: {} }], { capabilities: { canCreateCourt: false } }),
      );
    expect(() => createSchedulingApi(createApiClient({ fetcher }), '')).toThrow('请先选择');
    expect(fetcher).not.toHaveBeenCalled();
    const api = createSchedulingApi(createApiClient({ fetcher }), 'org-a');
    await expect(api.courts()).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    await expect(api.courts()).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('全量分配和发布分别只带明确双版本，409冲突明细保留', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(revision))
      .mockResolvedValueOnce(
        response(
          {
            code: 'SCHEDULE_CONFLICT',
            message: '存在场地冲突',
            details: {
              conflicts: [
                { code: 'COURT_OVERLAP', fixtureKeys: ['round-1-match-1'], external: true },
              ],
            },
          },
          {},
          409,
        ),
      );
    const api = createSchedulingApi(createApiClient({ fetcher }), 'org-a');
    const allocations = revision.fixtures.map((item) => ({
      fixtureKey: item.fixtureKey,
      courtId: null,
      startsAt: null,
    }));
    await api.allocations('revision/a', {
      expectedEventVersion: 11,
      expectedRevisionVersion: 1,
      allocations,
    });
    expect(fetcher.mock.calls[0]![0]).toBe(
      '/v1/orgs/org-a/schedule-revisions/revision%2Fa/allocations',
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
      expectedEventVersion: 11,
      expectedRevisionVersion: 1,
      allocations,
    });
    await expect(
      api.publish('revision/a', { expectedEventVersion: 11, expectedRevisionVersion: 1 }),
    ).rejects.toMatchObject({
      apiCode: 'SCHEDULE_CONFLICT',
      details: {
        conflicts: [{ external: true, fixtureKeys: ['round-1-match-1'], code: 'COURT_OVERLAP' }],
      },
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({
      expectedEventVersion: 11,
      expectedRevisionVersion: 1,
    });
  });
  it('正式比赛取完所有分页，保留发布时场地名称；重复游标失败', async () => {
    const saved = {
      ...revision,
      fixtures: revision.fixtures.map((item, index) => ({
        ...item,
        courtId: court.id,
        startsAt: `2026-12-01T0${index + 1}:00:00.000Z`,
        endsAt: `2026-12-01T0${index + 2}:00:00.000Z`,
      })),
    };
    const matches = officialMatches(saved);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([matches[0]], { nextCursor: 'next' }))
      .mockResolvedValueOnce(response(matches.slice(1)));
    expect(
      await createSchedulingApi(createApiClient({ fetcher }), 'org-a').matches(overview.event.id),
    ).toEqual(matches);
    const loop = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response([], { nextCursor: 'same', capabilities: { canCreateCourt: true } }),
      );
    await expect(
      createSchedulingApi(createApiClient({ fetcher: loop }), 'org-a').courts(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_CURSOR' });
    expect(loop).toHaveBeenCalledTimes(2);
  });
});

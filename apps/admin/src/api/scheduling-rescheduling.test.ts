import { describe, expect, it, vi } from 'vitest';
import type { RescheduleMatchInput } from '@small-city-basketball/contracts';
import { createApiClient } from './client';
import { createSchedulingApi } from './scheduling';
import { court, response } from '../scheduling/test-fixtures';
import { afterReschedule, reschedulingWorkspace } from '../scheduling/rescheduling-fixtures';

const input: RescheduleMatchInput = {
  type: 'RESCHEDULE',
  expectedEventVersion: 14,
  expectedMatchVersion: 1,
  courtId: court.id,
  startsAt: '2026-12-01T15:00:00.000+08:00',
  reason: '更正正式安排',
};

describe('正式比赛改期HTTP合同', () => {
  it('独立GET编码机构和场次，传递取消信号并接收服务端只读能力', async () => {
    const readonly = {
      ...reschedulingWorkspace,
      match: { ...reschedulingWorkspace.match, id: 'match/a', status: 'LIVE' },
      capabilities: { canReschedule: false },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(readonly));
    const control = new AbortController();
    const actual = await createSchedulingApi(createApiClient({ fetcher }), 'org/a').rescheduling(
      'match/a',
      control.signal,
    );
    expect(actual.capabilities.canReschedule).toBe(false);
    expect(fetcher.mock.calls[0]![0]).toBe('/v1/orgs/org%2Fa/matches/match%2Fa/rescheduling');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      signal: control.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it.each([
    [
      '缺权限',
      (v: Record<string, unknown>) => {
        v.capabilities = {};
      },
    ],
    [
      '错场次',
      (v: Record<string, unknown>) => {
        v.match = { ...reschedulingWorkspace.match, id: 'other' };
      },
    ],
    [
      '错父赛事',
      (v: Record<string, unknown>) => {
        v.match = { ...reschedulingWorkspace.match, eventId: 'other' };
      },
    ],
    [
      '非法版本',
      (v: Record<string, unknown>) => {
        v.event = { ...reschedulingWorkspace.event, version: 0 };
      },
    ],
    [
      '坏当前时间',
      (v: Record<string, unknown>) => {
        v.match = { ...reschedulingWorkspace.match, startsAt: 'invalid' };
      },
    ],
    [
      '未知状态',
      (v: Record<string, unknown>) => {
        v.match = { ...reschedulingWorkspace.match, status: 'UNKNOWN' };
      },
    ],
    [
      '开赛却授写权',
      (v: Record<string, unknown>) => {
        v.match = { ...reschedulingWorkspace.match, status: 'LIVE' };
      },
    ],
    [
      '赛事关闭却授写权',
      (v: Record<string, unknown>) => {
        v.event = { ...reschedulingWorkspace.event, status: 'CANCELLED' };
      },
    ],
    [
      '坏窗口',
      (v: Record<string, unknown>) => {
        v.policy = {
          ...reschedulingWorkspace.policy,
          courtWindows: [{ courtId: court.id, startsAt: 'invalid', endsAt: court.createdAt }],
        };
      },
    ],
    [
      '缺历史边界',
      (v: Record<string, unknown>) => {
        delete v.historyTruncated;
      },
    ],
    [
      '伪造截断',
      (v: Record<string, unknown>) => {
        v.historyTruncated = true;
      },
    ],
    [
      '坏历史',
      (v: Record<string, unknown>) => {
        v.history = [{ id: 'incomplete' }];
      },
    ],
  ])('%s响应拒绝渲染编辑而不猜测权限', async (_name, corrupt) => {
    const value = structuredClone(reschedulingWorkspace) as unknown as Record<string, unknown>;
    corrupt(value);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
    await expect(
      createSchedulingApi(createApiClient({ fetcher }), 'org-a').rescheduling(
        reschedulingWorkspace.match.id,
      ),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });

  it('POST仅发送明确命令、双版本及目标，不提交客户端结束时间或比赛状态', async () => {
    const saved = afterReschedule(reschedulingWorkspace, input);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(saved));
    const signal = new AbortController().signal;
    expect(
      await createSchedulingApi(createApiClient({ fetcher }), 'org-a').reschedule(
        reschedulingWorkspace.match.id,
        input,
        signal,
      ),
    ).toEqual(saved);
    expect(fetcher.mock.calls[0]![0]).toBe('/v1/orgs/org-a/matches/match-1/reschedule-commands');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', signal });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(input);
  });

  it.each([
    [
      '旧版本',
      (v: ReturnType<typeof afterReschedule>) => {
        v.match.version = 1;
        v.history = [];
      },
    ],
    [
      '错误Event版本',
      (v: ReturnType<typeof afterReschedule>) => {
        v.event.version++;
      },
    ],
    [
      '错误目标',
      (v: ReturnType<typeof afterReschedule>) => {
        v.match.startsAt = reschedulingWorkspace.match.startsAt;
      },
    ],
    [
      '缺改期证明',
      (v: ReturnType<typeof afterReschedule>) => {
        v.history = [];
      },
    ],
    [
      '历史目标错误',
      (v: ReturnType<typeof afterReschedule>) => {
        v.history[0]!.to.courtName = '其他场地';
      },
    ],
    [
      '未来历史版本',
      (v: ReturnType<typeof afterReschedule>) => {
        v.history[0]!.fromMatchVersion = 2;
        v.history[0]!.toMatchVersion = 3;
      },
    ],
  ])('200但%s不能宣称保存成功', async (_name, corrupt) => {
    const value = afterReschedule(reschedulingWorkspace, input);
    corrupt(value);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
    await expect(
      createSchedulingApi(createApiClient({ fetcher }), 'org-a').reschedule(
        reschedulingWorkspace.match.id,
        input,
      ),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });

  it('409冲突保持服务端错误及明细，适配器不自动重试', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          code: 'SCHEDULE_CONFLICT',
          message: '占用冲突',
          details: {
            conflicts: [{ code: 'TEAM_OVERLAP', fixtureKeys: ['round-1-match-1'], external: true }],
          },
        },
        {},
        409,
      ),
    );
    await expect(
      createSchedulingApi(createApiClient({ fetcher }), 'org-a').reschedule(
        reschedulingWorkspace.match.id,
        input,
      ),
    ).rejects.toMatchObject({
      apiCode: 'SCHEDULE_CONFLICT',
      details: { conflicts: [{ code: 'TEAM_OVERLAP', external: true }] },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RescheduleMatchInput } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import { createSchedulingApi } from '../api/scheduling';
import { Rescheduling } from './Rescheduling';
import { court, response } from './test-fixtures';
import { afterReschedule, reschedulingWorkspace, secondCourt } from './rescheduling-fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const posts = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
const setTime = (value: string) =>
  fireEvent.change(screen.getByLabelText('改期开赛时间（UTC+8）'), { target: { value } });
function mount(fetcher: typeof fetch, strict = false) {
  const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), onLocate: vi.fn() };
  const content = (
    <Rescheduling
      match={reschedulingWorkspace.match}
      courts={[court, secondCourt]}
      api={createSchedulingApi(createApiClient({ fetcher }), 'org-a')}
      {...callbacks}
    />
  );
  const rendered = render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { ...callbacks, ...rendered };
}
async function fill(user: ReturnType<typeof userEvent.setup>, reason = '雨后调整场地') {
  await screen.findByLabelText('改期原因');
  setTime('2026-12-01T15:00');
  await user.type(screen.getByLabelText('改期原因'), reason);
  await user.click(screen.getByRole('button', { name: '核对改期' }));
}
function submitted(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) {
  return JSON.parse(String(posts(fetcher)[index]![1]?.body)) as RescheduleMatchInput;
}

describe('单场改期与记录', () => {
  it('聚焦工作台，展示前后确认后才提交精确版本、UTC+8和理由', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, init) =>
        init?.method === 'POST'
          ? response(afterReschedule(reschedulingWorkspace, JSON.parse(String(init.body))))
          : response(reschedulingWorkspace),
      );
    const { onSaved } = mount(fetcher);
    const user = userEvent.setup();
    await screen.findByLabelText('改期原因');
    expect(screen.getByRole('heading', { name: '单场改期与记录' })).toHaveFocus();
    expect(screen.getByLabelText('改期开赛时间（UTC+8）')).toHaveValue('2026-12-01T09:00');
    await user.selectOptions(screen.getByLabelText('改期场地'), secondCourt.id);
    await fill(user, '  雨后调整场地  ');
    const confirmation = screen.getByRole('region', { name: '确认单场改期' });
    expect(confirmation).toHaveTextContent('原安排');
    expect(confirmation).toHaveTextContent('拟调整为');
    expect(confirmation).toHaveTextContent(secondCourt.name);
    expect(posts(fetcher)).toHaveLength(0);
    await user.click(within(confirmation).getByRole('button', { name: '返回修改' }));
    expect(screen.getByLabelText('改期原因')).toHaveValue('  雨后调整场地  ');
    expect(posts(fetcher)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(submitted(fetcher)).toEqual({
      type: 'RESCHEDULE',
      expectedEventVersion: 14,
      expectedMatchVersion: 1,
      courtId: secondCourt.id,
      startsAt: '2026-12-01T15:00:00.000+08:00',
      reason: '雨后调整场地',
    });
  });

  it('空原因、无效时间、无实际变化均不产生请求', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(reschedulingWorkspace));
    mount(fetcher);
    const user = userEvent.setup();
    await screen.findByLabelText('改期原因');
    setTime('2026-12-01T15:00');
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    expect(screen.getByRole('alert')).toHaveTextContent('改期原因');
    await user.type(screen.getByLabelText('改期原因'), '更正安排');
    setTime('');
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    expect(screen.getByRole('alert')).toHaveTextContent('真实有效');
    setTime('2026-12-01T09:00');
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    expect(screen.getByRole('alert')).toHaveTextContent('没有变化');
    expect(posts(fetcher)).toHaveLength(0);
  });

  it('服务端冲突保留输入并定位场次，不自动再提交', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method === 'POST'
        ? response(
            {
              code: 'SCHEDULE_CONFLICT',
              message: '场地或球队存在冲突',
              details: {
                conflicts: [
                  {
                    code: 'COURT_OVERLAP',
                    fixtureKeys: [reschedulingWorkspace.match.fixtureKey, 'round-2-match-1'],
                    external: true,
                  },
                ],
              },
            },
            {},
            409,
          )
        : response(reschedulingWorkspace),
    );
    const { onLocate } = mount(fetcher);
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    const conflict = await screen.findByRole('region', { name: '改期冲突' });
    expect(conflict).toHaveTextContent('场地时间重叠');
    expect(conflict).toHaveTextContent('其他正式安排');
    expect(screen.getByLabelText('改期原因')).toHaveValue('雨后调整场地');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeEnabled();
    await user.click(within(conflict).getByRole('button', { name: '定位相关场次' }));
    expect(onLocate).toHaveBeenCalledWith('round-2-match-1');
    expect(posts(fetcher)).toHaveLength(1);
  });

  it('版本冲突锁定提交，读取失败不解锁，成功读取后仍需显式核对再用fresh版本提交', async () => {
    let reads = 0;
    let writes = 0;
    const current = {
      ...reschedulingWorkspace,
      event: { ...reschedulingWorkspace.event, version: 20 },
      match: {
        ...reschedulingWorkspace.match,
        version: 3,
        startsAt: '2026-12-01T06:00:00.000Z',
        endsAt: '2026-12-01T07:00:00.000Z',
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') {
        writes++;
        return writes === 1
          ? response({ code: 'VERSION_CONFLICT', message: '另一位管理者已更新' }, {}, 409)
          : response(afterReschedule(current, JSON.parse(String(init.body))));
      }
      reads++;
      return reads === 1
        ? response(reschedulingWorkspace)
        : reads === 2
          ? response({ code: 'UNAVAILABLE', message: '暂时无法读取' }, {}, 503)
          : response(current);
    });
    const { onSaved } = mount(fetcher);
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('资料版本已变化');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '重新读取当前安排' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('读取当前安排失败');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: '已核对最新安排，继续编辑' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新读取当前安排' }));
    const acknowledge = await screen.findByRole('button', { name: '已核对最新安排，继续编辑' });
    expect(screen.getByLabelText('改期原因')).toHaveValue('雨后调整场地');
    expect(screen.getByLabelText('改期开赛时间（UTC+8）')).toHaveValue('2026-12-01T15:00');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeDisabled();
    await user.click(acknowledge);
    expect(screen.getByRole('button', { name: '核对改期' })).toBeEnabled();
    expect(posts(fetcher)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(submitted(fetcher, 1)).toMatchObject({
      expectedEventVersion: 20,
      expectedMatchVersion: 3,
    });
  });

  it('丢失响应后的fresh历史可证明已生效，保留原输入且禁止同安排再写', async () => {
    let actual = reschedulingWorkspace;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') {
        actual = afterReschedule(actual, JSON.parse(String(init.body)));
        throw new TypeError('response lost');
      }
      return response(actual);
    });
    const { onSaved } = mount(fetcher);
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('不要重复提交');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '重新读取当前安排' }));
    await user.click(await screen.findByRole('button', { name: '已核对最新安排，继续编辑' }));
    expect(screen.getByRole('region', { name: '本场改期历史' })).toHaveTextContent('雨后调整场地');
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    expect(screen.getByRole('alert')).toHaveTextContent('没有变化');
    expect(onSaved).not.toHaveBeenCalled();
    expect(posts(fetcher)).toHaveLength(1);
  });

  it.each([500, 200])('HTTP %s的不确定或陈旧响应不冒充改期成功', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, init) =>
        init?.method === 'POST'
          ? status === 500
            ? response({ code: 'INTERNAL_ERROR', message: '请求失败' }, {}, 500)
            : response(reschedulingWorkspace)
          : response(reschedulingWorkspace),
      );
    const { onSaved } = mount(fetcher);
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未确认');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('权限或开赛状态变化后只读，保留历史且不提供提交入口', async () => {
    const current = afterReschedule(reschedulingWorkspace, {
      type: 'RESCHEDULE',
      expectedEventVersion: 14,
      expectedMatchVersion: 1,
      courtId: court.id,
      startsAt: '2026-12-01T07:00:00.000Z',
      reason: '<img src=x onerror=alert(1)>',
    });
    current.capabilities.canReschedule = false;
    current.match.status = 'LIVE';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(current));
    mount(fetcher);
    await screen.findByText(
      '当前场次或身份不允许改期。已开赛及赛果处理中的比赛不可调整；实际权限由服务核验。',
    );
    expect(screen.queryByLabelText('改期原因')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '核对改期' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '本场改期历史' })).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(posts(fetcher)).toHaveLength(0);
  });

  it('双击确认只产生一次写入，写入期间不能关闭', async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response(reschedulingWorkspace),
    );
    const { onSaved, onClose } = mount(fetcher);
    const user = userEvent.setup();
    await fill(user);
    await user.dblClick(screen.getByRole('button', { name: '确认改期' }));
    expect(posts(fetcher)).toHaveLength(1);
    expect(screen.getByRole('button', { name: '关闭改期记录' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '关闭改期记录' }));
    expect(onClose).not.toHaveBeenCalled();
    finish!(response(afterReschedule(reschedulingWorkspace, submitted(fetcher))));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('历史只展示服务返回的最近20条并明确截断，不伪造更早历史分页', async () => {
    const from = {
      courtId: reschedulingWorkspace.match.courtId,
      courtName: reschedulingWorkspace.match.courtName,
      startsAt: reschedulingWorkspace.match.startsAt,
      endsAt: reschedulingWorkspace.match.endsAt,
    };
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `history-${index}`,
      fromMatchVersion: 20 - index,
      toMatchVersion: 21 - index,
      from,
      to: from,
      reason: `合成历史记录${index + 1}`,
      createdAt: '2026-10-23T01:00:00.000Z',
    }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...reschedulingWorkspace,
        match: { ...reschedulingWorkspace.match, version: 21 },
        capabilities: { canReschedule: false },
        history,
        historyTruncated: true,
      }),
    );
    mount(fetcher);
    await screen.findByText('这里只显示最近20条改期记录，较早历史仍保留。');
    expect(
      within(screen.getByRole('region', { name: '本场改期历史' })).getAllByRole('listitem'),
    ).toHaveLength(20);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /下一页|更早/ })).not.toBeInTheDocument();
  });

  it('StrictMode重新挂载后的旧GET取消不会覆盖新读取或卡住工作台', async () => {
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      reads++;
      if (reads === 1)
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      return response(reschedulingWorkspace);
    });
    mount(fetcher, true);
    await screen.findByLabelText('改期原因');
    expect(screen.getByRole('button', { name: '核对改期' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('卸载取消GET，迟到响应不能触发保存或修改已离开的界面', async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount, onSaved } = mount(fetcher);
    const signal = fetcher.mock.calls[0]![1]!.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    finish!(response(reschedulingWorkspace));
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ScheduleOptimizationPreview } from '@small-city-basketball/contracts';
import { ApiError, createApiClient } from '../api/client';
import { createSchedulingApi } from '../api/scheduling';
import { ServerOptimizationPreview } from './ServerOptimizationPreview';
import { optimizationPreview } from './optimization-fixtures';
import { EventSchedulingPage } from './SchedulePages';
import { court, currentOverview, response, revision } from './test-fixtures';

afterEach(cleanup);
const dates = { startDate: '2026-12-01', endDate: '2026-12-05' };
function standalone() {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(optimizationPreview()));
  const api = createSchedulingApi(createApiClient({ fetcher }), 'org-a');
  const props = {
    revision,
    courts: [court],
    allocations: revision.fixtures.map((f) => ({
      fixtureKey: f.fixtureKey,
      courtId: '',
      localStart: '',
    })),
    eventDates: dates,
    api,
    ownerKey: 'org-a:owner-a',
    dirty: false,
    disabled: false,
    onBusyChange: vi.fn(),
    onAdopt: vi.fn(),
    onReload: vi.fn(),
  };
  const ui = render(<ServerOptimizationPreview {...props} />);
  return { ...ui, fetcher, props };
}
function page(initial = structuredClone(revision)) {
  let saved = initial;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    const url = String(path);
    if (url.includes('/courts?'))
      return response([court], { capabilities: { canCreateCourt: true } });
    if (url.endsWith('/optimization-preview')) return response(optimizationPreview(saved));
    if (url.endsWith('/allocations')) {
      const input = JSON.parse(String(init?.body)) as {
        allocations: ScheduleOptimizationPreview['allocations'];
      };
      saved = {
        ...saved,
        version: saved.version + 1,
        eventVersion: saved.eventVersion + 1,
        fixtures: saved.fixtures.map((f) => {
          const a = input.allocations.find((item) => item.fixtureKey === f.fixtureKey)!;
          return {
            ...f,
            ...a,
            endsAt: a.startsAt ? new Date(Date.parse(a.startsAt) + 3600000).toISOString() : null,
          };
        }),
      };
      return response(saved);
    }
    if (url.endsWith('/validate'))
      return response({
        revisionId: saved.id,
        expectedEventVersion: saved.eventVersion,
        expectedRevisionVersion: saved.version,
        checkedAt: court.createdAt,
        valid: true,
        conflicts: [],
      });
    if (url.endsWith('/schedule-revisions/revision-a')) return response(saved);
    return response(currentOverview(saved));
  });
  render(
    <MemoryRouter initialEntries={['/events/event-a/scheduling']}>
      <Routes>
        <Route
          path="/events/:eventId/scheduling"
          element={
            <EventSchedulingPage
              context={{
                client: createApiClient({ fetcher }),
                organizationId: 'org-a',
                userId: 'owner-a',
                onSessionRefresh: async () => {},
              }}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return fetcher;
}

it('完整预演仅发只读POST，采用只改本地，之后仍按原保存/校验/发布', async () => {
  const fetcher = page();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '服务端补排预演' }));
  const result = await screen.findByRole('region', { name: '服务端排程预演结果' });
  expect(result).toHaveTextContent('已排3场 · 保留0场 · 未排0场 · 变化3场');
  expect(result).toHaveTextContent('原：未分配场地');
  expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue('');
  expect(fetcher.mock.calls.filter(([, i]) => i?.method)).toHaveLength(1);
  await user.click(within(result).getByRole('button', { name: '采用服务端建议到本地' }));
  expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue(court.id);
  expect(screen.getByRole('button', { name: '检查赛程冲突' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
  expect(fetcher.mock.calls.filter(([, i]) => i?.method)).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: '保存全部安排' }));
  await screen.findByText('全部安排已保存');
  const writes = fetcher.mock.calls.filter(([path]) => String(path).endsWith('/allocations'));
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0]![1]?.body))).toMatchObject({
    expectedEventVersion: 11,
    expectedRevisionVersion: 1,
  });
  await user.click(screen.getByRole('button', { name: '检查赛程冲突' }));
  await screen.findByText('当前版本检查通过');
  expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeEnabled();
  expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/publish'))).toBe(false);
});

it('有未保存手工输入时禁用服务端预演，原本地建议仍可用', async () => {
  const fetcher = page();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('第1轮第1场 场地'), court.id);
  fireEvent.change(screen.getByLabelText('第1轮第1场 开始时间'), {
    target: { value: '2026-12-01T11:00' },
  });
  expect(screen.getByRole('button', { name: '服务端补排预演' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '全稿均衡预演' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '生成排时建议' })).toBeEnabled();
  expect(screen.getByText(/当前有未保存安排/)).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/optimization-preview'))).toBe(
    false,
  );
  expect(screen.getByLabelText('第1轮第1场 开始时间')).toHaveValue('2026-12-01T11:00');
});

it('全稿采用需要独立确认，可返回或放弃且不修改输入', async () => {
  const { props } = standalone();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '全稿均衡预演' }));
  await user.click(await screen.findByRole('button', { name: '采用服务端建议到本地' }));
  expect(props.onAdopt).not.toHaveBeenCalled();
  expect(screen.getByRole('group', { name: '确认全稿替换' })).toHaveTextContent('尚不保存或发布');
  await user.click(screen.getByRole('button', { name: '返回核对预演' }));
  expect(props.onAdopt).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '采用服务端建议到本地' }));
  await user.click(screen.getByRole('button', { name: '确认替换本地草稿安排' }));
  expect(props.onAdopt).toHaveBeenCalledExactlyOnceWith(optimizationPreview().allocations);
});

it('部分/上限结果保留null未排，不伪造时间', async () => {
  const { fetcher, props } = standalone();
  const user = userEvent.setup();
  const result = optimizationPreview();
  const last = result.allocations.at(-1)!;
  last.startsAt = null;
  last.courtId = null;
  result.unassigned = [{ fixtureKey: last.fixtureKey, reason: 'SEARCH_LIMIT' }];
  result.score.assignedCount = 2;
  result.score.latestEnd = '2026-12-01T03:30:00.000Z';
  result.limitReached = true;
  result.status = 'LIMIT_REACHED';
  fetcher.mockResolvedValueOnce(response(result));
  await user.click(screen.getByRole('button', { name: '服务端补排预演' }));
  expect(await screen.findByRole('region', { name: '服务端排程预演结果' })).toHaveTextContent(
    '已达搜索上限',
  );
  expect(screen.getByText(/未找到可排时段，不编造时间/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '采用服务端建议到本地' }));
  expect(props.onAdopt.mock.calls[0]![0].at(-1)).toEqual(last);
});

it('取消立即释放busy，即使请求不结束，并忽略其迟到响应', async () => {
  const { fetcher, props } = standalone();
  const user = userEvent.setup();
  let finish!: (value: Response) => void;
  fetcher.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await user.click(screen.getByRole('button', { name: '服务端补排预演' }));
  expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
  const signal = fetcher.mock.calls[0]![1]!.signal!;
  await user.click(screen.getByRole('button', { name: '取消服务端预演' }));
  expect(signal.aborted).toBe(true);
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('button', { name: '全稿均衡预演' })).toBeEnabled();
  await act(async () => finish(response(optimizationPreview())));
  expect(screen.queryByRole('region', { name: '服务端排程预演结果' })).not.toBeInTheDocument();
  expect(props.onAdopt).not.toHaveBeenCalled();
});

it.each(['version', 'owner', 'api', 'input', 'court'] as const)(
  '%s变化清除预演并忽略旧请求',
  async (change) => {
    const { fetcher, props, rerender } = standalone();
    const user = userEvent.setup();
    let finish!: (value: Response) => void;
    fetcher.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await user.click(screen.getByRole('button', { name: '服务端补排预演' }));
    const next = { ...props };
    if (change === 'version') next.revision = { ...revision, version: 2 };
    if (change === 'owner') next.ownerKey = 'org-a:owner-b';
    if (change === 'api') next.api = createSchedulingApi(createApiClient({ fetcher }), 'org-b');
    if (change === 'input')
      next.allocations = props.allocations.map((a, i) => (i ? a : { ...a, courtId: court.id }));
    if (change === 'court') next.courts = [{ ...court, version: 2 }];
    rerender(<ServerOptimizationPreview {...next} />);
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await act(async () => finish(response(optimizationPreview())));
    expect(screen.queryByRole('region', { name: '服务端排程预演结果' })).not.toBeInTheDocument();
    expect(props.onAdopt).not.toHaveBeenCalled();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  },
);

it('卸载取消，迟到响应不写本地', async () => {
  const { fetcher, props, unmount } = standalone();
  const user = userEvent.setup();
  let finish!: (value: Response) => void;
  fetcher.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await user.click(screen.getByRole('button', { name: '服务端补排预演' }));
  unmount();
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  await act(async () => finish(response(optimizationPreview())));
  expect(props.onAdopt).not.toHaveBeenCalled();
});

it.each([401, 403, 409])('%d失败阻止重试，保留输入并要求显式重读', async (status) => {
  const { props } = standalone();
  const user = userEvent.setup();
  const execute = vi
    .spyOn(props.api, 'optimizationPreview')
    .mockRejectedValue(new ApiError(status, 'DENIED', '预演被拒绝'));
  await user.click(screen.getByRole('button', { name: '服务端补排预演' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('预演被拒绝');
  expect(screen.getByRole('button', { name: '全稿均衡预演' })).toBeDisabled();
  expect(props.onAdopt).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: '重新读取排赛资料' }));
  expect(props.onReload).toHaveBeenCalledTimes(1);
});

it('不接受坏响应，当前只读或历史草稿不允许生成', async () => {
  const { fetcher, props, rerender } = standalone();
  const user = userEvent.setup();
  fetcher.mockResolvedValueOnce(response({ ...optimizationPreview(), eventVersion: 99 }));
  await user.click(screen.getByRole('button', { name: '服务端补排预演' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('不一致');
  expect(props.onAdopt).not.toHaveBeenCalled();
  for (const next of [
    { ...revision, capabilities: { ...revision.capabilities, canEditAllocations: false } },
    { ...revision, status: 'PUBLISHED' as const },
    { ...revision, isCurrent: false },
  ]) {
    rerender(<ServerOptimizationPreview {...props} revision={next} />);
    expect(screen.getByRole('button', { name: '服务端补排预演' })).toBeDisabled();
  }
});

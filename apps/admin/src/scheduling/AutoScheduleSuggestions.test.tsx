// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ScheduleRevisionData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import { EventSchedulingPage } from './SchedulePages';
import * as suggestions from './auto-schedule';
import { court, revision, currentOverview, response } from './test-fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function page(initial: ScheduleRevisionData = revision) {
  let saved = structuredClone(initial);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    const url = String(path);
    if (url.includes('/courts?'))
      return response([court], { capabilities: { canCreateCourt: true } });
    if (url.endsWith('/allocations') && init?.method === 'PUT') {
      const input = JSON.parse(String(init.body)) as {
        allocations: { fixtureKey: string; courtId: string | null; startsAt: string | null }[];
      };
      saved = {
        ...saved,
        version: saved.version + 1,
        eventVersion: saved.eventVersion + 1,
        fixtures: saved.fixtures.map((fixture) => {
          const current = input.allocations.find((item) => item.fixtureKey === fixture.fixtureKey)!;
          return {
            ...fixture,
            ...current,
            endsAt: current.startsAt
              ? new Date(
                  Date.parse(current.startsAt) + saved.policy.slotDurationMinutes * 60000,
                ).toISOString()
              : null,
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
  const result = render(
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
  return { fetcher, ...result };
}
function writes(fetcher: ReturnType<typeof page>['fetcher']) {
  return fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
}

describe('排时建议与原保存发布流程', () => {
  it('生成只预览，采用只改本地，保存后仍须调用原服务端检查才能发布', async () => {
    const { fetcher } = page();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '生成排时建议' }));
    const preview = await screen.findByRole('region', { name: '排时建议预览' });
    expect(preview).toHaveTextContent('建议3场 · 保留0场 · 未排0场');
    expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue('');
    expect(writes(fetcher)).toHaveLength(0);
    await user.click(within(preview).getByRole('button', { name: '采用3场建议到本地' }));
    expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue(court.id);
    expect(screen.getByLabelText('第2轮第1场 开始时间')).toHaveValue('2026-12-01T10:30');
    expect(screen.getByText(/本地修改未保存/)).toBeVisible();
    expect(screen.getByRole('button', { name: '检查赛程冲突' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
    expect(writes(fetcher)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '保存全部安排' }));
    await screen.findByText('全部安排已保存');
    expect(writes(fetcher)).toHaveLength(1);
    expect(JSON.parse(String(writes(fetcher)[0]![1]?.body))).toMatchObject({
      expectedEventVersion: 11,
      expectedRevisionVersion: 1,
      allocations: expect.arrayContaining([
        {
          fixtureKey: revision.fixtures[0]!.fixtureKey,
          courtId: court.id,
          startsAt: '2026-12-01T09:00:00.000+08:00',
        },
      ]),
    });
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '检查赛程冲突' }));
    await screen.findByText('当前版本检查通过');
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeEnabled();
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/publish'))).toBe(false);
  });

  it('保留已有未保存分配，放弃预览不改变手工输入，采用也不覆盖它', async () => {
    const { fetcher } = page();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('第1轮第1场 场地'), court.id);
    fireEvent.change(screen.getByLabelText('第1轮第1场 开始时间'), {
      target: { value: '2026-12-01T11:00' },
    });
    await user.click(screen.getByRole('button', { name: '生成排时建议' }));
    expect(await screen.findByRole('region', { name: '排时建议预览' })).toHaveTextContent(
      '建议2场 · 保留1场',
    );
    await user.click(screen.getByRole('button', { name: '放弃建议' }));
    expect(screen.getByLabelText('第1轮第1场 开始时间')).toHaveValue('2026-12-01T11:00');
    expect(screen.getByLabelText('第2轮第1场 场地')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: '生成排时建议' }));
    await user.click(await screen.findByRole('button', { name: '采用2场建议到本地' }));
    expect(screen.getByLabelText('第1轮第1场 开始时间')).toHaveValue('2026-12-01T11:00');
    expect(screen.getByLabelText('第2轮第1场 开始时间')).toHaveValue('2026-12-01T09:00');
    expect(writes(fetcher)).toHaveLength(0);
  });

  it('不完整输入明确阻止计算；手工修改使原预览失效', async () => {
    const { fetcher } = page();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('第1轮第1场 场地'), court.id);
    await user.click(screen.getByRole('button', { name: '生成排时建议' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('同时填写场地和时间');
    expect(screen.queryByRole('region', { name: '排时建议预览' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('第1轮第1场 开始时间'), {
      target: { value: '2026-12-01T11:00' },
    });
    await user.click(screen.getByRole('button', { name: '生成排时建议' }));
    await screen.findByRole('region', { name: '排时建议预览' });
    fireEvent.change(screen.getByLabelText('第1轮第1场 开始时间'), {
      target: { value: '2026-12-01T12:00' },
    });
    expect(screen.queryByRole('region', { name: '排时建议预览' })).not.toBeInTheDocument();
    expect(writes(fetcher)).toHaveLength(0);
  });

  it('部分可排显示原因，采用不会给剩余场次编造时间', async () => {
    const input = structuredClone(revision);
    input.policy.courtWindows[0]!.endsAt = '2026-12-01T02:00:00.000Z';
    const { fetcher } = page(input);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '生成排时建议' }));
    const preview = await screen.findByRole('region', { name: '排时建议预览' });
    expect(preview).toHaveTextContent('建议1场 · 保留0场 · 未排2场');
    expect(within(preview).getAllByText(/本轮建议未找到/)).toHaveLength(2);
    await user.click(within(preview).getByRole('button', { name: '采用1场建议到本地' }));
    expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue(court.id);
    expect(screen.getByLabelText('第2轮第1场 场地')).toHaveValue('');
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
    expect(writes(fetcher)).toHaveLength(0);
  });

  it('取消计算后忽略迟到成功，不修改输入或调用API写入', async () => {
    let finish: ((value: suggestions.ScheduleSuggestion) => void) | undefined;
    let signal: AbortSignal | undefined;
    vi.spyOn(suggestions, 'suggestSchedule').mockImplementation((_context, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const { fetcher } = page();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '生成排时建议' }));
    expect(screen.getByRole('button', { name: '保存全部安排' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '取消计算' }));
    expect(signal?.aborted).toBe(true);
    finish!({
      allocations: [
        {
          fixtureKey: revision.fixtures[0]!.fixtureKey,
          courtId: court.id,
          startsAt: '2026-12-01T01:00:00.000Z',
        },
      ],
      unassigned: [],
      checks: 1,
      preservedCount: 0,
      status: 'COMPLETE',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '生成排时建议' })).toBeEnabled());
    expect(screen.queryByRole('region', { name: '排时建议预览' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue('');
    expect(screen.getByText('已取消建议计算，原有安排未改变。')).toBeVisible();
    expect(writes(fetcher)).toHaveLength(0);
  });

  it('只读、已发布或历史版本不提供建议入口', async () => {
    const input = structuredClone(revision);
    input.capabilities.canEditAllocations = false;
    page(input);
    await screen.findByRole('heading', { name: '按轮安排比赛' });
    expect(screen.queryByRole('button', { name: '生成排时建议' })).not.toBeInTheDocument();
    cleanup();
    input.isCurrent = false;
    input.status = 'SUPERSEDED';
    input.capabilities.canEditAllocations = true;
    page(input);
    await screen.findByRole('heading', { name: '按轮安排比赛' });
    expect(screen.queryByRole('button', { name: '生成排时建议' })).not.toBeInTheDocument();
  });
});

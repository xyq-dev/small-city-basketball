// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { EventPlayerStatisticsPage } from './PlayerStatisticsPage';
import { deferred, response, statistics } from './test-fixtures';

afterEach(cleanup);
const context = (fetcher: typeof fetch): RegistrationWorkspace => ({
  client: createApiClient({ fetcher }),
  organizationId: 'org-a',
  userId: 'user-a',
  onSessionRefresh: async () => {},
});
function page(workspace: RegistrationWorkspace) {
  return (
    <MemoryRouter initialEntries={['/events/event-a/player-statistics']}>
      <Routes>
        <Route
          path="/events/:eventId/player-statistics"
          element={<EventPlayerStatisticsPage context={workspace} />}
        />
      </Routes>
    </MemoryRouter>
  );
}
describe('private event player statistics page', () => {
  it('shows honest coverage, shared score ranks and explicit unassigned totals without inventing advanced metrics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(statistics));
    render(page(context(fetcher)));
    const collection = await screen.findByRole('region', { name: '采集范围与完整性' });
    expect(collection).toHaveTextContent('采集覆盖不完整');
    expect(collection).toHaveTextContent('逐人基础数据已计入 1 场');
    expect(collection).toHaveTextContent('仅球队总数已确认 1 场');
    expect(collection).toHaveTextContent('待有效确认 1 场');
    expect(collection).toHaveTextContent('含未归属得分或犯规');
    const table = screen.getByRole('table');
    const players = within(table).getAllByRole('row').slice(1);
    expect(players).toHaveLength(2);
    for (const row of players)
      expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('1并列');
    expect(within(table).getByRole('columnheader', { name: '采集名单场次' })).toBeInTheDocument();
    const teams = screen.getByRole('region', { name: '球队归属核对' });
    expect(teams).toHaveTextContent('未归属得分 2');
    expect(teams).toHaveTextContent('未归属犯规 1');
    expect(screen.getByText(/篮板、助攻.*未统计/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /导出|公开/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '数据来源' })).toHaveTextContent('a'.repeat(64));
  });
  it('shows no-schedule and zero personal sample states rather than fake player rows', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...statistics, summary: null }))
      .mockResolvedValueOnce(
        response({
          ...statistics,
          summary: {
            ...statistics.summary!,
            includedMatchCount: 0,
            teamOnlyConfirmedMatchCount: 2,
            pendingMatchCount: 1,
            attributionComplete: false,
            rows: [],
            teams: statistics.summary!.teams.map((team) => ({
              ...team,
              attributedScore: 0,
              unassignedScore: 0,
              attributedFouls: 0,
              unassignedFouls: 0,
            })),
          },
        }),
      );
    render(page(context(fetcher)));
    expect(await screen.findByRole('heading', { name: '尚无正式赛程' })).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新球员数据' }));
    expect(await screen.findByRole('heading', { name: '尚无可计入的球员数据' })).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const teams = screen.getByRole('region', { name: '球队归属核对' });
    expect(teams).toHaveTextContent('尚无已确认逐人样本，球队归属未计算');
    expect(within(teams).queryByRole('article')).not.toBeInTheDocument();
  });
  it('refresh removes a reopened match sample and does not retain stale private data after access is revoked', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(statistics))
      .mockResolvedValueOnce(
        response({
          ...statistics,
          summary: {
            ...statistics.summary!,
            includedMatchCount: 0,
            pendingMatchCount: 2,
            attributionComplete: false,
            rows: [],
            teams: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({ code: 'NOT_FOUND', message: '赛事不可用或权限已撤销' }, 404),
      )
      .mockResolvedValueOnce(response(statistics));
    render(page(context(fetcher)));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: '刷新球员数据' }));
    expect(await screen.findByRole('heading', { name: '尚无可计入的球员数据' })).toBeVisible();
    expect(screen.queryByText('测试甲')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新球员数据' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('权限已撤销');
    expect(screen.queryByText(statistics.event.name)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '数据来源' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
  it('never requests private event data in a team or missing organization context', () => {
    const fetcher = vi.fn<typeof fetch>();
    const workspace = context(fetcher);
    const view = render(page({ ...workspace, organizationId: undefined }));
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    view.rerender(
      page({
        ...workspace,
        teamContext: {
          orgId: 'org-a',
          organizationName: '机构',
          teamId: 'team-a',
          teamName: '球队',
        },
      }),
    );
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('drops a previous organization late response without leaking names into the next organization', async () => {
    const previous = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/org-b/')
          ? response({ code: 'NOT_FOUND', message: '无此赛事' }, 404)
          : previous.promise,
      );
    const workspace = context(fetcher);
    const view = render(page(workspace));
    view.rerender(page({ ...workspace, organizationId: 'org-b' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无此赛事');
    await act(async () => {
      previous.resolve(response(statistics));
    });
    expect(screen.queryByText('测试甲')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('无此赛事');
  });
});

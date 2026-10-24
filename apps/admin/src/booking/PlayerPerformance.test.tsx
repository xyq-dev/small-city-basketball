// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingPage } from './BookingPages';
import {
  PerformanceProvider,
  PlayerPerformanceDetails,
  DataAuthorizations,
} from './PlayerPerformance';
import { createDemoBookingRepository } from './demo';
import { createDemoPerformanceRepository } from './performance-demo';
import { emptyPerformance } from './performance-model';
import type { PlayerPerformanceData, PlayerPerformanceRepository } from './performance-model';
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function app(
  path: string,
  booking: ReturnType<typeof createDemoBookingRepository>,
  performance: PlayerPerformanceRepository,
) {
  window.history.replaceState({}, '', path);
  return render(
    <BrowserRouter>
      <BookingPage repository={booking.repository} performanceRepository={performance} />
    </BrowserRouter>,
  );
}
describe('球员数据与同价比较', () => {
  it('同价同位置筛选后能比较两名PG，并把平台交通费用计入预计合计', async () => {
    const booking = createDemoBookingRepository(),
      performance = createDemoPerformanceRepository(booking);
    app('/players', booking, performance);
    await screen.findByRole('heading', { name: '陈宇航' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('参赛费同价筛选'), '30000');
    await user.click(screen.getByRole('button', { name: '控球后卫' }));
    expect(screen.getByRole('heading', { name: '林泽宇' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '周启明' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '加入对比 陈宇航' }));
    await user.click(screen.getByRole('button', { name: '加入对比 林泽宇' }));
    await user.click(screen.getByRole('link', { name: '开始对比' }));
    const table = await screen.findByRole('table');
    const totals = within(table).getByRole('row', { name: /预计合计（含平台与交通食宿）/ });
    expect(within(totals).getByText('¥330.00')).toBeVisible();
    expect(within(totals).getByText('¥410.00')).toBeVisible();
    await waitFor(() =>
      expect(within(table).getByRole('row', { name: /个人统计场次/ })).toHaveTextContent('5场3场'),
    );
    expect(screen.getByText(/不是按实际出场时间计算/)).toBeVisible();
    expect(screen.queryByText('能力总分')).not.toBeInTheDocument();
  });
  it('最多选择3人，第四位不能进入比较', async () => {
    const booking = createDemoBookingRepository();
    app('/players', booking, createDemoPerformanceRepository(booking));
    await screen.findByRole('heading', { name: '陈宇航' });
    const user = userEvent.setup();
    for (const name of ['陈宇航', '林泽宇', '周启明'])
      await user.click(screen.getByRole('button', { name: `加入对比 ${name}` }));
    await user.click(screen.getByRole('button', { name: '加入对比 梁泽阳' }));
    expect(screen.getByRole('alert')).toHaveTextContent('最多比较3名球员');
    expect(screen.getByText('球员对比 3/3')).toBeVisible();
    expect(screen.getByRole('button', { name: '加入对比 梁泽阳' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('TEAM_ONLY显示未统计，PLAYER_BASIC的真实0仍显示0并附当前确认来源', async () => {
    const booking = createDemoBookingRepository(),
      base = createDemoPerformanceRepository(booking);
    const data: PlayerPerformanceData = {
      ...emptyPerformance('profile'),
      dataStatus: 'PARTIAL',
      sourceCount: 1,
      confirmedMatchCount: 2,
      recordedMatchCount: 1,
      teamOnlyMatchCount: 1,
      totalPoints: 0,
      totalFouls: 0,
      pointsPerRecordedMatch: 0,
      foulsPerRecordedMatch: 0,
      recentRecords: [
        {
          recordKey: 'zero',
          eventName: '真实0示例杯',
          date: '2026-10-20',
          format: 'ROUND_ROBIN',
          collectionMode: 'PLAYER_BASIC',
          attributionComplete: true,
          points: 0,
          fouls: 0,
          source: 'INDEPENDENT_CONFIRMATION',
        },
        {
          recordKey: 'team-only',
          eventName: '仅球队示例杯',
          date: '2026-10-19',
          format: 'ROUND_ROBIN',
          collectionMode: 'TEAM_ONLY',
          attributionComplete: null,
          points: null,
          fouls: null,
          source: 'INDEPENDENT_CONFIRMATION',
        },
      ],
    };
    const performance = {
      ...base,
      performances: async () => ({ players: [data], unavailableProfileIds: [] }),
    };
    render(
      <PerformanceProvider repository={performance} viewerUserId="viewer" demo={false}>
        <PlayerPerformanceDetails profileId="profile" />
      </PerformanceProvider>,
    );
    const row = await screen.findByRole('row', { name: /真实0示例杯/ });
    expect(within(row).getAllByText('0')).toHaveLength(2);
    const missing = screen.getByRole('row', { name: /仅球队示例杯/ });
    expect(within(missing).getAllByText('未统计')).toHaveLength(2);
    expect(within(row).getByText('有效独立确认')).toBeVisible();
    expect(screen.getByText(/不代表实际出场次数或上场时间/)).toBeVisible();
    expect(screen.getByText('助攻：未统计')).toBeVisible();
  });
  it('数据读取失败不使用合成统计或0补齐', async () => {
    const booking = createDemoBookingRepository(),
      base = createDemoPerformanceRepository(booking);
    render(
      <PerformanceProvider
        repository={{
          ...base,
          performances: async () => {
            throw new Error('授权统计服务断开');
          },
        }}
        viewerUserId="viewer"
        demo={false}
      >
        <PlayerPerformanceDetails profileId="profile" />
      </PerformanceProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('授权统计服务断开');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('撤销本人公开授权后，当前展示的统计被重新读取并清除', async () => {
    const booking = createDemoBookingRepository();
    booking.setRole('player');
    const data = await booking.repository.workspace(),
      performance = createDemoPerformanceRepository(booking);
    const command = vi.spyOn(performance, 'command');
    render(
      <BrowserRouter>
        <PerformanceProvider repository={performance} viewerUserId={data.viewerUserId} demo={false}>
          <DataAuthorizations bookingData={data} ownOnly />
          <PlayerPerformanceDetails profileId="demo-guard" />
        </PerformanceProvider>
      </BrowserRouter>,
    );
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '撤销公开授权' }));
    const dialog = screen.getByRole('dialog', { name: '撤销公开授权' });
    await user.type(within(dialog).getByLabelText('处理原因'), '本人撤销公开');
    await user.click(within(dialog).getByRole('button', { name: '确认处理' }));
    expect(await screen.findByRole('heading', { name: '暂无可展示的个人比赛记录' })).toBeVisible();
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]?.[1]).toMatchObject({ type: 'REVOKE', expectedVersion: 1 });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect((await performance.performance('demo-guard')).sourceCount).toBe(0);
  });
  it('本人必须主动确认公开范围，平台运营身份不能提名主办方数据', async () => {
    const booking = createDemoBookingRepository();
    booking.setRole('player');
    const data = await booking.repository.workspace(),
      performance = createDemoPerformanceRepository(booking),
      command = vi.spyOn(performance, 'command');
    const view = render(
      <BrowserRouter>
        <PerformanceProvider repository={performance} viewerUserId={data.viewerUserId} demo={false}>
          <DataAuthorizations bookingData={data} ownOnly />
        </PerformanceProvider>
      </BrowserRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '核对本人记录并同意公开' }));
    const dialog = screen.getByRole('dialog', { name: '核对并同意公开本人记录' });
    await user.type(within(dialog).getByLabelText('处理原因'), '本人核对同意');
    await user.click(within(dialog).getByRole('button', { name: '确认处理' }));
    expect(command).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('明确确认本人身份与公开范围');
    await user.click(within(dialog).getByRole('checkbox', { name: /我确认这是本人的参赛记录/ }));
    await user.click(within(dialog).getByRole('button', { name: '确认处理' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command.mock.calls[0]?.[1]).toMatchObject({ type: 'CONSENT', playerConsent: true });
    view.unmount();
    booking.setRole('operator');
    const operator = await booking.repository.workspace();
    render(
      <BrowserRouter>
        <PerformanceProvider
          repository={performance}
          viewerUserId={operator.viewerUserId}
          demo={false}
        >
          <DataAuthorizations bookingData={operator} />
        </PerformanceProvider>
      </BrowserRouter>,
    );
    expect(await screen.findByText(/当前没有可管理数据授权的赛事/)).toBeVisible();
    expect(screen.queryByLabelText('固定报名名单成员')).not.toBeInTheDocument();
  });
  it('广场每页最多20人，翻页仅读取当前可见的有限批量', async () => {
    const booking = createDemoBookingRepository(),
      data = await booking.repository.workspace(),
      base = createDemoPerformanceRepository(booking);
    data.players = Array.from({ length: 25 }, (_, i) => ({
      ...data.players[0]!,
      id: `profile-${i}`,
      displayName: `球员${String(i).padStart(2, '0')}`,
    }));
    const batch = vi
      .fn<PlayerPerformanceRepository['performances']>()
      .mockImplementation(async (ids) => ({
        players: ids.map((id) => emptyPerformance(id)),
        unavailableProfileIds: [],
      }));
    window.history.replaceState({}, '', '/players');
    render(
      <BrowserRouter>
        <BookingPage
          repository={{ ...booking.repository, workspace: async () => data }}
          performanceRepository={{ ...base, performances: batch }}
        />
      </BrowserRouter>,
    );
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(batch.mock.calls[0]?.[0]).toHaveLength(20);
    await userEvent.setup().click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    expect(batch.mock.calls[1]?.[0]).toHaveLength(5);
  });
  it('同一授权组件切换viewer时销毁旧确认表单，不沿用本人同意草稿', async () => {
    const booking = createDemoBookingRepository();
    booking.setRole('player');
    const player = await booking.repository.workspace();
    const performance = createDemoPerformanceRepository(booking),
      command = vi.spyOn(performance, 'command');
    const view = render(
      <BrowserRouter>
        <PerformanceProvider
          repository={performance}
          viewerUserId={player.viewerUserId}
          demo={false}
        >
          <DataAuthorizations bookingData={player} />
        </PerformanceProvider>
      </BrowserRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '核对本人记录并同意公开' }));
    await user.type(screen.getByLabelText('处理原因'), '尚未提交的本人草稿');
    booking.setRole('operator');
    const operator = await booking.repository.workspace();
    view.rerender(
      <BrowserRouter>
        <PerformanceProvider
          repository={performance}
          viewerUserId={operator.viewerUserId}
          demo={false}
        >
          <DataAuthorizations bookingData={operator} />
        </PerformanceProvider>
      </BrowserRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('尚未提交的本人草稿')).not.toBeInTheDocument();
    expect(await screen.findByText(/当前没有可管理数据授权的赛事/)).toBeVisible();
    expect(command).not.toHaveBeenCalled();
  });
  it('主办方仅用授权赛事固定名单提名，提交本身不公开记录', async () => {
    const booking = createDemoBookingRepository();
    booking.setRole('publisher');
    const performance = createDemoPerformanceRepository(booking),
      nominate = vi.spyOn(performance, 'nominate');
    app('/player-data', booking, performance);
    const member = await screen.findByLabelText('固定报名名单成员');
    const user = userEvent.setup();
    await waitFor(() => expect(member).not.toBeDisabled());
    await user.selectOptions(member, 'demo-team:demo-member-guard');
    await user.selectOptions(screen.getByLabelText('提名到球员档案'), 'demo-guard');
    await user.type(screen.getByLabelText('提名依据与原因'), '已核对本人固定报名名单');
    await user.click(screen.getByRole('checkbox', { name: /我确认有权提供该赛事成员的有限统计/ }));
    await user.click(screen.getByRole('button', { name: '提名给球员本人确认' }));
    expect(await screen.findByRole('heading', { name: '社区友谊赛（合成）' })).toBeVisible();
    expect(nominate).toHaveBeenCalledTimes(1);
    expect(nominate.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'demo-org',
      eventId: 'demo-publication-event',
      teamId: 'demo-team',
      memberId: 'demo-member-guard',
      profileId: 'demo-guard',
      publisherConsent: true,
    });
    expect((await performance.performance('demo-guard')).sourceCount).toBe(1);
  });
});

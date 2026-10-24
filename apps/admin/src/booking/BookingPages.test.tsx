// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingPage, OrderDetails, Operations } from './BookingPages';
import { createDemoBookingRepository } from './demo';
import type { BookingRepository } from './model';
import { ApiError } from '../api/client';
function mount(path: string, repository: BookingRepository) {
  window.history.replaceState({}, '', path);
  return render(
    <BrowserRouter>
      <BookingPage repository={repository} />
    </BrowserRouter>,
  );
}
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fillBooking() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('赛事或合作名称'), '组件验证邀请赛');
  await user.type(screen.getByLabelText('比赛地点'), '隔离测试球场');
  await user.click(screen.getByRole('checkbox', { name: /我已核对赛事外援/ }));
  await user.click(screen.getByRole('checkbox', { name: /我已阅读预约、变更/ }));
  return user;
}
describe('球员预约功能UI', () => {
  it('按位置和姓名筛选，不显示待审核球员', async () => {
    const demo = createDemoBookingRepository();
    mount('/players', demo.repository);
    expect(await screen.findByRole('heading', { name: '陈宇航' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '许嘉俊' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '中锋' }));
    expect(screen.getByRole('heading', { name: '周启明' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '陈宇航' })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('textbox', { name: '搜索球员' }), '不存在');
    expect(screen.getByRole('heading', { name: '暂时没有符合条件的球员' })).toBeVisible();
  });
  it('多场条件意向与确定报价分开，创建后读取真实订单详情', async () => {
    const demo = createDemoBookingRepository();
    const create = vi.spyOn(demo.repository, 'create');
    mount('/player-bookings/new?playerId=demo-guard', demo.repository);
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: /整届赛事/ }));
    await user.click(screen.getByRole('button', { name: '添加场次' }));
    const venues = screen.getAllByLabelText('比赛地点');
    await user.type(venues[1]!, '晋级后测试球场');
    const checkboxes = screen.getAllByRole('checkbox', { name: '待晋级 / 条件场次' });
    await user.click(checkboxes[1]!);
    expect(screen.getByText('另有 1 场条件意向')).toBeVisible();
    expect(screen.getByText('预计 ¥330.00')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0]![0];
    expect(input.reviewedSettingsVersion).toBe(1);
    expect(input.reviewedProfileVersions).toEqual({ 'demo-guard': 1 });
    expect(input.appearances).toHaveLength(2);
    expect(input.appearances[1]?.conditional).toBe(true);
    expect(input.appearances[1]?.startAt).toBeUndefined();
    expect(screen.getByRole('button', { name: '线上支付暂未开放' })).toBeDisabled();
    expect(screen.getByText(/资格仅由双方声明/)).toBeVisible();
  });
  it('服务读取失败不回退演示球员', async () => {
    const demo = createDemoBookingRepository();
    const repository = {
      ...demo.repository,
      workspace: vi.fn().mockRejectedValue(new Error('真实预约服务不可用')),
    };
    mount('/players', repository);
    expect(await screen.findByRole('alert')).toHaveTextContent('真实预约服务不可用');
    expect(screen.queryByRole('heading', { name: '陈宇航' })).not.toBeInTheDocument();
  });
  it('详情按ID单独读取，不依赖最近订单列表', async () => {
    const demo = createDemoBookingRepository();
    const workspace = await demo.repository.workspace();
    const get = vi.spyOn(demo.repository, 'get');
    mount('/player-bookings/demo-series', {
      ...demo.repository,
      workspace: async () => ({ ...workspace, orders: [], ordersHasMore: true }),
    });
    expect(await screen.findByRole('heading', { name: '青锋杯（示例）' })).toBeVisible();
    expect(get).toHaveBeenCalledWith('demo-series');
  });
  it('球员接单须主动确认资格声明，命令使用逐场版本', async () => {
    const demo = createDemoBookingRepository();
    demo.setRole('player');
    const command = vi.spyOn(demo.repository, 'command');
    mount('/player-bookings/demo-series', demo.repository);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '接受本场预约' }));
    const dialog = screen.getByRole('dialog', { name: '接受本场预约' });
    await user.click(within(dialog).getByRole('button', { name: '确认操作' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请确认本场合作与资格声明');
    expect(command).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox', { name: /我已核对本场合作信息/ }));
    await user.click(within(dialog).getByRole('button', { name: '确认操作' }));
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]![1]).toMatchObject({
      type: 'ACCEPT',
      eligibilityConfirmed: true,
      expectedVersion: 1,
    });
  });
  it('报价冲突保留表单，刷新后仍需用户重新勾选确认', async () => {
    const demo = createDemoBookingRepository();
    const create = vi
      .spyOn(demo.repository, 'create')
      .mockRejectedValueOnce(new ApiError(409, 'QUOTE_CHANGED', '报价已变化，请重新核对'));
    mount('/player-bookings/new?playerId=demo-guard', demo.repository);
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('报价已变化');
    expect(screen.getByLabelText('赛事或合作名称')).toHaveValue('组件验证邀请赛');
    await user.click(screen.getByRole('button', { name: '重新读取最新报价' }));
    expect(await screen.findByRole('status')).toHaveTextContent('最新报价已读取');
    expect(screen.getByRole('checkbox', { name: /我已阅读预约、变更/ })).not.toBeChecked();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('非平台账号访问运营页面只显示无权，不显示费率配置', async () => {
    const demo = createDemoBookingRepository();
    mount('/player-bookings-admin', demo.repository);
    expect(await screen.findByRole('heading', { name: '当前没有平台运营权限' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存新订单费率' })).not.toBeInTheDocument();
  });
  it('球员可主动刷新新预约，编辑资料期间禁用刷新以保留未保存输入', async () => {
    const demo = createDemoBookingRepository();
    demo.setRole('player');
    const data = await demo.repository.workspace();
    const workspace = vi
      .fn()
      .mockResolvedValueOnce({ ...data, orders: [] })
      .mockResolvedValue(data);
    mount('/player-center', { ...demo.repository, workspace });
    expect(await screen.findByRole('heading', { name: '暂时没有收到预约' })).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '刷新预约' }));
    expect(await screen.findByRole('heading', { name: '青锋杯（示例）' })).toBeVisible();
    expect(workspace).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: '编辑入驻资料' }));
    expect(screen.getByRole('button', { name: '刷新预约' })).toBeDisabled();
    const input = screen.getByLabelText('公开球员名称');
    await user.clear(input);
    await user.type(input, '未保存的新名称');
    expect(input).toHaveValue('未保存的新名称');
    expect(workspace).toHaveBeenCalledTimes(2);
  });
  it('同一详情组件切换操作者刷新能力，接单成功后独立刷新场次状态', async () => {
    const demo = createDemoBookingRepository();
    const buyer = await demo.repository.workspace();
    const player = buyer.players[0]!;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 12);
    start.setUTCHours(12, 0, 0, 0);
    const order = await demo.repository.create({
      commandId: crypto.randomUUID(),
      orgId: 'demo-org',
      teamId: 'demo-team',
      eventName: '能力刷新验证赛',
      scope: 'SINGLE',
      eligibilityConfirmed: true,
      reviewedSettingsVersion: buyer.settings.version,
      reviewedProfileVersions: { [player.id]: player.version },
      appearances: [
        {
          profileId: player.id,
          label: '接单能力验证',
          conditional: false,
          venue: '验证球场',
          reportAt: new Date(start.getTime() - 30 * 60000).toISOString(),
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + 90 * 60000).toISOString(),
        },
      ],
    });
    const get = vi.spyOn(demo.repository, 'get');
    const reload = vi.fn();
    const view = render(
      <BrowserRouter>
        <OrderDetails
          data={buyer}
          repository={demo.repository}
          id={order.id}
          reload={reload}
          demo={false}
        />
      </BrowserRouter>,
    );
    expect(await screen.findByRole('button', { name: '取消本场' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '接受本场预约' })).not.toBeInTheDocument();
    demo.setRole('player');
    const actor = await demo.repository.workspace();
    view.rerender(
      <BrowserRouter>
        <OrderDetails
          data={actor}
          repository={demo.repository}
          id={order.id}
          reload={reload}
          demo={false}
        />
      </BrowserRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '接受本场预约' }));
    const dialog = screen.getByRole('dialog', { name: '接受本场预约' });
    await user.click(within(dialog).getByRole('checkbox', { name: /我已核对本场合作信息/ }));
    await user.click(within(dialog).getByRole('button', { name: '确认操作' }));
    expect(await screen.findByText('球员已接单')).toBeVisible();
    expect(screen.queryByRole('button', { name: '接受本场预约' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('同一运营组件可连续更改费率，每次成功后采用新命令编号并重新确认', async () => {
    const demo = createDemoBookingRepository();
    demo.setRole('operator');
    const first = await demo.repository.workspace();
    const updateFee = vi.spyOn(demo.repository, 'updateFee');
    const reload = vi.fn();
    const view = render(
      <BrowserRouter>
        <Operations data={first} repository={demo.repository} reload={reload} />
      </BrowserRouter>,
    );
    const user = userEvent.setup();
    const field = screen.getByLabelText('新订单费率（%）');
    await user.clear(field);
    await user.type(field, '11');
    await user.click(screen.getByRole('checkbox', { name: '确认仅影响后续新订单' }));
    await user.click(screen.getByRole('button', { name: '保存新订单费率' }));
    await waitFor(() => expect(updateFee).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('checkbox', { name: '确认仅影响后续新订单' })).not.toBeChecked();
    const second = await demo.repository.workspace();
    view.rerender(
      <BrowserRouter>
        <Operations data={second} repository={demo.repository} reload={reload} />
      </BrowserRouter>,
    );
    expect(screen.getByLabelText('新订单费率（%）')).toBe(field);
    await user.clear(field);
    await user.type(field, '12');
    await user.click(screen.getByRole('checkbox', { name: '确认仅影响后续新订单' }));
    await user.click(screen.getByRole('button', { name: '保存新订单费率' }));
    await waitFor(() => expect(updateFee).toHaveBeenCalledTimes(2));
    expect(updateFee.mock.calls[0]?.slice(0, 2)).toEqual([1, 1100]);
    expect(updateFee.mock.calls[1]?.slice(0, 2)).toEqual([2, 1200]);
    expect(updateFee.mock.calls[0]?.[2]).not.toBe(updateFee.mock.calls[1]?.[2]);
    expect((await demo.repository.workspace()).settings.feeBps).toBe(1200);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

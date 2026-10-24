// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingPage, OrderDetails, Operations } from './BookingPages';
import { createDemoBookingRepository } from './demo';
import type { BookingRepository } from './model';
import { ApiError } from '../api/client';
import {
  BOOKING_RECOVERY_STORAGE_PREFIX,
  bookingRecoveryStore,
  createBookingRecoveryStore,
} from './recovery-store';
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
  sessionStorage.clear();
  useRecoveryStore(createBookingRecoveryStore());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function useRecoveryStore(store: ReturnType<typeof createBookingRecoveryStore>) {
  vi.spyOn(bookingRecoveryStore, 'load').mockImplementation(store.load);
  vi.spyOn(bookingRecoveryStore, 'save').mockImplementation(store.save);
  vi.spyOn(bookingRecoveryStore, 'discard').mockImplementation(store.discard);
  vi.spyOn(bookingRecoveryStore, 'acknowledgeInvalid').mockImplementation(store.acknowledgeInvalid);
}
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
  it.each([
    [0, 'NETWORK_ERROR'],
    [503, 'HTTP_503'],
    [422, 'HTTP_422'],
    [200, 'INVALID_RESPONSE'],
  ])('创建已提交但ACK丢失（%s/%s）时保持原条件单请求并可恢复', async (status, code) => {
    const demo = createDemoBookingRepository();
    const originalCreate = demo.repository.create;
    let loseResponse = true;
    const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
      const result = await originalCreate(input);
      if (loseResponse) {
        loseResponse = false;
        throw new ApiError(Number(status), String(code), '预约响应未收到');
      }
      return result;
    });
    const repository = { ...demo.repository, create };
    mount('/player-bookings/new?playerId=demo-guard', repository);
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: /整届赛事/ }));
    await user.click(screen.getByRole('checkbox', { name: '待晋级 / 条件场次' }));
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '重新读取最新报价' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('赛事或合作名称')).not.toBeInTheDocument();
    const sent = structuredClone(create.mock.calls[0]![0]);
    expect(sent.appearances).toHaveLength(1);
    expect(sent.appearances[0]?.conditional).toBe(true);
    expect(
      (await demo.repository.workspace()).orders.filter(
        (order) => order.eventName === '组件验证邀请赛',
      ),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toEqual(sent);
    expect(create.mock.calls[1]![0].commandId).toBe(sent.commandId);
    expect(
      (await demo.repository.workspace()).orders.filter(
        (order) => order.eventName === '组件验证邀请赛',
      ),
    ).toHaveLength(1);
  });

  it('换viewer不展示或提交旧请求，原actor返回后可查看迟到成功的原单', async () => {
    const demo = createDemoBookingRepository();
    const buyer = await demo.repository.workspace();
    let workspace = buyer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
      const result = await demo.repository.create(input);
      await gate;
      return result;
    });
    const repository: BookingRepository = {
      ...demo.repository,
      workspace: async () => workspace,
      create,
    };
    window.history.replaceState({}, '', '/player-bookings/new?playerId=demo-guard');
    const view = render(
      <BrowserRouter>
        <BookingPage repository={repository} />
      </BrowserRouter>,
    );
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('group', { name: '预约内容' })).toBeDisabled();
    workspace = { ...buyer, viewerUserId: 'another-viewer', teams: [], orders: [] };
    view.rerender(
      <BrowserRouter>
        <BookingPage repository={{ ...repository }} />
      </BrowserRouter>,
    );
    expect(await screen.findByRole('heading', { name: '当前账号没有可下单的球队' })).toBeVisible();
    release();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '组件验证邀请赛' })).not.toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe('/player-bookings/new');
    expect(screen.queryByRole('button', { name: '恢复原请求结果' })).not.toBeInTheDocument();
    workspace = buyer;
    view.rerender(
      <BrowserRouter>
        <BookingPage repository={{ ...repository }} />
      </BrowserRouter>,
    );
    expect(await screen.findByRole('heading', { name: '原预约已创建，请查看结果' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '查看原预约' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('首次在途离开并返回不并发重发，原请求提交丢ACK后429也不丢恢复编号', async () => {
    const demo = createDemoBookingRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn<BookingRepository['create']>();
    create.mockImplementation(async (input) => {
      if (create.mock.calls.length === 1) {
        await gate;
        await demo.repository.create(input);
        throw new ApiError(0, 'NETWORK_ERROR', '首发响应丢失');
      }
      if (create.mock.calls.length === 2)
        throw new ApiError(429, 'RATE_LIMITED', '请稍后核对原请求');
      return demo.repository.create(input);
    });
    mount('/player-bookings/new?playerId=demo-guard', { ...demo.repository, create });
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: /整届赛事/ }));
    await user.click(screen.getByRole('checkbox', { name: '待晋级 / 条件场次' }));
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    await act(async () => {
      window.history.pushState({}, '', '/player-bookings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => {
      window.history.pushState({}, '', '/player-bookings/new?playerId=demo-guard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await user.click(await screen.findByRole('button', { name: '恢复原请求结果' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('原请求仍在处理中');
    await act(async () => {
      release();
      await expect(create.mock.results[0]!.value).rejects.toThrow('首发响应丢失');
    });
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请稍后核对原请求');
    expect(screen.queryByRole('button', { name: '重新读取最新报价' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('赛事或合作名称')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
    expect(create.mock.calls[2]![0]).toEqual(create.mock.calls[0]![0]);
    expect(
      (await demo.repository.workspace()).orders.filter((o) => o.eventName === '组件验证邀请赛'),
    ).toHaveLength(1);
  });

  it('反向race首发明确429前禁止恢复并发，拒绝终态回到重新审阅而非复活旧请求', async () => {
    const demo = createDemoBookingRepository();
    let rejectFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      rejectFirst = resolve;
    });
    const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
      if (create.mock.calls.length === 1) {
        await gate;
        throw new ApiError(429, 'RATE_LIMITED', '首发未被接受');
      }
      return demo.repository.create(input);
    });
    mount('/player-bookings/new?playerId=demo-guard', { ...demo.repository, create });
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    await act(async () => {
      window.history.pushState({}, '', '/player-bookings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => {
      window.history.pushState({}, '', '/player-bookings/new?playerId=demo-guard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await user.click(await screen.findByRole('button', { name: '恢复原请求结果' }));
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectFirst();
      await expect(create.mock.results[0]!.value).rejects.toThrow('首发未被接受');
    });
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByLabelText('赛事或合作名称')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('原请求已明确拒绝');
    expect(create).toHaveBeenCalledTimes(1);
    const nextUser = await fillBooking();
    await nextUser.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0].commandId).not.toBe(create.mock.calls[0]![0].commandId);
    expect(
      (await demo.repository.workspace()).orders.filter((o) => o.eventName === '组件验证邀请赛'),
    ).toHaveLength(1);
  });
  it('API请求先保存原编号，刷新重建内存后只主动恢复同一条件单且重验球队授权', async () => {
    const demo = createDemoBookingRepository();
    const buyer = await demo.repository.workspace();
    const storageKey = `${BOOKING_RECOVERY_STORAGE_PREFIX}${encodeURIComponent(buyer.viewerUserId)}`;
    const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
      expect(JSON.parse(sessionStorage.getItem(storageKey)!).payload).toBe(JSON.stringify(input));
      const result = await demo.repository.create(input);
      if (create.mock.calls.length === 1)
        throw new ApiError(0, 'NETWORK_ERROR', '已写入但未收到回执');
      return result;
    });
    let workspace = buyer;
    const repository = { ...demo.repository, workspace: async () => workspace, create };
    const firstView = mount('/player-bookings/new?playerId=demo-guard', repository);
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: /整届赛事/ }));
    await user.click(screen.getByRole('checkbox', { name: '待晋级 / 条件场次' }));
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
    const original = structuredClone(create.mock.calls[0]![0]);
    firstView.unmount();
    // Rebuilding the store with the same sessionStorage models a fresh page module,
    // so neither the in-memory entry nor its runtime state can supply recovery.
    const freshStore = createBookingRecoveryStore();
    useRecoveryStore(freshStore);
    expect(freshStore.load('api', 'other-viewer').entry).toBeNull();
    expect(freshStore.load('demo', buyer.viewerUserId).entry).toBeNull();
    workspace = { ...buyer, teams: [] };
    const refreshedView = mount('/player-bookings/new?playerId=demo-guard', repository);
    expect(await screen.findByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('当前账号已无原球队授权');
    expect(screen.queryByText('原赛事：组件验证邀请赛')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复原请求结果' })).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    workspace = buyer;
    refreshedView.rerender(
      <BrowserRouter>
        <BookingPage repository={{ ...repository }} />
      </BrowserRouter>,
    );
    expect(await screen.findByRole('button', { name: '恢复原请求结果' })).toBeEnabled();
    expect(create).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toEqual(original);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(
      (await demo.repository.workspace()).orders.filter((o) => o.eventName === '组件验证邀请赛'),
    ).toHaveLength(1);
  });

  it('损坏恢复内容不提交，返回创建页仍先核对订单并明确确认后才能重新填写', async () => {
    const demo = createDemoBookingRepository();
    const buyer = await demo.repository.workspace();
    sessionStorage.setItem(
      `${BOOKING_RECOVERY_STORAGE_PREFIX}${encodeURIComponent(buyer.viewerUserId)}`,
      '{broken',
    );
    const create = vi.spyOn(demo.repository, 'create');
    mount('/player-bookings/new?playerId=demo-guard', demo.repository);
    expect(
      await screen.findByRole('heading', { name: '恢复编号无法读取，请先核对原预约' }),
    ).toBeVisible();
    expect(screen.queryByLabelText('赛事或合作名称')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: '先查看我的预约' }));
    await act(async () => {
      window.history.pushState({}, '', '/player-bookings/new?playerId=demo-guard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('button', { name: '继续重新填写' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /我已核对本人预约记录/ }));
    await user.click(screen.getByRole('button', { name: '继续重新填写' }));
    expect(await screen.findByLabelText('赛事或合作名称')).toBeVisible();
    expect(create).not.toHaveBeenCalled();
  });

  it('sessionStorage不可用时提示刷新风险，仍以原内存请求主动核对结果', async () => {
    useRecoveryStore(
      createBookingRecoveryStore(() => {
        throw new Error('Storage unavailable');
      }),
    );
    const demo = createDemoBookingRepository();
    const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
      const result = await demo.repository.create(input);
      if (create.mock.calls.length === 1) throw new ApiError(0, 'NETWORK_ERROR', '回执未收到');
      return result;
    });
    mount('/player-bookings/new?playerId=demo-guard', { ...demo.repository, create });
    expect(await screen.findByText(/刷新会丢恢复编号，请先查看原预约/)).toBeVisible();
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
    expect(screen.getByText(/刷新会丢恢复编号，请先查看原预约/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
    expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
    expect(
      (await demo.repository.workspace()).orders.filter((o) => o.eventName === '组件验证邀请赛'),
    ).toHaveLength(1);
  });
  it('移除损坏恢复标记失败时停留核对页并提示，恢复存储后才可继续填写', async () => {
    const demo = createDemoBookingRepository();
    const buyer = await demo.repository.workspace();
    sessionStorage.setItem(
      `${BOOKING_RECOVERY_STORAGE_PREFIX}${encodeURIComponent(buyer.viewerUserId)}`,
      '{broken',
    );
    let canRemove = false;
    const cache = createBookingRecoveryStore(
      () =>
        ({
          getItem: (key: string) => sessionStorage.getItem(key),
          setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
          removeItem: (key: string) => {
            if (!canRemove) throw new Error('Remove blocked');
            sessionStorage.removeItem(key);
          },
        }) as Storage,
    );
    useRecoveryStore(cache);
    const create = vi.spyOn(demo.repository, 'create');
    mount('/player-bookings/new?playerId=demo-guard', demo.repository);
    expect(
      await screen.findByRole('heading', { name: '恢复编号无法读取，请先核对原预约' }),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /我已核对本人预约记录/ }));
    await user.click(screen.getByRole('button', { name: '继续重新填写' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复标记无法移除');
    expect(screen.getByText(/刷新会丢恢复编号，请先查看原预约/)).toBeVisible();
    expect(screen.queryByLabelText('赛事或合作名称')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    canRemove = true;
    await user.click(screen.getByRole('button', { name: '继续重新填写' }));
    expect(await screen.findByLabelText('赛事或合作名称')).toBeVisible();
    expect(create).not.toHaveBeenCalled();
  });
  it('拒绝回执丢失后用原ID核对持久拒绝回执，重新审阅后才以新ID创建', async () => {
    const demo = createDemoBookingRepository();
    let rejectedId = '';
    const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
      if (!rejectedId) {
        rejectedId = input.commandId;
        // The server committed a REJECTED receipt, but this attempt lost its ACK.
        throw new ApiError(0, 'NETWORK_ERROR', '拒绝回执未收到');
      }
      if (input.commandId === rejectedId)
        throw new ApiError(409, 'EVENT_CLOSED', '原创建已拒绝，赛事已关闭', {
          bookingCreateOutcome: 'REJECTED',
          commandId: rejectedId,
        });
      return demo.repository.create(input);
    });
    mount('/player-bookings/new?playerId=demo-guard', { ...demo.repository, create });
    const user = await fillBooking();
    await user.click(screen.getByRole('button', { name: /整届赛事/ }));
    await user.click(screen.getByRole('checkbox', { name: '待晋级 / 条件场次' }));
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
    expect(await screen.findByLabelText('赛事或合作名称')).toHaveValue('组件验证邀请赛');
    expect(screen.getByRole('alert')).toHaveTextContent('原创建已拒绝');
    expect(screen.getByRole('checkbox', { name: /我已阅读预约、变更/ })).not.toBeChecked();
    expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
    expect(
      (await demo.repository.workspace()).orders.filter((o) => o.eventName === '组件验证邀请赛'),
    ).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '重新读取最新报价' }));
    expect(await screen.findByRole('status')).toHaveTextContent('最新报价已读取');
    await user.clear(screen.getByLabelText('赛事或合作名称'));
    await user.type(screen.getByLabelText('赛事或合作名称'), '重新审阅邀请赛');
    await user.click(screen.getByRole('checkbox', { name: /我已阅读预约、变更/ }));
    await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
    expect(await screen.findByRole('heading', { name: '重新审阅邀请赛' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2]![0].commandId).not.toBe(rejectedId);
    expect(
      (await demo.repository.workspace()).orders.filter((o) => o.eventName === '重新审阅邀请赛'),
    ).toHaveLength(1);
  });

  it.each([
    { status: 409, code: 'EVENT_CLOSED', marker: 'missing' },
    { status: 409, code: 'EVENT_CLOSED', marker: 'wrong-id' },
    { status: 409, code: 'QUOTE_CHANGED', marker: 'missing' },
    { status: 403, code: 'FORBIDDEN', marker: 'missing' },
    { status: 404, code: 'NOT_FOUND', marker: 'missing' },
    { status: 429, code: 'RATE_LIMITED', marker: 'missing' },
    { status: 422, code: 'HTTP_422', marker: 'missing' },
    { status: 503, code: 'SERVICE_UNAVAILABLE', marker: 'same-id' },
  ])(
    '恢复中的$status/$code（$marker）不能代替原创建终态，保留原成功单编号',
    async ({ status, code, marker }) => {
      const demo = createDemoBookingRepository();
      const create = vi.fn<BookingRepository['create']>().mockImplementation(async (input) => {
        if (create.mock.calls.length === 1) {
          await demo.repository.create(input);
          throw new ApiError(0, 'NETWORK_ERROR', '原成功回执未收到');
        }
        if (create.mock.calls.length === 2)
          throw new ApiError(
            status,
            code,
            '本次响应不能证明原创建已拒绝',
            marker === 'missing'
              ? undefined
              : {
                  bookingCreateOutcome: 'REJECTED',
                  commandId: marker === 'same-id' ? input.commandId : 'different-command-id',
                },
          );
        return demo.repository.create(input);
      });
      mount('/player-bookings/new?playerId=demo-guard', { ...demo.repository, create });
      const user = await fillBooking();
      await user.click(screen.getByRole('button', { name: /整届赛事/ }));
      await user.click(screen.getByRole('checkbox', { name: '待晋级 / 条件场次' }));
      await user.click(screen.getByRole('button', { name: '提交预约，等待球员确认' }));
      expect(await screen.findByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('本次响应不能证明原创建已拒绝');
      expect(screen.getByRole('heading', { name: '原预约结果待核对' })).toBeVisible();
      expect(screen.queryByRole('button', { name: '重新读取最新报价' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('赛事或合作名称')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '恢复原请求结果' }));
      expect(await screen.findByRole('heading', { name: '组件验证邀请赛' })).toBeVisible();
      expect(create).toHaveBeenCalledTimes(3);
      expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
      expect(create.mock.calls[2]![0]).toEqual(create.mock.calls[0]![0]);
      expect(
        (await demo.repository.workspace()).orders.filter((o) => o.eventName === '组件验证邀请赛'),
      ).toHaveLength(1);
    },
  );
});

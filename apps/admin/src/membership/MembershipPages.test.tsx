// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import type { SoftwareMembershipPeriodData } from '@small-city-basketball/contracts';
import { OrgMembershipPage, PlatformMembershipPage } from './MembershipPages';
import { businessPlan, order, period, plan, platformWorkspace, workspace } from './test-fixtures';
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,c3ludGhldGlj') },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const context = (client: ApiClient, organizationId = 'org-a', userId = 'owner-a') => ({
  client,
  organizationId,
  userId,
  onSessionRefresh: async () => {},
});
const envelope = (data: unknown) => ({ data, meta: { requestId: 'unit' } });
function org(request: ReturnType<typeof vi.fn>) {
  return render(
    <MemoryRouter>
      <OrgMembershipPage context={context({ request } as ApiClient)} />
    </MemoryRouter>,
  );
}
function platform(request: ReturnType<typeof vi.fn>, userId = 'operator-a') {
  return render(<PlatformMembershipPage client={{ request } as ApiClient} userId={userId} />);
}
const postCalls = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter((c) => c[1]?.method === 'POST');
describe('software membership responsive web (unit responses, no payment gateway)', () => {
  test('the independent platform route works without a Router and uses a full navigation anchor', async () => {
    const allocation = {
      eventId: 'event-a',
      eventName: '合成已激活赛事',
      orgId: 'org-a',
      periodId: period.id,
      source: 'MEMBERSHIP',
      participantCount: 8,
      expectedMatchCount: 32,
      activatedAt: workspace.serverTime,
    };
    const request = vi
      .fn()
      .mockResolvedValue(
        envelope({ ...platformWorkspace, periods: [period], allocations: [allocation] }),
      );
    platform(request);
    expect(await screen.findByRole('heading', { name: '平台会员运营' })).toBeVisible();
    expect(screen.getByRole('link', { name: '按届套餐' })).toHaveAttribute(
      'href',
      '/platform/commerce',
    );
    fireEvent.click(screen.getByRole('tab', { name: '购买期与用量' }));
    expect(screen.getByText('合成已激活赛事')).toBeVisible();
    expect(screen.queryByRole('link', { name: '合成已激活赛事' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: `${period.planName}购买期` })).toHaveTextContent(
      'org-a',
    );
  });
  test.each([401, 403, 503])(
    'the independent platform error %s renders without a Router',
    async (status) => {
      const request = vi
        .fn()
        .mockRejectedValue(
          new ApiError(status, status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', '合成读取失败'),
        );
      platform(request);
      expect(await screen.findByText('合成读取失败')).toBeVisible();
      const destination = screen.getByRole('link', {
        name: status === 401 ? '重新登录' : '返回工作台',
      });
      expect(destination).toHaveAttribute('href', status === 401 ? '/platform/membership' : '/');
    },
  );
  test('member form selectors have explicit accessible names independent of option text', async () => {
    const request = vi.fn().mockResolvedValue(envelope(platformWorkspace));
    platform(request);
    for (const label of ['建议会员模板', '会员等级', '购买期']) {
      expect(await screen.findByRole('combobox', { name: label })).toHaveAttribute(
        'aria-label',
        label,
      );
    }
  });
  test('older membership responses without a close capability do not offer a Native close action', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        envelope({ ...workspace, orders: [{ ...order, channel: 'WECHAT_NATIVE' }] }),
      );
    org(request);
    fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
    expect(screen.queryByRole('button', { name: '关闭微信付款' })).not.toBeInTheDocument();
  });
  test('the platform never offers the owner-only Native close action even if an unrelated capability is true', async () => {
    const request = vi.fn().mockResolvedValue(
      envelope({
        ...platformWorkspace,
        orders: [
          {
            ...order,
            channel: 'WECHAT_NATIVE',
            capabilities: { ...order.capabilities, canCloseNative: true },
          },
        ],
      }),
    );
    platform(request);
    fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
    expect(screen.queryByRole('button', { name: '关闭微信付款' })).not.toBeInTheDocument();
  });
  test.each(['PENDING_PAYMENT', 'CANCELLED', 'PAID'] as const)(
    'Native close displays only the verified original order result %s',
    async (status) => {
      const original = {
        ...order,
        channel: 'WECHAT_NATIVE' as const,
        capabilities: {
          ...order.capabilities,
          canCancel: false,
          canQueryPayment: true,
          canCloseNative: true,
        },
      };
      let resolved = false;
      const resultOrder = {
        ...original,
        status,
        paidAt: status === 'PAID' ? workspace.serverTime : null,
        version: 2,
        capabilities: { ...original.capabilities, canCloseNative: false },
      };
      const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          resolved = true;
          return envelope({
            order: resultOrder,
            nativePayment: null,
            notice:
              status === 'PENDING_PAYMENT'
                ? '关闭结果未知，请查询原订单，不要新下单'
                : '原订单结果已核对',
          });
        }
        return envelope({
          ...workspace,
          canPurchase: false,
          purchasablePlanIds: [],
          orders: [resolved ? resultOrder : original],
        });
      });
      org(request);
      fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
      fireEvent.click(screen.getByRole('button', { name: '关闭微信付款' }));
      const dialog = screen.getByRole('dialog', { name: '核对并关闭原扫码订单' });
      expect(within(dialog).getByText(/若关闭结果未知，请查询原单/)).toBeVisible();
      const confirm = within(dialog).getByRole('button', { name: '确认操作' });
      expect(confirm).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('操作原因'), {
        target: { value: '核对原未付扫码订单' },
      });
      fireEvent.click(confirm);
      const label =
        status === 'PENDING_PAYMENT' ? '待付款' : status === 'CANCELLED' ? '已取消' : '付款已核验';
      expect(await screen.findByText(label)).toBeVisible();
      expect(postCalls(request)).toHaveLength(1);
      expect(postCalls(request)[0][0]).toBe(
        '/v1/orgs/org-a/software-membership/orders/member-order-a/commands',
      );
      expect(JSON.parse(postCalls(request)[0][1].body)).toEqual({
        commandId: expect.any(String),
        type: 'CLOSE_NATIVE',
        expectedOrderVersion: 1,
        reason: '核对原未付扫码订单',
      });
      if (status === 'PENDING_PAYMENT') {
        expect(screen.getByText('关闭结果未知，请查询原订单，不要新下单')).toBeVisible();
        expect(screen.getByRole('button', { name: '查询付款结果' })).toBeVisible();
        expect(screen.queryByText('已取消')).not.toBeInTheDocument();
      }
    },
  );
  test('an empty close response is unknown and cannot become a locally cancelled order', async () => {
    const original = {
      ...order,
      channel: 'WECHAT_NATIVE',
      capabilities: { ...order.capabilities, canCancel: false, canCloseNative: true },
    };
    const request = vi
      .fn()
      .mockImplementation(async (_path: string, init?: RequestInit) =>
        envelope(init?.method === 'POST' ? undefined : { ...workspace, orders: [original] }),
      );
    org(request);
    fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭微信付款' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('操作原因'), {
      target: { value: '核对未付原单' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText('操作结果待核对');
    expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(screen.queryByText('已取消')).not.toBeInTheDocument();
    expect(postCalls(request)).toHaveLength(1);
  });

  test('checkout uses the published server price and requires explicit institution and quote confirmation before one request', async () => {
    const custom = { ...plan, amountFen: 123450 };
    const pendingOrder = { ...order, quote: { ...order.quote, amountFen: custom.amountFen } };
    let submitted = false;
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submitted = true;
        return envelope({ order: pendingOrder, nativePayment: null });
      }
      return envelope({
        ...workspace,
        plans: [custom],
        purchasablePlanIds: [custom.id],
        orders: submitted ? [pendingOrder] : [],
      });
    });
    org(request);
    fireEvent.click(await screen.findByRole('button', { name: '核对购买专业机构会员' }));
    const dialog = screen.getByRole('dialog', { name: '会员订单核对' });
    expect(within(dialog).getByText(/1,234.50/)).toBeVisible();
    expect(within(dialog).getByText('合成篮球工作室')).toBeVisible();
    expect(postCalls(request)).toHaveLength(0);
    const confirm = within(dialog).getByRole('button', { name: '确认操作' });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: '我已核对付费机构、金额、购买期和额度' }),
    );
    fireEvent.click(confirm);
    await screen.findByRole('heading', { name: '会员订单与核验' });
    expect(postCalls(request)).toHaveLength(1);
    const body = JSON.parse(postCalls(request)[0][1].body);
    expect(body).toEqual({
      commandId: expect.any(String),
      planId: custom.id,
      expectedMembershipVersion: workspace.membershipVersion,
    });
    expect(await screen.findByText('待付款')).toBeVisible();
    expect(screen.queryByText('付款已核验')).not.toBeInTheDocument();
    expect(screen.queryByText('生效中')).not.toBeInTheDocument();
  });
  test('changing the display period is local and only the server-authorized plan can be ordered', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(envelope({ ...workspace, purchasablePlanIds: [businessPlan.id] }));
    org(request);
    expect(await screen.findByRole('button', { name: '核对购买专业机构会员' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '核对购买商业机构会员' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '月付' }));
    expect(screen.getByRole('heading', { name: '合成专业机构月费' })).toBeVisible();
    expect(screen.getByRole('button', { name: '核对购买专业机构会员' })).toBeDisabled();
    expect(postCalls(request)).toHaveLength(0);
  });
  test('an unpublished catalog has no invented monthly purchase and OFF remains explicit', async () => {
    const request = vi.fn().mockResolvedValue(
      envelope({
        ...workspace,
        mode: 'OFF',
        canPurchase: false,
        plans: [],
        purchasablePlanIds: [],
      }),
    );
    org(request);
    expect(await screen.findByText('收费限制未启用')).toBeVisible();
    expect(screen.getByText('暂无该周期可售会员')).toBeVisible();
    expect(screen.queryByRole('button', { name: /核对购买/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '按届套餐' })).toHaveAttribute('href', '/commerce');
    expect(postCalls(request)).toHaveLength(0);
  });
  test('operator suggestions cancel without replacement and confirmed load preserves the reason without a POST', async () => {
    const request = vi.fn().mockResolvedValue(envelope(platformWorkspace));
    platform(request);
    await screen.findByRole('heading', { name: '创建会员套餐新版本' });
    fireEvent.change(screen.getByLabelText('套餐代码'), { target: { value: 'original_code' } });
    fireEvent.change(screen.getByLabelText('套餐名称'), { target: { value: '原本地草稿' } });
    fireEvent.change(screen.getByLabelText('发布原因'), { target: { value: '保留的发布说明' } });
    fireEvent.change(screen.getByLabelText('建议会员模板'), {
      target: { value: 'scb_business_year' },
    });
    fireEvent.click(screen.getByRole('button', { name: '载入会员建议' }));
    let dialog = screen.getByRole('dialog', { name: '确认覆盖本地会员草稿' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.getByLabelText('套餐名称')).toHaveValue('原本地草稿');
    fireEvent.click(screen.getByRole('button', { name: '载入会员建议' }));
    dialog = screen.getByRole('dialog', { name: '确认覆盖本地会员草稿' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    expect(screen.getByLabelText('套餐名称')).toHaveValue('小城市·商业机构年费');
    expect(screen.getByLabelText('价格（元）')).toHaveValue('3399');
    expect(screen.getByLabelText('发布原因')).toHaveValue('保留的发布说明');
    expect(postCalls(request)).toHaveLength(0);
  });
  test('publishing a member plan needs another confirmation and sends edited cents and fixed tier, not client quota', async () => {
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? envelope({
            plan: {
              ...businessPlan,
              id: 'new-plan',
              amountFen: 123456,
              code: 'custom_business',
              name: '合成新版本',
            },
          })
        : envelope(platformWorkspace),
    );
    platform(request);
    await screen.findByRole('heading', { name: '创建会员套餐新版本' });
    for (const [label, value] of [
      ['套餐代码', 'custom_business'],
      ['套餐名称', '合成新版本'],
      ['价格（元）', '1234.56'],
      ['发布原因', '核对后的合成发布原因'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText('会员等级'), { target: { value: 'BUSINESS' } });
    fireEvent.click(screen.getByRole('button', { name: '核对并发布会员套餐' }));
    const dialog = screen.getByRole('dialog', { name: '发布不可变会员套餐' });
    expect(within(dialog).getByText(/120届/)).toBeVisible();
    expect(postCalls(request)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(postCalls(request)).toHaveLength(1));
    expect(JSON.parse(postCalls(request)[0][1].body)).toEqual({
      commandId: expect.any(String),
      code: 'custom_business',
      name: '合成新版本',
      amountFen: 123456,
      currency: 'CNY',
      tier: 'BUSINESS',
      durationDays: 365,
      reason: '核对后的合成发布原因',
    });
  });
  test.each(['0', '-1', '1.001', '1e3', '1000000.01'])(
    'invalid monetary draft %s does not create an immutable plan',
    async (price) => {
      const request = vi.fn().mockResolvedValue(envelope(platformWorkspace));
      platform(request);
      await screen.findByLabelText('套餐代码');
      for (const [label, value] of [
        ['套餐代码', 'valid_code'],
        ['套餐名称', '合成计划'],
        ['价格（元）', price],
        ['发布原因', '合成发布原因'],
      ])
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.submit(screen.getByRole('button', { name: '核对并发布会员套餐' }).closest('form')!);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(postCalls(request)).toHaveLength(0);
    },
  );
  test('period quantity is the full server count and truncated history never masquerades as zero usage', async () => {
    const request = vi.fn().mockResolvedValue(
      envelope({
        ...workspace,
        periods: [period],
        historyTruncated: { plans: true, orders: true, periods: true, allocations: true },
      }),
    );
    org(request);
    await screen.findByRole('heading', { name: '机构会员方案' });
    expect(screen.getByText(/仅展示最近100条会员套餐版本/)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '购买期与用量' }));
    const card = screen.getByRole('article', { name: `${period.planName}购买期` });
    expect(card).toHaveTextContent('24 / 36 届可用');
    expect(card).toHaveTextContent('12届，来自服务端全期统计');
    expect(screen.getByText(/不能将当前显示条数当作已用总额/)).toBeVisible();
    expect(screen.getByText(/每期已用与剩余是服务端全期统计/)).toBeVisible();
  });
  test.each([
    ['EXPIRED', '购买期已到期', { serverTime: period.endsAt }, {}],
    ['EXHAUSTED', '本期额度已用尽', {}, { remainingEvents: 0, usedEvents: 36 }],
    [
      'SCHEDULED',
      '下一购买期，尚未生效',
      {},
      {
        startsAt: '2027-11-01T00:00:00Z',
        endsAt: '2028-10-31T00:00:00Z',
        usedEvents: 0,
        remainingEvents: 36,
      },
    ],
    ['REFUND_PENDING', '退款核验中，暂停新激活', {}, { usedEvents: 0, remainingEvents: 36 }],
    [
      'REVOKED',
      '退款后已撤销',
      {},
      { revokedAt: workspace.serverTime, usedEvents: 0, remainingEvents: 36 },
    ],
    ['UNAVAILABLE', '当前不可新激活', {}, {}],
  ] as const)(
    'renders authoritative period state %s without upgrading access',
    async (state, label, workspaceDelta, periodDelta) => {
      const p = { ...period, ...periodDelta, state } as SoftwareMembershipPeriodData;
      const request = vi.fn().mockResolvedValue(
        envelope({
          ...workspace,
          ...workspaceDelta,
          canPurchase: false,
          purchasablePlanIds: [],
          periods: [p],
        }),
      );
      org(request);
      await screen.findByRole('heading', { name: '机构会员方案' });
      fireEvent.click(screen.getByRole('tab', { name: '购买期与用量' }));
      const card = screen.getByRole('article', { name: `${period.planName}购买期` });
      expect(within(card).getByText(label)).toBeVisible();
      expect(card).toHaveTextContent('原已激活赛事继续使用');
      expect(postCalls(request)).toHaveLength(0);
    },
  );
  test('the independent submitter is not offered its own financial approval', async () => {
    const o = {
      ...order,
      paymentReview: {
        id: 'review',
        status: 'PENDING_REVIEW' as const,
        submittedByUserId: 'operator-a',
        reviewedByUserId: null,
        externalReference: 'synthetic-bank',
        reason: '合成核验原因',
        createdAt: workspace.serverTime,
        reviewedAt: null,
      },
      capabilities: { ...order.capabilities, canCancel: false },
    };
    const request = vi.fn().mockResolvedValue(envelope({ ...platformWorkspace, orders: [o] }));
    platform(request);
    fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
    expect(screen.getByText(/你提交，需另一位操作员复核/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '独立确认线下到账' })).not.toBeInTheDocument();
  });
  test('409 blocks a stale financial replay, preserves the reason, and requires an explicit read', async () => {
    const o = {
      ...order,
      capabilities: { ...order.capabilities, canCancel: false, canSubmitPayment: true },
    };
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiError(409, 'VERSION_CONFLICT', '会员订单已更新');
      return envelope({ ...platformWorkspace, orders: [o] });
    });
    platform(request);
    fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
    fireEvent.click(screen.getByRole('button', { name: '提交线下收款核验' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('操作原因'), {
      target: { value: '保留核对过的原因' },
    });
    fireEvent.change(within(dialog).getByLabelText('实际线下交易引用'), {
      target: { value: 'synthetic-bank-ref' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(within(dialog).getByText('会员订单已更新')).toBeVisible());
    expect(within(dialog).getByLabelText('操作原因')).toHaveValue('保留核对过的原因');
    expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(postCalls(request)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '重新读取最新资料' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: '提交线下收款核验' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('操作原因')).toHaveValue(
      '保留核对过的原因',
    );
    expect(postCalls(request)).toHaveLength(1);
  });
  test('an unknown initiation result is not retried or rendered as paid', async () => {
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiError(0, 'NETWORK_ERROR', '连接中断');
      return envelope(workspace);
    });
    org(request);
    fireEvent.click(await screen.findByRole('button', { name: '核对购买专业机构会员' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText('操作结果待核对');
    expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(postCalls(request)).toHaveLength(1);
    expect(screen.queryByText('付款已核验')).not.toBeInTheDocument();
  });
  test('native QR creation leaves the original order pending and only verified server status shows paid', async () => {
    const nativeOrder = {
      ...order,
      channel: 'WECHAT_NATIVE' as const,
      version: 2,
      capabilities: { ...order.capabilities, canCreateNative: true, canQueryPayment: true },
    };
    let paid = false;
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      const o = paid
        ? {
            ...nativeOrder,
            status: 'PAID' as const,
            paidAt: workspace.serverTime,
            version: 3,
            capabilities: { ...nativeOrder.capabilities, canCreateNative: false },
          }
        : nativeOrder;
      if (init?.method === 'POST') {
        if (JSON.parse(String(init.body)).type === 'QUERY_PAYMENT') {
          paid = true;
          return envelope({
            order: { ...o, status: 'PAID', paidAt: workspace.serverTime },
            nativePayment: null,
          });
        }
        return envelope({
          order: o,
          nativePayment: { codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-member' },
        });
      }
      return envelope({ ...workspace, realPaymentEnabled: true, orders: [o] });
    });
    org(request);
    fireEvent.click(await screen.findByRole('tab', { name: '会员订单' }));
    fireEvent.click(screen.getByRole('button', { name: '微信付款' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }));
    expect(await screen.findByRole('img', { name: '会员订单微信付款二维码' })).toHaveAttribute(
      'src',
      'data:image/png;base64,c3ludGhldGlj',
    );
    expect(screen.getByText(/另一台设备上使用微信“扫一扫”/)).toBeVisible();
    expect(screen.getByText(/不支持本机长按或从相册识别/)).toBeVisible();
    expect(screen.getByText('待付款')).toBeVisible();
    expect(screen.queryByText('付款已核验')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查询付款结果' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }));
    expect(await screen.findByText('付款已核验')).toBeVisible();
    expect(screen.queryByRole('img', { name: '会员订单微信付款二维码' })).not.toBeInTheDocument();
  });
  test('an old organization response and its request cannot replace the new member workspace', async () => {
    let resolveOld!: (value: unknown) => void;
    let oldSignal: AbortSignal | undefined;
    const pending = new Promise((resolve) => {
      resolveOld = resolve;
    });
    const request = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path.includes('/org-a/')) {
        oldSignal = init?.signal as AbortSignal;
        return pending;
      }
      return Promise.resolve(
        envelope({
          ...workspace,
          orgId: 'org-b',
          organizationName: '新机构',
          plans: [],
          purchasablePlanIds: [],
        }),
      );
    });
    const client = { request } as ApiClient;
    const rendered = render(
      <MemoryRouter>
        <OrgMembershipPage context={context(client)} />
      </MemoryRouter>,
    );
    rendered.rerender(
      <MemoryRouter>
        <OrgMembershipPage context={context(client, 'org-b')} />
      </MemoryRouter>,
    );
    expect(oldSignal?.aborted).toBe(true);
    await screen.findByText(/机构：新机构/);
    await act(async () => resolveOld(envelope(workspace)));
    expect(screen.queryByRole('heading', { name: plan.name })).not.toBeInTheDocument();
  });
});

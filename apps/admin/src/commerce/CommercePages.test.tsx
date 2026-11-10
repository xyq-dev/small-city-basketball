// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ApiError } from '../api/client';
import type { ApiClient } from '../api/client';
import type { EventEntitlementData } from '@small-city-basketball/contracts';
import { OrgCommercePage, PlatformCommercePage } from './CommercePages';
import { order, plan, workspace } from './test-fixtures';
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,c3ludGhldGlj') },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function context(client: ApiClient, organizationId = 'org-a') {
  return { client, organizationId, userId: 'owner-a', onSessionRefresh: async () => {} };
}
describe('commercial workflow UI (unit responses, no payment gateway)', () => {
  test('checkout confirms the exact immutable quote and never labels order creation as paid', async () => {
    const fetch = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => ({
      data: init?.method === 'POST' ? { order, nativePayment: null } : workspace,
      meta: { requestId: 'unit' },
    }));
    render(<OrgCommercePage context={context({ request: fetch } as ApiClient)} />);
    await screen.findByText('按届基础版');
    fireEvent.change(screen.getByLabelText('赛事'), { target: { value: 'event-a' } });
    fireEvent.change(screen.getByLabelText('套餐版本'), { target: { value: 'plan-a' } });
    fireEvent.click(screen.getByRole('button', { name: '核对本届订单' }));
    const dialog = screen.getByRole('dialog', { name: '确认本届软件订单' });
    expect(within(dialog).getByText(/仅本届软件服务费/)).toBeVisible();
    expect(fetch.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(fetch.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true));
    const sent = fetch.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(sent[1].body)).toMatchObject({
      eventId: 'event-a',
      planId: 'plan-a',
      expectedEventVersion: 3,
    });
    expect(sent[1].body).not.toMatch(/amountFen|PAID/);
    expect(screen.queryByText('付款已核验')).not.toBeInTheDocument();
  });
  test('only server-granted independent review actions are shown; submitter cannot approve its own receipt', async () => {
    const pending = {
      ...order,
      paymentReview: {
        id: 'review',
        status: 'PENDING_REVIEW' as const,
        submittedByUserId: 'operator-a',
        reviewedByUserId: null,
        externalReference: 'synthetic-bank',
        reason: '合成收款提交',
        createdAt: order.createdAt,
        reviewedAt: null,
      },
      capabilities: { ...order.capabilities, canCancel: false },
    };
    const c = {
      request: vi.fn().mockResolvedValue({
        data: {
          ...workspace,
          orgId: null,
          platformOperator: true,
          canPurchase: false,
          orders: [pending],
        },
        meta: { requestId: 'unit' },
      }),
    } as unknown as ApiClient;
    render(<PlatformCommercePage client={c} userId="operator-a" />);
    await screen.findByRole('heading', { name: '平台商业运营' });
    await screen.findByText(/你提交，需另一位操作员复核/);
    expect(screen.queryByRole('button', { name: '独立确认线下到账' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '微信付款' })).not.toBeInTheDocument();
  });
  test('a stale financial command preserves review input and requires an explicit refresh instead of replay', async () => {
    const current = {
      ...order,
      capabilities: { ...order.capabilities, canCancel: false, canSubmitPayment: true },
    };
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiError(409, 'VERSION_CONFLICT', '原订单已变化');
      return {
        data: {
          ...workspace,
          orgId: null,
          platformOperator: true,
          canPurchase: false,
          orders: [current],
        },
        meta: { requestId: 'unit' },
      };
    });
    render(<PlatformCommercePage client={{ request } as ApiClient} userId="operator-a" />);
    fireEvent.click(await screen.findByRole('button', { name: '提交线下收款核验' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('操作原因'), {
      target: { value: '已核对线下合成流水' },
    });
    fireEvent.change(within(dialog).getByLabelText('实际线下交易引用'), {
      target: { value: 'bank-reference-123' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(within(dialog).getByText('原订单已变化')).toBeVisible());
    expect(within(dialog).getByLabelText('操作原因')).toHaveValue('已核对线下合成流水');
    expect(within(dialog).getByLabelText('实际线下交易引用')).toHaveValue('bank-reference-123');
    expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
  });
  test('native initiation produces a local QR but keeps the original order unpaid until verified status returns', async () => {
    const current = { ...order, capabilities: { ...order.capabilities, canCreateNative: true } };
    const c = {
      request: vi.fn().mockImplementation(async (_p: string, init?: RequestInit) => ({
        data:
          init?.method === 'POST'
            ? {
                order: current,
                nativePayment: { codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic' },
              }
            : { ...workspace, realPaymentEnabled: true, orders: [current] },
        meta: { requestId: 'unit' },
      })),
    } as unknown as ApiClient;
    render(<OrgCommercePage context={context(c)} />);
    fireEvent.click(await screen.findByRole('button', { name: '微信付款' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }));
    expect(await screen.findByRole('img', { name: '微信付款二维码' })).toHaveAttribute(
      'src',
      'data:image/png;base64,c3ludGhldGlj',
    );
    expect(screen.queryByText('付款已核验')).not.toBeInTheDocument();
  });
  test('a delayed old organization response cannot replace the new workspace', async () => {
    let resolveOld!: (value: unknown) => void;
    const delayed = new Promise((r) => {
      resolveOld = r;
    });
    const c = {
      request: vi.fn().mockImplementation((path: string) =>
        path.includes('org-a')
          ? delayed
          : Promise.resolve({
              data: { ...workspace, orgId: 'org-b', events: [], plans: [], orders: [] },
              meta: { requestId: 'new' },
            }),
      ),
    } as unknown as ApiClient;
    const view = render(<OrgCommercePage context={context(c)} />);
    view.rerender(<OrgCommercePage context={context(c, 'org-b')} />);
    await screen.findByText('暂无可购买套餐，请联系平台。');
    await act(async () => resolveOld({ data: workspace, meta: { requestId: 'old' } }));
    expect(screen.queryByText('按届基础版')).not.toBeInTheDocument();
  });

  test.each([
    ['scb_event_basic', '小城市·基础赛事包', '99', '8', '32', '90'],
    ['scb_event_standard', '小城市·专业赛事包', '299', '16', '128', '180'],
    ['scb_event_business', '小城市·商业赛事包', '599', '32', '512', '365'],
  ])(
    'template %s needs confirmation, preserves the reason and sends no request',
    async (code, name, price, teams, matches, days) => {
      const request = vi.fn().mockResolvedValue({
        data: { ...workspace, orgId: null, platformOperator: true, canPurchase: false },
        meta: { requestId: 'unit' },
      });
      render(<PlatformCommercePage client={{ request } as ApiClient} userId="operator-a" />);
      await screen.findByRole('heading', { name: '创建套餐新版本' });
      const fields = [
        ['套餐代码', 'original-code'],
        ['套餐名称', '原草稿名称'],
        ['价格（元）', '123.45'],
        ['最多球队', '10'],
        ['最多比赛', '44'],
        ['激活有效天数', '120'],
        ['发布原因', '已核对的原发布原因'],
      ];
      for (const [label, value] of fields)
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      const originalCard = screen
        .getByRole('heading', { name: '按届基础版 v1' })
        .closest('article')!;
      expect(originalCard).toHaveTextContent('99.00');
      fireEvent.change(screen.getByRole('combobox', { name: '按届建议模板' }), {
        target: { value: code },
      });
      fireEvent.click(screen.getByRole('button', { name: '载入建议模板' }));
      let dialog = screen.getByRole('dialog', { name: '确认覆盖本地套餐草稿' });
      expect(within(dialog).getByText(/不会发布套餐、扣费或开通权益/)).toBeVisible();
      expect(screen.getByLabelText('套餐代码')).toHaveValue('original-code');
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      for (const [label, value] of fields) expect(screen.getByLabelText(label)).toHaveValue(value);
      expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: '载入建议模板' }));
      dialog = screen.getByRole('dialog', { name: '确认覆盖本地套餐草稿' });
      fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
      for (const [label, value] of [
        ['套餐代码', code],
        ['套餐名称', name],
        ['价格（元）', price],
        ['最多球队', teams],
        ['最多比赛', matches],
        ['激活有效天数', days],
        ['发布原因', '已核对的原发布原因'],
      ])
        expect(screen.getByLabelText(label)).toHaveValue(value);
      expect(screen.getByText(/建议模板已载入本地草稿/)).toBeVisible();
      expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
      expect(originalCard).toHaveTextContent('99.00');
      expect(originalCard).not.toHaveTextContent(name);
    },
  );

  test('publishing remains a separate confirmed action and uses the currently edited fields', async () => {
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => ({
      data:
        init?.method === 'POST'
          ? { plan: { ...plan, code: 'custom-edited', name: '已核对自定义价格', amountFen: 35550 } }
          : { ...workspace, orgId: null, platformOperator: true, canPurchase: false },
      meta: { requestId: 'unit' },
    }));
    render(<PlatformCommercePage client={{ request } as ApiClient} userId="operator-a" />);
    await screen.findByRole('heading', { name: '创建套餐新版本' });
    fireEvent.change(screen.getByLabelText('发布原因'), {
      target: { value: '独立核对机构服务范围' },
    });
    fireEvent.change(screen.getByLabelText('按届建议模板'), {
      target: { value: 'scb_event_standard' },
    });
    fireEvent.click(screen.getByRole('button', { name: '载入建议模板' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认操作' }));
    for (const [label, value] of [
      ['套餐代码', 'custom-edited'],
      ['套餐名称', '已核对自定义价格'],
      ['价格（元）', '355.50'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '核对并发布套餐版本' }));
    const dialog = screen.getByRole('dialog', { name: '发布不可变套餐版本' });
    expect(within(dialog).getByText(/已核对自定义价格/)).toHaveTextContent('355.50');
    expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() =>
      expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1),
    );
    const [path, init] = request.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(path).toBe('/v1/platform/commerce/plans');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      code: 'custom-edited',
      name: '已核对自定义价格',
      currency: 'CNY',
      amountFen: 35550,
      maxTeams: 16,
      maxMatches: 128,
      validDays: 180,
      reason: '独立核对机构服务范围',
    });
    expect(init!.body).not.toMatch(/role|activated|membership/);
  });

  test.each([false, true])(
    'pricing suggestions are hidden from organization purchasers and nonoperators (%s)',
    async (org) => {
      const request = vi.fn().mockResolvedValue({
        data: org
          ? workspace
          : { ...workspace, orgId: null, platformOperator: false, canPurchase: false },
        meta: { requestId: 'unit' },
      });
      if (org) render(<OrgCommercePage context={context({ request } as ApiClient)} />);
      else render(<PlatformCommercePage client={{ request } as ApiClient} userId="not-operator" />);
      await screen.findByText('按届基础版');
      expect(screen.queryByLabelText('按届建议模板')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '载入建议模板' })).not.toBeInTheDocument();
      expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
    },
  );

  test.each([
    ['READY', false, null, '截至核对时间可激活'],
    ['EXPIRED', false, null, '已过激活期'],
    ['ACTIVATED', true, null, '已激活，赛事继续使用'],
    ['REVOKED', true, '2026-10-25T00:00:00Z', '退款后已撤销'],
    ['REFUND_PENDING', false, null, '退款核验中，暂停新激活'],
    ['UNAVAILABLE', false, null, '当前不可新激活'],
  ] as const)(
    'renders the authoritative %s projection as a checked snapshot, without granting a role',
    async (activationStatus, activated, revokedAt, label) => {
      const entitlement: EventEntitlementData = {
        id: 'entitlement-a',
        eventId: 'event-a',
        eventName: '合成权益赛事',
        orderId: 'order-a',
        validUntil:
          activationStatus === 'EXPIRED' ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z',
        maxTeams: 16,
        maxMatches: 128,
        activated,
        revokedAt,
        activationStatus,
        statusCheckedAt:
          activationStatus === 'EXPIRED' ? '2099-01-02T00:00:00Z' : '2019-12-01T00:00:00Z',
      };
      const request = vi.fn().mockResolvedValue({
        data: { ...workspace, canPurchase: false, entitlements: [entitlement] },
        meta: { requestId: 'unit' },
      });
      render(<OrgCommercePage context={context({ request } as ApiClient)} />);
      const card = (await screen.findByRole('heading', { name: '合成权益赛事' })).closest(
        'article',
      )!;
      expect(within(card).getByText(label)).toBeVisible();
      expect(within(card).getByText(/激活截止：/)).toHaveTextContent('非赛事停用时间');
      expect(within(card).getByText(/服务端核对时间：/)).toBeVisible();
      expect(screen.getByText(/首次发布时仍须由服务端重新校验/)).toHaveTextContent(
        '购买不授予管理角色',
      );
      expect(within(card).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '核对本届订单' })).not.toBeInTheDocument();
      expect(request.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
    },
  );

  test.each([
    [false, null, '激活状态待核对'],
    [true, null, '已激活，赛事继续使用'],
    [true, '2026-10-25T00:00:00Z', '退款后已撤销'],
  ] as const)(
    'older APIs use only known activated/revoked facts (%s, %s)',
    async (activated, revokedAt, label) => {
      const request = vi.fn().mockResolvedValue({
        data: {
          ...workspace,
          entitlements: [
            {
              id: 'entitlement-a',
              eventId: 'event-a',
              eventName: '旧版权益赛事',
              orderId: 'order-a',
              validUntil: '2099-01-01T00:00:00Z',
              maxTeams: 16,
              maxMatches: 128,
              activated,
              revokedAt,
            },
          ],
        },
        meta: { requestId: 'unit' },
      });
      render(<OrgCommercePage context={context({ request } as ApiClient)} />);
      const card = (await screen.findByRole('heading', { name: '旧版权益赛事' })).closest(
        'article',
      )!;
      expect(within(card).getByText(label)).toBeVisible();
      expect(within(card).queryByText(/服务端核对时间/)).not.toBeInTheDocument();
      expect(within(card).queryByText(/待激活|截至核对时间可激活/)).not.toBeInTheDocument();
    },
  );
});

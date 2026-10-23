// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ApiError } from '../api/client';
import type { ApiClient } from '../api/client';
import { OrgCommercePage, PlatformCommercePage } from './CommercePages';
import { order, workspace } from './test-fixtures';
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
});

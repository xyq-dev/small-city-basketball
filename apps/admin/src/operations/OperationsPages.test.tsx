// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { DispatchOperationsPage } from './DispatchPage';
import { InsuranceOperationsPage } from './InsurancePage';
import { SponsorOperationsPage } from './SponsorPage';
import { TrainingOperationsPage } from './TrainingPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function context(request: unknown): RegistrationWorkspace {
  return {
    client: { request: request as ApiClient['request'] },
    organizationId: 'org-a',
    userId: 'user-a',
    onSessionRefresh: async () => {},
  };
}
const envelope = (data: unknown) => ({ data, meta: { requestId: 'unit' } });
const budget = {
  serviceMinor: 10000,
  travelMinor: 0,
  lodgingMinor: 0,
  platformMinor: 0,
  totalMinor: 10000,
};
function requestRow(status = 'DRAFT', canManage = true) {
  return {
    id: 'req-1',
    orgId: 'org-a',
    kind: 'REFEREE',
    status,
    version: 4,
    serviceRegion: { catalogVersion: 'cn-admin-2025-r1', regionId: 'region-1' },
    serviceAddress: '合成馆',
    servicePoint: null,
    startsAt: '2026-12-01T02:00:00.000Z',
    endsAt: '2026-12-01T04:00:00.000Z',
    expiresAt: '2026-11-20T02:00:00.000Z',
    budget,
    inviteRegionIds: ['region-1'],
    batchCount: 0,
    maxBatches: 3,
    batchSize: 3,
    sourceBookingId: null,
    winnerOfferId: null,
    reason: null,
    canManage,
    canConfirm: false,
  };
}
function dispatchData(enabled = true) {
  return {
    capabilities: {
      enabled,
      conversionEnabled: false,
      maxBatches: 3,
      batchSize: 3,
      holdMinutes: 30,
      externalNotifications: false as const,
    },
    requests: [requestRow()],
    offers: [],
    truncated: false,
    preference: null,
  };
}
const cohort = {
  id: 'cohort-1',
  orgId: 'org-a',
  courseId: 'course-1',
  title: '成人周末班',
  description: '合成课程',
  address: '合成馆',
  state: 'DRAFT',
  capacity: 8,
  available: 8,
  totalFen: 20000,
  termsId: 'terms-1',
  termsText: '成人条款',
  enrollmentDeadline: '2026-12-01T00:00:00.000Z',
  version: 3,
  sessions: [],
  capabilities: {
    canEnroll: false,
    canManage: true,
    paidEnrollmentEnabled: false,
    canComplete: false,
    completionBlocker: '尚未授课',
    canResume: false,
    resumeBlocker: null,
  },
};
function trainingData(enabled = true) {
  return {
    provider: null,
    coaches: [],
    courses: [{ id: 'course-1', title: '基础班' }],
    courts: [{ id: 'court-1', name: '一号场' }],
    cohorts: [cohort],
    enrollments: [],
    capabilities: {
      enabled,
      paidEnrollmentEnabled: false,
      adultOnly: true,
      youthEnrollmentEnabled: false,
      packagesEnabled: false,
    },
  };
}

describe('dispatch admin', () => {
  test('starts an invitation with the current version and ignores a second click', async () => {
    let posts = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return envelope({ id: 'req-1' });
      }
      if (path.includes('/requests/')) return envelope({ request: requestRow(), offers: [] });
      return envelope(dispatchData());
    });
    render(<DispatchOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    fireEvent.change(await screen.findByLabelText('需求操作说明'), {
      target: { value: '开始邀请说明' },
    });
    const button = screen.getByRole('button', { name: '开始分批邀请' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(posts).toBe(1));
    const sent = request.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
      type: 'START',
      expectedVersion: 4,
      reason: '开始邀请说明',
    });
  });

  test('a closed switch does not send, and a conflict keeps the reason', async () => {
    const closed = vi.fn(async (path: string) =>
      envelope(
        path.includes('/requests/') ? { request: requestRow(), offers: [] } : dispatchData(false),
      ),
    );
    const { rerender } = render(<DispatchOperationsPage context={context(closed)} />);
    expect(await screen.findByText('跨城派单尚未开放')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /合成馆/ }));
    expect(await screen.findByRole('button', { name: '开始分批邀请' })).toBeDisabled();
    expect(
      closed.mock.calls.some(
        (call) => (call as unknown as [string, RequestInit?])[1]?.method === 'POST',
      ),
    ).toBe(false);
    const conflict = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiError(409, 'VERSION_CONFLICT', '需求版本已变化');
      return envelope(
        path.includes('/requests/') ? { request: requestRow(), offers: [] } : dispatchData(true),
      );
    });
    rerender(<DispatchOperationsPage context={context(conflict)} />);
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    fireEvent.change(await screen.findByLabelText('需求操作说明'), {
      target: { value: '保留这段说明' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分批邀请' }));
    expect(await screen.findByText('需求版本已变化')).toBeVisible();
    expect(screen.getByLabelText('需求操作说明')).toHaveValue('保留这段说明');
  });

  test('a lost grant is shown and does not invent a workspace', async () => {
    const request = vi.fn(async () => {
      throw new ApiError(403, 'FORBIDDEN', '当前身份没有执行此操作的权限');
    });
    render(<DispatchOperationsPage context={context(request)} />);
    expect(await screen.findByText('当前身份没有执行此操作的权限')).toBeVisible();
    expect(screen.queryByText('开始分批邀请')).not.toBeInTheDocument();
  });

  test('the list is the signed-in account, and a slower detail cannot replace a newer one', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const request = vi.fn(async (path: string) => {
      if (path.includes('/requests/req-1')) {
        await firstGate;
        return envelope({
          request: { ...requestRow(), serviceAddress: '旧馆' },
          offers: [],
        });
      }
      if (path.includes('/requests/req-2')) {
        return envelope({
          request: { ...requestRow(), id: 'req-2', status: 'INVITING', serviceAddress: '新馆' },
          offers: [],
        });
      }
      return envelope({
        ...dispatchData(),
        requests: [requestRow(), { ...requestRow(), id: 'req-2', serviceAddress: '客场馆' }],
      });
    });
    render(<DispatchOperationsPage context={context(request)} />);
    expect(await screen.findByText(/当前登录账号发出的需求/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /合成馆/ }));
    fireEvent.click(screen.getByRole('button', { name: /客场馆/ }));
    expect(await screen.findByLabelText('需求详情')).toHaveTextContent('正在分批邀请');
    releaseFirst();
    await waitFor(() => expect(screen.getByLabelText('需求详情')).toHaveTextContent('新馆'));
    expect(screen.getByLabelText('需求详情')).not.toHaveTextContent('旧馆');
  });
});

describe('training admin', () => {
  test('publishes an adult draft and states that youth enrollment stays closed', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'cohort-1' });
      expect(path).toBe('/v1/orgs/org-a/training');
      return envelope(trainingData());
    });
    render(<TrainingOperationsPage context={context(request)} />);
    expect(await screen.findByText(/青少年培训未开放/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '发布班期' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    const body = JSON.parse(
      String(request.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body),
    );
    expect(body).toMatchObject({ action: 'PUBLISH', expectedVersion: 3 });
    expect(body.reason).toBeUndefined();
    expect(screen.queryByRole('button', { name: /青少年/ })).not.toBeInTheDocument();
  });

  test('a closed training switch disables publishing', async () => {
    const request = vi.fn(async () => envelope(trainingData(false)));
    render(<TrainingOperationsPage context={context(request)} />);
    expect(await screen.findByText('培训功能关闭')).toBeVisible();
    expect(screen.getByRole('button', { name: '发布班期' })).toBeDisabled();
  });

  test('registers a coach and submits an independent refund review without claiming the money arrived', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'created' });
      if (path.includes('/enrollments/')) {
        return envelope({
          id: 'enr-1',
          refunds: [
            {
              id: 'refund-1',
              status: 'PENDING_REVIEW',
              amount_fen: 5000,
              reason: '课次取消',
              version: 1,
            },
          ],
        });
      }
      return envelope({
        ...trainingData(),
        coaches: [
          {
            id: 'coach-1',
            display_name: '合成教练',
            status: 'PENDING',
            version: 2,
            consented: false,
          },
        ],
        enrollments: [
          { id: 'enr-1', state: 'CONFIRMED', learner_user_id: 'learner-1', version: 2 },
        ],
      });
    });
    render(<TrainingOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: '本人确认教练职责' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => String(call[0]).includes('/coaches/'))).toBe(true),
    );
    expect(
      JSON.parse(
        String(request.mock.calls.find((call) => String(call[0]).includes('/coaches/'))?.[1]?.body),
      ),
    ).toMatchObject({ action: 'CONSENT', expectedVersion: 2 });
    fireEvent.change(await screen.findByLabelText('教练与退费说明'), {
      target: { value: '另一位管理员已核验资质' },
    });
    fireEvent.click(screen.getByRole('button', { name: '独立审核教练' }));
    await waitFor(() =>
      expect(
        request.mock.calls.filter((call) => String(call[0]).includes('/coaches/')).length,
      ).toBe(2),
    );
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.getByText('教练审核已提交')).toBeVisible();
      expect(screen.getByRole('button', { name: /learner-1/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /learner-1/ }));
    expect(await screen.findByText(/还须在统一交易页审核并发送/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '独立批准逐课退费' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => String(call[0]).includes('/refunds/'))).toBe(true),
    );
    expect(
      JSON.parse(
        String(request.mock.calls.find((call) => String(call[0]).includes('/refunds/'))?.[1]?.body),
      ),
    ).toMatchObject({
      action: 'APPROVE',
      expectedVersion: 1,
      reason: '另一位管理员已核验资质',
    });
    expect(screen.getByText(/不表示款项已到账/)).toBeVisible();
    expect(screen.queryByText('已退款')).not.toBeInTheDocument();
    expect(screen.queryByText('退款已到账')).not.toBeInTheDocument();
  });

  test('sends attendance and consumption review with the learner version', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'created' });
      if (path.includes('/roster')) {
        return envelope({
          session: { id: 'sess-1', version: 4, state: 'SCHEDULED' },
          learners: [{ id: 'ent-1', display_name: '合成学员', state: 'AVAILABLE', version: 6 }],
          consumptions: [{ id: 'use-1', status: 'PROPOSED', reason: '已授课', version: 2 }],
          canManage: true,
        });
      }
      return envelope({
        ...trainingData(),
        cohorts: [
          {
            ...cohort,
            sessions: [
              {
                id: 'sess-1',
                startsAt: '2026-12-01T02:00:00.000Z',
                endsAt: '2026-12-01T04:00:00.000Z',
                state: 'SCHEDULED',
                version: 4,
              },
            ],
          },
        ],
      });
    });
    render(<TrainingOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /查看课次名单/ }));
    fireEvent.click(await screen.findByRole('button', { name: '现场核验后签到' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => String(call[0]).includes('/entitlements/'))).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        String(
          request.mock.calls.find((call) => String(call[0]).includes('/entitlements/'))?.[1]?.body,
        ),
      ),
    ).toMatchObject({ action: 'CHECKIN', expectedVersion: 6 });
    fireEvent.change(await screen.findByLabelText('授课记录'), {
      target: { value: '另一位管理员核对授课' },
    });
    fireEvent.click(screen.getByRole('button', { name: '独立复核消费' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => String(call[0]).includes('/consumptions/'))).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        String(
          request.mock.calls.find((call) => String(call[0]).includes('/consumptions/'))?.[1]?.body,
        ),
      ),
    ).toMatchObject({
      action: 'REVIEW',
      expectedVersion: 2,
      reason: '另一位管理员核对授课',
    });
  });
});

describe('insurance operations', () => {
  test('shows the closed reason and refreshes an existing order without claiming a policy', async () => {
    const order = {
      id: 'order-1',
      entryId: 'entry-1',
      memberId: 'member-1',
      version: 2,
      premiumFen: 3000,
      refundedFen: null,
      currency: 'CNY' as const,
      coverageStartDate: '2026-12-01',
      coverageEndDate: '2026-12-02',
      paymentStatus: 'UNPAID' as const,
      policyStatus: 'PENDING' as const,
      verifiedAt: null,
      maskedPolicyNumber: null,
      canDownloadDocument: false,
      pendingOperation: null,
      canRefresh: true,
      canRequestCancellation: false,
      reconciliationRequired: true,
      currentMaterial: true,
    };
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'order-1' });
      return envelope({
        enabled: false,
        maintenanceEnabled: true,
        externalPolicySupported: true,
        providerEntryUrl: null,
        reason: '在线投保准入尚未完成或已到期，请提交已有外部保单审核。',
        products: [],
        orders: [order],
        notice: '保费由实际保险服务方收取。',
      });
    });
    render(<InsuranceOperationsPage context={context(request)} />);
    expect(await screen.findByText(/在线投保准入尚未完成/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /投保|出单|承保/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新原单' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    expect(
      JSON.parse(String(request.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body)),
    ).toMatchObject({
      type: 'REFRESH',
      expectedVersion: 2,
    });
    expect(screen.getByText(/尚无服务方保单号/)).toBeVisible();
    expect(screen.getByText(/当前登录账号自己的保单/)).toBeVisible();
  });
});

describe('sponsor settlement admin', () => {
  test('approves a contract and lists settlement amounts without a payout button', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/v1/me/sponsor-commerce')
        return envelope({ organizations: [{ id: 'org-a', name: '合成机构', role: 'ADVERTISER' }] });
      if (path.endsWith('/statements'))
        return envelope({
          items: [
            {
              id: 'item-1',
              display_name: '主场机构',
              amount_fen: 8000,
              status: 'SUCCEEDED',
              returned_fen: 0,
            },
          ],
        });
      if (init?.method === 'POST') return envelope({ id: 'contract-1' });
      return envelope({
        enabled: true,
        canManage: true,
        canFinance: true,
        canAdvance: false,
        userId: 'reviewer-b',
        campaignOptions: [],
        contracts: [
          {
            id: 'contract-1',
            title: '合成广告合同',
            status: 'IN_REVIEW',
            version: 5,
            total_fen: 100000,
            created_by: 'owner-a',
            payer_user_id: 'payer-a',
            contractHash: 'hash-1',
          },
        ],
        orders: [],
        beneficiaries: [],
        receiverOptions: [],
      });
    });
    render(<SponsorOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: '审核合同' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    expect(
      JSON.parse(String(request.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body)),
    ).toMatchObject({
      action: 'APPROVE',
      expectedVersion: 5,
    });
    fireEvent.click(screen.getByRole('button', { name: '本机构收益明细' }));
    expect(await screen.findByText(/主场机构/)).toHaveTextContent('¥80.00（8000 分）');
    expect(
      screen.queryByRole('button', { name: /发送已批准分账|付款|退款/ }),
    ).not.toBeInTheDocument();
  });

  test('a closed commerce switch hides new contracts and a forbidden list is not replaced', async () => {
    const closed = vi.fn(async (path: string) => {
      if (path === '/v1/me/sponsor-commerce') return envelope({ organizations: [] });
      if (path.endsWith('/statements')) return envelope({ items: [] });
      return envelope({
        enabled: false,
        canManage: true,
        canFinance: false,
        canAdvance: false,
        userId: 'user-a',
        campaignOptions: [],
        contracts: [],
        orders: [],
        beneficiaries: [],
        receiverOptions: [],
      });
    });
    const { rerender } = render(<SponsorOperationsPage context={context(closed)} />);
    expect(await screen.findByText('商业收款尚未开通')).toBeVisible();
    expect(screen.queryByRole('button', { name: '建立合同草稿' })).not.toBeInTheDocument();
    const denied = vi.fn(async () => {
      throw new ApiError(403, 'FORBIDDEN', '当前身份没有执行此操作的权限');
    });
    rerender(<SponsorOperationsPage context={context(denied)} />);
    expect(await screen.findByText('当前身份没有执行此操作的权限')).toBeVisible();
    expect(screen.queryByText('已收款')).not.toBeInTheDocument();
  });

  test('switching institution drops a late order from the previous institution', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/me/sponsor-commerce') {
        return envelope({
          organizations: [
            { id: 'org-a', name: '甲机构', role: 'ADVERTISER' },
            { id: 'org-b', name: '乙机构', role: 'ADVERTISER' },
          ],
        });
      }
      if (path.endsWith('/statements')) return envelope({ items: [] });
      if (path.includes('/orders/')) {
        await gate;
        return envelope({
          order: {
            id: 'order-1',
            status: 'DELIVERING',
            version: 9,
            total_fen: 100,
          },
          batches: [],
        });
      }
      if (path.includes('/orgs/org-b/')) {
        return envelope({
          enabled: true,
          canManage: true,
          canFinance: false,
          canAdvance: false,
          userId: 'user-a',
          campaignOptions: [],
          contracts: [
            {
              id: 'contract-b',
              title: '乙机构合同',
              status: 'DRAFT',
              version: 1,
              total_fen: 100,
              created_by: 'user-b',
              payer_user_id: 'payer-b',
              contractHash: 'hash-b',
            },
          ],
          orders: [],
          beneficiaries: [],
          receiverOptions: [],
        });
      }
      return envelope({
        enabled: true,
        canManage: true,
        canFinance: false,
        canAdvance: false,
        userId: 'user-a',
        campaignOptions: [],
        contracts: [],
        orders: [{ id: 'order-1', status: 'DELIVERING', total_fen: 100, paid_fen: 0 }],
        beneficiaries: [],
        receiverOptions: [],
      });
    });
    render(<SponsorOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: '订单与交付' }));
    fireEvent.click(screen.getByRole('button', { name: /交付中/ }));
    fireEvent.change(screen.getByLabelText('广告机构'), { target: { value: 'org-b' } });
    expect(await screen.findByText('暂无广告订单。')).toBeVisible();
    release();
    await waitFor(() => expect(screen.queryByText('资料 v9')).not.toBeInTheDocument());
    expect(screen.getByLabelText('广告机构')).toHaveValue('org-b');
    expect(screen.queryByText('资料 v9')).not.toBeInTheDocument();
  });
});

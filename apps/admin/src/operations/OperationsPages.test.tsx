// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const repoRoot = join(__dirname, '../../../..');
const courseId = '11111111-1111-4111-8111-111111111111';
const courtId = '22222222-2222-4222-8222-222222222222';
const coachId = '33333333-3333-4333-8333-333333333333';
const quoteHash = 'ab'.repeat(32);
function parseCohort(body: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'scb-cohort-'));
  const file = join(dir, 'check.mjs');
  try {
    writeFileSync(
      file,
      `import { parseTrainingCohort } from ${JSON.stringify(pathToFileURL(join(repoRoot, 'apps/api/src/training-domain.ts')).href)};
const body = JSON.parse(process.argv[2]);
parseTrainingCohort(body);
`,
    );
    execFileSync(process.execPath, ['--import', 'tsx', file, JSON.stringify(body)], {
      cwd: join(repoRoot, 'apps/api'),
      stdio: 'pipe',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
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

  test('confirmation uses the visible quote and a slower write cannot replace a newer detail', async () => {
    const quote = {
      serviceMinor: 7000,
      travelMinor: 500,
      lodgingMinor: 500,
      platformMinor: 0,
      totalMinor: 8000,
      slotId: 'slot-1',
      departureAt: '2026-12-01T00:00:00.000Z',
      arrivalAt: '2026-12-01T01:00:00.000Z',
      returnAt: '2026-12-01T06:00:00.000Z',
      protectedStartsAt: '2026-12-01T01:30:00.000Z',
      protectedEndsAt: '2026-12-01T05:00:00.000Z',
      travelMethod: '高铁',
      travelEvidence: '车次凭据 G1',
      terms: '含报到前一小时与返程保护',
      hash: quoteHash,
    };
    const winner = {
      id: 'offer-1',
      requestId: 'req-1',
      listingId: 'listing-1',
      listingTitle: '合成裁判',
      status: 'READY',
      version: 3,
      expiresAt: '2026-11-20T02:00:00.000Z',
      quote,
      quoteHash,
      travelVerified: false,
      locationVisible: false,
      holdExpiresAt: null,
      sourceBookingId: null,
      canQuote: false,
      canReviewTravel: true,
      canAccept: false,
      canWithdraw: false,
      request: requestRow('REVIEWING', true),
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reviewing = {
      ...requestRow('REVIEWING'),
      canConfirm: true,
      winnerOfferId: 'offer-1',
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        await gate;
        return envelope({ id: 'req-1' });
      }
      if (path.includes('/requests/req-2')) {
        return envelope({
          request: { ...requestRow(), id: 'req-2', status: 'INVITING', serviceAddress: '新馆' },
          offers: [],
        });
      }
      if (path.includes('/requests/req-1'))
        return envelope({ request: reviewing, offers: [winner] });
      if (path.includes('/offers/offer-1')) return envelope(winner);
      return envelope({
        ...dispatchData(),
        requests: [reviewing, { ...requestRow(), id: 'req-2', serviceAddress: '客场馆' }],
        offers: [winner],
      });
    });
    render(<DispatchOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    const detail = await screen.findByLabelText('需求详情');
    expect(detail).toHaveTextContent('需求预算 ¥100.00（10000 分）');
    expect(detail).toHaveTextContent('当前实际报价 ¥80.00（8000 分）');
    expect(detail).toHaveTextContent('车次凭据 G1');
    expect(detail).toHaveTextContent('含报到前一小时与返程保护');
    expect(screen.getByRole('button', { name: '确认当前报价并创建真实预约' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认当前报价并创建真实预约' }));
    expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('需求操作说明'), {
      target: { value: '已核对当前报价' },
    });
    fireEvent.click(screen.getByLabelText('同意当前报价'));
    fireEvent.click(screen.getByRole('button', { name: '确认当前报价并创建真实预约' }));
    fireEvent.click(screen.getByRole('button', { name: /客场馆/ }));
    expect(await screen.findByLabelText('需求详情')).toHaveTextContent('新馆');
    release();
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('需求详情')).toHaveTextContent('新馆');
    expect(screen.queryByText('需求操作已提交，请以重新读取的状态为准')).not.toBeInTheDocument();
    const sent = request.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
      type: 'CONFIRM_QUOTE',
      quoteHash,
      acceptedTermsId: quoteHash,
      chargeConsent: true,
      expectedVersion: 4,
    });
  });

  test('reopening a request drops the previous quote acknowledgement', async () => {
    const quote = {
      serviceMinor: 7000,
      travelMinor: 500,
      lodgingMinor: 500,
      platformMinor: 0,
      totalMinor: 8000,
      slotId: 'slot-1',
      departureAt: '2026-12-01T00:00:00.000Z',
      arrivalAt: '2026-12-01T01:00:00.000Z',
      returnAt: '2026-12-01T06:00:00.000Z',
      protectedStartsAt: '2026-12-01T01:30:00.000Z',
      protectedEndsAt: '2026-12-01T05:00:00.000Z',
      travelMethod: '高铁',
      travelEvidence: '车次凭据 G1',
      terms: '含报到前一小时与返程保护',
      hash: quoteHash,
    };
    const reviewing = { ...requestRow('REVIEWING'), canConfirm: true, winnerOfferId: 'offer-1' };
    const winner = {
      id: 'offer-1',
      requestId: 'req-1',
      listingId: 'listing-1',
      listingTitle: '合成裁判',
      status: 'READY',
      version: 3,
      expiresAt: '2026-11-20T02:00:00.000Z',
      quote,
      quoteHash,
      travelVerified: false,
      locationVisible: false,
      holdExpiresAt: null,
      sourceBookingId: null,
      canQuote: false,
      canReviewTravel: false,
      canAccept: false,
      canWithdraw: false,
      request: requestRow('REVIEWING', true),
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'req-1' });
      if (path.includes('/requests/req-1'))
        return envelope({ request: reviewing, offers: [winner] });
      return envelope({ ...dispatchData(), requests: [reviewing], offers: [winner] });
    });
    render(<DispatchOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    fireEvent.click(await screen.findByLabelText('同意当前报价'));
    fireEvent.click(screen.getByRole('button', { name: /合成馆/ }));
    expect(await screen.findByLabelText('同意当前报价')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('需求操作说明'), {
      target: { value: '旧同意不能沿用' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认当前报价并创建真实预约' }));
    expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  });

  test('a request command still in flight does not replace an offer opened later', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invite = {
      id: 'offer-9',
      listingTitle: '客场裁判',
      status: 'PENDING',
      version: 2,
      request: requestRow(),
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        await gate;
        return envelope({ id: 'req-1' });
      }
      if (path.includes('/requests/req-1')) return envelope({ request: requestRow(), offers: [] });
      if (path.includes('/offers/offer-9'))
        return envelope({ ...invite, request: { ...requestRow(), serviceAddress: '邀请场馆' } });
      return envelope({ ...dispatchData(), offers: [invite] });
    });
    render(<DispatchOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    fireEvent.change(await screen.findByLabelText('需求操作说明'), {
      target: { value: '开始邀请说明' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分批邀请' }));
    fireEvent.click(screen.getByRole('button', { name: /客场裁判/ }));
    expect(await screen.findByLabelText('邀请详情')).toHaveTextContent('邀请场馆');
    release();
    await waitFor(() => expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('邀请详情')).toHaveTextContent('邀请场馆');
    expect(screen.queryByLabelText('需求详情')).not.toBeInTheDocument();
  });

  test('a refresh that started on the first request does not paint over the request opened later', async () => {
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let requestReads = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'req-1' });
      if (path.includes('/requests/req-1')) {
        requestReads += 1;
        if (requestReads > 1) await refreshGate;
        return envelope({
          request: { ...requestRow(), serviceAddress: '旧馆回填' },
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
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    fireEvent.change(await screen.findByLabelText('需求操作说明'), {
      target: { value: '开始邀请说明' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分批邀请' }));
    await waitFor(() => expect(requestReads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: /客场馆/ }));
    expect(await screen.findByLabelText('需求详情')).toHaveTextContent('新馆');
    releaseRefresh();
    await waitFor(() => expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('需求详情')).toHaveTextContent('新馆');
    expect(screen.getByLabelText('需求详情')).not.toHaveTextContent('旧馆回填');
  });

  test('a failed open of the first request does not reload over the request opened later', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    let firstSettled = false;
    const firstOpen = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    }).finally(() => {
      firstSettled = true;
    });
    let firstReads = 0;
    const request = vi.fn(async (path: string) => {
      if (path.includes('/requests/req-1')) {
        firstReads += 1;
        if (firstReads === 1) return firstOpen;
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
    fireEvent.click(await screen.findByRole('button', { name: /合成馆/ }));
    fireEvent.click(screen.getByRole('button', { name: /客场馆/ }));
    expect(await screen.findByLabelText('需求详情')).toHaveTextContent('新馆');
    rejectFirst(new Error('late open failure'));
    await waitFor(() => expect(firstSettled).toBe(true));
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.getByLabelText('需求详情')).toHaveTextContent('新馆');
    });
  });

  test('travel review shows the itinerary and does not send until that evidence is checked', async () => {
    const quote = {
      serviceMinor: 7000,
      travelMinor: 500,
      lodgingMinor: 500,
      platformMinor: 0,
      totalMinor: 8000,
      slotId: 'slot-1',
      departureAt: '2026-12-01T00:00:00.000Z',
      arrivalAt: '2026-12-01T01:00:00.000Z',
      returnAt: '2026-12-01T06:00:00.000Z',
      protectedStartsAt: '2026-12-01T01:30:00.000Z',
      protectedEndsAt: '2026-12-01T05:00:00.000Z',
      travelMethod: '高铁',
      travelEvidence: '车次凭据 G1',
      terms: '含报到前一小时与返程保护',
      hash: quoteHash,
    };
    const invite = {
      id: 'offer-1',
      requestId: 'req-1',
      listingId: 'listing-1',
      listingTitle: '合成裁判',
      status: 'TRAVEL_REVIEW',
      version: 3,
      expiresAt: '2026-11-20T02:00:00.000Z',
      quote,
      quoteHash,
      travelVerified: false,
      locationVisible: false,
      holdExpiresAt: null,
      sourceBookingId: null,
      canQuote: false,
      canReviewTravel: true,
      canAccept: false,
      canWithdraw: false,
      request: requestRow('REVIEWING', true),
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'offer-1' });
      if (path.includes('/offers/offer-1')) return envelope(invite);
      return envelope({ ...dispatchData(), offers: [invite] });
    });
    render(<DispatchOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /合成裁判/ }));
    const detail = await screen.findByLabelText('邀请详情');
    expect(detail).toHaveTextContent('需求预算 ¥100.00（10000 分）');
    expect(detail).toHaveTextContent('当前实际报价 ¥80.00（8000 分）');
    expect(detail).toHaveTextContent('车次凭据 G1');
    expect(screen.getByRole('button', { name: '记录独立核验结论' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '记录独立核验结论' }));
    expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByLabelText('已核对行程凭据'));
    fireEvent.change(screen.getByLabelText('邀请操作说明'), {
      target: { value: '已核对行程凭据' },
    });
    fireEvent.click(screen.getByRole('button', { name: '记录独立核验结论' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    expect(
      JSON.parse(String(request.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body)),
    ).toMatchObject({
      type: 'VERIFY_TRAVEL',
      quoteHash,
      evidenceChecked: true,
      expectedVersion: 3,
    });
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
      const learner = screen.getByRole('button', { name: /learner-1/ });
      expect(learner).toBeEnabled();
      fireEvent.click(learner);
    });
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

  test('creates a cohort only with a chosen coach and a weight the server accepts', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'cohort-1' });
      return envelope({
        ...trainingData(),
        courses: [{ id: courseId, title: '基础班' }],
        courts: [{ id: courtId, name: '一号场' }],
        coaches: [
          {
            id: coachId,
            display_name: '可排教练',
            status: 'APPROVED',
            consented: true,
            qualified_until: '2027-12-31T15:59:59.000Z',
          },
          {
            id: '44444444-4444-4444-8444-444444444444',
            display_name: '未审核教练',
            status: 'PENDING',
            consented: false,
            qualified_until: '2027-12-31T15:59:59.000Z',
          },
        ],
      });
    });
    render(<TrainingOperationsPage context={context(request)} />);
    fireEvent.change(await screen.findByLabelText('课程'), { target: { value: courseId } });
    fireEvent.change(screen.getByLabelText('场地'), { target: { value: courtId } });
    fireEvent.change(screen.getByLabelText('班期名称'), { target: { value: '成人周末班' } });
    fireEvent.change(screen.getByLabelText('上课地点'), { target: { value: '合成馆' } });
    fireEvent.change(screen.getByLabelText('班期金额'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('培训条款'), { target: { value: '成人条款' } });
    fireEvent.change(screen.getByLabelText('课次开始'), { target: { value: '2026-12-01T10:00' } });
    fireEvent.change(screen.getByLabelText('课次结束'), { target: { value: '2026-12-01T12:00' } });
    expect(screen.queryByRole('option', { name: '未审核教练' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '建立班期草稿' }));
    expect(await screen.findByText('请选择已确认且资质覆盖本课次的教练')).toBeVisible();
    expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('课次教练'), { target: { value: coachId } });
    fireEvent.change(screen.getByLabelText('课次价格权重'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '建立班期草稿' }));
    expect(await screen.findByText('课次价格权重须为整数')).toBeVisible();
    fireEvent.change(screen.getByLabelText('课次价格权重'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '建立班期草稿' }));
    expect(await screen.findByText('收费班期的课次权重须为正整数')).toBeVisible();
    expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('课次价格权重'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立班期草稿' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    const body = JSON.parse(
      String(request.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body),
    );
    expect(body.sessions).toEqual([
      expect.objectContaining({
        priceWeight: 1,
        coachIds: [coachId],
        bufferMinutes: 15,
      }),
    ]);
    expect(() => parseCohort(body)).not.toThrow();
    expect(() =>
      parseCohort({ ...body, sessions: [{ ...body.sessions[0], coachIds: [] }] }),
    ).toThrow();
    expect(() =>
      parseCohort({
        ...body,
        sessions: [{ startsAt: body.sessions[0].startsAt, endsAt: body.sessions[0].endsAt }],
      }),
    ).toThrow();
  });

  test('attendance and refund actions use the refreshed version', async () => {
    let rosterReads = 0;
    let enrollmentReads = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return envelope({ id: 'created' });
      if (path.includes('/roster')) {
        rosterReads += 1;
        return envelope({
          session: { id: 'sess-1', version: 4, state: 'SCHEDULED' },
          learners: [
            {
              id: 'ent-1',
              display_name: '合成学员',
              state: 'AVAILABLE',
              version: rosterReads === 1 ? 6 : 7,
            },
          ],
          consumptions: [],
          canManage: true,
        });
      }
      if (path.includes('/enrollments/')) {
        enrollmentReads += 1;
        return envelope({
          id: 'enr-1',
          refunds:
            enrollmentReads === 1
              ? [
                  {
                    id: 'refund-1',
                    status: 'PENDING_REVIEW',
                    amount_fen: 5000,
                    reason: '课次取消',
                    version: 1,
                  },
                ]
              : [
                  {
                    id: 'refund-1',
                    status: 'PENDING',
                    amount_fen: 5000,
                    reason: '课次取消',
                    version: 2,
                  },
                ],
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
        enrollments: [
          { id: 'enr-1', state: 'CONFIRMED', learner_user_id: 'learner-1', version: 2 },
        ],
      });
    });
    render(<TrainingOperationsPage context={context(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /查看课次名单/ }));
    fireEvent.click(await screen.findByRole('button', { name: '现场核验后签到' }));
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.getByLabelText('课次名单')).toHaveTextContent('资料 v7');
      expect(screen.getByRole('button', { name: '签退' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: '签退' }));
    await waitFor(() => {
      const checkout = request.mock.calls
        .map((call) => call[1]?.body)
        .filter((body): body is string => typeof body === 'string')
        .map((body) => JSON.parse(body) as { action?: string; expectedVersion?: number })
        .find((body) => body.action === 'CHECKOUT');
      expect(checkout).toMatchObject({ action: 'CHECKOUT', expectedVersion: 7 });
    });
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /learner-1/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /learner-1/ }));
    fireEvent.change(await screen.findByLabelText('教练与退费说明'), {
      target: { value: '另一位管理员已核验资质' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '独立批准逐课退费' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '独立批准逐课退费' })).not.toBeInTheDocument(),
    );
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '独立批准逐课退费' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('报名退费')).toHaveTextContent('PENDING');
    });
    expect(screen.getByText(/不表示款项已到账/)).toBeVisible();
  });

  test('a version conflict reload refreshes the roster that conflicted', async () => {
    let rosterReads = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        throw new ApiError(409, 'VERSION_CONFLICT', '课次版本已变化');
      }
      if (path.includes('/roster')) {
        rosterReads += 1;
        return envelope({
          session: { id: 'sess-1', version: rosterReads === 1 ? 4 : 8, state: 'SCHEDULED' },
          learners: [
            {
              id: 'ent-1',
              display_name: '合成学员',
              state: 'AVAILABLE',
              version: rosterReads === 1 ? 6 : 8,
            },
          ],
          consumptions:
            rosterReads === 1
              ? []
              : [{ id: 'cons-1', status: 'ACCEPTED', reason: '已复核', version: 3 }],
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
    expect(await screen.findByText('资料版本已变化')).toBeVisible();
    expect(screen.getByLabelText('课次名单')).toHaveTextContent('资料 v6');
    fireEvent.click(screen.getByRole('button', { name: '重新读取最新资料' }));
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.getByLabelText('课次名单')).toHaveTextContent('资料 v8');
      expect(screen.getByLabelText('课次名单')).toHaveTextContent('ACCEPTED');
      expect(screen.getByRole('button', { name: '签退' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: '签退' }));
    await waitFor(() => {
      const checkout = request.mock.calls
        .map((call) => call[1]?.body)
        .filter((body): body is string => typeof body === 'string')
        .map((body) => JSON.parse(body) as { action?: string; expectedVersion?: number })
        .find((body) => body.action === 'CHECKOUT');
      expect(checkout).toMatchObject({ expectedVersion: 8 });
    });
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
            org_id: 'org-a',
            title: '合成广告合同',
            status: 'IN_REVIEW',
            version: 5,
            total_fen: 100000,
            allowed_fee_fen: 3000,
            terms: '场地围挡条款全文，含验收和责任。',
            starts_at: '2026-12-01T00:00:00.000Z',
            ends_at: '2026-12-31T00:00:00.000Z',
            created_by: 'owner-a',
            payer_user_id: 'payer-a',
            contractHash: 'cd'.repeat(32),
            merchant_id: 'secret-merchant',
            shares: [{ beneficiaryOrgId: 'org-home', displayName: '主场分成', basisPoints: 10000 }],
          },
        ],
        orders: [],
        beneficiaries: [],
        receiverOptions: [],
      });
    });
    render(<SponsorOperationsPage context={context(request)} />);
    expect(await screen.findByText(/场地围挡条款全文/)).toBeVisible();
    expect(screen.getByText(/手续费上限/)).toHaveTextContent('¥30.00（3000 分）');
    expect(screen.getByText(/2026-12-01T00:00:00.000Z 至 2026-12-31T00:00:00.000Z/)).toBeVisible();
    expect(screen.getByText(/主场分成 10000 基点/)).toBeVisible();
    expect(screen.queryByText('secret-merchant')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审核合同' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('核对合成广告合同'));
    fireEvent.click(screen.getByRole('button', { name: '审核合同' }));
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

  test('signing sends the hash on screen and a newer contract version cannot reuse it', async () => {
    let version = 5;
    const hash = 'cd'.repeat(32);
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path.endsWith('/statements')) return envelope({ items: [] });
      if (path === '/v1/me/sponsor-commerce')
        return envelope({ organizations: [{ id: 'org-a', name: '合成机构', role: 'ADVERTISER' }] });
      return envelope({
        enabled: true,
        canManage: true,
        canFinance: false,
        canAdvance: false,
        userId: 'owner-b',
        campaignOptions: [],
        contracts: [
          {
            id: 'contract-1',
            org_id: 'org-a',
            title: '合成广告合同',
            status: 'APPROVED',
            version,
            total_fen: 100000,
            allowed_fee_fen: 3000,
            terms: '场地围挡条款全文，含验收和责任。',
            starts_at: '2026-12-01T00:00:00.000Z',
            ends_at: '2026-12-31T00:00:00.000Z',
            created_by: 'owner-a',
            payer_user_id: 'payer-a',
            reviewed_by: 'reviewer-c',
            owner_signed_by: null,
            contractHash: hash,
            shares: [{ beneficiaryOrgId: 'org-home', displayName: '主场分成', basisPoints: 10000 }],
          },
        ],
        orders: [],
        beneficiaries: [],
        receiverOptions: [],
      });
    });
    render(<SponsorOperationsPage context={context(request)} />);
    expect(await screen.findByRole('button', { name: '机构确认签署' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('核对合成广告合同'));
    version = 6;
    fireEvent.click(screen.getByRole('button', { name: '机构确认签署' }));
    await waitFor(() =>
      expect(request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
    );
    const body = JSON.parse(
      String(request.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body),
    );
    expect(body).toMatchObject({
      action: 'OWNER_SIGN',
      expectedVersion: 5,
      acceptedContractHash: hash,
    });
    await waitFor(() => {
      expect(screen.queryByText('正在读取最新资料…')).not.toBeInTheDocument();
      expect(screen.getByText(/资料 v6/)).toBeVisible();
      expect(screen.getByRole('button', { name: '机构确认签署' })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: '机构确认签署' }));
    expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
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

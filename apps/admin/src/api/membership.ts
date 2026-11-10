import type {
  SoftwareMembershipPlanData,
  SoftwareMembershipQuote,
  SoftwareMembershipOrderData,
  SoftwareMembershipPeriodData,
  SoftwareMembershipAllocationData,
  SoftwareMembershipWorkspaceData,
  SoftwareMembershipCommandResult,
  CreateSoftwareMembershipPlanInput,
  CreateSoftwareMembershipOrderInput,
  SoftwareMembershipPlanCommandInput,
  SoftwareMembershipOrderCommandInput,
  PlatformSoftwareMembershipOrderCommandInput,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max;
const integer = (v: unknown, min = 0, max = 100_000_000) =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const time = (v: unknown) => {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  )
    return false;
  const instant = Date.parse(v);
  if (!Number.isFinite(instant)) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(v);
  const minutes = offset
    ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1)
    : 0;
  return new Date(instant + minutes * 60_000).toISOString().slice(0, 19) === v.slice(0, 19);
};
const nullableTime = (v: unknown) => v === null || time(v);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nullableId = (v: unknown) => v === null || str(v, 160);
const list = <T>(v: unknown, valid: (item: unknown) => item is T): v is T[] =>
  Array.isArray(v) && v.length <= 100 && v.every(valid);
const invalid = (): never => {
  throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的会员资料不完整，请重新读取后核对');
};
function terms(v: Obj) {
  if (
    !['PRO', 'BUSINESS'].includes(String(v.tier)) ||
    ![30, 365].includes(Number(v.durationDays)) ||
    typeof v.durationDays !== 'number'
  )
    return false;
  const professional = v.tier === 'PRO';
  const annual = v.durationDays === 365;
  return (
    v.scope === 'ORG_MEMBERSHIP' &&
    v.currency === 'CNY' &&
    integer(v.amountFen, 1) &&
    v.eventLimit === (professional ? (annual ? 36 : 3) : annual ? 120 : 10) &&
    v.maxTeams === (professional ? 16 : 32) &&
    v.maxMatches === (professional ? 128 : 512)
  );
}
function plan(v: unknown): v is SoftwareMembershipPlanData {
  return (
    object(v) &&
    str(v.id, 160) &&
    str(v.code, 32) &&
    str(v.name, 80) &&
    integer(v.version, 1) &&
    terms(v) &&
    typeof v.available === 'boolean' &&
    integer(v.catalogVersion, 1) &&
    time(v.createdAt)
  );
}
function quote(v: unknown): v is SoftwareMembershipQuote {
  return (
    object(v) &&
    str(v.planId, 160) &&
    str(v.code, 32) &&
    str(v.name, 80) &&
    integer(v.version, 1) &&
    terms(v) &&
    v.validDays === v.durationDays &&
    hash(v.hash) &&
    nullableId(v.previousPeriodId)
  );
}
function review(v: unknown) {
  return (
    v === null ||
    (object(v) &&
      str(v.id, 160) &&
      ['PENDING_REVIEW', 'CONFIRMED', 'REJECTED'].includes(String(v.status)) &&
      str(v.submittedByUserId, 160) &&
      nullableId(v.reviewedByUserId) &&
      str(v.externalReference, 128) &&
      str(v.reason) &&
      time(v.createdAt) &&
      nullableTime(v.reviewedAt))
  );
}
function refund(v: unknown) {
  return (
    v === null ||
    (object(v) &&
      str(v.id, 160) &&
      [
        'REQUESTED',
        'PENDING_REVIEW',
        'PROCESSING',
        'SUCCEEDED',
        'REJECTED',
        'FAILED',
        'UNKNOWN',
      ].includes(String(v.status)) &&
      integer(v.amountFen, 1) &&
      str(v.requestedByUserId, 160) &&
      nullableId(v.submittedByUserId) &&
      nullableId(v.reviewedByUserId) &&
      (v.externalReference === null || str(v.externalReference, 128)) &&
      str(v.reason) &&
      time(v.createdAt) &&
      nullableTime(v.completedAt) &&
      nullableTime(v.acceptedAt))
  );
}
function order(v: unknown): v is SoftwareMembershipOrderData {
  return (
    object(v) &&
    str(v.id, 160) &&
    str(v.orgId, 160) &&
    v.eventId === null &&
    str(v.eventName) &&
    quote(v.quote) &&
    ['PENDING_PAYMENT', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'EXPIRED'].includes(
      String(v.status),
    ) &&
    integer(v.version, 1) &&
    [null, 'MANUAL', 'WECHAT_NATIVE'].includes(v.channel as null | string) &&
    str(v.createdByUserId, 160) &&
    time(v.createdAt) &&
    time(v.expiresAt) &&
    nullableTime(v.paidAt) &&
    typeof v.activated === 'boolean' &&
    review(v.paymentReview) &&
    refund(v.refund) &&
    object(v.capabilities) &&
    [
      'canCancel',
      'canRequestRefund',
      'canCreateNative',
      'canQueryPayment',
      'canSubmitPayment',
      'canConfirmPayment',
      'canRejectPayment',
      'canSubmitRefund',
      'canConfirmRefund',
      'canRejectRefund',
    ].every((key) => typeof (v.capabilities as Obj)[key] === 'boolean') &&
    (v.capabilities.canCloseNative === undefined ||
      typeof v.capabilities.canCloseNative === 'boolean') &&
    (v.refund === null || (v.refund as Obj).amountFen === v.quote.amountFen)
  );
}
function period(v: unknown): v is SoftwareMembershipPeriodData {
  if (
    !object(v) ||
    !str(v.id, 160) ||
    !str(v.orgId, 160) ||
    !str(v.orderId, 160) ||
    !str(v.planName, 80) ||
    !['PRO', 'BUSINESS'].includes(String(v.tier)) ||
    ![30, 365].includes(Number(v.durationDays)) ||
    typeof v.durationDays !== 'number' ||
    !integer(v.eventLimit, 1, 120) ||
    !integer(v.usedEvents, 0, 120) ||
    !integer(v.remainingEvents, 0, 120) ||
    Number(v.usedEvents) + Number(v.remainingEvents) !== v.eventLimit ||
    !integer(v.maxTeams, 2, 32) ||
    !integer(v.maxMatches, 1, 1024) ||
    !time(v.startsAt) ||
    !time(v.endsAt) ||
    Date.parse(String(v.endsAt)) <= Date.parse(String(v.startsAt)) ||
    !nullableId(v.previousPeriodId) ||
    !nullableTime(v.revokedAt) ||
    ![
      'ACTIVE',
      'SCHEDULED',
      'EXPIRED',
      'EXHAUSTED',
      'REFUND_PENDING',
      'REVOKED',
      'UNAVAILABLE',
    ].includes(String(v.state))
  )
    return false;
  const professional = v.tier === 'PRO',
    annual = v.durationDays === 365;
  return (
    v.eventLimit === (professional ? (annual ? 36 : 3) : annual ? 120 : 10) &&
    v.maxTeams === (professional ? 16 : 32) &&
    v.maxMatches === (professional ? 128 : 512) &&
    (v.state !== 'REVOKED' || v.revokedAt !== null) &&
    (v.state !== 'ACTIVE' || (v.revokedAt === null && Number(v.remainingEvents) > 0)) &&
    (v.state !== 'EXHAUSTED' || v.remainingEvents === 0)
  );
}
function allocation(v: unknown): v is SoftwareMembershipAllocationData {
  return (
    object(v) &&
    str(v.eventId, 160) &&
    str(v.eventName) &&
    str(v.orgId, 160) &&
    str(v.periodId, 160) &&
    v.source === 'MEMBERSHIP' &&
    integer(v.participantCount, 2, 32) &&
    integer(v.expectedMatchCount, 1, 1024) &&
    time(v.activatedAt)
  );
}
export function checkedMembershipWorkspace(
  v: unknown,
  orgId: string | null,
): SoftwareMembershipWorkspaceData {
  if (
    !object(v) ||
    v.orgId !== orgId ||
    (orgId === null ? v.organizationName !== null : !str(v.organizationName)) ||
    (orgId === null && v.platformOperator !== true) ||
    !['OFF', 'ENFORCED'].includes(String(v.mode)) ||
    typeof v.platformOperator !== 'boolean' ||
    typeof v.realPaymentEnabled !== 'boolean' ||
    typeof v.canPurchase !== 'boolean' ||
    (v.canPurchase && (v.mode !== 'ENFORCED' || orgId === null)) ||
    !time(v.serverTime) ||
    !hash(v.membershipVersion) ||
    typeof v.purchaseNotice !== 'string' ||
    !list(v.plans, plan) ||
    !list(v.orders, order) ||
    !list(v.periods, period) ||
    !list(v.allocations, allocation) ||
    !object(v.historyTruncated) ||
    !['plans', 'orders', 'periods', 'allocations'].every(
      (key) => typeof (v.historyTruncated as Obj)[key] === 'boolean',
    ) ||
    !Array.isArray(v.purchasablePlanIds) ||
    v.purchasablePlanIds.length > 100 ||
    !v.purchasablePlanIds.every((id) => str(id, 160)) ||
    new Set(v.purchasablePlanIds).size !== v.purchasablePlanIds.length ||
    !v.purchasablePlanIds.every((id) =>
      (v.plans as SoftwareMembershipPlanData[]).some((p) => p.id === id && p.available),
    ) ||
    ((!v.canPurchase || v.mode !== 'ENFORCED' || orgId === null) &&
      v.purchasablePlanIds.length > 0) ||
    (orgId !== null &&
      [...v.orders, ...v.periods, ...v.allocations].some((row) => row.orgId !== orgId))
  )
    invalid();
  const data = v as unknown as SoftwareMembershipWorkspaceData;
  if (
    [data.plans, data.orders, data.periods].some(
      (rows) => new Set(rows.map((row) => row.id)).size !== rows.length,
    ) ||
    new Set(data.allocations.map((row) => row.eventId)).size !== data.allocations.length
  )
    invalid();
  // Compare only against the server snapshot. A client clock must not decide whether credits are usable.
  for (const p of data.periods) {
    const at = Date.parse(data.serverTime),
      start = Date.parse(p.startsAt),
      end = Date.parse(p.endsAt);
    if (
      (p.state === 'ACTIVE' && (at < start || at >= end)) ||
      (p.state === 'SCHEDULED' && at >= start) ||
      (p.state === 'EXPIRED' && at < end)
    )
      invalid();
  }
  return structuredClone(data);
}
function checkedResult(
  v: unknown,
  orgId: string | null,
  orderId?: string,
): SoftwareMembershipCommandResult {
  if (
    !object(v) ||
    !order(v.order) ||
    (orgId !== null && v.order.orgId !== orgId) ||
    (orderId !== undefined && v.order.id !== orderId) ||
    !(
      v.nativePayment === null ||
      (object(v.nativePayment) &&
        str(v.nativePayment.codeUrl, 2048) &&
        /^weixin:\/\/wxpay\//.test(String(v.nativePayment.codeUrl)))
    ) ||
    !(v.notice === undefined || typeof v.notice === 'string')
  )
    invalid();
  return structuredClone(v) as unknown as SoftwareMembershipCommandResult;
}
export function createMembershipApi(client: ApiClient, orgId?: string) {
  if (orgId !== undefined && !orgId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择机构');
  const base =
    orgId === undefined
      ? '/v1/platform/software-membership'
      : `/v1/orgs/${encodeURIComponent(orgId)}/software-membership`;
  const pending = new Set<AbortController>();
  const request = async (path: string, body?: unknown) => {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      return (
        await client.request<unknown>(base + path, {
          signal: controller.signal,
          ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        })
      ).data;
    } finally {
      clearTimeout(timer);
      pending.delete(controller);
    }
  };
  const ownerOnly = () => {
    if (orgId === undefined) throw new ApiError(0, 'INVALID_ORGANIZATION', '机构采购需要明确机构');
  };
  const operatorOnly = () => {
    if (orgId !== undefined) throw new ApiError(0, 'INVALID_CONTEXT', '套餐发布需要平台工作空间');
  };
  return {
    abortPending: () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    },
    workspace: async () => checkedMembershipWorkspace(await request(''), orgId ?? null),
    createOrder: async (input: CreateSoftwareMembershipOrderInput) => {
      ownerOnly();
      return checkedResult(
        await request('/orders', {
          commandId: input.commandId,
          planId: input.planId,
          expectedMembershipVersion: input.expectedMembershipVersion,
        }),
        orgId ?? null,
      );
    },
    buyerCommand: async (id: string, input: SoftwareMembershipOrderCommandInput) => {
      ownerOnly();
      return checkedResult(
        await request(`/orders/${encodeURIComponent(id)}/commands`, input),
        orgId ?? null,
        id,
      );
    },
    platformCommand: async (id: string, input: PlatformSoftwareMembershipOrderCommandInput) => {
      operatorOnly();
      return checkedResult(
        await request(`/orders/${encodeURIComponent(id)}/commands`, input),
        null,
        id,
      );
    },
    createPlan: async (input: CreateSoftwareMembershipPlanInput) => {
      operatorOnly();
      const v = await request('/plans', input);
      if (!object(v) || !plan(v.plan)) invalid();
      return (v as { plan: SoftwareMembershipPlanData }).plan;
    },
    planCommand: async (id: string, input: SoftwareMembershipPlanCommandInput) => {
      operatorOnly();
      const v = await request(`/plans/${encodeURIComponent(id)}/commands`, input);
      if (!object(v) || !plan(v.plan) || v.plan.id !== id) invalid();
      return (v as { plan: SoftwareMembershipPlanData }).plan;
    },
  };
}

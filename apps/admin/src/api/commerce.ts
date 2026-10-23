import type {
  CommerceCommandResult,
  CommerceOrderData,
  CommerceWorkspaceData,
  CreateCommerceOrderInput,
  CreateCommercePlanInput,
  CommercePlanCommandInput,
  CommerceOrderCommandInput,
  PlatformCommerceOrderCommandInput,
  CommerceReconciliationInput,
  CommercePlanData,
  CommerceReconciliationData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const count = (v: unknown, min = 0, max = 1e9) =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const invalid = (): never => {
  throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的商业资料不完整，请刷新后重试');
};
function plan(v: unknown): v is CommercePlanData {
  return (
    object(v) &&
    str(v.id) &&
    str(v.code) &&
    str(v.name) &&
    count(v.version, 1) &&
    v.currency === 'CNY' &&
    count(v.amountFen, 1, 100_000_000) &&
    count(v.maxTeams, 2, 32) &&
    count(v.maxMatches, 1, 1024) &&
    count(v.validDays, 1, 730) &&
    typeof v.available === 'boolean' &&
    count(v.catalogVersion, 1) &&
    time(v.createdAt)
  );
}
function order(v: unknown): v is CommerceOrderData {
  return (
    object(v) &&
    str(v.id) &&
    str(v.orgId) &&
    str(v.eventId) &&
    str(v.eventName) &&
    object(v.quote) &&
    str(v.quote.planId) &&
    str(v.quote.hash) &&
    v.quote.currency === 'CNY' &&
    count(v.quote.amountFen, 1, 100_000_000) &&
    count(v.quote.maxTeams, 2, 32) &&
    count(v.quote.maxMatches, 1, 1024) &&
    count(v.quote.validDays, 1, 730) &&
    count(v.version, 1) &&
    ['PENDING_PAYMENT', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'EXPIRED'].includes(
      String(v.status),
    ) &&
    [null, 'MANUAL', 'WECHAT_NATIVE'].includes(v.channel as null | string) &&
    typeof v.activated === 'boolean' &&
    time(v.createdAt) &&
    time(v.expiresAt) &&
    (v.paidAt === null || time(v.paidAt)) &&
    (v.paymentReview === null || object(v.paymentReview)) &&
    (v.refund === null || object(v.refund)) &&
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
    ].every((k) => typeof (v.capabilities as Obj)[k] === 'boolean')
  );
}
export function checkedCommerceWorkspace(v: unknown, orgId: string | null): CommerceWorkspaceData {
  if (
    !object(v) ||
    v.orgId !== orgId ||
    !['OFF', 'ENFORCED'].includes(String(v.mode)) ||
    typeof v.platformOperator !== 'boolean' ||
    typeof v.realPaymentEnabled !== 'boolean' ||
    typeof v.canPurchase !== 'boolean' ||
    !Array.isArray(v.plans) ||
    !v.plans.every(plan) ||
    !Array.isArray(v.orders) ||
    !v.orders.every((o) => order(o) && (orgId === null || o.orgId === orgId)) ||
    !Array.isArray(v.events) ||
    !v.events.every(
      (e) => object(e) && str(e.id) && str(e.name) && count(e.version, 1) && str(e.status),
    ) ||
    !Array.isArray(v.entitlements) ||
    !v.entitlements.every(
      (e) =>
        object(e) &&
        str(e.id) &&
        str(e.eventId) &&
        str(e.eventName) &&
        str(e.orderId) &&
        time(e.validUntil) &&
        count(e.maxTeams, 2, 32) &&
        count(e.maxMatches, 1, 1024) &&
        typeof e.activated === 'boolean' &&
        (e.revokedAt === null || time(e.revokedAt)),
    ) ||
    !Array.isArray(v.activations) ||
    !v.activations.every(
      (a) =>
        object(a) &&
        str(a.eventId) &&
        ['LEGACY', 'UNMETERED', 'PAID'].includes(String(a.source)) &&
        time(a.activatedAt),
    ) ||
    !Array.isArray(v.reconciliations)
  )
    invalid();
  return structuredClone(v) as unknown as CommerceWorkspaceData;
}
function checkedResult(
  v: unknown,
  id: string | undefined,
  orgId: string | null,
): CommerceCommandResult {
  if (
    !object(v) ||
    !order(v.order) ||
    (id !== undefined && v.order.id !== id) ||
    (orgId !== null && v.order.orgId !== orgId) ||
    !(
      v.nativePayment === null ||
      (object(v.nativePayment) &&
        str(v.nativePayment.codeUrl) &&
        /^weixin:\/\//.test(v.nativePayment.codeUrl) &&
        v.nativePayment.codeUrl.length <= 2048)
    ) ||
    !(v.notice === undefined || typeof v.notice === 'string')
  )
    invalid();
  return structuredClone(v) as unknown as CommerceCommandResult;
}
export function createCommerceApi(client: ApiClient, orgId?: string) {
  if (orgId !== undefined && !orgId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择机构');
  const base =
    orgId === undefined
      ? '/v1/platform/commerce'
      : `/v1/orgs/${encodeURIComponent(orgId)}/commerce`;
  const request = async (path: string, body?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      return (
        await client.request<unknown>(`${base}${path}`, {
          signal: controller.signal,
          ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        })
      ).data;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    workspace: async () => checkedCommerceWorkspace(await request(''), orgId ?? null),
    createOrder: async (input: CreateCommerceOrderInput) =>
      checkedResult(await request('/orders', input), undefined, orgId ?? null),
    buyerCommand: async (id: string, input: CommerceOrderCommandInput) =>
      checkedResult(
        await request(`/orders/${encodeURIComponent(id)}/commands`, input),
        id,
        orgId ?? null,
      ),
    platformCommand: async (id: string, input: PlatformCommerceOrderCommandInput) =>
      checkedResult(await request(`/orders/${encodeURIComponent(id)}/commands`, input), id, null),
    createPlan: async (input: CreateCommercePlanInput) => {
      const v = await request('/plans', input);
      if (!object(v) || !plan(v.plan)) invalid();
      return (v as unknown as { plan: CommercePlanData }).plan;
    },
    planCommand: async (id: string, input: CommercePlanCommandInput) => {
      const v = await request(`/plans/${encodeURIComponent(id)}/commands`, input);
      if (!object(v) || !plan(v.plan) || v.plan.id !== id) invalid();
      return (v as unknown as { plan: CommercePlanData }).plan;
    },
    reconcile: async (input: CommerceReconciliationInput) => {
      const v = await request('/reconciliations', input);
      if (
        !object(v) ||
        !object(v.reconciliation) ||
        !str(v.reconciliation.id) ||
        !Array.isArray(v.reconciliation.issues)
      )
        invalid();
      return (v as unknown as { reconciliation: CommerceReconciliationData }).reconciliation;
    },
  };
}

/** C05: per-event platform software fees only; all money is integer CNY fen. */
export type CommerceMode = 'OFF' | 'ENFORCED';
export interface CommercePlanData {
  id: string;
  code: string;
  version: number;
  name: string;
  currency: 'CNY';
  amountFen: number;
  maxTeams: number;
  maxMatches: number;
  validDays: number;
  available: boolean;
  catalogVersion: number;
  createdAt: string;
}
export interface CommerceQuote {
  planId: string;
  code: string;
  version: number;
  name: string;
  currency: 'CNY';
  amountFen: number;
  maxTeams: number;
  maxMatches: number;
  validDays: number;
  hash: string;
}
export type CommerceOrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED';
export interface CommercePaymentReviewData {
  id: string;
  status: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED';
  submittedByUserId: string;
  reviewedByUserId: string | null;
  externalReference: string;
  reason: string;
  createdAt: string;
  reviewedAt: string | null;
}
export interface CommerceRefundData {
  id: string;
  status:
    'REQUESTED' | 'PENDING_REVIEW' | 'PROCESSING' | 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'UNKNOWN';
  amountFen: number;
  requestedByUserId: string;
  submittedByUserId: string | null;
  reviewedByUserId: string | null;
  externalReference: string | null;
  reason: string;
  createdAt: string;
  completedAt: string | null;
  acceptedAt: string | null;
}
export interface CommerceOrderData {
  id: string;
  orgId: string;
  eventId: string;
  eventName: string;
  quote: CommerceQuote;
  status: CommerceOrderStatus;
  version: number;
  channel: 'MANUAL' | 'WECHAT_NATIVE' | null;
  createdByUserId: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  paymentReview: CommercePaymentReviewData | null;
  refund: CommerceRefundData | null;
  activated: boolean;
  capabilities: {
    canCancel: boolean;
    canRequestRefund: boolean;
    canCreateNative: boolean;
    canQueryPayment: boolean;
    canSubmitPayment: boolean;
    canConfirmPayment: boolean;
    canRejectPayment: boolean;
    canSubmitRefund: boolean;
    canConfirmRefund: boolean;
    canRejectRefund: boolean;
  };
}
export interface EventEntitlementData {
  id: string;
  eventId: string;
  eventName: string;
  orderId: string;
  validUntil: string;
  revokedAt: string | null;
  maxTeams: number;
  maxMatches: number;
  activated: boolean;
}
export interface EventCommercialActivationData {
  eventId: string;
  source: 'LEGACY' | 'UNMETERED' | 'PAID';
  entitlementId: string | null;
  activatedAt: string;
}
export interface CommerceWorkspaceData {
  mode: CommerceMode;
  orgId: string | null;
  platformOperator: boolean;
  realPaymentEnabled: boolean;
  canPurchase: boolean;
  plans: CommercePlanData[];
  orders: CommerceOrderData[];
  entitlements: EventEntitlementData[];
  activations: EventCommercialActivationData[];
  events: { id: string; name: string; version: number; status: string }[];
  reconciliations: CommerceReconciliationData[];
}
export interface CommerceReconciliationData {
  id: string;
  billDate: string;
  source: 'MANUAL' | 'WECHAT_NATIVE';
  hash: string;
  matchedCount: number;
  issues: { orderId: string | null; code: string; description: string }[];
  createdAt: string;
}
export interface CreateCommercePlanInput {
  commandId: string;
  code: string;
  name: string;
  amountFen: number;
  currency: 'CNY';
  maxTeams: number;
  maxMatches: number;
  validDays: number;
  reason: string;
}
export interface CommercePlanCommandInput {
  commandId: string;
  type: 'SET_AVAILABILITY';
  expectedCatalogVersion: number;
  available: boolean;
  reason: string;
}
export interface CreateCommerceOrderInput {
  commandId: string;
  eventId: string;
  planId: string;
  expectedEventVersion: number;
}
export interface CommerceOrderCommandInput {
  commandId: string;
  type: 'CANCEL' | 'REQUEST_REFUND' | 'CREATE_NATIVE' | 'QUERY_PAYMENT';
  expectedOrderVersion: number;
  reason?: string;
}
export interface PlatformCommerceOrderCommandInput {
  commandId: string;
  type:
    | 'SUBMIT_PAYMENT'
    | 'CONFIRM_PAYMENT'
    | 'REJECT_PAYMENT'
    | 'SUBMIT_REFUND'
    | 'CONFIRM_REFUND'
    | 'REJECT_REFUND'
    | 'QUERY_REFUND';
  expectedOrderVersion: number;
  reason: string;
  externalReference?: string;
}
export interface CommerceCommandResult {
  order: CommerceOrderData;
  nativePayment: null | { codeUrl: string };
  notice?: string;
}
export interface CommerceReconciliationInput {
  commandId: string;
  billDate: string;
  source: 'MANUAL' | 'WECHAT_NATIVE';
  /** Canonical CSV, at most 64 KiB, used only for explicit manual reconciliation. */
  csv?: string;
  reason: string;
}

import type {
  CommerceMode,
  CommerceQuote,
  CommerceOrderData,
  CommerceCommandResult,
  CommercePlanCommandInput,
  CommerceOrderCommandInput,
  PlatformCommerceOrderCommandInput,
} from './commerce.js';

export type SoftwareMembershipTier = 'PRO' | 'BUSINESS';
export type SoftwareMembershipDuration = 30 | 365;
export interface SoftwareMembershipPlanData {
  id: string;
  code: string;
  version: number;
  name: string;
  currency: 'CNY';
  amountFen: number;
  scope: 'ORG_MEMBERSHIP';
  tier: SoftwareMembershipTier;
  durationDays: SoftwareMembershipDuration;
  eventLimit: number;
  maxTeams: number;
  maxMatches: number;
  available: boolean;
  catalogVersion: number;
  createdAt: string;
}
/** Old EVENT quote shape/hash stays unchanged; these extra fields exist only on member orders. */
export interface SoftwareMembershipQuote extends CommerceQuote {
  scope: 'ORG_MEMBERSHIP';
  tier: SoftwareMembershipTier;
  durationDays: SoftwareMembershipDuration;
  eventLimit: number;
  previousPeriodId: string | null;
}
export interface SoftwareMembershipOrderData extends Omit<CommerceOrderData, 'eventId' | 'quote'> {
  eventId: null;
  quote: SoftwareMembershipQuote;
  /** true means at least one event consumed this period, not merely that the period has started. */
  activated: boolean;
}
export type SoftwareMembershipPeriodState =
  'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'REFUND_PENDING' | 'REVOKED' | 'UNAVAILABLE';
export interface SoftwareMembershipPeriodData {
  id: string;
  orgId: string;
  orderId: string;
  planName: string;
  tier: SoftwareMembershipTier;
  durationDays: SoftwareMembershipDuration;
  eventLimit: number;
  usedEvents: number;
  remainingEvents: number;
  maxTeams: number;
  maxMatches: number;
  startsAt: string;
  endsAt: string;
  previousPeriodId: string | null;
  revokedAt: string | null;
  state: SoftwareMembershipPeriodState;
}
export interface SoftwareMembershipAllocationData {
  eventId: string;
  eventName: string;
  orgId: string;
  periodId: string;
  source: 'MEMBERSHIP';
  participantCount: number;
  expectedMatchCount: number;
  activatedAt: string;
}
export interface SoftwareMembershipWorkspaceData {
  orgId: string | null;
  organizationName: string | null;
  mode: CommerceMode;
  platformOperator: boolean;
  realPaymentEnabled: boolean;
  canPurchase: boolean;
  serverTime: string;
  /** Deterministic read token, not a capability; eligibility is rechecked at checkout under locks. */
  membershipVersion: string;
  purchaseNotice: string;
  /** Only these server-authorized available plans may currently be ordered by this owner. */
  purchasablePlanIds: string[];
  plans: SoftwareMembershipPlanData[];
  orders: SoftwareMembershipOrderData[];
  periods: SoftwareMembershipPeriodData[];
  allocations: SoftwareMembershipAllocationData[];
  /** Quotas above are whole-period SQL counts, never calculated from these bounded history lists. */
  historyTruncated: { plans: boolean; orders: boolean; periods: boolean; allocations: boolean };
}
export interface CreateSoftwareMembershipPlanInput {
  commandId: string;
  code: string;
  name: string;
  currency: 'CNY';
  amountFen: number;
  tier: SoftwareMembershipTier;
  durationDays: SoftwareMembershipDuration;
  /** Quotas follow the fixed tier/period mapping, never a client-provided amount or role. */
  reason: string;
}
export interface CreateSoftwareMembershipOrderInput {
  commandId: string;
  planId: string;
  expectedMembershipVersion: string;
}
export interface SoftwareMembershipCommandResult extends Omit<CommerceCommandResult, 'order'> {
  order: SoftwareMembershipOrderData;
}
export type SoftwareMembershipPlanCommandInput = CommercePlanCommandInput;
export type SoftwareMembershipOrderCommandInput = CommerceOrderCommandInput;
export type PlatformSoftwareMembershipOrderCommandInput = PlatformCommerceOrderCommandInput;

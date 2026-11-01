export type SponsorContractState =
  'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'CLOSED';
export type SponsorSettlementState =
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'SENDING'
  | 'UNKNOWN'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'REJECTED';
export interface SponsorShare {
  id: string;
  beneficiaryOrgId: string;
  merchantId: string;
  displayName: string;
  basisPoints: number;
  retained: boolean;
  authorizationVersion: string;
}
export interface SponsorAllocation extends SponsorShare {
  amountFen: number;
}
export interface SponsorContractData {
  id: string;
  orgId: string;
  campaignId: string;
  payerUserId: string;
  title: string;
  totalFen: number;
  currency: 'CNY';
  allowedFeeFen: number;
  terms: string;
  startsAt: string;
  endsAt: string;
  status: SponsorContractState;
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  ownerSignedBy: string | null;
  advertiserSignedAt: string | null;
  shares: SponsorShare[];
}
export interface SponsorOrderData {
  id: string;
  orgId: string;
  contractId: string;
  payerUserId: string;
  totalFen: number;
  status: 'WAITING_PAYMENT' | 'DELIVERING' | 'ACCEPTED' | 'DISPUTED' | 'CLOSED';
  version: number;
  verifiedFeeFen: number | null;
  tradeOrderId: string | null;
  paidFen: number;
  refundReservedFen: number;
  refundedFen: number;
}
export interface SponsorSettlementData {
  id: string;
  orderId: string;
  version: number;
  state: SponsorSettlementState;
  poolFen: number;
  outOrderNo: string;
  approvals: string[];
  approvalRequired: number;
  items: Array<{
    id: string;
    beneficiaryOrgId: string;
    displayName: string;
    amountFen: number;
    retained: boolean;
    state: string;
    returnedFen: number;
  }>;
  finished: boolean;
}

export interface SponsorCommerceInboxData {
  organizations: Array<{ id: string; name: string; role: 'ADVERTISER' }>;
  contracts: Array<{
    id: string;
    orgId: string;
    title: string;
    totalFen: number;
    currency: 'CNY';
    status: SponsorContractState;
    version: number;
    orderId: string | null;
  }>;
  truncated: boolean;
}

export interface SponsorRefundRetryData {
  id: string;
  orderId: string;
  planId: string;
  previousRefundId: string;
  status: 'IN_REVIEW' | 'APPROVED' | 'CLAIMED' | 'REJECTED';
  evidence: string;
  proposedBy: string;
  reviewedBy: string | null;
  tradeRefundId: string | null;
  version: number;
}

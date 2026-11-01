import type { PoolClient } from 'pg';
import type { TradeSourceKind } from '../../../packages/contracts/trade.js';

/** Source readers execute inside the caller's existing calendar/financial transaction. */
export type AdditionalTradeSourceKind = Extract<
  TradeSourceKind,
  'TRAINING_ENROLLMENT' | 'SPONSOR_ORDER'
>;
export interface TradeSourceReference {
  orgId: string;
  payerId: string | null;
  beneficiaryId: string;
}
export interface TradeSourceSnapshot extends TradeSourceReference {
  beneficiaryName: string;
  title: string;
  version: number;
  totalFen: number;
  platformFeeFen: number;
  /** Only legacy trade_terms IDs belong here. New domain contract IDs use consentId. */
  termsId: string | null;
  consentId?: string;
  terms: string;
  merchantKey: string | null;
  payable: boolean;
  fulfilled: boolean;
  disputed: boolean;
  valid: boolean;
  expiresAt: string | null;
  identity: Record<string, any>;
}
export interface AdditionalTradeSourceAdapter {
  reference(c: PoolClient, sourceId: string): Promise<TradeSourceReference>;
  read(c: PoolClient, sourceId: string): Promise<TradeSourceSnapshot>;
  /** Sponsor batches cannot use the legacy single-recipient settlement workflow. */
  settlementMode: 'SINGLE' | 'MODULE';
  requiresProfitSharing: boolean;
  /** Explicitly reconciled module distributions; never infer this from a closed UI status. */
  closureFunds?(
    c: PoolClient,
    sourceId: string,
    tradeOrderId: string,
  ): Promise<{
    dischargedFen: number;
    unresolved: boolean;
  }>;
  assertRefundAllocation(
    c: PoolClient,
    sourceId: string,
    allocationId: string,
    amountFen: number,
  ): Promise<void>;
  claimRefundAllocation?(
    c: PoolClient,
    input: { sourceId: string; allocationId: string; amountFen: number; refundId: string },
  ): Promise<void>;
  /** Read-only proof that an unsent sponsor retry may be rejected after an ancestor succeeded.
   * Called by both the capability view and the mutation under source/common-order locks. */
  assertRefundRevocation?(
    c: PoolClient,
    sourceId: string,
    allocationId: string,
    amountFen: number,
  ): Promise<void>;
  /** Recheck return/retention facts before common approval and dispatch, under the order lock. */
  assertRefundDispatch?(
    c: PoolClient,
    sourceId: string,
    allocationId: string,
    amountFen: number,
  ): Promise<void>;
}
export type AdditionalTradeSourceAdapters = Partial<
  Record<AdditionalTradeSourceKind, AdditionalTradeSourceAdapter>
>;
export function isAdditionalTradeSource(kind: string): kind is AdditionalTradeSourceKind {
  return kind === 'TRAINING_ENROLLMENT' || kind === 'SPONSOR_ORDER';
}

export type TradeSourceKind = 'ENTRY_FEE' | 'ENTRY_DEPOSIT' | 'LOCAL_BOOKING' | 'PLAYER_APPEARANCE';
export type TradeChannel = 'NATIVE' | 'JSAPI';
export interface TradeQuote {
  kind: TradeSourceKind;
  sourceId: string;
  sourceVersion: number;
  title: string;
  totalFen: number;
  currency: 'CNY';
  serviceFen: number;
  platformFeeFen: number;
  merchantName: string;
  beneficiaryName: string;
  terms: string;
  termsId: string | null;
  sourceHash: string;
  payable: boolean;
  fulfilled: boolean;
  disputed: boolean;
  expiresAt: string | null;
}
export type TradeCheckout =
  | { mode: 'NATIVE'; codeUrl: string }
  | {
      mode: 'JSAPI';
      timeStamp: string;
      nonceStr: string;
      package: string;
      signType: 'RSA';
      paySign: string;
    };
export interface TradeOrderData {
  id: string;
  orgId: string;
  kind: TradeSourceKind;
  sourceId: string;
  sourceVersion: number;
  status: 'OPEN' | 'SOURCE_CONFLICT' | 'COMPLETED';
  version: number;
  title: string;
  totalFen: number;
  currency: 'CNY';
  merchantName: string;
  terms: string;
  paidFen: number;
  refundReservedFen: number;
  refundedFen: number;
  deductionReservedFen: number;
  deductionApprovedFen: number;
  settlementReservedFen: number;
  settledFen: number;
  refundableFen: number;
  currentSource: { payable: boolean; fulfilled: boolean; disputed: boolean; valid: boolean };
  attempts: {
    id: string;
    channel: TradeChannel;
    status: string;
    expiresAt: string;
    paidAt: string | null;
    checkout: TradeCheckout | null;
  }[];
  refunds: {
    id: string;
    amountFen: number;
    status: string;
    reason: string;
    proposedBy: string;
    reviewedBy: string | null;
  }[];
  deductions: {
    id: string;
    amountFen: number;
    status: string;
    reason: string;
    evidenceReference: string;
    proposedBy: string;
    reviewedBy: string | null;
  }[];
  settlements: {
    id: string;
    amountFen: number;
    status: string;
    returnedFen: number;
    proposedBy: string;
    reviewedBy: string | null;
  }[];
  capabilities: {
    canPay: boolean;
    native: boolean;
    jsapi: boolean;
    canRequestRefund: boolean;
    canManage: boolean;
    settlementAvailable: boolean;
  };
}

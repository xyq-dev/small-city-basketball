import type {
  WechatPayOrder,
  WechatPayRefund,
  WechatPayNotification,
  WechatPayBill,
} from './commerce/wechatpay.js';
export interface TradeJsapiResult {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}
export interface TradePayments {
  readonly enabled: boolean;
  native(input: {
    outTradeNo: string;
    description: string;
    totalFen: number;
    currency: 'CNY';
    expiresAt?: string;
    profitSharing?: boolean;
  }): Promise<{ codeUrl: string }>;
  jsapi?(input: {
    outTradeNo: string;
    description: string;
    totalFen: number;
    currency: 'CNY';
    expiresAt?: string;
    profitSharing?: boolean;
    openid: string;
  }): Promise<TradeJsapiResult>;
  queryOrder(id: string): Promise<WechatPayOrder>;
  refund(input: {
    outTradeNo: string;
    outRefundNo: string;
    totalFen: number;
    refundFen: number;
    currency: 'CNY';
    reason?: string;
  }): Promise<WechatPayRefund>;
  queryRefund(id: string): Promise<WechatPayRefund>;
  verifyNotification(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): WechatPayNotification;
  downloadBill(date: string): Promise<WechatPayBill>;
}
export interface TradeSplitResult {
  transactionId: string;
  outOrderNo: string;
  orderId: string;
  state: 'PROCESSING' | 'FINISHED';
  receiver: {
    merchantId: string;
    amountFen: number;
    result: 'PENDING' | 'SUCCESS' | 'CLOSED';
    detailId: string | null;
  };
}
export interface TradeReturnResult {
  outOrderNo: string;
  outReturnNo: string;
  returnId: string;
  merchantId: string;
  amountFen: number;
  state: 'PROCESSING' | 'SUCCESS' | 'FAILED';
}
export interface TradeSettlementProvider {
  readonly enabled: boolean;
  readonly returnSupported: boolean;
  split(input: {
    transactionId: string;
    outOrderNo: string;
    receiverMerchantId: string;
    amountFen: number;
    description: string;
  }): Promise<TradeSplitResult>;
  query(input: {
    transactionId: string;
    outOrderNo: string;
    receiverMerchantId: string;
    amountFen: number;
  }): Promise<TradeSplitResult>;
  returnFunds(input: {
    outOrderNo: string;
    outReturnNo: string;
    receiverMerchantId: string;
    amountFen: number;
    description: string;
  }): Promise<TradeReturnResult>;
  queryReturn(input: {
    outOrderNo: string;
    outReturnNo: string;
    receiverMerchantId: string;
    amountFen: number;
  }): Promise<TradeReturnResult>;
}
export interface TradeMerchant {
  key: string;
  merchantId: string;
  appId: string;
  displayName: string;
  payments: TradePayments;
  /** Explicit opt-in for charging only newly created player appearances. */
  playerFeesEnabled?: boolean;
  receivers: Record<string, { merchantId: string; displayName: string }>;
  settlements?: TradeSettlementProvider;
}
export interface TradeRuntime {
  merchants?: Record<string, TradeMerchant>;
  /** Immutable historical key: orgId + colon + merchant key, retained for old pending orders. */
  historicalMerchants?: Record<string, TradeMerchant>;
  encryptionKey?: Buffer;
  resolvePayer?: (input: {
    actorId: string;
    sessionId: string;
    merchantKey: string;
    code: string;
  }) => Promise<{ openid: string; appId: string }>;
}

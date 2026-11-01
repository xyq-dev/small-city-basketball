import type { AdditionalTradeSourceAdapters } from './trade-source-adapter.js';
import type { TrainingTradeHooks } from './training-source-hooks.js';
import type { TradeService } from './trade-service.js';
import {
  trainingSourceReference,
  readTrainingTradeSource,
  assertTrainingRefundAllocation,
  assertTrainingRefundDispatch,
} from './training-trade-source.js';

export function remainingSixTradeSources(): AdditionalTradeSourceAdapters {
  return {
    TRAINING_ENROLLMENT: {
      reference: trainingSourceReference,
      read: readTrainingTradeSource,
      settlementMode: 'SINGLE',
      requiresProfitSharing: false,
      assertRefundAllocation: assertTrainingRefundAllocation,
      assertRefundDispatch: assertTrainingRefundDispatch,
    },
  };
}
export function trainingTradeHooks(trade: TradeService): TrainingTradeHooks {
  return {
    binding: trade.sourceMerchantBinding.bind(trade),
    capture: (c, a, i) =>
      trade.captureSourceCharge(c, a, {
        kind: 'TRAINING_ENROLLMENT',
        sourceId: i.enrollmentId,
        acceptedTermsId: i.acceptedTermsId,
        chargeConsent: i.chargeConsent,
      }),
    payment: async (c, id) => {
      const p = await trade.sourcePayment(c, 'TRAINING_ENROLLMENT', id);
      return p;
    },
    refund: (c, a, i) =>
      trade.captureSourceRefund(c, a, {
        kind: 'TRAINING_ENROLLMENT',
        sourceId: i.enrollmentId,
        allocationId: i.allocationId,
        amountFen: i.amountFen,
        reason: i.reason,
      }),
    refundStatus: (c, id) => trade.sourceRefundStatus(c, id),
  };
}

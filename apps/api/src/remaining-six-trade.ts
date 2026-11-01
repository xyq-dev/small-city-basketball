import type { AdditionalTradeSourceAdapters } from './trade-source-adapter.js';
import type { TrainingTradeHooks } from './training-source-hooks.js';
import type { TradeService } from './trade-service.js';
import {
  trainingSourceReference,
  readTrainingTradeSource,
  assertTrainingRefundAllocation,
  assertTrainingRefundDispatch,
} from './training-trade-source.js';
import {
  sponsorSourceReference,
  readSponsorTradeSource,
  assertSponsorRefundAllocation,
  claimSponsorRefundAllocation,
  assertSponsorRefundDispatch,
  readSponsorClosureFunds,
} from './sponsor-commerce-source.js';

export function remainingSixTradeSources(
  options: { trainingEnabled?: boolean; sponsorEnabled?: boolean } = {},
): AdditionalTradeSourceAdapters {
  return {
    TRAINING_ENROLLMENT: {
      reference: trainingSourceReference,
      read: async (c, id) => {
        const source = await readTrainingTradeSource(c, id);
        return { ...source, payable: options.trainingEnabled === true && source.payable };
      },
      settlementMode: 'SINGLE',
      requiresProfitSharing: false,
      assertRefundAllocation: assertTrainingRefundAllocation,
      assertRefundDispatch: assertTrainingRefundDispatch,
    },
    SPONSOR_ORDER: {
      reference: sponsorSourceReference,
      read: async (c, id) => {
        const source = await readSponsorTradeSource(c, id);
        return { ...source, payable: options.sponsorEnabled === true && source.payable };
      },
      settlementMode: 'MODULE',
      requiresProfitSharing: true,
      closureFunds: readSponsorClosureFunds,
      assertRefundAllocation: async (c, id, allocation, amount) => {
        await assertSponsorRefundAllocation(c, id, allocation, amount);
      },
      claimRefundAllocation: claimSponsorRefundAllocation,
      assertRefundDispatch: assertSponsorRefundDispatch,
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

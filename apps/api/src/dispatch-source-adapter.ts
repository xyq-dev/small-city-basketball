import type { LocalServicesService } from './local-services-service.js';
import type { DispatchOptions } from './dispatch-service.js';
import { tradeFail } from './trade-domain.js';

/** A paid accepted quote must never become an uncharged canonical reservation. */
export function createDispatchSourceHook(
  local: Pick<LocalServicesService, 'createDispatchBookingInTransaction'>,
): NonNullable<DispatchOptions['createLocalBooking']> {
  return async (c, actor, input) => {
    const result = await local.createDispatchBookingInTransaction(c, actor, input);
    const quote = (
      await c.query('SELECT quote,quote_hash FROM dispatch_offers WHERE id=$1', [
        input.verifiedDispatchQuote.offerId,
      ])
    ).rows[0];
    if (!quote || quote.quote_hash !== input.verifiedDispatchQuote.quoteHash)
      tradeFail('DISPATCH_QUOTE_CHANGED', '派单原报价无法核验');
    if (quote.quote.totalMinor > 0) {
      const order = (
        await c.query(
          "SELECT total_fen,merchant_key,payer_user_id FROM trade_orders WHERE kind='LOCAL_BOOKING' AND source_id=$1 FOR SHARE",
          [result.resourceId],
        )
      ).rows[0];
      if (
        !order ||
        order.total_fen !== quote.quote.totalMinor ||
        order.merchant_key !== quote.quote.merchantKey ||
        order.payer_user_id !== actor.user.id
      )
        tradeFail('DISPATCH_TRADE_UNAVAILABLE', '原报价收款尚未就绪，本次预约和占位已回滚', 503);
    }
    return result;
  };
}

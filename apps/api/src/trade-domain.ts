import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { TradeSourceKind, TradeCheckout } from '../../../packages/contracts/trade.js';
import { ApiError } from './errors.js';
import { objectInput, resourceId, text } from './validation.js';
export function tradeFail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export const tradeHash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function tradeId(v: unknown): string {
  if (typeof v !== 'string') tradeFail('INVALID_TRADE_INPUT', '资源编号无效', 422);
  return resourceId(v as string);
}
export function tradeVersion(v: unknown): number {
  if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 2147483647)
    tradeFail('INVALID_TRADE_INPUT', '请提供有效版本', 422);
  return Number(v);
}
export function tradeFen(v: unknown): number {
  if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 100000000)
    tradeFail('INVALID_TRADE_AMOUNT', '金额须为有效整数分', 422);
  return Number(v);
}
export function tradeReason(v: unknown): string {
  return text(v, 'reason', 4, 1000);
}
export function parseTradeSource(raw: unknown) {
  const b = objectInput(raw, ['kind', 'sourceId', 'expectedSourceVersion']);
  if (
    !['ENTRY_FEE', 'ENTRY_DEPOSIT', 'LOCAL_BOOKING', 'PLAYER_APPEARANCE'].includes(String(b.kind))
  )
    tradeFail('INVALID_TRADE_SOURCE', '收费来源无效', 422);
  return {
    kind: b.kind as TradeSourceKind,
    sourceId: tradeId(b.sourceId),
    expectedSourceVersion: tradeVersion(b.expectedSourceVersion),
  };
}
export function assertTradeVersion(actual: number, expected: number) {
  if (actual !== expected) tradeFail('VERSION_CONFLICT', '资料已更新，请重新核对');
}
export function tradeBalances(
  paid: number,
  refunds: { amount_fen: number; status: string }[],
  deductions: { amount_fen: number; status: string }[],
  settlements: { amount_fen: number; status: string; return_amount_fen?: number }[],
) {
  const sum = (items: { amount_fen: number }[]) => items.reduce((n, x) => n + x.amount_fen, 0);
  const refundReservedFen = sum(refunds.filter((x) => !['REJECTED', 'FAILED'].includes(x.status)));
  const refundedFen = sum(refunds.filter((x) => x.status === 'SUCCEEDED'));
  const deductionReservedFen = sum(
    deductions.filter((x) => ['PENDING_REVIEW', 'APPROVED', 'REVERSAL_PENDING'].includes(x.status)),
  );
  const deductionApprovedFen = sum(deductions.filter((x) => x.status === 'APPROVED'));
  const settlementReservedFen = settlements
    .filter((x) => !['REJECTED', 'FAILED', 'RETURNED'].includes(x.status))
    .reduce((n, x) => n + x.amount_fen - (x.return_amount_fen ?? 0), 0);
  const settledFen = settlements
    .filter((x) => ['SUCCEEDED', 'RETURNING', 'RETURN_UNKNOWN'].includes(x.status))
    .reduce((n, x) => n + x.amount_fen - (x.return_amount_fen ?? 0), 0);
  if (
    ![paid, refundReservedFen, deductionReservedFen, settlementReservedFen].every(
      (x) => Number.isSafeInteger(x) && x >= 0,
    ) ||
    refundReservedFen + deductionReservedFen > paid
  )
    tradeFail('TRADE_BALANCE_INVALID', '资金来源与金额无法核验');
  return {
    paidFen: paid,
    refundReservedFen,
    refundedFen,
    deductionReservedFen,
    deductionApprovedFen,
    settlementReservedFen,
    settledFen,
    refundableFen: paid - refundReservedFen - deductionReservedFen,
  };
}
/** Recomputed under the shared order lock before proposal, approval and dispatch. */
export function tradeSettlementCapacity(
  kind: TradeSourceKind,
  balances: { paidFen: number; refundReservedFen: number; deductionApprovedFen: number },
  platformFeeFen: number,
  settlements: { id: string; amount_fen: number; status: string; return_amount_fen?: number }[],
  excludeId?: string,
) {
  const allocated = settlements
    .filter((s) => s.id !== excludeId && !['REJECTED', 'FAILED', 'RETURNED'].includes(s.status))
    .reduce((n, s) => n + s.amount_fen - (s.return_amount_fen ?? 0), 0);
  const revenue =
    kind === 'ENTRY_DEPOSIT'
      ? Math.min(balances.deductionApprovedFen, balances.paidFen - balances.refundReservedFen)
      : balances.paidFen - balances.refundReservedFen - platformFeeFen;
  return Math.max(0, revenue - allocated);
}
export function tradeSeal(key: Buffer, id: string, value: TradeCheckout): Buffer {
  if (key.length !== 32) throw Error('Trade checkout encryption configuration invalid');
  const iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from('scb-trade-checkout:v1:' + id));
  const body = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]);
}
export function tradeOpen(key: Buffer, id: string, value: Buffer): TradeCheckout {
  try {
    if (key.length !== 32 || !Buffer.isBuffer(value) || value.length < 30 || value[0] !== 1)
      throw Error();
    const c = createDecipheriv('aes-256-gcm', key, value.subarray(1, 13));
    c.setAAD(Buffer.from('scb-trade-checkout:v1:' + id));
    c.setAuthTag(value.subarray(13, 29));
    return JSON.parse(Buffer.concat([c.update(value.subarray(29)), c.final()]).toString('utf8'));
  } catch {
    return tradeFail('TRADE_CHECKOUT_UNAVAILABLE', '原支付参数无法安全读取，请查询原订单', 503);
  }
}

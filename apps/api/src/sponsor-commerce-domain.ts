import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { objectInput, resourceId, text } from './validation.js';
import type {
  SponsorAllocation,
  SponsorShare,
} from '../../../packages/contracts/sponsor-commerce.js';

export function sponsorFail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export const sponsorId = (value: unknown) => resourceId(String(value));
export function sponsorInt(value: unknown, min = 0, max = 100_000_000) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    sponsorFail('SPONSOR_INVALID_AMOUNT', '金额和数量须为有效整数', 422);
  return value as number;
}
export function sponsorVersion(actual: number, expected: unknown) {
  if (actual !== sponsorInt(expected, 1))
    sponsorFail('SPONSOR_VERSION_CONFLICT', '资料已变化，请重新读取并审阅');
}
export function sponsorHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function sponsorDate(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    sponsorFail('SPONSOR_INVALID_DATE', '请填写带时区的有效日期', 422);
  return new Date(value as string).toISOString();
}
export function sponsorShareInput(
  raw: unknown,
): Array<{ beneficiaryOrgId: string; basisPoints: number }> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 11)
    sponsorFail('SPONSOR_INVALID_SHARES', '受益机构数量须为1–11', 422);
  const result = (raw as unknown[]).map((v) => {
    const b = objectInput(v, ['beneficiaryOrgId', 'basisPoints']);
    return {
      beneficiaryOrgId: sponsorId(b.beneficiaryOrgId),
      basisPoints: sponsorInt(b.basisPoints, 1, 10000),
    };
  });
  if (
    new Set(result.map((x) => x.beneficiaryOrgId)).size !== result.length ||
    result.reduce((n, x) => n + x.basisPoints, 0) !== 10000
  )
    sponsorFail('SPONSOR_INVALID_SHARES', '机构不能重复，分配比例须精确等于10000基点', 422);
  return result;
}
/** Integer largest-remainder allocation. Tie order is immutable beneficiary ID. */
export function allocateSponsorPool(poolFen: number, shares: SponsorShare[]): SponsorAllocation[] {
  sponsorInt(poolFen);
  if (
    !shares.length ||
    shares.reduce((n, x) => n + sponsorInt(x.basisPoints, 1, 10000), 0) !== 10000 ||
    new Set(shares.map((x) => x.id)).size !== shares.length
  )
    sponsorFail('SPONSOR_INVALID_SHARES', '分配快照无效', 422);
  const rows = shares.map((x) => ({
    ...x,
    amountFen: Math.floor((poolFen * x.basisPoints) / 10000),
  }));
  const priority = rows
    .map((x, i) => ({ i, r: (poolFen * x.basisPoints) % 10000, id: x.id }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  const left = poolFen - rows.reduce((n, x) => n + x.amountFen, 0);
  for (let n = 0; n < left; n++) rows[priority[n]!.i]!.amountFen++;
  return rows;
}
/** Prefix of ordered rational events k/A_i. Binary-search kth event with exact bigint comparisons. */
export function allocateSponsorRefund(
  totalFen: number,
  allocation: Array<{ id: string; amountFen: number }>,
) {
  sponsorInt(totalFen);
  const rows = allocation.map((x) => ({ ...x, amountFen: sponsorInt(x.amountFen), refundFen: 0 }));
  const pool = rows.reduce((n, x) => n + x.amountFen, 0);
  if (totalFen > pool || new Set(rows.map((x) => x.id)).size !== rows.length)
    sponsorFail('SPONSOR_REFUND_EXCEEDS_POOL', '退款分摊不能超过原分配池', 422);
  if (!totalFen) return rows;
  const countAt = (numerator: bigint, denominator: bigint) =>
    rows.reduce((n, x) => n + Number((numerator * BigInt(x.amountFen)) / denominator), 0);
  // A_i <= 1e8, distinct rationals differ by >= 1e-16. Fixed 2^64 denominator isolates the boundary.
  const denominator = 1n << 64n;
  let low = 0n,
    high = denominator;
  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    if (countAt(mid, denominator) >= totalFen) high = mid;
    else low = mid;
  }
  for (const x of rows) x.refundFen = Number((low * BigInt(x.amountFen)) / denominator);
  let remaining = totalFen - rows.reduce((n, x) => n + x.refundFen, 0);
  while (remaining-- > 0) {
    const candidates = rows
      .filter((x) => x.refundFen < x.amountFen)
      .sort((a, b) => {
        const d =
          BigInt(a.refundFen + 1) * BigInt(b.amountFen) -
          BigInt(b.refundFen + 1) * BigInt(a.amountFen);
        return d < 0n ? -1 : d > 0n ? 1 : a.id.localeCompare(b.id);
      });
    if (!candidates[0]) sponsorFail('SPONSOR_REFUND_INVALID', '退款分配无法核验');
    candidates[0]!.refundFen++;
  }
  return rows;
}
export function sponsorCommand(raw: unknown, extra: string[] = []) {
  const b = objectInput(raw, ['commandId', 'expectedVersion', 'action', ...extra]);
  return { b, commandId: sponsorId(b.commandId), action: text(b.action, 'action', 1, 40) };
}

/** Receipt from a trusted server-side, order-scoped funds reservation, never client form data. */
export interface SponsorAdvanceCoverage {
  reservationId: string;
  sourceId: string;
  allocationId: string;
  tradeOrderId: string;
  paymentId: string;
  merchantKey: string;
  merchantId: string;
  currency: 'CNY';
  amountFen: number;
  proofHash: string;
  channelSupportsOwnFundsRefund: true;
  reservedUntilRefundFinal: true;
}
export function validateSponsorAdvanceCoverage(
  raw: unknown,
  binding: Omit<
    SponsorAdvanceCoverage,
    'reservationId' | 'proofHash' | 'channelSupportsOwnFundsRefund' | 'reservedUntilRefundFinal'
  >,
): SponsorAdvanceCoverage {
  const r = objectInput(raw, [
    'reservationId',
    'sourceId',
    'allocationId',
    'tradeOrderId',
    'paymentId',
    'merchantKey',
    'merchantId',
    'currency',
    'amountFen',
    'proofHash',
    'channelSupportsOwnFundsRefund',
    'reservedUntilRefundFinal',
  ]);
  if (
    Object.entries(binding).some(([key, value]) => r[key] !== value) ||
    r.channelSupportsOwnFundsRefund !== true ||
    r.reservedUntilRefundFinal !== true ||
    typeof r.proofHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.proofHash)
  )
    sponsorFail('SPONSOR_COVERAGE_UNVERIFIED', '自有资金凭据未按原商户、原订单和原退款额度锁定');
  sponsorId(r.reservationId);
  sponsorInt(r.amountFen, 1);
  return r as unknown as SponsorAdvanceCoverage;
}

export function assertSponsorRecipientLimit(rows: Array<{ retained: boolean }>) {
  if (rows.filter((r) => !r.retained).length > 10)
    sponsorFail('SPONSOR_CHANNEL_LIMIT', '最多支持10个外部接收商户，11方须含原商户留存', 422);
}

/** Channel quota is an integer amount of the original payment, not only a ratio of the allocation pool. */
export function assertSponsorChannelAmount(
  paidFen: number,
  allocation: Array<{ retained: boolean; amountFen: number }>,
  maximumSplitBps: number,
) {
  sponsorInt(paidFen, 1);
  sponsorInt(maximumSplitBps, 0, 10000);
  const external = allocation
    .filter((x) => !x.retained)
    .reduce((n, x) => n + sponsorInt(x.amountFen), 0);
  if (external > Math.floor((paidFen * maximumSplitBps) / 10000))
    sponsorFail('SPONSOR_CHANNEL_LIMIT', '按整数分计算的外部分配超过原支付渠道额度', 422);
}

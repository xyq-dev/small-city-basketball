import { createHash } from 'node:crypto';
import type {
  CommerceQuote,
  CreateCommercePlanInput,
  CommerceOrderCommandInput,
  PlatformCommerceOrderCommandInput,
} from '@small-city-basketball/contracts';
import { ApiError } from '../errors.js';
import { invalid, objectInput, resourceId, text } from '../validation.js';
import { expectedVersion } from '../registration-validation.js';
export const MAX_FEN = 100_000_000;
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    invalid('请检查商业资料', { [field]: `请输入${min}至${max}的整数` });
  return value as number;
}
export function commandId(value: unknown): string {
  return resourceId(typeof value === 'string' ? value : '');
}
export function reason(value: unknown): string {
  return text(value, 'reason', 4, 500);
}
export function reference(value: unknown): string {
  const result = text(value, 'externalReference', 4, 128);
  if (/[\u0000-\u001f\u007f,]/.test(result))
    invalid('交易引用不能包含逗号或控制字符', {
      externalReference: '请使用单行无逗号的真实交易引用',
    });
  return result;
}
export function parsePlan(raw: unknown): CreateCommercePlanInput {
  const v = objectInput(raw, [
    'commandId',
    'code',
    'name',
    'currency',
    'amountFen',
    'maxTeams',
    'maxMatches',
    'validDays',
    'reason',
  ]);
  if (typeof v.code !== 'string' || !/^[a-z][a-z0-9_-]{1,31}$/.test(v.code))
    invalid('套餐代码须为2至32位小写字母、数字、下划线或短横线');
  if (v.currency !== 'CNY') invalid('当前仅支持人民币CNY');
  return {
    commandId: commandId(v.commandId),
    code: v.code,
    name: text(v.name, 'name', 1, 80),
    currency: 'CNY',
    amountFen: integer(v.amountFen, 'amountFen', 1, MAX_FEN),
    maxTeams: integer(v.maxTeams, 'maxTeams', 2, 32),
    maxMatches: integer(v.maxMatches, 'maxMatches', 1, 1024),
    validDays: integer(v.validDays, 'validDays', 1, 730),
    reason: reason(v.reason),
  };
}
export function parseBuyerCommand(raw: unknown): CommerceOrderCommandInput {
  const v = objectInput(raw, ['commandId', 'type', 'expectedOrderVersion', 'reason']);
  if (!['CANCEL', 'REQUEST_REFUND', 'CREATE_NATIVE', 'QUERY_PAYMENT'].includes(v.type as string))
    invalid('不支持的订单操作');
  return {
    commandId: commandId(v.commandId),
    type: v.type as CommerceOrderCommandInput['type'],
    expectedOrderVersion: expectedVersion(v.expectedOrderVersion),
    ...(['CANCEL', 'REQUEST_REFUND'].includes(v.type as string)
      ? { reason: reason(v.reason) }
      : v.reason === undefined
        ? {}
        : { reason: reason(v.reason) }),
  };
}
export function parsePlatformCommand(raw: unknown): PlatformCommerceOrderCommandInput {
  const v = objectInput(raw, [
    'commandId',
    'type',
    'expectedOrderVersion',
    'reason',
    'externalReference',
  ]);
  if (
    ![
      'SUBMIT_PAYMENT',
      'CONFIRM_PAYMENT',
      'REJECT_PAYMENT',
      'SUBMIT_REFUND',
      'CONFIRM_REFUND',
      'REJECT_REFUND',
      'QUERY_REFUND',
    ].includes(v.type as string)
  )
    invalid('不支持的平台订单操作');
  return {
    commandId: commandId(v.commandId),
    type: v.type as PlatformCommerceOrderCommandInput['type'],
    expectedOrderVersion: expectedVersion(v.expectedOrderVersion),
    reason: reason(v.reason),
    ...(v.externalReference === undefined
      ? {}
      : { externalReference: reference(v.externalReference) }),
  };
}
export function makeQuote(p: Record<string, any>): CommerceQuote {
  const value = {
    planId: p.id,
    code: p.code,
    version: p.version,
    name: p.name,
    currency: 'CNY' as const,
    amountFen: p.amount_fen,
    maxTeams: p.max_teams,
    maxMatches: p.max_matches,
    validDays: p.valid_days,
  };
  return { ...value, hash: digest(value) };
}
export function checkPayment(
  o: Record<string, any>,
  p: {
    outTradeNo: string;
    totalFen: number;
    currency: string;
    transactionId: string | null;
    state: string;
    successTime: string | null;
  },
): void {
  if (
    p.outTradeNo !== o.out_trade_no ||
    p.currency !== 'CNY' ||
    p.totalFen !== o.amount_fen ||
    !Number.isSafeInteger(p.totalFen)
  )
    fail('PAYMENT_PROOF_MISMATCH', '支付证明与原订单报价不一致');
  if (
    p.state === 'SUCCESS' &&
    (!p.transactionId ||
      !p.successTime ||
      !Number.isFinite(Date.parse(p.successTime)) ||
      Date.parse(p.successTime) > new Date(o.expires_at).getTime())
  )
    fail('PAYMENT_PROOF_MISMATCH', '支付证明时间或交易编号无法核验');
}
/** Exact decimal parsing for reconciliation; no binary floating-point money conversion. */
export function decimalFen(value: string): number {
  const match = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) invalid('对账金额必须为最多两位小数的非负人民币金额');
  return integer(
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')),
    'amount',
    0,
    MAX_FEN,
  );
}
export interface ManualBillRow {
  orderId: string;
  transactionReference: string;
  amountFen: number;
  currency: 'CNY';
  status: 'PAID' | 'REFUNDED';
}
export function parseManualBill(value: unknown): ManualBillRow[] {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 65536)
    invalid('对账CSV最多64KiB');
  const lines = value
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    lines.shift() !== 'order_id,transaction_reference,amount,currency,status' ||
    lines.length > 500
  )
    invalid('CSV须使用指定表头并提供0至500行');
  const seen = new Set<string>();
  return lines.map((line) => {
    const cells = line.split(',');
    if (
      cells.length !== 5 ||
      cells.some((x) => x !== x.trim()) ||
      cells[3] !== 'CNY' ||
      !['PAID', 'REFUNDED'].includes(cells[4]!)
    )
      invalid('CSV列、币种或状态无效');
    const orderId = resourceId(cells[0]!);
    if (seen.has(`${orderId}|${cells[4]}`)) invalid('对账CSV不能重复订单');
    seen.add(`${orderId}|${cells[4]}`);
    return {
      orderId,
      transactionReference: reference(cells[1]),
      amountFen: decimalFen(cells[2]!),
      currency: 'CNY',
      status: cells[4] as 'PAID' | 'REFUNDED',
    };
  });
}

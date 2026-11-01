import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { expectedVersion } from './registration-validation.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
export function trainingFail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export const trainingHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function trainingId(raw: unknown): string {
  if (typeof raw !== 'string') invalid('无效资料编号');
  return resourceId(raw);
}
export function trainingCommand(raw: unknown) {
  const id = trainingId(raw);
  if (!/^[0-9a-f-]{14}4/.test(id)) invalid('操作编号需为UUID v4');
  return id;
}
export function trainingInt(raw: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < min || Number(raw) > max)
    invalid(`${field}需为${min}–${max}的整数`);
  return Number(raw);
}
export function trainingTime(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      raw,
    ) ||
    !Number.isFinite(Date.parse(raw))
  )
    invalid('时间必须包含明确时区');
  if (new Date(raw.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== raw.slice(0, 10))
    invalid('日期不存在');
  return new Date(raw).toISOString();
}
export function trainingVersion(actual: number, expected: number) {
  if (actual !== expected) trainingFail('VERSION_CONFLICT', '资料已更新，请重新核对');
}
/** Largest remainder, stable original lesson order; exact integer cents. */
export function allocateTrainingPrice(total: number, weights: number[]): number[] {
  trainingInt(total, '实付金额', 0, 100000000);
  if (!weights.length || weights.length > 8) invalid('课程需为1–8课次');
  weights.forEach((x) => trainingInt(x, '课次权重', 0, 100000000));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    if (total !== 0) invalid('收费课程必须有正数价格权重');
    return weights.map(() => 0);
  }
  const result = weights.map((w) => Number((BigInt(total) * BigInt(w)) / BigInt(sum)));
  let remainder = total - result.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, r: (BigInt(total) * BigInt(w)) % BigInt(sum) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let i = 0; i < remainder; i++) result[order[i]!.i]!++;
  return result;
}
export function parseTrainingCohort(raw: unknown) {
  const v = objectInput(raw, [
    'commandId',
    'courseId',
    'courtId',
    'title',
    'address',
    'capacity',
    'totalFen',
    'termsText',
    'enrollmentDeadline',
    'sessions',
  ]);
  if (!Array.isArray(v.sessions) || v.sessions.length < 1 || v.sessions.length > 8)
    invalid('短班需1–8课次');
  const sessions = v.sessions.map((x) => {
    const s = objectInput(x, ['startsAt', 'endsAt', 'bufferMinutes', 'priceWeight', 'coachIds']);
    const startsAt = trainingTime(s.startsAt),
      endsAt = trainingTime(s.endsAt);
    if (
      Date.parse(endsAt) <= Date.parse(startsAt) ||
      Date.parse(endsAt) - Date.parse(startsAt) > 8 * 3600000
    )
      invalid('课次需为0–8小时');
    if (!Array.isArray(s.coachIds) || s.coachIds.length < 1 || s.coachIds.length > 4)
      invalid('每课次需1–4名教练');
    const coachIds = s.coachIds.map(trainingId);
    if (new Set(coachIds).size !== coachIds.length) invalid('教练不能重复');
    return {
      startsAt,
      endsAt,
      bufferMinutes: trainingInt(s.bufferMinutes ?? 15, '缓冲分钟', 0, 120),
      priceWeight: trainingInt(s.priceWeight, '价格权重', 0, 100000000),
      coachIds,
    };
  });
  sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (let i = 1; i < sessions.length; i++)
    if (sessions[i]!.startsAt < sessions[i - 1]!.endsAt) invalid('同班课次不能重叠');
  if (Date.parse(sessions.at(-1)!.endsAt) - Date.parse(sessions[0]!.startsAt) > 56 * 86400000)
    invalid('首期短班不超过8周');
  const deadline = trainingTime(v.enrollmentDeadline);
  if (deadline > sessions[0]!.startsAt) invalid('报名截止不得晚于首课');
  const totalFen = trainingInt(v.totalFen, '课程金额', 0, 100000000);
  allocateTrainingPrice(
    totalFen,
    sessions.map((s) => s.priceWeight),
  );
  return {
    commandId: trainingCommand(v.commandId),
    courseId: trainingId(v.courseId),
    courtId: trainingId(v.courtId),
    title: text(v.title, 'title', 1, 80),
    address: text(v.address, 'address', 1, 200),
    capacity: trainingInt(v.capacity, '容量', 1, 35),
    totalFen,
    termsText: text(v.termsText, 'termsText', 1, 2000),
    enrollmentDeadline: deadline,
    sessions,
  };
}
export function parseTrainingAction(
  raw: unknown,
  actions: readonly string[],
  extra: string[] = [],
): Record<string, unknown> & {
  commandId: string;
  expectedVersion: number;
  action: string;
  reason: string;
} {
  const v = objectInput(raw, ['commandId', 'expectedVersion', 'action', 'reason', ...extra]);
  if (!actions.includes(String(v.action))) invalid('不支持的培训操作');
  return {
    ...v,
    commandId: trainingCommand(v.commandId),
    expectedVersion: expectedVersion(v.expectedVersion),
    action: String(v.action),
    reason: v.reason === undefined ? '' : text(v.reason, 'reason', 1, 1000),
  };
}
export function trainingAvailable(capacity: number, active: number, holds: number) {
  return Math.max(0, capacity - active - holds);
}
export function trainingCanConfirm(input: {
  expired: boolean;
  eligible: boolean;
  paid: boolean;
  free: boolean;
}) {
  if (input.expired) return input.paid ? 'PAID_UNALLOCATED' : 'EXPIRED';
  if (!input.eligible) return input.paid ? 'PAID_UNALLOCATED' : 'REJECT';
  return input.free || input.paid ? 'CONFIRMED' : 'PAYMENT_PENDING';
}

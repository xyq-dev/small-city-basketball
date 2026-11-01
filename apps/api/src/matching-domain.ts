import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
import { localCommandId, localInterval } from './local-services-domain.js';
import type {
  MatchingKind,
  MatchingNeedInput,
  MatchingScore,
  MatchingWindow,
} from '../../../packages/contracts/matching.js';

export const MATCHING_KINDS: readonly MatchingKind[] = [
  'TEAM_MATCHUP',
  'ADULT_PLAYER',
  'STAFF_SERVICE',
];
export const matchingFail = (code: string, message: string, status = 409): never => {
  throw new ApiError(status, code, message);
};
export const matchingHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function matchingInteger(v: unknown, min: number, max: number, label = '数值'): number {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    invalid(`${label}须为${min}–${max}整数`);
  return Number(v);
}
export function matchingId(v: unknown): string {
  if (typeof v !== 'string') invalid('编号无效');
  return resourceId(v);
}
export function matchingKind(v: unknown): MatchingKind {
  if (!MATCHING_KINDS.includes(v as MatchingKind)) invalid('撮合类型无效');
  return v as MatchingKind;
}
export function matchingRegions(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) invalid('请选择1–20个明确地区');
  const values = raw.map(matchingId);
  if (new Set(values).size !== values.length) invalid('地区不能重复');
  return values.sort();
}
export function matchingWindows(raw: unknown): MatchingWindow[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 64) invalid('请选择1–64个确定场次');
  const windows = raw
    .map((v) => {
      const x = objectInput(v, ['reportAt', 'startAt', 'endAt']);
      const w = localInterval(x.reportAt, x.endAt),
        startDate = new Date(String(x.startAt));
      if (!Number.isFinite(startDate.getTime())) invalid('开始时间无效');
      const start = startDate.toISOString();
      if (start < w.startsAt || start >= w.endsAt) invalid('报到、开始与结束时间顺序无效');
      return { reportAt: w.startsAt, startAt: start, endAt: w.endsAt };
    })
    .sort((a, b) => a.reportAt.localeCompare(b.reportAt));
  for (let i = 1; i < windows.length; i++)
    if (windows[i]!.reportAt < windows[i - 1]!.endAt) invalid('场次不能重叠');
  return windows;
}
export function parseMatchingNeed(raw: unknown): MatchingNeedInput {
  const x = objectInput(raw, [
    'commandId',
    'kind',
    'orgId',
    'teamId',
    'title',
    'address',
    'regionId',
    'catalogVersion',
    'allowedRegionIds',
    'role',
    'quantity',
    'windows',
    'unitBudgetFen',
    'totalBudgetFen',
    'maxTravelMinutes',
    'expiresAt',
    'adultConfirmed',
  ]);
  const kind = matchingKind(x.kind),
    quantity = matchingInteger(x.quantity, 1, 16, '人数');
  if (x.adultConfirmed !== true) invalid('首版撮合仅开放成人需求');
  const role = text(x.role, 'role', 1, 30);
  if (kind === 'ADULT_PLAYER' && !['PG', 'SG', 'SF', 'PF', 'C'].includes(role))
    invalid('球员位置无效');
  if (
    kind === 'STAFF_SERVICE' &&
    !['REFEREE', 'SCORER', 'RECORDER', 'STREAMER', 'PHOTOGRAPHER'].includes(role)
  )
    invalid('当前服务类型未开放撮合');
  if (kind === 'TEAM_MATCHUP' && (quantity !== 1 || role !== 'TEAM'))
    invalid('球队约赛只需要一支对手球队');
  const windows = matchingWindows(x.windows);
  if (kind !== 'ADULT_PLAYER' && windows.length !== 1)
    invalid('工作人员与球队需求每次一个确定时段');
  const unitBudgetFen = matchingInteger(x.unitBudgetFen, 0, 100_000_000, '每席预算');
  const totalBudgetFen = matchingInteger(x.totalBudgetFen, 0, 100_000_000, '总预算');
  if (
    unitBudgetFen * quantity > totalBudgetFen ||
    (kind === 'TEAM_MATCHUP' && (unitBudgetFen !== 0 || totalBudgetFen !== 0))
  )
    invalid('席位预算与总预算不一致');
  const expiresAt = new Date(String(x.expiresAt));
  if (!Number.isFinite(expiresAt.getTime())) invalid('截止时间无效');
  if (expiresAt.toISOString() > windows[0]!.reportAt) invalid('截止时间不能晚于报到');
  const teamId = x.teamId === undefined ? undefined : matchingId(x.teamId);
  if (kind !== 'STAFF_SERVICE' && !teamId) invalid('请提供有权管理的球队');
  return {
    commandId: localCommandId(x.commandId),
    kind,
    orgId: matchingId(x.orgId),
    ...(teamId ? { teamId } : {}),
    title: text(x.title, 'title', 1, 100),
    address: text(x.address, 'address', 1, 200),
    regionId: matchingId(x.regionId),
    catalogVersion: text(x.catalogVersion, 'catalogVersion', 1, 120),
    allowedRegionIds: matchingRegions(x.allowedRegionIds),
    role,
    quantity,
    windows,
    unitBudgetFen,
    totalBudgetFen,
    maxTravelMinutes: matchingInteger(x.maxTravelMinutes, 0, 1440, '单程分钟上限'),
    expiresAt: expiresAt.toISOString(),
    adultConfirmed: true,
  };
}
export function matchingScore(i: {
  budget: number;
  price: number | null;
  free: boolean;
  timeScore?: number;
  travelMinutes?: number | null;
  maxTravelMinutes: number;
  successes?: number;
  outcomes?: number;
}): MatchingScore {
  if (i.price !== null && (!Number.isSafeInteger(i.price) || i.price < 0 || i.price > i.budget))
    matchingFail('MATCHING_BUDGET_EXCEEDED', '报价超过当前席位预算');
  const time = matchingInteger(i.timeScore ?? 100, 0, 100, '档期分数');
  const budget =
    i.free || i.price === null
      ? null
      : i.budget === 0
        ? 100
        : Math.round((100 * (i.budget - i.price)) / i.budget);
  const t = i.travelMinutes;
  if (t !== undefined && t !== null && (!Number.isFinite(t) || t < 0 || t > i.maxTravelMinutes))
    matchingFail('MATCHING_TRAVEL_EXCEEDED', '交通方案超过允许时间');
  const travel =
    t === undefined || t === null
      ? null
      : i.maxTravelMinutes === 0
        ? 100
        : Math.round(100 * (1 - t / i.maxTravelMinutes));
  const n = matchingInteger(i.outcomes ?? 0, 0, 1_000_000, '履约样本'),
    c = matchingInteger(i.successes ?? 0, 0, n, '成功履约数');
  const reliability = n >= 5 ? Math.round((100 * c) / n) : null;
  const dims = [
    [time, 35],
    [budget, i.free ? 0 : 25],
    [travel, 20],
    [reliability, 20],
  ] as const;
  const known = dims.reduce((a, [s, w]) => a + (s === null ? 0 : w), 0),
    all = i.free ? 75 : 100;
  const coverage = Math.round((100 * known) / all),
    score = Math.round(dims.reduce((a, [s, w]) => a + (s ?? 0) * w, 0) / known);
  return {
    ruleVersion: 'match-rules-v1',
    score,
    coverage,
    band: coverage >= 80 ? 'SUFFICIENT' : coverage >= 50 ? 'LIMITED' : 'INCOMPLETE',
    dimensions: { time, budget, travel, reliability },
    reasons: [
      '当前资料显示档期覆盖',
      i.price === null
        ? '总价待原服务报价确认'
        : i.free
          ? '免费约赛，不涉及服务收费'
          : '已知报价在席位预算内',
      travel === null ? '交通耗时尚未核验' : '交通方案已核验',
      reliability === null ? '履约样本不足，不生成星级' : '使用已结案履约记录',
    ],
  };
}
export function rankMatching<T extends { id: string; score: MatchingScore }>(
  items: T[],
  seed: string,
): T[] {
  const band = { SUFFICIENT: 0, LIMITED: 1, INCOMPLETE: 2 };
  return [...items].sort(
    (a, b) =>
      band[a.score.band] - band[b.score.band] ||
      b.score.score - a.score.score ||
      matchingHash(seed + a.id).localeCompare(matchingHash(seed + b.id)),
  );
}

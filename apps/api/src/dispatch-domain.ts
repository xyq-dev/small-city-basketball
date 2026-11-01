import type {
  DispatchKind,
  DispatchMoney,
  DispatchQuote,
} from '../../../packages/contracts/dispatch.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
import {
  localCommandId,
  localHash,
  localInterval,
  localPoint,
  localVersion,
} from './local-services-domain.js';
import { parseRegionSelection } from './region-catalog-domain.js';
import { parseScheduleTimestamp } from './scheduling-domain.js';
import { ApiError } from './errors.js';

export const DISPATCH_KINDS: readonly DispatchKind[] = [
  'REFEREE',
  'SCORER',
  'RECORDER',
  'STREAMER',
  'PHOTOGRAPHER',
];
export const DISPATCH_MAX_BATCHES = 3;
export const DISPATCH_BATCH_SIZE = 3;
export const DISPATCH_HOLD_MINUTES = 10;
export const dispatchFail = (code: string, message: string, status = 409): never => {
  throw new ApiError(status, code, message);
};
export function dispatchMoney(raw: unknown): DispatchMoney {
  const x = objectInput(raw, [
    'serviceMinor',
    'travelMinor',
    'lodgingMinor',
    'platformMinor',
    'totalMinor',
  ]);
  const keys = [
    'serviceMinor',
    'travelMinor',
    'lodgingMinor',
    'platformMinor',
    'totalMinor',
  ] as const;
  for (const k of keys)
    if (!Number.isSafeInteger(x[k]) || Number(x[k]) < 0 || Number(x[k]) > 100_000_000)
      invalid('费用须为0至一亿整数分，不能使用缺项代替0元');
  return Object.fromEntries(keys.map((k) => [k, x[k]])) as unknown as DispatchMoney;
}
export function regionIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) invalid('地区须为1–20项');
  const ids = raw.map((v) => resourceId(String(v))).sort();
  if (new Set(ids).size !== ids.length) invalid('地区不得重复');
  return ids;
}
export function parseDispatchRequest(raw: unknown) {
  const x = objectInput(raw, [
    'commandId',
    'orgId',
    'kind',
    'serviceRegion',
    'serviceAddress',
    'servicePoint',
    'startsAt',
    'endsAt',
    'expiresAt',
    'budget',
    'inviteRegionIds',
    'allowCrossCity',
    'people',
  ]);
  if (!DISPATCH_KINDS.includes(x.kind as DispatchKind))
    invalid('派单仅支持已开放的人员服务，医疗和球场须另行核验');
  if (x.people !== 1) invalid('首版每项需求只允许一个岗位一人');
  if (x.allowCrossCity !== true) invalid('须明确同意跨城邀请范围与费用');
  const interval = localInterval(x.startsAt, x.endsAt);
  const expiresAt = parseScheduleTimestamp(x.expiresAt);
  if (Date.parse(expiresAt) >= Date.parse(interval.startsAt)) invalid('邀请截止必须早于报到时间');
  return {
    commandId: localCommandId(x.commandId),
    orgId: resourceId(String(x.orgId)),
    kind: x.kind as DispatchKind,
    serviceRegion: parseRegionSelection(x.serviceRegion, invalid),
    serviceAddress: text(x.serviceAddress, 'serviceAddress', 4, 200),
    servicePoint: x.servicePoint == null ? null : localPoint(x.servicePoint),
    ...interval,
    expiresAt,
    budget: dispatchMoney(x.budget),
    inviteRegionIds: regionIds(x.inviteRegionIds),
    allowCrossCity: true,
    people: 1,
  };
}
export function parseDispatchPreference(raw: unknown) {
  const x = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'enabled',
    'regionIds',
    'dailyLimit',
  ]);
  if (typeof x.enabled !== 'boolean') invalid('跨城偏好须明确启停');
  if (!Number.isSafeInteger(x.dailyLimit) || Number(x.dailyLimit) < 1 || Number(x.dailyLimit) > 9)
    invalid('每日邀请上限须为1–9');
  return {
    commandId: localCommandId(x.commandId),
    expectedVersion: x.expectedVersion === 0 ? 0 : localVersion(x.expectedVersion),
    enabled: x.enabled,
    regionIds: regionIds(x.regionIds),
    dailyLimit: Number(x.dailyLimit),
  };
}
export function parseDispatchCommand(raw: unknown, target: 'REQUEST' | 'OFFER') {
  const x = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'type',
    'reason',
    'quote',
    'quoteHash',
    'acceptedTermsId',
    'chargeConsent',
    'evidenceChecked',
  ]);
  const types =
    target === 'REQUEST'
      ? ['START', 'PAUSE', 'RESUME', 'CANCEL', 'CONFIRM_QUOTE', 'REJECT_QUOTE']
      : ['SUBMIT_QUOTE', 'VERIFY_TRAVEL', 'ACCEPT', 'DECLINE', 'WITHDRAW'];
  if (!types.includes(String(x.type))) invalid('不支持的派单操作');
  if ((x.type === 'SUBMIT_QUOTE') !== (x.quote !== undefined)) invalid('仅提交报价可携带报价内容');
  if (x.type === 'VERIFY_TRAVEL' && x.evidenceChecked !== true)
    invalid('须独立核验真实交通方案和证据');
  if (x.evidenceChecked !== undefined && x.type !== 'VERIFY_TRAVEL')
    invalid('该操作不能提交审核结论');
  const quoteHash = x.quoteHash === undefined ? null : text(x.quoteHash, 'quoteHash', 64, 64);
  if (
    ['CONFIRM_QUOTE', 'ACCEPT', 'VERIFY_TRAVEL'].includes(String(x.type)) &&
    (!quoteHash || !/^[a-f0-9]{64}$/.test(quoteHash))
  )
    invalid('请明确确认当前报价版本');
  if (x.chargeConsent !== undefined && x.chargeConsent !== true) invalid('费用须明确同意');
  if (
    (x.acceptedTermsId !== undefined || x.chargeConsent !== undefined) &&
    x.type !== 'CONFIRM_QUOTE'
  )
    invalid('仅客户确认可提交收费同意');
  const acceptedTermsId =
    x.acceptedTermsId === undefined
      ? undefined
      : text(x.acceptedTermsId, 'acceptedTermsId', 64, 64);
  if (acceptedTermsId !== undefined && !/^[a-f0-9]{64}$/.test(acceptedTermsId))
    invalid('请确认完整派单报价凭据');
  return {
    commandId: localCommandId(x.commandId),
    expectedVersion: localVersion(x.expectedVersion),
    type: String(x.type),
    reason: text(x.reason, 'reason', 4, 500),
    quote: x.quote,
    quoteHash,
    acceptedTermsId,
    chargeConsent: x.chargeConsent === true,
  };
}
export function parseDispatchQuote(
  raw: unknown,
  request: { startsAt: string; endsAt: string; budget: DispatchMoney },
): DispatchQuote {
  const x = objectInput(raw, [
    'slotId',
    'serviceMinor',
    'travelMinor',
    'lodgingMinor',
    'platformMinor',
    'totalMinor',
    'departureAt',
    'arrivalAt',
    'returnAt',
    'travelMethod',
    'travelEvidence',
    'terms',
  ]);
  const money = dispatchMoney(
    Object.fromEntries(
      ['serviceMinor', 'travelMinor', 'lodgingMinor', 'platformMinor', 'totalMinor'].map((k) => [
        k,
        x[k],
      ]),
    ),
  );
  if (
    money.serviceMinor + money.travelMinor + money.lodgingMinor + money.platformMinor !==
    money.totalMinor
  )
    invalid('报价分项与总额不一致');
  for (const k of Object.keys(money) as (keyof DispatchMoney)[])
    if (money[k] > request.budget[k])
      dispatchFail('DISPATCH_BUDGET_EXCEEDED', '报价超过客户确认的分项或总额上限');
  const departureAt = parseScheduleTimestamp(x.departureAt),
    arrivalAt = parseScheduleTimestamp(x.arrivalAt),
    returnAt = parseScheduleTimestamp(x.returnAt);
  if (
    Date.parse(departureAt) > Date.parse(arrivalAt) ||
    Date.parse(arrivalAt) > Date.parse(request.startsAt) ||
    Date.parse(returnAt) < Date.parse(request.endsAt) ||
    Date.parse(returnAt) - Date.parse(departureAt) > 7 * 86400000
  )
    invalid('交通方案必须覆盖报到和服务结束且总保护区间不超过7天');
  const quote = {
    slotId: resourceId(String(x.slotId)),
    ...money,
    departureAt,
    arrivalAt,
    returnAt,
    protectedStartsAt: departureAt,
    protectedEndsAt: new Date(
      Math.max(Date.parse(returnAt), Date.parse(request.endsAt) + 30 * 60000),
    ).toISOString(),
    travelMethod: text(x.travelMethod, 'travelMethod', 2, 100),
    travelEvidence: text(x.travelEvidence, 'travelEvidence', 10, 1000),
    terms: text(x.terms, 'terms', 10, 1000),
  };
  return { ...quote, hash: localHash(quote) };
}

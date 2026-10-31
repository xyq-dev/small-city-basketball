import { createHash } from 'node:crypto';
import type {
  BookingAppearanceInput,
  BookingCommandInput,
  BookingCommandType,
  BookingCreateInput,
  BookingProfileInput,
  BookingScope,
  BookingPosition,
  BookingWindow,
} from '@small-city-basketball/contracts';
import { ApiError } from '../errors.js';
import { calendarDate, invalid, objectInput, resourceId, text } from '../validation.js';
import { expectedVersion } from '../registration-validation.js';

export const BUFFER_MINUTES = 30;
export const REQUEST_MINUTES = 20;
export const MAX_APPEARANCES = 64;
export const bookingHash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function bookingFail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export function integer(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum)
    invalid('请检查预约资料', { [field]: `请输入${minimum}至${maximum}的整数` });
  return value as number;
}
export function id(value: unknown) {
  return resourceId(typeof value === 'string' ? value : '');
}
export function dateTime(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid('比赛时间必须包含明确时区', { [field]: '请选择有效日期、时间和时区' });
  calendarDate(value.slice(0, 10), field);
  return new Date(value).toISOString();
}
export function schedule(raw: Record<string, unknown>) {
  const reportAt = dateTime(raw.reportAt, 'reportAt');
  const startAt = dateTime(raw.startAt, 'startAt');
  const endAt = dateTime(raw.endAt, 'endAt');
  if (
    reportAt > startAt ||
    startAt >= endAt ||
    Date.parse(endAt) - Date.parse(reportAt) > 12 * 3600_000
  )
    invalid('报到时间不得晚于开赛，结束须晚于开赛，单次服务不超过12小时');
  return { reportAt, startAt, endAt };
}
export function windows(value: unknown): BookingWindow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60)
    invalid('请填写1至60个可约时间段');
  const result = value
    .map((raw) => {
      const v = objectInput(raw, ['startAt', 'endAt']);
      const startAt = dateTime(v.startAt, 'availability');
      const endAt = dateTime(v.endAt, 'availability');
      if (startAt >= endAt || Date.parse(endAt) - Date.parse(startAt) > 31 * 86400_000)
        invalid('可约时间段须有效，单段不超过31天');
      return { startAt, endAt };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (result.some((v, i) => i > 0 && v.startAt < result[i - 1]!.endAt))
    invalid('可约时间段不能重叠');
  return result;
}
export function parseProfile(raw: unknown): BookingProfileInput {
  const v = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'displayName',
    'position',
    'heightCm',
    'city',
    'bio',
    'priceFen',
    'travelFen',
    'accommodationFen',
    'availability',
    'adultConfirmed',
  ]);
  if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(String(v.position))) invalid('请选择有效球员位置');
  if (v.adultConfirmed !== true) invalid('本功能仅接受已满18周岁的球员本人申请');
  return {
    commandId: id(v.commandId),
    expectedVersion: integer(v.expectedVersion, 'expectedVersion', 0, 2147483647),
    displayName: text(v.displayName, 'displayName', 1, 40),
    position: v.position as BookingPosition,
    heightCm: integer(v.heightCm, 'heightCm', 120, 250),
    city: text(v.city, 'city', 1, 60),
    bio: text(v.bio, 'bio', 0, 500),
    priceFen: integer(v.priceFen, 'priceFen', 1, 10_000_000),
    travelFen: integer(v.travelFen, 'travelFen', 0, 10_000_000),
    accommodationFen: integer(v.accommodationFen ?? 0, 'accommodationFen', 0, 10_000_000),
    availability: windows(v.availability),
    adultConfirmed: true,
  };
}
export function parseAppearance(raw: unknown): BookingAppearanceInput {
  const v = objectInput(raw, [
    'profileId',
    'matchId',
    'label',
    'conditionText',
    'reportAt',
    'startAt',
    'endAt',
    'venue',
    'conditional',
  ]);
  if (typeof v.conditional !== 'boolean') invalid('请明确是否为待触发场次');
  let times: Partial<ReturnType<typeof schedule>> = {};
  if (
    !v.conditional ||
    v.reportAt !== undefined ||
    v.startAt !== undefined ||
    v.endAt !== undefined
  )
    times = schedule(v);
  const conditionText = v.conditional ? text(v.conditionText, 'conditionText', 1, 200) : undefined;
  if (!v.conditional && v.conditionText !== undefined) invalid('确定场次不能附带待触发条件');
  return {
    profileId: id(v.profileId),
    ...(v.matchId !== undefined ? { matchId: id(v.matchId) } : {}),
    label: text(v.label, 'label', 1, 80),
    ...(conditionText ? { conditionText } : {}),
    ...times,
    venue: text(v.venue, 'venue', 1, 120),
    conditional: v.conditional,
  };
}
export function parseCreate(raw: unknown): BookingCreateInput {
  const v = objectInput(raw, [
    'commandId',
    'orgId',
    'teamId',
    'eventId',
    'eventName',
    'scope',
    'eligibilityConfirmed',
    'reviewedSettingsVersion',
    'reviewedProfileVersions',
    'appearances',
    'acceptedTermsIds',
    'chargeConsent',
  ]);
  if (v.chargeConsent !== undefined && v.chargeConsent !== true) invalid('收费条款须明确确认');
  let acceptedTermsIds: Record<string, string> | undefined;
  if (v.acceptedTermsIds !== undefined) {
    if (
      !v.acceptedTermsIds ||
      typeof v.acceptedTermsIds !== 'object' ||
      Array.isArray(v.acceptedTermsIds) ||
      Object.keys(v.acceptedTermsIds).length > 64
    )
      invalid('收费条款编号无效');
    acceptedTermsIds = {};
    for (const [key, value] of Object.entries(v.acceptedTermsIds)) {
      if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('收费条款编号无效');
      acceptedTermsIds[id(key)] = value;
    }
  }
  if (!['SINGLE', 'MULTI', 'TOURNAMENT', 'SEASON', 'TIME_BLOCK'].includes(String(v.scope)))
    invalid('请选择预约范围');
  if (v.eligibilityConfirmed !== true)
    invalid('领队须先确认赛事允许该球员参赛；预约不会自动完成报名或资格审核');
  if (
    !Array.isArray(v.appearances) ||
    v.appearances.length < 1 ||
    v.appearances.length > MAX_APPEARANCES
  )
    invalid('每份预约须包含1至64项球员场次');
  const reviewedSettingsVersion = expectedVersion(v.reviewedSettingsVersion);
  const rawVersions = v.reviewedProfileVersions;
  if (
    !rawVersions ||
    typeof rawVersions !== 'object' ||
    Array.isArray(rawVersions) ||
    Object.keys(rawVersions).length > 64
  )
    invalid('请提供已审阅的球员报价版本');
  const reviewedProfileVersions: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawVersions)) {
    const profileId = id(key);
    if (reviewedProfileVersions[profileId] !== undefined) invalid('球员报价版本不能重复');
    reviewedProfileVersions[profileId] = expectedVersion(value);
  }
  const appearances = v.appearances.map(parseAppearance);
  const identities = appearances.map(
    (a) => `${a.profileId}:${a.matchId ?? `${a.label}:${a.reportAt ?? a.conditionText}`}`,
  );
  if (new Set(identities).size !== identities.length) invalid('同一球员场次不能重复');
  if (
    v.scope === 'SINGLE' &&
    (appearances.some((a) => a.conditional) ||
      new Set(appearances.map((a) => `${a.reportAt}:${a.endAt}:${a.venue}`)).size !== 1)
  )
    invalid('单场预约只能包含同一场比赛的球员');
  return {
    commandId: id(v.commandId),
    orgId: id(v.orgId),
    teamId: id(v.teamId),
    ...(v.eventId !== undefined ? { eventId: id(v.eventId) } : {}),
    reviewedSettingsVersion,
    reviewedProfileVersions,
    eventName: text(v.eventName, 'eventName', 1, 80),
    scope: v.scope as BookingScope,
    eligibilityConfirmed: true,
    appearances,
    ...(v.chargeConsent !== undefined ? { chargeConsent: true as const } : {}),
    ...(acceptedTermsIds !== undefined ? { acceptedTermsIds } : {}),
  };
}
const commands: BookingCommandType[] = [
  'ACCEPT',
  'DECLINE',
  'CANCEL',
  'ACTIVATE',
  'PROPOSE_CHANGE',
  'ACCEPT_CHANGE',
  'REJECT_CHANGE',
  'ARRIVE',
  'COMPLETE',
  'DISPUTE',
  'RESOLVE_DISPUTE',
];
export function parseCommand(raw: unknown): BookingCommandInput {
  const v = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'type',
    'appearanceId',
    'reason',
    'reportAt',
    'startAt',
    'endAt',
    'venue',
    'eligibilityConfirmed',
    'resolution',
  ]);
  if (!commands.includes(v.type as BookingCommandType))
    invalid('不支持的预约操作；本服务尚未开放付款或结算');
  const type = v.type as BookingCommandType;
  const needsSchedule = ['ACTIVATE', 'PROPOSE_CHANGE'].includes(type);
  const needsReason = [
    'DECLINE',
    'CANCEL',
    'PROPOSE_CHANGE',
    'REJECT_CHANGE',
    'DISPUTE',
    'RESOLVE_DISPUTE',
  ].includes(type);
  if (['ACCEPT', 'ACTIVATE', 'ACCEPT_CHANGE'].includes(type) && v.eligibilityConfirmed !== true)
    invalid('请确认本次参赛资格和服务安排');
  if (
    type === 'RESOLVE_DISPUTE' &&
    !['RESUME', 'CANCEL', 'COMPLETE'].includes(String(v.resolution))
  )
    invalid('请选择争议处理结果');
  if (type !== 'RESOLVE_DISPUTE' && v.resolution !== undefined)
    invalid('该操作不能指定争议处理结果');
  if (!needsSchedule && ['reportAt', 'startAt', 'endAt', 'venue'].some((k) => v[k] !== undefined))
    invalid('该操作不能变更比赛安排');
  return {
    commandId: id(v.commandId),
    expectedVersion: expectedVersion(v.expectedVersion),
    type,
    appearanceId: id(v.appearanceId),
    ...(needsReason ? { reason: text(v.reason, 'reason', 2, 500) } : {}),
    ...(needsSchedule ? { ...schedule(v), venue: text(v.venue, 'venue', 1, 120) } : {}),
    ...(type === 'RESOLVE_DISPUTE'
      ? { resolution: v.resolution as 'RESUME' | 'CANCEL' | 'COMPLETE' }
      : {}),
    ...(v.eligibilityConfirmed === true ? { eligibilityConfirmed: true } : {}),
  };
}
export function quote(
  serviceFen: number,
  travelFen: number,
  accommodationFen: number,
  feeBps: number,
) {
  integer(serviceFen, 'serviceFen', 1, 10_000_000);
  integer(travelFen, 'travelFen', 0, 10_000_000);
  integer(accommodationFen, 'accommodationFen', 0, 10_000_000);
  integer(feeBps, 'feeBps', 0, 10_000);
  const platformFeeFen = Math.round((serviceFen * feeBps) / 10_000);
  return {
    serviceFen,
    travelFen,
    accommodationFen,
    platformFeeFen,
    totalFen: serviceFen + travelFen + accommodationFen + platformFeeFen,
  };
}
export function insideAvailability(availability: BookingWindow[], reportAt: string, endAt: string) {
  return availability.some((w) => w.startAt <= reportAt && w.endAt >= endAt);
}
export function futureSchedule(reportAt: string, endAt: string, now: Date) {
  if (Date.parse(reportAt) <= now.getTime() || Date.parse(endAt) > now.getTime() + 730 * 86400_000)
    invalid('预约须为未来两年内的有效场次');
}

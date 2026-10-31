import { createHash } from 'node:crypto';
import type {
  LocalPoint,
  LocalServiceKind,
  LocalBookingStatus,
} from '../../../packages/contracts/local-services.js';
import { ApiError } from './errors.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
import { parseRegionSelection } from './region-catalog-domain.js';
import { parseScheduleTimestamp } from './scheduling-domain.js';

export const LOCAL_KINDS: readonly LocalServiceKind[] = [
  'COURT',
  'REFEREE',
  'SCORER',
  'RECORDER',
  'STREAMER',
  'PHOTOGRAPHER',
  'MEDIC',
];
export const LOCAL_ACTIVE_BOOKINGS = [
  'HELD',
  'REQUESTED',
  'CONFIRMED',
  'ARRIVED',
  'DELIVERED',
  'DISPUTED',
] as const;
export const localFail = (code: string, message: string, status = 409): never => {
  throw new ApiError(status, code, message);
};
export const localVersion = (raw: unknown): number => {
  if (!Number.isSafeInteger(raw) || Number(raw) < 1 || Number(raw) > 2147483647)
    invalid('请提供有效资料版本');
  return Number(raw);
};
export const localCommandId = (raw: unknown): string => {
  if (
    typeof raw !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)
  )
    invalid('请提供有效原操作编号');
  return raw;
};
export const localHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function localPoint(raw: unknown): LocalPoint {
  const x = objectInput(raw, ['latitude', 'longitude', 'coordinateSystem']);
  if (
    x.coordinateSystem !== 'GCJ02' ||
    typeof x.latitude !== 'number' ||
    !Number.isFinite(x.latitude) ||
    x.latitude < -90 ||
    x.latitude > 90 ||
    typeof x.longitude !== 'number' ||
    !Number.isFinite(x.longitude) ||
    x.longitude < -180 ||
    x.longitude > 180
  )
    invalid('地点须使用有效GCJ-02经纬度');
  return { latitude: x.latitude, longitude: x.longitude, coordinateSystem: 'GCJ02' };
}
export function distanceMeters(a: LocalPoint, b: LocalPoint): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians,
    dLng = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
}
export function localInterval(start: unknown, end: unknown) {
  const parse = (v: unknown) => {
    const normalized = parseScheduleTimestamp(v);
    const d = new Date(normalized);
    if (d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2200) invalid('时段超出支持范围');
    return d.toISOString();
  };
  const startsAt = parse(start),
    endsAt = parse(end);
  if (endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > 24 * 3600000)
    invalid('每个时段须大于0且不超过24小时');
  return { startsAt, endsAt };
}
export function parseLocalListing(raw: unknown) {
  const x = objectInput(raw, [
    'commandId',
    'kind',
    'title',
    'description',
    'address',
    'region',
    'point',
    'coverageRegionIds',
    'providerUserId',
    'courtId',
    'qualificationNote',
    'terms',
  ]);
  if (!LOCAL_KINDS.includes(x.kind as LocalServiceKind)) invalid('请选择支持的服务项目');
  const kind = x.kind as LocalServiceKind;
  const region = parseRegionSelection(x.region, invalid);
  if (
    !Array.isArray(x.coverageRegionIds) ||
    x.coverageRegionIds.length < 1 ||
    x.coverageRegionIds.length > 20
  )
    invalid('覆盖地区须为1–20个有效地区');
  const coverageRegionIds = [
    ...new Set(x.coverageRegionIds.map((v) => resourceId(String(v)))),
  ].sort();
  if (coverageRegionIds.length !== x.coverageRegionIds.length) invalid('覆盖地区不能重复');
  const courtId =
    x.courtId === undefined || x.courtId === null ? null : resourceId(String(x.courtId));
  if ((kind === 'COURT') !== (courtId !== null))
    invalid('球场服务必须绑定实际场地；人员服务不能绑定为球场库存');
  return {
    commandId: localCommandId(x.commandId),
    kind,
    title: text(x.title, 'title', 1, 100),
    description: text(x.description, 'description', 1, 1000),
    address: text(x.address, 'address', 1, 200),
    region,
    point: x.point === undefined || x.point === null ? null : localPoint(x.point),
    coverageRegionIds,
    providerUserId: resourceId(String(x.providerUserId)),
    courtId,
    qualificationNote: text(x.qualificationNote, 'qualificationNote', 4, 1000),
    terms: text(x.terms, 'terms', 4, 1000),
  };
}
export function parseLocalSlot(raw: unknown) {
  const x = objectInput(raw, ['commandId', 'expectedVersion', 'startsAt', 'endsAt']);
  return {
    commandId: localCommandId(x.commandId),
    expectedVersion: localVersion(x.expectedVersion),
    ...localInterval(x.startsAt, x.endsAt),
  };
}
export function parseLocalListingCommand(raw: unknown) {
  const x = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'type',
    'reason',
    'qualifiedUntil',
    'qualificationChecked',
    'scopeChecked',
  ]);
  if (
    ![
      'CONFIRM_PROVIDER',
      'SUBMIT',
      'APPROVE',
      'REJECT',
      'PUBLISH',
      'UNPUBLISH',
      'SUSPEND',
    ].includes(String(x.type))
  )
    invalid('不支持的供给操作');
  const type = x.type as string;
  const qualifiedUntil =
    x.qualifiedUntil === undefined ? null : text(x.qualifiedUntil, 'qualifiedUntil', 20, 35);
  if (
    type === 'APPROVE' &&
    (x.qualificationChecked !== true ||
      x.scopeChecked !== true ||
      !qualifiedUntil ||
      !Number.isFinite(Date.parse(qualifiedUntil)))
  )
    invalid('审核必须核对主体／资质和覆盖范围，并填写资格有效截止时间');
  if (
    type !== 'APPROVE' &&
    [x.qualificationChecked, x.scopeChecked, x.qualifiedUntil].some((v) => v !== undefined)
  )
    invalid('该操作不接受审核结论');
  return {
    commandId: localCommandId(x.commandId),
    expectedVersion: localVersion(x.expectedVersion),
    type,
    reason: text(x.reason, 'reason', 4, 500),
    qualifiedUntil,
  };
}
export function parseLocalBooking(raw: unknown) {
  const x = objectInput(raw, [
    'commandId',
    'listingId',
    'slotId',
    'serviceRegion',
    'acceptedTerms',
  ]);
  if (x.acceptedTerms !== true) invalid('请确认当前服务和取消条款');
  return {
    commandId: localCommandId(x.commandId),
    listingId: resourceId(String(x.listingId)),
    slotId: resourceId(String(x.slotId)),
    serviceRegion: parseRegionSelection(x.serviceRegion, invalid),
    acceptedTerms: true,
  };
}
export function parseLocalBookingCommand(raw: unknown) {
  const x = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'reason', 'newSlotId']);
  if (
    ![
      'CONFIRM',
      'ACCEPT',
      'DECLINE',
      'CANCEL',
      'ARRIVE',
      'DELIVER',
      'COMPLETE',
      'DISPUTE',
      'PROPOSE_CHANGE',
      'ACCEPT_CHANGE',
      'REJECT_CHANGE',
    ].includes(String(x.type))
  )
    invalid('不支持的履约操作');
  if ((x.type === 'PROPOSE_CHANGE') !== (x.newSlotId !== undefined))
    invalid('仅改期提议需要新时隙');
  return {
    commandId: localCommandId(x.commandId),
    expectedVersion: localVersion(x.expectedVersion),
    type: String(x.type),
    reason: text(x.reason, 'reason', 4, 500),
    newSlotId: x.newSlotId === undefined ? null : resourceId(String(x.newSlotId)),
  };
}
export function localBookingTransition(
  status: LocalBookingStatus,
  type: string,
  role: 'BUYER' | 'PROVIDER' | 'ADMIN',
): LocalBookingStatus {
  if (['CANCELLED', 'DECLINED', 'EXPIRED', 'COMPLETED'].includes(status))
    return localFail('LOCAL_TERMINAL', '订单已终结，不能重复改变履约结果');
  if (type === 'CANCEL' && ['HELD', 'REQUESTED', 'CONFIRMED'].includes(status)) return 'CANCELLED';
  if (type === 'DISPUTE' && ['CONFIRMED', 'ARRIVED', 'DELIVERED'].includes(status))
    return 'DISPUTED';
  const next: Record<string, { from: LocalBookingStatus; role: string; to: LocalBookingStatus }> = {
    CONFIRM: { from: 'HELD', role: 'BUYER', to: 'CONFIRMED' },
    ACCEPT: { from: 'REQUESTED', role: 'PROVIDER', to: 'CONFIRMED' },
    DECLINE: { from: 'REQUESTED', role: 'PROVIDER', to: 'DECLINED' },
    ARRIVE: { from: 'CONFIRMED', role: 'PROVIDER', to: 'ARRIVED' },
    DELIVER: { from: 'ARRIVED', role: 'PROVIDER', to: 'DELIVERED' },
    COMPLETE: { from: 'DELIVERED', role: 'BUYER', to: 'COMPLETED' },
  };
  const rule = next[type];
  if (!rule || rule.from !== status || rule.role !== role)
    return localFail('LOCAL_STATE_CONFLICT', '当前角色或履约状态不允许该操作');
  return rule.to;
}
export function parseLocalQuery(raw: unknown) {
  const q = objectInput(raw, [
    'regionId',
    'catalogVersion',
    'kind',
    'q',
    'point',
    'radiusMeters',
    'limit',
    'cursor',
  ]);
  const region = q.regionId
    ? parseRegionSelection({ regionId: q.regionId, catalogVersion: q.catalogVersion }, invalid)
    : null;
  if (!region && q.catalogVersion !== undefined) invalid('地区目录版本须与地区一起传入');
  if (q.kind !== undefined && !LOCAL_KINDS.includes(q.kind as LocalServiceKind))
    invalid('无效服务类型');
  const point =
    q.point === undefined
      ? null
      : localPoint(
          typeof q.point === 'string'
            ? (() => {
                try {
                  return JSON.parse(q.point);
                } catch {
                  return invalid('查询起点无效');
                }
              })()
            : q.point,
        );
  const radius = q.radiusMeters === undefined ? null : Number(q.radiusMeters);
  if (radius !== null && (!point || ![1000, 3000, 5000, 10000].includes(radius)))
    invalid('距离筛选需有效起点和1／3／5／10公里半径');
  const limit = q.limit === undefined ? 20 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid('分页数量须为1–50');
  const cursor = q.cursor === undefined ? null : resourceId(String(q.cursor));
  return {
    region,
    kind: q.kind as LocalServiceKind | undefined,
    q: q.q === undefined ? '' : text(q.q, 'q', 0, 80),
    point,
    radius,
    limit,
    cursor,
  };
}

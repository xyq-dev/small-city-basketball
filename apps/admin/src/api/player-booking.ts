import type {
  BookingPlayerData,
  BookingOrderData,
  BookingWorkspaceData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';
import type { BookingRepository } from '../booking/model';
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const text = (v: unknown): v is string => typeof v === 'string';
const nullableStamp = (v: unknown) => v === null || stamp(v);
const stamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
function invalid(): never {
  throw new ApiError(200, 'INVALID_RESPONSE', '球员预约资料不完整，请重新读取；未切换到演示数据');
}
const profiles = new Set(['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']);
function profile(v: unknown): v is BookingPlayerData {
  return (
    obj(v) &&
    text(v.id) &&
    text(v.userId) &&
    text(v.displayName) &&
    ['PG', 'SG', 'SF', 'PF', 'C'].includes(String(v.position)) &&
    integer(v.version) &&
    Number(v.version) > 0 &&
    integer(v.heightCm) &&
    integer(v.priceFen) &&
    integer(v.travelFen) &&
    integer(v.accommodationFen) &&
    text(v.city) &&
    text(v.bio) &&
    profiles.has(String(v.status)) &&
    Array.isArray(v.availability) &&
    v.availability.every(
      (w) =>
        obj(w) &&
        stamp(w.startAt) &&
        stamp(w.endAt) &&
        Date.parse(String(w.startAt)) < Date.parse(String(w.endAt)),
    )
  );
}
const capabilityKeys = [
  'canAccept',
  'canDecline',
  'canCancel',
  'canActivate',
  'canProposeChange',
  'canAcceptChange',
  'canRejectChange',
  'canArrive',
  'canComplete',
  'canDispute',
  'canResolveDispute',
];
const states = [
  'CONDITIONAL',
  'REQUESTED',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
  'ARRIVED',
  'COMPLETED',
  'DISPUTED',
];
function order(v: unknown): v is BookingOrderData {
  return (
    obj(v) &&
    text(v.id) &&
    text(v.orgId) &&
    text(v.teamId) &&
    text(v.teamName) &&
    text(v.buyerUserId) &&
    text(v.eventName) &&
    v.eligibilityStatus === 'DECLARED_NOT_VERIFIED' &&
    text(v.eligibilityNotice) &&
    ['SINGLE', 'MULTI', 'TOURNAMENT', 'SEASON', 'TIME_BLOCK'].includes(String(v.scope)) &&
    ['ACTIVE', 'CANCELLED', 'COMPLETED'].includes(String(v.status)) &&
    integer(v.version) &&
    integer(v.feeBps) &&
    integer(v.settingsVersion) &&
    stamp(v.createdAt) &&
    Array.isArray(v.appearances) &&
    v.appearances.every(
      (a) =>
        obj(a) &&
        text(a.id) &&
        text(a.orderId) &&
        text(a.profileId) &&
        text(a.playerUserId) &&
        text(a.playerName) &&
        text(a.label) &&
        ['PG', 'SG', 'SF', 'PF', 'C'].includes(String(a.position)) &&
        nullableStamp(a.reportAt) &&
        nullableStamp(a.startAt) &&
        nullableStamp(a.endAt) &&
        a.bufferMinutes === 30 &&
        (a.changeRequest === null ||
          (obj(a.changeRequest) &&
            text(a.changeRequest.proposedByUserId) &&
            ['BUYER', 'PLAYER'].includes(String(a.changeRequest.proposedByRole)) &&
            stamp(a.changeRequest.reportAt) &&
            stamp(a.changeRequest.startAt) &&
            stamp(a.changeRequest.endAt) &&
            text(a.changeRequest.venue) &&
            text(a.changeRequest.reason))) &&
        text(a.venue) &&
        integer(a.version) &&
        states.includes(String(a.status)) &&
        ['serviceFen', 'travelFen', 'accommodationFen', 'platformFeeFen', 'totalFen'].every((k) =>
          integer(a[k]),
        ) &&
        a.totalFen ===
          Number(a.serviceFen) +
            Number(a.travelFen) +
            Number(a.accommodationFen) +
            Number(a.platformFeeFen) &&
        typeof a.scheduleChanged === 'boolean' &&
        a.paymentStatus === 'UNAVAILABLE' &&
        a.settlementStatus === 'BLOCKED' &&
        obj(a.capabilities) &&
        capabilityKeys.every((k) => typeof (a.capabilities as Obj)[k] === 'boolean'),
    ) &&
    obj(v.totals) &&
    [
      'confirmedServiceFen',
      'confirmedPlatformFeeFen',
      'confirmedTravelFen',
      'confirmedAccommodationFen',
      'confirmedTotalFen',
      'conditionalTotalFen',
      'paidFen',
      'settledFen',
      'refundedFen',
    ].every((k) => integer((v.totals as Obj)[k]))
  );
}
export function parseBookingWorkspace(v: unknown): BookingWorkspaceData {
  if (
    !obj(v) ||
    !text(v.viewerUserId) ||
    typeof v.isPlatformOperator !== 'boolean' ||
    v.paymentAvailable !== false ||
    !text(v.paymentNotice) ||
    typeof v.ordersHasMore !== 'boolean' ||
    !obj(v.settings) ||
    !integer(v.settings.feeBps) ||
    !integer(v.settings.version) ||
    !Array.isArray(v.players) ||
    !v.players.every(profile) ||
    (v.ownProfile !== null && !profile(v.ownProfile)) ||
    !Array.isArray(v.reviewQueue) ||
    !v.reviewQueue.every(profile) ||
    !Array.isArray(v.orders) ||
    !v.orders.every(order) ||
    !Array.isArray(v.teams) ||
    !v.teams.every((t) => obj(t) && text(t.id) && text(t.orgId) && text(t.name)) ||
    !Array.isArray(v.events) ||
    !v.events.every(
      (e) => obj(e) && text(e.id) && text(e.orgId) && text(e.name) && text(e.status),
    ) ||
    !Array.isArray(v.matches) ||
    !v.matches.every(
      (m) =>
        obj(m) &&
        text(m.id) &&
        text(m.orgId) &&
        text(m.eventId) &&
        text(m.homeTeamId) &&
        text(m.awayTeamId) &&
        text(m.label) &&
        text(m.venue) &&
        stamp(m.startAt) &&
        stamp(m.endAt),
    ) ||
    !obj(v.statistics) ||
    ![
      'orders',
      'completedAppearances',
      'quotedPlatformFeeFen',
      'collectedPlatformFeeFen',
      'settledPlayerFen',
    ].every((k) => integer((v.statistics as Obj)[k]))
  )
    invalid();
  return v as unknown as BookingWorkspaceData;
}
export function createPlayerBookingApi(client: ApiClient): BookingRepository {
  const root = '/v1/player-bookings';
  const send = async (path: string, body: unknown, method = 'POST') =>
    (await client.request<unknown>(`${root}${path}`, { method, body: JSON.stringify(body) })).data;
  return {
    async get(id) {
      const v = (await client.request<unknown>(`${root}/orders/${encodeURIComponent(id)}`)).data;
      if (!order(v)) invalid();
      return v;
    },
    async workspace() {
      return parseBookingWorkspace((await client.request<unknown>(`${root}/workspace`)).data);
    },
    async saveProfile(input) {
      const v = await send('/profile', input, 'PUT');
      if (!profile(v)) invalid();
      return v;
    },
    async reviewProfile(id, version, status, reason, commandId) {
      const v = await send(`/profiles/${encodeURIComponent(id)}/review`, {
        expectedVersion: version,
        status,
        reason,
        commandId,
      });
      if (!profile(v)) invalid();
      return v;
    },
    async create(input) {
      const v = await send('/orders', input);
      if (!order(v)) invalid();
      return v;
    },
    async command(id, input) {
      const v = await send(`/orders/${encodeURIComponent(id)}/commands`, input);
      if (!order(v)) invalid();
      return v;
    },
    async updateFee(expectedVersion, feeBps, commandId) {
      const v = await send('/settings', { expectedVersion, feeBps, commandId }, 'PUT');
      if (!obj(v) || !integer(v.version) || !integer(v.feeBps)) invalid();
    },
  };
}

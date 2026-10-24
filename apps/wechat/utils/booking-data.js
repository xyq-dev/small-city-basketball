// Native port of the existing Web API response guards; no framework dependency.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === 'object') || typeof from === 'function') {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, '__esModule', { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  order: () => order,
  parseBookingWorkspace: () => parseBookingWorkspace,
  profile: () => profile,
});
module.exports = __toCommonJS(stdin_exports);
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
const text = (v) => typeof v === 'string';
const nullableStamp = (v) => v === null || stamp(v);
const stamp = (v) => text(v) && Number.isFinite(Date.parse(v));
function invalid() {
  throw new ApiError(
    200,
    'INVALID_RESPONSE',
    '\u7403\u5458\u9884\u7EA6\u8D44\u6599\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\uFF1B\u672A\u5207\u6362\u5230\u6F14\u793A\u6570\u636E',
  );
}
const profiles = /* @__PURE__ */ new Set(['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']);
function profile(v) {
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
function order(v) {
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
        capabilityKeys.every((k) => typeof a.capabilities[k] === 'boolean'),
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
    ].every((k) => integer(v.totals[k]))
  );
}
function parseBookingWorkspace(v) {
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
    ].every((k) => integer(v.statistics[k]))
  )
    invalid();
  return v;
}

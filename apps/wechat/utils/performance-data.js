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
  link: () => link,
  parsePerformanceSources: () => parsePerformanceSources,
  parsePerformanceWorkspace: () => parsePerformanceWorkspace,
  parsePlayerPerformance: () => parsePlayerPerformance,
});
module.exports = __toCommonJS(stdin_exports);
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string';
const integer = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
const positive = (v) => integer(v) && Number(v) > 0;
const timestamp = (v) => text(v) && Number.isFinite(Date.parse(v));
const exact = (v, keys) =>
  object(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
function invalid() {
  throw new ApiError(
    200,
    'INVALID_PERFORMANCE_RESPONSE',
    '\u7403\u5458\u7EDF\u8BA1\u6216\u6388\u6743\u8D44\u6599\u4E0D\u5B8C\u6574\uFF0C\u5DF2\u505C\u6B62\u5C55\u793A\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u3002',
  );
}
const countKeys = [
  'sourceCount',
  'recordedMatchCount',
  'confirmedMatchCount',
  'teamOnlyMatchCount',
  'partialAttributionMatchCount',
  'pendingMatchCount',
  'invalidMatchCount',
  'completedServiceCount',
];
const metricKeys = ['totalPoints', 'totalFouls', 'pointsPerRecordedMatch', 'foulsPerRecordedMatch'];
const missingKeys = ['rebounds', 'assists', 'minutes', 'fieldGoalPercentage'];
function parsePlayerPerformance(v) {
  if (
    !exact(v, [
      'profileId',
      'dataStatus',
      'sampleLimit',
      'truncated',
      ...countKeys,
      ...metricKeys,
      ...missingKeys,
      'recentRecords',
      'denominatorNotice',
      'completenessNotice',
      'asOf',
    ]) ||
    !object(v) ||
    !text(v.profileId) ||
    v.sampleLimit !== 1e3 ||
    typeof v.truncated !== 'boolean' ||
    !['NO_AUTHORIZED_SOURCE', 'NO_PERSONAL_STATS', 'AVAILABLE', 'PARTIAL'].includes(
      String(v.dataStatus),
    ) ||
    !countKeys.every((k) => integer(v[k])) ||
    !metricKeys.every(
      (k) =>
        v[k] === null || (typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 0),
    ) ||
    !missingKeys.every((k) => v[k] === null) ||
    !text(v.denominatorNotice) ||
    !text(v.completenessNotice) ||
    !timestamp(v.asOf) ||
    !Array.isArray(v.recentRecords) ||
    v.recentRecords.length > 5 ||
    !v.recentRecords.every(
      (r) =>
        exact(r, [
          'recordKey',
          'eventName',
          'date',
          'format',
          'collectionMode',
          'points',
          'fouls',
          'attributionComplete',
          'source',
        ]) &&
        object(r) &&
        ['recordKey', 'eventName', 'date', 'format'].every((k) => text(r[k])) &&
        timestamp(r.date) &&
        r.source === 'INDEPENDENT_CONFIRMATION' &&
        (r.collectionMode === 'TEAM_ONLY'
          ? r.points === null && r.fouls === null && r.attributionComplete === null
          : r.collectionMode === 'PLAYER_BASIC' &&
            integer(r.points) &&
            integer(r.fouls) &&
            typeof r.attributionComplete === 'boolean'),
    )
  )
    invalid();
  if (Number(v.recordedMatchCount) === 0 && metricKeys.some((k) => v[k] !== null)) invalid();
  if (Number(v.recordedMatchCount) > 0 && metricKeys.some((k) => v[k] === null)) invalid();
  if (Number(v.confirmedMatchCount) !== Number(v.recordedMatchCount) + Number(v.teamOnlyMatchCount))
    invalid();
  if (v.dataStatus === 'NO_AUTHORIZED_SOURCE' && Number(v.sourceCount) !== 0) invalid();
  return v;
}
function link(v) {
  return (
    object(v) &&
    [
      'id',
      'profileId',
      'profileName',
      'orgId',
      'eventId',
      'eventName',
      'teamId',
      'teamName',
      'memberId',
      'memberName',
      'nominatedByUserId',
      'reason',
    ].every((k) => text(v[k])) &&
    ['PENDING', 'APPROVED', 'REVOKED'].includes(String(v.status)) &&
    positive(v.version) &&
    [v.consentedAt, v.revokedAt].every((t) => t === null || timestamp(t)) &&
    timestamp(v.createdAt) &&
    typeof v.sourceCurrentlyAvailable === 'boolean' &&
    object(v.capabilities) &&
    typeof v.capabilities.canConsent === 'boolean' &&
    typeof v.capabilities.canRevoke === 'boolean'
  );
}
function parsePerformanceWorkspace(v) {
  if (
    !object(v) ||
    !text(v.viewerUserId) ||
    (v.ownProfileId !== null && !text(v.ownProfileId)) ||
    !Array.isArray(v.manageableEvents) ||
    !v.manageableEvents.every(
      (e) => object(e) && ['id', 'orgId', 'name', 'format'].every((k) => text(e[k])),
    ) ||
    !Array.isArray(v.links) ||
    v.links.length > 50 ||
    !v.links.every(link) ||
    new Set(v.links.map((l) => l.id)).size !== v.links.length ||
    typeof v.linksHasMore !== 'boolean' ||
    (v.nextCursor !== null &&
      (!text(v.nextCursor) || v.nextCursor.length < 1 || v.nextCursor.length > 2048)) ||
    v.linksHasMore !== (v.nextCursor !== null) ||
    (v.linksHasMore && v.links.length === 0) ||
    !text(v.disclosureNotice)
  )
    invalid();
  return v;
}
function parsePerformanceSources(v) {
  if (
    !object(v) ||
    !object(v.event) ||
    !['id', 'orgId', 'name', 'format'].every((k) => text(v.event[k])) ||
    !Array.isArray(v.teams) ||
    !v.teams.every(
      (t) =>
        object(t) &&
        text(t.id) &&
        text(t.name) &&
        Array.isArray(t.members) &&
        t.members.every((m) => object(m) && ['id', 'name', 'jerseyNo'].every((k) => text(m[k]))),
    )
  )
    invalid();
  return v;
}

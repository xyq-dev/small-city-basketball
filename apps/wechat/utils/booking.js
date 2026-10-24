const api = require('./api');
const booking = require('./booking-data');
const stats = require('./performance-data');
const root = '/v1/player-bookings';
function invalid() {
  const error = new Error('球员预约资料不完整，请重新读取');
  error.code = 'INVALID_RESPONSE';
  throw error;
}
const id = (value) => encodeURIComponent(api.uuid(value));
async function read(path) {
  return (await api.getClient().request(root + path)).data;
}
async function send(path, input, method = 'POST') {
  return (await api.getClient().request(root + path, method, input)).data;
}
function order(value, expected) {
  if (
    !booking.order(value) ||
    (expected && value.id !== expected) ||
    value.totals.paidFen !== 0 ||
    value.totals.refundedFen !== 0 ||
    value.totals.settledFen !== 0
  )
    invalid();
  return value;
}
function profile(value) {
  if (!booking.profile(value)) invalid();
  return value;
}
function link(value, expected) {
  if (!stats.link(value) || (expected && value.id !== expected)) invalid();
  return value;
}
async function workspace() {
  const value = booking.parseBookingWorkspace(await read('/workspace'));
  const client = api.getClient();
  if (client.viewerId() !== value.viewerUserId) invalid();
  value.orders.forEach((v) => order(v));
  if (value.statistics.collectedPlatformFeeFen !== 0 || value.statistics.settledPlayerFen !== 0)
    invalid();
  return value;
}
async function performance(profileId) {
  const value = stats.parsePlayerPerformance(
    (await api.getClient().requestPublic(root + '/players/' + id(profileId) + '/performance')).data,
  );
  if (value.profileId !== profileId) invalid();
  return value;
}
async function performances(ids) {
  const unique = Array.from(new Set(ids));
  if (!unique.length || unique.length > 20) invalid();
  unique.forEach(api.uuid);
  const raw = (
    await api
      .getClient()
      .requestPublic(root + '/players/performance?ids=' + encodeURIComponent(unique.join(',')))
  ).data;
  if (
    !raw ||
    !Array.isArray(raw.players) ||
    !Array.isArray(raw.unavailableProfileIds) ||
    Object.keys(raw).length !== 2
  )
    invalid();
  const players = raw.players.map(stats.parsePlayerPerformance),
    returned = players.map((p) => p.profileId).concat(raw.unavailableProfileIds);
  if (
    returned.length !== unique.length ||
    new Set(returned).size !== returned.length ||
    returned.some((v) => !unique.includes(v))
  )
    invalid();
  return { players, unavailableProfileIds: raw.unavailableProfileIds };
}
async function performanceWorkspace(cursor) {
  const value = stats.parsePerformanceWorkspace(
    await read(
      '/performance/workspace' +
        (cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor)),
    ),
  );
  if (cursor !== undefined && value.nextCursor === cursor) invalid();
  if (value.viewerUserId !== api.getClient().viewerId()) invalid();
  return value;
}
async function sources(orgId, eventId) {
  const value = stats.parsePerformanceSources(
    await read('/performance/sources?orgId=' + id(orgId) + '&eventId=' + id(eventId)),
  );
  if (value.event.id !== eventId || value.event.orgId !== orgId) invalid();
  return value;
}
module.exports = {
  workspace,
  performance,
  performances,
  performanceWorkspace,
  sources,
  async get(value) {
    return order(await read('/orders/' + id(value)), value);
  },
  async create(input) {
    return order(await send('/orders', input));
  },
  async command(value, input) {
    return order(await send('/orders/' + id(value) + '/commands', input), value);
  },
  async saveProfile(input) {
    return profile(await send('/profile', input, 'PUT'));
  },
  async reviewProfile(value, expectedVersion, status, reason, commandId) {
    return profile(
      await send('/profiles/' + id(value) + '/review', {
        expectedVersion,
        status,
        reason,
        commandId,
      }),
    );
  },
  async updateFee(expectedVersion, feeBps, commandId) {
    const v = await send('/settings', { expectedVersion, feeBps, commandId }, 'PUT');
    if (!v || !Number.isSafeInteger(v.version) || !Number.isSafeInteger(v.feeBps)) invalid();
    return v;
  },
  async link(value) {
    return link(await read('/performance/links/' + id(value)), value);
  },
  async nominate(input) {
    return link(await send('/performance/links', input));
  },
  async performanceCommand(value, input) {
    return link(await send('/performance/links/' + id(value) + '/commands', input), value);
  },
};

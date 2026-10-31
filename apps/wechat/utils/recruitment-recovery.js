// One immutable original command per account. Never replace an uncertain request.
const api = require('./api');
const id = '[0-9a-f-]{36}',
  event = '/v1/orgs/' + id + '/events/' + id;
const rules = {
  PUBLISH: [
    new RegExp('^' + event + '/recruitment/publish$'),
    [
      'clientRequestId',
      'expectedEventVersion',
      'title',
      'description',
      'closesAt',
      'maxApplications',
    ],
  ],
  REVOKE: [
    new RegExp('^' + event + '/recruitment/revoke$'),
    ['clientRequestId', 'expectedVersion', 'reason'],
  ],
  APPLY: [
    /^\/v1\/public\/recruitments\/[A-Za-z0-9_-]{43}\/applications$/,
    ['clientRequestId', 'teamName', 'teamId', 'note'],
  ],
  REVIEW: [
    new RegExp('^' + event + '/recruitment-applications/' + id + '/commands$'),
    ['clientRequestId', 'expectedVersion', 'type', 'reason'],
  ],
  PREVIEW: [
    new RegExp('^' + event + '/team-import/previews$'),
    ['clientRequestId', 'expectedEventVersion', 'rows'],
  ],
  COMMIT: [
    new RegExp('^' + event + '/team-import/commit$'),
    ['clientRequestId', 'expectedEventVersion', 'previewId', 'previewHash'],
  ],
  INVITE: [
    new RegExp('^' + event + '/event-invitations$'),
    ['clientRequestId', 'expectedEventVersion', 'teamId', 'targetUserId', 'expiresAt'],
  ],
  DECIDE: [
    new RegExp('^/v1/event-invitations/' + id + '/commands$'),
    ['clientRequestId', 'expectedVersion', 'type'],
  ],
  POSTER: [
    new RegExp('^' + event + '/posters$'),
    [
      'clientRequestId',
      'expectedEventVersion',
      'kind',
      'entryId',
      'matchId',
      'memberIds',
      'includePortraits',
    ],
  ],
  POSTER_REVOKE: [
    new RegExp('^' + event + '/posters/' + id + '/revoke$'),
    ['clientRequestId', 'reason'],
  ],
};
function valid(value) {
  if (!value || !rules[value.kind] || Object.keys(value).sort().join() !== 'body,kind,path')
    return false;
  const [path, keys] = rules[value.kind];
  if (
    typeof value.path !== 'string' ||
    !path.test(value.path) ||
    !value.body ||
    Array.isArray(value.body)
  )
    return false;
  try {
    api.uuid(value.body.clientRequestId);
  } catch {
    return false;
  }
  if (
    Object.keys(value.body).length !== keys.length ||
    Object.keys(value.body).some((k) => !keys.includes(k))
  )
    return false;
  for (const [field, item] of Object.entries(value.body)) {
    if (field === 'rows' || field === 'memberIds') continue;
    if (['expectedVersion', 'expectedEventVersion', 'maxApplications'].includes(field)) {
      if (!Number.isSafeInteger(item) || item < 1) return false;
    } else if (field === 'includePortraits') {
      if (typeof item !== 'boolean') return false;
    } else if (item !== null && (typeof item !== 'string' || item.length > 2000)) return false;
  }
  if (
    value.kind === 'POSTER' &&
    (!Array.isArray(value.body.memberIds) ||
      value.body.memberIds.length > 60 ||
      value.body.memberIds.some(
        (item) => typeof item !== 'string' || !new RegExp('^' + id + '$').test(item),
      ))
  )
    return false;
  if (
    value.kind === 'PREVIEW' &&
    (!Array.isArray(value.body.rows) ||
      value.body.rows.length > 32 ||
      value.body.rows.some(
        (r) =>
          !r ||
          Object.keys(r).length !== 3 ||
          Object.keys(r).some((k) => !['teamName', 'teamId', 'leaderUserId'].includes(k)) ||
          typeof r.teamName !== 'string' ||
          r.teamName.length > 2000 ||
          [r.teamId, r.leaderUserId].some(
            (item) => item !== null && (typeof item !== 'string' || item.length > 2000),
          ),
      ))
  )
    return false;
  return JSON.stringify(value).length <= 64000;
}
function key(actor) {
  return 'scb-x05-original-v1:' + api.uuid(actor);
}
function read(actor) {
  try {
    const value = wx.getStorageSync(key(actor));
    if (!value) return null;
    if (!valid(value)) throw new Error();
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error('本机原请求记录无法读取，请恢复存储后再操作；没有发送新请求。');
  }
}
function save(actor, value) {
  if (!valid(value)) throw new Error('请求内容无效，没有发送。');
  const previous = read(actor),
    encoded = JSON.stringify(value);
  if (previous && JSON.stringify(previous) !== encoded) throw new Error('请先核对上一笔原请求。');
  try {
    wx.setStorageSync(key(actor), value);
    if (JSON.stringify(read(actor)) !== encoded) throw new Error();
  } catch {
    throw new Error('本机无法保存原请求，没有发送。');
  }
}
function clear(actor, value) {
  try {
    if (JSON.stringify(read(actor)) === JSON.stringify(value)) wx.removeStorageSync(key(actor));
  } catch {
    /* keep durable original */
  }
}
const unknown = (e) => !e || !e.status || e.status >= 500 || e.status === 408 || e.status === 429;
module.exports = { read, save, clear, unknown, valid };

// C19 event follows: own-account requests and strict reply checks. A follow is bound to one
// public key; the server decides whether it is still readable. Nothing here sends or promises a
// WeChat reminder: "关注成功" and "微信提醒" are always reported separately.
const api = require('./api');

const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['ACTIVE', 'INVALID', 'CANCELLED'];
const REMINDER_OFF = '微信提醒未启用：本轮不发送订阅消息，请回到小程序主动查看。';

function bad() {
  throw new Error('关注资料格式无效，请刷新后核对');
}
function stamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
/** Validates one FollowData; INVALID and CANCELLED never carry event details. */
function follow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad();
  if (!UUID.test(raw.followId || '') || !PUBLIC_KEY.test(raw.publicEventId || '')) bad();
  if (!STATUSES.includes(raw.status) || !stamp(raw.createdAt)) bad();
  if (raw.cancelledAt !== null && !stamp(raw.cancelledAt)) bad();
  if ((raw.status === 'CANCELLED') !== (raw.cancelledAt !== null)) bad();
  if (raw.wechatReminder !== 'NOT_ENABLED') bad();
  let event = null;
  if (raw.status === 'ACTIVE') {
    const e = raw.event;
    if (
      !e ||
      typeof e.name !== 'string' ||
      e.name.length < 1 ||
      e.name.length > 200 ||
      !DATE.test(e.startDate || '') ||
      !DATE.test(e.endDate || '') ||
      typeof e.status !== 'string' ||
      !['LIVE', 'HISTORY'].includes(e.purpose)
    )
      bad();
    event = {
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      purpose: e.purpose,
    };
  } else if (raw.event !== null) bad();
  return {
    followId: raw.followId.toLowerCase(),
    publicEventId: raw.publicEventId,
    status: raw.status,
    event,
    createdAt: raw.createdAt,
    cancelledAt: raw.cancelledAt,
  };
}
function view(item) {
  const e = item.event;
  return {
    ...item,
    statusLabel:
      item.status === 'ACTIVE' ? '关注中' : item.status === 'INVALID' ? '已失效' : '已取消',
    eventLabel: e ? api.eventStatus(e.status) : '',
    dateLabel: e
      ? e.startDate.slice(5).replace('-', '/') + '–' + e.endDate.slice(5).replace('-', '/')
      : '',
  };
}
async function lookup(client, publicEventId) {
  const response = await client.request(
    '/v1/me/follows/lookup?publicEventId=' + api.publicId(publicEventId),
  );
  if (response.data === null) return null;
  const item = follow(response.data);
  if (item.publicEventId !== publicEventId || item.status === 'CANCELLED') bad();
  return item;
}
async function create(client, publicEventId) {
  const response = await client.request('/v1/me/follows', 'POST', {
    publicEventId: api.publicId(publicEventId),
  });
  const item = follow(response.data);
  if (item.publicEventId !== publicEventId || item.status === 'CANCELLED') bad();
  return item;
}
async function cancel(client, followId) {
  const id = api.uuid(followId).toLowerCase();
  const response = await client.request('/v1/me/follows/' + id + '/cancel', 'POST', {});
  const item = follow(response.data);
  if (item.followId !== id || item.status !== 'CANCELLED') bad();
  return item;
}
async function page(client, cursor) {
  if (cursor !== null && cursor !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) bad();
  const response = await client.request(
    '/v1/me/follows?limit=20' + (cursor ? '&cursor=' + cursor : ''),
  );
  if (!Array.isArray(response.data) || response.data.length > 20) bad();
  const next = response.meta.nextCursor;
  if (next !== null && (typeof next !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(next))) bad();
  const items = response.data.map(follow);
  if (items.some((i) => i.status === 'CANCELLED')) bad();
  return { items, nextCursor: next };
}
/** Appends a later page; a row shifted between pages is shown once. */
function merge(current, incoming) {
  const seen = new Set(current.map((v) => v.followId));
  return current.concat(incoming.filter((v) => !seen.has(v.followId)));
}
function failure(error, action) {
  if (error && error.status === 404)
    return action === 'follow'
      ? '该公开赛事已停止公开或不可访问，未关注。'
      : '未找到这条关注，可能已在其他设备取消；请刷新我的关注。';
  if (error && error.status === 429) return '操作过于频繁，请稍后再试。';
  if (error && error.status === 401) return '登录已失效，请重新登录。';
  if (error && error.code === 'SESSION_CHANGED') return '登录身份已变化，已停止本次操作。';
  if (!error || !error.status || error.status >= 500)
    return action === 'follow'
      ? '关注结果尚未确认，请刷新后核对；重复关注不会产生第二条。'
      : '取消结果尚未确认，请刷新后核对；重复取消不会出错。';
  return error.message || '操作未完成，请刷新后核对';
}
module.exports = { REMINDER_OFF, follow, view, lookup, create, cancel, page, merge, failure };

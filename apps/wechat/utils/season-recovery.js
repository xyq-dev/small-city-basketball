// One durable, account-bound request per operation scope. Never replace an unresolved request.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function key(actor, kind, scope) {
  if (!uuid.test(actor || '') || !['CREATE', 'NOMINATE'].includes(kind) || !uuid.test(scope || ''))
    throw new Error('登录身份或操作范围无效，请重新读取后再操作');
  return 'scb-season-request-v1:' + actor + ':' + kind + ':' + scope;
}
function valid(kind, body) {
  if (!body || !uuid.test(body.clientRequestId || '')) return false;
  const keys =
    kind === 'CREATE'
      ? ['clientRequestId', 'name', 'startDate', 'endDate']
      : ['clientRequestId', 'teamId', 'memberId', 'targetUserId', 'reason'];
  return (
    Object.keys(body).length === keys.length &&
    keys.every(
      (field) =>
        typeof body[field] === 'string' && body[field].length > 0 && body[field].length <= 500,
    )
  );
}
function read(actor, kind, scope) {
  try {
    const value = wx.getStorageSync(key(actor, kind, scope));
    if (value === undefined || value === null || value === '') return null;
    if (!valid(kind, value)) throw new Error('invalid saved request');
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error('无法读取本机待核对记录，请先恢复本机存储；没有发送请求。');
  }
}
function save(actor, kind, scope, body) {
  const previous = read(actor, kind, scope);
  const encoded = JSON.stringify(body);
  if (!valid(kind, body) || (previous && JSON.stringify(previous) !== encoded))
    throw new Error('存在尚未核对的原请求，请沿用原编号核对后再开始新操作。');
  try {
    wx.setStorageSync(key(actor, kind, scope), body);
    if (JSON.stringify(read(actor, kind, scope)) !== encoded) throw new Error('write failed');
  } catch {
    throw new Error('无法保存本机待核对记录，没有发送请求。');
  }
}
function clear(actor, kind, scope, expected) {
  try {
    const previous = read(actor, kind, scope);
    if (previous && expected && JSON.stringify(previous) === JSON.stringify(expected))
      wx.removeStorageSync(key(actor, kind, scope));
  } catch {
    // Keep the original request on disk. A later read/replay remains idempotent.
  }
}
const unknown = (error) => !error || !error.status || error.status >= 500;
module.exports = { read, save, clear, unknown };

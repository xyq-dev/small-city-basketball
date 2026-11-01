const api = require('./api');
const model = require('./sponsor-commerce');
const prefix = 'scb.sponsor-commerce.pending.v1:';
function context(org) {
  const client = api.getClient(),
    actor = model.id(client.viewerId());
  return { client, actor, org: model.id(org), key: prefix + actor + ':' + org };
}
function pending(org) {
  const c = context(org),
    r = wx.getStorageSync(c.key);
  if (r === undefined || r === null || r === '') return null;
  if (
    !r ||
    r.actor !== c.actor ||
    r.org !== c.org ||
    Object.keys(r).sort().join(',') !== 'actor,commandId,org'
  )
    throw Error('原操作记录异常，请先恢复本机存储');
  model.id(r.commandId);
  return r;
}
function clear(c, commandId) {
  const r = wx.getStorageSync(c.key);
  if (r?.commandId === commandId) wx.removeStorageSync(c.key);
}
async function send(org, path, body) {
  const c = context(org);
  if (pending(org)) throw Error('请先核对上一笔操作');
  const r = { actor: c.actor, org: c.org, commandId: model.id(body.commandId) };
  wx.setStorageSync(c.key, r);
  if (pending(org)?.commandId !== r.commandId) throw Error('未能保存操作保护记录');
  try {
    const response = await c.client.request(path, 'POST', body);
    if (c.client.viewerId() !== c.actor) throw Error('登录身份已变化，请重新核对');
    clear(c, r.commandId);
    return response.data;
  } catch (e) {
    if (e.status && e.status < 500) clear(c, r.commandId);
    throw e;
  }
}
async function resolve(org, cancel = false) {
  const c = context(org),
    r = pending(org);
  if (!r) return null;
  const path =
    '/v1/orgs/' + org + '/sponsor-commerce/receipts/' + r.commandId + (cancel ? '/cancel' : '');
  const v = (await c.client.request(path, cancel ? 'POST' : 'GET', cancel ? {} : undefined)).data;
  if (c.client.viewerId() !== c.actor) throw Error('登录身份已变化');
  if (v.found) clear(c, r.commandId);
  return v;
}
module.exports = { pending, send, resolve };

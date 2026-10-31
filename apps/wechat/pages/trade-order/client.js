const api = require('../../utils/api');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ROOT = '/v1/trades';
function id(v) {
  if (typeof v !== 'string' || !UUID.test(v)) throw Error('资金记录编号无效');
  return v;
}
function money(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw Error('服务端金额无效');
  return '¥' + (n / 100).toFixed(2);
}
async function read(path) {
  return (await api.getClient().request(ROOT + path)).data;
}
async function post(path, body) {
  return (await api.getClient().request(ROOT + path, 'POST', body)).data;
}
function key(actor) {
  return 'scb-trade-pending-v1:' + id(actor);
}
function pending(actor) {
  const v = wx.getStorageSync(key(actor));
  if (!v) return null;
  if (
    v.actor !== actor ||
    !v.body ||
    !UUID.test(v.body.clientRequestId) ||
    typeof v.path !== 'string' ||
    !/^\/(?:orders|orgs)\/[a-f0-9-]{36}(?:\/[A-Za-z0-9_/-]+)?$/.test(v.path) ||
    v.body.code !== undefined
  )
    throw Error('本机资金恢复记录无法核验，请先核对原订单');
  return v;
}
function clear(actor) {
  wx.removeStorageSync(key(actor));
  if (wx.getStorageSync(key(actor))) throw Error('无法清除已核对恢复记录');
}
async function execute(actor, path, body, code) {
  if (api.getClient().viewerId() !== actor) throw Error('身份已变化，请重新读取');
  if (pending(actor)) throw Error('先核对上次资金操作');
  const record = { actor, path, body };
  wx.setStorageSync(key(actor), record);
  const saved = pending(actor);
  if (JSON.stringify(saved) !== JSON.stringify(record)) throw Error('无法保存原操作编号，尚未发送');
  return retry(actor, code);
}
async function retry(actor, code) {
  const p = pending(actor);
  if (!p || api.getClient().viewerId() !== actor) throw Error('请重新读取当前身份');
  const result = await post(p.path, { ...p.body, ...(code ? { code } : {}) });
  if (api.getClient().viewerId() !== actor) throw Error('身份变化，原操作仍需核对');
  clear(actor);
  return result;
}
async function recover(actor) {
  const p = pending(actor);
  if (!p) return null;
  const result = await read('/receipts/' + id(p.body.clientRequestId));
  if (api.getClient().viewerId() !== actor) throw Error('身份已变化');
  if (!result || result.found !== true || !result.result)
    throw Error('服务端尚未找到原操作回执，请保留原编号核对或重试');
  clear(actor);
  return result.result;
}
function order(v) {
  id(v && v.id);
  if (
    !Number.isInteger(v.version) ||
    !Array.isArray(v.attempts) ||
    !Array.isArray(v.refunds) ||
    !Array.isArray(v.deductions) ||
    !Array.isArray(v.settlements) ||
    !v.capabilities
  )
    throw Error('资金记录格式无效');
  for (const k of [
    'totalFen',
    'paidFen',
    'refundedFen',
    'refundableFen',
    'settledFen',
    'refundReservedFen',
    'deductionReservedFen',
  ])
    money(v[k]);
  return {
    ...v,
    canStartPayment:
      v.capabilities.canPay &&
      !v.attempts.some((x) => ['DISPATCHING', 'UNKNOWN', 'NOTPAY'].includes(x.status)),
    totalText: money(v.totalFen),
    paidText: money(v.paidFen),
    refundText: money(v.refundedFen),
    refundableText: money(v.refundableFen),
    settledText: money(v.settledFen),
    refundReservedText: money(v.refundReservedFen),
    deductionReservedText: money(v.deductionReservedFen),
    refunds: v.refunds.map((x) => ({ ...x, amountText: money(x.amountFen) })),
    deductions: v.deductions.map((x) => ({ ...x, amountText: money(x.amountFen) })),
    settlements: v.settlements.map((x) => ({
      ...x,
      amountText: money(x.amountFen),
      returnedText: money(x.returnedFen),
    })),
  };
}
module.exports = { id, money, read, post, pending, execute, retry, recover, clear, order };

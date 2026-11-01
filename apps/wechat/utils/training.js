const api = require('./api');
const { trainingPathAllowed } = require('./training-paths');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
function id(v) {
  if (typeof v !== 'string' || !new RegExp('^' + UUID + '$', 'i').test(v))
    throw Error('培训资料编号无效');
  return v;
}
function money(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw Error('课次金额无效');
  return v === 0 ? '免费' : '¥' + (v / 100).toFixed(2);
}
function time(v) {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) throw Error('课程时间无效');
  const local = new Date(d.getTime() + 8 * 3600000),
    pad = (n) => String(n).padStart(2, '0');
  return (
    local.getUTCFullYear() +
    '-' +
    pad(local.getUTCMonth() + 1) +
    '-' +
    pad(local.getUTCDate()) +
    ' ' +
    pad(local.getUTCHours()) +
    ':' +
    pad(local.getUTCMinutes()) +
    '（北京时间）'
  );
}

const names = {
  DRAFT: '待发布',
  ENROLLING: '招生中',
  RUNNING: '授课中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  SUSPENDED: '已暂停',
  WAITLISTED: '候补中 · 不收费',
  HOLDING: '名额暂留 · 待确认',
  CONFIRMED: '已入班',
  EXPIRED: '名额已释放',
  PAID_UNALLOCATED: '已付款但未取得名额 · 可退费',
  AVAILABLE: '未消费',
  MAKEUP_DUE: '待补课',
  CONSUMPTION_PENDING: '消费待核对',
  CONSUMED: '已确认消费',
  REFUND_PENDING: '退款核对中',
  REFUNDED: '权益已退回',
  PROPOSED: '待独立复核',
  REVIEWED: '待学员确认',
  FINALIZED: '消费已确认',
  DISPUTED: '异议处理中',
  ADJUSTED: '已返还权益',
  REJECTED: '未通过',
  PENDING_REVIEW: '待独立审核',
  PENDING: '待交易退款回执',
  UNKNOWN: '结果未知 · 保留退款额度',
  SUCCEEDED: '真实退款成功',
  FAILED: '退款失败 · 权益保留',
  COMPLETED_ZERO: '免费课退课完成',
  APPROVED: '已审核',
  SCHEDULED: '待上课',
  DELIVERED: '已记录授课',
};
function label(v) {
  return names[v] || v;
}
function cohort(v) {
  id(v.id);
  return {
    ...v,
    amount: money(v.totalFen),
    stateLabel: label(v.state),
    sessions: (v.sessions || []).map((s) => ({
      ...s,
      time: time(s.startsAt) + ' — ' + time(s.endsAt),
      stateLabel: label(s.state),
    })),
  };
}
function enrollment(v) {
  id(v.id);
  return {
    ...v,
    amount: money(v.totalFen),
    stateLabel: label(v.state),
    deadline: v.holdExpiresAt ? time(v.holdExpiresAt) : '',
    entitlements: (v.entitlements || []).map((e) => ({
      ...e,
      amount: money(e.netFen),
      stateLabel: label(e.state),
    })),
    consumptions: (v.consumptions || []).map((x) => ({ ...x, stateLabel: label(x.status) })),
    refunds: (v.refunds || []).map((x) => ({
      ...x,
      stateLabel: label(x.status),
      amount: money(x.amount_fen),
    })),
  };
}
async function read(path) {
  return (await api.getClient().request(path)).data;
}
function key(actor) {
  return 'scb-training-pending-v1:' + id(actor);
}
function pending(actor) {
  const p = wx.getStorageSync(key(actor));
  if (!p) return null;
  if (
    p.actor !== actor ||
    !p.body ||
    !new RegExp('^' + UUID + '$', 'i').test(p.body.commandId) ||
    !trainingPathAllowed(p.path, 'POST', {}, UUID)
  )
    throw Error('无法核对本机培训恢复记录');
  return p;
}
function clear(actor) {
  wx.removeStorageSync(key(actor));
  if (wx.getStorageSync(key(actor))) throw Error('无法清除原操作恢复记录');
}
async function commandId() {
  return new Promise((resolve, reject) =>
    wx.getRandomValues({
      length: 16,
      success: (r) => {
        const b = new Uint8Array(r.randomValues);
        b[6] = (b[6] & 15) | 64;
        b[8] = (b[8] & 63) | 128;
        const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
        resolve(
          h.slice(0, 8) +
            '-' +
            h.slice(8, 12) +
            '-' +
            h.slice(12, 16) +
            '-' +
            h.slice(16, 20) +
            '-' +
            h.slice(20),
        );
      },
      fail: () => reject(Error('安全操作编号不可用')),
    }),
  );
}
async function retry(actor) {
  if (api.getClient().viewerId() !== actor) throw Error('身份已变化');
  const p = pending(actor);
  if (!p) throw Error('没有待核对操作');
  try {
    const r = (await api.getClient().request(p.path, 'POST', p.body)).data;
    if (api.getClient().viewerId() !== actor) throw Error('身份已变化，原操作需核对');
    clear(actor);
    return r;
  } catch (e) {
    if (Number.isInteger(e.status) && e.status >= 400 && e.status < 500 && e.status !== 408)
      clear(actor);
    throw e;
  }
}
async function write(actor, path, body) {
  if (api.getClient().viewerId() !== actor) throw Error('身份已变化');
  if (pending(actor)) throw Error('请先核对上次培训操作');
  if (!trainingPathAllowed(path, 'POST', {}, UUID)) throw Error('培训操作路径无效');
  const p = { actor, path, body: { ...body, commandId: await commandId() } };
  wx.setStorageSync(key(actor), p);
  if (JSON.stringify(pending(actor)) !== JSON.stringify(p))
    throw Error('无法安全保存原操作，尚未发送');
  return retry(actor);
}
async function recover(actor) {
  const p = pending(actor);
  if (!p) return null;
  const r = await read('/v1/training/receipts/' + id(p.body.commandId));
  if (api.getClient().viewerId() !== actor) throw Error('身份已变化');
  if (r.pending) return { pending: true };
  clear(actor);
  return r.result;
}
function open(page, query = {}) {
  if (!['training', 'training-manage'].includes(page)) throw Error('培训页面无效');
  const q = Object.entries(query)
    .map(([k, v]) => {
      if (!['cohort', 'enrollment', 'session', 'orgId'].includes(k))
        throw Error('培训导航参数无效');
      return k + '=' + id(v);
    })
    .join('&');
  wx.navigateTo({ url: '/pages/' + page + '/index' + (q ? '?' + q : '') });
}
module.exports = {
  id,
  money,
  time,
  label,
  cohort,
  enrollment,
  read,
  pending,
  write,
  retry,
  recover,
  open,
  commandId,
};

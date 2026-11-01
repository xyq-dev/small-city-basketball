const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labels = {
  DRAFT: '合同草稿',
  IN_REVIEW: '待独立审核',
  APPROVED: '已审核，待执行',
  SIGNED: '双方已签署',
  REJECTED: '已退回',
  CLOSED: '已关闭',
  WAITING_PAYMENT: '待广告主付款',
  DELIVERING: '投放交付中',
  ACCEPTED: '已验收',
  DISPUTED: '交付争议处理中',
  PROPOSED: '待验收',
  SENDING: '渠道处理中，请查询原编号',
  UNKNOWN: '结果未知，请查询原编号',
  PROCESSING: '渠道处理中',
  SUCCEEDED: '渠道已确认',
  PARTIAL: '部分分账未成功',
  PENDING: '待发送',
  RETAINED: '原商户留存',
  FAILED: '渠道未成功',
  RECOVERY_REQUIRED: '回退失败，待追偿',
  READY_FOR_REFUND: '回退已核验，可申请统一退款',
  CLAIMED: '已进入统一退款审核',
  NOT_REQUIRED: '无需渠道回退',
  OPEN: '待追偿',
  RECOVERED: '追偿已确认',
  WRITTEN_OFF: '已批准核销',
  DISABLED: '已停用',
};
function id(v) {
  if (typeof v !== 'string' || !ID.test(v)) throw Error('资料编号无效');
  return v;
}
function fen(v) {
  if (typeof v !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(v.trim()))
    throw Error('金额最多两位小数');
  const [a, b = ''] = v.trim().split('.');
  const n = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n < 0 || n > 100000000) throw Error('金额超出支持范围');
  return n;
}
function money(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw Error('金额资料无效');
  return (v / 100).toFixed(2);
}
function label(v) {
  return labels[v] || '状态待核对';
}
function decorate(rows) {
  return (rows || []).map((r) => ({
    ...r,
    stateLabel: label(r.status),
    amountText:
      r.total_fen !== undefined
        ? money(r.total_fen)
        : r.amount_fen !== undefined
          ? money(r.amount_fen)
          : '',
  }));
}
function sponsorCommercePathAllowed(path, method, query, uuidPattern) {
  if (!query || Object.keys(query).length) return false;
  if (path === '/v1/me/sponsor-commerce') return method === 'GET';
  const root = '/v1/orgs/' + uuidPattern + '/sponsor-commerce';
  const match = (p) => new RegExp('^' + root + p + '$', 'i').test(path);
  if (method === 'GET')
    return match('(?:/statements|/orders/' + uuidPattern + '|/receipts/' + uuidPattern + ')?');
  if (method === 'POST')
    return match(
      '/(?:beneficiaries|contracts|orders|contracts/' +
        uuidPattern +
        '/commands|orders/' +
        uuidPattern +
        '/(?:commands|channel)|receipts/' +
        uuidPattern +
        '/cancel)',
    );
  return false;
}
module.exports = { id, fen, money, label, decorate, sponsorCommercePathAllowed };

const api = require('./api');
const kinds = { FORFEIT: '单场弃权', CANCELLED: '单场取消' };
function valid(v, rulesOnly) {
  if (!v || !v.event || !Number.isInteger(v.event.version) || v.event.version < 1)
    throw new Error('裁定资料格式无效');
  api.uuid(v.event.id);
  if (rulesOnly) {
    if (typeof v.canEdit !== 'boolean') throw new Error('规则权限格式无效');
  } else {
    if (
      !v.match ||
      !Number.isInteger(v.match.version) ||
      !Array.isArray(v.requests) ||
      v.requests.length > 50 ||
      !v.capabilities ||
      ['canPropose', 'canRevoke', 'canReview'].some((k) => typeof v.capabilities[k] !== 'boolean')
    )
      throw new Error('裁定资料格式无效');
    api.uuid(v.match.id);
    for (const r of [...v.requests, ...(v.active ? [v.active] : [])]) {
      api.uuid(r.id);
      if (
        !kinds[r.kind] ||
        !['DECLARE', 'REVOKE'].includes(r.operation) ||
        !['PENDING', 'APPROVED', 'REJECTED'].includes(r.status) ||
        !Number.isInteger(r.version) ||
        typeof r.reason !== 'string'
      )
        throw new Error('裁定提案格式无效');
    }
  }
  if (v.rules) {
    api.uuid(v.rules.id);
    if (
      !Number.isInteger(v.rules.version) ||
      !Number.isInteger(v.rules.forfeitWinPoints) ||
      !Number.isInteger(v.rules.forfeitLossPoints) ||
      v.rules.cancellationPolicy !== 'EXCLUDE_FROM_TABLE'
    )
      throw new Error('异常规则格式无效');
  }
  return v;
}
function requestView(r) {
  return {
    ...r,
    title: (r.operation === 'REVOKE' ? '撤回' : '') + kinds[r.kind],
    statusLabel: { PENDING: '待另一人审核', APPROVED: '已批准', REJECTED: '已驳回' }[r.status],
    sideLabel:
      r.forfeitingSide === 'HOME'
        ? '主队弃权'
        : r.forfeitingSide === 'AWAY'
          ? '客队弃权'
          : '取消，不产生胜负',
  };
}
module.exports = { valid, requestView };

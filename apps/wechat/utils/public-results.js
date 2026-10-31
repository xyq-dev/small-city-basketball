const api = require('./api');
function kind(value) {
  if (!value || value.adjudication === undefined || value.adjudication === null) return null;
  if (!['FORFEIT', 'CANCELLED'].includes(value.adjudication.kind))
    throw new Error('行政结果资料无效，请刷新核对');
  return value.adjudication.kind;
}
function status(value) {
  const k = kind(value);
  return k === 'FORFEIT'
    ? '弃权裁定'
    : k === 'CANCELLED'
      ? '本场取消'
      : value.status === 'WAITING'
        ? '尚未发布'
        : value.status === 'BYE'
          ? '轮空'
          : api.matchStatus(value.status);
}
function match(value) {
  const k = kind(value);
  return {
    ...value,
    statusLabel: status(value),
    resultLabel:
      k === 'FORFEIT'
        ? '裁定胜方：' + (value.adjudication.winner?.teamName || '以裁定记录为准')
        : k === 'CANCELLED'
          ? '本场取消，不产生胜负'
          : api.resultStatus(value.resultStatus),
    ...(k ? { score: null, clock: null, periods: null, totals: null } : {}),
    resultNote: k
      ? '独立复核的行政裁定；不生成比赛比分或个人技术统计。'
      : '正式赛果须经独立人员确认',
  };
}
function slot(value) {
  return {
    ...value,
    statusLabel: status(value),
    homeLabel:
      value.home?.teamName || (value.sourceOutcome === 'LOSER' ? '待半决赛负者' : '待晋级'),
    awayLabel:
      value.away?.teamName || (value.sourceOutcome === 'LOSER' ? '待半决赛负者' : '待晋级'),
    label: value.kind === 'THIRD_PLACE' ? '季军赛' : value.kind === 'CHAMPIONSHIP' ? '决赛' : '',
    winnerLabel:
      value.kind === 'THIRD_PLACE' ? '季军' : value.kind === 'CHAMPIONSHIP' ? '冠军' : '晋级',
  };
}
function progress(value) {
  if (!value) return '';
  const c = value.confirmedMatchCount || 0,
    total = value.totalMatchCount || 0,
    a = value.adjudicatedMatchCount || 0,
    x = value.cancelledMatchCount || 0;
  if (a + x)
    return (
      '已处理 ' +
      (value.resolvedMatchCount ?? c + a + x) +
      ' / ' +
      total +
      ' 场（记分确认 ' +
      c +
      '，弃权 ' +
      a +
      '，取消 ' +
      x +
      '）'
    );
  return '已确认 ' + c + ' / ' + total + ' 场';
}
function clock(value, receivedAt) {
  return kind(value) ? '无实际计时记录' : api.clockText(value, receivedAt);
}
module.exports = { kind, status, match, slot, progress, clock };

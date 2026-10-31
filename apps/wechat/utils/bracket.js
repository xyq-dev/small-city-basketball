const api = require('./api');
const ui = require('./ui');

// View models over EventKnockoutData / EventGroupKnockoutData. Eligibility, advancement,
// locking and versions are the server's; this file only labels what the server returned.
const slotStatus = {
  WAITING: '待来源赛果',
  BYE: '轮空晋级',
};
const qualificationLabels = {
  WAITING: '等待全部组赛有效独立确认',
  TIE_BREAK_REQUIRED: '需独立保存同分抽签',
  READY: '可发布淘汰首轮',
  PUBLISHED: '淘汰首轮已发布',
};
const errorText = {
  VERSION_CONFLICT: '赛事已被其他操作更新，已重新读取；本地安排与原因已保留，请核对后再提交。',
  KNOCKOUT_SOURCE_CONFLICT: '来源赛果已变化，已按最新确认重新读取；请核对对阵后再发布。',
  GROUP_SOURCE_CONFLICT: '组赛赛果已变化，已按最新确认重新读取；请核对积分与晋级后再操作。',
  KNOCKOUT_ROUND_NOT_READY: '上一轮尚未全部有效独立确认，暂不能发布本轮。',
  KNOCKOUT_ROUND_PUBLISHED: '本轮已正式发布，已重新读取。',
  KNOCKOUT_DEPENDENCY_ORDER: '本轮比赛不能早于来源比赛结束，请调整开始时间。',
  GROUP_QUALIFICATION_NOT_READY: '组赛尚未全部有效确认或仍有同分待抽签，暂不能发布晋级。',
  GROUP_QUALIFICATION_PUBLISHED: '晋级首轮已发布，已重新读取。',
  GROUP_QUALIFICATION_REQUIRED: '须先发布分组晋级首轮。',
  GROUP_TIE_DRAWN: '该组同分抽签已保存，不能重复抽取。',
  GROUP_TIE_DRAW_NOT_REQUIRED: '该组当前不需要同分抽签。',
  SCHEDULE_CONFLICT: '场地、球队占用或休息间隔存在冲突，请调整后重试。',
  INVALID_EVENT_STATE: '当前赛事状态不允许该操作。',
  FORBIDDEN: '当前身份没有该操作权限，由服务端核验。',
};
function failure(error) {
  if (error && errorText[error.code]) return errorText[error.code];
  if (error && (error.code === 'NETWORK_ERROR' || error.code === 'SESSION_CHANGED'))
    return '网络中断，发布结果未知。请先重新读取核对，不会自动重发。';
  return ui.message(error);
}
// Unknown outcomes must be verified with a fresh read, never replayed (contract §C04/§12).
const unknown = (error) =>
  !!error && (error.code === 'NETWORK_ERROR' || error.code === 'SESSION_CHANGED' || !error.status);
function stateLabel(status) {
  return slotStatus[status] || api.matchStatus(status);
}
function slots(round, names) {
  return round.slots.map((s) => {
    const name = (id) => (id ? names[id] || '冻结参赛队' : '');
    const waiting = (source) =>
      source ? '待定（' + source + (s.sourceOutcome === 'LOSER' ? '负者' : '胜者') + '）' : '待定';
    return {
      key: s.fixtureKey,
      matchId: s.matchId || '',
      bye: s.status === 'BYE',
      home: s.status === 'BYE' ? name(s.byeEntryId) : name(s.homeEntryId) || waiting(s.homeSource),
      away: s.status === 'BYE' ? '轮空' : name(s.awayEntryId) || waiting(s.awaySource),
      status: s.status,
      statusLabel: stateLabel(s.status),
      winner: name(s.winnerEntryId),
      ...(s.kind
        ? {
            label: s.kind === 'THIRD_PLACE' ? '季军赛' : '决赛',
            winnerLabel: s.kind === 'THIRD_PLACE' ? '季军' : '冠军',
          }
        : {}),
    };
  });
}
function rounds(bracket, names) {
  return bracket
    ? bracket.rounds.map((r) => ({
        key: String(r.roundNo),
        label: r.label,
        published: r.published,
        slots: slots(r, names),
      }))
    : [];
}
function groups(competition, names) {
  return competition.groups.map((g) => ({
    key: g.groupKey,
    label: g.label,
    rows: g.standings.rows.map((r) => ({
      key: r.entryId,
      rank: r.rank === null ? '–' : String(r.rank) + (r.tied ? '=' : ''),
      team: r.teamName,
      record: r.wins + '-' + r.losses,
      points: String(r.leaguePoints),
      diff: (r.scoreDifference > 0 ? '+' : '') + r.scoreDifference,
    })),
    qualified: g.qualifiedEntryIds
      ? g.qualifiedEntryIds.map((id) => names[id] || '冻结参赛队').join(' → ')
      : '',
    ties: g.unresolvedTieEntryIds.map((id) => names[id] || '冻结参赛队').join('、'),
    needsDraw: g.unresolvedTieEntryIds.length > 0 && !g.draw,
    draw: g.draw
      ? {
          order: g.draw.orderedEntryIds.map((id) => names[id] || '冻结参赛队').join(' → '),
          reason: g.draw.reason,
          time: ui.localTime(g.draw.createdAt, true),
        }
      : null,
  }));
}
function placements(rows, names) {
  return (rows || [])
    .filter((p) => p.rank !== null)
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((p) => ({
      key: p.entryId,
      rank: '第' + p.rank + '名' + (p.tied ? '（并列）' : ''),
      team: p.teamName || names[p.entryId] || '冻结参赛队',
    }));
}
/** Why the next step cannot be taken right now; '' when it can. */
function blocker(kind, data) {
  if (kind === 'GROUP_KNOCKOUT') {
    const c = data.competition;
    if (!c) return '尚无已发布的分组对阵。请先在排赛中生成分组循环并发布。';
    if (c.isComplete) return '';
    const q = c.qualification.status;
    if (q === 'WAITING') return '等待全部组赛有效独立确认；不使用未确认比分提前晋级。';
    if (q === 'TIE_BREAK_REQUIRED')
      return data.capabilities.canDrawTies
        ? '存在影响晋级的同分，须先为该组独立保存抽签。'
        : '存在影响晋级的同分，须由赛事管理员独立保存抽签。';
    if (q === 'READY' && !data.capabilities.canPublishQualification)
      return '当前身份没有发布晋级的权限，由服务端核验。';
    if (q === 'PUBLISHED' && !c.nextRound) return '等待当前轮次全部有效独立确认。';
    if (q === 'PUBLISHED' && !data.capabilities.canPublishNextRound)
      return '当前身份没有发布下一轮的权限，由服务端核验。';
    return '';
  }
  const b = data.bracket;
  if (!b) return '尚未发布首轮比赛。请先在排赛中生成签位并发布首轮。';
  if (b.isComplete) return '';
  if (!b.nextRound) return '等待当前轮次全部有效独立确认；下一轮由已确认胜者产生。';
  if (!data.capabilities.canPublishNextRound) return '当前身份没有发布下一轮的权限，由服务端核验。';
  return '';
}
module.exports = {
  qualificationLabels,
  failure,
  unknown,
  rounds,
  groups,
  placements,
  blocker,
  stateLabel,
};

// C19 private seasons and the independent PRIVATE_SEASON data grant (mini program side).
// Pure helpers only: labels, input builders and display rows. Authorization is always the
// server's; capabilities returned by the server only decide which buttons are offered.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_COLLECTED = '未统计';

const seasonStatus = { DRAFT: '草稿', ACTIVE: '进行中', CLOSED: '已关闭' };
const grantStatus = {
  PENDING: '待本人确认',
  ACTIVE: '已同意',
  DECLINED: '已拒绝',
  WITHDRAWN: '主办方已撤回',
  REVOKED: '本人已撤销',
};
const reasonText = {
  NOT_CONSENTED: '尚未经本人同意',
  TERMINATED: '授权已结束',
  BINDING_ENDED: '成员绑定已结束',
  NOMINATOR_UNAUTHORIZED: '提名人已无提名权',
  SOURCE_NOT_FROZEN: '来源不在冻结名单',
  TARGET_INACTIVE: '账号已停用',
  ORGANIZATION_INACTIVE: '机构已停用',
};
const eventState = {
  INCLUDED: '已计入',
  NO_SCHEDULE: '尚未发布赛程',
  INVALID: '来源暂无法核验，未计入',
  OUT_OF_RANGE: '日期超出赛季，未计入',
};

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('资料编号无效');
  return value.toLowerCase();
}
function reason(value) {
  const result = String(value == null ? '' : value).trim();
  const size = Array.from(result).length;
  if (size < 4 || size > 500) throw new Error('请填写4至500个字的原因');
  return result;
}
function dayNumber(date) {
  return Date.parse(date + 'T00:00:00Z') / 86400000;
}
function validDate(value) {
  if (!DATE.test(value || '')) return false;
  const n = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}
/** The same bounds the server enforces; the server remains the authority. */
function seasonDraft(draft) {
  const name = String(draft.name || '').trim();
  if (!name || Array.from(name).length > 80) throw new Error('请填写1至80个字的赛季名称');
  if (!validDate(draft.startDate) || !validDate(draft.endDate))
    throw new Error('请填写有效的开始和结束日期（YYYY-MM-DD）');
  const span = dayNumber(draft.endDate) - dayNumber(draft.startDate);
  if (span < 0) throw new Error('结束日期不能早于开始日期');
  if (span > 731) throw new Error('赛季跨度不能超过731天');
  return { name, startDate: draft.startDate, endDate: draft.endDate };
}
function createInput(draft, clientRequestId) {
  return { clientRequestId: uuid(clientRequestId), ...seasonDraft(draft) };
}
/** Only changed fields are sent, with the version the page last read. */
function updateInput(season, draft) {
  const next = seasonDraft(draft);
  const body = { expectedVersion: season.version };
  for (const key of ['name', 'startDate', 'endDate'])
    if (next[key] !== season[key]) body[key] = next[key];
  if (Object.keys(body).length === 1) throw new Error('赛季资料没有变化');
  return body;
}
function commandInput(season, type, eventId) {
  if (!season || season.status === 'CLOSED') throw new Error('赛季已关闭，配置和赛事归属已锁定');
  if (type === 'ACTIVATE' && !season.capabilities.canActivate)
    throw new Error('只有草稿赛季可以激活');
  if (type === 'CLOSE' && !season.capabilities.canClose)
    throw new Error('只有进行中的赛季可以关闭');
  const needsEvent = type === 'ATTACH_EVENT' || type === 'DETACH_EVENT';
  return {
    type,
    ...(needsEvent ? { eventId: uuid(eventId) } : {}),
    expectedVersion: season.version,
  };
}
function sameSeasonCreate(a, b) {
  return !!a && !!b && a.name === b.name && a.startDate === b.startDate && a.endDate === b.endDate;
}

/** A nomination names exactly one frozen member whose current binding is the target account. */
function nominateInput(sources, selection, clientRequestId) {
  const team = (sources || []).find((t) => t.teamId === selection.teamId);
  const member = team && team.members.find((m) => m.memberId === selection.memberId);
  if (!member) throw new Error('请选择这届赛事冻结名单中的明确成员');
  if (!member.binding) throw new Error('该成员当前没有绑定账号，不能提名；仅绑定也不会产生授权');
  return {
    clientRequestId: uuid(clientRequestId),
    teamId: uuid(team.teamId),
    memberId: uuid(member.memberId),
    targetUserId: uuid(member.binding.userId),
    reason: reason(selection.reason),
  };
}
function grantCommandInput(grant, type) {
  const caps = (grant && grant.capabilities) || {};
  const allowed =
    (type === 'CONSENT' && caps.canConsent === true && grant.status === 'PENDING') ||
    (type === 'DECLINE' && caps.canDecline === true && grant.status === 'PENDING') ||
    (type === 'REVOKE' && caps.canRevoke === true && grant.status === 'ACTIVE');
  if (!allowed) throw new Error('授权状态或条件已变化，请刷新后核对');
  return { type, expectedVersion: grant.version };
}
function withdrawInput(grant, value) {
  if (!grant || !grant.capabilities || grant.capabilities.canWithdraw !== true)
    throw new Error('当前无法撤回该授权，请刷新后核对');
  return { reason: reason(value), expectedVersion: grant.version };
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : NOT_COLLECTED;
}
/** Display row: uncollected items are always “未统计”, never zero. */
function playerRow(row) {
  return {
    userId: row.userId,
    displayName: row.displayName,
    rankText: row.tied ? '并列第' + row.rank : '第' + row.rank,
    score: count(row.score),
    fouls: count(row.fouls),
    samples: count(row.rosterSampleMatchCount),
    events: count(row.eventCount),
    rebounds: row.rebounds == null ? NOT_COLLECTED : String(row.rebounds),
    assists: row.assists == null ? NOT_COLLECTED : String(row.assists),
    minutes: row.minutesPlayed == null ? NOT_COLLECTED : String(row.minutesPlayed),
    sources: (row.sources || []).map((s) => ({
      key: s.eventId + ':' + s.teamName + ':' + s.jerseyNo,
      text:
        s.eventName +
        ' · ' +
        s.teamName +
        ' · ' +
        s.jerseyNo +
        '号 ' +
        s.memberName +
        '：得分 ' +
        count(s.score) +
        '，犯规 ' +
        count(s.fouls) +
        '，名单场次 ' +
        count(s.rosterSampleMatchCount),
    })),
  };
}
function coverageRows(summary) {
  return (summary.events || []).map((e) => ({
    eventId: e.eventId,
    name: e.name,
    state: eventState[e.state] || e.state,
    text:
      e.state === 'INCLUDED'
        ? '逐人确认 ' +
          e.includedMatchCount +
          ' / ' +
          (e.recordableMatchCount === undefined ? e.totalMatchCount : e.recordableMatchCount) +
          ' 场；仅队伍统计 ' +
          e.teamOnlyConfirmedMatchCount +
          ' 场；待确认 ' +
          e.pendingMatchCount +
          ' 场' +
          (e.excludedAdministrativeMatchCount
            ? '；行政裁定／取消排除 ' + e.excludedAdministrativeMatchCount + ' 场，不记出场'
            : '')
        : eventState[e.state] || e.state,
  }));
}
/** Never present a partial sample as a complete ranking. */
function rankingNote(summary) {
  if (!summary.rows || !summary.rows.length) return '暂无可计入的已授权数据。';
  return summary.rankingComplete
    ? '仅含已授权球员；各届可统计比赛均已逐人确认。'
    : '部分样本：仍有比赛待确认、仅有队伍统计或来源未计入，不是完整排名。';
}
function grantView(grant) {
  return {
    ...grant,
    statusText: grantStatus[grant.status] || grant.status,
    reasonsText: (grant.ineffectiveReasons || []).map((r) => reasonText[r] || r).join('、'),
    seasonText: grant.season
      ? grant.season.name + '（' + (seasonStatus[grant.season.status] || '') + '）'
      : '尚未归入可查看的赛季',
  };
}
function seasonView(season) {
  return { ...season, statusText: seasonStatus[season.status] || season.status };
}
function seasonsPath(query) {
  const pairs = Object.keys(query)
    .filter((k) => query[k])
    .map((k) => k + '=' + encodeURIComponent(query[k]));
  return pairs.length ? '?' + pairs.join('&') : '';
}

module.exports = {
  NOT_COLLECTED,
  seasonStatus,
  grantStatus,
  reasonText,
  uuid,
  reason,
  seasonDraft,
  createInput,
  updateInput,
  commandInput,
  sameSeasonCreate,
  nominateInput,
  grantCommandInput,
  withdrawInput,
  playerRow,
  coverageRows,
  rankingNote,
  grantView,
  seasonView,
  seasonsPath,
};

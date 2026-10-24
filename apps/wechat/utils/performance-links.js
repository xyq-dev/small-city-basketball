const labels = { PENDING: '等待本人确认', APPROVED: '已同意公开', REVOKED: '已拒绝 / 已撤销' };
function emptyDraft() {
  return {
    eventId: '',
    orgId: '',
    teamId: '',
    memberId: '',
    profileId: '',
    reason: '',
    publisherConsent: false,
  };
}
function draftDirty(draft) {
  return (
    ['eventId', 'teamId', 'memberId', 'profileId', 'reason'].some((k) => !!draft[k]) ||
    draft.publisherConsent === true
  );
}
function mergeLinks(previous, incoming) {
  const result = previous.slice(),
    indexes = new Map(result.map((l, i) => [l.id, i]));
  for (const item of incoming) {
    if (indexes.has(item.id)) result[indexes.get(item.id)] = item;
    else {
      indexes.set(item.id, result.length);
      result.push(item);
    }
  }
  return result;
}
function visibleLinks(links, ownOnly, ownProfileId, filter) {
  return links.filter(
    (l) => (!ownOnly || l.profileId === ownProfileId) && (filter === 'ALL' || l.status === filter),
  );
}
function reason(value) {
  const result = String(value || '').trim();
  if (result.length < 2 || result.length > 500) throw new Error('请填写2至500个字符的处理原因');
  return result;
}
function allowed(link, type) {
  return (
    !!link &&
    !!link.capabilities &&
    (type === 'CONSENT'
      ? link.capabilities.canConsent === true && link.status === 'PENDING'
      : type === 'REVOKE' && link.capabilities.canRevoke === true && link.status !== 'REVOKED')
  );
}
function commandInput(link, type, value, consent, commandId) {
  if (!allowed(link, type)) throw new Error('当前权限或授权状态已变化，请刷新核对');
  if (type === 'CONSENT' && consent !== true) throw new Error('请明确确认本人记录与有限公开范围');
  return {
    commandId,
    expectedVersion: link.version,
    type,
    reason: reason(value),
    ...(type === 'CONSENT' ? { playerConsent: true } : {}),
  };
}
function nominateInput(draft, events, sources, profiles, commandId) {
  if (draft.publisherConsent !== true) throw new Error('请明确确认有权提供本次有限统计');
  const event = events.find((e) => e.id === draft.eventId && e.orgId === draft.orgId);
  if (!event || !sources || sources.event.id !== event.id || sources.event.orgId !== event.orgId)
    throw new Error('请重新选择当前有权管理的赛事');
  const team = sources.teams.find((t) => t.id === draft.teamId);
  if (!team || !team.members.some((m) => m.id === draft.memberId))
    throw new Error('请选择这届赛事、球队内的明确固定名单成员');
  if (!profiles.some((p) => p.id === draft.profileId && p.status === 'APPROVED'))
    throw new Error('请选择当前已审核的球员档案');
  return {
    commandId,
    orgId: event.orgId,
    eventId: event.id,
    teamId: team.id,
    memberId: draft.memberId,
    profileId: draft.profileId,
    reason: reason(draft.reason),
    publisherConsent: true,
  };
}
function cursorAfter(response, requested) {
  if (response.linksHasMore === true && (!response.nextCursor || response.nextCursor === requested))
    throw new Error('授权分页游标无效，请重新刷新');
  if (response.linksHasMore === false && response.nextCursor !== null)
    throw new Error('授权分页状态不一致，请重新刷新');
  return response.nextCursor;
}
module.exports = {
  labels,
  emptyDraft,
  draftDirty,
  mergeLinks,
  visibleLinks,
  reason,
  allowed,
  commandInput,
  nominateInput,
  cursorAfter,
};

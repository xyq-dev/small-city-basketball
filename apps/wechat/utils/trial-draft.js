const PREFIX = 'scb.event-trial.v1.';

function scopeKey(userId, orgId) {
  if (!userId) return '';
  return PREFIX + userId + '.' + (orgId || 'none');
}

function saveDraft(storage, userId, orgId, draft) {
  const scope = scopeKey(userId, orgId);
  if (!scope) return { ok: false, code: 'LOGIN', message: '登录后才能保存当前设备草稿。' };
  storage.setItem(scope, JSON.stringify({ ...draft, scope, savedAt: new Date().toISOString() }));
  return { ok: true, scope };
}

function loadDraft(storage, userId, orgId) {
  const scope = scopeKey(userId, orgId);
  if (!scope) return { ok: false, code: 'LOGIN', message: '登录后才能读取当前设备草稿。' };
  const raw = storage.getItem(scope);
  if (!raw) return { ok: true, draft: null };
  try {
    const draft = JSON.parse(raw);
    if (!draft || draft.scope !== scope)
      return { ok: false, code: 'DAMAGED', message: '草稿与当前身份不一致，原记录未覆盖。' };
    return { ok: true, draft };
  } catch {
    return { ok: false, code: 'DAMAGED', message: '草稿已损坏，请重新试排。原记录未覆盖。' };
  }
}

module.exports = { saveDraft, loadDraft, scopeKey };

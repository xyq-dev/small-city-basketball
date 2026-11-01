const api = require('./api');
const ui = require('./ui');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = [
  { value: 'ADULT_PLAYER', label: '成人球员' },
  { value: 'STAFF_SERVICE', label: '工作人员' },
  { value: 'TEAM_MATCHUP', label: '球队约赛' },
];
const ROLES = {
  ADULT_PLAYER: [
    { value: 'PG', label: '控球后卫' },
    { value: 'SG', label: '得分后卫' },
    { value: 'SF', label: '小前锋' },
    { value: 'PF', label: '大前锋' },
    { value: 'C', label: '中锋' },
  ],
  STAFF_SERVICE: [
    { value: 'REFEREE', label: '裁判' },
    { value: 'SCORER', label: '记分员' },
    { value: 'RECORDER', label: '技术记录' },
    { value: 'STREAMER', label: '直播' },
    { value: 'PHOTOGRAPHER', label: '摄影' },
  ],
  TEAM_MATCHUP: [{ value: 'TEAM', label: '对手球队' }],
};
const STATUS = {
  ACTIVE: '匹配中',
  PAUSED: '已暂停',
  CLOSED: '已关闭',
  EXPIRED: '已过期',
  PENDING: '等待对方',
  MUTUAL_INTEREST: '双方有意向',
  CONVERTED: '已转原预约',
  DECLINED: '已婉拒',
  WITHDRAWN: '已撤回',
  STALE: '资料变化，需重确认',
  SUPERSEDED: '该席位已安排',
  OPEN: '待补位',
  SOURCE_ENDED: '原预约结束',
};
const KIND = Object.fromEntries(TYPES.map((x) => [x.value, x.label]));
function bad() {
  throw new Error('撮合资料格式无效，请刷新后重试。');
}
function id(v) {
  if (typeof v !== 'string' || !ID.test(v)) bad();
  return v;
}
function integer(v, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(v) || v < min || v > max) bad();
  return v;
}
function string(v, max = 500) {
  if (typeof v !== 'string' || v.length > max) bad();
  return v;
}
function array(v, max = 200) {
  if (!Array.isArray(v) || v.length > max) bad();
  return v;
}
function object(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad();
  return v;
}
function time(v) {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) bad();
  return v;
}
function bool(v) {
  if (typeof v !== 'boolean') bad();
  return v;
}
function money(v) {
  return v === null ? '待报价' : '¥' + (integer(v) / 100).toFixed(2);
}
function score(raw) {
  const s = object(raw);
  if (
    s.ruleVersion !== 'match-rules-v1' ||
    !['SUFFICIENT', 'LIMITED', 'INCOMPLETE'].includes(s.band)
  )
    bad();
  integer(s.score, 0, 100);
  integer(s.coverage, 0, 100);
  const d = object(s.dimensions);
  for (const key of ['time', 'budget', 'travel', 'reliability'])
    if (d[key] !== null) integer(d[key], 0, 100);
  return {
    ...s,
    reasons: array(s.reasons, 8).map((x) => string(x, 200)),
    bandText: { SUFFICIENT: '资料较完整', LIMITED: '资料有限', INCOMPLETE: '需补充核验' }[s.band],
  };
}
function candidate(raw) {
  const c = object(raw);
  return {
    id: id(c.id),
    sourceId: id(c.sourceId),
    sourceOrgId: c.sourceOrgId === null ? null : id(c.sourceOrgId),
    sourceSlotId: c.sourceSlotId === null ? null : id(c.sourceSlotId),
    sourceVersion: integer(c.sourceVersion, 1),
    settingsVersion: c.settingsVersion === null ? null : integer(c.settingsVersion, 1),
    preferenceVersion: integer(c.preferenceVersion, 1),
    name: string(c.name, 100),
    role: string(c.role, 30),
    regionId: id(c.regionId),
    totalFen: c.totalFen === null ? null : integer(c.totalFen),
    priceText: money(c.totalFen),
    score: score(c.score),
    needsQuote: bool(c.needsQuote),
    crossCity: bool(c.crossCity),
  };
}
function intent(raw) {
  const i = object(raw);
  if (!STATUS[i.status]) bad();
  return {
    ...i,
    id: id(i.id),
    needId: id(i.needId),
    slotId: id(i.slotId),
    candidateId: id(i.candidateId),
    version: integer(i.version, 1),
    expiresAt: time(i.expiresAt),
    canAccept: bool(i.canAccept),
    canWithdraw: bool(i.canWithdraw),
    canConvert: bool(i.canConvert),
    sourceId: i.sourceId === null ? null : id(i.sourceId),
    candidate: i.candidate === null ? null : candidate(i.candidate),
    statusText: STATUS[i.status],
  };
}
function detail(raw) {
  const n = object(raw);
  if (!KIND[n.kind] || !['ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED'].includes(n.status)) bad();
  return {
    ...n,
    id: id(n.id),
    orgId: id(n.orgId),
    teamId: n.teamId === null ? null : id(n.teamId),
    title: string(n.title, 100),
    address: string(n.address, 200),
    regionId: id(n.regionId),
    catalogVersion: string(n.catalogVersion, 120),
    role: string(n.role, 30),
    quantity: integer(n.quantity, 1, 16),
    unitBudgetFen: integer(n.unitBudgetFen),
    totalBudgetFen: integer(n.totalBudgetFen),
    version: integer(n.version, 1),
    expiresAt: time(n.expiresAt),
    canManage: bool(n.canManage),
    truncated: bool(n.truncated),
    windows: array(n.windows, 64).map((w) => ({
      reportAt: time(w.reportAt),
      startAt: time(w.startAt),
      endAt: time(w.endAt),
      label: ui.localTime(w.reportAt, true) + ' — ' + ui.localTime(w.endAt, true),
    })),
    candidates: array(n.candidates, 100).map(candidate),
    intents: array(n.intents).map(intent),
    slots: array(n.slots, 16).map((s) => ({
      id: id(s.id),
      number: integer(s.number, 1, 16),
      generation: integer(s.generation, 1),
      status: string(s.status, 30),
      label: '席位 ' + s.number + ' · ' + (STATUS[s.status] || s.status),
    })),
    kindText: KIND[n.kind],
    statusText: STATUS[n.status],
    budgetText: money(n.totalBudgetFen),
  };
}
function summary(n) {
  if (!KIND[n.kind] || !STATUS[n.status]) bad();
  return {
    ...n,
    id: id(n.id),
    title: string(n.title, 100),
    version: integer(n.version, 1),
    expiresAt: time(n.expiresAt),
    kindText: KIND[n.kind],
    statusText: STATUS[n.status],
  };
}
function workspace(raw) {
  const w = object(raw);
  return {
    enabled: bool(w.enabled),
    conversionEnabled: bool(w.conversionEnabled),
    needs: array(w.needs, 100).map(summary),
    inbox: array(w.inbox, 100).map((i) => ({ ...summary(i), needId: id(i.needId) })),
    sources: array(w.sources, 500).map((s) => {
      if (!KIND[s.kind]) bad();
      return {
        ...s,
        id: id(s.id),
        name: string(s.name, 100),
        orgId: s.orgId === null ? null : id(s.orgId),
        role: string(s.role, 30),
        label: KIND[s.kind] + ' · ' + s.name,
      };
    }),
    preferences: array(w.preferences, 500).map((p) => ({
      ...p,
      sourceId: id(p.sourceId),
      regionId: id(p.regionId),
      version: integer(p.version, 1),
      discoveryEnabled: bool(p.discoveryEnabled),
      contactEnabled: bool(p.contactEnabled),
      allowedRegionIds: array(p.allowedRegionIds, 20).map(id),
    })),
  };
}
function result(raw) {
  const r = object(raw);
  if (
    !['MATCHING_PREFERENCE', 'MATCHING_NEED', 'MATCHING_RUN', 'MATCHING_INTENT'].includes(
      r.resourceType,
    )
  )
    bad();
  return {
    ...r,
    resourceId: id(r.resourceId),
    version: integer(r.version, 1),
    ...(r.needId ? { needId: id(r.needId) } : {}),
  };
}
function repository(client = api.getClient()) {
  const read = async (path) => (await client.request(path)).data;
  return {
    workspace: async () => workspace(await read('/v1/matching')),
    detail: async (key) => detail(await read('/v1/matching/needs/' + id(key))),
    receipt: async (commandId) => {
      if (!COMMAND.test(commandId)) bad();
      const r = object(await read('/v1/matching/receipts/' + commandId));
      return { found: bool(r.found), result: r.result === null ? null : result(r.result) };
    },
    write: async (path, body) => {
      if (!writePath(path)) bad();
      return result((await client.request(path, 'POST', body)).data);
    },
    preview: async (n, c) => {
      if (n.kind === 'TEAM_MATCHUP') return { enabled: false };
      const body =
        n.kind === 'ADULT_PLAYER'
          ? {
              kind: 'PLAYER_APPEARANCE',
              orgId: n.orgId,
              teamId: n.teamId,
              profileIds: [c.sourceId],
            }
          : { kind: 'LOCAL_BOOKING', sourceId: c.sourceId };
      const p = object((await client.request('/v1/trades/preview', 'POST', body)).data);
      bool(p.enabled);
      if (p.enabled) {
        string(p.terms, 10000);
        string(p.merchantName, 200);
        if (n.kind === 'ADULT_PLAYER') {
          const q = array(p.quotes, 3).find((v) => v.profileId === c.sourceId);
          if (
            !q ||
            q.profileVersion !== c.sourceVersion ||
            q.settingsVersion !== c.settingsVersion ||
            q.totalFen * n.windows.length !== c.totalFen ||
            !/^[a-f0-9]{64}$/.test(q.termsId)
          )
            throw new Error('报价已变化，请重新匹配。');
          return { ...p, acceptedTermsId: q.termsId };
        }
        if (p.totalFen !== c.totalFen) throw new Error('报价已变化，请重新匹配。');
        id(p.termsId);
        return { ...p, acceptedTermsId: p.termsId };
      }
      return { enabled: false };
    },
  };
}
const ROOT = '/v1/matching';
function writePath(p) {
  return (
    typeof p === 'string' &&
    new RegExp(
      '^' +
        ROOT +
        '/(?:preferences|needs(?:/[0-9a-f-]{36}/(?:runs|intents|commands))?|intents/[0-9a-f-]{36}/commands)$',
      'i',
    ).test(p)
  );
}
const KEY = 'scb.matching.pending.v1.';
function readPending(storage, actor) {
  const raw = storage.getStorageSync(KEY + id(actor));
  if (!raw) return null;
  const p = object(raw);
  if (
    p.actorId !== actor ||
    !writePath(p.path) ||
    !COMMAND.test(p.body?.commandId) ||
    JSON.stringify(p).length > 24000
  )
    throw new Error('待核对操作已损坏，请联系管理员核对。');
  return JSON.parse(JSON.stringify(p));
}
function savePending(storage, actor, path, body) {
  id(actor);
  if (!writePath(path) || !COMMAND.test(body.commandId) || readPending(storage, actor))
    throw new Error('请先核对上一笔操作结果。');
  const p = { actorId: actor, path, body };
  if (JSON.stringify(p).length > 24000) bad();
  storage.setStorageSync(KEY + actor, p);
  const saved = readPending(storage, actor);
  if (saved?.body.commandId !== body.commandId) throw new Error('无法保存操作编号，请重试。');
  return saved;
}
function clearPending(storage, actor, commandId) {
  const current = readPending(storage, actor);
  if (current && current.body.commandId !== commandId) throw new Error('待核对操作已变化');
  storage.removeStorageSync(KEY + actor);
  if (readPending(storage, actor)) throw new Error('请再次核对操作结果');
}
function windows(form) {
  return array(form, 64).map((w) => {
    const reportAt = new Date(w.date + 'T' + w.report + ':00+08:00'),
      startAt = new Date(w.date + 'T' + w.start + ':00+08:00'),
      endAt = new Date(w.endDate + 'T' + w.end + ':00+08:00');
    if (
      ![reportAt, startAt, endAt].every((v) => Number.isFinite(v.getTime())) ||
      startAt < reportAt ||
      endAt <= startAt ||
      endAt - reportAt > 86400000
    )
      throw new Error('请填写有效报到、开赛、结束时间（最长24小时）。');
    return {
      reportAt: reportAt.toISOString(),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    };
  });
}
function fen(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('金额最多两位小数');
  return integer(Math.round(Number(value) * 100));
}
module.exports = {
  TYPES,
  ROLES,
  STATUS,
  KIND,
  id,
  fen,
  windows,
  workspace,
  detail,
  candidate,
  repository,
  readPending,
  savePending,
  clearPending,
};

const api = require('./api');
const ui = require('./ui');

// Native views of the existing P05-A scoring contract. The server owns the state machine,
// clock, leases, CAS and confirmer independence; these helpers only shape requests/views.
const kinds = { SCORE: '得分', FOUL: '犯规', TIMEOUT: '暂停' };
const sides = { HOME: '主队', AWAY: '客队' };
const eventNames = {
  PREPARE_MATCH: '准备比赛',
  START_MATCH: '开始比赛',
  CLOCK_START: '启动计时',
  CLOCK_PAUSE: '暂停计时',
  CLOCK_SET: '校正时钟',
  NEXT_PERIOD: '进入下一节',
  START_OVERTIME: '进入加时',
  END_MATCH: '结束比赛，待确认',
  CONFIRM_RESULT: '赛果独立确认',
  REOPEN_RESULT: '重开赛果',
};
const commandNames = {
  ...eventNames,
  RECORD_STAT: '记录',
  ADD_CORRECTION: '补录更正',
  VOID_STAT: '撤销记录',
  REPLACE_STAT: '更正记录',
};
const errorText = {
  VERSION_CONFLICT: '比赛已被其他操作更新，已重新读取，请核对后再操作。',
  LEASE_CONFLICT: '记分控制已失效或由他人持有，请重新取得控制。',
  IDEMPOTENCY_CONFLICT: '同一操作编号已用于不同内容，已停止重发，请重新读取。',
  INVALID_MATCH_STATE: '当前比赛状态不允许该操作，已重新读取。',
  SCORER_REQUIRED: '本场尚未分配有效记分员，请先在赛事工作台分配。',
  MATCH_NOT_PREPARED: '比赛尚未准备，暂无记分快照。',
  SCORING_RULES_REQUIRED: '赛事尚未设置记分规则，请先在赛事工作台设置。',
  PROJECTION_MISMATCH: '比分投影与记录不一致，已停止确认，请联系主办方核对。',
  FORBIDDEN: '当前身份无权执行该操作。',
};
function failure(error) {
  if (!error) return '操作未完成，请重新读取后核对';
  if (errorText[error.code]) return errorText[error.code];
  return ui.message(error);
}
function period(rules, value) {
  if (!rules || !Number.isSafeInteger(value)) return '节次待确认';
  return value <= rules.regulationPeriods
    ? '第' + value + '节'
    : '加时' + (value - rules.regulationPeriods);
}
function duration(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 1) return '时长待确认';
  return seconds % 60 === 0 ? seconds / 60 + ' 分钟' : seconds + ' 秒';
}
function totals(value) {
  return value
    ? { score: value.score, fouls: value.fouls, timeouts: value.timeouts }
    : { score: 0, fouls: 0, timeouts: 0 };
}
function resultLabel(snapshot) {
  if (!snapshot) return '尚未开始记分';
  if (snapshot.requiresReconfirmation) return '赛果已重开，待重新独立确认';
  if (snapshot.status === 'FINAL') return '赛果已独立确认';
  if (snapshot.status === 'PENDING_CONFIRMATION') return '比赛已结束，待独立确认';
  return '比赛未结束，比分不是正式赛果';
}
/** Board view; the clock is interpolated once from serverTime, never per stale anchor. */
function board(snapshot, receivedAt, now = Date.now()) {
  if (!snapshot) return null;
  return {
    version: snapshot.version,
    status: snapshot.status,
    statusLabel: api.matchStatus(snapshot.status),
    resultLabel: resultLabel(snapshot),
    final: snapshot.status === 'FINAL' && !snapshot.requiresReconfirmation,
    home: { name: snapshot.home.teamName, ...totals(snapshot.totals && snapshot.totals.home) },
    away: { name: snapshot.away.teamName, ...totals(snapshot.totals && snapshot.totals.away) },
    periodLabel: snapshot.clock ? period(snapshot.rules, snapshot.clock.period) : '',
    clockLabel: api.clockText(snapshot, receivedAt, now),
    running: !!(snapshot.clock && snapshot.clock.running),
    allowedScores: (snapshot.rules && snapshot.rules.allowedScoreValues) || [],
    periods: (snapshot.periods || []).map((p) => ({
      key: String(p.period),
      label: period(snapshot.rules, p.period),
      home: p.home.score,
      away: p.away.score,
    })),
    playerMode: !!(snapshot.collected && snapshot.collected.playerStatistics),
  };
}
function remaining(snapshot, receivedAt, now = Date.now()) {
  const c = snapshot && snapshot.clock;
  if (!c) return 0;
  let value = c.remainingMs;
  if (c.running)
    value -= Math.max(
      0,
      Date.parse(snapshot.serverTime) + (now - receivedAt) - Date.parse(c.anchorServerTime),
    );
  return Math.max(0, value);
}
/** History rows newest first; voided records stay listed and are marked, never removed. */
function history(events, snapshot, names = {}) {
  const voided = new Set(
    events.filter((e) => e.type === 'STAT_VOIDED' && e.targetEventId).map((e) => e.targetEventId),
  );
  const team = (side) =>
    (snapshot && snapshot[side === 'HOME' ? 'home' : 'away'].teamName) || sides[side] || '';
  return events
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .map((e) => {
      const p = e.payload || {};
      let text = eventNames[e.type] || e.type;
      if (e.type === 'STAT_RECORDED')
        text =
          team(p.side) +
          ' ' +
          (kinds[p.kind] || p.kind) +
          (p.kind === 'SCORE' ? ' +' + p.value : '') +
          (p.memberId && names[p.memberId] ? ' · ' + names[p.memberId] : '');
      if (e.type === 'STAT_VOIDED') text = '撤销一条记录';
      return {
        key: e.id,
        id: e.id,
        seq: e.seq,
        text,
        reason: typeof p.reason === 'string' ? p.reason : '',
        periodLabel: snapshot && p.period ? period(snapshot.rules, p.period) : '',
        time: ui.localTime(e.serverTime),
        voided: voided.has(e.id),
        canVoid: e.type === 'STAT_RECORDED' && !voided.has(e.id),
      };
    });
}
async function allPages(client, path, limit = 20) {
  let cursor = null,
    rows = [];
  for (let page = 0; page < limit; page++) {
    const response = await client.request(
      path + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    if (!Array.isArray(response.data)) throw { message: '记录资料格式无效' };
    rows = rows.concat(response.data);
    cursor = response.meta.nextCursor;
    if (!cursor) return rows;
  }
  throw { message: '记录过多，请在Web工作台核对完整历史' };
}
async function envelope(type, payload, expectedVersion, control) {
  return {
    commandId: await ui.uuid(),
    expectedVersion,
    type,
    payload,
    capturedAt: new Date().toISOString(),
    ...(control ? { control } : {}),
  };
}
const unknown = (error) =>
  !!error && (error.code === 'NETWORK_ERROR' || error.code === 'SESSION_CHANGED' || !error.status);
/**
 * Send one command. An unknown outcome keeps the exact envelope; the caller resolves it by
 * reading the receipt for the same commandId and only resends that identical envelope.
 */
async function send(client, base, body) {
  try {
    return { done: true, result: (await client.request(base + '/commands', 'POST', body)).data };
  } catch (error) {
    if (unknown(error)) return { done: false, pending: body, error };
    throw error;
  }
}
async function receipt(client, base, commandId) {
  try {
    return (await client.request(base + '/commands/' + api.uuid(commandId))).data;
  } catch (error) {
    if (error && error.code === 'COMMAND_NOT_FOUND') return null;
    throw error;
  }
}
module.exports = {
  kinds,
  sides,
  commandNames,
  failure,
  period,
  duration,
  board,
  remaining,
  history,
  allPages,
  envelope,
  send,
  receipt,
  resultLabel,
};

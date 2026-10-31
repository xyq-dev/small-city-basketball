const ui = require('./ui');
const api = require('./api');
const TYPES = [
  'RECORD_STAT',
  'ADD_CORRECTION',
  'VOID_STAT',
  'REPLACE_STAT',
  'RECORD_SHOT',
  'RECORD_TECHNICAL',
  'VOID_PRO_STAT',
  'ADD_PRO_CORRECTION',
];
const PREFIX = 'scb.scoring.offline.v1.';
const error = (code, message) => ({ code, message });
const copy = (value) => JSON.parse(JSON.stringify(value));
const isId = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function key(scope) {
  if (!scope || !['actorId', 'orgId', 'matchId'].every((k) => isId(scope[k])))
    throw error('OFFLINE_SCOPE_INVALID', '离线草稿身份无效');
  return PREFIX + [scope.actorId, scope.orgId, scope.matchId].join('.');
}
function validate(queue, scope) {
  if (
    !queue ||
    queue.schema !== 1 ||
    JSON.stringify(queue.scope) !== JSON.stringify(scope) ||
    !isId(queue.queueId) ||
    !Number.isSafeInteger(queue.baseVersion) ||
    queue.baseVersion < 1 ||
    !Number.isSafeInteger(queue.nextOrdinal) ||
    queue.nextOrdinal < 1 ||
    !Array.isArray(queue.items) ||
    queue.items.length > 200
  )
    throw error('OFFLINE_QUEUE_INVALID', '离线草稿格式异常，已停止同步，请导出并人工核对');
  let prior = null,
    ordinal = null;
  for (const item of queue.items) {
    const command = item && item.command;
    if (
      !item ||
      !isId(item.intentId) ||
      item.queueId !== queue.queueId ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 1 ||
      !command ||
      command.commandId !== item.intentId ||
      !TYPES.includes(command.type) ||
      Object.keys(command).some(
        (k) => !['commandId', 'expectedVersion', 'capturedAt', 'type', 'payload'].includes(k),
      ) ||
      command.expectedVersion !== queue.baseVersion + item.ordinal - 1 ||
      !command.payload ||
      typeof command.payload !== 'object' ||
      Array.isArray(command.payload) ||
      !Number.isFinite(Date.parse(command.capturedAt)) ||
      (item.ordinal === 1 ? item.previousIntentId !== null : !isId(item.previousIntentId)) ||
      (prior && item.previousIntentId !== prior) ||
      (ordinal !== null && item.ordinal !== ordinal + 1)
    )
      throw error('OFFLINE_QUEUE_INVALID', '离线原命令或顺序异常，已停止同步');
    prior = item.intentId;
    ordinal = item.ordinal;
  }
  if (queue.items.length && (queue.nextOrdinal !== ordinal + 1 || queue.lastIntentId !== prior))
    throw error('OFFLINE_QUEUE_INVALID', '离线尾部顺序异常');
  return queue;
}
function read(wxApi, scope) {
  const raw = wxApi.getStorageSync(key(scope));
  if (raw === undefined || raw === null || raw === '') return null;
  return copy(validate(raw, scope));
}
function write(wxApi, scope, queue) {
  validate(queue, scope);
  wxApi.setStorageSync(key(scope), copy(queue));
}
async function append(wxApi, scope, type, payload, version) {
  if (!TYPES.includes(type))
    throw error('OFFLINE_ONLINE_REQUIRED', '时钟、阵容、节次与确认须在线操作');
  // Complete random-number awaits before reading shared device storage. The read/append/
  // write below is synchronous, so another page cannot be overwritten by an older copy.
  const candidateQueueId = await ui.uuid();
  const intentId = await ui.uuid();
  let queue = read(wxApi, scope);
  if (!queue || !queue.items.length)
    queue = {
      schema: 1,
      scope: copy(scope),
      queueId: candidateQueueId,
      baseVersion: version,
      nextOrdinal: 1,
      lastIntentId: null,
      items: [],
    };
  if (queue.items.length >= 200)
    throw error('OFFLINE_QUEUE_FULL', '离线草稿已达200条，请先同步或人工核对');
  const intent = {
    intentId,
    queueId: queue.queueId,
    ordinal: queue.nextOrdinal,
    previousIntentId: queue.lastIntentId,
    command: {
      commandId: intentId,
      type,
      payload: copy(payload),
      expectedVersion: queue.baseVersion + queue.nextOrdinal - 1,
      capturedAt: new Date().toISOString(),
    },
  };
  queue.items.push(intent);
  queue.nextOrdinal++;
  queue.lastIntentId = intentId;
  // Persist before showing success. Storage failure must never masquerade as a saved draft.
  write(wxApi, scope, queue);
  return queue;
}
function discard(wxApi, scope) {
  wxApi.removeStorageSync(key(scope));
}
async function sync(wxApi, scope, client, base, control, current, onAccepted) {
  let queue = read(wxApi, scope),
    latest = null,
    accepted = 0;
  if (!queue || !queue.items.length) return { accepted, latest };
  const confirmedThrough = queue.items[queue.items.length - 1].ordinal;
  while (queue.items.length && queue.items[0].ordinal <= confirmedThrough) {
    if (!current()) throw error('SESSION_CHANGED', '登录身份或控制已变化，原草稿保留');
    const intent = queue.items[0];
    let result;
    try {
      result = (await client.request(base + '/offline-intents/' + api.uuid(intent.intentId))).data;
    } catch (e) {
      if (!e || e.code !== 'OFFLINE_INTENT_NOT_FOUND') throw e;
    }
    if (!current()) throw error('SESSION_CHANGED', '登录身份或控制已变化，原草稿保留');
    if (!result)
      result = (
        await client.request(base + '/offline-intents', 'POST', {
          intent,
          control,
          confirmImport: true,
        })
      ).data;
    if (!current()) throw error('SESSION_CHANGED', '登录身份或控制已变化，原草稿保留');
    if (
      !result ||
      result.intentId !== intent.intentId ||
      !result.receipt ||
      result.receipt.commandId !== intent.intentId ||
      result.receipt.appliedVersion !== intent.command.expectedVersion + 1 ||
      !result.snapshot
    )
      throw error('OFFLINE_RECEIPT_INVALID', '原操作回执不一致，草稿保留待核对');
    if (typeof onAccepted === 'function') onAccepted(result);
    // A different page may append while the network is pending. Merge only this exact
    // acknowledged head into the latest queue, and leave any newly appended tail for a
    // separate explicit sync. A replaced/deleted queue must never be resurrected.
    const currentQueue = read(wxApi, scope);
    if (
      !currentQueue ||
      currentQueue.queueId !== queue.queueId ||
      !currentQueue.items.length ||
      JSON.stringify(currentQueue.items[0]) !== JSON.stringify(intent)
    )
      throw error(
        'OFFLINE_QUEUE_CHANGED',
        '本机原草稿已由另一页面变更，请重新核对；未覆盖当前队列',
      );
    currentQueue.items.shift();
    write(wxApi, scope, currentQueue);
    queue = currentQueue;
    accepted++;
    latest = result;
  }
  return { accepted, latest };
}
module.exports = { TYPES, key, read, append, discard, sync };

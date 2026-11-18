const api = require('./api');
const ui = require('./ui');

const PREFIX = 'scb.event-service.pending.v1.';

function storage() {
  return {
    getItem(key) {
      try {
        const value = wx.getStorageSync(key);
        return typeof value === 'string' ? value : '';
      } catch {
        return '';
      }
    },
    setItem(key, value) {
      wx.setStorageSync(key, value);
    },
    removeItem(key) {
      wx.removeStorageSync(key);
    },
  };
}

function classifyFailure(error) {
  const status = error && error.status;
  const code = error && error.code;
  if (
    !status ||
    status === 408 ||
    status >= 500 ||
    code === 'COMMERCE_OPERATION_PENDING' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'NETWORK_ERROR'
  )
    return 'unknown';
  if (status === 409) return 'conflict';
  return 'rejected';
}

function readPending(store, scope) {
  const raw = store.getItem(PREFIX + scope);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    return pending && pending.scope === scope ? pending : null;
  } catch {
    return null;
  }
}

function writePending(store, pending) {
  store.setItem(PREFIX + pending.scope, JSON.stringify(pending));
}

async function readWorkspace(orgId) {
  const id = api.uuid(orgId);
  const [commerce, membership] = await Promise.all([
    api.getClient().request('/v1/orgs/' + id + '/commerce'),
    api.getClient().request('/v1/orgs/' + id + '/software-membership'),
  ]);
  return { commerce: commerce.data, membership: membership.data };
}

async function send(scope, path, body, replay, actorId) {
  const store = storage();
  const pending = readPending(store, scope);
  const sameActor = !actorId || !pending || !pending.actorId || pending.actorId === actorId;
  const payload = pending && pending.path === path && replay && sameActor ? pending.body : body;
  if (!pending || pending.path !== path || !sameActor)
    writePending(store, { scope, path, body: payload, actorId: actorId || '' });
  try {
    const response = await api.getClient().request(path, 'POST', payload);
    store.removeItem(PREFIX + scope);
    return { ok: true, data: response.data };
  } catch (error) {
    const kind = classifyFailure(error);
    if (kind !== 'unknown') store.removeItem(PREFIX + scope);
    return { ok: false, kind, error };
  }
}

function eventOrderScope(orgId, eventId) {
  return 'EVENT:' + api.uuid(orgId) + ':' + api.uuid(eventId);
}

async function recoverEventOrder(orgId, eventId, actorId) {
  const id = api.uuid(orgId);
  const scope = eventOrderScope(orgId, eventId);
  const pending = readPending(storage(), scope);
  if (!pending || (actorId && pending.actorId && pending.actorId !== actorId))
    return { ok: true, skipped: true };
  return send(scope, '/v1/orgs/' + id + '/commerce/orders', pending.body, true, actorId || '');
}

function createEventOrder(orgId, body) {
  const id = api.uuid(orgId);
  api.uuid(body.eventId);
  api.uuid(body.planId);
  api.uuid(body.commandId);
  if (!Number.isInteger(body.expectedEventVersion)) throw new Error('赛事版本无效');
  const payload = {
    commandId: body.commandId,
    eventId: body.eventId,
    planId: body.planId,
    expectedEventVersion: body.expectedEventVersion,
  };
  return send(
    'EVENT:' + id + ':' + body.eventId,
    '/v1/orgs/' + id + '/commerce/orders',
    payload,
    true,
    body.actorId || '',
  );
}

function eventCommand(orgId, orderId, body) {
  const id = api.uuid(orgId);
  api.uuid(orderId);
  api.uuid(body.commandId);
  if (!Number.isInteger(body.expectedOrderVersion)) throw new Error('订单版本无效');
  const payload = {
    commandId: body.commandId,
    type: body.type,
    expectedOrderVersion: body.expectedOrderVersion,
  };
  if (body.reason) payload.reason = body.reason;
  return send(
    'EVENT_ORDER:' + orderId + ':' + body.type,
    '/v1/orgs/' + id + '/commerce/orders/' + orderId + '/commands',
    payload,
    true,
  );
}

module.exports = {
  readWorkspace,
  createEventOrder,
  eventCommand,
  recoverEventOrder,
  classifyFailure,
  readPending,
};

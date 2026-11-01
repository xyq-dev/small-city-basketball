const api = require('./api');
const ui = require('./ui');
const ls = require('./local-services');
const COMMAND = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = {
  DRAFT: '尚未发出邀请',
  INVITING: '正在分批邀请',
  PAUSED: '已暂停',
  REVIEWING: '待客户确认完整报价',
  NEEDS_MANUAL: '需要人工协调',
  SOURCE_REQUESTED: '已转真实预约，待服务方接单',
  SOURCE_CONFIRMED: '预约已确认',
  SOURCE_ENDED: '源预约已结束',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
  PENDING: '待服务方报价',
  TRAVEL_REVIEW: '待独立核验交通方案',
  READY: '交通已核验，待本人接单',
  ACCEPTED_HELD: '档期暂占，待客户确认',
  CONVERTED: '已转真实预约',
  DECLINED: '已拒绝',
  WITHDRAWN: '已撤回',
  SUPERSEDED: '本次邀请已结束',
};
const KINDS = [
  { value: 'REFEREE', label: '裁判' },
  { value: 'SCORER', label: '计分员' },
  { value: 'RECORDER', label: '记录员' },
  { value: 'STREAMER', label: '直播人员' },
  { value: 'PHOTOGRAPHER', label: '摄影师' },
];
function obj(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('派单资料无效');
  return v;
}
function stamp(v) {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error('派单时间无效');
  return v;
}
function version(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new Error('派单版本无效');
  return v;
}
function fen(v) {
  if (typeof v !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(v.trim()))
    throw new Error('请填写非负金额，最多两位小数');
  const parts = v.trim().split('.');
  const n = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (n > 100000000) throw new Error('金额超过允许上限');
  return n;
}
function money(v) {
  obj(v);
  const r = {};
  for (const k of ['serviceMinor', 'travelMinor', 'lodgingMinor', 'platformMinor', 'totalMinor']) {
    if (!Number.isSafeInteger(v[k]) || v[k] < 0 || v[k] > 100000000)
      throw new Error('派单费用无效');
    r[k] = v[k];
  }
  return {
    ...r,
    totalText: ui.money(r.totalMinor),
    detailText:
      '服务 ' +
      ui.money(r.serviceMinor) +
      ' · 交通 ' +
      ui.money(r.travelMinor) +
      ' · 住宿 ' +
      ui.money(r.lodgingMinor) +
      ' · 平台 ' +
      ui.money(r.platformMinor),
  };
}
function request(v) {
  obj(v);
  if (
    !STATUS[v.status] ||
    !KINDS.some((k) => k.value === v.kind) ||
    !Array.isArray(v.inviteRegionIds)
  )
    throw new Error('派单需求无效');
  return {
    ...v,
    id: ls.id(v.id),
    orgId: ls.id(v.orgId),
    version: version(v.version),
    serviceRegion: ls.region(v.serviceRegion),
    startsAt: stamp(v.startsAt),
    endsAt: stamp(v.endsAt),
    expiresAt: stamp(v.expiresAt),
    serviceAddress: ls.text(v.serviceAddress, '服务地点', 4, 200),
    budget: money(v.budget),
    kindText: KINDS.find((k) => k.value === v.kind).label,
    statusText: STATUS[v.status],
    timeText: ui.localTime(v.startsAt, true) + ' — ' + ui.localTime(v.endsAt, true),
    expiresText: ui.localTime(v.expiresAt, true),
    canManage: v.canManage === true,
    canConfirm: v.canConfirm === true,
    sourceBookingId: v.sourceBookingId ? ls.id(v.sourceBookingId) : null,
  };
}
function offer(v) {
  obj(v);
  if (!STATUS[v.status]) throw new Error('服务邀请无效');
  let quote = null;
  if (v.quote) {
    const q = obj(v.quote);
    if (!/^[0-9a-f]{64}$/.test(v.quoteHash) || q.hash !== v.quoteHash)
      throw new Error('报价版本无效');
    quote = {
      ...q,
      ...money(q),
      slotId: ls.id(q.slotId),
      departureAt: stamp(q.departureAt),
      arrivalAt: stamp(q.arrivalAt),
      returnAt: stamp(q.returnAt),
      routeText:
        '出发 ' +
        ui.localTime(q.departureAt, true) +
        ' · 报到 ' +
        ui.localTime(q.arrivalAt, true) +
        ' · 返回 ' +
        ui.localTime(q.returnAt, true),
    };
  }
  return {
    ...v,
    id: ls.id(v.id),
    listingId: ls.id(v.listingId),
    version: version(v.version),
    request: request(v.request),
    quote,
    statusText: STATUS[v.status],
    expiresText: ui.localTime(stamp(v.expiresAt), true),
    holdText: v.holdExpiresAt ? ui.localTime(stamp(v.holdExpiresAt), true) : '',
    canQuote: v.canQuote === true,
    canReviewTravel: v.canReviewTravel === true,
    canAccept: v.canAccept === true,
    canWithdraw: v.canWithdraw === true,
  };
}
function result(v) {
  obj(v);
  if (!['DISPATCH_REQUEST', 'DISPATCH_OFFER', 'DISPATCH_PREFERENCE'].includes(v.resourceType))
    throw new Error('派单回执无效');
  return { ...v, resourceId: ls.id(v.resourceId), version: version(v.version) };
}
function repository(client = api.getClient()) {
  const read = async (path) => (await client.request(path)).data;
  return {
    async workspace() {
      const r = obj(await read('/v1/dispatch'));
      if (
        !Array.isArray(r.requests) ||
        r.requests.length > 100 ||
        !Array.isArray(r.offers) ||
        r.offers.length > 100
      )
        throw new Error('派单列表无效');
      return { ...r, requests: r.requests.map(request), offers: r.offers.map(offer) };
    },
    async detail(id) {
      const r = obj(await read('/v1/dispatch/requests/' + ls.id(id)));
      if (!Array.isArray(r.offers) || r.offers.length > 9) throw new Error('派单明细无效');
      return { request: request(r.request), offers: r.offers.map(offer) };
    },
    async offer(id) {
      return offer(await read('/v1/dispatch/offers/' + ls.id(id)));
    },
    async slots(id) {
      const r = (await client.requestPublic('/v1/public/local-listings/' + ls.id(id))).data;
      if (!Array.isArray(r.slots)) throw new Error('档期资料无效');
      return r.slots.map(ls.slot);
    },
    async receipt(id) {
      if (!COMMAND.test(id)) throw new Error('操作编号无效');
      return result(await read('/v1/dispatch/receipts/' + id));
    },
    async send(record) {
      return result((await client.request(record.path, 'POST', record.body)).data);
    },
  };
}
const KEY = 'scb.dispatch.pending.v1.';
const PATH =
  /^\/v1\/dispatch\/(?:preferences|requests|(?:requests|offers)\/[0-9a-f-]{36}\/commands)$/i;
function pendingRecord(v) {
  obj(v);
  if (
    v.version !== 1 ||
    !PATH.test(v.path) ||
    !COMMAND.test(v.body?.commandId) ||
    JSON.stringify(v).length > 16000
  )
    throw new Error('本机原派单操作已损坏，请联系管理员核对');
  return {
    version: 1,
    actorId: ls.id(v.actorId),
    path: v.path,
    body: JSON.parse(JSON.stringify(v.body)),
    label: ls.text(v.label, '操作', 1, 60),
  };
}
function readPending(wxApi, actor) {
  try {
    const v = wxApi.getStorageSync(KEY + ls.id(actor));
    if (!v) return { record: null, error: '' };
    const record = pendingRecord(v);
    if (record.actorId !== actor) throw new Error('原操作身份不一致');
    return { record, error: '' };
  } catch (e) {
    return { record: null, error: ui.message(e) };
  }
}
function savePending(wxApi, r) {
  try {
    r = pendingRecord(r);
    const old = readPending(wxApi, r.actorId);
    if (old.error || (old.record && old.record.body.commandId !== r.body.commandId)) return false;
    wxApi.setStorageSync(KEY + r.actorId, r);
    const actual = readPending(wxApi, r.actorId);
    return !actual.error && JSON.stringify(actual.record) === JSON.stringify(r);
  } catch {
    return false;
  }
}
function clearPending(wxApi, actor, id) {
  try {
    const old = readPending(wxApi, actor);
    if (old.error || !old.record || old.record.body.commandId !== id) return false;
    wxApi.removeStorageSync(KEY + actor);
    const after = readPending(wxApi, actor);
    return !after.error && !after.record;
  } catch {
    return false;
  }
}
function loadPending(page) {
  const r = readPending(wx, page._viewer);
  page.setData({ pending: r.record, pendingError: r.error });
}
const uncertain = (e) =>
  !e ||
  ['NETWORK_ERROR', 'INVALID_RESPONSE', 'SESSION_CHANGED'].includes(e.code) ||
  e.status >= 500;
async function sendPending(page, r, op) {
  if (page.data.busy || r.actorId !== page._viewer || (op && !op.valid())) return false;
  const actor = page._viewer,
    guard = ui.hold(page);
  page.setData({ busy: true, error: '', message: '' });
  try {
    const value = await repository().send(r);
    if (!ui.held(page, guard) || page._viewer !== actor) return false;
    const cleared = clearPending(wx, actor, r.body.commandId);
    page.setData({
      pending: cleared ? null : r,
      pendingError: cleared ? '' : '服务器已确认，本机回执尚未清理，请再次核对',
      message: '操作已由服务器确认',
    });
    return value;
  } catch (e) {
    if (ui.held(page, guard) && page._viewer === actor) {
      if (!uncertain(e)) {
        const cleared = clearPending(wx, actor, r.body.commandId);
        page.setData({
          pending: cleared ? null : r,
          pendingError: cleared ? '' : '本机原编号清理失败',
        });
      }
      page.setData({
        error: ui.message(e),
        message: uncertain(e) ? '结果尚未确认；请查询回执或重试原操作，不要重新创建需求。' : '',
      });
    }
    return false;
  } finally {
    if (ui.held(page, guard)) page.setData({ busy: false });
  }
}
async function write(page, { path, body, label, content }) {
  if (page.data.busy || page.data.pending || page.data.pendingError || !page._viewer) return false;
  const actor = page._viewer,
    op = await ui.confirmOp(page, label, content);
  if (!op || !op.valid() || actor !== page._viewer) return false;
  const commandId = await ui.uuid();
  if (!op.valid() || actor !== page._viewer) return false;
  const r = pendingRecord({
    version: 1,
    actorId: actor,
    path,
    body: { ...body, commandId },
    label,
  });
  if (!savePending(wx, r)) {
    page.setData({ error: '无法保存原操作，未发送请求。请检查本机存储。' });
    return false;
  }
  page.setData({ pending: r });
  return sendPending(page, r, op);
}
async function recover(page) {
  if (page.data.busy || !page._viewer) return;
  loadPending(page);
  const r = page.data.pending;
  if (!r || page.data.pendingError) return;
  const actor = page._viewer,
    guard = ui.hold(page);
  page.setData({ busy: true, error: '' });
  try {
    await repository().receipt(r.body.commandId);
    if (ui.held(page, guard) && page._viewer === actor) {
      const cleared = clearPending(wx, actor, r.body.commandId);
      page.setData({
        pending: cleared ? null : r,
        pendingError: cleared ? '' : '服务器已确认，本机回执尚未清理',
        message: '已查到原操作回执，请刷新派单详情',
      });
    }
  } catch (e) {
    if (ui.held(page, guard) && page._viewer === actor)
      page.setData({
        error:
          e.status === 404
            ? '尚未查到回执；请重试原编号和原内容，不要新建第二个请求。'
            : ui.message(e),
      });
  } finally {
    if (ui.held(page, guard)) page.setData({ busy: false });
  }
}
async function retry(page) {
  const s = readPending(wx, page._viewer);
  page.setData({ pending: s.record, pendingError: s.error });
  if (s.error || !s.record) return false;
  const op = await ui.confirmOp(page, '重试原派单操作', '将保持原编号和原内容：' + s.record.label);
  if (!op) return false;
  return sendPending(page, s.record, op);
}
module.exports = {
  STATUS,
  KINDS,
  fen,
  money,
  request,
  offer,
  result,
  repository,
  pendingRecord,
  readPending,
  savePending,
  clearPending,
  loadPending,
  write,
  recover,
  retry,
  uncertain,
};

const api = require('./api');
const ui = require('./ui');
const KINDS = [
  { value: '', label: '全部' },
  { value: 'COURT', label: '球场' },
  { value: 'REFEREE', label: '裁判' },
  { value: 'SCORER', label: '记分员' },
  { value: 'RECORDER', label: '技术记录' },
  { value: 'STREAMER', label: '直播' },
  { value: 'PHOTOGRAPHER', label: '摄影' },
  { value: 'MEDIC', label: '医务' },
];
const STATUS = {
  DRAFT: '草稿',
  PENDING: '待独立审核',
  APPROVED: '审核通过',
  REJECTED: '已退回',
  SUSPENDED: '已暂停',
  HELD: '待确认锁位',
  REQUESTED: '待服务方接单',
  CONFIRMED: '已确认',
  ARRIVED: '服务方已到场',
  DELIVERED: '服务方已交付',
  COMPLETED: '已完成',
  DECLINED: '已拒绝',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
  DISPUTED: '争议处理中',
  OPEN: '待对方确认',
  CLOSED: '已关闭',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('资料编号无效，请重新读取。');
  return value;
}
function text(value, label, min = 1, max = 500) {
  const s = String(value || '').trim();
  if (s.length < min || s.length > max)
    throw new Error(label + '需为' + min + '–' + max + '个字。');
  return s;
}
function object(raw, allowed) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !allowed.includes(k))
  )
    throw new Error('服务资料格式无效，请更新后重试。');
  return raw;
}
function region(raw) {
  const r = object(raw, ['catalogVersion', 'regionId']);
  id(r.regionId);
  if (typeof r.catalogVersion !== 'string' || r.catalogVersion.length > 120)
    throw new Error('地区资料无效');
  return { catalogVersion: r.catalogVersion, regionId: r.regionId };
}
function selectedRegion(selection) {
  if (!selection || selection.mode !== 'REGION')
    throw new Error('请先从地区目录选择具体城市或区县。');
  return region({ catalogVersion: selection.catalogVersion, regionId: selection.regionId });
}
function point(raw) {
  if (raw === null) return null;
  const p = object(raw, ['latitude', 'longitude', 'coordinateSystem']);
  if (
    p.coordinateSystem !== 'GCJ02' ||
    !Number.isFinite(p.latitude) ||
    !Number.isFinite(p.longitude) ||
    Math.abs(p.latitude) > 90 ||
    Math.abs(p.longitude) > 180
  )
    throw new Error('地点坐标无效');
  return { latitude: p.latitude, longitude: p.longitude, coordinateSystem: 'GCJ02' };
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('资料版本无效');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('时间资料无效');
  return value;
}
function listing(raw, privateView = false) {
  const r = object(raw, [
    'id',
    'kind',
    'title',
    'description',
    'address',
    'region',
    'point',
    'coverageRegionIds',
    'status',
    'version',
    'providerConfirmed',
    'qualifiedUntil',
    'published',
    'organizationName',
    'distanceMeters',
    'distanceLabel',
    ...(privateView
      ? ['qualificationNote', 'reviewReason', 'providerUserId', 'courtId', 'capabilities']
      : []),
  ]);
  if (
    !KINDS.some((k) => k.value === r.kind && k.value) ||
    !['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(r.status) ||
    !Array.isArray(r.coverageRegionIds) ||
    typeof r.providerConfirmed !== 'boolean' ||
    typeof r.published !== 'boolean'
  )
    throw new Error('供给资料格式无效');
  if (r.distanceMeters !== null && (!Number.isFinite(r.distanceMeters) || r.distanceMeters < 0))
    throw new Error('距离资料无效');
  const value = {
    id: id(r.id),
    kind: r.kind,
    title: text(r.title, '名称', 1, 100),
    description: text(r.description, '说明', 1, 1000),
    address: text(r.address, '地址', 1, 200),
    region: region(r.region),
    point: point(r.point),
    coverageRegionIds: r.coverageRegionIds.map(id),
    status: r.status,
    version: version(r.version),
    providerConfirmed: r.providerConfirmed,
    qualifiedUntil: r.qualifiedUntil === null ? null : timestamp(r.qualifiedUntil),
    published: r.published,
    organizationName: text(r.organizationName, '机构名称', 1, 100),
    distanceMeters: r.distanceMeters,
    distanceLabel: r.distanceMeters === null ? '距离未提供' : text(r.distanceLabel, '距离', 1, 100),
  };
  if (privateView) {
    value.qualificationNote = text(r.qualificationNote, '资质核验说明', 4, 1000);
    value.reviewReason = r.reviewReason || '';
    value.providerUserId = id(r.providerUserId);
    value.courtId = r.courtId === null ? null : id(r.courtId);
    if (r.capabilities) value.capabilities = capabilities(r.capabilities);
  }
  return {
    ...value,
    kindText: KINDS.find((k) => k.value === r.kind).label,
    statusText: STATUS[r.status],
    qualificationText: r.qualifiedUntil
      ? '资质核验有效至 ' + ui.localTime(r.qualifiedUntil, true)
      : '尚未完成有效期审核',
  };
}
function capabilities(raw) {
  const r = object(raw, ['canManage', 'canReview', 'canSuspend', 'canConfirmProvider']);
  if (Object.keys(r).length !== 4 || Object.values(r).some((v) => typeof v !== 'boolean'))
    throw new Error('操作权限资料无效');
  return r;
}
function slot(raw) {
  const r = object(raw, [
    'id',
    'listingId',
    'startsAt',
    'endsAt',
    'status',
    'version',
    'available',
  ]);
  if (!['OPEN', 'CLOSED'].includes(r.status)) throw new Error('档期资料无效');
  return {
    id: id(r.id),
    listingId: id(r.listingId),
    startsAt: timestamp(r.startsAt),
    endsAt: timestamp(r.endsAt),
    status: r.status,
    version: version(r.version),
    available: r.available === true,
    timeText: ui.localTime(r.startsAt, true) + ' — ' + ui.localTime(r.endsAt),
    statusText: STATUS[r.status],
  };
}
function booking(raw) {
  const r = object(raw, [
    'id',
    'listingId',
    'slotId',
    'status',
    'version',
    'startsAt',
    'endsAt',
    'holdExpiresAt',
    'title',
    'kind',
    'address',
    'location',
    'terms',
    'reason',
    'change',
    'paymentStatus',
    'canActAs',
  ]);
  if (
    !KINDS.some((k) => k.value === r.kind && k.value) ||
    ![
      'HELD',
      'REQUESTED',
      'CONFIRMED',
      'ARRIVED',
      'DELIVERED',
      'COMPLETED',
      'DECLINED',
      'CANCELLED',
      'EXPIRED',
      'DISPUTED',
    ].includes(r.status) ||
    !['BUYER', 'PROVIDER', 'ADMIN'].includes(r.canActAs) ||
    r.paymentStatus !== 'NOT_ENABLED'
  )
    throw new Error('订单资料无效');
  const actions = [];
  const add = (type, label) => actions.push({ type, label });
  if (r.canActAs === 'BUYER' && r.status === 'HELD') add('CONFIRM', '确认球场预约');
  if (r.canActAs === 'PROVIDER' && r.status === 'REQUESTED') {
    add('ACCEPT', '接单');
    add('DECLINE', '拒绝');
  }
  if (r.canActAs === 'PROVIDER' && r.status === 'CONFIRMED') add('ARRIVE', '登记到场');
  if (r.canActAs === 'PROVIDER' && r.status === 'ARRIVED') add('DELIVER', '登记交付');
  if (r.canActAs === 'BUYER' && r.status === 'DELIVERED') add('COMPLETE', '确认完成');
  if (['HELD', 'REQUESTED', 'CONFIRMED'].includes(r.status)) add('CANCEL', '取消预约');
  if (['CONFIRMED', 'ARRIVED', 'DELIVERED'].includes(r.status)) add('DISPUTE', '提出争议');
  let change = null;
  if (r.change) {
    const c = object(r.change, ['slotId', 'proposedBy', 'reason', 'startsAt', 'endsAt']);
    change = {
      slotId: id(c.slotId),
      proposedBy: id(c.proposedBy),
      reason: text(c.reason, '改期说明', 4, 500),
      startsAt: timestamp(c.startsAt),
      endsAt: timestamp(c.endsAt),
      timeText: ui.localTime(c.startsAt, true) + ' — ' + ui.localTime(c.endsAt),
    };
  }
  return {
    id: id(r.id),
    listingId: id(r.listingId),
    slotId: id(r.slotId),
    status: r.status,
    statusText: STATUS[r.status],
    version: version(r.version),
    startsAt: timestamp(r.startsAt),
    endsAt: timestamp(r.endsAt),
    holdExpiresAt: r.holdExpiresAt === null ? null : timestamp(r.holdExpiresAt),
    holdText: r.holdExpiresAt ? ui.localTime(r.holdExpiresAt, true) : '',
    title: text(r.title, '名称', 1, 100),
    kind: r.kind,
    kindText: KINDS.find((k) => k.value === r.kind).label,
    address: text(r.address, '地址', 1, 200),
    location: point(r.location),
    terms: text(r.terms, '合作约定', 4, 1000),
    reason: r.reason || '',
    change,
    paymentStatus: r.paymentStatus,
    canActAs: r.canActAs,
    roleText: { BUYER: '我的需求', PROVIDER: '我提供的服务', ADMIN: '机构订单' }[r.canActAs],
    timeText: ui.localTime(r.startsAt, true) + ' — ' + ui.localTime(r.endsAt),
    actions,
    canChange: r.status === 'CONFIRMED' && r.canActAs !== 'ADMIN',
  };
}
function matchup(raw) {
  const r = object(raw, [
    'id',
    'homeTeamId',
    'awayTeamId',
    'homeTeamName',
    'awayTeamName',
    'homeOrgId',
    'awayOrgId',
    'courtId',
    'courtOrgId',
    'startsAt',
    'endsAt',
    'address',
    'terms',
    'status',
    'version',
    'homeConfirmed',
    'awayConfirmed',
    'canConfirm',
  ]);
  if (
    !['OPEN', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED'].includes(r.status) ||
    typeof r.canConfirm !== 'boolean'
  )
    throw new Error('约赛资料无效');
  return {
    ...r,
    id: id(r.id),
    homeTeamId: id(r.homeTeamId),
    awayTeamId: id(r.awayTeamId),
    homeOrgId: id(r.homeOrgId),
    awayOrgId: id(r.awayOrgId),
    courtId: id(r.courtId),
    courtOrgId: id(r.courtOrgId),
    version: version(r.version),
    startsAt: timestamp(r.startsAt),
    endsAt: timestamp(r.endsAt),
    homeTeamName: text(r.homeTeamName, '球队', 1, 80),
    awayTeamName: text(r.awayTeamName, '球队', 1, 80),
    address: text(r.address, '地址', 1, 200),
    terms: text(r.terms, '约定', 4, 1000),
    statusText: STATUS[r.status],
    timeText: ui.localTime(r.startsAt, true) + ' — ' + ui.localTime(r.endsAt),
  };
}
function candidate(raw) {
  const r = object(raw, [
    'title',
    'address',
    'point',
    'sourceCode',
    'source',
    'kind',
    'region',
    'regionLabel',
  ]);
  if (r.source !== 'TENCENT' || !['PLACE', 'REVERSE'].includes(r.kind))
    throw new Error('地图候选资料无效');
  return {
    title: text(r.title, '地点', 1, 200),
    address: text(r.address, '地点地址', 1, 300),
    point: point(r.point),
    sourceCode: r.sourceCode,
    source: r.source,
    kind: r.kind,
    ...(r.region
      ? { region: region(r.region), regionLabel: text(r.regionLabel, '地区', 1, 100) }
      : {}),
  };
}
function result(raw) {
  const r = object(raw, ['resourceType', 'resourceId', 'version', 'slotId']);
  if (!['LISTING', 'BOOKING', 'MATCHUP'].includes(r.resourceType)) throw new Error('回执资料无效');
  return {
    resourceType: r.resourceType,
    resourceId: id(r.resourceId),
    version: version(r.version),
    ...(r.slotId ? { slotId: id(r.slotId) } : {}),
  };
}
function repository(client = api.getClient()) {
  const read = async (path) => (await client.request(path)).data;
  return {
    async search(query) {
      const r = object(
        (await client.request('/v1/public/local-search', 'POST', query, true)).data,
        ['items', 'nextCursor', 'locationCapability', 'queryOrigin', 'truncated'],
      );
      if (
        !Array.isArray(r.items) ||
        r.items.length > 50 ||
        r.truncated !== false ||
        !['REGION', 'EXPLICIT_POINT'].includes(r.queryOrigin) ||
        (r.nextCursor !== null &&
          (typeof r.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(r.nextCursor)))
      )
        throw new Error('同城列表资料无效');
      return {
        items: r.items.map((v) => listing(v)),
        nextCursor: r.nextCursor,
        locationEnabled: r.locationCapability && r.locationCapability.enabled === true,
      };
    },
    async detail(value) {
      const r = object(
        (await client.requestPublic('/v1/public/local-listings/' + id(value))).data,
        ['listing', 'slots', 'terms', 'paymentStatus'],
      );
      if (!Array.isArray(r.slots) || r.paymentStatus !== 'NOT_ENABLED')
        throw new Error('供给详情无效');
      return {
        listing: listing(r.listing),
        slots: r.slots.map(slot),
        terms: text(r.terms, '约定', 4, 1000),
      };
    },
    async locate(body) {
      const r = object(
        (await client.request('/v1/public/local-location', 'POST', body, true)).data,
        ['candidates', 'inventoryVerified'],
      );
      if (!Array.isArray(r.candidates) || r.inventoryVerified !== false)
        throw new Error('地图地点资料无效');
      return r.candidates.map(candidate);
    },
    async workspace(orgId) {
      const r = object(
        await read(orgId ? '/v1/orgs/' + id(orgId) + '/local-services' : '/v1/local-services/mine'),
        ['listings', 'locationEnabled', 'paymentStatus'],
      );
      if (
        !Array.isArray(r.listings) ||
        r.listings.length > 200 ||
        r.paymentStatus !== 'NOT_ENABLED'
      )
        throw new Error('供给工作台资料无效');
      return r.listings.map((v) => listing(v, true));
    },
    async options(orgId) {
      const r = object(await read('/v1/orgs/' + id(orgId) + '/local-services/options'), [
        'providers',
        'courts',
      ]);
      const rows = (a) => {
        if (!Array.isArray(a) || a.length > 1000) throw new Error('机构选项资料无效');
        return a.map((v) => {
          object(v, ['id', 'name']);
          return { id: id(v.id), name: text(v.name, '选项', 1, 100) };
        });
      };
      return { providers: rows(r.providers), courts: rows(r.courts) };
    },
    async privateDetail(value) {
      const r = object(await read('/v1/local-services/listings/' + id(value)), [
        'listing',
        'slots',
        'terms',
        'capabilities',
      ]);
      if (!Array.isArray(r.slots)) throw new Error('供给详情无效');
      return {
        listing: listing(r.listing, true),
        slots: r.slots.map(slot),
        terms: text(r.terms, '合作约定', 4, 1000),
        capabilities: capabilities(r.capabilities),
      };
    },
    async bookings() {
      const r = object(await read('/v1/local-bookings'), ['items', 'limit']);
      if (!Array.isArray(r.items) || r.items.length > 200) throw new Error('订单资料无效');
      return r.items.map(booking);
    },
    async matchups() {
      const r = object(await read('/v1/local-matchups'), ['items', 'limit']);
      if (!Array.isArray(r.items) || r.items.length > 200) throw new Error('约赛资料无效');
      return r.items.map(matchup);
    },
    async receipt(commandId) {
      if (!COMMAND.test(commandId)) throw new Error('操作编号无效');
      return result(await read('/v1/local-services/receipts/' + commandId));
    },
    async send(record) {
      return result((await client.request(record.path, record.method, record.body)).data);
    },
  };
}
// Only a previously stored, actor-scoped original command may be retried. A missing receipt
// means "not observed yet", not "safe to generate another UUID". Precise device location is
// never passed to this persistence path; business/service coordinates are explicitly chosen.
const KEY = 'scb.local.pending.v1.';
const privatePath =
  /^\/v1\/(?:orgs\/[0-9a-f-]{36}\/local-services\/listings|local-services\/listings\/[0-9a-f-]{36}(?:\/commands|\/slots(?:\/[0-9a-f-]{36}\/close)?)?|local-bookings(?:\/[0-9a-f-]{36}\/commands)?|local-matchups(?:\/[0-9a-f-]{36}\/commands)?)$/i;
function pendingRecord(raw) {
  const r = object(raw, ['version', 'actorId', 'path', 'method', 'body', 'label']);
  if (
    r.version !== 1 ||
    !privatePath.test(r.path) ||
    !['POST', 'PUT'].includes(r.method) ||
    !r.body ||
    typeof r.body !== 'object' ||
    !COMMAND.test(r.body.commandId) ||
    JSON.stringify(r).length > 16000
  )
    throw new Error('未确认操作资料已损坏，请联系管理员核对。');
  return {
    version: 1,
    actorId: id(r.actorId),
    path: r.path,
    method: r.method,
    body: JSON.parse(JSON.stringify(r.body)),
    label: text(r.label, '操作', 1, 60),
  };
}
function readPending(wxApi, actorId) {
  try {
    const r = wxApi.getStorageSync(KEY + id(actorId));
    if (!r) return { record: null, error: '' };
    const clean = pendingRecord(r);
    if (clean.actorId !== actorId) throw new Error('本机原操作所属身份不一致，请核对。');
    return { record: clean, error: '' };
  } catch (e) {
    return { record: null, error: ui.message(e) };
  }
}
function savePending(wxApi, record) {
  try {
    const r = pendingRecord(record);
    const current = readPending(wxApi, r.actorId);
    if (current.error || (current.record && current.record.body.commandId !== r.body.commandId))
      return false;
    wxApi.setStorageSync(KEY + r.actorId, r);
    const actual = readPending(wxApi, r.actorId);
    return !actual.error && !!actual.record && actual.record.body.commandId === r.body.commandId;
  } catch {
    return false;
  }
}
function clearPending(wxApi, actorId, commandId) {
  try {
    const current = readPending(wxApi, actorId);
    if (current.error || !current.record || current.record.body.commandId !== commandId)
      return false;
    wxApi.removeStorageSync(KEY + actorId);
    const after = readPending(wxApi, actorId);
    return !after.error && !after.record;
  } catch {
    return false;
  }
}
function uncertain(error) {
  return (
    !error ||
    ['NETWORK_ERROR', 'INVALID_RESPONSE', 'SESSION_CHANGED'].includes(error.code) ||
    error.status >= 500
  );
}
async function recover(page) {
  const actor = page._viewer;
  if (!actor || page.data.busy) return;
  const guard = ui.hold(page),
    state = readPending(wx, actor);
  page.setData({ pending: state.record, pendingError: state.error });
  if (!state.record || state.error) return;
  page.setData({ busy: true, error: '' });
  try {
    await repository().receipt(state.record.body.commandId);
    if (ui.held(page, guard) && page._viewer === actor) {
      const cleared = clearPending(wx, actor, state.record.body.commandId);
      page.setData({
        pending: cleared ? null : state.record,
        pendingError: cleared ? '' : '服务器已确认，但本机回执尚未清除，请再次核对。',
        message: '上次操作已由服务器确认，请刷新查看当前结果。',
      });
    }
  } catch (e) {
    if (ui.held(page, guard) && page._viewer === actor)
      page.setData({
        error:
          e.status === 404
            ? '尚未查到回执；可以点击“重试原操作”，原编号和原内容会保持一致。'
            : ui.message(e),
      });
  } finally {
    if (ui.held(page, guard)) page.setData({ busy: false });
  }
}
async function write(page, { path, method = 'POST', body, label, content }) {
  if (page.data.busy || page.data.pending || page.data.pendingError || !page._viewer) return false;
  const actor = page._viewer,
    op = await ui.confirmOp(page, label, content || '请核对上述资料后确认本次操作。');
  if (!op || !op.valid() || actor !== page._viewer) return false;
  const commandId = await ui.uuid();
  if (!op.valid() || actor !== page._viewer || page.data.pending) return false;
  const record = pendingRecord({
    version: 1,
    actorId: actor,
    path,
    method,
    body: { ...body, commandId },
    label,
  });
  if (!savePending(wx, record)) {
    page.setData({ error: '无法保存原操作编号，未发送请求。请检查本机存储后重试。' });
    return false;
  }
  page.setData({ pending: record });
  return sendPending(page, record, op);
}
async function sendPending(page, record, op) {
  if (page.data.busy || !record || record.actorId !== page._viewer || (op && !op.valid()))
    return false;
  const actor = page._viewer,
    guard = ui.hold(page);
  page.setData({ busy: true, error: '', message: '' });
  try {
    const value = await repository().send(record);
    if (!ui.held(page, guard) || page._viewer !== actor) return false;
    const cleared = clearPending(wx, actor, record.body.commandId);
    page.setData({
      pending: cleared ? null : record,
      pendingError: cleared ? '' : '服务器已确认，本机编号清理失败，请再次核对。',
      message: '操作已由服务器确认。',
    });
    return value;
  } catch (e) {
    if (ui.held(page, guard) && page._viewer === actor) {
      if (!uncertain(e)) {
        const cleared = clearPending(wx, actor, record.body.commandId);
        page.setData({
          pending: cleared ? null : record,
          pendingError: cleared ? '' : '本机编号清理失败，请核对原操作。',
        });
      }
      page.setData({
        error: ui.message(e),
        message: uncertain(e) ? '结果尚未确认，请先查询回执或重试原操作；不会创建第二个请求。' : '',
      });
    }
    return false;
  } finally {
    if (ui.held(page, guard)) page.setData({ busy: false });
  }
}
async function retry(page) {
  const state = readPending(wx, page._viewer);
  if (state.error || !state.record) {
    page.setData({ pendingError: state.error, pending: state.record });
    return false;
  }
  const op = await ui.confirmOp(
    page,
    '重试原操作',
    '将按原编号和原内容重试“' + state.record.label + '”。服务器会返回同一结果。',
  );
  if (!op) return false;
  return sendPending(page, state.record, op);
}
function loadPending(page) {
  const state = readPending(wx, page._viewer);
  page.setData({ pending: state.record, pendingError: state.error });
}
function locateOnce(wxApi, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const settle = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(
      () => settle(reject, new Error('定位超时，可手动选择城市。')),
      timeout,
    );
    if (typeof wxApi.getLocation !== 'function') {
      settle(reject, new Error('此版本不支持定位，可手动选择城市。'));
      return;
    }
    wxApi.getLocation({
      type: 'gcj02',
      isHighAccuracy: false,
      success: (r) => {
        try {
          settle(
            resolve,
            point({ latitude: r.latitude, longitude: r.longitude, coordinateSystem: 'GCJ02' }),
          );
        } catch (e) {
          settle(reject, e);
        }
      },
      fail: () => settle(reject, new Error('未取得定位许可，可继续手动选城或浏览全国。')),
    });
  });
}
function navigate(value, address, title) {
  if (!value || typeof wx.openLocation !== 'function') return;
  const p = point(value);
  wx.openLocation({
    latitude: p.latitude,
    longitude: p.longitude,
    name: title,
    address,
    scale: 16,
  });
}
function open(name, query = {}) {
  if (!['local', 'local-manage', 'local-bookings', 'local-matchups'].includes(name))
    throw new Error('同城入口无效');
  const pairs = Object.keys(query).map(
    (k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])),
  );
  wx.navigateTo({ url: '/pages/' + name + '/index' + (pairs.length ? '?' + pairs.join('&') : '') });
}
module.exports = {
  KINDS,
  STATUS,
  id,
  text,
  region,
  selectedRegion,
  point,
  listing,
  slot,
  booking,
  matchup,
  candidate,
  result,
  repository,
  readPending,
  savePending,
  clearPending,
  uncertain,
  write,
  recover,
  retry,
  loadPending,
  locateOnce,
  navigate,
  open,
};

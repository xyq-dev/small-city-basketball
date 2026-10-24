const ACTIONS = [
  { type: 'ACCEPT', capability: 'canAccept', label: '接受本场预约', eligibility: true },
  { type: 'DECLINE', capability: 'canDecline', label: '拒绝本场预约', reason: true },
  { type: 'CANCEL', capability: 'canCancel', label: '取消这一项', reason: true },
  {
    type: 'ACTIVATE',
    capability: 'canActivate',
    label: '补齐安排并激活',
    schedule: true,
    eligibility: true,
  },
  {
    type: 'PROPOSE_CHANGE',
    capability: 'canProposeChange',
    label: '提议更改安排',
    schedule: true,
    reason: true,
  },
  { type: 'ACCEPT_CHANGE', capability: 'canAcceptChange', label: '同意新安排', eligibility: true },
  { type: 'REJECT_CHANGE', capability: 'canRejectChange', label: '拒绝变更', reason: true },
  { type: 'ARRIVE', capability: 'canArrive', label: '本人已到场' },
  { type: 'COMPLETE', capability: 'canComplete', label: '确认本场完成' },
  { type: 'DISPUTE', capability: 'canDispute', label: '发起本场争议', reason: true },
  {
    type: 'RESOLVE_DISPUTE',
    capability: 'canResolveDispute',
    label: '独立处理争议',
    reason: true,
    resolution: true,
  },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOLUTIONS = ['RESUME', 'CANCEL', 'COMPLETE'];
const RESOLUTION_LABELS = ['恢复合法履约状态', '取消本项', '确认完成（需到场及结束证据）'];
const TONES = {
  CONDITIONAL: 'warning',
  DISPUTED: 'danger',
  COMPLETED: 'success',
  DECLINED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};
const INPUT_FIELDS = [
  'reason',
  'reportDate',
  'reportTime',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'venue',
];
const SIMPLE_FIELDS = [
  'commandId',
  'expectedVersion',
  'type',
  'appearanceId',
  'reason',
  'reportAt',
  'startAt',
  'endAt',
  'venue',
  'eligibilityConfirmed',
  'resolution',
];

function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('预约编号无效');
  return value;
}
function action(type) {
  const value = ACTIONS.find((a) => a.type === type);
  if (!value) throw new Error('不支持的预约操作');
  return value;
}
function allowed(appearance, type) {
  return (
    !!appearance &&
    !!appearance.capabilities &&
    appearance.capabilities[action(type).capability] === true
  );
}
function tone(status) {
  return TONES[status] || 'brand';
}
function visibleAppearances(order, viewerId, view) {
  return (order.appearances || []).filter(
    (a) => view !== 'received' || a.playerUserId === viewerId,
  );
}
function appearance(order, appearanceId, viewerId, view) {
  const found = visibleAppearances(order, viewerId, view).find((a) => a.id === appearanceId);
  if (!found) throw new Error('该场次当前不可查看，请重新读取预约');
  return found;
}
function list(workspace, viewerId, view, status) {
  if (!workspace || workspace.viewerUserId !== viewerId)
    throw new Error('账号已变化，请重新读取预约');
  const teams = new Set((workspace.teams || []).map((t) => t.orgId + ':' + t.id));
  return (workspace.orders || []).filter((order) => {
    const relevant =
      view === 'received'
        ? order.appearances.some((a) => a.playerUserId === viewerId)
        : teams.has(order.orgId + ':' + order.teamId);
    return (
      relevant &&
      (!status ||
        status === 'ALL' ||
        visibleAppearances(order, viewerId, view).some((a) => a.status === status))
    );
  });
}
function sumVisible(items, conditional) {
  return items
    .filter((a) =>
      conditional
        ? a.status === 'CONDITIONAL'
        : !['CONDITIONAL', 'CANCELLED', 'DECLINED', 'EXPIRED'].includes(a.status),
    )
    .reduce((sum, a) => sum + a.totalFen, 0);
}
function decorateAppearance(item, ui) {
  return {
    ...item,
    statusText: ui.state(item.status),
    positionText: ui.position(item.position),
    tone: tone(item.status),
    reportText: ui.localTime(item.reportAt, true),
    startText: ui.localTime(item.startAt, true),
    endText: ui.localTime(item.endAt, true),
    expiresText: item.expiresAt ? ui.localTime(item.expiresAt, true) : '',
    arrivedText: item.arrivedAt ? ui.localTime(item.arrivedAt, true) : '',
    completedText: item.completedAt ? ui.localTime(item.completedAt, true) : '',
    serviceText: ui.money(item.serviceFen),
    platformFeeText: ui.money(item.platformFeeFen),
    travelText: ui.money(item.travelFen),
    accommodationText: ui.money(item.accommodationFen),
    totalText: ui.money(item.totalFen),
    actions: ACTIONS.filter((a) => allowed(item, a.type)).map((a) => ({
      type: a.type,
      label: a.label,
      danger: ['DECLINE', 'CANCEL', 'DISPUTE'].includes(a.type),
    })),
    change: item.changeRequest
      ? {
          reportText: ui.localTime(item.changeRequest.reportAt, true),
          startText: ui.localTime(item.changeRequest.startAt, true),
          endText: ui.localTime(item.changeRequest.endAt, true),
          venue: item.changeRequest.venue,
          reason: item.changeRequest.reason,
          role: item.changeRequest.proposedByRole === 'PLAYER' ? '球员提出' : '球队方提出',
        }
      : null,
  };
}
function decorateOrder(order, viewerId, view, ui) {
  const items = visibleAppearances(order, viewerId, view);
  return {
    ...order,
    scopeText: ui.scope(order.scope),
    statusText: ui.state(order.status),
    createdText: ui.localTime(order.createdAt, true),
    appearances: items.map((a) => decorateAppearance(a, ui)),
    itemCount: items.length,
    playerCount: new Set(items.map((a) => a.profileId)).size,
    conditionalCount: items.filter((a) => a.status === 'CONDITIONAL').length,
    confirmedCount: items.filter(
      (a) => !['CONDITIONAL', 'CANCELLED', 'DECLINED', 'EXPIRED'].includes(a.status),
    ).length,
    confirmedText: ui.money(
      view === 'received' ? sumVisible(items, false) : order.totals.confirmedTotalFen,
    ),
    conditionalText: ui.money(
      view === 'received' ? sumVisible(items, true) : order.totals.conditionalTotalFen,
    ),
    paidText: ui.money(order.totals.paidFen),
    refundedText: ui.money(order.totals.refundedFen),
    settledText: ui.money(order.totals.settledFen),
  };
}
function form(type, item, ui) {
  const config = action(type);
  const fallback = ui.today();
  return {
    type,
    title: config.label,
    needsReason: !!config.reason,
    needsSchedule: !!config.schedule,
    needsResolution: !!config.resolution,
    requiresEligibility: !!config.eligibility,
    confirmed: false,
    fields: {
      reason: '',
      reportDate: item.reportAt ? ui.datePart(item.reportAt) : fallback,
      reportTime: item.reportAt ? ui.timePart(item.reportAt) : '18:30',
      startDate: item.startAt ? ui.datePart(item.startAt) : fallback,
      startTime: item.startAt ? ui.timePart(item.startAt) : '19:00',
      endDate: item.endAt ? ui.datePart(item.endAt) : fallback,
      endTime: item.endAt ? ui.timePart(item.endAt) : '21:00',
      venue: item.venue || '',
      resolution: '',
    },
    resolutionLabel: '请选择处理结果',
    consentLabel:
      type === 'ARRIVE'
        ? '我确认本人已到达本场约定地点（本人声明，非GPS核验）'
        : type === 'COMPLETE'
          ? '我代表球队确认本次约定服务已完成'
          : config.eligibility
            ? '我已核对本场资格、服务范围与时间地点，并明确同意'
            : type === 'RESOLVE_DISPUTE'
              ? '我已核对双方说明、独立处理条件和所选处理结果'
              : '我已核对本球员本场记录与上述原因，确认执行此操作',
  };
}
function schedule(fields) {
  function stamp(prefix) {
    const date = fields[prefix + 'Date'],
      time = fields[prefix + 'Time'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || ''))
      throw new Error('请补齐报到、开始和结束日期时间');
    const raw = date + 'T' + time + ':00+08:00';
    const value = Date.parse(raw);
    if (
      !Number.isFinite(value) ||
      new Date(value + 8 * 3600000).toISOString().slice(0, 16) !== date + 'T' + time
    )
      throw new Error('请选择有效的北京时间');
    return new Date(value).toISOString();
  }
  const reportAt = stamp('report'),
    startAt = stamp('start'),
    endAt = stamp('end');
  if (
    reportAt > startAt ||
    startAt >= endAt ||
    Date.parse(endAt) - Date.parse(reportAt) > 12 * 3600000
  )
    throw new Error('须满足报到≤开始<结束，单次服务不超过12小时');
  const venue = String(fields.venue || '').trim();
  if (!venue || venue.length > 120) throw new Error('请填写1至120字的实际地点');
  return { reportAt, startAt, endAt, venue };
}
function command(type, item, fields, commandId, confirmed) {
  const config = action(type);
  if (confirmed !== true) throw new Error('请先核对并勾选明确确认声明');
  const result = {
    commandId: id(commandId),
    expectedVersion: item.version,
    type,
    appearanceId: id(item.id),
  };
  if (!Number.isSafeInteger(item.version) || item.version < 1)
    throw new Error('场次版本无效，请重新读取');
  if (config.reason) {
    const reason = String(fields.reason || '').trim();
    if (reason.length < 2 || reason.length > 500) throw new Error('请填写2至500字的实际原因');
    result.reason = reason;
  }
  if (config.schedule) Object.assign(result, schedule(fields));
  if (config.eligibility) result.eligibilityConfirmed = true;
  if (config.resolution) {
    if (!RESOLUTIONS.includes(fields.resolution)) throw new Error('请选择争议处理结果');
    result.resolution = fields.resolution;
  }
  return result;
}
function validPayload(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !SIMPLE_FIELDS.includes(key))
  )
    return false;
  try {
    const config = action(payload.type);
    id(payload.commandId);
    id(payload.appearanceId);
    if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1) return false;
    if (
      config.reason &&
      (typeof payload.reason !== 'string' ||
        payload.reason.length < 2 ||
        payload.reason.length > 500)
    )
      return false;
    if (!config.reason && payload.reason !== undefined) return false;
    if (config.eligibility && payload.eligibilityConfirmed !== true) return false;
    if (!config.eligibility && payload.eligibilityConfirmed !== undefined) return false;
    if (
      config.resolution
        ? !RESOLUTIONS.includes(payload.resolution)
        : payload.resolution !== undefined
    )
      return false;
    const stamps = ['reportAt', 'startAt', 'endAt'];
    if (config.schedule) {
      if (
        !stamps.every(
          (key) =>
            typeof payload[key] === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload[key]) &&
            Number.isFinite(Date.parse(payload[key])) &&
            new Date(payload[key]).toISOString() === payload[key],
        )
      )
        return false;
      if (
        payload.reportAt > payload.startAt ||
        payload.startAt >= payload.endAt ||
        Date.parse(payload.endAt) - Date.parse(payload.reportAt) > 12 * 3600000
      )
        return false;
      if (typeof payload.venue !== 'string' || !payload.venue.trim() || payload.venue.length > 120)
        return false;
    } else if ([...stamps, 'venue'].some((key) => payload[key] !== undefined)) return false;
    return true;
  } catch {
    return false;
  }
}

function createJournal(storage) {
  const cache = new Map();
  function key(actor, order) {
    return 'scb.booking-command.v1.' + id(actor) + '.' + id(order);
  }
  function persist(k, entry) {
    try {
      if (!storage || typeof storage.setStorageSync !== 'function') throw new Error('unavailable');
      storage.setStorageSync(
        k,
        JSON.stringify(
          entry.kind === 'INVALID'
            ? { schema: 1, kind: 'INVALID' }
            : {
                schema: 1,
                actor: entry.actor,
                order: entry.order,
                kind: 'PENDING',
                payload: entry.payload,
              },
        ),
      );
      entry.stored = true;
      entry.storageWarning = '';
    } catch {
      entry.storageWarning = '当前无法在本机保存原操作，刷新后可能丢失编号。请先核对本场记录。';
    }
  }
  function read(actor, order) {
    const k = key(actor, order);
    if (!cache.has(k)) {
      let raw;
      try {
        raw =
          storage && typeof storage.getStorageSync === 'function' ? storage.getStorageSync(k) : '';
      } catch {
        const entry = {
          kind: 'INVALID',
          actor,
          order,
          flight: null,
          stored: true,
          storageWarning: '无法读取本机原操作记录，请先核对当前场次，不要直接另发新操作。',
        };
        cache.set(k, entry);
        return {
          kind: 'INVALID',
          payload: null,
          inFlight: false,
          storageWarning: entry.storageWarning,
        };
      }
      if (!raw) return null;
      let parsed;
      try {
        parsed = typeof raw === 'string' && raw.length <= 20000 ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      const entry =
        parsed &&
        parsed.schema === 1 &&
        parsed.kind === 'PENDING' &&
        parsed.actor === actor &&
        parsed.order === order &&
        validPayload(parsed.payload)
          ? {
              kind: 'PENDING',
              actor,
              order,
              payload: JSON.parse(JSON.stringify(parsed.payload)),
              flight: null,
              stored: true,
              storageWarning: '',
            }
          : { kind: 'INVALID', actor, order, flight: null, stored: true, storageWarning: '' };
      cache.set(k, entry);
      if (entry.kind === 'INVALID') persist(k, entry);
    }
    const entry = cache.get(k);
    return {
      kind: entry.kind,
      payload: entry.payload ? JSON.parse(JSON.stringify(entry.payload)) : null,
      inFlight: !!entry.flight,
      storageWarning: entry.storageWarning,
    };
  }
  function start(actor, order, payload) {
    const k = key(actor, order);
    if (read(actor, order)) throw new Error('先核对原操作结果，不能另发新的操作编号');
    if (!validPayload(payload)) throw new Error('原操作资料无效');
    const entry = {
      kind: 'PENDING',
      actor,
      order,
      payload: JSON.parse(JSON.stringify(payload)),
      flight: null,
      stored: false,
      storageWarning: '',
    };
    cache.set(k, entry);
    persist(k, entry);
    return read(actor, order);
  }
  function clear(actor, order) {
    const k = key(actor, order);
    const entry = cache.get(k);
    if (entry && entry.flight) throw new Error('原操作仍在处理中，请等待结果后核对');
    try {
      if (!storage || typeof storage.removeStorageSync !== 'function')
        throw new Error('unavailable');
      storage.removeStorageSync(k);
    } catch {
      if (entry && entry.stored) {
        entry.storageWarning = '无法移除本机恢复标记，请保留原操作并继续核对。';
        return false;
      }
    }
    cache.delete(k);
    return true;
  }
  function run(actor, order, send) {
    const k = key(actor, order);
    read(actor, order);
    const entry = cache.get(k);
    if (!entry || entry.kind !== 'PENDING') return Promise.reject(new Error('请先核对原操作资料'));
    if (entry.flight) return entry.flight;
    const payload = JSON.parse(JSON.stringify(entry.payload));
    entry.flight = Promise.resolve()
      .then(() => send(payload))
      .finally(() => {
        entry.flight = null;
      });
    return entry.flight;
  }
  return { read, start, clear, run };
}
let journal;
function getJournal() {
  if (!journal) journal = createJournal(typeof wx === 'undefined' ? null : wx);
  return journal;
}
module.exports = {
  ACTIONS,
  INPUT_FIELDS,
  RESOLUTIONS,
  RESOLUTION_LABELS,
  id,
  action,
  allowed,
  appearance,
  list,
  visibleAppearances,
  decorateAppearance,
  decorateOrder,
  form,
  schedule,
  command,
  validPayload,
  createJournal,
  getJournal,
};

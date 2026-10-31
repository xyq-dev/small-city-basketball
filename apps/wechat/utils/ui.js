const api = require('./api');
const routes = {};
for (const key of [
  'home',
  'search',
  'match-exceptions',
  'recruitment',
  'poster',
  'local',
  'local-manage',
  'local-bookings',
  'local-matchups',
  'public-ledgers',
  'public-archives',
  'public-archive',
  'sponsorships',
  'governance',
  'governance-reviews',
  'city-operations',

  'city-select',
  'watch',
  'media',
  'event',
  'org-event',
  'org-match',
  'scorer',
  'scoring-tasks',
  'entry-review',
  'event-setup',
  'schedule',
  'bracket',
  'reschedule',
  'match-media',
  'match',
  'account',
  'account-recovery',
  'staff-configuration',
  'players',
  'player',
  'compare',
  'booking-create',
  'bookings',
  'booking-detail',
  'player-center',
  'performance',
  'teams',
  'team',
  'registration-events',
  'entry',
  'invitation',
  'planned',
  'platform',
  'memberships',
  'team-join',
  'team-requests',
  'team-request',
  'follows',
  'seasons',
  'season-grants',
  'participant-materials',
])
  routes[key] = '/pages/' + key + '/index';
const positionNames = { PG: '控球后卫', SG: '得分后卫', SF: '小前锋', PF: '大前锋', C: '中锋' };
const scopeNames = {
  SINGLE: '单场预约',
  MULTI: '自选多场',
  TOURNAMENT: '整届合作',
  SEASON: '赛季合作',
  TIME_BLOCK: '按时段预约',
};
const stateNames = {
  PENDING: '待审核',
  APPROVED: '资料审核通过',
  REJECTED: '未通过',
  DISABLED: '已停用',
  ACTIVE: '合作进行中',
  CONDITIONAL: '条件意向 · 不占档',
  REQUESTED: '待球员接单',
  ACCEPTED: '已接单',
  DECLINED: '已拒绝',
  CANCELLED: '已取消',
  EXPIRED: '已到期',
  ARRIVED: '已到场 · 本人声明',
  COMPLETED: '服务记录已完成',
  DISPUTED: '争议处理中',
  UNAVAILABLE: '支付未开放',
  BLOCKED: '暂不可结算',
  DRAFT: '草稿',
  SUBMITTED: '已提交待审核',
  CHANGES_REQUESTED: '需修改',
  WITHDRAWN: '已撤回',
};
function money(value) {
  return Number.isSafeInteger(value) && value >= 0 ? '¥' + (value / 100).toFixed(2) : '未统计';
}
function shifted(value) {
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n + 8 * 3600000) : null;
}
const pad = (v) => String(v).padStart(2, '0');
function datePart(value) {
  const d = shifted(value);
  return d ? d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) : '';
}
function timePart(value) {
  const d = shifted(value);
  return d ? pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) : '';
}
function localTime(value, full) {
  const date = datePart(value);
  return date ? (full ? date : date.slice(5)) + ' ' + timePart(value) : '时间待确认';
}
function chinaStamp(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || ''))
    throw new Error('请填写有效的北京时间');
  const value = date + 'T' + time + ':00+08:00';
  if (datePart(value) !== date || timePart(value) !== time) throw new Error('日期或时间无效');
  return new Date(value).toISOString();
}
function safeReturn(value) {
  if (
    typeof value !== 'string' ||
    value.length > 5000 ||
    value.includes('://') ||
    /[\u0000-\u0020\\#]/.test(value)
  )
    return '';
  const parts = value.split('?');
  if (parts.length > 2 || !Object.values(routes).includes(parts[0])) return '';
  if (parts[0] === routes.account) return '';
  return value;
}
function open(key, query = {}) {
  if (!routes[key]) throw new Error('页面入口无效');
  const pairs = Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])));
  const url = routes[key] + (pairs.length ? '?' + pairs.join('&') : '');
  if (url.length > 5000) throw new Error('页面参数过长');
  wx.navigateTo({ url });
}
function login(returnPath) {
  open('account', { returnTo: safeReturn(returnPath) });
}
const clone = (v) => JSON.parse(JSON.stringify(v));
function clientRevision() {
  const c = api.getClient();
  return c.sessionRevision ? c.sessionRevision() : 0;
}
function resetPrivate(page) {
  if (page._closed || !page.setData) return;
  // Pages whose fields differ from the shared defaults (e.g. a public input that must not
  // receive the session message) clear their own private state through the same signal.
  if (typeof page.onSessionReset === 'function') {
    page.onSessionReset();
    return;
  }
  page.setData({
    ...(page._sessionDefaults ? clone(page._sessionDefaults) : {}),
    loginRequired: true,
    loading: false,
    busy: false,
    error: '登录身份已变化，请重新登录并读取当前资料。',
  });
}
async function session(page, returnPath) {
  if (!page._sessionDefaults) page._sessionDefaults = clone(page.data || {});
  const request = (page._sessionRequest || 0) + 1;
  page._sessionRequest = request;
  page._closed = false;
  try {
    const value = (await api.getClient().request('/v1/auth/session')).data;
    if (page._closed || request !== page._sessionRequest) return null;
    if (
      !value ||
      !value.user ||
      typeof value.user.id !== 'string' ||
      !Array.isArray(value.organizations) ||
      !Array.isArray(value.teamContexts)
    )
      throw new Error('登录资料无效，请重新登录');
    api.uuid(value.user.id);
    page.setData({ loginRequired: false });
    page._returnPath = safeReturn(returnPath);
    return value;
  } catch (error) {
    if (!page._closed && request === page._sessionRequest)
      page.setData({ loginRequired: true, loading: false, busy: false, error: message(error) });
    return null;
  }
}
function subscribe(page) {
  if (!page._sessionDefaults) page._sessionDefaults = clone(page.data || {});
  if (page._unsubscribeSession) page._unsubscribeSession();
  const c = api.getClient();
  if (c.onSessionChange)
    page._unsubscribeSession = c.onSessionChange(() => {
      page._requestRevision++;
      page._sessionEpoch = (page._sessionEpoch || 0) + 1;
      resetPrivate(page);
    });
}
function begin(page) {
  page._closed = false;
  page._requestRevision = (page._requestRevision || 0) + 1;
  subscribe(page);
  return { request: page._requestRevision, session: clientRevision() };
}
// A token that later reads cannot invalidate: only a session change or closing the page does.
// Used for supplementary reads with their own counter, and by hold() for writes.
function guard(page) {
  if (!page._unsubscribeSession) subscribe(page);
  return { epoch: page._sessionEpoch || 0, session: clientRevision() };
}
// Writes: cancel in-flight reads (begin, plus the page's own `_load` read generation) so a
// stale response cannot overwrite what the write returns, then hold a token that a refresh or
// poll started afterwards cannot orphan. Pages refuse to start reads while busy.
function hold(page) {
  // A closed (unloaded) page can never start a write; begin() must not reopen it.
  if (page._closed) return { epoch: -1, session: -1 };
  begin(page);
  page._load = (page._load || 0) + 1;
  return guard(page);
}
function held(page, token) {
  return (
    !!token &&
    !page._closed &&
    token.epoch === (page._sessionEpoch || 0) &&
    token.session === clientRevision()
  );
}
function live(page, token) {
  return (
    !!token &&
    !page._closed &&
    token.request === page._requestRevision &&
    token.session === clientRevision()
  );
}
function close(page) {
  page._closed = true;
  page._requestRevision = (page._requestRevision || 0) + 1;
  page._sessionRequest = (page._sessionRequest || 0) + 1;
  page._sessionEpoch = (page._sessionEpoch || 0) + 1;
  if (page._unsubscribeSession) page._unsubscribeSession();
  page._unsubscribeSession = null;
}
function message(error) {
  return error && typeof error.message === 'string'
    ? error.message
    : '操作未完成，请重新读取后核对';
}
// A confirmation bound to the session and page that opened it: a reply that arrives after an
// account change, sign-out or unload resolves to null, so no stale write can start. Returns the
// guard token for the caller to keep checking through the write.
async function confirmFor(page, title, content) {
  if (page._closed) return null;
  const token = guard(page);
  const yes = await confirm(title, content);
  return yes && held(page, token) ? token : null;
}
/**
 * A user-confirmed write operation bound to the session, page lifecycle and confirmation
 * generation that opened it. Resolves to null when the user declines or the answer arrives
 * after an account change, sign-out, unload or a newer confirmation on the same page. Callers
 * re-check `op.valid()` after every asynchronous step and immediately before sending; a write
 * token from hold() never replaces or refreshes it.
 */
async function confirmOp(page, title, content) {
  if (page._closed) return null;
  const token = guard(page);
  const generation = (page._confirmOp = (page._confirmOp || 0) + 1);
  const op = {
    token,
    valid: () => !page._closed && held(page, token) && generation === page._confirmOp,
  };
  return (await confirm(title, content)) && op.valid() ? op : null;
}
function confirm(title, content) {
  return new Promise((resolve) =>
    wx.showModal({
      title,
      content,
      success: (r) => resolve(r.confirm === true),
      fail: () => resolve(false),
    }),
  );
}
function uuid() {
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(new Error('当前微信缺少安全随机数能力，请更新微信后重试；未创建操作。'));
    let source = wx;
    if (
      typeof source.getRandomValues !== 'function' &&
      typeof wx.getUserCryptoManager === 'function'
    )
      source = wx.getUserCryptoManager();
    if (!source || typeof source.getRandomValues !== 'function') {
      fail();
      return;
    }
    source.getRandomValues({
      length: 16,
      success(result) {
        try {
          const bytes = new Uint8Array(result.randomValues);
          if (bytes.length !== 16) {
            fail();
            return;
          }
          bytes[6] = (bytes[6] & 15) | 64;
          bytes[8] = (bytes[8] & 63) | 128;
          const h = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
          resolve(
            h.slice(0, 8) +
              '-' +
              h.slice(8, 12) +
              '-' +
              h.slice(12, 16) +
              '-' +
              h.slice(16, 20) +
              '-' +
              h.slice(20),
          );
        } catch {
          fail();
        }
      },
      fail,
    });
  });
}
module.exports = {
  routes,
  safeReturn,
  open,
  login,
  session,
  begin,
  live,
  guard,
  hold,
  held,
  close,
  message,
  confirm,
  confirmFor,
  confirmOp,
  uuid,
  money,
  localTime,
  datePart,
  timePart,
  chinaStamp,
  today: () => datePart(new Date().toISOString()),
  position: (v) => positionNames[v] || v,
  scope: (v) => scopeNames[v] || v,
  state: (v) => stateNames[v] || v,
};

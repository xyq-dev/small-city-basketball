// C19 team requests, join codes, member bindings and claims (docs/design/C19_CONTRACTS.md §3).
// Every response is shape-checked before a page shows it; the server re-authorizes everything.
const api = require('./api');
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const linkTokenRe = /^[A-Za-z0-9_-]{22}$/;
const PENDING_KEY = 'scb.c19.teamRequest.pending.v1';
// Pages of this module; navigation stays inside this fixed list (no caller-built paths).
const routes = {
  'team-request': '/pages/team-request/index',
  'team-requests': '/pages/team-requests/index',
  'team-join': '/pages/team-join/index',
  memberships: '/pages/memberships/index',
  team: '/pages/team/index',
};
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => typeof v === 'string';
const nullableStr = (v) => v === null || typeof v === 'string';
const stamp = (v) => str(v) && Number.isFinite(Date.parse(v));
const nullableStamp = (v) => v === null || stamp(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
function invalid() {
  throw Object.assign(new Error('服务返回的资料不完整，请重新读取'), { code: 'INVALID_RESPONSE' });
}
function id(value) {
  if (!str(value) || !uuidRe.test(value)) throw new Error('资料编号无效，请重新进入');
  return value.toLowerCase();
}
function text(value, label, min, max) {
  const v = str(value) ? value.trim() : '';
  const size = Array.from(v).length;
  if (size < min || size > max || v.includes('\0'))
    throw new Error(label + '需为' + min + '–' + max + '个字符');
  return v;
}
const reason = (value, label = '原因') => text(value, label, 4, 500);
function linkToken(value) {
  if (!str(value) || !linkTokenRe.test(value)) throw new Error('申请入口无效，请向机构重新索取');
  return value;
}
function normalizeJoinCode(value) {
  const code = str(value) ? value.replace(/[\s-]/g, '').toUpperCase() : '';
  if (!/^[A-Z2-7]{26}$/.test(code)) throw new Error('请填写26位加入码（字母与数字2–7）');
  return code;
}
const formatJoinCode = (code) => normalizeJoinCode(code).replace(/(.{4})(?=.)/g, '$1 ');
function integerIn(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(label + '需为' + min + '–' + max + '的整数');
  return n;
}

const linkStates = ['ACTIVE', 'EXPIRED', 'EXHAUSTED', 'REVOKED'];
const requestStates = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
const codeStates = ['ACTIVE', 'EXPIRED', 'EXHAUSTED', 'REVOKED', 'ISSUER_INVALID'];
const claimStates = ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'];
const validLink = (v) =>
  object(v) &&
  uuidRe.test(v.id) &&
  linkStates.includes(v.status) &&
  str(v.reason) &&
  count(v.maxUses) &&
  count(v.useCount) &&
  stamp(v.expiresAt) &&
  stamp(v.createdAt) &&
  nullableStamp(v.revokedAt);
const validRequest = (v) =>
  object(v) &&
  uuidRe.test(v.id) &&
  uuidRe.test(v.orgId) &&
  str(v.orgName) &&
  str(v.teamName) &&
  nullableStr(v.note) &&
  requestStates.includes(v.status) &&
  count(v.version) &&
  v.version > 0 &&
  nullableStr(v.reviewReason) &&
  (v.teamId === null || uuidRe.test(v.teamId)) &&
  (v.status === 'APPROVED') === (v.teamId !== null) &&
  stamp(v.createdAt);
const validMine = (v) =>
  validRequest(v) &&
  str(v.clientRequestId) &&
  object(v.capabilities) &&
  typeof v.capabilities.canWithdraw === 'boolean';
const validOrgRequest = (v) =>
  validRequest(v) &&
  str(v.requesterDisplayName) &&
  object(v.capabilities) &&
  typeof v.capabilities.canReview === 'boolean' &&
  typeof v.capabilities.isOwnRequest === 'boolean' &&
  !('requesterId' in v) &&
  !('requesterEmail' in v);
const validCode = (v) =>
  object(v) &&
  uuidRe.test(v.id) &&
  codeStates.includes(v.status) &&
  count(v.maxUses) &&
  count(v.useCount) &&
  stamp(v.expiresAt) &&
  str(v.issuedByDisplayName);
const validMembership = (v) =>
  object(v) &&
  uuidRe.test(v.bindingId) &&
  uuidRe.test(v.orgId) &&
  uuidRe.test(v.teamId) &&
  uuidRe.test(v.memberId) &&
  str(v.organizationName) &&
  str(v.teamName) &&
  str(v.memberName) &&
  ['JOIN_CODE', 'CLAIM'].includes(v.source) &&
  ['ACTIVE', 'ENDED'].includes(v.status) &&
  (v.status === 'ACTIVE') === (v.endedAt === null) &&
  stamp(v.createdAt);
const validBinding = (v) =>
  object(v) &&
  uuidRe.test(v.bindingId) &&
  uuidRe.test(v.memberId) &&
  str(v.memberName) &&
  str(v.accountDisplayName) &&
  ['ACTIVE', 'ENDED'].includes(v.status) &&
  !('userId' in v) &&
  !('email' in v);
const validTeamClaim = (v) =>
  object(v) &&
  uuidRe.test(v.claimId) &&
  uuidRe.test(v.memberId) &&
  str(v.memberName) &&
  str(v.targetDisplayName) &&
  claimStates.includes(v.status) &&
  stamp(v.expiresAt);
const validMyClaim = (v) =>
  object(v) &&
  uuidRe.test(v.claimId) &&
  str(v.organizationName) &&
  str(v.teamName) &&
  str(v.memberName) &&
  claimStates.includes(v.status) &&
  stamp(v.expiresAt);
const validBindings = (v, teamId) =>
  object(v) &&
  v.teamId === teamId &&
  str(v.teamName) &&
  Array.isArray(v.bindings) &&
  v.bindings.every(validBinding) &&
  Array.isArray(v.claims) &&
  v.claims.every(validTeamClaim) &&
  Array.isArray(v.claimableMembers) &&
  v.claimableMembers.every((m) => object(m) && uuidRe.test(m.memberId) && str(m.name));
const validTeamView = (v, bindingId) =>
  object(v) &&
  v.bindingId === bindingId &&
  str(v.teamName) &&
  str(v.organizationName) &&
  Array.isArray(v.members) &&
  v.members.every(
    (m) => object(m) && uuidRe.test(m.memberId) && str(m.name) && typeof m.isSelf === 'boolean',
  ) &&
  validMembership(v.myBinding);
const list = (validate) => (v) => Array.isArray(v) && v.every(validate);
function checked(value, validate) {
  if (!validate(value)) invalid();
  return value;
}

function createRepository(suppliedClient) {
  const client = suppliedClient || api.getClient();
  const get = async (path, validate) => checked((await client.request(path)).data, validate);
  const post = async (path, body, validate) =>
    checked((await client.request(path, 'POST', body)).data, validate);
  const org = (orgId) => '/v1/orgs/' + id(orgId);
  const team = (orgId, teamId) => org(orgId) + '/teams/' + id(teamId);
  return {
    // §3.1 organization OWNER/ADMIN
    links: (orgId) => get(org(orgId) + '/team-request-links', list(validLink)),
    createLink: (orgId, input) =>
      post(
        org(orgId) + '/team-request-links',
        {
          expiresInHours: integerIn(input.expiresInHours, '有效期（小时）', 1, 168),
          maxUses: integerIn(input.maxUses, '可用次数', 1, 200),
          reason: reason(input.reason, '生成原因'),
        },
        (v) => object(v) && validLink(v.link) && linkTokenRe.test(v.token),
      ),
    revokeLink: (orgId, linkId, why) =>
      post(
        org(orgId) + '/team-request-links/' + id(linkId) + '/revoke',
        { reason: reason(why, '撤销原因') },
        (v) => validLink(v) && v.id === linkId,
      ),
    orgRequests: (orgId, status) =>
      get(
        org(orgId) +
          '/team-requests' +
          (status
            ? '?status=' + encodeURIComponent(requestStates.includes(status) ? status : '')
            : ''),
        list(validOrgRequest),
      ),
    review: (orgId, requestId, decision, why, expectedVersion) => {
      if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('请选择审核结果');
      return post(
        org(orgId) + '/team-requests/' + id(requestId) + '/review',
        { decision, reason: reason(why, '审核原因'), expectedVersion },
        (v) => validOrgRequest(v) && v.id === requestId,
      );
    },
    // §3.1 applicant
    resolve: (token) =>
      post(
        '/v1/team-request-links/resolve',
        { token: linkToken(token) },
        (v) => object(v) && uuidRe.test(v.linkId) && str(v.orgName) && stamp(v.expiresAt),
      ),
    submit: (input) =>
      post(
        '/v1/team-requests',
        {
          token: linkToken(input.token),
          clientRequestId: input.clientRequestId,
          teamName: input.teamName,
          ...(input.note ? { note: input.note } : {}),
        },
        (v) => validMine(v) && v.clientRequestId === input.clientRequestId,
      ),
    myRequests: () => get('/v1/me/team-requests', list(validMine)),
    withdraw: (requestId, expectedVersion) =>
      post(
        '/v1/me/team-requests/' + id(requestId) + '/withdraw',
        { expectedVersion },
        (v) => validMine(v) && v.id === requestId,
      ),
    // §3.2 team managers
    joinCodes: (orgId, teamId) => get(team(orgId, teamId) + '/join-codes', list(validCode)),
    createJoinCode: (orgId, teamId) =>
      post(
        team(orgId, teamId) + '/join-codes',
        {},
        (v) => object(v) && validCode(v.joinCode) && /^[A-Z2-7]{26}$/.test(v.code),
      ),
    revokeJoinCode: (orgId, teamId, codeId) =>
      post(
        team(orgId, teamId) + '/join-codes/' + id(codeId) + '/revoke',
        {},
        (v) => validCode(v) && v.id === codeId,
      ),
    bindings: (orgId, teamId) =>
      get(team(orgId, teamId) + '/member-bindings', (v) => validBindings(v, teamId)),
    removeBinding: (orgId, teamId, bindingId, why) =>
      post(
        team(orgId, teamId) + '/member-bindings/' + id(bindingId) + '/remove',
        { reason: reason(why, '移除原因') },
        (v) => validBindings(v, teamId),
      ),
    createClaim: (orgId, teamId, memberId, targetUserId) =>
      post(
        team(orgId, teamId) + '/members/' + id(memberId) + '/claims',
        { targetUserId: id(String(targetUserId || '').trim()) },
        (v) => validTeamClaim(v) && v.memberId === memberId,
      ),
    revokeClaim: (orgId, teamId, claimId) =>
      post(
        team(orgId, teamId) + '/member-claims/' + id(claimId) + '/revoke',
        {},
        (v) => validTeamClaim(v) && v.claimId === claimId,
      ),
    // §3.2 players
    join: (code, displayName) =>
      post(
        '/v1/team-joins',
        { code: normalizeJoinCode(code), displayName: text(displayName, '队内显示名', 1, 80) },
        validMembership,
      ),
    memberships: () => get('/v1/me/memberships', list(validMembership)),
    membershipTeam: (bindingId) =>
      get('/v1/me/memberships/' + id(bindingId) + '/team', (v) => validTeamView(v, bindingId)),
    leave: (bindingId) =>
      post(
        '/v1/me/memberships/' + id(bindingId) + '/leave',
        {},
        (v) => validMembership(v) && v.bindingId === bindingId,
      ),
    myClaims: () => get('/v1/me/member-claims', list(validMyClaim)),
    decideClaim: (claimId, decision) => {
      if (!['accept', 'decline'].includes(decision)) throw new Error('无效操作');
      return post(
        '/v1/me/member-claims/' + id(claimId) + '/' + decision,
        {},
        (v) =>
          object(v) &&
          validMyClaim(v.claim) &&
          v.claim.claimId === claimId &&
          (v.membership === null || validMembership(v.membership)),
      );
    },
  };
}

// ---------- unresolved team request submissions (original-ID recovery) ----------
// The record is written before the first send and holds no share token. If the device never
// hears the reply, the page finds the request by its clientRequestId in "my requests"; while
// the token is still in memory it resends with the same id (the server returns the original).
function readPending(wxApi, userId) {
  let value;
  try {
    value = wxApi.getStorageSync(PENDING_KEY);
  } catch {
    return { unavailable: true, record: null };
  }
  if (!object(value) || !object(value[userId])) return { unavailable: false, record: null };
  const r = value[userId];
  return uuidV4.test(r.clientRequestId) && str(r.teamName)
    ? { unavailable: false, record: r }
    : { unavailable: false, record: null };
}
/** Returns false when storage fails: the caller must not send without a durable record. */
function writePending(wxApi, userId, record, expectedRequestId) {
  try {
    const current = wxApi.getStorageSync(PENDING_KEY);
    const next = object(current) ? { ...current } : {};
    // Never replace another unresolved submission, or clear a newer record from a late
    // callback belonging to an older request.
    if (
      object(next[userId]) &&
      ((record && next[userId].clientRequestId !== record.clientRequestId) ||
        (!record && expectedRequestId && next[userId].clientRequestId !== expectedRequestId))
    )
      return false;
    if (record) next[userId] = record;
    else delete next[userId];
    wxApi.setStorageSync(PENDING_KEY, next);
    const check = wxApi.getStorageSync(PENDING_KEY);
    return record
      ? object(check) &&
          object(check[userId]) &&
          check[userId].clientRequestId === record.clientRequestId
      : !object(check) || !check[userId];
  } catch {
    return false;
  }
}

/**
 * A confirmed write bound to the session, page lifecycle and confirmation that opened it
 * (ui.confirmOp + ui.hold). A late confirmation, identity change, sign-out or unload sends
 * nothing; a reply that arrives after any of them is dropped. A sent request whose reply is
 * lost (network error or 5xx) is reported as `uncertain` so the page offers recovery.
 */
async function confirmedWrite(
  page,
  ui,
  { title, content, path, send, done, still = () => true, outcome = {} },
) {
  outcome.sent = false;
  outcome.resolved = false;
  if (page.data.busy || page._closed) return false;
  const viewer = page._viewer;
  const op = await ui.confirmOp(page, title, content);
  if (!op) return false;
  if (!still()) {
    page.setData({ error: '资料或权限已更新，请重新核对后再确认；未发送任何操作。' });
    return false;
  }
  const token = ui.hold(page);
  page.setData({ busy: true, error: '', message: '' });
  let sent = false;
  try {
    const session = await ui.session(page, path);
    if (!session || !op.valid() || !ui.held(page, token)) return false;
    if (session.user.id !== viewer || page._viewer !== viewer) {
      page.setData({ error: '登录身份已变化，请重新读取当前资料；未发送任何操作。' });
      return false;
    }
    if (!still()) {
      page.setData({ error: '资料或权限已更新，请重新核对后再确认；未发送任何操作。' });
      return false;
    }
    sent = true;
    outcome.sent = true;
    const result = await send();
    if (!ui.held(page, token)) return false;
    await done(result);
    outcome.resolved = true;
    return true;
  } catch (error) {
    if (ui.held(page, token)) {
      outcome.resolved = sent && !!error && error.status >= 400 && error.status < 500;
      page.setData({
        error: ui.message(error),
        uncertain: sent && (!error || !error.status || error.status >= 500),
      });
    }
    return false;
  } finally {
    if (ui.held(page, token)) page.setData({ busy: false });
  }
}

function go(key, query = {}) {
  if (!routes[key]) throw new Error('页面入口无效');
  const pairs = Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])));
  wx.navigateTo({ url: routes[key] + (pairs.length ? '?' + pairs.join('&') : '') });
}
const requestStateNames = {
  PENDING: '待机构审核',
  APPROVED: '已批准 · 球队已创建',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
};
const codeStateNames = {
  ACTIVE: '可使用',
  EXPIRED: '已过期',
  EXHAUSTED: '次数已用完',
  REVOKED: '已撤销',
  ISSUER_INVALID: '签发者已无管理权，不可使用',
};
const claimStateNames = {
  PENDING: '待本人接受',
  ACCEPTED: '已接受',
  DECLINED: '已拒绝',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
};
const endedNames = { LEFT: '本人已退出', REMOVED: '已被移除', MEMBER_REMOVED: '已移出长期名单' };
function sharePath(token) {
  return routes['team-request'] + '?token=' + linkToken(token);
}

module.exports = {
  routes,
  go,
  id,
  text,
  reason,
  linkToken,
  normalizeJoinCode,
  formatJoinCode,
  sharePath,
  createRepository,
  confirmedWrite,
  readPending,
  writePending,
  PENDING_KEY,
  requestState: (v) => requestStateNames[v] || v,
  linkState: (v) => codeStateNames[v] || v,
  codeState: (v) => codeStateNames[v] || v,
  claimState: (v) => claimStateNames[v] || v,
  endedReason: (v) => endedNames[v] || '',
};

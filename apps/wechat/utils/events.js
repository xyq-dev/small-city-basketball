const api = require('./api');

// Only organizations in the caller's own session are read. The server still decides which
// events each role may see (administrators: all; other staff: events they are assigned to).
const statusGroups = [
  { key: 'live', label: '进行中', statuses: ['RUNNING'] },
  {
    key: 'upcoming',
    label: '即将开赛',
    statuses: ['SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'],
  },
  { key: 'finished', label: '已结束', statuses: ['COMPLETED', 'ARCHIVED'] },
  { key: 'draft', label: '筹备中', statuses: ['DRAFT'] },
  { key: 'cancelled', label: '已取消', statuses: ['CANCELLED'] },
];
const roleNames = {
  ORG_OWNER: '机构负责人',
  ORG_ADMIN: '机构管理员',
  EVENT_MANAGER: '赛事负责人',
  REVIEWER: '审核人员',
  SCORER: '记录台人员',
  STREAMER: '直播人员',
};
const MAX_ORGANIZATIONS = 10;
const PAGE_LIMIT = 50;

function invalid(message) {
  return { code: 'INVALID_RESPONSE', message };
}
function groupOf(status) {
  return statusGroups.find((group) => group.statuses.includes(status));
}
function shortDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.slice(5).replace('-', '/')
    : '日期待确认';
}
function organizations(session) {
  const result = [];
  for (const org of (session && session.organizations) || []) {
    if (
      !org ||
      typeof org.name !== 'string' ||
      !Object.prototype.hasOwnProperty.call(roleNames, org.role)
    )
      continue;
    try {
      api.uuid(org.id);
    } catch {
      continue;
    }
    if (result.some((o) => o.id === org.id)) continue;
    result.push({ id: org.id, name: org.name, role: org.role, roleLabel: roleNames[org.role] });
    if (result.length === MAX_ORGANIZATIONS) break;
  }
  return result;
}
function eventView(org, raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name || raw.name.length > 200)
    throw invalid('赛事资料格式无效');
  api.uuid(raw.id);
  const group = groupOf(raw.status);
  if (!group) throw invalid('赛事状态无效');
  return {
    key: org.id + ':' + raw.id,
    id: raw.id,
    orgId: org.id,
    orgName: org.name,
    roleLabel: org.roleLabel,
    name: raw.name,
    status: raw.status,
    statusLabel: api.eventStatus(raw.status),
    formatLabel: api.eventFormat(raw.format),
    group: group.key,
    startDate: typeof raw.startDate === 'string' ? raw.startDate : '',
    dateLabel: shortDate(raw.startDate) + '–' + shortDate(raw.endDate),
    venueName: typeof raw.venueName === 'string' && raw.venueName ? raw.venueName : '场地待说明',
  };
}
function order(a, b) {
  const rank = (e) => statusGroups.findIndex((g) => g.key === e.group);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  // Upcoming soonest first; everything else most recent first.
  return a.group === 'upcoming'
    ? a.startDate.localeCompare(b.startDate)
    : b.startDate.localeCompare(a.startDate);
}
// `maxPages` follows the server cursor (50 per page); the home summary reads one page, the
// events tab up to 10 (500 events per organization) and names organizations beyond that.
async function load(client, session, maxPages = 1) {
  const orgs = organizations(session);
  const items = [];
  const failures = [];
  const truncated = [];
  for (const org of orgs) {
    let cursor = null,
      page = 0;
    const rows = [];
    try {
      do {
        const response = await client.request(
          '/v1/orgs/' +
            org.id +
            '/events?limit=' +
            PAGE_LIMIT +
            (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        );
        if (!Array.isArray(response.data)) throw invalid('赛事资料格式无效');
        rows.push(...response.data);
        cursor = response.meta.nextCursor;
        page++;
      } while (cursor && page < maxPages);
      if (cursor) truncated.push(org.name);
    } catch (error) {
      // A changed account must never fall through to a partially rendered private list.
      if (error && (error.code === 'SESSION_CHANGED' || error.status === 401)) throw error;
      failures.push({
        orgId: org.id,
        orgName: org.name,
        message: page
          ? '后续赛事读取未完成，仅显示已读取的 ' + rows.length + ' 届，请稍后刷新'
          : error && error.status === 403
            ? '当前身份不能查看该机构的赛事'
            : (error && error.message) || '赛事暂时无法读取',
      });
    }
    // Pages already read belong to the current account; a later page failing is reported above.
    for (const raw of rows) items.push(eventView(org, raw));
  }
  items.sort(order);
  return {
    organizations: orgs,
    sections: statusGroups
      .map((g) => ({
        key: g.key,
        label: g.label,
        events: items.filter((e) => e.group === g.key),
      }))
      .filter((s) => s.events.length),
    featured: items.filter((e) => e.group === 'live' || e.group === 'upcoming').slice(0, 3),
    total: items.length,
    failures,
    truncated,
    teamCount: Array.isArray(session.teamContexts) ? session.teamContexts.length : 0,
  };
}
// Read separately from the private event requests: a first read may legitimately advance the
// client's session revision (unknown actor -> current actor) before a page starts listening.
async function session(client) {
  const value = (await client.request('/v1/auth/session')).data;
  if (
    !value ||
    !value.user ||
    typeof value.user.id !== 'string' ||
    !Array.isArray(value.organizations) ||
    !Array.isArray(value.teamContexts)
  )
    throw invalid('登录资料无效，请重新登录');
  api.uuid(value.user.id);
  return value;
}
module.exports = { statusGroups, roleNames, organizations, eventView, load, session };

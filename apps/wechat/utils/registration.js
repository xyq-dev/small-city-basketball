const api = require('./api');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entryStates = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'WITHDRAWN',
];
const eventStates = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];
const entryCaps = [
  'canEditRoster',
  'canSubmit',
  'canWithdraw',
  'canReview',
  'canApprove',
  'canRequestChanges',
  'canReject',
];
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const strings = (value, keys) =>
  object(value) && keys.every((key) => typeof value[key] === 'string');
const caps = (value, keys) => object(value) && keys.every((key) => typeof value[key] === 'boolean');
const stamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function invalid(message = '服务返回的球队资料不完整，请重新读取') {
  throw Object.assign(new Error(message), { code: 'INVALID_RESPONSE' });
}
function id(value) {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new Error('资料编号无效，请从我的球队重新进入');
  return value;
}
function text(value, label, max = 80) {
  const valueText = typeof value === 'string' ? value.trim() : '';
  if (!valueText || Array.from(valueText).length > max || valueText.includes('\0'))
    throw new Error(label + '需为1–' + max + '个字符');
  return valueText;
}
function validTeam(value) {
  return (
    strings(value, ['id', 'orgId', 'name']) &&
    uuid.test(value.id) &&
    uuid.test(value.orgId) &&
    integer(value.version) &&
    value.version > 0 &&
    Array.isArray(value.members) &&
    value.members.length <= 60 &&
    value.members.every((m) => strings(m, ['id', 'name']) && uuid.test(m.id)) &&
    new Set(value.members.map((m) => m.id)).size === value.members.length &&
    Array.isArray(value.grants) &&
    value.grants.every(
      (g) =>
        strings(g, ['userId', 'role', 'status']) &&
        g.role === 'TEAM_MANAGER' &&
        ['ACTIVE', 'DISABLED'].includes(g.status),
    ) &&
    caps(value.capabilities, ['canManage', 'canInvite'])
  );
}
function validRules(value) {
  return (
    strings(value, ['id', 'eventId', 'createdAt']) &&
    integer(value.version) &&
    value.version > 0 &&
    integer(value.minPlayers) &&
    integer(value.maxPlayers) &&
    value.minPlayers >= 1 &&
    value.maxPlayers <= 60 &&
    value.maxPlayers >= value.minPlayers &&
    caps(value, ['zeroAndDoubleZeroDistinct', 'requireIdentity', 'requireInsurance'])
  );
}
function validSummary(value) {
  return (
    strings(value, ['id', 'eventId', 'teamId', 'teamName']) &&
    uuid.test(value.id) &&
    uuid.test(value.eventId) &&
    uuid.test(value.teamId) &&
    entryStates.includes(value.status) &&
    integer(value.version) &&
    value.version > 0
  );
}
function validEntry(value) {
  return (
    validSummary(value) &&
    typeof value.orgId === 'string' &&
    validRules(value.rules) &&
    value.rules.eventId === value.eventId &&
    Array.isArray(value.players) &&
    value.players.length <= 60 &&
    value.players.every(
      (p) => strings(p, ['memberId', 'name', 'jerseyNo']) && uuid.test(p.memberId),
    ) &&
    new Set(value.players.map((p) => p.memberId)).size === value.players.length &&
    Array.isArray(value.history) &&
    value.history.every(
      (h) =>
        strings(h, ['id', 'actorId', 'type', 'createdAt']) &&
        stamp(h.createdAt) &&
        (h.reason === null || typeof h.reason === 'string'),
    ) &&
    caps(value.capabilities, entryCaps)
  );
}
function validEvent(value) {
  return (
    strings(value, ['id', 'name', 'startDate', 'endDate']) &&
    uuid.test(value.id) &&
    integer(value.version) &&
    value.version > 0 &&
    eventStates.includes(value.status)
  );
}
function validRegistrationEvent(value) {
  return (
    object(value) &&
    validEvent(value.event) &&
    (value.rules === null || (validRules(value.rules) && value.rules.eventId === value.event.id)) &&
    (value.entry === null ||
      (validSummary(value.entry) && value.entry.eventId === value.event.id)) &&
    caps(value.capabilities, ['canCreateEntry'])
  );
}
function validFile(value) {
  return (
    strings(value, ['id', 'purpose', 'fileName', 'contentType', 'sha256', 'createdAt']) &&
    uuid.test(value.id) &&
    ['PRIVATE_INSURANCE', 'REGISTRATION_DOC'].includes(value.purpose) &&
    ['application/pdf', 'image/png', 'image/jpeg'].includes(value.contentType) &&
    integer(value.byteLength) &&
    value.byteLength > 0 &&
    value.byteLength <= 8388608 &&
    integer(value.version) &&
    value.version > 0 &&
    ['ACTIVE', 'REVOKED', 'PURGED'].includes(value.status)
  );
}
function validFiles(value) {
  return (
    object(value) &&
    typeof value.entryId === 'string' &&
    integer(value.entryVersion) &&
    value.entryVersion > 0 &&
    Array.isArray(value.files) &&
    value.files.length <= 100 &&
    value.files.every(validFile) &&
    object(value.usage) &&
    integer(value.usage.usedBytes) &&
    value.usage.limitBytes === 134217728 &&
    value.usage.maxFileBytes === 8388608 &&
    caps(value.capabilities, ['canUpload', 'canRevoke', 'canPurge'])
  );
}
function checked(value, validate) {
  if (!validate(value)) invalid();
  return value;
}
function cursor(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    invalid('列表分页信息不完整，请重新读取');
  return value;
}
function mergePage(oldRows, incoming, key = 'id') {
  const rows = new Map(
    oldRows.map((item) => [key === 'eventId' ? item.event.id : item[key], item]),
  );
  for (const item of incoming) rows.set(key === 'eventId' ? item.event.id : item[key], item);
  return Array.from(rows.values());
}
function createRepository(orgId, suppliedClient) {
  const org = id(orgId);
  const client = suppliedClient || api.getClient();
  const base = '/v1/orgs/' + org;
  async function read(path, validate) {
    return checked((await client.request(base + path)).data, validate);
  }
  async function write(path, method, input, validate) {
    return checked((await client.request(base + path, method, input)).data, validate);
  }
  async function list(path, after, validate, teamCreation = false) {
    const before = cursor(after);
    const response = await client.request(
      base + path + '?limit=100' + (before ? '&cursor=' + encodeURIComponent(before) : ''),
    );
    if (!Array.isArray(response.data) || !response.data.every(validate) || !object(response.meta))
      invalid();
    const nextCursor = cursor(response.meta.nextCursor);
    if (nextCursor && nextCursor === before) invalid('列表游标没有前进，请刷新后重试');
    if (
      teamCreation &&
      (!object(response.meta.capabilities) ||
        typeof response.meta.capabilities.canCreateTeam !== 'boolean')
    )
      invalid();
    return {
      items: response.data,
      nextCursor,
      canCreateTeam: teamCreation && response.meta.capabilities.canCreateTeam === true,
    };
  }
  return {
    teams: (after) => list('/teams', after, (v) => validTeam(v) && v.orgId === org, true),
    team: (teamId) =>
      read('/teams/' + id(teamId), (v) => validTeam(v) && v.id === teamId && v.orgId === org),
    createTeam: (name) =>
      write(
        '/teams',
        'POST',
        { name: text(name, '球队名称') },
        (v) => validTeam(v) && v.orgId === org,
      ),
    updateTeam: (teamId, version, name) =>
      write(
        '/teams/' + id(teamId),
        'PATCH',
        { name: text(name, '球队名称'), expectedVersion: version },
        (v) => validTeam(v) && v.id === teamId && v.orgId === org,
      ),
    members: (teamId, version, members) =>
      write(
        '/teams/' + id(teamId) + '/members',
        'PUT',
        { expectedVersion: version, members: normalizeMembers(members) },
        (v) => validTeam(v) && v.id === teamId && v.orgId === org,
      ),
    events: (teamId, after) =>
      list(
        '/teams/' + id(teamId) + '/registration-events',
        after,
        (v) => validRegistrationEvent(v) && (v.entry === null || v.entry.teamId === teamId),
        false,
      ),
    createEntry: (eventId, teamId) =>
      write(
        '/events/' + id(eventId) + '/entries',
        'POST',
        { teamId: id(teamId) },
        (v) => validEntry(v) && v.eventId === eventId && v.teamId === teamId && v.orgId === org,
      ),
    entry: (entryId) =>
      read('/entries/' + id(entryId), (v) => validEntry(v) && v.id === entryId && v.orgId === org),
    roster: (entryId, version, players) =>
      write(
        '/entries/' + id(entryId) + '/roster',
        'PUT',
        { expectedVersion: version, players },
        (v) => validEntry(v) && v.id === entryId && v.orgId === org,
      ),
    command: (entryId, version, type, reason) => {
      if (!['SUBMIT', 'WITHDRAW'].includes(type)) throw new Error('请使用主办方独立审核入口');
      return write(
        '/entries/' + id(entryId) + '/commands',
        'POST',
        {
          expectedVersion: version,
          type,
          ...(reason ? { reason: text(reason, '处理原因', 500) } : {}),
        },
        (v) => validEntry(v) && v.id === entryId && v.orgId === org,
      );
    },
    files: (entryId) =>
      read(
        '/entries/' + id(entryId) + '/media-files',
        (v) => validFiles(v) && v.entryId === entryId,
      ),
    upload: (entryId, input) =>
      write('/entries/' + id(entryId) + '/media-files', 'POST', input, validFile),
    revokeFile: (entryId, fileId, version, reason) =>
      write(
        '/entries/' + id(entryId) + '/media-files/' + id(fileId) + '/commands',
        'POST',
        { type: 'REVOKE', expectedVersion: version, reason: text(reason, '移除原因', 500) },
        (v) => validFile(v) && v.id === fileId,
      ),
  };
}
function normalizeMembers(members) {
  if (!Array.isArray(members) || members.length > 60) throw new Error('球队长期成员最多60人');
  const ids = new Set();
  return members.map((m) => {
    if (m.id) {
      id(m.id);
      if (ids.has(m.id)) throw new Error('成员编号不能重复');
      ids.add(m.id);
    }
    return { ...(m.id ? { id: m.id } : {}), name: text(m.name, '成员姓名') };
  });
}
function rosterRows(team, entry) {
  const current = new Map(entry.players.map((p) => [p.memberId, p]));
  const rows = team
    ? team.members.map((m) => ({
        memberId: m.id,
        name: m.name,
        selected: current.has(m.id),
        jerseyNo: current.get(m.id)?.jerseyNo || '',
      }))
    : [];
  const active = new Set(rows.map((r) => r.memberId));
  for (const p of entry.players)
    if (!active.has(p.memberId)) rows.push({ ...p, selected: true, archived: true });
  return rows;
}
function normalizeRoster(rows, rules) {
  if (rows.some((row) => row.selected && row.archived))
    throw new Error('名单含已归档的长期成员，请先移出再保存');
  const players = rows
    .filter((r) => r.selected)
    .map((r) => ({ memberId: id(r.memberId), jerseyNo: String(r.jerseyNo || '').trim() }));
  if (players.length > 60) throw new Error('名单最多60人');
  const members = new Set(),
    jerseys = new Set();
  for (const p of players) {
    if (members.has(p.memberId)) throw new Error('同一球员不能重复纳入');
    if (!/^(?:0|00|[1-9][0-9]?)$/.test(p.jerseyNo)) throw new Error('球衣号码需为0、00或1–99');
    const number = !rules.zeroAndDoubleZeroDistinct && p.jerseyNo === '00' ? '0' : p.jerseyNo;
    if (jerseys.has(number)) throw new Error('球衣号码重复，请核对赛事0与00规则');
    members.add(p.memberId);
    jerseys.add(number);
  }
  return players;
}
function stateLabel(value) {
  return (
    {
      DRAFT: '报名草稿',
      SUBMITTED: '已提交待审核',
      APPROVED: '报名已批准',
      CHANGES_REQUESTED: '需要修改后重新提交',
      REJECTED: '报名已拒绝',
      WITHDRAWN: '报名已撤回',
      REGISTRATION_OPEN: '报名开放',
      REGISTRATION_CLOSED: '报名截止',
      SCHEDULED: '赛程已发布',
      RUNNING: '比赛进行中',
      COMPLETED: '赛事已完赛',
      ARCHIVED: '赛事已归档',
      CANCELLED: '赛事已取消',
      SUBMIT: '提交审核',
      WITHDRAW: '撤回报名',
      APPROVE: '批准',
      REQUEST_CHANGES: '退回修改',
      REJECT: '拒绝',
    }[value] || value
  );
}
function describeEntry(entry) {
  return {
    ...entry,
    statusLabel: stateLabel(entry.status),
    history: entry.history.map((h) => ({
      ...h,
      typeLabel: stateLabel(h.type),
      timeText: h.createdAt.slice(0, 10),
    })),
  };
}
function versionMatch(current, expected) {
  if (current.version !== expected)
    throw Object.assign(new Error('资料已变化，请刷新后重新核对；未使用新版本替你覆盖'), {
      code: 'VERSION_CONFLICT',
      status: 409,
    });
}
function selectedFile(file) {
  if (
    !object(file) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > 8388608 ||
    typeof file.path !== 'string' ||
    !file.path
  )
    throw new Error('请选择非空且不超过8MiB的文件');
  const name = text(file.name, '文件名', 120);
  if (/[\\/\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..')
    throw new Error('文件名不能含路径或控制字符');
  const mime = /\.pdf$/i.test(name)
    ? 'application/pdf'
    : /\.png$/i.test(name)
      ? 'image/png'
      : /\.jpe?g$/i.test(name)
        ? 'image/jpeg'
        : '';
  if (!mime) throw new Error('报名资料仅支持PDF、PNG、JPEG，不支持SVG或视频');
  return { fileName: name, contentType: mime, path: file.path, size: file.size };
}
function readFileBase64(wxApi, file) {
  const checkedFile = selectedFile(file);
  if (typeof wxApi.getFileSystemManager !== 'function')
    return Promise.reject(new Error('当前微信无法读取文件，请更新客户端后重试'));
  return new Promise((resolve, reject) =>
    wxApi.getFileSystemManager().readFile({
      filePath: checkedFile.path,
      encoding: 'base64',
      success(r) {
        const value = r.data;
        const padding =
          typeof value === 'string' && value.endsWith('==')
            ? 2
            : typeof value === 'string' && value.endsWith('=')
              ? 1
              : 0;
        if (
          typeof value !== 'string' ||
          value.length !== Math.ceil(checkedFile.size / 3) * 4 ||
          (value.length / 4) * 3 - padding !== checkedFile.size ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
        ) {
          reject(new Error('文件编码或大小与所选文件不一致'));
          return;
        }
        resolve({
          fileName: checkedFile.fileName,
          contentType: checkedFile.contentType,
          base64: value,
        });
      },
      fail() {
        reject(new Error('文件读取失败，请重新选择'));
      },
    }),
  );
}
async function acceptInvitation(invitationId, token, suppliedClient) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('请填写有效的43位邀请凭据');
  const client = suppliedClient || api.getClient();
  const value = (
    await client.request('/v1/invitations/' + id(invitationId) + '/accept', 'POST', { token })
  ).data;
  return checked(
    value,
    (v) =>
      strings(v, ['orgId', 'organizationName', 'teamId', 'teamName']) &&
      uuid.test(v.orgId) &&
      uuid.test(v.teamId),
  );
}
module.exports = {
  id,
  text,
  createRepository,
  mergePage,
  normalizeMembers,
  rosterRows,
  normalizeRoster,
  stateLabel,
  describeEntry,
  versionMatch,
  selectedFile,
  readFileBase64,
  acceptInvitation,
  validTeam,
  validEntry,
  validFiles,
};

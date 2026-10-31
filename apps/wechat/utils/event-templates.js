const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formats = ['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'];
const clone = (value) => JSON.parse(JSON.stringify(value));
function key(actor, org) {
  if (!uuid.test(actor || '') || !uuid.test(org || '')) throw new Error('请先登录并读取当前机构');
  return 'scb-template-request-v1:' + actor + ':' + org;
}
function valid(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !uuid.test(body.clientRequestId || '')
  )
    return false;
  const fields =
    body.type === 'INSTANTIATE'
      ? body.presetKey !== undefined
        ? ['presetKey', 'event']
        : ['templateId', 'templateVersionId', 'expectedTemplateVersion', 'event']
      : body.type === 'CREATE_FROM_EVENT'
        ? ['eventId', 'expectedEventVersion', 'name', 'expectedTeams', 'scheduling']
        : body.type === 'ARCHIVE_TEMPLATE'
          ? ['templateId', 'expectedTemplateVersion', 'reason']
          : null;
  if (
    !fields ||
    Object.keys(body).length !== fields.length + 2 ||
    Object.keys(body).some((k) => !['type', 'clientRequestId', ...fields].includes(k))
  )
    return false;
  return (
    JSON.stringify(body).length <= 16000 &&
    fields.every((f) => Object.prototype.hasOwnProperty.call(body, f))
  );
}
function read(actor, org) {
  try {
    const value = wx.getStorageSync(key(actor, org));
    if (value === undefined || value === null || value === '') return null;
    if (!valid(value)) throw new Error('invalid record');
    return clone(value);
  } catch {
    throw new Error('无法读取本机待核对请求，请先恢复本机存储；没有发送操作。');
  }
}
function save(actor, org, body) {
  const old = read(actor, org),
    encoded = JSON.stringify(body);
  if (!valid(body) || (old && JSON.stringify(old) !== encoded))
    throw new Error('存在待核对的原模板请求，请先核对并重试，不能替换原编号。');
  try {
    wx.setStorageSync(key(actor, org), clone(body));
    if (JSON.stringify(read(actor, org)) !== encoded) throw new Error('write failed');
  } catch {
    throw new Error('无法保存本机待核对请求，没有发送操作。');
  }
}
function clear(actor, org, body) {
  try {
    const old = read(actor, org);
    if (old && JSON.stringify(old) === JSON.stringify(body)) wx.removeStorageSync(key(actor, org));
    return !read(actor, org);
  } catch {
    return false;
  }
}
const unknown = (error) =>
  !error || !error.status || error.status >= 500 || error.code === 'IDEMPOTENCY_KEY_REUSED';
function receipt(value, body) {
  const operation = body.type === 'CREATE_FROM_EVENT' ? 'CREATE_TEMPLATE' : body.type;
  if (
    !value ||
    value.clientRequestId !== body.clientRequestId ||
    value.operation !== operation ||
    !value.template ||
    !uuid.test(value.template.id || '') ||
    !uuid.test(value.template.versionId || '') ||
    !Number.isSafeInteger(value.template.version) ||
    value.template.version < 1 ||
    (operation === 'INSTANTIATE' &&
      body.templateId &&
      (value.template.id !== body.templateId ||
        value.template.versionId !== body.templateVersionId ||
        value.template.version !== body.expectedTemplateVersion)) ||
    (operation === 'INSTANTIATE'
      ? !value.event || !uuid.test(value.event.id || '')
      : value.event !== null)
  )
    throw new Error('返回结果无法核验，请保留原请求核对，暂未确认操作完成。');
  return value;
}
function catalog(value) {
  if (
    !value ||
    !Array.isArray(value.templates) ||
    !Array.isArray(value.presets) ||
    value.templates.length > 100 ||
    value.presets.length > 10 ||
    !value.capabilities ||
    typeof value.capabilities.canInstantiate !== 'boolean'
  )
    throw new Error('模板列表无法核验，请重新读取');
  const rows = [{ label: '不使用模板', key: '', configuration: null }];
  const safe = (cfg) =>
    cfg &&
    formats.includes(cfg.format) &&
    cfg.registration &&
    cfg.scoring &&
    cfg.scheduling &&
    (cfg.expectedTeams === null ||
      (Number.isSafeInteger(cfg.expectedTeams) &&
        cfg.expectedTeams >= 2 &&
        cfg.expectedTeams <= 32));
  for (const p of value.presets) {
    if (
      p.key !== 'EIGHT_TEAM_GROUP_BRONZE_V1' ||
      !safe(p.configuration) ||
      typeof p.name !== 'string'
    )
      throw new Error('预设模板无法核验');
    rows.push({ label: p.name, key: p.key, configuration: p.configuration, preset: true });
  }
  for (const t of value.templates) {
    if (
      !uuid.test(t.id || '') ||
      !uuid.test(t.versionId || '') ||
      !Number.isSafeInteger(t.version) ||
      !safe(t.configuration) ||
      typeof t.name !== 'string'
    )
      throw new Error('机构模板无法核验');
    if (t.status === 'ACTIVE')
      rows.push({
        label: t.name + ' · v' + t.version,
        key: t.id,
        versionId: t.versionId,
        version: t.version,
        configuration: t.configuration,
        preset: false,
      });
  }
  return {
    rows,
    truncated: value.truncated === true,
    canInstantiate: value.capabilities.canInstantiate,
    canManage: value.capabilities.canManageTemplates === true,
  };
}
function guide(value, eventVersion) {
  const codes = ['CONFIGURE', 'REGISTRATION', 'FREEZE', 'DRAW', 'ALLOCATE', 'PUBLISH'];
  if (
    !value ||
    value.eventVersion !== eventVersion ||
    !Array.isArray(value.steps) ||
    value.steps.length !== 6 ||
    !value.counts ||
    typeof value.canManage !== 'boolean'
  )
    throw new Error('办赛向导版本已变化，请刷新');
  const labels = {
    COMPLETE: '已完成',
    CURRENT: '当前步骤',
    BLOCKED: '需处理',
    WAITING: '待前序完成',
  };
  return {
    ...value,
    steps: value.steps.map((s, i) => {
      if (
        !s ||
        s.code !== codes[i] ||
        !labels[s.state] ||
        !Array.isArray(s.blockers) ||
        s.blockers.some((b) => typeof b !== 'string') ||
        !['SETUP', 'REGISTRATION', 'SCHEDULING', 'EVENT'].includes(s.action)
      )
        throw new Error('办赛步骤无法核验');
      return { ...s, stateLabel: labels[s.state] };
    }),
  };
}
module.exports = { read, save, clear, unknown, receipt, catalog, guide };

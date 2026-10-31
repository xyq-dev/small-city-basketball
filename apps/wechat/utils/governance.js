const api = require('./api');
const ui = require('./ui');
const materials = require('./participant-materials');
const PREFIX = 'scb.x18.pending.v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = ['CASE', 'CITY', 'SPONSOR', 'LEDGER', 'REVIEW'];
const labels = {
  OPEN: '待处理',
  ASSIGNED: '已分派',
  RESOLVED: '已处理',
  CLOSED: '已关闭',
  DRAFT: '草稿',
  SUBMITTED: '待独立审核',
  APPROVED: '已审核',
  REJECTED: '已退回',
  WITHDRAWN: '已撤回',
  PENDING_REVIEW: '待独立审核',
  PUBLISHED: '已公开',
  ACTIVE: '有效',
  REVOKED: '已撤销',
};
function object(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function id(v) {
  if (typeof v !== 'string' || !UUID.test(v)) throw new Error('资源标识无效，请重新进入页面');
  return v.toLowerCase();
}
function key(user, kind) {
  if (!KINDS.includes(kind)) throw new Error('操作类型无效');
  return PREFIX + id(user) + ':' + kind;
}
function readPending(user, kind) {
  let r;
  try {
    r = wx.getStorageSync(key(user, kind));
  } catch {
    throw new Error('无法读取原操作保护记录，请先恢复本机存储。');
  }
  if (r === undefined || r === null || r === '') return null;
  if (
    !object(r) ||
    r.userId !== id(user) ||
    r.kind !== kind ||
    !V4.test(r.commandId || '') ||
    Object.keys(r).sort().join(',') !== 'commandId,kind,userId'
  )
    throw new Error('原操作记录损坏，已停止新操作，请先核对。');
  return r;
}
function savePending(record) {
  const previous = readPending(record.userId, record.kind);
  if (previous) throw new Error('有原操作待核对，请先查询或明确放弃，不能更换编号重复提交。');
  try {
    wx.setStorageSync(key(record.userId, record.kind), record);
    if (readPending(record.userId, record.kind)?.commandId !== record.commandId) throw new Error();
  } catch {
    throw new Error('原操作保护记录保存失败，没有发送请求。');
  }
}
function clearPending(record) {
  try {
    if (readPending(record.userId, record.kind)?.commandId !== record.commandId) return;
    wx.removeStorageSync(key(record.userId, record.kind));
  } catch {}
}
function unknown(error) {
  return !error || !error.status || error.status >= 500 || error.code === 'IDEMPOTENCY_CONFLICT';
}
function result(raw) {
  if (!object(raw)) throw new Error('返回资料无效，请查询原操作');
  return raw;
}
function item(raw) {
  if (!object(raw) || !UUID.test(raw.id || '') || !Number.isInteger(raw.version) || raw.version < 1)
    throw new Error('服务端资料无效，请刷新');
  return { ...raw, statusLabel: labels[raw.status] || raw.status || '状态待确认' };
}
function page(raw) {
  if (
    !object(raw) ||
    !Array.isArray(raw.items) ||
    raw.items.length > 100 ||
    (raw.nextCursor !== null && raw.nextCursor !== undefined && !UUID.test(raw.nextCursor))
  )
    throw new Error('列表资料无效，请刷新');
  return { ...raw, items: raw.items.map(item) };
}
async function request(client, path, method = 'GET', body) {
  const response = await client.request(path, method, body);
  return response.data;
}
/** Metadata-only journal: case text, identities, files and message payloads never enter storage. */
async function perform(page, kind, path, body, options = {}) {
  if (page.data.busy || !page._viewer) return null;
  const op = await ui.confirmOp(
    page,
    options.title || '确认操作',
    options.content || '提交后按当前服务端权限和版本处理。',
  );
  if (!op) return null;
  const user = id(page._viewer);
  if (readPending(user, kind)) throw new Error('请先核对该类原操作');
  const commandId = await ui.uuid();
  if (!op.valid() || page._viewer !== user) return null;
  const record = { userId: user, kind, commandId };
  savePending(record);
  const token = ui.hold(page);
  page.setData({ busy: true, error: '', pending: record });
  const target = typeof path === 'function' ? path(commandId) : path;
  const payload = options.pathCommand ? body : { ...body, commandId };
  try {
    if (!op.valid() || !ui.held(page, token)) return null;
    const value = result(await request(api.getClient(), target, options.method || 'POST', payload));
    clearPending(record);
    if (ui.held(page, token)) {
      page.setData({ pending: null, notice: '操作已确认，请以刷新后的当前状态为准。' });
      return value;
    }
    return null;
  } catch (error) {
    if (!unknown(error)) {
      clearPending(record);
      if (ui.held(page, token)) page.setData({ pending: null });
    }
    if (ui.held(page, token))
      page.setData({
        error: unknown(error)
          ? '结果尚未确认，请查询原操作；不会自动换编号重发。'
          : ui.message(error),
      });
    return null;
  } finally {
    if (ui.held(page, token)) page.setData({ busy: false });
  }
}
async function recover(page, kind, cancel = false) {
  if (page.data.busy || !page._viewer) return null;
  const record = readPending(page._viewer, kind);
  if (!record) {
    page.setData({ pending: null });
    return null;
  }
  const op = cancel
    ? await ui.confirmOp(
        page,
        '明确放弃未确认操作',
        '服务端会先核对原请求；若尚未生效，将永久阻止迟到请求执行。已生效的请求不会撤销。',
      )
    : null;
  if (cancel && !op) return null;
  const token = ui.hold(page);
  page.setData({ busy: true, error: '' });
  try {
    if (cancel && !op.valid()) return null;
    const value = result(
      await request(
        api.getClient(),
        '/v1/me/governance/operations/' + record.commandId + (cancel ? '/cancel' : ''),
        cancel ? 'POST' : 'GET',
        cancel ? { reason: '用户明确放弃未确认操作' } : undefined,
      ),
    );
    clearPending(record);
    if (ui.held(page, token)) {
      page.setData({
        pending: null,
        notice: value.cancelled
          ? '原操作已明确取消，迟到请求不会执行。'
          : '已取得原操作回执，请刷新核对。',
      });
      return value;
    }
    return null;
  } catch (error) {
    if (ui.held(page, token))
      page.setData({
        error:
          error && error.status === 404
            ? '尚未查到原结果，保护记录保留；可稍后再查或明确放弃。'
            : ui.message(error),
      });
    return null;
  } finally {
    if (ui.held(page, token)) page.setData({ busy: false });
  }
}
async function attachmentBody(wxApi, file, expectedVersion, visibility) {
  if (!file || file.size < 1 || file.size > 4 * 1024 * 1024)
    throw new Error('附件须非空且不超过4MiB');
  const base64 = await materials.readBase64(wxApi, file);
  return {
    expectedVersion,
    fileName: file.name,
    contentType: file.contentType,
    base64,
    visibility,
  };
}
async function previewAttachment(page, caseId, file) {
  if (page.data.busy) return;
  const token = ui.hold(page);
  page.setData({ busy: true, error: '' });
  let path = '';
  try {
    const value = await api
      .getClient()
      .download(
        '/v1/me/governance/cases/' + id(caseId) + '/attachments/' + id(file.id) + '/content',
      );
    if (!ui.held(page, token)) return;
    const suffix =
      value.contentType === 'application/pdf'
        ? 'pdf'
        : value.contentType === 'image/png'
          ? 'png'
          : 'jpg';
    const random = await ui.uuid();
    if (!ui.held(page, token)) return;
    path = wx.env.USER_DATA_PATH + '/scb-participant-' + random + '.' + suffix;
    if (!materials.trackTemp(wx, path)) throw new Error('无法保护私有临时文件，没有打开。');
    page._temporaryFiles = (page._temporaryFiles || []).concat(path);
    await new Promise((resolve, reject) =>
      wx
        .getFileSystemManager()
        .writeFile({ filePath: path, data: value.data, success: resolve, fail: reject }),
    );
    if (!ui.held(page, token) || !page._visible) {
      materials.releaseTemp(wx, path);
      return;
    }
    if (suffix === 'pdf')
      wx.openDocument({
        filePath: path,
        fileType: 'pdf',
        showMenu: false,
        fail: () => materials.releaseTemp(wx, path),
      });
    else
      wx.previewImage({
        current: path,
        urls: [path],
        showmenu: false,
        fail: () => materials.releaseTemp(wx, path),
      });
  } catch (error) {
    if (path) materials.releaseTemp(wx, path);
    if (ui.held(page, token)) page.setData({ error: ui.message(error) });
  } finally {
    if (ui.held(page, token)) page.setData({ busy: false });
  }
}
function cleanup(page) {
  for (const path of page._temporaryFiles || []) materials.releaseTemp(wx, path);
  page._temporaryFiles = [];
}
module.exports = {
  id,
  item,
  page,
  result,
  request,
  perform,
  recover,
  readPending,
  clearPending,
  unknown,
  labels,
  attachmentBody,
  previewAttachment,
  cleanup,
};

const api = require('./api');
const media = require('./media');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PENDING_KEY = 'scb.c23.materials.pending.v1';
const TEMP_KEY = 'scb.c23.materials.temp.v1';
const TEMP_RETRY_DELAYS = [1000, 5000, 30000];
const retrying = new Set();
const states = {
  DRAFT: '草稿 · 待本人补齐',
  SUBMITTED: '已提交 · 等待独立审核',
  APPROVED: '本人资料审核通过',
  CHANGES_REQUESTED: '已退回 · 请补齐',
  STALE: '版本已变化 · 请重新确认',
};
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => typeof v === 'string';
const nullable = (v) => v === null || str(v);
// Normal views must never bring protected fields into setData via an extra response property.
function redactedOnly(value) {
  if (Array.isArray(value)) return value.every(redactedOnly);
  if (!object(value)) return true;
  return Object.entries(value).every(
    ([key, item]) =>
      ![
        'identityNumber',
        'policyNumber',
        'base64',
        'payload',
        'payloadCiphertext',
        'encryptionKey',
      ].includes(key) && redactedOnly(item),
  );
}

function invalid() {
  throw Object.assign(new Error('本人资料返回不完整，请重新读取'), { code: 'INVALID_RESPONSE' });
}
function id(value) {
  if (!str(value) || !uuid.test(value)) throw new Error('本人资料入口无效，请重新进入');
  return value.toLowerCase();
}
function file(v) {
  return (
    object(v) &&
    str(v.fileName) &&
    ['image/jpeg', 'image/png', 'application/pdf'].includes(v.contentType) &&
    Number.isSafeInteger(v.byteLength) &&
    v.byteLength > 0 &&
    v.byteLength <= media.MAX_FILE_BYTES &&
    /^[0-9a-f]{64}$/.test(v.sha256) &&
    !('base64' in v) &&
    !('url' in v)
  );
}
function material(v) {
  return (
    object(v) &&
    uuid.test(v.memberId) &&
    (v.id === null || uuid.test(v.id)) &&
    str(v.memberName) &&
    (Object.hasOwn(states, v.status) || v.status === 'MISSING') &&
    Number.isSafeInteger(v.version) &&
    v.version >= 0 &&
    nullable(v.realName) &&
    nullable(v.identityMasked) &&
    (v.portrait === null || file(v.portrait)) &&
    (v.insurance === null ||
      (object(v.insurance) &&
        nullable(v.insurance.insurer) &&
        nullable(v.insurance.policyNumberMasked) &&
        nullable(v.insurance.startDate) &&
        nullable(v.insurance.endDate) &&
        (v.insurance.document === null || file(v.insurance.document)))) &&
    typeof v.acceptedTerms === 'boolean' &&
    typeof v.publicityConsent === 'boolean' &&
    nullable(v.reviewReason) &&
    Array.isArray(v.blockers) &&
    v.blockers.every((b) => object(b) && str(b.code) && str(b.message)) &&
    object(v.capabilities) &&
    typeof v.capabilities.canReview === 'boolean' &&
    typeof v.capabilities.canReadPrivate === 'boolean' &&
    !('identityNumber' in v) &&
    !('policyNumber' in v) &&
    !('payload' in v) &&
    redactedOnly(v)
  );
}
function mine(v) {
  return (
    redactedOnly(v) &&
    object(v) &&
    uuid.test(v.entryId) &&
    uuid.test(v.memberId) &&
    str(v.eventName) &&
    str(v.teamName) &&
    str(v.startDate) &&
    str(v.endDate) &&
    object(v.rules) &&
    typeof v.rules.requireInsurance === 'boolean' &&
    str(v.rules.termsVersion) &&
    typeof v.enabled === 'boolean' &&
    typeof v.frozen === 'boolean' &&
    (v.material === null || material(v.material)) &&
    object(v.capabilities) &&
    ['canSave', 'canSubmit', 'canWithdrawPublicity'].every(
      (k) => typeof v.capabilities[k] === 'boolean',
    )
  );
}
function progress(v) {
  return (
    redactedOnly(v) &&
    object(v) &&
    uuid.test(v.entryId) &&
    str(v.eventName) &&
    str(v.teamName) &&
    typeof v.enabled === 'boolean' &&
    typeof v.frozen === 'boolean' &&
    Array.isArray(v.members) &&
    v.members.length <= 60 &&
    v.members.every(material)
  );
}
function view(v) {
  return {
    ...v,
    statusLabel: states[v.status] || '未填写本人资料',
    blockerText: v.blockers.map((b) => b.message).join('；'),
    portraitLabel: v.portrait ? v.portrait.fileName + ' · 已私有保存' : '本人照片待上传（必传）',
    insuranceLabel: v.insurance?.document
      ? v.insurance.document.fileName + ' · 待按实际保障审核'
      : '外部保单待上传',
  };
}
function createRepository(orgId, entryId, client = api.getClient()) {
  const base = '/v1/orgs/' + id(orgId) + '/entries/' + id(entryId) + '/participant-materials';
  const request = async (path, method, body, validate, timeout) => {
    const data = (await client.request(base + path, method, body, false, timeout)).data;
    if (!validate(data)) invalid();
    return data;
  };
  return {
    mine: () => request('/mine', 'GET', undefined, mine),
    progress: () => request('', 'GET', undefined, progress),
    member: (memberId) => request('/' + id(memberId), 'GET', undefined, material),
    save: (body) => request('/mine', 'PUT', body, mine, 120000),
    submit: (expectedVersion) => request('/mine/submit', 'POST', { expectedVersion }, mine),
    withdraw: (expectedVersion) =>
      request('/mine/publicity-withdraw', 'POST', { expectedVersion }, mine),
    receipt: (requestId) => {
      if (!v4.test(requestId || '')) throw new Error('原请求编号无效');
      return request(
        '/mine/receipts/' + requestId,
        'GET',
        undefined,
        (v) =>
          object(v) &&
          v.clientRequestId === requestId &&
          uuid.test(v.revisionId) &&
          typeof v.isCurrent === 'boolean' &&
          Number.isSafeInteger(v.currentVersion),
      );
    },
    private: (memberId) =>
      request(
        '/' + id(memberId) + '/private',
        'GET',
        undefined,
        (v) =>
          object(v) &&
          nullable(v.realName) &&
          nullable(v.identityNumber) &&
          (v.insurance === null || (object(v.insurance) && nullable(v.insurance.policyNumber))) &&
          !('portrait' in v) &&
          !('base64' in v),
      ),
    review: (memberId, body) => request('/' + id(memberId) + '/review', 'POST', body, material),
    download: (memberId, kind) => {
      if (!['portrait', 'insurance'].includes(kind)) throw new Error('私有文件类型无效');
      return client.download(base + '/' + id(memberId) + '/files/' + kind);
    },
  };
}
async function myEntries(client = api.getClient()) {
  const data = (await client.request('/v1/me/participant-entries')).data;
  if (
    !Array.isArray(data) ||
    data.some(
      (v) =>
        !object(v) ||
        !uuid.test(v.orgId) ||
        !uuid.test(v.entryId) ||
        !uuid.test(v.memberId) ||
        !str(v.eventName) ||
        !str(v.teamName) ||
        !str(v.startDate) ||
        !str(v.endDate),
    )
  )
    invalid();
  return data;
}
function validPendingRecord(r) {
  return (
    object(r) &&
    uuid.test(r.userId) &&
    uuid.test(r.orgId) &&
    uuid.test(r.entryId) &&
    v4.test(r.clientRequestId) &&
    Number.isInteger(r.expectedVersion) &&
    r.expectedVersion >= 0 &&
    r.expectedVersion <= 2147483647 &&
    Object.keys(r).length === 5 &&
    Object.keys(r).every((k) =>
      ['userId', 'orgId', 'entryId', 'clientRequestId', 'expectedVersion'].includes(k),
    )
  );
}
function pendingStore(wxApi) {
  const value = wxApi.getStorageSync(PENDING_KEY);
  if (value === undefined || value === null || value === '') return {};
  if (!object(value) || Object.keys(value).length > 20) throw new Error('原请求记录不可读取');
  for (const [slot, r] of Object.entries(value))
    if (!validPendingRecord(r) || slot !== pendingSlot(r.userId, r.orgId, r.entryId))
      throw new Error('原请求记录不完整，请先核对已有记录');
  return value;
}
const pendingSlot = (userId, orgId, entryId) => [id(userId), id(orgId), id(entryId)].join(':');
function readPending(wxApi, userId, orgId, entryId) {
  try {
    return { record: pendingStore(wxApi)[pendingSlot(userId, orgId, entryId)] || null, error: '' };
  } catch {
    return { record: null, error: '无法读取原请求保护记录，已停止新保存；请先修复本机存储。' };
  }
}
function writePending(wxApi, record) {
  if (!validPendingRecord(record)) return false;
  try {
    const current = pendingStore(wxApi),
      slot = pendingSlot(record.userId, record.orgId, record.entryId);
    if (current[slot] || Object.keys(current).length >= 20) return false;
    wxApi.setStorageSync(PENDING_KEY, { ...current, [slot]: record });
    return (
      readPending(wxApi, record.userId, record.orgId, record.entryId).record?.clientRequestId ===
      record.clientRequestId
    );
  } catch {
    return false;
  }
}
function clearPending(wxApi, record) {
  try {
    const current = pendingStore(wxApi),
      slot = pendingSlot(record.userId, record.orgId, record.entryId);
    if (current[slot]?.clientRequestId !== record.clientRequestId) return !current[slot];
    delete current[slot];
    wxApi.setStorageSync(PENDING_KEY, current);
    const check = readPending(wxApi, record.userId, record.orgId, record.entryId);
    return !check.error && check.record === null;
  } catch {
    return false;
  }
}
function selectedFile(raw, kind) {
  if (!raw || typeof (raw.path || raw.tempFilePath) !== 'string') throw new Error('请选择一份文件');
  const path = raw.path || raw.tempFilePath,
    name = String(raw.name || path)
      .split(/[\\/]/)
      .pop();
  let contentType = '';
  if (/\.jpe?g$/i.test(name)) contentType = 'image/jpeg';
  if (/\.png$/i.test(name)) contentType = 'image/png';
  if (kind === 'insurance' && /\.pdf$/i.test(name)) contentType = 'application/pdf';
  if (!contentType || !name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error(kind === 'portrait' ? '本人照片仅支持 JPEG/PNG' : '保单仅支持 JPEG/PNG/PDF');
  if (!Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > media.MAX_FILE_BYTES)
    throw new Error('单份文件须非空且不超过8MiB');
  return { path, name, size: raw.size, contentType };
}
function chooseFile(wxApi, kind) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(Object.assign(new Error('文件选择未完成'), { cancelled: true }));
    if (kind === 'portrait' && typeof wxApi.chooseMedia === 'function') {
      wxApi.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['original'],
        success: (r) => {
          try {
            resolve(selectedFile(r.tempFiles?.[0], kind));
          } catch (e) {
            reject(e);
          }
        },
        fail: cancel,
      });
    } else if (typeof wxApi.chooseMessageFile === 'function') {
      wxApi.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: kind === 'portrait' ? ['jpg', 'jpeg', 'png'] : ['jpg', 'jpeg', 'png', 'pdf'],
        success: (r) => {
          try {
            resolve(selectedFile(r.tempFiles?.[0], kind));
          } catch (e) {
            reject(e);
          }
        },
        fail: cancel,
      });
    } else reject(new Error('当前微信无法选择文件，请更新后重试'));
  });
}
const unknown = (e) => !e || !e.status || e.status >= 500;
function ownTemp(wxApi, path) {
  const prefix = wxApi.env?.USER_DATA_PATH + '/scb-participant-';
  return (
    !!wxApi.env?.USER_DATA_PATH &&
    str(path) &&
    path.startsWith(prefix) &&
    /^[a-z0-9-]+\.(jpg|png|pdf)$/.test(path.slice(prefix.length))
  );
}
function temps(wxApi) {
  const v = wxApi.getStorageSync(TEMP_KEY);
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v) || v.some((p) => !ownTemp(wxApi, p)))
    throw new Error('私有临时文件记录不可读取');
  return v;
}
function trackTemp(wxApi, path) {
  try {
    const current = temps(wxApi);
    if (!ownTemp(wxApi, path)) return false;
    wxApi.setStorageSync(TEMP_KEY, [...new Set([...current, path])]);
    return temps(wxApi).includes(path);
  } catch {
    return false;
  }
}
function releaseTemp(wxApi, path, attempt = 0) {
  if (!ownTemp(wxApi, path) || typeof wxApi.getFileSystemManager !== 'function') return;
  wxApi.getFileSystemManager().unlink({
    filePath: path,
    success: () => {
      try {
        wxApi.setStorageSync(
          TEMP_KEY,
          temps(wxApi).filter((p) => p !== path),
        );
      } catch {}
    },
    fail: (e) => {
      if (/no such file|not exist|ENOENT/i.test(String(e?.errMsg || ''))) {
        try {
          wxApi.setStorageSync(
            TEMP_KEY,
            temps(wxApi).filter((p) => p !== path),
          );
        } catch {}
        return;
      }
      if (attempt >= TEMP_RETRY_DELAYS.length || retrying.has(path)) return;
      retrying.add(path);
      setTimeout(() => {
        retrying.delete(path);
        releaseTemp(wxApi, path, attempt + 1);
      }, TEMP_RETRY_DELAYS[attempt]);
    },
  });
}
function sweepTemps(wxApi) {
  try {
    for (const p of temps(wxApi)) releaseTemp(wxApi, p);
  } catch {}
}
module.exports = {
  PENDING_KEY,
  TEMP_KEY,
  id,
  material,
  mine,
  progress,
  view,
  createRepository,
  myEntries,
  readPending,
  writePending,
  clearPending,
  selectedFile,
  chooseFile,
  readBase64: media.readBase64,
  unknown,
  trackTemp,
  releaseTemp,
  sweepTemps,
};

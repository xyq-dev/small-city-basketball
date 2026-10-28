// Match media files: selection, client-side limit checks and base64 reading for the existing
// JSON upload (C05). The server re-validates type, magic bytes, size and quota; nothing here
// grants visibility — a file is private until a media record is explicitly published.
const MAX_FILE_BYTES = 8388608;
const kinds = {
  image: { purpose: 'MATCH_IMAGE', media: 'IMAGE', label: '图片' },
  video: { purpose: 'MATCH_VIDEO', media: 'VIDEO', label: '视频' },
};
const statusLabels = {
  DRAFT: '草稿 · 未公开',
  PUBLISHED: '已发布 · 公开观赛开启时观众可见',
  REVOKED: '已撤销 · 不再公开',
};
const fileLabels = { ACTIVE: '已私有保存', REVOKED: '已撤销', PURGED: '内容已清除' };
const errorText = {
  VERSION_CONFLICT: '媒体已被其他操作更新，已重新读取，请核对后再操作。',
  INVALID_MEDIA_STATE: '媒体发布状态已变化，已重新读取。',
  MEDIA_SOURCE_STALE:
    '赛果确认已变化，该媒体的时间标记须基于新确认重新建立后才能发布（小程序暂不提供标记编辑）。',
  MEDIA_FILE_LIMIT: '本场或机构文件数量已达上限，请先整理资料。',
  MEDIA_STORAGE_LIMIT: '机构文件额度不足；撤销后须另行清除旧内容才会释放额度。',
  MEDIA_LIMIT: '本场媒体记录已达50条上限。',
  INVALID_EVENT_STATE: '赛事已归档或取消，不能上传或创建媒体。',
  FORBIDDEN: '当前身份没有该操作权限，由服务端核验。',
};
const unknown = (error) =>
  !!error && (error.code === 'NETWORK_ERROR' || error.code === 'SESSION_CHANGED' || !error.status);
function failure(error) {
  if (unknown(error)) return '网络中断，操作结果未知。请先重新读取核对，避免重复操作。';
  return (
    (error && errorText[error.code]) || (error && error.message) || '操作未完成，请重新读取后核对'
  );
}
function size(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function contentType(name, kind) {
  if (kind === 'image' && /\.png$/i.test(name)) return 'image/png';
  if (kind === 'image' && /\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (kind === 'video' && /\.mp4$/i.test(name)) return 'video/mp4';
  return '';
}
/** Validates a chosen temp file before anything is read or sent. */
function describe(file, kind, usage) {
  const spec = kinds[kind];
  if (!spec) throw new Error('不支持的媒体类型');
  if (!file || typeof file.path !== 'string' || !file.path)
    throw new Error('请选择一个' + spec.label + '文件');
  const name = String(file.name || '')
    .split(/[\\/]/)
    .pop()
    .slice(-120);
  const mime = contentType(name, kind);
  if (!name || /[\u0000-\u001f\u007f]/.test(name) || !mime)
    throw new Error(kind === 'image' ? '图片仅支持PNG或JPEG' : '视频仅支持MP4');
  const max = (usage && usage.maxFileBytes) || MAX_FILE_BYTES;
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > max)
    throw new Error('单个文件须非空且不超过' + size(max) + '，当前' + size(file.size));
  if (usage && usage.usedBytes + file.size > usage.limitBytes)
    throw new Error(
      '机构文件额度不足（已用 ' + size(usage.usedBytes) + ' / ' + size(usage.limitBytes) + '）',
    );
  return { path: file.path, name, size: file.size, contentType: mime, purpose: spec.purpose };
}
/** wx.chooseMedia when available (album or camera); chat files as a fallback. */
function choose(wxApi, kind) {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(Object.assign(new Error('未选择文件'), { cancelled: true }));
    if (typeof wxApi.chooseMedia === 'function') {
      wxApi.chooseMedia({
        count: 1,
        mediaType: [kind],
        sourceType: ['album', 'camera'],
        sizeType: ['original'],
        success(r) {
          const f = Array.isArray(r.tempFiles) && r.tempFiles[0];
          if (!f) return cancelled();
          resolve({ path: f.tempFilePath, name: f.tempFilePath, size: f.size });
        },
        fail: cancelled,
      });
      return;
    }
    if (typeof wxApi.chooseMessageFile === 'function') {
      wxApi.chooseMessageFile({
        count: 1,
        type: kind,
        success(r) {
          const f = Array.isArray(r.tempFiles) && r.tempFiles[0];
          if (!f) return cancelled();
          resolve({ path: f.path, name: f.name, size: f.size });
        },
        fail: cancelled,
      });
      return;
    }
    reject(new Error('当前微信无法选择文件，请更新客户端后重试'));
  });
}
function readBase64(wxApi, file) {
  if (typeof wxApi.getFileSystemManager !== 'function')
    return Promise.reject(new Error('当前微信无法读取文件，请更新客户端后重试'));
  return new Promise((resolve, reject) =>
    wxApi.getFileSystemManager().readFile({
      filePath: file.path,
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
          value.length !== Math.ceil(file.size / 3) * 4 ||
          (value.length / 4) * 3 - padding !== file.size ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
        ) {
          reject(new Error('文件编码或大小与所选文件不一致，请重新选择'));
          return;
        }
        resolve(value);
      },
      fail() {
        reject(new Error('文件读取失败，请重新选择'));
      },
    }),
  );
}
// ---- temporary preview files ----
// Every preview file is recorded in device storage before it is written and only forgotten
// once its removal succeeded (or the file is already gone). Failed removals are retried a few
// times from module scope (independent of any Page) and swept again on the next media page
// load or app launch. Only files under USER_DATA_PATH/scb-media- are ever touched.
const TEMP_KEY = 'scb.mediaTemp.v1';
const TEMP_RETRY_DELAYS = [1000, 5000, 30000];
const retrying = new Set();
function tempPrefix(wxApi) {
  return wxApi && wxApi.env && wxApi.env.USER_DATA_PATH
    ? wxApi.env.USER_DATA_PATH + '/scb-media-'
    : '';
}
function ownTemp(wxApi, path) {
  const prefix = tempPrefix(wxApi);
  return (
    !!prefix &&
    typeof path === 'string' &&
    path.startsWith(prefix) &&
    /^[A-Za-z0-9-]+\.(png|jpg|mp4)$/.test(path.slice(prefix.length))
  );
}
/** Tracked paths, or null when storage cannot be read. */
function trackedTemps(wxApi) {
  let value;
  try {
    value = wxApi.getStorageSync(TEMP_KEY);
  } catch {
    return null;
  }
  if (value === '' || value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter((p) => ownTemp(wxApi, p)) : null;
}
function saveTemps(wxApi, list) {
  try {
    wxApi.setStorageSync(TEMP_KEY, list);
    return true;
  } catch {
    return false;
  }
}
/** Records a path before its file is written; false means do not write it. */
function trackTemp(wxApi, path) {
  const list = trackedTemps(wxApi);
  if (!list || !ownTemp(wxApi, path)) return false;
  return list.includes(path) || saveTemps(wxApi, [...list, path]);
}
function forgetTemp(wxApi, path) {
  const list = trackedTemps(wxApi);
  if (list)
    saveTemps(
      wxApi,
      list.filter((p) => p !== path),
    );
}
/** Removes one tracked file; it stays tracked until removal succeeds. */
function releaseTemp(wxApi, path, attempt = 0) {
  if (!ownTemp(wxApi, path) || typeof wxApi.getFileSystemManager !== 'function') return;
  wxApi.getFileSystemManager().unlink({
    filePath: path,
    success: () => forgetTemp(wxApi, path),
    fail: (error) => {
      const message = String((error && error.errMsg) || '');
      if (/no such file|not exist|ENOENT/i.test(message)) return forgetTemp(wxApi, path);
      trackTemp(wxApi, path);
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
  for (const path of trackedTemps(wxApi) || []) releaseTemp(wxApi, path);
}
module.exports = {
  TEMP_RETRY_DELAYS,
  trackTemp,
  releaseTemp,
  sweepTemps,
  MAX_FILE_BYTES,
  kinds,
  statusLabels,
  fileLabels,
  unknown,
  failure,
  size,
  describe,
  choose,
  readBase64,
};

// C19 match media request identity (docs/design/C19_CONTRACTS.md §2). The fingerprint rule is
// the server's (apps/api/src/media-request-domain.ts), checked by the same known vectors in both
// test suites: sha256(JSON.stringify(["v1", operation, ...fields])) over the values the server
// writes. Strings are NFC-normalized and then trimmed; links must already be canonical.
//
// Records: one unresolved request per account + organization + match, stored BEFORE anything is
// sent. A record that cannot be stored means nothing is sent; unresolved records are never
// evicted. Upload staging files (scb-upload-*) are separate from private previews (scb-media-*)
// and have their own registry, so preview cleanup can never remove a file awaiting resumption.
const CHUNK_SIZE = 524288;
const STORE_KEY = 'scb.mediaRequests.v2';
const STAGING_KEY = 'scb.mediaUploadStaging.v1';
const RECORD_LIMIT = 20;
const STORAGE_FAILED =
  '本机存储读写失败，无法可靠记录请求编号，已停止上传和创建草稿。请检查微信存储空间后重新进入本页。';
const RECORD_FULL =
  '本机已有 20 条未完成的媒体请求（可能属于其他比赛或账号），请先到相应比赛完成或结束这些记录。';

// ---------- SHA-256, UTF-8 and base64 (no platform crypto in the mini program) ----------
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
/** Lowercase hex SHA-256 of a Uint8Array. */
function sha256(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const bits = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 4294967296));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + k) >>> 0;
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
function utf8(text) {
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;
/** Canonical base64 to bytes; null when not canonical. */
function fromBase64(text) {
  if (typeof text !== 'string' || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (LOOKUP[text[i]] << 18) |
      (LOOKUP[text[i + 1]] << 12) |
      ((LOOKUP[text[i + 2]] || 0) << 6) |
      (LOOKUP[text[i + 3]] || 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return toBase64(out) === text ? out : null;
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
  }
  return s;
}

// ---------- the shared request rules ----------
function fingerprint(operation, fields) {
  return sha256(utf8(JSON.stringify(['v1', operation].concat(fields))));
}
/** NFC first, then trim — exactly what the new endpoints write. */
function normalizeText(value) {
  const s = String(value == null ? '' : value);
  return (typeof s.normalize === 'function' ? s.normalize('NFC') : s).trim();
}
/**
 * The canonical form the server stores (its URL parser's href) for the links this page accepts:
 * lowercase host, no port/userinfo/fragment, an explicit path, and only characters the parser
 * leaves untouched. Returns '' for anything else (the server refuses non-canonical links too).
 */
function canonicalLink(value) {
  const m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^?#]*)?(\?[^#]*)?$/i.exec(String(value || '').trim());
  if (!m) return '';
  const host = m[1].toLowerCase();
  const path = m[2] || '/';
  const query = m[3] || '';
  if (
    !/^\/[A-Za-z0-9\-._~!$&()*+,;=:@/%]*$/.test(path) ||
    (query && !/^\?[A-Za-z0-9\-._~!$&()*+,;=:@/%?]*$/.test(query)) ||
    /%(?![0-9A-Fa-f]{2})/.test(path + query) ||
    /(^|\/)(\.|%2e){1,2}(\/|$)/i.test(path) ||
    host.startsWith('.') ||
    host.endsWith('.') ||
    host.includes('..')
  )
    return '';
  const href = 'https://' + host + path + query;
  return href.length <= 2048 ? href : '';
}
function fileFields(meta) {
  return [meta.purpose, meta.fileName, meta.contentType, meta.byteLength, meta.contentSha256];
}
function draftFields(body) {
  return [
    body.kind,
    body.title,
    body.fileId === undefined ? null : body.fileId,
    body.externalUrl === undefined ? null : body.externalUrl,
    body.rightsDeclaration,
  ];
}
/** Network loss, an identity change mid-flight or a server-side failure: outcome unknown. */
function unknownOutcome(error) {
  return (
    !!error &&
    (error.code === 'NETWORK_ERROR' ||
      error.code === 'SESSION_CHANGED' ||
      !error.status ||
      error.status >= 500)
  );
}

// ---------- the record store ----------
function readStore(wxApi) {
  let value;
  try {
    value = wxApi.getStorageSync(STORE_KEY);
  } catch {
    return null;
  }
  if (value === '' || value === undefined || value === null) return {};
  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function writeStore(wxApi, map) {
  try {
    wxApi.setStorageSync(STORE_KEY, map);
    return true;
  } catch {
    return false;
  }
}
/** { ok:false } when storage cannot be read; never reported as "no record". */
function recordState(wxApi, key) {
  const map = key ? readStore(wxApi) : null;
  return map ? { ok: true, record: map[key] || null } : { ok: false, record: null };
}
/** Stores (or with null, removes) one record; returns '' or why it could not. */
function saveRecord(wxApi, key, record) {
  const map = key ? readStore(wxApi) : null;
  if (!map) return STORAGE_FAILED;
  const next = Object.assign({}, map);
  if (record) {
    if (!next[key] && Object.keys(next).length >= RECORD_LIMIT) return RECORD_FULL;
    next[key] = record;
  } else delete next[key];
  return writeStore(wxApi, next) ? '' : STORAGE_FAILED;
}

// ---------- upload staging files (separate prefix and registry from previews) ----------
function stagingPrefix(wxApi) {
  return wxApi && wxApi.env && wxApi.env.USER_DATA_PATH
    ? wxApi.env.USER_DATA_PATH + '/scb-upload-'
    : '';
}
function ownStaged(wxApi, path) {
  const prefix = stagingPrefix(wxApi);
  return (
    !!prefix &&
    typeof path === 'string' &&
    path.startsWith(prefix) &&
    /^[0-9a-f-]{36}\.(png|jpg|mp4)$/.test(path.slice(prefix.length))
  );
}
function stagedList(wxApi) {
  let value;
  try {
    value = wxApi.getStorageSync(STAGING_KEY);
  } catch {
    return null;
  }
  if (value === '' || value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter((p) => ownStaged(wxApi, p)) : null;
}
function saveStaged(wxApi, list) {
  try {
    wxApi.setStorageSync(STAGING_KEY, list);
    return true;
  } catch {
    return false;
  }
}
/** Copies the chosen file to a registered staging path; rejects when it cannot be kept. */
function stage(wxApi, source, clientRequestId, contentType) {
  const ext = contentType === 'video/mp4' ? 'mp4' : contentType === 'image/png' ? 'png' : 'jpg';
  const target = stagingPrefix(wxApi) + clientRequestId + '.' + ext;
  const list = stagedList(wxApi);
  const fs = typeof wxApi.getFileSystemManager === 'function' && wxApi.getFileSystemManager();
  if (!list || !ownStaged(wxApi, target) || !fs || typeof fs.copyFile !== 'function')
    return Promise.reject(new Error('本机无法暂存待上传文件，未发送。'));
  if (!list.includes(target) && !saveStaged(wxApi, list.concat(target)))
    return Promise.reject(new Error('本机存储写入失败，无法登记待上传文件，未发送。'));
  return new Promise((resolve, reject) =>
    fs.copyFile({
      srcPath: source,
      destPath: target,
      success: () => resolve(target),
      fail: () => {
        releaseStaged(wxApi, target);
        reject(new Error('暂存待上传文件失败，未发送。'));
      },
    }),
  );
}
/** Removes one staged file; it stays registered until the removal succeeded. */
function releaseStaged(wxApi, path) {
  if (!ownStaged(wxApi, path) || typeof wxApi.getFileSystemManager !== 'function') return;
  const forget = () => {
    const list = stagedList(wxApi);
    if (list)
      saveStaged(
        wxApi,
        list.filter((p) => p !== path),
      );
  };
  wxApi.getFileSystemManager().unlink({
    filePath: path,
    success: forget,
    fail: (error) => {
      if (/no such file|not exist|ENOENT/i.test(String((error && error.errMsg) || ''))) forget();
    },
  });
}
/** Removes staged files that no stored record (of any account) still refers to. */
function sweepStaged(wxApi) {
  const map = readStore(wxApi);
  const list = stagedList(wxApi);
  if (!map || !list) return;
  const used = new Set(
    Object.keys(map)
      .map((k) => map[k] && map[k].path)
      .filter(Boolean),
  );
  for (const path of list) if (!used.has(path)) releaseStaged(wxApi, path);
}

module.exports = {
  CHUNK_SIZE,
  STORE_KEY,
  STAGING_KEY,
  STORAGE_FAILED,
  sha256,
  utf8,
  fromBase64,
  toBase64,
  fingerprint,
  normalizeText,
  canonicalLink,
  fileFields,
  draftFields,
  unknownOutcome,
  recordState,
  saveRecord,
  stage,
  releaseStaged,
  sweepStaged,
  ownStaged,
};

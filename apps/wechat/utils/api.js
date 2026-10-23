// Build-time setting only. Never accept an API origin from a shared URL or QR payload.
const API_ORIGIN = 'https://basketball.playhubs.cn';
const opaque = /^[A-Za-z0-9_-]{43}$/;
function publicId(value) {
  if (typeof value !== 'string' || !opaque.test(value)) throw new Error('观赛链接无效');
  return value;
}
function pathAllowed(path, method) {
  if (typeof path !== 'string' || path.includes('..') || path.includes('#') || path.includes('://'))
    return false;
  if (
    /^\/v1\/auth\/(login|session|logout|wechat\/(capabilities|binding|challenges|login|bind|unbind))$/.test(
      path,
    )
  )
    return true;
  return (
    method === 'GET' &&
    /^\/v1\/public\/events\/[A-Za-z0-9_-]{43}(?:\/(standings|knockout|groups|schedule|matches\/[A-Za-z0-9_-]{43}(?:\/media)?))?(?:\?limit=50(?:&cursor=[A-Za-z0-9_%.-]+)?)?$/.test(
      path,
    )
  );
}
function createClient(wxApi) {
  let cookie = '';
  function request(path, method = 'GET', body) {
    if (!pathAllowed(path, method))
      return Promise.reject({ code: 'INVALID_PATH', message: '请求入口无效' });
    return new Promise((resolve, reject) =>
      wxApi.request({
        url: API_ORIGIN + path,
        method,
        timeout: 8000,
        data: body,
        header: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: API_ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        success(response) {
          const headers = response.header || {};
          const key = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie');
          const records = [
            ...(key ? [String(headers[key])] : []),
            ...(Array.isArray(response.cookies)
              ? response.cookies.filter((v) => typeof v === 'string')
              : []),
          ];
          const tokens = new Set();
          for (const raw of records) {
            const sid = /(?:^|[,;]\s*)scb\.sid=([A-Za-z0-9_-]{43})(?:;|$)/.exec(raw);
            if (sid) tokens.add(sid[1]);
          }
          if (tokens.size === 1) cookie = 'scb.sid=' + [...tokens][0];
          if (tokens.size > 1 || records.some((raw) => /(?:^|[,;]\s*)scb\.sid=(?:;|$)/.test(raw)))
            cookie = '';
          if (response.statusCode === 401) cookie = '';
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = response.data && response.data.error;
            reject({
              code: (error && error.code) || 'HTTP_ERROR',
              status: response.statusCode,
              message: (error && error.message) || '资料暂时不可用',
            });
            return;
          }
          const payload = response.data;
          if (
            !payload ||
            !Object.prototype.hasOwnProperty.call(payload, 'data') ||
            !payload.meta ||
            typeof payload.meta.requestId !== 'string'
          ) {
            reject({ code: 'INVALID_RESPONSE', message: '服务返回格式无效' });
            return;
          }
          resolve(payload);
        },
        fail() {
          reject({
            code: 'NETWORK_ERROR',
            message: '网络连接中断，请恢复连接后刷新；旧资料可能已陈旧。',
          });
        },
      }),
    );
  }
  return {
    request,
    clearSession() {
      cookie = '';
    },
    hasSession() {
      return !!cookie;
    },
  };
}
let instance;
function getClient() {
  if (!instance) instance = createClient(wx);
  return instance;
}
function eventFromInput(value) {
  const input = String(value || '').trim();
  const match = /^https:\/\/basketball\.playhubs\.cn\/watch\/([A-Za-z0-9_-]{43})\/?$/.exec(input);
  return publicId(match ? match[1] : input);
}
async function allSchedule(client, event) {
  let cursor = null;
  let rows = [];
  for (let page = 0; page < 20; page++) {
    const response = await client.request(
      '/v1/public/events/' +
        publicId(event) +
        '/schedule?limit=50' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    if (!Array.isArray(response.data)) throw new Error('赛程资料无效');
    rows = rows.concat(response.data);
    cursor = response.meta.nextCursor;
    if (!cursor) return rows;
  }
  throw new Error('赛程分页超限，请联系主办方');
}
function clockText(snapshot, receivedAt, now = Date.now()) {
  if (!snapshot || !snapshot.clock) return '未准备';
  const c = snapshot.clock;
  let remaining = c.remainingMs;
  if (c.running)
    remaining -= Math.max(
      0,
      Date.parse(snapshot.serverTime) + (now - receivedAt) - Date.parse(c.anchorServerTime),
    );
  const seconds = Math.ceil(Math.max(0, remaining) / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function mediaUrl(path) {
  if (
    typeof path !== 'string' ||
    !/^\/v1\/public\/events\/[A-Za-z0-9_-]{43}\/matches\/[A-Za-z0-9_-]{43}\/media\/[A-Za-z0-9_-]{43}\/content$/.test(
      path,
    )
  )
    throw new Error('媒体地址无效');
  return API_ORIGIN + path;
}
module.exports = {
  API_ORIGIN,
  publicId,
  eventFromInput,
  pathAllowed,
  createClient,
  getClient,
  allSchedule,
  clockText,
  mediaUrl,
};

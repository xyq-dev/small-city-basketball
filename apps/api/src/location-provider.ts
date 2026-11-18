import { createHash } from 'node:crypto';
import type {
  LocalLocationCandidate,
  LocalPoint,
} from '../../../packages/contracts/local-services.js';
import { ApiError } from './errors.js';
import { localPoint } from './local-services-domain.js';

type Transport = typeof fetch;
export type LocationVendor = 'AMAP' | 'TENCENT';
export interface LocationProvider {
  readonly enabled: boolean;
  prepare?(): Promise<void>;
  reverse(point: LocalPoint): Promise<LocalLocationCandidate[]>;
  search(
    keyword: string,
    sourceCode: string,
    point?: LocalPoint,
  ): Promise<LocalLocationCandidate[]>;
}
/** Public civic reference used only when an operator explicitly runs a probe. */
export const LOCATION_PROBE = {
  label: '高州市人民政府（公开参考点）',
  latitude: 21.9182,
  longitude: 110.8533,
  coordinateSystem: 'GCJ02' as const,
  sourceCode: '440981',
  keyword: '篮球场',
};
const unavailable = () =>
  new ApiError(503, 'LOCATION_PROVIDER_UNAVAILABLE', '地图服务暂不可用，请保留手动选城或指定地点');
const disabled = () =>
  new ApiError(503, 'LOCATION_PROVIDER_DISABLED', '地图供应商尚未配置，请使用手动选城');
const timeoutError = () =>
  new ApiError(503, 'LOCATION_PROVIDER_TIMEOUT', '地图服务超时，请稍后重试或手动选城');
const noResult = () =>
  new ApiError(422, 'LOCATION_NO_RESULT', '地图没有返回可用地址，请手动选择城市');
export function locationError(code: string, message: string, status = 503) {
  return new ApiError(status, code, message);
}
function validKey(key: string | undefined): key is string {
  return typeof key === 'string' && key.trim().length > 0;
}
function assertKey(key: string | undefined) {
  if (
    key !== undefined &&
    (key !== key.trim() || key.length > 256 || /[\s\u0000-\u001f]/.test(key))
  )
    throw new Error('Location provider configuration invalid');
}
async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
  return data as Record<string, unknown>;
}
function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text === '[]') return null;
  return text;
}
function adcode(value: unknown): string | null {
  return typeof value === 'string' && /^[1-9]\d{5}$/.test(value) ? value : null;
}
function keywordOk(keyword: string, sourceCode: string) {
  if (
    keyword.trim().length < 1 ||
    Buffer.byteLength(keyword, 'utf8') > 96 ||
    !/^[1-9]\d{5}$/.test(sourceCode)
  )
    throw new ApiError(422, 'VALIDATION_ERROR', '请填写有效地区与地点关键词');
}

/** Fixed official host and paths only. External permission/Key/live calls need separate acceptance. */
export class TencentLocationProvider implements LocationProvider {
  readonly enabled: boolean;
  constructor(
    private readonly key?: string,
    private readonly transport: Transport = fetch,
  ) {
    this.enabled = validKey(key);
    assertKey(key);
  }
  private async request(
    path: '/ws/geocoder/v1/' | '/ws/place/v1/search',
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!this.enabled) throw disabled();
    const url = new URL(path, 'https://apis.map.qq.com');
    for (const [name, value] of Object.entries({ ...params, key: this.key!, output: 'json' }))
      url.searchParams.set(name, value);
    try {
      const response = await this.transport(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      const data = await readJson(response);
      if (data.status !== 0) throw unavailable();
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw timeoutError();
      throw unavailable();
    }
  }
  async reverse(raw: LocalPoint): Promise<LocalLocationCandidate[]> {
    const point = localPoint(raw);
    const data = await this.request('/ws/geocoder/v1/', {
      location: `${point.latitude},${point.longitude}`,
      get_poi: '0',
    });
    const result = data.result as Record<string, any> | undefined;
    if (
      !result ||
      typeof result.address !== 'string' ||
      result.address.length > 500 ||
      !result.ad_info ||
      !adcode(String(result.ad_info.adcode))
    )
      throw unavailable();
    const title = [result.address_component?.city, result.address_component?.district]
      .filter((value) => typeof value === 'string')
      .join(' · ');
    if (!title || title.length > 200) throw unavailable();
    return [
      {
        title,
        address: result.address,
        point,
        sourceCode: String(result.ad_info.adcode),
        source: 'TENCENT',
        kind: 'REVERSE',
      },
    ];
  }
  async search(
    keyword: string,
    sourceCode: string,
    rawPoint?: LocalPoint,
  ): Promise<LocalLocationCandidate[]> {
    keywordOk(keyword, sourceCode);
    const point = rawPoint ? localPoint(rawPoint) : undefined;
    const boundary = point
      ? `region(${sourceCode},0,${point.latitude},${point.longitude})`
      : `region(${sourceCode},0)`;
    const data = await this.request('/ws/place/v1/search', {
      keyword,
      boundary,
      page_size: '20',
      page_index: '1',
    });
    if (!Array.isArray(data.data) || data.data.length > 20) throw unavailable();
    return data.data.map((row: Record<string, any>) => {
      if (
        !row ||
        typeof row.title !== 'string' ||
        !row.title.trim() ||
        row.title.length > 200 ||
        typeof row.address !== 'string' ||
        row.address.length > 500 ||
        !row.location
      )
        throw unavailable();
      return {
        title: row.title,
        address: row.address,
        point: localPoint({
          latitude: row.location.lat,
          longitude: row.location.lng,
          coordinateSystem: 'GCJ02',
        }),
        sourceCode: adcode(row.ad_info?.adcode == null ? '' : String(row.ad_info.adcode)),
        source: 'TENCENT' as const,
        kind: 'PLACE' as const,
      };
    });
  }
}

const AMAP_ORIGIN = 'https://restapi.amap.com';
function amapSignature(params: Record<string, string>, privateKey: string) {
  const plain =
    Object.keys(params)
      .sort()
      .map((name) => `${name}=${params[name]}`)
      .join('&') + privateKey;
  return createHash('md5').update(plain).digest('hex');
}
export function classifyAmapFailure(data: Record<string, unknown>): ApiError | null {
  const status = String(data.status ?? '');
  const info = String(data.info ?? '').toUpperCase();
  const code = String(data.infocode ?? '');
  if (status === '1' && (info === 'OK' || code === '10000')) return null;
  const token = `${info} ${code}`;
  if (/INVALID_USER_KEY|USER_KEY_RECYCLED|\b10001\b|\b10013\b/.test(token))
    return locationError('LOCATION_KEY_INVALID', '高德 Key 无效或已回收');
  if (/INVALID_USER_SCODE|INVALID_USER_SIGNATURE|10007|10008/.test(token))
    return locationError('LOCATION_SIGNATURE_INVALID', '高德数字签名校验失败');
  if (/INVALID_USER_IP|IP_QUERY_OVER_LIMIT|10005|10010/.test(token))
    return locationError(
      'LOCATION_IP_RESTRICTED',
      '高德拒绝了当前服务器 IP，请检查 Key 的 IP 白名单',
    );
  if (
    /DAILY_QUERY_OVER_LIMIT|ACCESS_TOO_FREQUENT|QPS_HAS_EXCEEDED|CUQPS|CKQPS|CQPS|10003|10004|10014|10019|10020|10021|10044/.test(
      token,
    )
  )
    return locationError('LOCATION_QUOTA_EXCEEDED', '高德额度或频率已用尽，未读取剩余额度');
  if (/USERKEY_PLAT_NOMATCH|INSUFFICIENT_PRIVILEGES|10009|10012/.test(token))
    return locationError('LOCATION_PERMISSION_DENIED', '高德 Key 没有 Web 服务权限');
  return unavailable();
}

/** Amap Web service. Requests use longitude,latitude and the published v3/v5 paths only. */
export class AmapLocationProvider implements LocationProvider {
  readonly enabled: boolean;
  constructor(
    private readonly key?: string,
    private readonly privateKey?: string,
    private readonly transport: Transport = fetch,
  ) {
    this.enabled = validKey(key);
    assertKey(key);
    assertKey(privateKey);
  }
  private async request(
    path: '/v3/geocode/regeo' | '/v5/place/text',
    params: Record<string, string>,
  ) {
    if (!this.enabled) throw disabled();
    const query: Record<string, string> = { ...params, key: this.key!, output: 'JSON' };
    if (this.privateKey) query.sig = amapSignature(query, this.privateKey);
    const url = new URL(path, AMAP_ORIGIN);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    try {
      const response = await this.transport(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      const data = await readJson(response);
      const failure = classifyAmapFailure(data);
      if (failure) throw failure;
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw timeoutError();
      throw unavailable();
    }
  }
  async reverse(raw: LocalPoint): Promise<LocalLocationCandidate[]> {
    const point = localPoint(raw);
    const data = await this.request('/v3/geocode/regeo', {
      location: `${point.longitude},${point.latitude}`,
      extensions: 'base',
    });
    const geo = data.regeocode as Record<string, any> | undefined;
    const component = geo?.addressComponent as Record<string, unknown> | undefined;
    const code = adcode(component?.adcode);
    const district = asText(component?.district);
    const city = asText(component?.city);
    const address = asText(geo?.formatted_address);
    const title = district ?? city;
    if (!geo || !code || !address || address.length > 500 || !title || title.length > 200)
      throw noResult();
    return [
      {
        title,
        address,
        point,
        sourceCode: code,
        source: 'AMAP',
        kind: 'REVERSE',
      },
    ];
  }
  async search(
    keyword: string,
    sourceCode: string,
    _point?: LocalPoint,
  ): Promise<LocalLocationCandidate[]> {
    keywordOk(keyword, sourceCode);
    const data = await this.request('/v5/place/text', {
      keywords: keyword,
      region: sourceCode,
      city_limit: 'true',
      page_size: '20',
      page_num: '1',
    });
    const rows = data.pois;
    if (rows == null || (Array.isArray(rows) && rows.length === 0)) return [];
    if (!Array.isArray(rows) || rows.length > 20) throw unavailable();
    return rows.map((row: Record<string, any>) => {
      const location = asText(row?.location)?.split(',');
      const longitude = location ? Number(location[0]) : Number.NaN;
      const latitude = location ? Number(location[1]) : Number.NaN;
      const title = asText(row?.name);
      const address = asText(row?.address) ?? asText(row?.adname) ?? title;
      if (!title || title.length > 200 || !address || address.length > 500) throw unavailable();
      return {
        title,
        address,
        point: localPoint({ latitude, longitude, coordinateSystem: 'GCJ02' }),
        sourceCode: adcode(row?.adcode),
        source: 'AMAP' as const,
        kind: 'PLACE' as const,
      };
    });
  }
}

export class DisabledLocationProvider implements LocationProvider {
  readonly enabled = false;
  async reverse(): Promise<LocalLocationCandidate[]> {
    throw disabled();
  }
  async search(): Promise<LocalLocationCandidate[]> {
    throw disabled();
  }
}

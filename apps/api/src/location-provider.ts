import type {
  LocalLocationCandidate,
  LocalPoint,
} from '../../../packages/contracts/local-services.js';
import { ApiError } from './errors.js';
import { localPoint } from './local-services-domain.js';

type Transport = typeof fetch;
export interface LocationProvider {
  readonly enabled: boolean;
  reverse(point: LocalPoint): Promise<LocalLocationCandidate[]>;
  search(
    keyword: string,
    sourceCode: string,
    point?: LocalPoint,
  ): Promise<LocalLocationCandidate[]>;
}
const fail = () =>
  new ApiError(503, 'LOCATION_PROVIDER_UNAVAILABLE', '地图服务暂不可用，请保留手动选城或指定地点');
/** Fixed official host and paths only. External permission/Key/live calls need separate acceptance. */
export class TencentLocationProvider implements LocationProvider {
  readonly enabled: boolean;
  constructor(
    private readonly key?: string,
    private readonly transport: Transport = fetch,
  ) {
    this.enabled = typeof key === 'string' && key.trim().length > 0;
    if (
      key !== undefined &&
      (key !== key.trim() || key.length > 256 || /[\s\u0000-\u001f]/.test(key))
    )
      throw new Error('Location provider configuration invalid');
  }
  private async request(
    path: '/ws/geocoder/v1/' | '/ws/place/v1/search',
    params: Record<string, string>,
  ): Promise<Record<string, any>> {
    if (!this.enabled)
      throw new ApiError(503, 'LOCATION_PROVIDER_DISABLED', '地图供应商尚未配置，请使用手动选城');
    const url = new URL(path, 'https://apis.map.qq.com');
    for (const [k, v] of Object.entries({ ...params, key: this.key!, output: 'json' }))
      url.searchParams.set(k, v);
    try {
      const response = await this.transport(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok || !response.body) throw fail();
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          bytes += r.value.byteLength;
          if (bytes > 65536) {
            await reader.cancel();
            throw fail();
          }
          chunks.push(r.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
      if (!data || Array.isArray(data) || data.status !== 0) throw fail();
      return data;
    } catch {
      throw fail();
    }
  }
  async reverse(raw: LocalPoint): Promise<LocalLocationCandidate[]> {
    const point = localPoint(raw);
    const data = await this.request('/ws/geocoder/v1/', {
      location: `${point.latitude},${point.longitude}`,
      get_poi: '0',
    });
    const r = data.result;
    if (
      !r ||
      typeof r.address !== 'string' ||
      r.address.length > 500 ||
      !r.ad_info ||
      !/^[1-9]\d{5}$/.test(String(r.ad_info.adcode))
    )
      throw fail();
    const title = [r.address_component?.city, r.address_component?.district]
      .filter((v) => typeof v === 'string')
      .join(' · ');
    if (!title || title.length > 200) throw fail();
    return [
      {
        title,
        address: r.address,
        point,
        sourceCode: String(r.ad_info.adcode),
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
    if (
      keyword.trim().length < 1 ||
      Buffer.byteLength(keyword, 'utf8') > 96 ||
      !/^[1-9]\d{5}$/.test(sourceCode)
    )
      throw new ApiError(422, 'VALIDATION_ERROR', '请填写有效地区与地点关键词');
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
    if (!Array.isArray(data.data) || data.data.length > 20) throw fail();
    return data.data.map((r: Record<string, any>) => {
      if (
        !r ||
        typeof r.title !== 'string' ||
        !r.title.trim() ||
        r.title.length > 200 ||
        typeof r.address !== 'string' ||
        r.address.length > 500 ||
        !r.location
      )
        throw fail();
      const point = localPoint({
        latitude: r.location.lat,
        longitude: r.location.lng,
        coordinateSystem: 'GCJ02',
      });
      return {
        title: r.title,
        address: r.address,
        point,
        sourceCode:
          r.ad_info?.adcode && /^[1-9]\d{5}$/.test(String(r.ad_info.adcode))
            ? String(r.ad_info.adcode)
            : null,
        source: 'TENCENT' as const,
        kind: 'PLACE' as const,
      };
    });
  }
}

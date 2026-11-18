import { describe, expect, test, vi } from 'vitest';
import { AmapLocationProvider, TencentLocationProvider } from './location-provider.js';
const point = { latitude: 22.9, longitude: 110.8, coordinateSystem: 'GCJ02' as const };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
describe('X12 bounded fixed-host location adapter (synthetic transport only)', () => {
  test('no configured key fails closed without calling external network', async () => {
    const transport = vi.fn();
    const adapter = new TencentLocationProvider(undefined, transport);
    expect(adapter.enabled).toBe(false);
    await expect(adapter.reverse(point)).rejects.toMatchObject({
      code: 'LOCATION_PROVIDER_DISABLED',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  test('reverse geocoder returns a candidate, never changes saved browse region', async () => {
    const transport = vi.fn(async () =>
      response({
        status: 0,
        result: {
          address: '合成测试地址',
          address_component: { city: '合成市', district: '合成区' },
          ad_info: { adcode: '440981' },
        },
      }),
    );
    const rows = await new TencentLocationProvider('synthetic-key', transport).reverse(point);
    const [url, init] = transport.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).origin).toBe('https://apis.map.qq.com');
    expect(new URL(url).pathname).toBe('/ws/geocoder/v1/');
    expect(init.redirect).toBe('error');
    expect(rows[0]).toMatchObject({ sourceCode: '440981', point, kind: 'REVERSE' });
  });
  test('malformed/rate-limited/oversized provider responses expose no URL/key', async () => {
    for (const body of [
      { status: 347 },
      { status: 0, result: {} },
      { status: 0, result: { address: 'a'.repeat(70000) } },
    ]) {
      const adapter = new TencentLocationProvider(
        'synthetic-private-key',
        vi.fn(async () => response(body)),
      );
      await expect(adapter.reverse(point)).rejects.toMatchObject({
        code: 'LOCATION_PROVIDER_UNAVAILABLE',
      });
      try {
        await adapter.reverse(point);
      } catch (error) {
        expect(String(error)).not.toContain('synthetic-private-key');
        expect(String(error)).not.toContain('apis.map');
      }
    }
  });
  test('POI search keeps its selected administrative boundary even with an explicit origin', async () => {
    const transport = vi.fn(async () => response({ status: 0, data: [] }));
    const adapter = new TencentLocationProvider('synthetic-key', transport);
    await adapter.search('合成球场', '440981', point);
    const [url] = transport.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('boundary')).toBe('region(440981,0,22.9,110.8)');
    await expect(adapter.search('合成'.repeat(20), '440981')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('POI remains map evidence rather than inventory or a guaranteed order', async () => {
    const adapter = new TencentLocationProvider(
      'synthetic-key',
      vi.fn(async () =>
        response({
          status: 0,
          data: [{ title: '地图地点', address: '合成地址', location: { lat: 22.9, lng: 110.8 } }],
        }),
      ),
    );
    const result = await adapter.search('球场', '440981');
    expect(result[0]).toEqual({
      title: '地图地点',
      address: '合成地址',
      point,
      sourceCode: null,
      source: 'TENCENT',
      kind: 'PLACE',
    });
    expect(result[0]).not.toHaveProperty('available');
  });
});

describe('AMap adapter (synthetic transport only)', () => {
  const gaozhou = { latitude: 21.9182, longitude: 110.8533, coordinateSystem: 'GCJ02' as const };
  test('reverse uses longitude,latitude and keeps 高州 adcode', async () => {
    const transport = vi.fn(async () =>
      response({
        status: '1',
        info: 'OK',
        regeocode: {
          formatted_address: '高州市人民政府',
          addressComponent: { city: '茂名市', district: '高州市', adcode: '440981' },
        },
      }),
    );
    const rows = await new AmapLocationProvider('synthetic-amap', undefined, transport).reverse(
      gaozhou,
    );
    const url = new URL((transport.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin).toBe('https://restapi.amap.com');
    expect(url.pathname).toBe('/v3/geocode/regeo');
    expect(url.searchParams.get('location')).toBe('110.8533,21.9182');
    expect(url.searchParams.get('types')).toBeNull();
    expect(rows[0]).toMatchObject({
      title: '高州市',
      sourceCode: '440981',
      source: 'AMAP',
      point: gaozhou,
    });
    expect(rows[0]?.sourceCode).not.toBe('440900');
  });
  test('municipality empty city array does not replace the district title', async () => {
    const transport = vi.fn(async () =>
      response({
        status: '1',
        info: 'OK',
        regeocode: {
          formatted_address: '合成地址',
          addressComponent: { city: [], district: '高州市', adcode: '440981' },
        },
      }),
    );
    const rows = await new AmapLocationProvider('synthetic-amap', undefined, transport).reverse(
      gaozhou,
    );
    expect(rows[0]?.title).toBe('高州市');
  });
  test('place search omits types and does not mark a court bookable', async () => {
    const transport = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname.endsWith('/regeo'))
        return response({ status: '1', info: 'OK', regeocode: {} });
      return response({
        status: '1',
        info: 'OK',
        pois: [
          {
            name: '高州篮球场',
            address: '公开参考地址',
            location: '110.8500,21.9200',
            adcode: '440981',
          },
        ],
      });
    });
    const rows = await new AmapLocationProvider('synthetic-amap', undefined, transport).search(
      '篮球场',
      '440981',
      gaozhou,
    );
    const url = new URL((transport.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe('/v5/place/text');
    expect(url.searchParams.get('types')).toBeNull();
    expect(url.searchParams.get('region')).toBe('440981');
    expect(url.searchParams.get('location')).toBeNull();
    expect(rows[0]).toMatchObject({
      title: '高州篮球场',
      source: 'AMAP',
      sourceCode: '440981',
      point: { latitude: 21.92, longitude: 110.85, coordinateSystem: 'GCJ02' },
    });
    expect(rows[0]).not.toHaveProperty('available');
  });
  test('empty pois is a successful no-result', async () => {
    const transport = vi.fn(async () =>
      response({ status: '1', info: 'OK', count: '0', pois: [] }),
    );
    await expect(
      new AmapLocationProvider('synthetic-amap', undefined, transport).search('篮球场', '440981'),
    ).resolves.toEqual([]);
  });
  test.each([
    ['INVALID_USER_KEY', 'LOCATION_KEY_INVALID'],
    ['INVALID_USER_SIGNATURE', 'LOCATION_SIGNATURE_INVALID'],
    ['INVALID_USER_IP', 'LOCATION_IP_RESTRICTED'],
    ['DAILY_QUERY_OVER_LIMIT', 'LOCATION_QUOTA_EXCEEDED'],
    ['USERKEY_PLAT_NOMATCH', 'LOCATION_PERMISSION_DENIED'],
  ])('maps %s to %s without exposing the key', async (info, code) => {
    const transport = vi.fn(async () => response({ status: '0', info, infocode: '0' }));
    await expect(
      new AmapLocationProvider('synthetic-amap-secret', undefined, transport).reverse(gaozhou),
    ).rejects.toMatchObject({ code });
    await expect(
      new AmapLocationProvider('synthetic-amap-secret', undefined, transport).reverse(gaozhou),
    ).rejects.not.toThrow(/synthetic-amap-secret|restapi\.amap\.com/);
  });
  test('timeout and missing address stay explicit', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'TimeoutError');
    });
    await expect(
      new AmapLocationProvider('synthetic-amap', undefined, timeout).reverse(gaozhou),
    ).rejects.toMatchObject({ code: 'LOCATION_PROVIDER_TIMEOUT' });
    const empty = vi.fn(async () =>
      response({ status: '1', info: 'OK', regeocode: { addressComponent: { city: [] } } }),
    );
    await expect(
      new AmapLocationProvider('synthetic-amap', undefined, empty).reverse(gaozhou),
    ).rejects.toMatchObject({ code: 'LOCATION_NO_RESULT' });
  });
  test('signature is attached only when a private key is configured', async () => {
    const transport = vi.fn(async () =>
      response({
        status: '1',
        info: 'OK',
        regeocode: {
          formatted_address: '高州市人民政府',
          addressComponent: { district: '高州市', adcode: '440981' },
        },
      }),
    );
    await new AmapLocationProvider('synthetic-amap', 'synthetic-private', transport).reverse(
      gaozhou,
    );
    const url = new URL((transport.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('sig')).toMatch(/^[a-f0-9]{32}$/);
    expect(url.searchParams.get('key')).toBe('synthetic-amap');
  });
});

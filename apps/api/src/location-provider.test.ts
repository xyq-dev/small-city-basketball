import { describe, expect, test, vi } from 'vitest';
import { TencentLocationProvider } from './location-provider.js';
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

import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { readTradeRuntime } from './trade-runtime.js';
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const org = '10000000-0000-4000-8000-000000000001',
  user = '20000000-0000-4000-8000-000000000001';
function row(extra = {}) {
  return {
    orgId: org,
    key: 'synthetic-generation1',
    merchantId: '1900000101',
    appId: 'wx1234567890abcdef',
    displayName: '合成收款方',
    serialNo: 'SYNTHETIC_SERIAL',
    privateKeySecret: 'SCB_TRADE_SYNTHETIC_PRIVATE_KEY',
    apiV3KeySecret: 'SCB_TRADE_SYNTHETIC_V3_KEY',
    platformKeysSecret: 'SCB_TRADE_SYNTHETIC_PLATFORM_KEYS',
    receivers: { [user]: { merchantId: '1900000102', displayName: '合成服务方' } },
    ...extra,
  };
}
function configure(rows = [row()], historical: unknown[] = []) {
  vi.stubEnv('SCB_TRADE_ENABLED', 'true');
  vi.stubEnv('SCB_TRADE_DATA_KEY', Buffer.alloc(32, 9).toString('base64'));
  vi.stubEnv('SCB_TRADE_MERCHANTS_JSON', JSON.stringify({ merchants: rows, historical }));
  vi.stubEnv(
    'SCB_TRADE_SYNTHETIC_PRIVATE_KEY',
    rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  );
  vi.stubEnv('SCB_TRADE_SYNTHETIC_V3_KEY', '0123456789abcdef0123456789abcdef');
  vi.stubEnv(
    'SCB_TRADE_SYNTHETIC_PLATFORM_KEYS',
    JSON.stringify({ SYNTHETIC: rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString() }),
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('trade runtime explicit source-bound merchant configuration', () => {
  it('defaults closed and does not load arbitrary secret configuration or call the network', () => {
    vi.stubEnv('SCB_TRADE_ENABLED', 'false');
    vi.stubEnv('SCB_TRADE_DATA_KEY_FILE', 'nonexistent');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(readTradeRuntime('http://127.0.0.1:5173')).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('builds pinned current and historical mappings without network; JSAPI/splits/player charging are opt-in', () => {
    configure([row()], [row({ key: 'synthetic-generation0' })]);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const r = readTradeRuntime('https://basketball.example.test');
    expect(r.encryptionKey).toHaveLength(32);
    expect(r.merchants?.[org]).toMatchObject({
      merchantId: '1900000101',
      appId: 'wx1234567890abcdef',
      playerFeesEnabled: false,
    });
    expect(r.merchants?.[org]?.payments.jsapi).toBeUndefined();
    expect(r.merchants?.[org]?.settlements?.returnSupported).toBe(false);
    expect(r.historicalMerchants?.[org + ':synthetic-generation0']).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects key reuse or merchant mapping to another organization', () => {
    configure([row(), row({ orgId: user })]);
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow(
      'Trade configuration',
    );
    configure([row(), row({ orgId: user, key: 'second' })]);
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
  });
  it('requires canonical origin, dedicated AES key and server secret references', () => {
    configure();
    expect(() => readTradeRuntime('http://basketball.example.test')).toThrow();
    expect(() => readTradeRuntime('https://basketball.example.test/path')).toThrow();
    vi.stubEnv(
      'SCB_TRADE_DATA_KEY',
      Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
    );
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
    configure([row({ privateKeySecret: 'WECHAT_PAY_PRIVATE_KEY' })]);
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
  });
  it('rejects hidden client-supplied config fields and redacts secret contents', () => {
    configure([
      row({ notifyUrl: 'https://attacker.example.test', privateKey: 'PRIVATE_SENTINEL' }),
    ]);
    try {
      readTradeRuntime('https://basketball.example.test');
      throw Error('expected error');
    } catch (e) {
      expect(String(e)).toBe('Error: Trade configuration is incomplete or invalid');
      expect(String(e)).not.toContain('PRIVATE_SENTINEL');
    }
  });
  it('rejects self-payee and explicitly nonboolean enablement', () => {
    configure([row({ receivers: { [user]: { merchantId: '1900000101', displayName: 'self' } } })]);
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
    configure([row({ returnsEnabled: 'true' })]);
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
  });
});

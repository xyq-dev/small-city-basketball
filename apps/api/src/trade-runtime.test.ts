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

const finance = 'abcdef00-0000-4000-8000-000000000002',
  receiverOrg = '30000000-0000-4000-8000-000000000003',
  otherOrg = '40000000-0000-4000-8000-000000000004';
const receiver = (extra = {}) => ({
  merchantId: '1900000103',
  displayName: '合成受益机构',
  authorizationVersion: 'synthetic-authorization-1',
  expiresAt: '2099-01-01T00:00:00Z',
  returnsEnabled: true,
  ...extra,
});
const sponsor = (extra = {}) => ({
  maximumSplitBps: 3000,
  financeActorIds: [user, finance],
  receivers: { [receiverOrg]: receiver() },
  ...extra,
});
describe('sponsor runtime shares the existing merchant keys with explicit rollout', () => {
  it('keeps the old shape without a sponsor mapping and never loads keys while both gates are off', () => {
    configure();
    vi.stubEnv('SCB_R6_SPONSOR_ENABLED', 'false');
    expect(readTradeRuntime('https://basketball.example.test')).not.toHaveProperty(
      'sponsorCommerce',
    );
    vi.stubEnv('SCB_TRADE_ENABLED', 'false');
    vi.stubEnv('SCB_TRADE_DATA_KEY', undefined);
    vi.stubEnv('SCB_TRADE_DATA_KEY_FILE', 'nonexistent');
    vi.stubEnv('SCB_TRADE_MERCHANTS_JSON', 'not json');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(readTradeRuntime('http://localhost')).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('assembles pinned multi-provider clients without network and leaves advance funding unavailable', () => {
    configure(
      [row({ sponsor: sponsor(), returnsEnabled: true })],
      [row({ key: 'old', sponsor: sponsor(), returnsEnabled: true })],
    );
    vi.stubEnv('SCB_R6_SPONSOR_ENABLED', 'true');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const r = readTradeRuntime('https://basketball.example.test'),
      s = r.sponsorCommerce!;
    expect(s.enabled).toBe(true);
    expect(s.merchants?.[org]).toMatchObject({
      key: r.merchants![org]!.key,
      merchantId: r.merchants![org]!.merchantId,
      appId: r.merchants![org]!.appId,
      displayName: r.merchants![org]!.displayName,
      maximumSplitBps: 3000,
      financeActorIds: [user, finance],
      receivers: { [receiverOrg]: { ...receiver(), expiresAt: '2099-01-01T00:00:00.000Z' } },
      provider: { enabled: true, returnSupported: true },
    });
    expect(s.historicalMerchants?.[org + ':old']).toMatchObject({
      key: 'old',
      provider: { enabled: true, returnSupported: true },
    });
    expect(s.reserveAdvanceCoverage).toBeUndefined();
    expect(s.merchants![org]!.ownFundsRefundSupported).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('turns off only new sponsor work and preserves current and historical maintenance clients', () => {
    configure(
      [row({ sponsor: sponsor(), returnsEnabled: true })],
      [
        row({
          key: 'old',
          sponsor: sponsor({
            receivers: { [receiverOrg]: receiver({ expiresAt: '2000-01-01T00:00:00Z' }) },
          }),
          returnsEnabled: true,
        }),
      ],
    );
    vi.stubEnv('SCB_R6_SPONSOR_ENABLED', undefined);
    const r = readTradeRuntime('https://basketball.example.test');
    expect(r.sponsorCommerce!.enabled).toBe(false);
    expect(r.sponsorCommerce!.merchants![org]!.provider).toMatchObject({
      enabled: true,
      returnSupported: true,
    });
    expect(r.sponsorCommerce!.historicalMerchants![org + ':old']!.provider).toMatchObject({
      enabled: true,
      returnSupported: true,
    });
    configure([row({ sponsor: sponsor() })]);
    expect(
      readTradeRuntime('https://basketball.example.test').sponsorCommerce!.merchants![org]!
        .provider!.returnSupported,
    ).toBe(false);
  });
  it('rejects enabled sponsorship without current trade/sponsor mapping and rejects malformed gates', () => {
    vi.stubEnv('SCB_TRADE_ENABLED', 'false');
    vi.stubEnv('SCB_R6_SPONSOR_ENABLED', 'true');
    vi.stubEnv('SCB_TRADE_DATA_KEY_FILE', 'nonexistent');
    expect(() => readTradeRuntime('http://localhost')).toThrow('Trade configuration');
    vi.stubEnv('SCB_TRADE_DATA_KEY_FILE', undefined);
    configure();
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
    configure([], [row({ sponsor: sponsor(), key: 'old' })]);
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
    vi.stubEnv('SCB_R6_SPONSOR_ENABLED', 'TRUE');
    vi.stubEnv('SCB_TRADE_ENABLED', 'false');
    expect(() => readTradeRuntime('http://localhost')).toThrow();
  });
  it.each([
    { endpoint: 'https://untrusted.example' },
    { reserveAdvanceCoverage: true },
    { ownFundsRefundSupported: true },
    { maximumSplitBps: -1 },
    { maximumSplitBps: 10001 },
    { maximumSplitBps: 0.5 },
    { maximumSplitBps: '3000' },
    { financeActorIds: [] },
    { financeActorIds: [user] },
    { financeActorIds: [finance, finance.toUpperCase()] },
    { financeActorIds: ['not-a-uuid', user] },
    {
      financeActorIds: Array.from(
        { length: 101 },
        (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    },
    { receivers: Array(1) },
    { receivers: { [org]: receiver() } },
    { receivers: { [receiverOrg]: receiver({ merchantId: '1900000101' }) } },
    { receivers: { [receiverOrg]: receiver(), [otherOrg]: receiver() } },
    {
      receivers: {
        [finance]: receiver(),
        [finance.toUpperCase()]: receiver({ merchantId: '1900000104' }),
      },
    },
    { receivers: { [receiverOrg]: receiver({ returnsEnabled: 'true' }) } },
    { receivers: { [receiverOrg]: receiver({ endpoint: 'https://untrusted.example' }) } },
    { receivers: { [receiverOrg]: receiver({ expiresAt: '2099-02-31T00:00:00Z' }) } },
    { receivers: { [receiverOrg]: receiver({ expiresAt: '2099-01-01' }) } },
    { receivers: { [receiverOrg]: receiver({ authorizationVersion: '' }) } },
    {
      receivers: Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [
          `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          receiver({ merchantId: String(1900010000 + i) }),
        ]),
      ),
    },
    { encryptionSerial: 'MISSING' },
  ])('rejects malformed or unauthorized sponsor configuration %#', (bad) => {
    configure([row({ sponsor: sponsor(bad) })]);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow(
      'Trade configuration is incomplete or invalid',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts a zero external split cap but requires an explicit encryption pin when keys rotate', () => {
    configure([row({ sponsor: sponsor({ maximumSplitBps: 0, receivers: {} }) })]);
    const pem = rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    vi.stubEnv(
      'SCB_TRADE_SYNTHETIC_PLATFORM_KEYS',
      JSON.stringify({ SYNTHETIC: pem, ROTATED_KEY: pem }),
    );
    expect(() => readTradeRuntime('https://basketball.example.test')).toThrow();
    configure([
      row({
        sponsor: sponsor({ maximumSplitBps: 0, receivers: {}, encryptionSerial: 'ROTATED_KEY' }),
      }),
    ]);
    vi.stubEnv(
      'SCB_TRADE_SYNTHETIC_PLATFORM_KEYS',
      JSON.stringify({ SYNTHETIC: pem, ROTATED_KEY: pem }),
    );
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(
      readTradeRuntime('https://basketball.example.test').sponsorCommerce!.merchants![org]!
        .maximumSplitBps,
    ).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

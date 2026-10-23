import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCommerceMode, readWechatPayConfig } from './commerce-runtime.js';
import { WechatPayClient } from './commerce/wechatpay.js';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
function configured() {
  for (const [name, value] of Object.entries({
    WECHAT_PAY_ENABLED: 'true',
    WECHAT_PAY_APP_ID: 'wx1234567890abcdef',
    WECHAT_PAY_MERCHANT_ID: '1234567890',
    WECHAT_PAY_MERCHANT_SERIAL: 'SYNTHETIC_SERIAL',
    WECHAT_PAY_PRIVATE_KEY: privateKey,
    WECHAT_PAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
    WECHAT_PAY_PLATFORM_KEYS: JSON.stringify({ PUB_KEY_ID_SYNTHETIC: publicKey }),
    WECHAT_PAY_NOTIFY_URL: 'https://basketball.example.test/v1/payments/wechat/notifications',
  }))
    vi.stubEnv(name, value);
}
afterEach(() => vi.unstubAllEnvs());
describe('commercial provider runtime boundaries', () => {
  it('stays disabled without opening configured secret paths', () => {
    vi.stubEnv('COMMERCE_MODE', undefined);
    vi.stubEnv('WECHAT_PAY_ENABLED', undefined);
    vi.stubEnv('WECHAT_PAY_PRIVATE_KEY_FILE', '/unavailable-private-marker');
    expect(readCommerceMode()).toBe('OFF');
    expect(readWechatPayConfig('')).toEqual({ enabled: false });
  });
  it('rejects misspelled billing modes and non-boolean enable switches', () => {
    for (const value of ['enforced', 'ON', 'ENFORCED ', '']) {
      vi.stubEnv('COMMERCE_MODE', value);
      expect(() => readCommerceMode()).toThrow('COMMERCE_MODE');
    }
    for (const value of ['yes', '1', 'TRUE']) {
      vi.stubEnv('WECHAT_PAY_ENABLED', value);
      expect(() => readWechatPayConfig('')).toThrow('true or false');
    }
  });
  it('loads a complete synthetic pinned-key configuration without sending a provider request', () => {
    configured();
    const transport = vi.fn();
    const configuration = readWechatPayConfig('https://basketball.example.test');
    expect(new WechatPayClient(configuration, { fetch: transport }).enabled).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires the exact canonical notification origin and route', () => {
    configured();
    for (const value of [
      'https://foreign.example.test/v1/payments/wechat/notifications',
      'https://basketball.example.test/other',
      'https://basketball.example.test/v1/payments/wechat/notifications?token=private-marker',
      'http://basketball.example.test/v1/payments/wechat/notifications',
    ]) {
      vi.stubEnv('WECHAT_PAY_NOTIFY_URL', value);
      expect(() => readWechatPayConfig('https://basketball.example.test')).toThrow(
        'incomplete or invalid',
      );
    }
  });
  it('does not expose paths or credential contents when enabled configuration fails', () => {
    configured();
    vi.stubEnv('WECHAT_PAY_PLATFORM_KEYS', 'private-marker');
    try {
      readWechatPayConfig('https://basketball.example.test');
      throw new Error('expected');
    } catch (error) {
      expect(String(error)).not.toContain('private-marker');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});

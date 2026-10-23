import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OfficialWechatExchange,
  readWechatConfiguration,
  validateWechatConfiguration,
} from './wechat-provider.js';
const configuration = {
  enabled: true,
  appId: 'wx0000000000000001',
  appSecret: 'SYNTHETIC_WECHAT_SECRET_2026',
};
afterEach(() => vi.unstubAllEnvs());
describe('official WeChat code2session transport', () => {
  it('is disabled by default and fails closed on partial credentials', () => {
    vi.stubEnv('WECHAT_MINI_LOGIN_ENABLED', undefined);
    vi.stubEnv('WECHAT_MINI_APP_ID', undefined);
    expect(readWechatConfiguration()).toEqual({ enabled: false, appId: undefined });
    expect(() =>
      validateWechatConfiguration({ enabled: true, appId: configuration.appId }),
    ).toThrow('Incomplete');
    expect(() =>
      validateWechatConfiguration({ ...configuration, appId: 'https://attacker.test' }),
    ).toThrow('Invalid');
  });
  it('uses only the official HTTPS endpoint, no redirect, bounded timeout, and discards session_key/unionid', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          openid: 'synthetic_openid',
          session_key: 'PRIVATE_PROVIDER_KEY',
          unionid: 'MUST_NOT_MERGE',
        }),
      ),
    );
    const result = await new OfficialWechatExchange(configuration, fetcher).exchange(
      'SYNTHETIC_CODE',
    );
    expect(result).toEqual({ appId: configuration.appId, openid: 'synthetic_openid' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).origin).toBe('https://api.weixin.qq.com');
    expect(new URL(String(url)).pathname).toBe('/sns/jscode2session');
    expect(init).toMatchObject({ redirect: 'error', method: 'GET' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    new Response(JSON.stringify({ errcode: 40029, errmsg: 'PRIVATE_DETAILS' })),
    new Response('not-json'),
    new Response(JSON.stringify({ openid: 'x' })),
    new Response('x'.repeat(9000)),
    new Response('PRIVATE_RESPONSE', { status: 503 }),
  ])('never reflects provider payloads or credentials on invalid replies', async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    try {
      await new OfficialWechatExchange(configuration, fetcher).exchange('PRIVATE_CODE');
      throw new Error('expected failure');
    } catch (error) {
      expect(String(error)).not.toMatch(/PRIVATE|SYNTHETIC_WECHAT_SECRET|api.weixin/);
      expect(error).toHaveProperty('status');
    }
  });
  it('does not log or expose errors with credential-bearing request URLs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error('https://api.weixin.qq.com?secret=PRIVATE_SECRET&js_code=PRIVATE_CODE'),
      );
    await expect(
      new OfficialWechatExchange(configuration, fetcher).exchange('PRIVATE_CODE'),
    ).rejects.toMatchObject({ status: 503, code: 'WECHAT_UNAVAILABLE' });
    const disabled = new OfficialWechatExchange({ enabled: false }, fetcher);
    await expect(disabled.exchange('code')).rejects.toMatchObject({ code: 'WECHAT_DISABLED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

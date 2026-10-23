import { ApiError } from './errors.js';
import { readRequiredSecret } from './env.js';

export interface WechatConfiguration {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
}
export interface WechatExchange {
  exchange(code: string): Promise<{ appId: string; openid: string }>;
}
const unavailable = () =>
  new ApiError(503, 'WECHAT_UNAVAILABLE', '微信认证暂时不可用，请重新发起登录');
export function validateWechatConfiguration(value: WechatConfiguration): WechatConfiguration {
  if (!value || typeof value.enabled !== 'boolean') throw new Error('Invalid WeChat configuration');
  if (value.appId !== undefined && !/^wx[a-fA-F0-9]{16}$/.test(value.appId))
    throw new Error('Invalid WeChat configuration');
  if (
    value.enabled &&
    (!value.appId ||
      typeof value.appSecret !== 'string' ||
      !/^[A-Za-z0-9_-]{16,256}$/.test(value.appSecret))
  )
    throw new Error('Incomplete WeChat configuration');
  return {
    enabled: value.enabled,
    appId: value.appId,
    ...(value.enabled ? { appSecret: value.appSecret } : {}),
  };
}
export function readWechatConfiguration(): WechatConfiguration {
  const enabled = process.env.WECHAT_MINI_LOGIN_ENABLED;
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false')
    throw new Error('Invalid WeChat configuration');
  return validateWechatConfiguration({
    enabled: enabled === 'true',
    appId: process.env.WECHAT_MINI_APP_ID,
    ...(enabled === 'true' ? { appSecret: readRequiredSecret('WECHAT_MINI_APP_SECRET') } : {}),
  });
}
/** This transport never accepts a caller-controlled URL and never returns session_key. */
export class OfficialWechatExchange implements WechatExchange {
  readonly configuration: WechatConfiguration;
  constructor(
    configuration: WechatConfiguration,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {
    this.configuration = validateWechatConfiguration(configuration);
  }
  async exchange(code: string) {
    if (!this.configuration.enabled)
      throw new ApiError(503, 'WECHAT_DISABLED', '微信登录尚未配置启用');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', this.configuration.appId!);
    url.searchParams.set('secret', this.configuration.appSecret!);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    let response: Response;
    let raw = '';
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 8192) {
            await reader.cancel();
            throw unavailable();
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
      if (data.errcode !== undefined && data.errcode !== 0)
        throw new ApiError(401, 'WECHAT_CODE_REJECTED', '微信凭据已失效，请重新发起登录');
      if (
        typeof data.openid !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(data.openid) ||
        typeof data.session_key !== 'string' ||
        !data.session_key ||
        data.session_key.length > 256
      )
        throw unavailable();
      return { appId: this.configuration.appId!, openid: data.openid };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'WECHAT_CODE_REJECTED') throw error;
      // Never attach the request URL, provider response, network error or credentials.
      throw unavailable();
    }
  }
}

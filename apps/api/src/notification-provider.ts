import { NOTIFICATION_PAGE } from './notification-domain.js';
export interface WechatNotificationEnvelope {
  openid: string;
  templateId: string;
  data: Record<string, { value: string }>;
}
export type WechatNotificationResult =
  | { state: 'ACCEPTED' }
  | { state: 'RETRYABLE'; reason: 'TOKEN_UNAVAILABLE' | 'TOKEN_REJECTED' }
  | { state: 'REJECTED'; reason: 'NO_PERMISSION' | 'INVALID_TEMPLATE' | 'PROVIDER_REJECTED' }
  | { state: 'UNKNOWN' };
export interface WechatNotificationProvider {
  send(message: WechatNotificationEnvelope): Promise<WechatNotificationResult>;
}
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('Invalid notification provider response');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.length;
      if (count > 16384) {
        await reader.cancel();
        throw new Error('Invalid notification provider response');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid notification provider response');
  return parsed as Record<string, unknown>;
}
/** Official host only; credentials/provider errors are never returned or logged. */
export class OfficialWechatNotificationProvider implements WechatNotificationProvider {
  private token?: { value: string; until: number };
  constructor(
    private readonly configuration: {
      appId: string;
      appSecret: string;
      state?: 'formal' | 'trial' | 'developer';
    },
    private readonly transport: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !/^wx[a-fA-F0-9]{16}$/.test(configuration.appId) ||
      !/^[A-Za-z0-9_-]{16,256}$/.test(configuration.appSecret) ||
      (configuration.state !== undefined &&
        !['formal', 'trial', 'developer'].includes(configuration.state))
    )
      throw new Error('Invalid notification provider configuration');
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const response = await this.transport('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: this.configuration.appId,
        secret: this.configuration.appSecret,
        force_refresh: false,
      }),
    });
    const data = await boundedJson(response);
    if (
      !response.ok ||
      (data.errcode !== undefined && data.errcode !== 0) ||
      typeof data.access_token !== 'string' ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(data.access_token) ||
      !Number.isInteger(data.expires_in) ||
      Number(data.expires_in) < 120 ||
      Number(data.expires_in) > 7200
    )
      throw new Error('Notification token unavailable');
    this.token = {
      value: data.access_token,
      until: this.now() + (Number(data.expires_in) - 60) * 1000,
    };
    return this.token.value;
  }
  async send(message: WechatNotificationEnvelope): Promise<WechatNotificationResult> {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(message.openid) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(message.templateId) ||
      !message.data ||
      Object.keys(message.data).length < 1 ||
      Object.keys(message.data).length > 8 ||
      Object.entries(message.data).some(
        ([k, v]) =>
          !/^(thing|phrase|time)[1-9][0-9]?$/.test(k) ||
          !v ||
          typeof v.value !== 'string' ||
          [...v.value].length > (k.startsWith('time') ? 32 : k.startsWith('phrase') ? 5 : 20) ||
          /[\u0000-\u001f\u007f]/.test(v.value),
      )
    )
      throw new Error('Invalid notification request');
    let token: string;
    try {
      token = await this.accessToken();
    } catch {
      return { state: 'RETRYABLE', reason: 'TOKEN_UNAVAILABLE' };
    }
    try {
      const url = new URL('https://api.weixin.qq.com/cgi-bin/message/subscribe/send');
      url.searchParams.set('access_token', token);
      const response = await this.transport(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: message.openid,
          template_id: message.templateId,
          page: NOTIFICATION_PAGE,
          miniprogram_state: this.configuration.state ?? 'formal',
          lang: 'zh_CN',
          data: message.data,
        }),
      });
      const data = await boundedJson(response);
      if (!response.ok || !Number.isInteger(data.errcode)) return { state: 'UNKNOWN' };
      if (data.errcode === 0) return { state: 'ACCEPTED' };
      if ([40001, 40014, 42001].includes(Number(data.errcode))) {
        this.token = undefined;
        return { state: 'RETRYABLE', reason: 'TOKEN_REJECTED' };
      }
      return {
        state: 'REJECTED',
        reason:
          data.errcode === 43101
            ? 'NO_PERMISSION'
            : [40037, 47003, 41030].includes(Number(data.errcode))
              ? 'INVALID_TEMPLATE'
              : 'PROVIDER_REJECTED',
      };
    } catch {
      return { state: 'UNKNOWN' };
    }
  }
}

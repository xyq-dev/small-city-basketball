import { describe, expect, it } from 'vitest';
import { OfficialWechatNotificationProvider } from './notification-provider.js';
const config = { appId: 'wx0123456789abcdef', appSecret: 'synthetic_secret_123456' };
const message = {
  openid: 'synthetic_openid',
  templateId: 'synthetic_template',
  data: { thing1: { value: '比赛即将开始' } },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe('fixed official WeChat notification transport', () => {
  it('exchanges a short-lived token and sends to the fixed private message page', async () => {
    const requests: { url: URL; options: RequestInit }[] = [];
    const provider = new OfficialWechatNotificationProvider(config, (async (input, options) => {
      const url = new URL(String(input));
      requests.push({ url, options: options! });
      return url.pathname === '/cgi-bin/stable_token'
        ? json({ access_token: 'synthetic_token', expires_in: 7200 })
        : json({ errcode: 0, errmsg: 'ok' });
    }) as typeof fetch);
    expect(await provider.send(message)).toEqual({ state: 'ACCEPTED' });
    expect(await provider.send(message)).toEqual({ state: 'ACCEPTED' });
    expect(requests).toHaveLength(3);
    expect(
      requests.every(
        (x) => x.url.origin === 'https://api.weixin.qq.com' && x.options.redirect === 'error',
      ),
    ).toBe(true);
    expect(requests[0]!.url.pathname).toBe('/cgi-bin/stable_token');
    expect(JSON.parse(String(requests[1]!.options.body))).toEqual({
      touser: message.openid,
      template_id: message.templateId,
      page: 'pages/messages/index',
      miniprogram_state: 'formal',
      lang: 'zh_CN',
      data: message.data,
    });
  });
  it('can safely retry token preparation failures because message send never began', async () => {
    let calls = 0;
    const p = new OfficialWechatNotificationProvider(config, (async () => {
      calls++;
      throw Error('credential-bearing transport detail');
    }) as typeof fetch);
    expect(await p.send(message)).toEqual({ state: 'RETRYABLE', reason: 'TOKEN_UNAVAILABLE' });
    expect(calls).toBe(1);
  });
  it.each([43101, 40037, 47003, 41030, 999])(
    'preserves explicit non-acceptance: %s',
    async (errcode) => {
      const p = new OfficialWechatNotificationProvider(config, (async (url) =>
        String(url).endsWith('stable_token')
          ? json({ access_token: 'synthetic', expires_in: 120 })
          : json({ errcode, errmsg: 'secret must not leave transport' })) as typeof fetch);
      expect(await p.send(message)).toEqual({
        state: 'REJECTED',
        reason:
          errcode === 43101
            ? 'NO_PERMISSION'
            : [40037, 47003, 41030].includes(errcode)
              ? 'INVALID_TEMPLATE'
              : 'PROVIDER_REJECTED',
      });
    },
  );
  it.each(['network', 'http', 'invalid-json', 'oversize'] as const)(
    'does not blindly retry an uncertain send: %s',
    async (failure) => {
      const p = new OfficialWechatNotificationProvider(config, (async (url) => {
        if (String(url).endsWith('stable_token'))
          return json({ access_token: 'synthetic', expires_in: 120 });
        if (failure === 'network') throw Error('lost acknowledgement');
        if (failure === 'http') return json({ errcode: 0 }, 502);
        return new Response(failure === 'oversize' ? 'x'.repeat(20000) : 'not json');
      }) as typeof fetch);
      expect(await p.send(message)).toEqual({ state: 'UNKNOWN' });
    },
  );
  it('invalid tokens explicitly rejected by WeChat trigger fresh token acquisition', async () => {
    let calls = 0;
    const p = new OfficialWechatNotificationProvider(config, (async (url) => {
      calls++;
      return String(url).endsWith('stable_token')
        ? json({ access_token: 'synthetic', expires_in: 120 })
        : json({ errcode: 40014 });
    }) as typeof fetch);
    expect(await p.send(message)).toEqual({ state: 'RETRYABLE', reason: 'TOKEN_REJECTED' });
    expect(await p.send(message)).toEqual({ state: 'RETRYABLE', reason: 'TOKEN_REJECTED' });
    expect(calls).toBe(4);
  });
});

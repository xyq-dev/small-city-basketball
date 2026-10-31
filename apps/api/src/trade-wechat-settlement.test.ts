import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { TradeWechatSettlementClient } from './trade-wechat-settlement.js';
const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Date.parse('2026-10-30T00:00:00Z'),
  timestamp = String(now / 1000),
  nonce = 'synthetic-nonce';
const config = {
  enabled: true,
  returnsEnabled: true,
  appId: 'syntheticApp',
  merchantId: '1900000101',
  serialNo: 'SYNTHETIC_SERIAL',
  privateKeyPem: merchant.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  platformKeys: {
    SYNTHETIC_PLATFORM: platform.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  },
};
const input = {
  transactionId: '42000001',
  outOrderNo: 'E4Sstable',
  receiverMerchantId: '1900000102',
  amountFen: 500,
  description: '合成服务结算',
};
const split = (result = 'SUCCESS') => ({
  transaction_id: input.transactionId,
  out_order_no: input.outOrderNo,
  order_id: 'provider-split',
  state: 'FINISHED',
  receivers: [
    {
      type: 'MERCHANT_ID',
      account: input.receiverMerchantId,
      amount: 500,
      result,
      ...(result === 'SUCCESS' ? { detail_id: 'provider-detail' } : {}),
    },
  ],
});
const retInput = {
  outOrderNo: input.outOrderNo,
  outReturnNo: 'E4Rstable',
  receiverMerchantId: input.receiverMerchantId,
  amountFen: 500,
  description: '独立批准退款回退',
};
const ret = () => ({
  out_order_no: input.outOrderNo,
  out_return_no: retInput.outReturnNo,
  return_mchid: input.receiverMerchantId,
  amount: 500,
  return_id: 'provider-return',
  result: 'SUCCESS',
});
function response(
  value: unknown,
  opts: { tamper?: boolean; status?: number; serial?: string } = {},
) {
  const body = JSON.stringify(value),
    signature = sign(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
      platform.privateKey,
    ).toString('base64');
  return new Response(opts.tamper ? body + ' ' : body, {
    status: opts.status ?? 200,
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Serial': opts.serial ?? 'SYNTHETIC_PLATFORM',
      'Wechatpay-Signature': signature,
    },
  });
}
function fixture(value: unknown = split(), opts = {}) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    response(value, opts),
  );
  return {
    fetcher,
    client: new TradeWechatSettlementClient(config, {
      fetch: fetcher as typeof fetch,
      now: () => now,
      nonce: () => nonce,
    }),
  };
}
describe('ordinary merchant profit sharing and return signed protocol', () => {
  it('signs exact fixed-host ordinary-merchant split request and finalizes unsplit funds', async () => {
    const f = fixture();
    expect((await f.client.split(input)).receiver.result).toBe('SUCCESS');
    const [url, request] = f.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/profitsharing/orders');
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      appid: config.appId,
      out_order_no: input.outOrderNo,
      unfreeze_unsplit: true,
      receivers: [{ type: 'MERCHANT_ID', account: input.receiverMerchantId, amount: 500 }],
    });
    expect(body.sub_mchid).toBeUndefined();
    const auth = (request.headers as Record<string, string>).Authorization!,
      signature = /signature="([^"]+)"/.exec(auth)![1]!;
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`POST\n/v3/profitsharing/orders\n${timestamp}\n${nonce}\n${request.body}\n`),
        merchant.publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
    expect(request.redirect).toBe('error');
  });
  it('does not equate FINISHED with receiver success', async () => {
    expect((await fixture(split('CLOSED')).client.split(input)).receiver.result).toBe('CLOSED');
  });
  it('queries the original split number with transaction identity', async () => {
    const f = fixture();
    await f.client.query(input);
    expect(f.fetcher.mock.calls[0]![0]).toBe(
      'https://api.mch.weixin.qq.com/v3/profitsharing/orders/E4Sstable?transaction_id=42000001',
    );
  });
  it('returns then queries original ordinary-merchant return without partner parameters', async () => {
    const f = fixture(ret());
    expect((await f.client.returnFunds(retInput)).state).toBe('SUCCESS');
    expect(JSON.parse((f.fetcher.mock.calls[0] as any)[1].body)).toMatchObject({
      out_order_no: 'E4Sstable',
      out_return_no: 'E4Rstable',
      return_mchid: input.receiverMerchantId,
      amount: 500,
    });
    await f.client.queryReturn(retInput);
    expect(f.fetcher.mock.calls[1]![0]).toBe(
      'https://api.mch.weixin.qq.com/v3/profitsharing/return-orders/E4Rstable?out_order_no=E4Sstable',
    );
  });
  it('rejects amount, receiver and original-operation mismatch even when platform-signed', async () => {
    for (const value of [
      { ...split(), out_order_no: 'other' },
      {
        ...split(),
        receivers: [
          { type: 'MERCHANT_ID', account: 'other', amount: 500, result: 'SUCCESS', detail_id: 'd' },
        ],
      },
    ])
      await expect(fixture(value).client.split(input)).rejects.toMatchObject({
        code: 'TRADE_PROVIDER_INVALID_RESPONSE',
      });
    await expect(fixture({ ...ret(), amount: 1 }).client.returnFunds(retInput)).rejects.toThrow();
  });
  it('rejects tampering and unknown pinned key', async () => {
    await expect(fixture(split(), { tamper: true }).client.split(input)).rejects.toMatchObject({
      code: 'TRADE_PROVIDER_INVALID_RESPONSE',
    });
    await expect(fixture(split(), { serial: 'unknown' }).client.split(input)).rejects.toThrow();
  });
  it('treats 5xx and connection loss as unknown, preserving original identifiers', async () => {
    await expect(
      fixture({ code: 'SYSTEM_ERROR' }, { status: 503 }).client.split(input),
    ).rejects.toMatchObject({ code: 'TRADE_PROVIDER_RESULT_UNKNOWN' });
    const fetcher = vi.fn(async () => {
      throw Error('synthetic disconnect');
    });
    const client = new TradeWechatSettlementClient(config, { fetch: fetcher as typeof fetch });
    await expect(client.returnFunds(retInput)).rejects.toMatchObject({
      code: 'TRADE_PROVIDER_RESULT_UNKNOWN',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('disables outbound splits as well as returns unless return capability is explicitly enabled', async () => {
    const fetcher = vi.fn();
    const client = new TradeWechatSettlementClient(
      { ...config, returnsEnabled: false },
      { fetch: fetcher as typeof fetch },
    );
    expect(client.returnSupported).toBe(false);
    await expect(client.split(input)).rejects.toMatchObject({ code: 'TRADE_SETTLEMENT_DISABLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

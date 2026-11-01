import { generateKeyPairSync, privateDecrypt, sign, verify } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { TradeWechatMultiClient } from './trade-wechat-multi-provider.js';
const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Date.parse('2026-11-01T00:00:00Z'),
  stamp = String(now / 1000),
  nonce = 'synthetic-nonce';
const config = {
  enabled: true,
  returnsEnabled: true,
  encryptionSerial: 'PLATFORM',
  appId: 'syntheticApp',
  merchantId: '1900000101',
  serialNo: 'MERCHANT',
  privateKeyPem: merchant.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  platformKeys: { PLATFORM: platform.publicKey.export({ format: 'pem', type: 'spki' }).toString() },
};
const input = {
  transactionId: '42000001',
  outOrderNo: 'SCBADSstable',
  receivers: [
    { merchantId: '1900000102', displayName: '合成商户甲', amountFen: 1501 },
    { merchantId: '1900000103', displayName: '合成商户乙', amountFen: 1000 },
  ],
};
const payload = () => ({
  transaction_id: input.transactionId,
  out_order_no: input.outOrderNo,
  order_id: 'provider-order',
  state: 'FINISHED',
  receivers: input.receivers.map((r, n) => ({
    type: 'MERCHANT_ID',
    account: r.merchantId,
    amount: r.amountFen,
    result: 'SUCCESS',
    detail_id: 'detail' + n,
  })),
});
function fixture(value: unknown = payload(), tamper = false) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const raw = JSON.stringify(value);
    return new Response(raw + (tamper ? ' ' : ''), {
      headers: {
        'Wechatpay-Timestamp': stamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Serial': 'PLATFORM',
        'Wechatpay-Signature': sign(
          'RSA-SHA256',
          Buffer.from(`${stamp}\n${nonce}\n${raw}\n`),
          platform.privateKey,
        ).toString('base64'),
      },
    });
  });
  return {
    fetcher,
    client: new TradeWechatMultiClient(config, {
      fetch: fetcher as typeof fetch,
      now: () => now,
      nonce: () => nonce,
    }),
  };
}
describe('ordinary merchant multiple receiver protocol', () => {
  it('sends all recipients in one signed request without unfreezing and encrypts merchant names', async () => {
    const f = fixture();
    expect((await f.client.split(input)).receivers.map((r) => r.amountFen)).toEqual([1501, 1000]);
    const [url, request] = f.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(request.body as string);
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/profitsharing/orders');
    expect(body.unfreeze_unsplit).toBe(false);
    expect(body.sub_mchid).toBeUndefined();
    expect(body.receivers).toHaveLength(2);
    expect(
      privateDecrypt(
        { key: platform.privateKey, oaepHash: 'sha1' },
        Buffer.from(body.receivers[0].name, 'base64'),
      ).toString(),
    ).toBe(input.receivers[0]!.displayName);
    const h = request.headers as Record<string, string>;
    expect(h['Wechatpay-Serial']).toBe('PLATFORM');
    const sig = /signature="([^"]+)"/.exec(h.Authorization!)![1]!;
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`POST\n/v3/profitsharing/orders\n${stamp}\n${nonce}\n${request.body}\n`),
        merchant.publicKey,
        Buffer.from(sig, 'base64'),
      ),
    ).toBe(true);
    expect(request.redirect).toBe('error');
  });
  it('preserves per-recipient failure and queries the original identifiers', async () => {
    const p = payload();
    p.receivers[1]!.result = 'CLOSED';
    const f = fixture(p);
    expect((await f.client.querySplit(input)).receivers[1]!.result).toBe('CLOSED');
    expect(String(f.fetcher.mock.calls[0]![0])).toContain(
      '/orders/SCBADSstable?transaction_id=42000001',
    );
  });
  it.each(['duplicate', 'amount', 'transaction', 'signature'])(
    'rejects %s response without inventing success',
    async (mode) => {
      const p = payload();
      if (mode === 'duplicate') p.receivers[1] = p.receivers[0]!;
      if (mode === 'amount') p.receivers[0]!.amount++;
      if (mode === 'transaction') p.transaction_id = 'wrong';
      await expect(fixture(p, mode === 'signature').client.split(input)).rejects.toMatchObject({
        code: 'TRADE_PROVIDER_INVALID_RESPONSE',
      });
    },
  );
  it('keeps timeout unknown and disabled client never calls transport', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('timeout'));
    const client = new TradeWechatMultiClient(config, { fetch: transport, now: () => now });
    await expect(client.split(input)).rejects.toMatchObject({
      code: 'TRADE_PROVIDER_RESULT_UNKNOWN',
    });
    const disabled = new TradeWechatMultiClient({ enabled: false }, { fetch: transport });
    await expect(disabled.split(input)).rejects.toMatchObject({
      code: 'TRADE_SETTLEMENT_DISABLED',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('uses a separate final unfreeze operation and validates merchant retention result', async () => {
    const p = {
      transaction_id: input.transactionId,
      out_order_no: input.outOrderNo + 'F',
      order_id: 'finish',
      state: 'FINISHED',
      receivers: [
        {
          type: 'MERCHANT_ID',
          account: config.merchantId,
          amount: 7002,
          result: 'SUCCESS',
          detail_id: 'retained',
        },
      ],
    };
    const f = fixture(p);
    expect(
      (
        await f.client.finish({
          transactionId: input.transactionId,
          outOrderNo: input.outOrderNo + 'F',
          maximumFen: 10003,
        })
      ).state,
    ).toBe('FINISHED');
    expect(f.fetcher.mock.calls[0]![0]).toBe(
      'https://api.mch.weixin.qq.com/v3/profitsharing/orders/unfreeze',
    );
    p.receivers[0]!.account = 'foreign';
    await expect(
      fixture(p).client.queryFinish({
        transactionId: input.transactionId,
        outOrderNo: input.outOrderNo + 'F',
        maximumFen: 10003,
      }),
    ).rejects.toMatchObject({ code: 'TRADE_PROVIDER_INVALID_RESPONSE' });
  });
  it('binds returns to original split, receiver, amount and immutable return number', async () => {
    const i = {
      outOrderNo: input.outOrderNo,
      outReturnNo: 'return-one',
      receiverMerchantId: input.receivers[0]!.merchantId,
      amountFen: 150,
    };
    const f = fixture({
      out_order_no: i.outOrderNo,
      out_return_no: i.outReturnNo,
      return_mchid: i.receiverMerchantId,
      amount: i.amountFen,
      return_id: 'ret',
      result: 'SUCCESS',
    });
    expect((await f.client.returnFunds(i)).state).toBe('SUCCESS');
    expect((await f.client.queryReturn(i)).amountFen).toBe(150);
    await expect(f.client.queryReturn({ ...i, amountFen: 151 })).rejects.toMatchObject({
      code: 'TRADE_PROVIDER_INVALID_RESPONSE',
    });
  });
});

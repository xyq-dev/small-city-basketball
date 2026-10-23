import { createCipheriv, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  WechatPayClient,
  parseWechatPayBill,
  wechatPayYuanToFen,
  reconcileWechatPayBill,
} from './wechatpay.js';
import type { WechatPayConfig } from './wechatpay.js';

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (key: typeof merchant.privateKey) =>
  key.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = platform.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const clock = Date.parse('2026-10-24T12:00:00.000Z');
const serial = 'PLATFORM_SERIAL_1234';
const config: WechatPayConfig = {
  enabled: true,
  appId: 'wx1234567890123456',
  merchantId: '1900000109',
  serialNo: 'MERCHANT_SERIAL_1234',
  privateKeyPem: pem(merchant.privateKey),
  apiV3Key: '1'.repeat(32),
  platformKeys: { [serial]: publicPem },
  notifyUrl: 'https://basketball.example.test/v1/commerce/wechatpay-notifications',
};
const payment = () => ({
  appid: config.appId,
  mchid: config.merchantId,
  out_trade_no: 'SCB_ORDER_1',
  transaction_id: '420000000001',
  trade_type: 'NATIVE',
  trade_state: 'SUCCESS',
  success_time: '2026-10-24T19:59:59+08:00',
  amount: { total: 100, payer_total: 1, currency: 'CNY' },
});
const refund = (state = 'PROCESSING') => ({
  mchid: config.merchantId,
  out_trade_no: 'SCB_ORDER_1',
  transaction_id: '420000000001',
  out_refund_no: 'SCB_REFUND_1',
  refund_id: '500000000001',
  status: state,
  create_time: '2026-10-23T23:59:59+08:00',
  ...(state === 'SUCCESS' ? { success_time: '2026-10-24T19:59:59+08:00' } : {}),
  amount: { total: 100, refund: 100, currency: 'CNY' },
});
function signed(body: Buffer, overrides: Record<string, string> = {}) {
  const timestamp = String(Math.floor(clock / 1000)),
    nonce = 'platform-nonce';
  return {
    'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Nonce': nonce,
    'Wechatpay-Serial': serial,
    'Wechatpay-Signature': sign(
      'RSA-SHA256',
      Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from('\n')]),
      platform.privateKey,
    ).toString('base64'),
    ...overrides,
  };
}
function response(value: unknown, status = 200, overrides: Record<string, string> = {}) {
  const raw = Buffer.from(JSON.stringify(value));
  return new Response(raw, { status, headers: signed(raw, overrides) });
}
function notification(
  value: unknown,
  eventType = 'TRANSACTION.SUCCESS',
  options: { algorithm?: string; aad?: string; tamper?: boolean } = {},
) {
  const nonce = '123456789012',
    aad = options.aad ?? 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.apiV3Key!), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  if (options.tamper) data[0] = data[0]! ^ 1;
  const raw = Buffer.from(
    JSON.stringify({
      id: 'EV_SYNTHETIC_1',
      create_time: '2026-10-24T20:00:00+08:00',
      event_type: eventType,
      resource_type: 'encrypt-resource',
      resource: {
        algorithm: options.algorithm ?? 'AEAD_AES_256_GCM',
        nonce,
        associated_data: aad,
        ciphertext: data.toString('base64'),
      },
    }),
  );
  return { raw, headers: signed(raw) };
}
let transport: ReturnType<typeof vi.fn>;
function client() {
  return new WechatPayClient(config, {
    fetch: transport as typeof fetch,
    now: () => clock,
    nonce: () => 'merchant-nonce',
  });
}
beforeEach(() => {
  transport = vi.fn();
});
describe('WechatPay v3 real protocol with synthetic cryptography and controlled transport', () => {
  test('is disabled by default and never sends a request without full enablement', async () => {
    const disabled = new WechatPayClient(undefined, { fetch: transport as typeof fetch });
    await expect(
      disabled.native({
        outTradeNo: 'SCB_ORDER_1',
        description: '合成软件费',
        totalFen: 100,
        currency: 'CNY',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_DISABLED' });
    expect(transport).not.toHaveBeenCalled();
    expect(() => new WechatPayClient({ enabled: true })).toThrow('Complete valid');
    expect(
      () => new WechatPayClient({ ...config, notifyUrl: 'http://basketball.example.test/notify' }),
    ).toThrow();
    expect(() => new WechatPayClient({ ...config, apiV3Key: 'short' })).toThrow();
  });
  test('signs the exact Native request bytes and verifies the raw provider response', async () => {
    transport.mockResolvedValueOnce(
      response({ code_url: 'weixin://wxpay/bizpayurl?pr=synthetic' }),
    );
    expect(
      await client().native({
        outTradeNo: 'SCB_ORDER_1',
        description: '合成软件费',
        totalFen: 100,
        currency: 'CNY',
      }),
    ).toEqual({ codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic' });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    const authorization = init.headers.Authorization;
    const signature = /signature="([^"]+)"/.exec(authorization)![1]!;
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(
          `POST\n/v3/pay/transactions/native\n${Math.floor(clock / 1000)}\nmerchant-nonce\n${init.body}\n`,
        ),
        merchant.publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
    expect(JSON.parse(init.body).amount).toEqual({ total: 100, currency: 'CNY' });
    expect(init.redirect).toBe('error');
  });
  test.each([
    ['missing signature', {}],
    ['unknown certificate', { 'Wechatpay-Serial': 'UNTRUSTED_SERIAL' }],
    ['expired timestamp', { 'Wechatpay-Timestamp': String(Math.floor(clock / 1000) - 301) }],
    ['signature probe', { 'Wechatpay-Signature': 'WECHATPAY/SIGNTEST/synthetic' }],
    ['invalid base64', { 'Wechatpay-Signature': '!!!!' }],
  ])('rejects %s before accepting a result', async (name, overrides) => {
    const raw = Buffer.from(JSON.stringify(payment()));
    transport.mockResolvedValueOnce(
      new Response(raw, { headers: name === 'missing signature' ? {} : signed(raw, overrides) }),
    );
    await expect(client().queryOrder('SCB_ORDER_1')).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
  });
  test('raw byte tampering and unsigned provider errors cannot masquerade as valid rejection', async () => {
    const raw = Buffer.from(JSON.stringify(payment()));
    transport.mockResolvedValueOnce(
      new Response(Buffer.concat([raw, Buffer.from(' ')]), { headers: signed(raw) }),
    );
    await expect(client().queryOrder('SCB_ORDER_1')).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
    transport.mockResolvedValueOnce(new Response('{"code":"ORDER_NOT_EXIST"}', { status: 404 }));
    await expect(client().queryOrder('SCB_ORDER_1')).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
    transport.mockResolvedValueOnce(
      response({ code: 'ORDER_NOT_EXIST', message: 'sensitive-provider-body' }, 404),
    );
    await expect(client().queryOrder('SCB_ORDER_1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_REJECTED',
      details: { providerCode: 'ORDER_NOT_EXIST' },
    });
  });
  test('query signs the path and merchant query and uses original total rather than discounted payer total', async () => {
    transport.mockResolvedValueOnce(response(payment()));
    expect(await client().queryOrder('SCB_ORDER_1')).toEqual({
      outTradeNo: 'SCB_ORDER_1',
      transactionId: '420000000001',
      state: 'SUCCESS',
      totalFen: 100,
      currency: 'CNY',
      successTime: '2026-10-24T19:59:59+08:00',
    });
    expect(transport.mock.calls[0]![0]).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/SCB_ORDER_1?mchid=1900000109',
    );
  });
  test.each([
    { mchid: '1900000999' },
    { appid: 'wx0000000000000000' },
    { out_trade_no: 'OTHER_ORDER' },
    { trade_type: 'JSAPI' },
    { amount: { total: 0, currency: 'CNY' } },
    { amount: { total: 1.1, currency: 'CNY' } },
    { amount: { total: 100, currency: 'USD' } },
    { success_time: undefined },
  ])('fails closed on mismatched order identity or money %j', async (override) => {
    transport.mockResolvedValueOnce(response({ ...payment(), ...override }));
    await expect(client().queryOrder('SCB_ORDER_1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID_RESPONSE',
    });
  });
  test('decrypts a signed notification, emits only normalized proof and allows duplicate delivery for service idempotency', () => {
    const n = notification({
      ...payment(),
      payer: { openid: 'private-openid' },
      promotion_detail: [{ private: 'ignored' }],
    });
    const result = client().verifyNotification(n.raw, n.headers);
    expect(result).toMatchObject({
      id: 'EV_SYNTHETIC_1',
      kind: 'PAYMENT',
      payment: { state: 'SUCCESS', totalFen: 100 },
    });
    expect(JSON.stringify(result)).not.toMatch(/openid|payer_total|promotion_detail|apiV3Key/);
    expect(client().verifyNotification(n.raw, n.headers)).toEqual(result);
  });
  test('notification authentication precedes decryption and rejects bad tag, wrong algorithm, merchant, or state', () => {
    const good = notification(payment());
    expect(() =>
      client().verifyNotification(good.raw, { 'Wechatpay-Timestamp': String(clock / 1000) }),
    ).toThrowError(expect.objectContaining({ code: 'PAYMENT_SIGNATURE_INVALID' }));
    for (const n of [
      notification(payment(), 'TRANSACTION.SUCCESS', { tamper: true }),
      notification(payment(), 'TRANSACTION.SUCCESS', { algorithm: 'UNKNOWN' }),
      notification({ ...payment(), mchid: '12345678' }),
      notification({ ...payment(), trade_state: 'NOTPAY' }),
      notification(payment(), 'UNKNOWN'),
    ])
      expect(() => client().verifyNotification(n.raw, n.headers)).toThrow();
    expect(() =>
      client().verifyNotification(good.raw, { ...good.headers, 'wechatpay-serial': serial }),
    ).toThrowError(expect.objectContaining({ code: 'PAYMENT_SIGNATURE_INVALID' }));
  });
  test('refund retries preserve the same external number; accepted processing is not success', async () => {
    transport
      .mockResolvedValueOnce(response(refund()))
      .mockResolvedValueOnce(response(refund('SUCCESS')));
    const input = {
      outTradeNo: 'SCB_ORDER_1',
      outRefundNo: 'SCB_REFUND_1',
      totalFen: 100,
      refundFen: 100,
      currency: 'CNY' as const,
    };
    expect(await client().refund(input)).toMatchObject({
      state: 'PROCESSING',
      outRefundNo: 'SCB_REFUND_1',
    });
    expect(await client().queryRefund('SCB_REFUND_1')).toMatchObject({
      state: 'SUCCESS',
      outRefundNo: 'SCB_REFUND_1',
    });
    expect(JSON.parse(transport.mock.calls[0]![1].body).out_refund_no).toBe('SCB_REFUND_1');
    expect(transport.mock.calls[1]![0]).toBe(
      'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/SCB_REFUND_1',
    );
  });
  test('refund notification state is bound to event type and original amounts', () => {
    const value = refund('SUCCESS');
    const n = notification(
      { ...value, status: undefined, refund_status: 'SUCCESS' },
      'REFUND.SUCCESS',
    );
    expect(client().verifyNotification(n.raw, n.headers)).toMatchObject({
      kind: 'REFUND',
      refund: { outRefundNo: 'SCB_REFUND_1', refundFen: 100, state: 'SUCCESS' },
    });
    const wrong = notification(
      { ...value, status: undefined, refund_status: 'PROCESSING' },
      'REFUND.SUCCESS',
    );
    expect(() => client().verifyNotification(wrong.raw, wrong.headers)).toThrow();
  });
  test('timeout is an unknown result and never changes the merchant order number automatically', async () => {
    transport.mockRejectedValueOnce(new Error('network secret https://private/key'));
    const promise = client().native({
      outTradeNo: 'SCB_ORDER_1',
      description: '合成软件费',
      totalFen: 100,
      currency: 'CNY',
    });
    await expect(promise).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_RESULT_UNKNOWN' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('bounds raw bodies and refuses attacker payment QR schemes', async () => {
    transport.mockResolvedValueOnce(response({ code_url: 'javascript:alert(1)' }));
    await expect(
      client().native({
        outTradeNo: 'SCB_ORDER_1',
        description: '合成软件费',
        totalFen: 100,
        currency: 'CNY',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_INVALID_RESPONSE' });
    transport.mockResolvedValueOnce(
      new Response('x', { headers: { 'Content-Length': String(300000) } }),
    );
    await expect(client().queryOrder('SCB_ORDER_1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID_RESPONSE',
    });
  });
});

const headings = [
  '交易时间',
  '公众账号ID',
  '商户号',
  '特约商户号',
  '设备号',
  '微信订单号',
  '商户订单号',
  '用户标识',
  '交易类型',
  '交易状态',
  '付款银行',
  '货币种类',
  '应结订单金额',
  '代金券金额',
  '微信退款单号',
  '商户退款单号',
  '退款金额',
  '充值券退款金额',
  '退款类型',
  '退款状态',
  '商品名称',
  '商户数据包',
  '手续费',
  '费率',
  '订单金额',
  '申请退款金额',
  '费率备注',
];
function billRows(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    交易时间: '2026-10-23 23:59:59',
    公众账号ID: config.appId!,
    商户号: config.merchantId!,
    特约商户号: '0',
    设备号: '',
    微信订单号: '420000000001',
    商户订单号: 'SCB_ORDER_1',
    用户标识: 'synthetic-private-openid',
    交易类型: 'NATIVE',
    交易状态: 'SUCCESS',
    付款银行: 'OTHERS',
    货币种类: 'CNY',
    应结订单金额: '0.01',
    代金券金额: '0.99',
    订单金额: '1.00',
    微信退款单号: '0',
    商户退款单号: '0',
    退款金额: '0.00',
    充值券退款金额: '0.00',
    退款类型: '',
    退款状态: '',
    商品名称: '合成软件服务',
    商户数据包: '',
    手续费: '0.00',
    费率: '0.60%',
    申请退款金额: '0.00',
    费率备注: '',
    ...overrides,
  };
  return Buffer.from(
    `${headings.join(',')}\r\n${headings.map((h) => '\x60' + base[h]).join(',')}\r\n总交易单数,应结订单总金额,退款总金额,充值券退款总金额,手续费总金额,订单总金额,申请退款总金额\r\n` +
      [
        '1',
        base['应结订单金额'],
        base['退款金额'],
        base['充值券退款金额'],
        base['手续费'],
        base['订单金额'],
        base['申请退款金额'],
      ]
        .map((v) => '\x60' + v)
        .join(',') +
      '\r\n',
  );
}
const refundBillOverrides = {
  交易状态: 'REFUND',
  应结订单金额: '0.00',
  代金券金额: '0.00',
  订单金额: '0.00',
  微信退款单号: '500000000001',
  商户退款单号: 'SCB_REFUND_1',
  退款金额: '0.60',
  申请退款金额: '1.00',
  退款类型: 'ORIGINAL',
  退款状态: 'PROCESSING',
};
describe('WechatPay billing fixed point parser and verified bounded download', () => {
  test('uses original order amount, handles official backticks and preserves IDs as strings', () => {
    expect(parseWechatPayBill(billRows(), config.merchantId!, config.appId!)).toEqual([
      {
        outTradeNo: 'SCB_ORDER_1',
        transactionId: '420000000001',
        totalFen: 100,
        tradeState: 'SUCCESS',
        outRefundNo: null,
        refundId: null,
        refundFen: null,
        refundState: null,
      },
    ]);
    expect(wechatPayYuanToFen('0.01')).toBe(1);
    expect(wechatPayYuanToFen('1000000.00')).toBe(100000000);
  });
  test.each(['1e3', '-1', '+1', '1.001', 'NaN', 'Infinity', '01.00', '1000000.01'])(
    'rejects ambiguous or unbounded yuan %s',
    (value) => expect(() => wechatPayYuanToFen(value)).toThrow(),
  );
  test('rejects wrong merchant, currency, duplicate records, bad legacy layout and malformed CSV', () => {
    for (const raw of [
      billRows({ 商户号: '12345678' }),
      billRows({ 货币种类: 'USD' }),
      billRows({ 订单金额: '0' }),
      Buffer.from(billRows().toString().replace(',订单金额,', ',原始金额,')),
      Buffer.from('"unclosed'),
    ])
      expect(() => parseWechatPayBill(raw, config.merchantId!, config.appId!)).toThrow();
    const rows = billRows().toString().split('\r\n');
    rows.splice(2, 0, rows[1]!);
    expect(() =>
      parseWechatPayBill(Buffer.from(rows.join('\r\n')), config.merchantId!, config.appId!),
    ).toThrow();
  });
  test('verifies signed metadata then SHA1 for the documented unsigned file response', async () => {
    const raw = billRows(),
      hash = createHash('sha1').update(raw).digest('hex');
    transport
      .mockResolvedValueOnce(
        response({
          hash_type: 'SHA1',
          hash_value: hash,
          download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=synthetic',
        }),
      )
      .mockResolvedValueOnce(new Response(raw));
    const result = await client().downloadBill('2026-10-23');
    expect(result.rows[0]?.totalFen).toBe(100);
    expect(result.bodyHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(transport.mock.calls[1]![1].redirect).toBe('error');
    expect(transport.mock.calls[1]![1].headers.Authorization).toContain(
      'WECHATPAY2-SHA256-RSA2048',
    );
  });
  test.each([
    'https://evil.example/v3/billdownload/file?token=x',
    'https://api.mch.weixin.qq.com:444/v3/billdownload/file?token=x',
    'https://api.mch.weixin.qq.com/not-bill?token=x',
    'https://api.mch.weixin.qq.com@evil.example/v3/billdownload/file?token=x',
  ])('never fetches an untrusted bill URL %s', async (download_url) => {
    transport.mockResolvedValueOnce(
      response({ hash_type: 'SHA1', hash_value: 'a'.repeat(40), download_url }),
    );
    await expect(client().downloadBill('2026-10-23')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID_RESPONSE',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('hash mismatch and future bill requests fail without returning unverified rows', async () => {
    transport
      .mockResolvedValueOnce(
        response({
          hash_type: 'SHA1',
          hash_value: 'a'.repeat(40),
          download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=synthetic',
        }),
      )
      .mockResolvedValueOnce(new Response(billRows()));
    await expect(client().downloadBill('2026-10-23')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID_RESPONSE',
    });
    const current = client().downloadBill('2026-10-24');
    await expect(current).rejects.toMatchObject({ code: 'PAYMENT_INPUT_INVALID' });
  });
});

describe('WechatPay reconciliation is a comparison, not an entitlement command', () => {
  const row = () => parseWechatPayBill(billRows(), config.merchantId!, config.appId!)[0]!;
  test('matches exact original amounts and keeps inputs unchanged', () => {
    const actual = [row()],
      local = structuredClone(actual),
      original = structuredClone(actual);
    expect(reconcileWechatPayBill(actual, local)).toEqual({ matchedCount: 1, issues: [] });
    expect(actual).toEqual(original);
  });
  test.each([
    ['IDENTITY_MISMATCH', { transactionId: 'OTHER_TRANSACTION' }],
    ['AMOUNT_MISMATCH', { totalFen: 99 }],
  ])('reports %s without repairing money or authorizing software', (code, changed) => {
    expect(reconcileWechatPayBill([row()], [{ ...row(), ...changed }])).toEqual({
      matchedCount: 0,
      issues: [{ code, outTradeNo: 'SCB_ORDER_1', outRefundNo: null }],
    });
  });
  test('official refund placeholder totals and coupon settlement never replace the application amount', () => {
    const actual = parseWechatPayBill(
      billRows(refundBillOverrides),
      config.merchantId!,
      config.appId!,
    );
    expect(actual).toEqual([
      {
        outTradeNo: 'SCB_ORDER_1',
        transactionId: '420000000001',
        totalFen: null,
        tradeState: 'REFUND',
        outRefundNo: 'SCB_REFUND_1',
        refundId: '500000000001',
        refundFen: 100,
        refundState: 'PROCESSING',
      },
    ]);
    expect(reconcileWechatPayBill(actual, [{ ...actual[0]!, refundState: null }])).toEqual({
      matchedCount: 1,
      issues: [],
    });
    expect(
      reconcileWechatPayBill(actual, [{ ...actual[0]!, refundFen: 60, refundState: null }])
        .issues[0]?.code,
    ).toBe('AMOUNT_MISMATCH');
    expect(
      reconcileWechatPayBill(actual, [
        { ...actual[0]!, refundId: '500000000002', refundState: null },
      ]).issues[0]?.code,
    ).toBe('IDENTITY_MISMATCH');
    expect(
      reconcileWechatPayBill(actual, [{ ...actual[0]!, refundState: 'SUCCESS' }]).issues[0]?.code,
    ).toBe('STATE_MISMATCH');
  });
  test('unknown refund snapshots, missing refund identities or settlement exceeding application amount fail closed', () => {
    for (const changes of [
      { 退款状态: 'UNKNOWN' },
      { 微信退款单号: '0' },
      { 商户退款单号: '0' },
      { 退款金额: '1.01' },
      { 申请退款金额: '0.00' },
      { 订单金额: '1.00' },
    ]) {
      expect(() =>
        parseWechatPayBill(
          billRows({ ...refundBillOverrides, ...changes }),
          config.merchantId!,
          config.appId!,
        ),
      ).toThrow();
    }
    const actual = parseWechatPayBill(
      billRows(refundBillOverrides),
      config.merchantId!,
      config.appId!,
    );
    expect(reconcileWechatPayBill([], [{ ...actual[0]!, refundState: null }]).issues[0]?.code).toBe(
      'LOCAL_ONLY',
    );
    expect(() =>
      reconcileWechatPayBill(
        [{ ...actual[0]!, refundState: 'UNKNOWN' }],
        [{ ...actual[0]!, refundState: null }],
      ),
    ).toThrow();
  });
  test('reports each missing side and rejects duplicate local accounting identities', () => {
    expect(reconcileWechatPayBill([row()], []).issues[0]?.code).toBe('PROVIDER_ONLY');
    expect(reconcileWechatPayBill([], [row()]).issues[0]?.code).toBe('LOCAL_ONLY');
    expect(() => reconcileWechatPayBill([row()], [row(), row()])).toThrow();
  });
});

describe('provider refund acceptance time and official historical bill snapshots', () => {
  test('keeps refund acceptance date distinct from final success and does not replace it with outer notification time', async () => {
    transport.mockResolvedValueOnce(response(refund('SUCCESS')));
    const queried = await client().queryRefund('SCB_REFUND_1');
    expect(queried).toMatchObject({
      createdTime: '2026-10-23T23:59:59+08:00',
      successTime: '2026-10-24T19:59:59+08:00',
    });
    const n = notification(
      { ...refund('SUCCESS'), status: undefined, create_time: undefined, refund_status: 'SUCCESS' },
      'REFUND.SUCCESS',
    );
    const proof = client().verifyNotification(n.raw, n.headers);
    expect(proof).toMatchObject({
      kind: 'REFUND',
      refund: { createdTime: null, successTime: '2026-10-24T19:59:59+08:00' },
    });
  });
  test('requires acceptance time in API query/apply responses, while allowing it to be absent in notifications', async () => {
    transport.mockResolvedValueOnce(response({ ...refund(), create_time: undefined }));
    await expect(client().queryRefund('SCB_REFUND_1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID_RESPONSE',
    });
    transport.mockResolvedValueOnce(
      response({ ...refund('SUCCESS'), create_time: '2026-10-25T00:00:00+08:00' }),
    );
    await expect(client().queryRefund('SCB_REFUND_1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID_RESPONSE',
    });
  });
  test('a next-day final success matches the prior acceptance-day PROCESSING bill without a false state mismatch', async () => {
    const raw = billRows(refundBillOverrides),
      hash = createHash('sha1').update(raw).digest('hex');
    transport
      .mockResolvedValueOnce(response(refund('SUCCESS')))
      .mockResolvedValueOnce(
        response({
          hash_type: 'SHA1',
          hash_value: hash,
          download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=synthetic',
        }),
      )
      .mockResolvedValueOnce(new Response(raw));
    const provider = client(),
      current = await provider.queryRefund('SCB_REFUND_1');
    expect(current.state).toBe('SUCCESS');
    expect(current.createdTime?.slice(0, 10)).toBe('2026-10-23');
    const historical = await provider.downloadBill('2026-10-23');
    expect(historical.rows[0]?.refundState).toBe('PROCESSING');
    expect(
      reconcileWechatPayBill(historical.rows, [
        {
          outTradeNo: current.outTradeNo,
          transactionId: current.transactionId,
          totalFen: null,
          tradeState: 'REFUND',
          outRefundNo: current.outRefundNo,
          refundId: current.refundId,
          refundFen: current.refundFen,
          refundState: null,
        },
      ]),
    ).toEqual({ matchedCount: 1, issues: [] });
  });
  test('refund reason is bounded in UTF-8 bytes, including multi-byte text, before any provider request', async () => {
    const input = {
      outTradeNo: 'SCB_ORDER_1',
      outRefundNo: 'SCB_REFUND_1',
      totalFen: 100,
      refundFen: 100,
      currency: 'CNY' as const,
    };
    for (const reason of ['中'.repeat(27), '🏀'.repeat(21), 'a'.repeat(81)]) {
      await expect(client().refund({ ...input, reason })).rejects.toMatchObject({
        code: 'PAYMENT_INPUT_INVALID',
      });
    }
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(response(refund()));
    await expect(
      client().refund({ ...input, reason: '中'.repeat(26) + 'ab' }),
    ).resolves.toMatchObject({ state: 'PROCESSING' });
    expect(Buffer.byteLength(JSON.parse(transport.mock.calls[0]![1].body).reason, 'utf8')).toBe(80);
  });
  test('accepts official backslash-escaped quotes in unused description fields without treating them as CSV delimiters', () => {
    const raw = billRows({ 商品名称: 'software \\"quoted\\" description' });
    expect(parseWechatPayBill(raw, config.merchantId!, config.appId!)[0]?.totalFen).toBe(100);
  });
});

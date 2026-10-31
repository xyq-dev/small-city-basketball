import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { ApiError } from '../errors.js';

export interface WechatPayConfig {
  enabled: boolean;
  /** Explicitly opt into JSAPI queries/notifications; legacy software checkout stays Native-only. */
  allowJsapi?: boolean;
  appId?: string;
  merchantId?: string;
  serialNo?: string;
  privateKeyPem?: string;
  apiV3Key?: string;
  platformKeys?: Record<string, string>;
  notifyUrl?: string;
}
export interface WechatPayOrder {
  outTradeNo: string;
  transactionId: string | null;
  state: 'SUCCESS' | 'REFUND' | 'NOTPAY' | 'CLOSED' | 'REVOKED' | 'USERPAYING' | 'PAYERROR';
  totalFen: number;
  currency: 'CNY';
  successTime: string | null;
}
export interface WechatPayRefund {
  outTradeNo: string;
  outRefundNo: string;
  transactionId: string;
  refundId: string;
  state: 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL';
  totalFen: number;
  refundFen: number;
  currency: 'CNY';
  successTime: string | null;
  /** Provider refund acceptance time, never the notification envelope creation time. */
  createdTime: string | null;
}
export type WechatPayNotification =
  | { id: string; kind: 'PAYMENT'; payment: WechatPayOrder }
  | { id: string; kind: 'REFUND'; refund: WechatPayRefund };
export interface WechatPayBillRow {
  outTradeNo: string;
  transactionId: string;
  /** Refund bill rows contain 0.00 as a placeholder, not the original order total. */
  totalFen: number | null;
  tradeState: 'SUCCESS' | 'REFUND';
  outRefundNo: string | null;
  refundId: string | null;
  /** Original application amount, including coupon portions, rather than settlement proceeds. */
  refundFen: number | null;
  /** Issued-bill snapshot. null is also an explicit local-expectation wildcard, never an actual refund state. */
  refundState: string | null;
}
export interface WechatPayBill {
  date: string;
  hashType: 'SHA1';
  hashValue: string;
  bodyHash: string;
  rows: WechatPayBillRow[];
}
export interface WechatPayDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  nonce?: () => string;
}
type HeadersInput = Record<string, string | string[] | undefined>;
type Json = Record<string, unknown>;
const ORIGIN = 'https://api.mch.weixin.qq.com';
const JSON_LIMIT = 256 * 1024;
const BILL_LIMIT = 4 * 1024 * 1024;
export const WECHATPAY_MAX_FEN = 100_000_000;
const resultError = () =>
  new ApiError(502, 'PAYMENT_PROVIDER_INVALID_RESPONSE', '支付服务结果无法核验，请查询原订单');
const signatureError = () =>
  new ApiError(401, 'PAYMENT_SIGNATURE_INVALID', '支付通知或应答签名无效');
const invalid = (): never => {
  throw new ApiError(422, 'PAYMENT_INPUT_INVALID', '支付参数无效');
};
const object = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function obj(value: unknown): Json {
  if (!object(value)) throw resultError();
  return value;
}
function str(value: unknown, max = 128): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw resultError();
  return value;
}
function fen(value: unknown, positive = true): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < (positive ? 1 : 0) ||
    Number(value) > WECHATPAY_MAX_FEN
  )
    throw resultError();
  return value as number;
}
function outTradeNo(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_*-]{1,32}$/.test(value)) invalid();
  return value as string;
}
function outRefundNo(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) invalid();
  return value as string;
}
function timestamp(value: unknown): string {
  const text = str(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text) ||
    !Number.isFinite(Date.parse(text))
  )
    throw resultError();
  return text;
}
function dateOnly(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    invalid();
  return value;
}
function jsonBody(value: Uint8Array): Json {
  try {
    return obj(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)));
  } catch {
    throw resultError();
  }
}
function base64(value: unknown, min: number, max: number): Buffer {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw signatureError();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== value)
    throw signatureError();
  return bytes;
}
function header(input: HeadersInput | Headers, name: string): string {
  if (input instanceof Headers) return input.get(name) ?? '';
  const matches = Object.entries(input).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1 || typeof matches[0]?.[1] !== 'string') throw signatureError();
  return matches[0][1];
}
async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw resultError();
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw resultError();
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** APIv3 Native protocol. Disabled unless the complete merchant configuration is supplied. */
export class WechatPayClient {
  readonly enabled: boolean;
  private readonly config: WechatPayConfig;
  private readonly privateKey: KeyObject | null;
  private readonly platformKeys = new Map<string, KeyObject>();
  private readonly transport: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly nonce: () => string;
  constructor(
    config: WechatPayConfig = { enabled: false },
    dependencies: WechatPayDependencies = {},
  ) {
    this.enabled = config.enabled === true;
    this.config = { ...config, platformKeys: { ...config.platformKeys } };
    this.transport = dependencies.fetch ?? globalThis.fetch;
    this.now = dependencies.now ?? Date.now;
    this.nonce = dependencies.nonce ?? (() => randomBytes(16).toString('hex'));
    this.privateKey = null;
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean')
      throw new Error('Invalid WechatPay enabled flag');
    if (config.allowJsapi !== undefined && typeof config.allowJsapi !== 'boolean')
      throw new Error('Invalid WechatPay JSAPI flag');
    if (!this.enabled) return;
    try {
      if (
        !/^wx[A-Za-z0-9]{16}$/.test(config.appId ?? '') ||
        !/^\d{6,20}$/.test(config.merchantId ?? '') ||
        !/^[A-Za-z0-9_]{8,128}$/.test(config.serialNo ?? '') ||
        Buffer.byteLength(config.apiV3Key ?? '', 'utf8') !== 32
      )
        throw new Error();
      const url = new URL(config.notifyUrl ?? '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.port && url.port !== '443')
      )
        throw new Error();
      this.privateKey = createPrivateKey(config.privateKeyPem ?? '');
      if (
        this.privateKey.asymmetricKeyType !== 'rsa' ||
        (this.privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        (this.privateKey.asymmetricKeyDetails?.modulusLength ?? 8192) > 4096
      )
        throw new Error();
      const entries = Object.entries(config.platformKeys ?? {});
      if (!entries.length || entries.length > 8) throw new Error();
      for (const [serial, pem] of entries) {
        if (!/^[A-Za-z0-9_]{8,128}$/.test(serial)) throw new Error();
        const key = createPublicKey(pem);
        if (
          key.asymmetricKeyType !== 'rsa' ||
          (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
          (key.asymmetricKeyDetails?.modulusLength ?? 8192) > 4096
        )
          throw new Error();
        this.platformKeys.set(serial, key);
      }
    } catch {
      throw new Error('Complete valid WechatPay merchant configuration is required');
    }
  }
  private assertEnabled(): void {
    if (!this.enabled) throw new ApiError(503, 'PAYMENT_PROVIDER_DISABLED', '微信支付尚未开通');
  }
  private signedHeaders(method: string, path: string, body: string) {
    this.assertEnabled();
    const ts = String(Math.floor(this.now() / 1000));
    const nonce = this.nonce();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) throw new Error('Invalid WechatPay nonce generator');
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${method}\n${path}\n${ts}\n${nonce}\n${body}\n`),
      this.privateKey!,
    ).toString('base64');
    return {
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${this.config.serialNo}"`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }
  private verifyBody(body: Buffer, headers: HeadersInput | Headers): void {
    this.assertEnabled();
    const ts = header(headers, 'Wechatpay-Timestamp');
    const nonce = header(headers, 'Wechatpay-Nonce');
    const serial = header(headers, 'Wechatpay-Serial');
    const signature = header(headers, 'Wechatpay-Signature');
    if (
      !/^[1-9]\d{8,11}$/.test(ts) ||
      Math.abs(this.now() / 1000 - Number(ts)) > 300 ||
      !/^[\x21-\x7e]{1,128}$/.test(nonce) ||
      signature.startsWith('WECHATPAY/SIGNTEST/')
    )
      throw signatureError();
    const key = this.platformKeys.get(serial);
    if (!key) throw signatureError();
    const signatureBytes = base64(signature, 256, 512);
    const message = Buffer.concat([Buffer.from(`${ts}\n${nonce}\n`), body, Buffer.from('\n')]);
    if (!verify('RSA-SHA256', message, key, signatureBytes)) throw signatureError();
  }
  private async request(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Json> {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const headers = this.signedHeaders(method, path, body);
    let response: Response, raw: Buffer;
    try {
      response = await this.transport(`${ORIGIN}${path}`, {
        method,
        headers,
        ...(body ? { body } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      raw = await boundedBody(response, JSON_LIMIT);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        'PAYMENT_PROVIDER_RESULT_UNKNOWN',
        '支付服务结果暂不确定，请查询原订单',
      );
    }
    this.verifyBody(raw, response.headers);
    const result = jsonBody(raw);
    if (!response.ok)
      throw new ApiError(502, 'PAYMENT_PROVIDER_REJECTED', '支付服务未接受请求，请核查原订单', {
        providerCode:
          typeof result.code === 'string' && /^[A-Z_]{1,64}$/.test(result.code)
            ? result.code
            : 'UNKNOWN',
      });
    return result;
  }
  async native(order: {
    outTradeNo: string;
    description: string;
    totalFen: number;
    currency: 'CNY';
    expiresAt?: string;
    profitSharing?: boolean;
  }): Promise<{ codeUrl: string }> {
    const no = outTradeNo(order.outTradeNo);
    if (order.profitSharing !== undefined && typeof order.profitSharing !== 'boolean') invalid();
    if (
      order.currency !== 'CNY' ||
      !Number.isSafeInteger(order.totalFen) ||
      order.totalFen < 1 ||
      order.totalFen > WECHATPAY_MAX_FEN ||
      typeof order.description !== 'string' ||
      Array.from(order.description).length < 1 ||
      Array.from(order.description).length > 127 ||
      /[\u0000-\u001f\u007f]/.test(order.description)
    )
      invalid();
    if (
      order.expiresAt &&
      (!Number.isFinite(Date.parse(order.expiresAt)) || Date.parse(order.expiresAt) <= this.now())
    )
      invalid();
    const result = await this.request('POST', '/v3/pay/transactions/native', {
      appid: this.config.appId,
      mchid: this.config.merchantId,
      description: order.description,
      out_trade_no: no,
      notify_url: this.config.notifyUrl,
      ...(order.expiresAt ? { time_expire: timestamp(order.expiresAt) } : {}),
      amount: { total: order.totalFen, currency: 'CNY' },
      ...(order.profitSharing === true ? { settle_info: { profit_sharing: true } } : {}),
    });
    const codeUrl = str(result.code_url, 2048);
    try {
      const url = new URL(codeUrl);
      if (
        url.protocol !== 'weixin:' ||
        url.hostname !== 'wxpay' ||
        url.pathname !== '/bizpayurl' ||
        !url.search ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error();
    } catch {
      throw resultError();
    }
    return { codeUrl };
  }
  async jsapi(order: {
    outTradeNo: string;
    description: string;
    totalFen: number;
    currency: 'CNY';
    expiresAt?: string;
    profitSharing?: boolean;
    openid: string;
  }): Promise<{
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
  }> {
    this.assertEnabled();
    if (this.config.allowJsapi !== true)
      throw new ApiError(503, 'PAYMENT_CHANNEL_DISABLED', '当前商户未启用小程序支付');
    const no = outTradeNo(order.outTradeNo);
    if (
      order.currency !== 'CNY' ||
      !Number.isSafeInteger(order.totalFen) ||
      order.totalFen < 1 ||
      order.totalFen > WECHATPAY_MAX_FEN ||
      typeof order.description !== 'string' ||
      Array.from(order.description).length < 1 ||
      Array.from(order.description).length > 127 ||
      /[\u0000-\u001f\u007f]/.test(order.description) ||
      typeof order.openid !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(order.openid) ||
      (order.profitSharing !== undefined && typeof order.profitSharing !== 'boolean') ||
      (order.expiresAt !== undefined &&
        (!Number.isFinite(Date.parse(order.expiresAt)) ||
          Date.parse(order.expiresAt) <= this.now()))
    )
      invalid();
    const result = await this.request('POST', '/v3/pay/transactions/jsapi', {
      appid: this.config.appId,
      mchid: this.config.merchantId,
      description: order.description,
      out_trade_no: no,
      notify_url: this.config.notifyUrl,
      ...(order.expiresAt ? { time_expire: timestamp(order.expiresAt) } : {}),
      amount: { total: order.totalFen, currency: 'CNY' },
      payer: { openid: order.openid },
      ...(order.profitSharing === true ? { settle_info: { profit_sharing: true } } : {}),
    });
    const prepay = str(result.prepay_id, 128);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(prepay)) throw resultError();
    const timeStamp = String(Math.floor(this.now() / 1000)),
      nonceStr = this.nonce(),
      packageValue = 'prepay_id=' + prepay;
    if (!/^[0-9]{1,16}$/.test(timeStamp) || !/^[A-Za-z0-9_-]{1,64}$/.test(nonceStr))
      throw resultError();
    return {
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: 'RSA',
      paySign: sign(
        'RSA-SHA256',
        Buffer.from(`${this.config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`),
        this.privateKey!,
      ).toString('base64'),
    };
  }
  private order(value: Json): WechatPayOrder {
    if (
      value.appid !== this.config.appId ||
      value.mchid !== this.config.merchantId ||
      !(
        value.trade_type === 'NATIVE' ||
        (this.config.allowJsapi === true && value.trade_type === 'JSAPI')
      )
    )
      throw resultError();
    const amount = obj(value.amount);
    const state = str(value.trade_state);
    if (
      !['SUCCESS', 'REFUND', 'NOTPAY', 'CLOSED', 'REVOKED', 'USERPAYING', 'PAYERROR'].includes(
        state,
      ) ||
      amount.currency !== 'CNY'
    )
      throw resultError();
    const paid = state === 'SUCCESS' || state === 'REFUND';
    const transactionId = value.transaction_id === undefined ? null : str(value.transaction_id, 64);
    const successTime = value.success_time === undefined ? null : timestamp(value.success_time);
    if (paid && (!transactionId || !successTime)) throw resultError();
    return {
      outTradeNo: outTradeNo(value.out_trade_no),
      transactionId,
      state: state as WechatPayOrder['state'],
      totalFen: fen(amount.total),
      currency: 'CNY',
      successTime,
    };
  }
  async queryOrder(no: string): Promise<WechatPayOrder> {
    no = outTradeNo(no);
    const result = this.order(
      await this.request(
        'GET',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(no)}?mchid=${this.config.merchantId}`,
      ),
    );
    if (result.outTradeNo !== no) throw resultError();
    return result;
  }
  private refundResult(value: Json, requireCreatedTime = true): WechatPayRefund {
    if (value.mchid !== undefined && value.mchid !== this.config.merchantId) throw resultError();
    const amount = obj(value.amount);
    const state = str(value.status ?? value.refund_status);
    if (
      !['SUCCESS', 'CLOSED', 'PROCESSING', 'ABNORMAL'].includes(state) ||
      (amount.currency !== undefined && amount.currency !== 'CNY')
    )
      throw resultError();
    const totalFen = fen(amount.total),
      refundFen = fen(amount.refund);
    if (refundFen > totalFen) throw resultError();
    const successTime = value.success_time === undefined ? null : timestamp(value.success_time);
    if (state === 'SUCCESS' && !successTime) throw resultError();
    const createdTime = value.create_time === undefined ? null : timestamp(value.create_time);
    if (
      (requireCreatedTime && !createdTime) ||
      (createdTime && successTime && Date.parse(createdTime) > Date.parse(successTime))
    )
      throw resultError();
    return {
      outTradeNo: outTradeNo(value.out_trade_no),
      outRefundNo: outRefundNo(value.out_refund_no),
      transactionId: str(value.transaction_id, 64),
      refundId: str(value.refund_id, 64),
      state: state as WechatPayRefund['state'],
      createdTime,
      totalFen,
      refundFen,
      currency: 'CNY',
      successTime,
    };
  }
  async refund(input: {
    outTradeNo: string;
    outRefundNo: string;
    totalFen: number;
    refundFen: number;
    currency: 'CNY';
    reason?: string;
  }): Promise<WechatPayRefund> {
    const no = outTradeNo(input.outTradeNo),
      refundNo = outRefundNo(input.outRefundNo);
    if (
      input.currency !== 'CNY' ||
      !Number.isSafeInteger(input.totalFen) ||
      !Number.isSafeInteger(input.refundFen) ||
      input.totalFen < 1 ||
      input.totalFen > WECHATPAY_MAX_FEN ||
      input.refundFen < 1 ||
      input.refundFen > input.totalFen ||
      (input.reason !== undefined &&
        (typeof input.reason !== 'string' ||
          Buffer.byteLength(input.reason, 'utf8') > 80 ||
          /[\u0000-\u001f\u007f]/.test(input.reason)))
    )
      invalid();
    const result = this.refundResult(
      await this.request('POST', '/v3/refund/domestic/refunds', {
        out_trade_no: no,
        out_refund_no: refundNo,
        notify_url: this.config.notifyUrl,
        ...(input.reason ? { reason: input.reason } : {}),
        amount: { total: input.totalFen, refund: input.refundFen, currency: 'CNY' },
      }),
    );
    if (
      result.outTradeNo !== no ||
      result.outRefundNo !== refundNo ||
      result.totalFen !== input.totalFen ||
      result.refundFen !== input.refundFen
    )
      throw resultError();
    return result;
  }
  async queryRefund(no: string): Promise<WechatPayRefund> {
    no = outRefundNo(no);
    const result = this.refundResult(
      await this.request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(no)}`),
    );
    if (result.outRefundNo !== no) throw resultError();
    return result;
  }
  verifyNotification(rawBody: Buffer, headers: HeadersInput): WechatPayNotification {
    if (!Buffer.isBuffer(rawBody) || !rawBody.length || rawBody.length > JSON_LIMIT)
      throw signatureError();
    this.verifyBody(rawBody, headers);
    const outer = jsonBody(rawBody),
      resource = obj(outer.resource);
    const id = str(outer.id, 128),
      eventType = str(outer.event_type, 64);
    if (outer.resource_type !== 'encrypt-resource' || resource.algorithm !== 'AEAD_AES_256_GCM')
      throw resultError();
    const nonce = str(resource.nonce, 32);
    if (
      Buffer.byteLength(nonce) !== 12 ||
      (resource.associated_data !== undefined && typeof resource.associated_data !== 'string')
    )
      throw resultError();
    const ciphertext = base64(resource.ciphertext, 17, JSON_LIMIT);
    let decrypted: Buffer;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.config.apiV3Key!, 'utf8'),
        Buffer.from(nonce),
      );
      decipher.setAuthTag(ciphertext.subarray(-16));
      decipher.setAAD(Buffer.from((resource.associated_data ?? '') as string, 'utf8'));
      decrypted = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
    } catch {
      throw resultError();
    }
    const result = jsonBody(decrypted);
    if (eventType === 'TRANSACTION.SUCCESS') {
      const payment = this.order(result);
      if (payment.state !== 'SUCCESS') throw resultError();
      return { id, kind: 'PAYMENT', payment };
    }
    if (['REFUND.SUCCESS', 'REFUND.ABNORMAL', 'REFUND.CLOSED'].includes(eventType)) {
      if (result.mchid !== this.config.merchantId) throw resultError();
      const refund = this.refundResult(result, false);
      if (refund.state !== eventType.slice(7)) throw resultError();
      return { id, kind: 'REFUND', refund };
    }
    throw resultError();
  }
  async downloadBill(date: string): Promise<WechatPayBill> {
    dateOnly(date);
    const current = new Date(this.now() + 8 * 3600_000).toISOString().slice(0, 10);
    if (date >= current || this.now() - Date.parse(`${date}T00:00:00+08:00`) > 93 * 86_400_000)
      invalid();
    const metadata = await this.request(
      'GET',
      `/v3/bill/tradebill?bill_date=${date}&bill_type=ALL`,
    );
    if (
      metadata.hash_type !== 'SHA1' ||
      typeof metadata.hash_value !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(metadata.hash_value)
    )
      throw resultError();
    const downloadUrl = str(metadata.download_url, 2048);
    let path: string;
    try {
      const url = new URL(downloadUrl);
      if (
        url.origin !== ORIGIN ||
        url.username ||
        url.password ||
        url.pathname !== '/v3/billdownload/file' ||
        !url.search ||
        url.hash
      )
        throw new Error();
      path = url.pathname + url.search;
    } catch {
      throw resultError();
    }
    let raw: Buffer;
    try {
      const response = await this.transport(downloadUrl, {
        method: 'GET',
        headers: this.signedHeaders('GET', path, ''),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw resultError();
      raw = await boundedBody(response, BILL_LIMIT);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        'PAYMENT_PROVIDER_RESULT_UNKNOWN',
        '账单暂时无法核验，请重新申请下载',
      );
    }
    // Bill file downloads are the documented response-signature exception; the metadata was signed.
    const hashValue = createHash('sha1').update(raw).digest('hex');
    if (hashValue !== metadata.hash_value.toLowerCase()) throw resultError();
    const rows = parseWechatPayBill(raw, this.config.merchantId!, this.config.appId!);
    return {
      date,
      hashType: 'SHA1',
      hashValue,
      bodyHash: createHash('sha256').update(raw).digest('hex'),
      rows,
    };
  }
}

/** Decimal yuan to fen without binary floating point, exponents, signs or silent rounding. */
export function wechatPayYuanToFen(value: string): number {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) throw resultError();
  const [whole, decimal = ''] = value.split('.');
  return fen(Number(whole) * 100 + Number(decimal.padEnd(2, '0')), false);
}
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    ended = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!quoted && c === '\\' && text[i + 1] === '"') {
      field += '\\"';
      i++;
    } else if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        ended = true;
      } else field += c;
    } else if (c === '"') {
      if (field || ended) throw resultError();
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      ended = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      ended = false;
      if (rows.length > 10_003) throw resultError();
    } else {
      if (ended) throw resultError();
      field += c;
    }
  }
  if (quoted) throw resultError();
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
/** Parses modern ALL bills. Legacy layouts without original order amount fail closed. */
export function parseWechatPayBill(
  body: Buffer,
  merchantId: string,
  appId: string,
): WechatPayBillRow[] {
  if (!Buffer.isBuffer(body) || body.length > BILL_LIMIT) throw resultError();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body).replace(/^\ufeff/, '');
  } catch {
    throw resultError();
  }
  const records = csvRows(text);
  const headings = records.shift();
  if (!headings || new Set(headings).size !== headings.length) throw resultError();
  const required = [
    '公众账号ID',
    '商户号',
    '微信订单号',
    '商户订单号',
    '交易状态',
    '货币种类',
    '订单金额',
    '微信退款单号',
    '商户退款单号',
    '退款金额',
    '申请退款金额',
    '退款状态',
  ];
  if (required.some((name) => !headings.includes(name))) throw resultError();
  const seen = new Set<string>(),
    rows: WechatPayBillRow[] = [];
  let summary = false;
  for (let index = 0; index < records.length; index++) {
    const line = records[index]!;
    if (line.length === 1 && line[0] === '' && index === records.length - 1) continue;
    if (line[0] === '总交易单数') {
      if (summary || index !== records.length - 2 || !records[index + 1]?.length)
        throw resultError();
      const sum = records[index + 1]!;
      if (
        sum.length !== line.length ||
        !/^`?(?:0|[1-9]\d*)$/.test(sum[0] ?? '') ||
        Number(sum[0]!.replace(/^`/, '')) !== rows.length
      )
        throw resultError();
      summary = true;
      index++;
      continue;
    }
    if (summary || line.length !== headings.length) throw resultError();
    const values = Object.fromEntries(
      headings.map((name, i) => [name, line[i]!.replace(/^`/, '')]),
    );
    if (
      values['公众账号ID'] !== appId ||
      values['商户号'] !== merchantId ||
      values['货币种类'] !== 'CNY' ||
      !['SUCCESS', 'REFUND'].includes(values['交易状态']!)
    )
      throw resultError();
    const no = outTradeNo(values['商户订单号']),
      transactionId = str(values['微信订单号'], 64);
    const isRefund = values['交易状态'] === 'REFUND';
    // Official SUCCESS rows use numeric zero as the absent-refund sentinel.
    const noRefund = (value: string | undefined) => value === '' || value === '0';
    const refundNo = isRefund ? outRefundNo(values['商户退款单号']) : null;
    const refundId = isRefund ? str(values['微信退款单号'], 64) : null;
    if (
      isRefund
        ? refundNo === '0' || refundId === '0'
        : !noRefund(values['商户退款单号']) || !noRefund(values['微信退款单号'])
    )
      throw resultError();
    const identity = `${transactionId}|${refundNo ?? 'PAYMENT'}`;
    if (seen.has(identity) || rows.length >= 10_000) throw resultError();
    seen.add(identity);
    const rawOrderFen = wechatPayYuanToFen(values['订单金额']!);
    const applicationRefundFen = wechatPayYuanToFen(values['申请退款金额']!);
    const settlementRefundFen = wechatPayYuanToFen(values['退款金额']!);
    const refundState = isRefund ? str(values['退款状态'], 32) : null;
    if (isRefund) {
      // The original order total is not present on refund rows. It is verified against the payment ledger elsewhere.
      if (
        rawOrderFen !== 0 ||
        !applicationRefundFen ||
        settlementRefundFen > applicationRefundFen ||
        !['SUCCESS', 'PROCESSING', 'FAIL', 'CHANGE'].includes(refundState!)
      )
        throw resultError();
    } else if (
      !rawOrderFen ||
      applicationRefundFen !== 0 ||
      settlementRefundFen !== 0 ||
      values['退款状态'] !== ''
    )
      throw resultError();
    const totalFen = isRefund ? null : rawOrderFen;
    // The settlement amount excludes non-cash coupons; compare the application amount to the refund request.
    const refundFen = isRefund ? applicationRefundFen : null;
    rows.push({
      outTradeNo: no,
      transactionId,
      totalFen,
      tradeState: values['交易状态'] as 'SUCCESS' | 'REFUND',
      outRefundNo: refundNo,
      refundId,
      refundFen,
      refundState,
    });
  }
  if (!summary) throw resultError();
  return rows;
}

export interface WechatPayReconciliation {
  matchedCount: number;
  issues: {
    code:
      'PROVIDER_ONLY' | 'LOCAL_ONLY' | 'IDENTITY_MISMATCH' | 'AMOUNT_MISMATCH' | 'STATE_MISMATCH';
    outTradeNo: string;
    outRefundNo: string | null;
  }[];
}
/** Compare records for the requested bill day only. A discrepancy never grants/revokes rights. */
export function reconcileWechatPayBill(
  rows: WechatPayBillRow[],
  expected: WechatPayBillRow[],
): WechatPayReconciliation {
  if (
    !Array.isArray(rows) ||
    !Array.isArray(expected) ||
    rows.length > 10_000 ||
    expected.length > 10_000
  )
    invalid();
  const key = (row: WechatPayBillRow) => `${row.outTradeNo}|${row.outRefundNo ?? 'PAYMENT'}`;
  const checkedMap = (items: WechatPayBillRow[], local = false) => {
    const mapped = new Map<string, WechatPayBillRow>();
    for (const row of items) {
      if (!row || typeof row !== 'object') invalid();
      outTradeNo(row.outTradeNo);
      str(row.transactionId, 64);
      if (row.tradeState === 'SUCCESS') {
        fen(row.totalFen);
        if (
          row.outRefundNo !== null ||
          row.refundId !== null ||
          row.refundFen !== null ||
          row.refundState !== null
        )
          invalid();
      } else if (row.tradeState === 'REFUND') {
        outRefundNo(row.outRefundNo);
        str(row.refundId, 64);
        fen(row.refundFen);
        if (
          row.totalFen !== null ||
          row.outRefundNo === '0' ||
          row.refundId === '0' ||
          (!(local && row.refundState === null) &&
            !['SUCCESS', 'PROCESSING', 'FAIL', 'CHANGE'].includes(row.refundState!))
        )
          invalid();
      } else invalid();
      if (mapped.has(key(row))) invalid();
      mapped.set(key(row), row);
    }
    return mapped;
  };
  const actual = checkedMap(rows),
    local = checkedMap(expected, true);
  const result: WechatPayReconciliation = { matchedCount: 0, issues: [] };
  for (const [identity, row] of actual) {
    const match = local.get(identity);
    let code: WechatPayReconciliation['issues'][number]['code'] | null = null;
    if (!match) code = 'PROVIDER_ONLY';
    else if (row.transactionId !== match.transactionId || row.refundId !== match.refundId)
      code = 'IDENTITY_MISMATCH';
    else if (row.totalFen !== match.totalFen || row.refundFen !== match.refundFen)
      code = 'AMOUNT_MISMATCH';
    // A bill freezes the refund state when issued. null expected state requests identity/amount-only comparison, not today's settlement state.
    else if (
      row.tradeState !== match.tradeState ||
      (match.refundState !== null && row.refundState !== match.refundState)
    )
      code = 'STATE_MISMATCH';
    if (code)
      result.issues.push({ code, outTradeNo: row.outTradeNo, outRefundNo: row.outRefundNo });
    else result.matchedCount++;
  }
  for (const [identity, row] of local) {
    if (!actual.has(identity))
      result.issues.push({
        code: 'LOCAL_ONLY',
        outTradeNo: row.outTradeNo,
        outRefundNo: row.outRefundNo,
      });
  }
  result.issues.sort((a, b) =>
    `${a.outTradeNo}|${a.outRefundNo ?? ''}|${a.code}`.localeCompare(
      `${b.outTradeNo}|${b.outRefundNo ?? ''}|${b.code}`,
      'en',
    ),
  );
  return result;
}

import {
  createPrivateKey,
  publicEncrypt,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import type { WechatPayConfig, WechatPayDependencies } from './commerce/wechatpay.js';
import type { TradeReturnResult } from './trade-provider.js';
import { tradeFail, tradeFen } from './trade-domain.js';

export interface SponsorSplitInput {
  transactionId: string;
  outOrderNo: string;
  receivers: Array<{ merchantId: string; displayName: string; amountFen: number }>;
}
export interface SponsorSplitResult {
  transactionId: string;
  outOrderNo: string;
  orderId: string | null;
  state: 'PROCESSING' | 'FINISHED';
  receivers: Array<{
    merchantId: string;
    amountFen: number;
    result: 'PENDING' | 'SUCCESS' | 'CLOSED';
    detailId: string | null;
  }>;
}
export interface SponsorReturnInput {
  outOrderNo: string;
  outReturnNo: string;
  receiverMerchantId: string;
  amountFen: number;
}
export interface SponsorFinishInput {
  transactionId: string;
  outOrderNo: string;
  maximumFen: number;
}
export interface SponsorFinishResult {
  transactionId: string;
  outOrderNo: string;
  orderId: string;
  state: 'PROCESSING' | 'FINISHED';
}
export interface SponsorSettlementProvider {
  readonly enabled: boolean;
  readonly returnSupported: boolean;
  split(input: SponsorSplitInput): Promise<SponsorSplitResult>;
  querySplit(input: SponsorSplitInput): Promise<SponsorSplitResult>;
  returnFunds(input: SponsorReturnInput): Promise<TradeReturnResult>;
  queryReturn(input: SponsorReturnInput): Promise<TradeReturnResult>;
  finish(input: SponsorFinishInput): Promise<SponsorFinishResult>;
  queryFinish(input: SponsorFinishInput): Promise<SponsorFinishResult>;
}

type Json = Record<string, unknown>;
export interface TradeWechatMultiConfig extends WechatPayConfig {
  /** Merchant has enabled returns and every server-approved receiver has consented to return. */
  returnsEnabled?: boolean;
  encryptionSerial?: string;
}
const origin = 'https://api.mch.weixin.qq.com';
const invalid = () =>
  tradeFail('TRADE_PROVIDER_INVALID_RESPONSE', '渠道结果无法核验，保留原编号查询', 502);
const object = (v: unknown): Json => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
  return v as Json;
};
const str = (v: unknown, max = 128): string => {
  if (typeof v !== 'string' || !v || v.length > max || /[\u0000-\u001f\u007f]/.test(v))
    return invalid();
  return v;
};
const number = (v: unknown): number => {
  try {
    return tradeFen(v);
  } catch {
    return invalid();
  }
};
const no = (v: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) tradeFail('INVALID_TRADE_INPUT', '渠道编号无效', 422);
  return v;
};
/** Ordinary merchant v3 API only. Fixed origin, signed requests, pinned platform keys; no partner sub_mchid. */
export class TradeWechatMultiClient implements SponsorSettlementProvider {
  readonly enabled: boolean;
  readonly returnSupported: boolean;
  private privateKey?: KeyObject;
  private platformKeys = new Map<string, KeyObject>();
  private transport: typeof fetch;
  private now: () => number;
  private nonce: () => string;
  constructor(
    private config: TradeWechatMultiConfig,
    deps: WechatPayDependencies = {},
  ) {
    this.enabled = config.enabled === true;
    this.returnSupported = this.enabled && config.returnsEnabled === true;
    this.transport = deps.fetch ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
    this.nonce = deps.nonce ?? (() => randomBytes(16).toString('hex'));
    if (!this.enabled) return;
    if (!config.encryptionSerial || !config.platformKeys?.[config.encryptionSerial])
      throw Error('Split encryption key missing');
    if (
      !config.appId ||
      !config.merchantId ||
      !config.serialNo ||
      !config.privateKeyPem ||
      !config.platformKeys ||
      !Object.keys(config.platformKeys).length
    )
      throw Error('Trade settlement configuration incomplete');
    for (const v of [config.appId, config.merchantId, config.serialNo])
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw Error('Trade settlement identity invalid');
    this.privateKey = createPrivateKey(config.privateKeyPem);
    if (
      this.privateKey.asymmetricKeyType !== 'rsa' ||
      (this.privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw Error('Trade settlement RSA key invalid');
    for (const [serial, pem] of Object.entries(config.platformKeys)) {
      const key = createPublicKey(pem);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
        throw Error('Trade settlement platform key invalid');
      this.platformKeys.set(serial, key);
    }
  }
  private async request(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Json> {
    if (!this.enabled || !this.returnSupported)
      tradeFail('TRADE_SETTLEMENT_DISABLED', '分账及回退通道未共同启用', 503);
    const body = payload === undefined ? '' : JSON.stringify(payload),
      ts = String(Math.floor(this.now() / 1000)),
      nonce = this.nonce();
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${method}\n${path}\n${ts}\n${nonce}\n${body}\n`),
      this.privateKey!,
    ).toString('base64');
    let response: Response, raw: Buffer;
    try {
      response = await this.transport(origin + path, {
        method,
        headers: {
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${this.config.serialNo}"`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Wechatpay-Serial': this.config.encryptionSerial!,
        },
        ...(body ? { body } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.body) return invalid();
      const reader = response.body.getReader(),
        chunks: Buffer[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 262144) {
            await reader.cancel();
            return invalid();
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      raw = Buffer.concat(chunks);
    } catch {
      return tradeFail('TRADE_PROVIDER_RESULT_UNKNOWN', '渠道结果未知，请查询原编号', 503);
    }
    const stamp = response.headers.get('Wechatpay-Timestamp') ?? '',
      serverNonce = response.headers.get('Wechatpay-Nonce') ?? '',
      serial = response.headers.get('Wechatpay-Serial') ?? '',
      sig = response.headers.get('Wechatpay-Signature') ?? '';
    const key = this.platformKeys.get(serial);
    if (
      !key ||
      !/^[1-9]\d{8,11}$/.test(stamp) ||
      Math.abs(this.now() / 1000 - Number(stamp)) > 300 ||
      !/^[\x21-\x7e]{1,128}$/.test(serverNonce) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(sig) ||
      Buffer.from(sig, 'base64').length < 256 ||
      !verify(
        'RSA-SHA256',
        Buffer.concat([Buffer.from(`${stamp}\n${serverNonce}\n`), raw, Buffer.from('\n')]),
        key,
        Buffer.from(sig, 'base64'),
      )
    )
      return invalid();
    let result: Json;
    try {
      result = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    } catch {
      return invalid();
    }
    if (!response.ok)
      tradeFail('TRADE_PROVIDER_RESULT_UNKNOWN', '渠道未确认成功，继续查询原编号', 502);
    return result;
  }

  private splitInput(i: SponsorSplitInput) {
    no(i.outOrderNo);
    no(i.transactionId);
    if (
      !i.receivers.length ||
      i.receivers.length > 10 ||
      new Set(i.receivers.map((x) => x.merchantId)).size !== i.receivers.length
    )
      tradeFail('INVALID_TRADE_INPUT', '接收方数量或身份无效', 422);
    for (const r of i.receivers) {
      no(r.merchantId);
      tradeFen(r.amountFen);
      str(r.displayName, 120);
      if (r.merchantId === this.config.merchantId)
        tradeFail('INVALID_TRADE_INPUT', '商户留存不发送分账', 422);
    }
  }
  private splitResult(v: Json, i: SponsorSplitInput): SponsorSplitResult {
    if (
      v.transaction_id !== i.transactionId ||
      v.out_order_no !== i.outOrderNo ||
      !['PROCESSING', 'FINISHED'].includes(String(v.state)) ||
      !Array.isArray(v.receivers) ||
      v.receivers.length !== i.receivers.length
    )
      return invalid();
    const seen = new Set<string>();
    const receivers = v.receivers.map((raw) => {
      const r = object(raw),
        account = str(r.account),
        expected = i.receivers.find((x) => x.merchantId === account);
      if (
        !expected ||
        seen.has(account) ||
        r.type !== 'MERCHANT_ID' ||
        number(r.amount) !== expected.amountFen ||
        !['PENDING', 'SUCCESS', 'CLOSED'].includes(String(r.result)) ||
        (r.result === 'SUCCESS' && !r.detail_id) ||
        (v.state === 'FINISHED' && r.result === 'PENDING')
      )
        return invalid();
      seen.add(account);
      return {
        merchantId: account,
        amountFen: expected.amountFen,
        result: r.result as 'PENDING' | 'SUCCESS' | 'CLOSED',
        detailId: r.detail_id ? str(r.detail_id) : null,
      };
    });
    return {
      transactionId: i.transactionId,
      outOrderNo: i.outOrderNo,
      orderId: str(v.order_id),
      state: v.state as 'PROCESSING' | 'FINISHED',
      receivers,
    };
  }
  async split(i: SponsorSplitInput) {
    this.splitInput(i);
    if (!this.enabled) return tradeFail('TRADE_SETTLEMENT_DISABLED', '多方分账尚未开通', 503);
    const key = this.platformKeys.get(this.config.encryptionSerial!);
    if (!key) return invalid();
    return this.splitResult(
      await this.request('POST', '/v3/profitsharing/orders', {
        appid: this.config.appId,
        transaction_id: i.transactionId,
        out_order_no: i.outOrderNo,
        receivers: i.receivers.map((r) => ({
          type: 'MERCHANT_ID',
          account: r.merchantId,
          name: publicEncrypt({ key, oaepHash: 'sha1' }, Buffer.from(r.displayName)).toString(
            'base64',
          ),
          amount: r.amountFen,
          description: '广告合同分账',
        })),
        unfreeze_unsplit: false,
      }),
      i,
    );
  }
  async querySplit(i: SponsorSplitInput) {
    this.splitInput(i);
    return this.splitResult(
      await this.request(
        'GET',
        `/v3/profitsharing/orders/${encodeURIComponent(i.outOrderNo)}?transaction_id=${encodeURIComponent(i.transactionId)}`,
      ),
      i,
    );
  }
  private finishResult(v: Json, i: SponsorFinishInput): SponsorFinishResult {
    if (
      v.transaction_id !== i.transactionId ||
      v.out_order_no !== i.outOrderNo ||
      !['PROCESSING', 'FINISHED'].includes(String(v.state)) ||
      !Array.isArray(v.receivers) ||
      v.receivers.length !== 1
    )
      return invalid();
    const r = object(v.receivers[0]);
    if (
      r.type !== 'MERCHANT_ID' ||
      r.account !== this.config.merchantId ||
      !Number.isSafeInteger(r.amount) ||
      Number(r.amount) < 0 ||
      Number(r.amount) > i.maximumFen ||
      !['PENDING', 'SUCCESS'].includes(String(r.result)) ||
      (v.state === 'FINISHED' && r.result !== 'SUCCESS') ||
      (r.result === 'SUCCESS' && !r.detail_id)
    )
      return invalid();
    return {
      transactionId: i.transactionId,
      outOrderNo: i.outOrderNo,
      orderId: str(v.order_id),
      state: v.state as 'PROCESSING' | 'FINISHED',
    };
  }
  async finish(i: SponsorFinishInput) {
    no(i.transactionId);
    no(i.outOrderNo);
    if (!Number.isSafeInteger(i.maximumFen) || i.maximumFen < 0 || i.maximumFen > 100000000)
      tradeFail('INVALID_TRADE_INPUT', '解冻额度无效', 422);
    return this.finishResult(
      await this.request('POST', '/v3/profitsharing/orders/unfreeze', {
        transaction_id: i.transactionId,
        out_order_no: i.outOrderNo,
        description: '广告合同最终分账结束',
      }),
      i,
    );
  }
  async queryFinish(i: SponsorFinishInput) {
    no(i.transactionId);
    no(i.outOrderNo);
    return this.finishResult(
      await this.request(
        'GET',
        `/v3/profitsharing/orders/${encodeURIComponent(i.outOrderNo)}?transaction_id=${encodeURIComponent(i.transactionId)}`,
      ),
      i,
    );
  }
  private returnResult(
    v: Json,
    i: { outOrderNo: string; outReturnNo: string; receiverMerchantId: string; amountFen: number },
  ): TradeReturnResult {
    if (
      v.out_order_no !== i.outOrderNo ||
      v.out_return_no !== i.outReturnNo ||
      v.return_mchid !== i.receiverMerchantId ||
      number(v.amount) !== i.amountFen ||
      !['PROCESSING', 'SUCCESS', 'FAILED'].includes(String(v.result))
    )
      return invalid();
    return {
      outOrderNo: i.outOrderNo,
      outReturnNo: i.outReturnNo,
      returnId: str(v.return_id),
      merchantId: i.receiverMerchantId,
      amountFen: i.amountFen,
      state: v.result as TradeReturnResult['state'],
    };
  }
  async returnFunds(i: {
    outOrderNo: string;
    outReturnNo: string;
    receiverMerchantId: string;
    amountFen: number;
    description?: string;
  }) {
    no(i.outOrderNo);
    no(i.outReturnNo);
    no(i.receiverMerchantId);
    tradeFen(i.amountFen);
    return this.returnResult(
      await this.request('POST', '/v3/profitsharing/return-orders', {
        out_order_no: i.outOrderNo,
        out_return_no: i.outReturnNo,
        return_mchid: i.receiverMerchantId,
        amount: i.amountFen,
        description: str(i.description ?? '广告退款分账回退', 80),
      }),
      i,
    );
  }
  async queryReturn(i: {
    outOrderNo: string;
    outReturnNo: string;
    receiverMerchantId: string;
    amountFen: number;
  }) {
    no(i.outOrderNo);
    no(i.outReturnNo);
    return this.returnResult(
      await this.request(
        'GET',
        `/v3/profitsharing/return-orders/${encodeURIComponent(i.outReturnNo)}?out_order_no=${encodeURIComponent(i.outOrderNo)}`,
      ),
      i,
    );
  }
}

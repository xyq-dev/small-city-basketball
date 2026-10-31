import { readRequiredSecret } from './env.js';
import { WechatPayClient, type WechatPayConfig } from './commerce/wechatpay.js';
import { TradeWechatSettlementClient } from './trade-wechat-settlement.js';
import type { TradeRuntime, TradeMerchant } from './trade-provider.js';
type Json = Record<string, unknown>;
const failure = () => new Error('Trade configuration is incomplete or invalid');
function obj(v: unknown, allowed: string[]): Json {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    throw failure();
  return v as Json;
}
function text(v: unknown, max = 128): string {
  if (typeof v !== 'string' || !v || v.length > max || /[\u0000-\u001f\u007f]/.test(v))
    throw failure();
  return v;
}
const uuid = (v: unknown) => {
  const s = text(v, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s))
    throw failure();
  return s.toLowerCase();
};
function secret(v: unknown) {
  const name = text(v, 100);
  if (!/^SCB_TRADE_[A-Z0-9_]+$/.test(name) || name === 'SCB_TRADE_DATA_KEY') throw failure();
  return readRequiredSecret(name);
}
function bool(v: unknown) {
  if (v !== undefined && typeof v !== 'boolean') throw failure();
  return v === true;
}
/** Environment-only mapping. Disabled mode loads no keys and never starts a network call. */
export function readTradeRuntime(appOrigin: string): TradeRuntime {
  const enabled = process.env.SCB_TRADE_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled)) throw failure();
  if (enabled === 'false') return {};
  try {
    const origin = new URL(appOrigin);
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== appOrigin ||
      origin.username ||
      origin.password
    )
      throw failure();
    const dataKey = readRequiredSecret('SCB_TRADE_DATA_KEY');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(dataKey)) throw failure();
    const encryptionKey = Buffer.from(dataKey, 'base64');
    if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== dataKey)
      throw failure();
    const root = obj(JSON.parse(readRequiredSecret('SCB_TRADE_MERCHANTS_JSON')), [
      'merchants',
      'historical',
    ]);
    if (
      !Array.isArray(root.merchants) ||
      root.merchants.length > 32 ||
      !Array.isArray(root.historical ?? []) ||
      (Array.isArray(root.historical) ? root.historical.length : 0) > 64
    )
      throw failure();
    const merchants: Record<string, TradeMerchant> = {},
      historicalMerchants: Record<string, TradeMerchant> = {},
      keys = new Set<string>(),
      mchOrganizations = new Map<string, string>();
    for (const [isHistorical, rows] of [
      [false, root.merchants],
      [true, root.historical ?? []],
    ] as [boolean, unknown[]][])
      for (const raw of rows) {
        const row = obj(raw, [
          'orgId',
          'key',
          'merchantId',
          'appId',
          'displayName',
          'serialNo',
          'privateKeySecret',
          'apiV3KeySecret',
          'platformKeysSecret',
          'receivers',
          'jsapiEnabled',
          'playerFeesEnabled',
          'returnsEnabled',
        ]);
        const org = uuid(row.orgId),
          key = text(row.key, 80),
          merchantId = text(row.merchantId, 32),
          appId = text(row.appId, 32);
        if (
          !/^[A-Za-z0-9_-]{1,80}$/.test(key) ||
          !/^\d{6,32}$/.test(merchantId) ||
          !/^wx[a-fA-F0-9]{16}$/.test(appId) ||
          keys.has(key) ||
          (mchOrganizations.has(merchantId) && mchOrganizations.get(merchantId) !== org) ||
          (!isHistorical && merchants[org])
        )
          throw failure();
        keys.add(key);
        mchOrganizations.set(merchantId, org);
        const parsedKeys = JSON.parse(secret(row.platformKeysSecret));
        if (
          !parsedKeys ||
          typeof parsedKeys !== 'object' ||
          Array.isArray(parsedKeys) ||
          Object.keys(parsedKeys).length < 1 ||
          Object.keys(parsedKeys).length > 8 ||
          Object.entries(parsedKeys).some(
            ([k, v]) =>
              !/^[A-Za-z0-9_]{1,128}$/.test(k) || typeof v !== 'string' || v.length > 8192,
          )
        )
          throw failure();
        const apiV3Key = secret(row.apiV3KeySecret);
        if (Buffer.byteLength(apiV3Key) !== 32 || encryptionKey.equals(Buffer.from(apiV3Key)))
          throw failure();
        const config: WechatPayConfig & { allowJsapi: boolean } = {
          enabled: true,
          appId,
          merchantId,
          serialNo: text(row.serialNo),
          privateKeyPem: secret(row.privateKeySecret),
          apiV3Key,
          platformKeys: parsedKeys,
          notifyUrl: appOrigin + '/v1/trade-notifications/' + key,
          allowJsapi: bool(row.jsapiEnabled),
        };
        const receivers: TradeMerchant['receivers'] = {};
        if (
          !row.receivers ||
          typeof row.receivers !== 'object' ||
          Array.isArray(row.receivers) ||
          Object.keys(row.receivers).length > 100
        )
          throw failure();
        for (const [user, rawReceiver] of Object.entries(row.receivers)) {
          const v = obj(rawReceiver, ['merchantId', 'displayName']),
            receiver = text(v.merchantId, 32);
          if (!/^\d{6,32}$/.test(receiver) || receiver === merchantId) throw failure();
          receivers[uuid(user)] = { merchantId: receiver, displayName: text(v.displayName, 100) };
        }
        const m: TradeMerchant = {
          key,
          merchantId,
          appId,
          displayName: text(row.displayName, 100),
          payments: new WechatPayClient(config),
          playerFeesEnabled: bool(row.playerFeesEnabled),
          receivers,
          settlements: new TradeWechatSettlementClient({
            ...config,
            returnsEnabled: bool(row.returnsEnabled),
          }),
        };
        if (!config.allowJsapi) {
          const payments = m.payments;
          m.payments = {
            enabled: payments.enabled,
            native: payments.native.bind(payments),
            queryOrder: payments.queryOrder.bind(payments),
            refund: payments.refund.bind(payments),
            queryRefund: payments.queryRefund.bind(payments),
            verifyNotification: payments.verifyNotification.bind(payments),
            downloadBill: payments.downloadBill.bind(payments),
          };
        }
        if (isHistorical) historicalMerchants[org + ':' + key] = m;
        else merchants[org] = m;
      }
    if (!Object.keys(merchants).length && !Object.keys(historicalMerchants).length) throw failure();
    return { merchants, historicalMerchants, encryptionKey };
  } catch {
    throw failure();
  }
}

import type { CommerceMode } from '@small-city-basketball/contracts';
import { readRequiredSecret } from './env.js';
import type { WechatPayConfig } from './commerce/wechatpay.js';
import { WECHAT_PAYMENT_NOTIFICATION_PATH } from './request-body.js';

export function readCommerceMode(): CommerceMode {
  const value = process.env.COMMERCE_MODE ?? 'OFF';
  if (value !== 'OFF' && value !== 'ENFORCED')
    throw new Error('COMMERCE_MODE must be OFF or ENFORCED');
  return value;
}

/** No keys are loaded and no network access occurs while payments are disabled. */
export function readWechatPayConfig(appOrigin: string): WechatPayConfig {
  const enabled = process.env.WECHAT_PAY_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false')
    throw new Error('WECHAT_PAY_ENABLED must be true or false');
  if (enabled === 'false') return { enabled: false };
  try {
    const platformKeys: unknown = JSON.parse(readRequiredSecret('WECHAT_PAY_PLATFORM_KEYS'));
    if (!platformKeys || typeof platformKeys !== 'object' || Array.isArray(platformKeys))
      throw new Error();
    const entries = Object.entries(platformKeys);
    if (
      entries.length < 1 ||
      entries.length > 8 ||
      entries.some(
        ([serial, key]) =>
          !/^[A-Za-z0-9_]{1,128}$/.test(serial) || typeof key !== 'string' || key.length > 8192,
      )
    )
      throw new Error();
    const notifyUrl = process.env.WECHAT_PAY_NOTIFY_URL;
    const notify = new URL(notifyUrl ?? '');
    if (
      notify.protocol !== 'https:' ||
      notify.origin !== appOrigin ||
      notify.pathname !== WECHAT_PAYMENT_NOTIFICATION_PATH ||
      notify.search ||
      notify.hash ||
      notify.username ||
      notify.password
    )
      throw new Error();
    return {
      enabled: true,
      appId: process.env.WECHAT_PAY_APP_ID,
      merchantId: process.env.WECHAT_PAY_MERCHANT_ID,
      serialNo: process.env.WECHAT_PAY_MERCHANT_SERIAL,
      privateKeyPem: readRequiredSecret('WECHAT_PAY_PRIVATE_KEY'),
      apiV3Key: readRequiredSecret('WECHAT_PAY_API_V3_KEY'),
      platformKeys: Object.fromEntries(entries),
      notifyUrl: notify.toString(),
    };
  } catch {
    throw new Error('Wechat Pay configuration is incomplete or invalid');
  }
}

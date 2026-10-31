import { readRequiredSecret } from './env.js';
import {
  NOTIFICATION_KINDS,
  notificationKey,
  notificationTemplate,
} from './notification-domain.js';
import type { NotificationTemplate } from './notification-domain.js';
import type { NotificationKind } from '../../../packages/contracts/notifications.js';
import { OfficialWechatNotificationProvider } from './notification-provider.js';
import type { NotificationOptions } from './notification-service.js';
import { OfficialWechatExchange, readWechatConfiguration } from './wechat-provider.js';

/** Both capture hooks and the dispatcher use the same validated, resolved API option. */
export function notificationLeadMinutes(options: object): number {
  const lead =
    (options as { notificationStartingLeadMinutes?: unknown }).notificationStartingLeadMinutes ??
    15;
  if (!Number.isInteger(lead) || Number(lead) < 1 || Number(lead) > 120)
    throw new Error('Invalid notification lead time');
  return Number(lead);
}
export function readNotificationOptions(): NotificationOptions {
  const flag = process.env.WECHAT_NOTIFICATIONS_ENABLED;
  if (flag !== undefined && flag !== 'true' && flag !== 'false')
    throw new Error('Invalid notification enabled switch');
  const rawLead = process.env.NOTIFICATION_STARTING_LEAD_MINUTES ?? '15';
  if (!/^[1-9][0-9]{0,2}$/.test(rawLead)) throw new Error('Invalid notification lead time');
  const startingLeadMinutes = notificationLeadMinutes({
    notificationStartingLeadMinutes: Number(rawLead),
  });
  if (flag !== 'true') return { startingLeadMinutes };
  try {
    const wechat = readWechatConfiguration();
    if (!wechat.enabled || !wechat.appId || !wechat.appSecret) throw Error();
    const encryptionKey = readRequiredSecret('SCB_NOTIFICATION_DATA_KEY');
    notificationKey(encryptionKey);
    const raw = process.env.WECHAT_NOTIFICATION_TEMPLATES;
    if (!raw || Buffer.byteLength(raw) > 16384) throw Error();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    const entries = Object.entries(parsed);
    if (
      !entries.length ||
      entries.some(([k]) => !NOTIFICATION_KINDS.includes(k as NotificationKind))
    )
      throw Error();
    const templates: Partial<Record<NotificationKind, NotificationTemplate>> = {};
    for (const [kind, value] of entries) {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !['id', 'fields'].includes(k))
      )
        throw Error();
      templates[kind as NotificationKind] = notificationTemplate(value as NotificationTemplate);
    }
    if (new Set(Object.values(templates).map((t) => t.id)).size !== entries.length) throw Error();
    const state = process.env.WECHAT_NOTIFICATION_MINIPROGRAM_STATE ?? 'formal';
    if (!['formal', 'trial', 'developer'].includes(state)) throw Error();
    return {
      startingLeadMinutes,
      appId: wechat.appId,
      encryptionKey,
      templates,
      exchange: new OfficialWechatExchange(wechat),
      provider: new OfficialWechatNotificationProvider({
        appId: wechat.appId,
        appSecret: wechat.appSecret,
        state: state as 'formal' | 'trial' | 'developer',
      }),
    };
  } catch {
    throw new Error('Notification runtime configuration is unavailable or invalid');
  }
}

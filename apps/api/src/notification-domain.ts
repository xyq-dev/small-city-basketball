import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';
import { objectInput, resourceId } from './validation.js';
import type { NotificationKind } from '../../../packages/contracts/notifications.js';
export const NOTIFICATION_KINDS = [
  'REGISTRATION_REVIEW',
  'MATCH_RESCHEDULED',
  'MATCH_STARTING',
] as const;
export const NOTIFICATION_PAGE = 'pages/messages/index';
export const notificationHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function notificationKind(value: unknown): NotificationKind {
  if (!NOTIFICATION_KINDS.includes(value as NotificationKind))
    throw new ApiError(422, 'INVALID_NOTIFICATION', '请检查通知类型');
  return value as NotificationKind;
}
const notificationId = (value: unknown) => resourceId(typeof value === 'string' ? value : '');
export function notificationIdInput(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'kind']);
  return { clientRequestId: notificationId(b.clientRequestId), kind: notificationKind(b.kind) };
}
export function notificationConfirmInput(raw: unknown) {
  const b = objectInput(raw, ['clientRequestId', 'intentId', 'result', 'code']);
  if (!['accept', 'reject', 'ban', 'filter'].includes(String(b.result)))
    throw new ApiError(422, 'INVALID_NOTIFICATION', '请检查订阅选择');
  if (
    b.result === 'accept' &&
    (typeof b.code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(b.code))
  )
    throw new ApiError(422, 'INVALID_NOTIFICATION', '请重新确认微信身份');
  if (b.result !== 'accept' && b.code !== undefined)
    throw new ApiError(422, 'INVALID_NOTIFICATION', '拒绝订阅时无需微信凭据');
  return {
    clientRequestId: notificationId(b.clientRequestId),
    intentId: notificationId(b.intentId),
    result: b.result as 'accept' | 'reject' | 'ban' | 'filter',
    code: b.code as string | undefined,
  };
}
export function notificationKey(value: string): Buffer {
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
    Buffer.from(value, 'base64').toString('base64') !== value
  )
    throw new Error('Invalid notification encryption configuration');
  return Buffer.from(value, 'base64');
}
export function sealNotificationTarget(key: Buffer, id: string, openid: string): Buffer {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(openid)) throw new Error('Invalid notification target');
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('scb-notification-target:v1:' + id));
  const bytes = Buffer.concat([cipher.update(openid, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), bytes]);
}
export function openNotificationTarget(key: Buffer, id: string, envelope: Buffer): string {
  if (!Buffer.isBuffer(envelope) || envelope.length < 30 || envelope[0] !== 1)
    throw new Error('Invalid notification target envelope');
  const cipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(1, 13));
  cipher.setAAD(Buffer.from('scb-notification-target:v1:' + id));
  cipher.setAuthTag(envelope.subarray(13, 29));
  const openid = Buffer.concat([cipher.update(envelope.subarray(29)), cipher.final()]).toString(
    'utf8',
  );
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(openid))
    throw new Error('Invalid notification target envelope');
  return openid;
}
export type NotificationTemplate = {
  id: string;
  fields: Record<string, 'title' | 'event' | 'detail' | 'time'>;
};
export function notificationTemplate(value: NotificationTemplate): NotificationTemplate {
  if (
    !value ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
    !value.fields ||
    Object.keys(value.fields).length < 1 ||
    Object.keys(value.fields).length > 8 ||
    Object.entries(value.fields).some(
      ([key, semantic]) =>
        !/^(thing|phrase|time)[1-9][0-9]?$/.test(key) ||
        !['title', 'event', 'detail', 'time'].includes(semantic) ||
        (key.startsWith('time') && semantic !== 'time'),
    )
  )
    throw new Error('Invalid notification template configuration');
  return { id: value.id, fields: { ...value.fields } };
}
export function notificationTemplateData(
  template: NotificationTemplate,
  values: { title: string; event: string; detail: string; time: string },
) {
  notificationTemplate(template);
  return Object.fromEntries(
    Object.entries(template.fields).map(([key, semantic]) => {
      const value = values[semantic];
      if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value))
        throw new Error('Invalid notification template content');
      const limit = key.startsWith('time') ? 32 : key.startsWith('phrase') ? 5 : 20;
      return [key, { value: [...value].slice(0, limit).join('') }];
    }),
  );
}

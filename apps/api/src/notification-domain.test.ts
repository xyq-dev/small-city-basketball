import { describe, expect, it } from 'vitest';
import {
  notificationConfirmInput,
  notificationIdInput,
  notificationKey,
  notificationTemplateData,
  notificationTemplate,
  openNotificationTarget,
  sealNotificationTarget,
} from './notification-domain.js';
const key = Buffer.alloc(32, 0x59),
  context = 'grant:user:wx0123456789abcdef:identity:2';
describe('notification consent and encrypted target boundaries', () => {
  it('binds encrypted recipients to the immutable grant, account, app and identity epoch', () => {
    const sealed = sealNotificationTarget(key, context, 'synthetic_openid');
    expect(sealed.includes(Buffer.from('synthetic_openid'))).toBe(false);
    expect(openNotificationTarget(key, context, sealed)).toBe('synthetic_openid');
    expect(() => openNotificationTarget(key, context + ':changed', sealed)).toThrow();
    expect(() => openNotificationTarget(Buffer.alloc(32, 0x58), context, sealed)).toThrow();
    const corrupt = Buffer.from(sealed);
    corrupt[corrupt.length - 1]! ^= 1;
    expect(() => openNotificationTarget(key, context, corrupt)).toThrow();
  });
  it.each(['', 'not-base64', 'YQ=='])('requires a dedicated canonical 256-bit key: %s', (value) => {
    expect(() => notificationKey(value)).toThrow();
  });
  it('accepts exact inputs and never a caller-supplied recipient or message', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(notificationIdInput({ clientRequestId: id, kind: 'MATCH_STARTING' })).toEqual({
      clientRequestId: id,
      kind: 'MATCH_STARTING',
    });
    expect(() =>
      notificationIdInput({ clientRequestId: id, kind: 'MATCH_STARTING', openid: 'other' }),
    ).toThrow();
    expect(
      notificationConfirmInput({ clientRequestId: id, intentId: id, result: 'reject' }).code,
    ).toBeUndefined();
    expect(() =>
      notificationConfirmInput({ clientRequestId: id, intentId: id, result: 'accept' }),
    ).toThrow();
    expect(() =>
      notificationConfirmInput({
        clientRequestId: id,
        intentId: id,
        result: 'accept',
        code: 'real-code',
        templateId: 'arbitrary',
      }),
    ).toThrow();
  });
  it('uses configured template fields only and clips Unicode by characters', () => {
    const data = notificationTemplateData(
      { id: 'synthetic', fields: { thing1: 'event', phrase2: 'title', time3: 'time' } },
      {
        event: '🏀'.repeat(30),
        title: '真实比赛提醒标题',
        detail: 'private',
        time: '2026年10月31日 19:00',
      },
    );
    expect([...data.thing1!.value]).toHaveLength(20);
    expect([...data.phrase2!.value]).toHaveLength(5);
    expect(Object.keys(data)).toEqual(['thing1', 'phrase2', 'time3']);
    expect(() =>
      notificationTemplateData(
        { id: 'synthetic', fields: { arbitrary1: 'detail' } },
        { event: 'x', title: 'x', detail: 'x', time: 'x' },
      ),
    ).toThrow();
  });
  it('does not coerce malformed runtime template IDs or array fields into trusted configuration', () => {
    expect(() => notificationTemplate({ id: 123, fields: { thing1: 'event' } } as any)).toThrow();
    expect(() => notificationTemplate({ id: 'synthetic', fields: ['event'] } as any)).toThrow();
  });
});

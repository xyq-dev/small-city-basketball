import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationLeadMinutes, readNotificationOptions } from './notification-runtime.js';
const names = [
  'WECHAT_NOTIFICATIONS_ENABLED',
  'NOTIFICATION_STARTING_LEAD_MINUTES',
  'WECHAT_MINI_LOGIN_ENABLED',
  'WECHAT_MINI_APP_ID',
  'WECHAT_MINI_APP_SECRET',
  'WECHAT_MINI_APP_SECRET_FILE',
  'SCB_NOTIFICATION_DATA_KEY',
  'SCB_NOTIFICATION_DATA_KEY_FILE',
  'WECHAT_NOTIFICATION_TEMPLATES',
  'WECHAT_NOTIFICATION_MINIPROGRAM_STATE',
];
beforeEach(() => {
  for (const name of names) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());
function configured() {
  vi.stubEnv('WECHAT_NOTIFICATIONS_ENABLED', 'true');
  vi.stubEnv('WECHAT_MINI_LOGIN_ENABLED', 'true');
  vi.stubEnv('WECHAT_MINI_APP_ID', 'wx1234567890abcdef');
  vi.stubEnv('WECHAT_MINI_APP_SECRET', 'SYNTHETIC_SECRET_E05_2026');
  vi.stubEnv('SCB_NOTIFICATION_DATA_KEY', Buffer.alloc(32, 55).toString('base64'));
  vi.stubEnv(
    'WECHAT_NOTIFICATION_TEMPLATES',
    JSON.stringify({
      MATCH_STARTING: { id: 'synthetic', fields: { thing1: 'event', time2: 'time' } },
    }),
  );
}
describe('notification runtime is disabled until explicitly and completely configured', () => {
  it('does not read secrets or make a request by default; both hook and worker default to 15 minutes', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('must not fetch'));
    expect(readNotificationOptions()).toEqual({ startingLeadMinutes: 15 });
    expect(notificationLeadMinutes({})).toBe(15);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it('constructs official fixed-target adapters without fetching tokens or exchanging codes', () => {
    configured();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('must not fetch'));
    vi.stubEnv('NOTIFICATION_STARTING_LEAD_MINUTES', '25');
    const opts = readNotificationOptions();
    expect(opts.startingLeadMinutes).toBe(25);
    expect(opts.appId).toBe('wx1234567890abcdef');
    expect(opts.provider).toBeDefined();
    expect(opts.exchange).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it.each(['0', '121', '1.5', ' 15', '001', '-1'])(
    'rejects invalid DB window %s even with outbound disabled',
    (value) => {
      vi.stubEnv('NOTIFICATION_STARTING_LEAD_MINUTES', value);
      expect(() => readNotificationOptions()).toThrow('lead time');
    },
  );
  it('rejects partial, wrong app, duplicate-template, arbitrary keys and endpoint configuration without reflecting credentials', () => {
    configured();
    for (const [name, value] of [
      ['SCB_NOTIFICATION_DATA_KEY', 'PRIVATE_SECRET_BAD'],
      ['WECHAT_MINI_LOGIN_ENABLED', 'false'],
      ['WECHAT_MINI_APP_ID', 'https://PRIVATE_HOST'],
      ['WECHAT_NOTIFICATION_MINIPROGRAM_STATE', 'PRIVATE_STATE'],
      ['WECHAT_NOTIFICATION_TEMPLATES', 'PRIVATE_INVALID_JSON'],
      [
        'WECHAT_NOTIFICATION_TEMPLATES',
        JSON.stringify({
          MATCH_STARTING: { id: 'same', fields: { thing1: 'event' } },
          MATCH_RESCHEDULED: { id: 'same', fields: { thing1: 'event' } },
        }),
      ],
      [
        'WECHAT_NOTIFICATION_TEMPLATES',
        JSON.stringify({
          MATCH_STARTING: { id: 'valid', fields: { thing1: 'event' }, url: 'PRIVATE_HOST' },
        }),
      ],
      [
        'WECHAT_NOTIFICATION_TEMPLATES',
        JSON.stringify({ UNKNOWN: { id: 'valid', fields: { thing1: 'event' } } }),
      ],
    ]) {
      configured();
      vi.stubEnv(name!, value!);
      expect(() => readNotificationOptions()).toThrow(
        /^Notification runtime configuration is unavailable or invalid$/,
      );
    }
  });
  it('keeps dedicated secret key requirements separate from other participant encryption', () => {
    configured();
    vi.stubEnv('SCB_NOTIFICATION_DATA_KEY', undefined);
    vi.stubEnv('SCB_PARTICIPANT_DATA_KEY', Buffer.alloc(32, 55).toString('base64'));
    expect(() => readNotificationOptions()).toThrow('unavailable or invalid');
  });
});

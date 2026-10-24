import { describe, expect, it, vi } from 'vitest';
import {
  BOOKING_RECOVERY_STORAGE_PREFIX,
  MAX_BOOKING_RECOVERY_CHARS,
  createBookingRecoveryStore,
} from './recovery-store';
import type { BookingCreateRecovery } from './recovery-store';
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    length: 0,
    key: () => null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: () => values.clear(),
  } satisfies Storage & { values: Map<string, string> };
}
function input() {
  return {
    commandId: 'operation-one',
    orgId: 'org-one',
    teamId: 'team-one',
    eventName: '合成赛事',
    scope: 'TOURNAMENT',
    eligibilityConfirmed: true,
    reviewedSettingsVersion: 1,
    reviewedProfileVersions: { 'profile-one': 3 },
    appearances: [
      {
        profileId: 'profile-one',
        label: '半决赛',
        conditional: true,
        conditionText: '球队晋级后确认',
        venue: '合成球场',
      },
    ],
  };
}
function entry(actor = 'actor-one'): BookingCreateRecovery {
  return {
    actorUserId: actor,
    payload: JSON.stringify(input()),
    uncertain: false,
    inFlight: true,
    resolvedOrderId: 'private-runtime-only',
    rejectedMessage: 'not persisted',
  };
}
const key = (actor = 'actor-one') => `${BOOKING_RECOVERY_STORAGE_PREFIX}${actor}`;
const envelope = (payload: unknown = JSON.stringify(input())) =>
  JSON.stringify({
    schemaVersion: 1,
    mode: 'api',
    actorUserId: 'actor-one',
    status: 'UNKNOWN',
    payload,
  });
const tombstone = {
  schemaVersion: 1,
  mode: 'api',
  actorUserId: 'actor-one',
  status: 'INVALID',
};
describe('同标签预约恢复存储', () => {
  it('新实例模拟刷新后保留原操作编号与字节相同payload，恢复统一unknown且非inFlight', () => {
    const backing = storage(),
      first = createBookingRecoveryStore(() => backing),
      original = entry();
    expect(first.save('api', original)).toBe(true);
    expect(first.load('api', 'actor-one').entry).toBe(original);
    const stored = JSON.parse(backing.values.get(key())!);
    expect(Object.keys(stored).sort()).toEqual([
      'actorUserId',
      'mode',
      'payload',
      'schemaVersion',
      'status',
    ]);
    expect(stored.status).toBe('UNKNOWN');
    const restored = createBookingRecoveryStore(() => backing).load('api', 'actor-one');
    expect(restored.invalid).toBe(false);
    expect(restored.entry).toMatchObject({
      actorUserId: 'actor-one',
      payload: original.payload,
      uncertain: true,
      inFlight: false,
    });
    expect(JSON.parse(restored.entry!.payload).commandId).toBe('operation-one');
    expect(restored.entry?.resolvedOrderId).toBeUndefined();
    expect(restored.entry?.rejectedMessage).toBeUndefined();
  });
  it('mode和actor完全隔离，demo不访问浏览器storage', () => {
    const backing = storage(),
      provider = vi.fn(() => backing),
      cache = createBookingRecoveryStore(provider);
    const original = entry();
    cache.save('demo', original);
    cache.acknowledgeInvalid('demo', 'actor-one');
    expect(cache.load('demo', 'actor-one').entry).toBe(original);
    expect(provider).not.toHaveBeenCalled();
    expect(cache.load('demo', 'actor-two').entry).toBeNull();
    expect(cache.load('api', 'actor-one').entry).toBeNull();
    expect(cache.save('api', entry('actor-two'))).toBe(true);
    expect(cache.load('api', 'actor-one').entry).toBeNull();
    expect(cache.load('demo', 'actor-two').entry).toBeNull();
    expect(backing.values.has(key('actor-two'))).toBe(true);
  });
  it.each([
    '{broken',
    JSON.stringify({
      schemaVersion: 2,
      mode: 'api',
      actorUserId: 'actor-one',
      status: 'UNKNOWN',
      payload: JSON.stringify(input()),
    }),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'demo',
      actorUserId: 'actor-one',
      status: 'UNKNOWN',
      payload: JSON.stringify(input()),
    }),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'api',
      actorUserId: 'actor-two',
      status: 'UNKNOWN',
      payload: JSON.stringify(input()),
    }),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'api',
      actorUserId: 'actor-one',
      status: 'UNKNOWN',
      payload: JSON.stringify(input()),
      cookie: 'forbidden',
    }),
    envelope(JSON.stringify({ ...input(), apiKey: 'forbidden' })),
    JSON.stringify({ ...tombstone, payload: 'forbidden' }),
    envelope(
      JSON.stringify({
        ...input(),
        appearances: [{ ...input().appearances[0], credentials: 'forbidden' }],
      }),
    ),
    envelope(JSON.stringify({ ...input(), reviewedProfileVersions: { 'other-profile': 3 } })),
    envelope(
      JSON.stringify({
        ...input(),
        appearances: Array.from({ length: 65 }, () => input().appearances[0]),
      }),
    ),
    ' '.repeat(MAX_BOOKING_RECOVERY_CHARS + 1),
  ])('损坏、过大或越界存储记录替换为无payload的INVALID门槛（%#）', (value) => {
    const backing = storage();
    backing.values.set(key(), value);
    const result = createBookingRecoveryStore(() => backing).load('api', 'actor-one');
    expect(result).toEqual({ entry: null, invalid: true, storageUnavailable: false });
    expect(JSON.parse(backing.values.get(key())!)).toEqual(tombstone);
    expect(createBookingRecoveryStore(() => backing).load('api', 'actor-one')).toEqual({
      entry: null,
      invalid: true,
      storageUnavailable: false,
    });
  });
  it('坏记录提示跨刷新保留，只有显式确认才清除且不影响别的actor', () => {
    const backing = storage(),
      cache = createBookingRecoveryStore(() => backing);
    backing.values.set(key(), '{corrupt');
    expect(cache.load('api', 'actor-one').invalid).toBe(true);
    expect(JSON.parse(backing.values.get(key())!)).toEqual(tombstone);
    expect(cache.load('api', 'actor-one').invalid).toBe(true);
    cache.acknowledgeInvalid('api', 'actor-two');
    cache.acknowledgeInvalid('demo', 'actor-one');
    expect(cache.load('api', 'actor-one').invalid).toBe(true);
    const refreshed = createBookingRecoveryStore(() => backing);
    expect(refreshed.load('api', 'actor-one').invalid).toBe(true);
    expect(refreshed.acknowledgeInvalid('api', 'actor-one')).toBe(true);
    expect(backing.values.has(key())).toBe(false);
    expect(createBookingRecoveryStore(() => backing).load('api', 'actor-one')).toEqual({
      entry: null,
      invalid: false,
      storageUnavailable: false,
    });
  });
  it('INVALID写入失败保留内存门槛并清理坏payload，报告存储不可用', () => {
    const backing = storage(),
      cache = createBookingRecoveryStore(() => backing);
    backing.values.set(key(), '{corrupt');
    backing.setItem.mockImplementation(() => {
      throw new Error('storage write disabled');
    });
    expect(cache.load('api', 'actor-one')).toEqual({
      entry: null,
      invalid: true,
      storageUnavailable: true,
    });
    expect(backing.values.has(key())).toBe(false);
    expect(cache.load('api', 'actor-one')).toEqual({
      entry: null,
      invalid: true,
      storageUnavailable: true,
    });
  });
  it('INVALID删除失败不清内存门槛，成功确认后刷新才能解除', () => {
    const backing = storage(),
      cache = createBookingRecoveryStore(() => backing);
    backing.values.set(key(), JSON.stringify(tombstone));
    expect(cache.load('api', 'actor-one').invalid).toBe(true);
    backing.removeItem.mockImplementation(() => {
      throw new Error('storage delete disabled');
    });
    expect(cache.acknowledgeInvalid('api', 'actor-one')).toBe(false);
    expect(cache.load('api', 'actor-one')).toEqual({
      entry: null,
      invalid: true,
      storageUnavailable: true,
    });
    expect(createBookingRecoveryStore(() => backing).load('api', 'actor-one').invalid).toBe(true);
    backing.removeItem.mockImplementation((storageKey) => {
      backing.values.delete(storageKey);
    });
    expect(cache.acknowledgeInvalid('api', 'actor-one')).toBe(true);
    expect(createBookingRecoveryStore(() => backing).load('api', 'actor-one').invalid).toBe(false);
  });
  it.each([
    { ...input(), reviewedSettingsVersion: 0 },
    { ...input(), scope: 'OTHER' },
    { ...input(), eligibilityConfirmed: false },
    { ...input(), eventName: 'a'.repeat(81) },
    { ...input(), appearances: [{ ...input().appearances[0], venue: 'v'.repeat(121) }] },
    {
      ...input(),
      appearances: [
        {
          profileId: 'profile-one',
          label: '本场',
          conditional: false,
          venue: '球场',
          reportAt: '2026-02-30T18:00:00Z',
          startAt: '2026-03-02T19:00:00Z',
          endAt: '2026-03-02T21:00:00Z',
        },
      ],
    },
    {
      ...input(),
      appearances: [
        {
          profileId: 'profile-one',
          label: '本场',
          conditional: false,
          venue: '球场',
          reportAt: '2026-10-24T20:00:00Z',
          startAt: '2026-10-24T19:00:00Z',
          endAt: '2026-10-24T21:00:00Z',
        },
      ],
    },
    {
      ...input(),
      appearances: [
        {
          profileId: 'profile-one',
          label: '本场',
          conditional: false,
          venue: '球场',
          reportAt: '2026-10-24T18:00:00Z',
          startAt: '2026-10-24T21:00:00Z',
          endAt: '2026-10-24T21:00:00Z',
        },
      ],
    },
  ])('请求schema、长度和有效时间守卫拒绝无效body（%#）', (body) => {
    const backing = storage(),
      original = { ...entry(), payload: JSON.stringify(body) };
    expect(createBookingRecoveryStore(() => backing).save('api', original)).toBe(false);
    expect(original.persistenceWarning).toBe(true);
    expect(backing.setItem).not.toHaveBeenCalled();
  });
  it('不允许持久化的body仍保留同引用内存与在途互斥状态，防导航丢原请求', () => {
    const backing = storage(),
      cache = createBookingRecoveryStore(() => backing),
      original = { ...entry(), payload: JSON.stringify({ ...input(), eventName: 'a'.repeat(81) }) };
    expect(cache.save('api', original)).toBe(false);
    expect(cache.load('api', 'actor-one').entry).toBe(original);
    expect(cache.load('api', 'actor-one').entry?.inFlight).toBe(true);
    expect(original.persistenceWarning).toBe(true);
    expect(backing.setItem).not.toHaveBeenCalled();
  });
  it('合法固定场次及多人报价版本可恢复，未知字段不进入持久化', () => {
    const backing = storage(),
      body = {
        ...input(),
        scope: 'SINGLE',
        reviewedProfileVersions: { 'profile-one': 3, 'profile-two': 1 },
        appearances: ['profile-one', 'profile-two'].map((profileId) => ({
          profileId,
          label: '正式比赛',
          conditional: false,
          venue: '合成球场',
          reportAt: '2026-10-24T18:30:00+08:00',
          startAt: '2026-10-24T19:00:00+08:00',
          endAt: '2026-10-24T21:00:00+08:00',
        })),
      };
    const original = { ...entry(), payload: JSON.stringify(body) };
    expect(createBookingRecoveryStore(() => backing).save('api', original)).toBe(true);
    expect(createBookingRecoveryStore(() => backing).load('api', 'actor-one').entry?.payload).toBe(
      original.payload,
    );
  });
  it('存储provider不可用时降级同引用内存，不丢原始envelope', () => {
    const provider = () => {
        throw new Error('storage disabled');
      },
      cache = createBookingRecoveryStore(provider),
      original = entry();
    expect(cache.load('api', 'actor-one')).toEqual({
      entry: null,
      invalid: false,
      storageUnavailable: true,
    });
    expect(cache.save('api', original)).toBe(false);
    expect(original.persistenceWarning).toBe(true);
    expect(cache.load('api', 'actor-one')).toEqual({
      entry: original,
      invalid: false,
      storageUnavailable: true,
    });
  });
  it('QuotaExceeded只影响持久化，原请求仍可在当前内存恢复', () => {
    const backing = storage();
    backing.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const cache = createBookingRecoveryStore(() => backing),
      original = entry();
    expect(cache.save('api', original)).toBe(false);
    expect(cache.load('api', 'actor-one').entry).toBe(original);
    expect(original.persistenceWarning).toBe(true);
  });
  it('discard只清当前同引用，旧响应不能删除后续请求或别的actor', () => {
    const backing = storage(),
      cache = createBookingRecoveryStore(() => backing),
      old = entry(),
      next = { ...entry(), payload: JSON.stringify({ ...input(), commandId: 'operation-two' }) },
      other = entry('actor-two');
    cache.save('api', old);
    cache.save('api', next);
    cache.save('api', other);
    cache.discard('api', old);
    expect(cache.load('api', 'actor-one').entry).toBe(next);
    expect(JSON.parse(JSON.parse(backing.values.get(key())!).payload).commandId).toBe(
      'operation-two',
    );
    cache.discard('api', next);
    expect(cache.load('api', 'actor-one').entry).toBeNull();
    expect(cache.load('api', 'actor-two').entry).toBe(other);
    expect(backing.values.has(key('actor-two'))).toBe(true);
  });
});

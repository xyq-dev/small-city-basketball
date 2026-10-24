import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  dateTime,
  insideAvailability,
  parseCommand,
  parseCreate,
  parseProfile,
  quote,
  windows,
} from './domain.js';

const interval = { startAt: '2027-01-01T10:00:00+08:00', endAt: '2027-01-01T22:00:00+08:00' };
const appearance = () => ({
  profileId: randomUUID(),
  label: '小组赛第一场',
  conditional: false,
  reportAt: '2027-01-01T19:00:00+08:00',
  startAt: '2027-01-01T19:30:00+08:00',
  endAt: '2027-01-01T21:00:00+08:00',
  venue: '合成测试球场',
});
const create = () => ({
  reviewedSettingsVersion: 1,
  reviewedProfileVersions: {},
  commandId: randomUUID(),
  orgId: randomUUID(),
  teamId: randomUUID(),
  eventName: '合成测试杯',
  scope: 'SINGLE',
  eligibilityConfirmed: true,
  appearances: [appearance()],
});
describe('C06 booking domain', () => {
  it('charges only the service component and rounds exactly to fen', () => {
    expect(quote(30_000, 2_000, 10_000, 1000)).toEqual({
      serviceFen: 30_000,
      travelFen: 2_000,
      accommodationFen: 10_000,
      platformFeeFen: 3_000,
      totalFen: 45_000,
    });
    expect(quote(105, 0, 0, 1000).platformFeeFen).toBe(11);
    expect(quote(105, 0, 0, 0).platformFeeFen).toBe(0);
  });
  it.each([NaN, Infinity, 0.3, -1, 10_000_001])(
    'rejects non-integer or unbounded amounts %s',
    (value) => {
      expect(() => quote(value, 0, 0, 1000)).toThrow();
    },
  );
  it('rejects invalid and timezone-free calendar instants', () => {
    expect(dateTime(interval.startAt, 'startAt')).toBe('2027-01-01T02:00:00.000Z');
    expect(() => dateTime('2027-02-30T19:30:00+08:00', 'startAt')).toThrow();
    expect(() => dateTime('2027-01-01T19:30', 'startAt')).toThrow();
  });
  it('normalizes and checks complete service containment in published availability', () => {
    const available = windows([interval]);
    expect(
      insideAvailability(available, '2027-01-01T11:00:00.000Z', '2027-01-01T13:00:00.000Z'),
    ).toBe(true);
    expect(
      insideAvailability(available, '2027-01-01T01:00:00.000Z', '2027-01-01T13:00:00.000Z'),
    ).toBe(false);
    expect(() => windows([interval, interval])).toThrow();
  });
  it('requires an adult declaration and does not permit self-certification or status injection', () => {
    const v = {
      commandId: randomUUID(),
      expectedVersion: 0,
      displayName: '合成球员',
      position: 'PG',
      heightCm: 180,
      city: '高州',
      bio: '',
      priceFen: 30000,
      travelFen: 0,
      availability: [interval],
      adultConfirmed: true,
    };
    expect(parseProfile(v).accommodationFen).toBe(0);
    expect(() => parseProfile({ ...v, adultConfirmed: false })).toThrow();
    expect(() => parseProfile({ ...v, status: 'APPROVED' })).toThrow();
    expect(() => parseProfile({ ...v, expectedVersion: -1 })).toThrow();
  });
  it('requires explicit eligibility declaration without claiming registration', () => {
    expect(parseCreate(create()).scope).toBe('SINGLE');
    expect(() => parseCreate({ ...create(), eligibilityConfirmed: false })).toThrow();
  });
  it('distinguishes conditional series appearances from confirmed service windows', () => {
    const v = create();
    const conditional = {
      profileId: v.appearances[0]!.profileId,
      label: '待晋级半决赛',
      conditional: true,
      conditionText: '进入四强后确定赛程',
      venue: '待主办方确认',
    };
    expect(
      parseCreate({ ...v, scope: 'TOURNAMENT', appearances: [...v.appearances, conditional] })
        .appearances[1]?.reportAt,
    ).toBeUndefined();
    expect(() => parseCreate({ ...v, appearances: [conditional] })).toThrow();
    expect(() =>
      parseCreate({
        ...v,
        scope: 'TOURNAMENT',
        appearances: [{ ...conditional, conditionText: '' }],
      }),
    ).toThrow();
  });
  it('allows multiple players in one match but rejects mixing different matches in SINGLE', () => {
    const v = create();
    expect(
      parseCreate({
        ...v,
        appearances: [...v.appearances, { ...v.appearances[0], profileId: randomUUID() }],
      }).appearances,
    ).toHaveLength(2);
    expect(() =>
      parseCreate({
        ...v,
        appearances: [...v.appearances, { ...appearance(), venue: '另一场地' }],
      }),
    ).toThrow();
    expect(() =>
      parseCreate({ ...v, appearances: [...v.appearances, v.appearances[0]] }),
    ).toThrow();
  });
  it('does not accept client supplied money, fee settings, expiry or completed state', () => {
    expect(() => parseCreate({ ...create(), feeBps: 0 })).toThrow();
    expect(() => parseCreate({ ...create(), expiresAt: interval.endAt })).toThrow();
    const v = create();
    expect(() =>
      parseCreate({ ...v, appearances: [{ ...v.appearances[0], serviceFen: 1 }] }),
    ).toThrow();
  });
  it('requires renewed consent for accepting a player or a material schedule change', () => {
    const base = { commandId: randomUUID(), expectedVersion: 1, appearanceId: randomUUID() };
    expect(() => parseCommand({ ...base, type: 'ACCEPT' })).toThrow();
    expect(parseCommand({ ...base, type: 'ACCEPT', eligibilityConfirmed: true }).type).toBe(
      'ACCEPT',
    );
    expect(() => parseCommand({ ...base, type: 'ACCEPT_CHANGE' })).toThrow();
  });
  it('requires a valid time window and reason for schedule proposals', () => {
    const base = {
      commandId: randomUUID(),
      expectedVersion: 1,
      appearanceId: randomUUID(),
      type: 'PROPOSE_CHANGE',
      reason: '主办方调整场次',
      ...appearance(),
    };
    const { profileId: _, label: _l, conditional: _c, ...command } = base;
    expect(parseCommand(command).venue).toBe('合成测试球场');
    expect(() => parseCommand({ ...command, endAt: command.startAt })).toThrow();
    expect(() => parseCommand({ ...command, reason: '' })).toThrow();
  });
  it('rejects forged payment commands and disallows unsupported command fields', () => {
    const base = { commandId: randomUUID(), expectedVersion: 1, appearanceId: randomUUID() };
    expect(() => parseCommand({ ...base, type: 'MARK_PAID' })).toThrow();
    expect(() => parseCommand({ ...base, type: 'COMPLETE', paidFen: 33000 })).toThrow();
    expect(() =>
      parseCommand({ ...base, type: 'CANCEL', reason: '不再参赛', reportAt: interval.startAt }),
    ).toThrow();
  });
  it('requires an explicit bounded resolution and review reason for disputes', () => {
    const base = {
      commandId: randomUUID(),
      expectedVersion: 1,
      appearanceId: randomUUID(),
      type: 'RESOLVE_DISPUTE',
      reason: '核实双方说明后取消该次服务',
    };
    expect(parseCommand({ ...base, resolution: 'CANCEL' }).resolution).toBe('CANCEL');
    expect(() => parseCommand({ ...base, resolution: 'MARK_PAID' })).toThrow();
    expect(() => parseCommand({ ...base, resolution: 'CANCEL', reason: '' })).toThrow();
  });
});

import { describe, expect, test } from 'vitest';
import {
  distanceMeters,
  localBookingTransition,
  localCommandId,
  localInterval,
  localPoint,
  parseLocalBooking,
  parseLocalListing,
  parseLocalQuery,
} from './local-services-domain.js';
const id = '12345678-1234-4234-8234-123456789012';
const region = { catalogVersion: 'cn-admin-2025-r1', regionId: id };
const point = { latitude: 22.9, longitude: 110.8, coordinateSystem: 'GCJ02' as const };
describe('X12 local supply invariants', () => {
  test('never treats a city or invalid coordinate as device position', () => {
    expect(() => localPoint({ ...point, coordinateSystem: 'WGS84' })).toThrow();
    for (const latitude of [NaN, Infinity, -91, 91, '23'])
      expect(() => localPoint({ ...point, latitude })).toThrow();
    expect(distanceMeters(point, point)).toBe(0);
    expect(
      distanceMeters(
        { ...point, latitude: 0, longitude: 0 },
        { ...point, latitude: 0, longitude: 1 },
      ),
    ).toBeGreaterThan(111000);
    expect(() => parseLocalQuery({ radiusMeters: '1000' })).toThrow();
    expect(
      parseLocalQuery({ regionId: id, catalogVersion: region.catalogVersion }).point,
    ).toBeNull();
  });
  test('requires timezone, finite duration and bounded operation identities', () => {
    expect(localInterval('2030-01-01T10:00:00+08:00', '2030-01-01T11:00:00+08:00').startsAt).toBe(
      '2030-01-01T02:00:00.000Z',
    );
    for (const end of ['2030-01-01T09:00:00+08:00', '2030-01-03T11:00:00+08:00'])
      expect(() => localInterval('2030-01-01T10:00:00+08:00', end)).toThrow();
    expect(() => localInterval('2030-01-01T10:00:00', '2030-01-01T11:00:00')).toThrow();
    expect(() => localCommandId('same-command')).toThrow();
  });
  test('court inventory must bind actual court; medical supply still needs qualification', () => {
    const base = {
      commandId: id,
      kind: 'COURT',
      title: '真实场地',
      description: '已确认经营授权',
      address: '公开经营地点',
      region,
      coverageRegionIds: [id],
      providerUserId: id,
      courtId: id,
      qualificationNote: '真实经营授权待审核',
      terms: '未开支付，双方确认预约条款',
    };
    expect(parseLocalListing(base).courtId).toBe(id);
    expect(() => parseLocalListing({ ...base, courtId: null })).toThrow();
    expect(() => parseLocalListing({ ...base, kind: 'MEDIC' })).toThrow();
    expect(() =>
      parseLocalListing({ ...base, kind: 'MEDIC', courtId: null, qualificationNote: '' }),
    ).toThrow();
  });
  test('buyer acceptance is not provider arrival or delivery; terminal results do not reopen', () => {
    expect(localBookingTransition('HELD', 'CONFIRM', 'BUYER')).toBe('CONFIRMED');
    expect(localBookingTransition('REQUESTED', 'ACCEPT', 'PROVIDER')).toBe('CONFIRMED');
    expect(localBookingTransition('CONFIRMED', 'ARRIVE', 'PROVIDER')).toBe('ARRIVED');
    expect(localBookingTransition('ARRIVED', 'DELIVER', 'PROVIDER')).toBe('DELIVERED');
    expect(localBookingTransition('DELIVERED', 'COMPLETE', 'BUYER')).toBe('COMPLETED');
    for (const status of ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED'] as const)
      expect(() => localBookingTransition(status, 'ACCEPT', 'PROVIDER')).toThrow();
    expect(() => localBookingTransition('DELIVERED', 'COMPLETE', 'PROVIDER')).toThrow();
    expect(() => localBookingTransition('CONFIRMED', 'ARRIVE', 'BUYER')).toThrow();
  });
  test('no submitted region or terms means no order; unknown inputs are rejected', () => {
    expect(
      parseLocalBooking({
        commandId: id,
        listingId: id,
        slotId: id,
        serviceRegion: region,
        acceptedTerms: true,
      }).acceptedTerms,
    ).toBe(true);
    expect(() =>
      parseLocalBooking({
        commandId: id,
        listingId: id,
        slotId: id,
        serviceRegion: region,
        acceptedTerms: false,
      }),
    ).toThrow();
    expect(() => parseLocalQuery({ q: '', secret: 'unknown' })).toThrow();
  });
});

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  allocateTrainingPrice,
  parseTrainingCohort,
  parseTrainingAction,
  trainingCommand,
  trainingTime,
  trainingCanConfirm,
} from './training-domain.js';
const cohort = () => ({
  commandId: randomUUID(),
  courseId: randomUUID(),
  courtId: randomUUID(),
  title: '成人基础班',
  address: '测试球馆',
  capacity: 3,
  totalFen: 100,
  termsText: '未消费课次按冻结净额退还',
  enrollmentDeadline: '2099-01-01T00:00:00Z',
  sessions: [
    {
      startsAt: '2099-01-02T00:00:00Z',
      endsAt: '2099-01-02T01:00:00Z',
      priceWeight: 1,
      coachIds: [randomUUID()],
    },
  ],
});
describe('training fixed-course financial and enrollment rules', () => {
  it('distributes every cent deterministically, including free lessons', () => {
    expect(allocateTrainingPrice(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateTrainingPrice(3, [0, 1, 1])).toEqual([0, 2, 1]);
    expect(allocateTrainingPrice(0, [0, 0])).toEqual([0, 0]);
  });
  it('never loses integer cents across maximum allowed prices', () => {
    for (let n = 1; n <= 8; n++) {
      const p = allocateTrainingPrice(
        100000000,
        Array.from({ length: n }, (_, i) => 100000000 - i),
      );
      expect(p.reduce((a, b) => a + b, 0)).toBe(100000000);
      expect(p.every(Number.isSafeInteger)).toBe(true);
    }
  });
  it('rejects invalid and unallocatable amounts', () => {
    for (const args of [
      [-1, [1]],
      [1, [0]],
      [0, []],
      [1.5, [1]],
      [1, Array(9).fill(1)],
    ] as [number, number[]][])
      expect(() => allocateTrainingPrice(...args)).toThrow();
  });
  it('treats a late real payment as unallocated instead of overselling', () => {
    expect(trainingCanConfirm({ expired: true, eligible: false, paid: false, free: false })).toBe(
      'EXPIRED',
    );
    expect(trainingCanConfirm({ expired: true, eligible: true, paid: true, free: false })).toBe(
      'PAID_UNALLOCATED',
    );
    expect(trainingCanConfirm({ expired: false, eligible: false, paid: true, free: false })).toBe(
      'PAID_UNALLOCATED',
    );
    expect(trainingCanConfirm({ expired: false, eligible: true, paid: false, free: false })).toBe(
      'PAYMENT_PENDING',
    );
    expect(trainingCanConfirm({ expired: false, eligible: true, paid: false, free: true })).toBe(
      'CONFIRMED',
    );
  });
  it('accepts explicit timezone and rejects implicit local time', () => {
    expect(trainingTime('2099-01-02T08:00:00+08:00')).toBe('2099-01-02T00:00:00.000Z');
    expect(() => trainingTime('2099-01-02T08:00:00')).toThrow();
    expect(() => trainingTime('2099-02-30T08:00:00Z')).toThrow();
  });
  it('limits fixed courses to eight weeks and rejects duplicate coaches', () => {
    const v = cohort();
    v.sessions.push({
      ...v.sessions[0]!,
      startsAt: '2099-04-01T00:00:00Z',
      endsAt: '2099-04-01T01:00:00Z',
    });
    expect(() => parseTrainingCohort(v)).toThrow();
    const w = cohort();
    w.sessions[0]!.coachIds.push(w.sessions[0]!.coachIds[0]!);
    expect(() => parseTrainingCohort(w)).toThrow();
  });
  it('rejects client-supplied money and payment states in commands', () => {
    expect(() =>
      parseTrainingAction(
        { commandId: randomUUID(), expectedVersion: 1, action: 'CONFIRM', paid: true },
        ['CONFIRM'],
      ),
    ).toThrow();
    expect(() => parseTrainingCohort({ ...cohort(), adultOnly: false })).toThrow();
  });
  it('requires v4 command identifiers and positive versions', () => {
    expect(trainingCommand(randomUUID())).toMatch(/-/);
    expect(() => trainingCommand('00000000-0000-1000-8000-000000000001')).toThrow();
    expect(() =>
      parseTrainingAction({ commandId: randomUUID(), expectedVersion: 0, action: 'CONFIRM' }, [
        'CONFIRM',
      ]),
    ).toThrow();
  });
});

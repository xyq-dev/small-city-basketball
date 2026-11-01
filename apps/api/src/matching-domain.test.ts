import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  matchingScore,
  matchingWindows,
  parseMatchingNeed,
  rankMatching,
} from './matching-domain.js';
const window = {
  reportAt: '2027-02-01T10:00:00Z',
  startAt: '2027-02-01T10:15:00Z',
  endAt: '2027-02-01T12:00:00Z',
};
function input() {
  return {
    commandId: randomUUID(),
    kind: 'ADULT_PLAYER',
    orgId: randomUUID(),
    teamId: randomUUID(),
    title: '成人球队补位',
    address: '测试球馆',
    regionId: randomUUID(),
    catalogVersion: 'test-region',
    allowedRegionIds: [randomUUID()],
    role: 'PG',
    quantity: 2,
    windows: [window],
    unitBudgetFen: 1000,
    totalBudgetFen: 2000,
    maxTravelMinutes: 120,
    expiresAt: '2027-02-01T09:00:00Z',
    adultConfirmed: true,
  };
}
describe('R6MATCH strict needs and evidence scoring', () => {
  it('normalizes confirmed windows and keeps the total budget explicit', () => {
    expect(parseMatchingNeed(input())).toMatchObject({
      quantity: 2,
      totalBudgetFen: 2000,
      windows: [
        {
          ...window,
          reportAt: '2027-02-01T10:00:00.000Z',
          startAt: '2027-02-01T10:15:00.000Z',
          endAt: '2027-02-01T12:00:00.000Z',
        },
      ],
    });
  });
  it.each([
    { adultConfirmed: false },
    { totalBudgetFen: 1999 },
    { quantity: 0 },
    { quantity: 17 },
    { role: 'MEDIC' },
    { kind: 'UNKNOWN' },
    { unexpected: true },
  ])('rejects invalid demand %j', (patch) =>
    expect(() => parseMatchingNeed({ ...input(), ...patch })).toThrow(),
  );
  it('rejects malformed dates instead of a server range exception', () => {
    expect(() => matchingWindows([{ ...window, startAt: 'not a date' }])).toThrow('开始时间无效');
    expect(() => matchingWindows([window, window])).toThrow('场次不能重叠');
  });
  it('does not turn missing quotes, travel or a tiny sample into a high confidence result', () => {
    const s = matchingScore({
      budget: 1000,
      price: null,
      free: false,
      maxTravelMinutes: 120,
      successes: 4,
      outcomes: 4,
    });
    expect(s).toMatchObject({
      score: 100,
      coverage: 35,
      band: 'INCOMPLETE',
      dimensions: { time: 100, budget: null, travel: null, reliability: null },
    });
  });
  it('excludes the money dimension for free team matching', () => {
    expect(
      matchingScore({
        budget: 0,
        price: 0,
        free: true,
        maxTravelMinutes: 0,
        travelMinutes: 0,
        successes: 5,
        outcomes: 5,
      }),
    ).toMatchObject({
      score: 100,
      coverage: 100,
      band: 'SUFFICIENT',
      dimensions: { budget: null },
    });
  });
  it('rejects excess price and travel before scoring', () => {
    expect(() =>
      matchingScore({ budget: 0, price: 1, free: false, maxTravelMinutes: 30 }),
    ).toThrow();
    expect(() =>
      matchingScore({ budget: 1, price: 0, free: false, maxTravelMinutes: 30, travelMinutes: 31 }),
    ).toThrow();
  });
  it('prioritizes evidence band before raw score and uses stable seeded ties', () => {
    const sparse = matchingScore({ budget: 100, price: null, free: false, maxTravelMinutes: 60 });
    const dense = matchingScore({
      budget: 100,
      price: 100,
      free: false,
      maxTravelMinutes: 60,
      travelMinutes: 60,
      outcomes: 10,
      successes: 1,
    });
    const rows = [
      { id: 'a', score: sparse },
      { id: 'b', score: dense },
      { id: 'c', score: dense },
    ];
    const ordered = rankMatching(rows, 'same-seed');
    expect(ordered.at(-1)?.id).toBe('a');
    expect(rankMatching([...rows].reverse(), 'same-seed')).toEqual(ordered);
  });
  it('supports all three source types while requiring explicit adult and team authority inputs', () => {
    expect(
      parseMatchingNeed({
        ...input(),
        kind: 'TEAM_MATCHUP',
        role: 'TEAM',
        quantity: 1,
        unitBudgetFen: 0,
        totalBudgetFen: 0,
      }),
    ).toMatchObject({ kind: 'TEAM_MATCHUP' });
    expect(
      parseMatchingNeed({ ...input(), kind: 'STAFF_SERVICE', role: 'REFEREE', teamId: undefined }),
    ).toMatchObject({ kind: 'STAFF_SERVICE' });
  });
});

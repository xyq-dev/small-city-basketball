import { describe, expect, it } from 'vitest';
import type {
  RegistrationFreezeData,
  ScheduleFixtureData,
  SchedulePolicy,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import {
  canonicalFreeze,
  generatePairings,
  parseAllocationInput,
  parseSchedulePolicy,
  parseScheduleTimestamp,
  publicationHash,
  validateSchedule,
} from './scheduling-domain.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const seed = '00'.repeat(32);
function freeze(count: number): RegistrationFreezeData {
  return {
    id: id(500),
    eventId: id(501),
    rulesetId: id(502),
    rulesetVersion: 1,
    eventVersion: 7,
    entries: Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        entryId: id(number),
        teamId: id(100 + number),
        teamName: `Team ${number}`,
        rosterRevisionId: id(200 + number),
        players: [
          { memberId: id(300 + number), name: `Player ${number}`, jerseyNo: String(number) },
        ],
      };
    }),
    excludedCounts: { DRAFT: 1, REJECTED: 0, WITHDRAWN: 0 },
    createdAt: '2026-10-22T00:00:00.000Z',
  };
}
const policy: SchedulePolicy = {
  slotDurationMinutes: 60,
  minRestMinutes: 0,
  minLocalDayGap: 0,
  courtWindows: [
    { courtId: id(600), startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-04T16:00:00.000Z' },
  ],
};
const event = {
  id: id(501),
  startDate: '2026-11-01',
  endDate: '2026-11-04',
  timezone: 'Asia/Shanghai',
};
function assigned(
  fixture: ScheduleFixtureData,
  startsAt: string,
  court = id(600),
): ScheduleFixtureData {
  return {
    ...fixture,
    courtId: court,
    startsAt: parseScheduleTimestamp(startsAt),
    endsAt: new Date(Date.parse(startsAt) + 60 * 60_000).toISOString(),
  };
}

describe('RR_CIRCLE_V1规范化与独立不变量', () => {
  it('固定源与256bit种子的已知序列化向量（独立Python重算）', () => {
    const result = generatePairings(freeze(3), policy, seed);
    expect(result.orderedEntryIds).toEqual([id(1), id(2), id(3)]);
    expect(result.rounds).toEqual([
      { roundNo: 1, byeEntryId: id(1) },
      { roundNo: 2, byeEntryId: id(2) },
      { roundNo: 3, byeEntryId: id(3) },
    ]);
    expect(
      result.fixtures.map(({ fixtureKey, homeEntryId, awayEntryId }) => [
        fixtureKey,
        homeEntryId,
        awayEntryId,
      ]),
    ).toEqual([
      ['R1-P2', id(2), id(3)],
      ['R2-P1', id(1), id(3)],
      ['R3-P1', id(1), id(2)],
    ]);
    expect(result.inputHash).toBe(
      '68670d1a842410c2aaed8e09e48a7bfd6bbb5ae1406db26c55ac732e28856aba',
    );
    expect(result.pairingHash).toBe(
      '92741a54ec9031c7830d1471fb6e16368d1319a3c6297fb59ddb789d422c2c6b',
    );
    expect(
      publicationHash({ algorithmVersion: 'RR_CIRCLE_V1', seed, ...result }, result.fixtures),
    ).toBe('6300a1574dfba04260df98f8930109630a72c9de859422b5f4c05bab6244c1f6');
  });
  it.each(Array.from({ length: 31 }, (_, index) => index + 2))(
    '%i队每对恰一次、每轮每队一次、奇数每队轮空一次',
    (count) => {
      const source = freeze(count);
      const result = generatePairings(source, policy, seed);
      expect(result.fixtures).toHaveLength((count * (count - 1)) / 2);
      expect(result.rounds).toHaveLength(count % 2 ? count : count - 1);
      const pairs = new Set(
        result.fixtures.map((fixture) =>
          [fixture.homeEntryId, fixture.awayEntryId].sort().join('|'),
        ),
      );
      expect(pairs.size).toBe((count * (count - 1)) / 2);
      expect(new Set(result.fixtures.map((fixture) => fixture.fixtureKey)).size).toBe(
        result.fixtures.length,
      );
      for (const round of result.rounds) {
        const roundFixtures = result.fixtures.filter(
          (fixture) => fixture.roundNo === round.roundNo,
        );
        const entries = roundFixtures.flatMap((fixture) => [
          fixture.homeEntryId,
          fixture.awayEntryId,
        ]);
        if (round.byeEntryId) entries.push(round.byeEntryId);
        expect(entries).toHaveLength(count);
        expect(new Set(entries).size).toBe(count);
      }
      expect(
        result.rounds.flatMap((round) => (round.byeEntryId ? [round.byeEntryId] : [])).sort(),
      ).toEqual(count % 2 ? source.entries.map((entry) => entry.entryId).sort() : []);
    },
  );
  it('输入重排不改变hash，改变政策不改变配对，改变种子可复现重抽', () => {
    const source = freeze(3);
    const result = generatePairings(source, policy, seed);
    const reordered = { ...source, entries: [...source.entries].reverse() };
    expect(generatePairings(reordered, policy, seed)).toEqual(result);
    expect(canonicalFreeze(reordered)).toEqual(source);
    const changedPolicy = generatePairings(source, { ...policy, minRestMinutes: 30 }, seed);
    expect(changedPolicy.pairingHash).toBe(result.pairingHash);
    expect(changedPolicy.inputHash).not.toBe(result.inputHash);
    const redraw = generatePairings(source, policy, '11'.repeat(32));
    expect(redraw.orderedEntryIds).not.toEqual(result.orderedEntryIds);
    expect(generatePairings(source, policy, '11'.repeat(32))).toEqual(redraw);
    expect(
      publicationHash({ algorithmVersion: 'RR_CIRCLE_V1', seed, ...result }, [
        assigned(result.fixtures[0]!, '2026-11-01T08:00:00+08:00'),
        ...result.fixtures.slice(1),
      ]),
    ).not.toBe(
      publicationHash({ algorithmVersion: 'RR_CIRCLE_V1', seed, ...result }, result.fixtures),
    );
  });
  it('拒绝人数越界、重复entry/team和非256bit种子', () => {
    expect(() => generatePairings(freeze(1), policy, seed)).toThrow(ApiError);
    expect(() => generatePairings(freeze(33), policy, seed)).toThrow(ApiError);
    const repeated = freeze(3);
    repeated.entries[1]!.teamId = repeated.entries[0]!.teamId;
    expect(() => generatePairings(repeated, policy, seed)).toThrow(ApiError);
    expect(() => generatePairings(freeze(3), policy, 'short')).toThrow(ApiError);
  });
});

describe('严格时间、显式政策与全量分配', () => {
  it('显式offset归一UTC，并按日历拒绝无效日期及隐式时区', () => {
    expect(parseScheduleTimestamp('2026-11-01T08:00:00+08:00')).toBe('2026-11-01T00:00:00.000Z');
    expect(parseScheduleTimestamp('2024-02-29T01:02:03.4-05:00')).toBe('2024-02-29T06:02:03.400Z');
    for (const invalid of [
      '2026-02-29T00:00:00Z',
      '2026-04-31T00:00:00+08:00',
      '2026-11-01T24:00:00Z',
      '2026-11-01T00:60:00Z',
      '2026-11-01T00:00:60Z',
      '2026-11-01T00:00:00',
      '2026-11-01',
      '0000-01-01T00:00:00Z',
      '2026-11-01T00:00:00+24:00',
    ])
      expect(() => parseScheduleTimestamp(invalid)).toThrow(ApiError);
  });
  it('政策整数范围、字段白名单和同court窗口硬校验；窗口相邻可用', () => {
    expect(parseSchedulePolicy(policy)).toEqual(policy);
    for (const change of [
      { slotDurationMinutes: 0 },
      { slotDurationMinutes: 1441 },
      { minRestMinutes: 43201 },
      { minLocalDayGap: 366 },
      { minLocalDayGap: -1 },
      { minRestMinutes: 1.5 },
      { courtWindows: [] },
      { customRule: true },
    ])
      expect(() => parseSchedulePolicy({ ...policy, ...change })).toThrow(ApiError);
    const first = {
      courtId: id(600),
      startsAt: '2026-11-01T08:00:00+08:00',
      endsAt: '2026-11-01T09:00:00+08:00',
    };
    const next = { ...first, startsAt: first.endsAt, endsAt: '2026-11-01T10:00:00+08:00' };
    expect(
      parseSchedulePolicy({ ...policy, courtWindows: [next, first] }).courtWindows.map(
        (window) => window.startsAt,
      ),
    ).toEqual(['2026-11-01T00:00:00.000Z', '2026-11-01T01:00:00.000Z']);
    expect(() => parseSchedulePolicy({ ...policy, courtWindows: [first, first] })).toThrow(
      ApiError,
    );
    expect(() =>
      parseSchedulePolicy({ ...policy, courtWindows: [first, { ...first, courtId: id(601) }] }),
    ).not.toThrow();
  });
  it('分配必须精确覆盖场次，场地和时间成对，服务器推导结束', () => {
    const allocation = parseAllocationInput(
      [{ fixtureKey: 'R1-P1', courtId: id(600), startsAt: '2026-11-01T08:00:00+08:00' }],
      ['R1-P1'],
      45,
    )[0]!;
    expect(allocation.endsAt).toBe('2026-11-01T00:45:00.000Z');
    expect(
      parseAllocationInput(
        [{ fixtureKey: 'R1-P1', courtId: null, startsAt: null }],
        ['R1-P1'],
        45,
      )[0]!.endsAt,
    ).toBeNull();
    for (const value of [
      [],
      [{ fixtureKey: 'other', courtId: null, startsAt: null }],
      [{ fixtureKey: 'R1-P1', courtId: null, startsAt: allocation.startsAt }],
      [{ fixtureKey: 'R1-P1', courtId: id(600), startsAt: allocation.startsAt, endsAt: 'forged' }],
    ])
      expect(() => parseAllocationInput(value, ['R1-P1'], 45)).toThrow(ApiError);
    expect(() =>
      parseAllocationInput(
        [
          { fixtureKey: 'R1-P1', courtId: null, startsAt: null },
          { fixtureKey: 'R1-P1', courtId: null, startsAt: null },
        ],
        ['R1-P1', 'R2-P1'],
        45,
      ),
    ).toThrow(ApiError);
  });
});

describe('计划占用硬约束', () => {
  const source = freeze(3);
  const pairings = generatePairings(source, policy, seed).fixtures;
  const validate = (
    fixtures: ScheduleFixtureData[],
    options: {
      policy?: SchedulePolicy;
      courts?: { id: string; status: string }[];
      reservations?: {
        kind: 'COURT' | 'TEAM';
        resourceId: string;
        startsAt: string;
        endsAt: string;
      }[];
    } = {},
  ) =>
    validateSchedule({
      event,
      freeze: source,
      policy: options.policy ?? policy,
      fixtures,
      courts: options.courts ?? [
        { id: id(600), status: 'ACTIVE' },
        { id: id(601), status: 'ACTIVE' },
      ],
      reservations: options.reservations ?? [],
    });
  it('未分配、越窗口、禁用、越赛事日期都可报告；末日午夜为半开端点', () => {
    expect(validate([pairings[0]!]).map((conflict) => conflict.code)).toEqual(['UNASSIGNED']);
    expect(
      validate([assigned(pairings[0]!, '2026-11-05T00:00:00+08:00')]).map(
        (conflict) => conflict.code,
      ),
    ).toContain('OUTSIDE_EVENT_DATES');
    expect(
      validate([assigned(pairings[0]!, '2026-11-01T08:00:00+08:00', id(601))]).map(
        (conflict) => conflict.code,
      ),
    ).toContain('OUTSIDE_WINDOW');
    expect(
      validate([assigned(pairings[0]!, '2026-11-01T08:00:00+08:00')], {
        courts: [{ id: id(600), status: 'DISABLED' }],
      }).map((conflict) => conflict.code),
    ).toContain('COURT_DISABLED');
    expect(validate([assigned(pairings[0]!, '2026-11-04T23:00:00+08:00')])).toEqual([]);
  });
  it('半开相邻无冲突；同court和同team交叉检测，不依赖home/away列', () => {
    const first = assigned(pairings[0]!, '2026-11-01T08:00:00+08:00');
    const next = assigned(pairings[1]!, '2026-11-01T09:00:00+08:00');
    expect(validate([first, next])).toEqual([]);
    const overlap = assigned(pairings[1]!, '2026-11-01T08:59:00+08:00');
    expect(validate([first, overlap]).map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(['COURT_OVERLAP', 'TEAM_OVERLAP']),
    );
    const anotherCourt = { ...overlap, courtId: id(601) };
    expect(
      validate([first, anotherCourt]).some((conflict) => conflict.code === 'TEAM_OVERLAP'),
    ).toBe(true);
    expect(
      validate([first, anotherCourt]).some((conflict) => conflict.code === 'COURT_OVERLAP'),
    ).toBe(false);
  });
  it('休息按前场结束起算，上海本地开赛日期ordinal不是24小时', () => {
    const first = assigned(pairings[0]!, '2026-11-01T22:00:00+08:00');
    const next = assigned(pairings[1]!, '2026-11-01T23:29:00+08:00');
    expect(
      validate([first, next], { policy: { ...policy, minRestMinutes: 30 } }).some(
        (conflict) => conflict.code === 'MIN_REST',
      ),
    ).toBe(true);
    expect(
      validate([first, assigned(pairings[1]!, '2026-11-01T23:30:00+08:00')], {
        policy: { ...policy, minRestMinutes: 30 },
      }),
    ).toEqual([]);
    const crossMidnight = [
      assigned(pairings[0]!, '2026-11-01T23:00:00+08:00'),
      assigned(pairings[1]!, '2026-11-02T00:00:00+08:00'),
    ];
    expect(validate(crossMidnight, { policy: { ...policy, minLocalDayGap: 1 } })).toEqual([]);
    expect(
      validate(crossMidnight, { policy: { ...policy, minLocalDayGap: 2 } }).some(
        (conflict) => conflict.code === 'MIN_LOCAL_DAY_GAP',
      ),
    ).toBe(true);
  });
  it('跨event占用按canonical team与court检测，只报告本方fixture和资源时间', () => {
    const fixture = assigned(pairings[0]!, '2026-11-01T08:00:00+08:00');
    const conflicts = validate([fixture], {
      reservations: [
        {
          kind: 'TEAM',
          resourceId: id(103),
          startsAt: '2026-11-01T00:30:00.000Z',
          endsAt: '2026-11-01T01:30:00.000Z',
        },
        {
          kind: 'COURT',
          resourceId: id(600),
          startsAt: '2026-11-01T00:30:00.000Z',
          endsAt: '2026-11-01T01:30:00.000Z',
        },
      ],
    });
    expect(conflicts).toEqual(
      expect.arrayContaining([
        {
          code: 'TEAM_OVERLAP',
          fixtureKeys: ['R1-P2'],
          resourceId: id(103),
          startsAt: fixture.startsAt,
          endsAt: fixture.endsAt,
          external: true,
        },
        {
          code: 'COURT_OVERLAP',
          fixtureKeys: ['R1-P2'],
          resourceId: id(600),
          startsAt: fixture.startsAt,
          endsAt: fixture.endsAt,
          external: true,
        },
      ]),
    );
    expect(JSON.stringify(conflicts)).not.toContain('eventId');
  });

  it('服务器来源中的半份分配、非法时间及篡改时长不能变成可发布的冲突提示', () => {
    const valid = assigned(pairings[0]!, '2026-11-01T08:00:00+08:00');
    for (const changed of [
      { endsAt: null },
      { startsAt: null },
      { endsAt: '2026-11-01T00:59:00.000Z' },
      { startsAt: '2026-02-29T00:00:00.000Z' },
      { homeEntryId: id(999) },
      { fixtureKey: 'forged' },
    ]) {
      try {
        validate([{ ...valid, ...changed }]);
        expect.fail('corrupted source must be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('SCHEDULE_SOURCE_MISMATCH');
      }
    }
  });

  it('32队所有496场同时冲突时合并资源证据，仍可定位每场', () => {
    const largeFreeze = freeze(32);
    const largeFixtures = generatePairings(largeFreeze, policy, seed).fixtures.map((fixture) =>
      assigned(fixture, '2026-11-01T08:00:00+08:00'),
    );
    const conflicts = validateSchedule({
      event,
      freeze: largeFreeze,
      policy,
      fixtures: largeFixtures,
      courts: [{ id: id(600), status: 'ACTIVE' }],
      reservations: [],
    });
    expect(conflicts).toHaveLength(33); // one canonical Court plus 32 canonical Teams
    const courtConflict = conflicts.find((conflict) => conflict.code === 'COURT_OVERLAP')!;
    expect(courtConflict.fixtureKeys).toHaveLength(496);
    for (const entry of largeFreeze.entries)
      expect(
        conflicts.find(
          (conflict) => conflict.code === 'TEAM_OVERLAP' && conflict.resourceId === entry.teamId,
        )?.fixtureKeys,
      ).toHaveLength(31);
    expect(JSON.stringify(conflicts).length).toBeLessThan(30_000);
  });

  it('上海历史夏令时边界用本地日期差，不以相隔24小时推算', () => {
    const fixtures = [
      assigned(pairings[0]!, '1991-04-14T00:00:00+08:00'),
      assigned(pairings[1]!, '1991-04-15T00:00:00+09:00'),
    ];
    expect(Date.parse(fixtures[1]!.startsAt!) - Date.parse(fixtures[0]!.startsAt!)).toBe(
      23 * 60 * 60_000,
    );
    const historicalPolicy = {
      ...policy,
      minLocalDayGap: 1,
      courtWindows: [
        {
          courtId: id(600),
          startsAt: '1991-04-13T16:00:00.000Z',
          endsAt: '1991-04-15T16:00:00.000Z',
        },
      ],
    };
    expect(
      validateSchedule({
        event: { ...event, startDate: '1991-04-14', endDate: '1991-04-15' },
        freeze: source,
        policy: historicalPolicy,
        fixtures,
        courts: [{ id: id(600), status: 'ACTIVE' }],
        reservations: [],
      }),
    ).toEqual([]);
  });
});

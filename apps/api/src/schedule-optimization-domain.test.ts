import { describe, expect, it } from 'vitest';
import type {
  RegistrationFreezeData,
  ScheduleFixtureData,
  SchedulePolicy,
} from '@small-city-basketball/contracts';
import { generateDoubleRoundRobinPairings } from './double-round-robin-domain.js';
import { generatePairings, parseAllocationInput, validateSchedule } from './scheduling-domain.js';
import { optimizeSchedule } from './schedule-optimization-domain.js';
import type { ScheduleValidationContext } from './scheduling-domain.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seed = '00'.repeat(32);
function freeze(n = 4): RegistrationFreezeData {
  return {
    id: id(100),
    eventId: id(101),
    rulesetId: id(102),
    rulesetVersion: 1,
    eventVersion: 3,
    entries: Array.from({ length: n }, (_, i) => ({
      entryId: id(i + 1),
      teamId: id(200 + i),
      teamName: `T${i}`,
      rosterRevisionId: id(300 + i),
      players: [{ memberId: id(400 + i), name: `P${i}`, jerseyNo: String(i + 1) }],
    })),
    excludedCounts: { DRAFT: 0, REJECTED: 0, WITHDRAWN: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
const policy: SchedulePolicy = {
  slotDurationMinutes: 60,
  minRestMinutes: 0,
  minLocalDayGap: 0,
  courtWindows: [
    { courtId: id(500), startsAt: '2026-11-01T10:00:00.000Z', endsAt: '2026-11-01T12:00:00.000Z' },
  ],
};
function fixture(key: string, a: number, b: number): ScheduleFixtureData {
  const [, r, p] = /^R(\d+)-P(\d+)$/.exec(key)!;
  return {
    fixtureKey: key,
    roundNo: Number(r),
    positionNo: Number(p),
    homeEntryId: id(a),
    awayEntryId: id(b),
    courtId: null,
    startsAt: null,
    endsAt: null,
  };
}
function context(
  fixtures = [fixture('R1-P1', 3, 4), fixture('R1-P2', 1, 2)],
): ScheduleValidationContext {
  return {
    event: {
      id: id(101),
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      timezone: 'Asia/Shanghai',
    },
    freeze: freeze(),
    policy,
    fixtures,
    courts: [{ id: id(500), status: 'ACTIVE' }],
    reservations: [],
  };
}
function verify(c: ScheduleValidationContext, result: ReturnType<typeof optimizeSchedule>) {
  expect(
    validateSchedule({
      ...c,
      fixtures: c.fixtures.map((f) => {
        const a = result.allocations.find((a) => a.fixtureKey === f.fixtureKey)!;
        return {
          ...f,
          ...a,
          endsAt: a.startsAt
            ? new Date(Date.parse(a.startsAt) + c.policy.slotDurationMinutes * 60000).toISOString()
            : null,
        };
      }),
    }).filter((c) => c.code !== 'UNASSIGNED'),
  ).toEqual([]);
}
describe('DRR_CIRCLE_V1', () => {
  it.each(Array.from({ length: 31 }, (_, i) => i + 2))(
    '%i队双回合每对各主客一次且第二回合独立轮次',
    (n) => {
      const f = freeze(n),
        d = generateDoubleRoundRobinPairings(f, policy, seed),
        one = generatePairings(f, policy, seed);
      expect(d.fixtures).toHaveLength(n * (n - 1));
      expect(d.rounds).toHaveLength(one.rounds.length * 2);
      expect(new Set(d.fixtures.map((f) => f.fixtureKey)).size).toBe(n * (n - 1));
      const directed = new Set(d.fixtures.map((f) => `${f.homeEntryId}|${f.awayEntryId}`));
      expect(directed.size).toBe(n * (n - 1));
      for (const a of f.entries)
        for (const b of f.entries)
          if (a !== b) expect(directed.has(`${a.entryId}|${b.entryId}`)).toBe(true);
      expect(d.fixtures.slice(0, one.fixtures.length)).toEqual(one.fixtures);
      expect(d.inputHash).not.toBe(one.inputHash);
    },
  );
  it('32队992场分配和62轮均可表示，旧RR生成不变', () => {
    const f = freeze(32),
      d = generateDoubleRoundRobinPairings(f, policy, seed);
    expect(
      parseAllocationInput(
        d.fixtures.map((f) => ({ fixtureKey: f.fixtureKey, courtId: null, startsAt: null })),
        d.fixtures.map((f) => f.fixtureKey),
        60,
      ),
    ).toHaveLength(992);
    expect(validateSchedule({ ...context(), freeze: f, fixtures: d.fixtures })).toHaveLength(992);
    expect(d.rounds.at(-1)!.roundNo).toBe(62);
  });
});
describe('服务端全稿有界优化', () => {
  it('全稿搜索能回退首场安排，为仅剩早场的球队保留时隙', () => {
    const c = context();
    c.reservations = [
      {
        kind: 'TEAM',
        resourceId: c.freeze.entries[0]!.teamId,
        startsAt: '2026-11-01T11:00:00.000Z',
        endsAt: '2026-11-01T12:00:00.000Z',
      },
    ];
    const result = optimizeSchedule(c);
    expect(result.status).toBe('COMPLETE');
    expect(result.allocations[0]!.startsAt).toBe('2026-11-01T11:00:00.000Z');
    expect(result.allocations[1]!.startsAt).toBe('2026-11-01T10:00:00.000Z');
    verify(c, result);
    expect(optimizeSchedule(c)).toEqual(result);
  });
  it('首末场公平度按本赛事实际日场次计算，并遵守隔日规则', () => {
    const c = context(generatePairings(freeze(), policy, seed).fixtures);
    c.policy = {
      ...policy,
      minLocalDayGap: 1,
      courtWindows: [1, 2, 3].map((d) => ({
        courtId: id(500),
        startsAt: `2026-11-0${d}T10:00:00.000Z`,
        endsAt: `2026-11-0${d}T12:00:00.000Z`,
      })),
    };
    const result = optimizeSchedule(c);
    expect(result.status).toBe('COMPLETE');
    expect(result.score.firstLastPenalty).toBeLessThanOrEqual(24);
    verify(c, result);
  });
  it('跨赛事已占用时间与休息／比赛日间隔共同约束', () => {
    const c = context([fixture('R1-P1', 1, 2)]);
    c.policy = {
      ...policy,
      minRestMinutes: 120,
      minLocalDayGap: 1,
      courtWindows: [
        ...policy.courtWindows,
        {
          courtId: id(500),
          startsAt: '2026-11-02T10:00:00.000Z',
          endsAt: '2026-11-02T11:00:00.000Z',
        },
      ],
    };
    c.reservations = [
      {
        kind: 'TEAM',
        resourceId: c.freeze.entries[0]!.teamId,
        startsAt: '2026-11-01T08:00:00.000Z',
        endsAt: '2026-11-01T09:00:00.000Z',
      },
    ];
    const result = optimizeSchedule(c);
    expect(result.allocations[0]!.startsAt).toBe('2026-11-02T10:00:00.000Z');
    verify(c, result);
  });
  it('默认保留已有安排，冲突只能由明确全稿重排解除', () => {
    const c = context();
    c.fixtures[0] = {
      ...c.fixtures[0]!,
      courtId: id(500),
      startsAt: '2026-11-01T11:00:00.000Z',
      endsAt: '2026-11-01T12:00:00.000Z',
    };
    const result = optimizeSchedule(c);
    expect(result.preservedCount).toBe(1);
    expect(result.allocations[0]!.startsAt).toBe(c.fixtures[0]!.startsAt);
    c.reservations = [
      {
        kind: 'COURT',
        resourceId: id(500),
        startsAt: '2026-11-01T11:00:00.000Z',
        endsAt: '2026-11-01T12:00:00.000Z',
      },
    ];
    expect(() => optimizeSchedule(c)).toThrow('已有安排存在冲突');
    const rearranged = optimizeSchedule(c, { preserveAssigned: false });
    expect(rearranged.preservedCount).toBe(0);
    verify(c, rearranged);
  });
  it('预算耗尽明确报告未排项，不把搜索未找到写成无解', () => {
    const result = optimizeSchedule(context(), { maxChecks: 1 });
    expect(result.limitReached).toBe(true);
    expect(result.checks).toBe(1);
    expect(result.status).toBe('LIMIT_REACHED');
    expect(result.unassigned.length).toBeGreaterThan(0);
    expect(result.unassigned.every((u) => u.reason === 'SEARCH_LIMIT')).toBe(true);
  });
  it('淘汰阶段起点屏障不允许建议先于来源场次结束', () => {
    const c = context([fixture('R1-P1', 1, 2)]);
    const r = optimizeSchedule(c, { earliestStart: '2026-11-01T11:00:00.000Z' });
    expect(r.allocations[0]!.startsAt).toBe('2026-11-01T11:00:00.000Z');
    verify(c, r);
  });
  it('停用场地不安排，原输入完全不变且预览不是预约', () => {
    const c = context();
    c.courts[0]!.status = 'DISABLED';
    const before = JSON.stringify(c);
    const result = optimizeSchedule(c);
    expect(result.status).toBe('PARTIAL');
    expect(result.score.assignedCount).toBe(0);
    expect(result.optimality).toBe('BOUNDED_HEURISTIC');
    expect(JSON.stringify(c)).toBe(before);
  });
  it('非真实冻结球队来源和无效预算失败关闭', () => {
    const c = context();
    c.fixtures[0]!.homeEntryId = id(999);
    expect(() => optimizeSchedule(c)).toThrow();
    expect(() => optimizeSchedule(context(), { maxChecks: 100001 })).toThrow();
  });
});

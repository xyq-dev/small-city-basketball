import { describe, expect, it } from 'vitest';
import type { ScheduleFixtureData } from '@small-city-basketball/contracts';
import { MAX_SUGGESTION_CHECKS, suggestSchedule } from './auto-schedule';
import type { SuggestionContext, ScheduleSuggestion } from './auto-schedule';
import { court, overview, revision } from './test-fixtures';

function context(): SuggestionContext {
  return structuredClone({
    fixtures: revision.fixtures,
    policy: revision.policy,
    courts: [court],
    eventDates: overview.event,
    allocations: revision.fixtures.map((fixture) => ({
      fixtureKey: fixture.fixtureKey,
      courtId: fixture.courtId,
      startsAt: fixture.startsAt,
    })),
  });
}
function assertLocalConstraints(input: SuggestionContext, result: ScheduleSuggestion) {
  const assignments = [
    ...input.allocations.filter((item) => item.courtId && item.startsAt),
    ...result.allocations,
  ];
  const seen = new Set<string>();
  for (const item of assignments) {
    expect(seen.has(item.fixtureKey)).toBe(false);
    seen.add(item.fixtureKey);
    const start = Date.parse(item.startsAt!);
    const end = start + input.policy.slotDurationMinutes * 60_000;
    expect(
      input.policy.courtWindows.some(
        (window) =>
          window.courtId === item.courtId &&
          Date.parse(window.startsAt) <= start &&
          Date.parse(window.endsAt) >= end,
      ),
    ).toBe(true);
    expect(
      new Date(start + 8 * 3600000).toISOString().slice(0, 10) >= input.eventDates.startDate,
    ).toBe(true);
    expect(
      new Date(end - 1 + 8 * 3600000).toISOString().slice(0, 10) <= input.eventDates.endDate,
    ).toBe(true);
  }
  for (let i = 0; i < assignments.length; i++) {
    for (const b of assignments.slice(i + 1)) {
      const a = assignments[i]!;
      const aStart = Date.parse(a.startsAt!);
      const bStart = Date.parse(b.startsAt!);
      const duration = input.policy.slotDurationMinutes * 60000;
      if (a.courtId === b.courtId)
        expect(Math.abs(aStart - bStart)).toBeGreaterThanOrEqual(duration);
      const fa = input.fixtures.find((item) => item.fixtureKey === a.fixtureKey)!;
      const fb = input.fixtures.find((item) => item.fixtureKey === b.fixtureKey)!;
      const shared = [fa.homeEntryId, fa.awayEntryId].some((id) =>
        [fb.homeEntryId, fb.awayEntryId].includes(id),
      );
      if (shared) {
        expect(Math.abs(aStart - bStart) - duration).toBeGreaterThanOrEqual(
          input.policy.minRestMinutes * 60000,
        );
        const aDay = Math.floor((aStart + 8 * 3600000) / 86400000);
        const bDay = Math.floor((bStart + 8 * 3600000) / 86400000);
        expect(Math.abs(aDay - bDay)).toBeGreaterThanOrEqual(input.policy.minLocalDayGap);
      }
    }
  }
}

describe('有界自动排时建议', () => {
  it('三队循环按真实休息间隔安排，不修改来源，重复生成稳定', async () => {
    const input = context();
    const before = structuredClone(input);
    const result = await suggestSchedule(input);
    expect(result.status).toBe('COMPLETE');
    expect(result.allocations).toHaveLength(3);
    expect(result.allocations.map((item) => item.startsAt)).toEqual([
      '2026-12-01T01:00:00.000Z',
      '2026-12-01T02:30:00.000Z',
      '2026-12-01T04:00:00.000Z',
    ]);
    assertLocalConstraints(input, result);
    expect(input).toEqual(before);
    expect(await suggestSchedule(input)).toEqual(result);
  });

  it('保留已填安排，能在未来已填比赛之前寻找合法空位', async () => {
    const input = context();
    input.allocations[0] = {
      fixtureKey: input.fixtures[0]!.fixtureKey,
      courtId: court.id,
      startsAt: '2026-12-01T03:00:00.000Z',
    };
    const result = await suggestSchedule(input);
    expect(result.preservedCount).toBe(1);
    expect(result.allocations).toHaveLength(2);
    expect(
      result.allocations.some((item) => item.fixtureKey === input.allocations[0]!.fixtureKey),
    ).toBe(false);
    expect(result.allocations[0]!.startsAt).toBe('2026-12-01T01:00:00.000Z');
    assertLocalConstraints(input, result);
  });

  it('不完整已有输入阻止建议，不能静默当作空白覆盖', async () => {
    const input = context();
    input.allocations[0]!.courtId = court.id;
    await expect(suggestSchedule(input)).rejects.toThrow('同时填写场地和时间');
    input.allocations[0]!.startsAt = 'not-a-date';
    await expect(suggestSchedule(input)).rejects.toThrow('时间无效');
  });

  it('保留安排已冲突或越出窗口时要求人工修正，不用建议掩盖问题', async () => {
    const input = context();
    input.allocations[0] = {
      fixtureKey: input.fixtures[0]!.fixtureKey,
      courtId: court.id,
      startsAt: '2026-12-01T00:30:00.000Z',
    };
    await expect(suggestSchedule(input)).rejects.toThrow('超出赛事可用窗口');
    input.allocations[0]!.startsAt = '2026-12-01T01:00:00.000Z';
    input.allocations[1] = {
      fixtureKey: input.fixtures[1]!.fixtureKey,
      courtId: court.id,
      startsAt: '2026-12-01T01:30:00.000Z',
    };
    await expect(suggestSchedule(input)).rejects.toThrow('休息规则冲突');
  });

  it('日期间隔使用中国标准时间开赛日期，隔日打不会排到相邻一天', async () => {
    const input = context();
    input.policy.minLocalDayGap = 2;
    input.policy.courtWindows = [1, 2, 3, 4, 5].map((day) => ({
      courtId: court.id,
      startsAt: `2026-12-0${day}T01:00:00.000Z`,
      endsAt: `2026-12-0${day}T03:00:00.000Z`,
    }));
    const result = await suggestSchedule(input);
    expect(result.allocations.map((item) => item.startsAt.slice(0, 10))).toEqual([
      '2026-12-01',
      '2026-12-03',
      '2026-12-05',
    ]);
    assertLocalConstraints(input, result);
  });

  it('窗口不足保留部分建议和逐场未排原因，不声称无解', async () => {
    const input = context();
    input.policy.courtWindows[0]!.endsAt = '2026-12-01T02:00:00.000Z';
    const result = await suggestSchedule(input);
    expect(result.status).toBe('PARTIAL');
    expect(result.allocations).toHaveLength(1);
    expect(result.unassigned).toHaveLength(2);
    expect(result.unassigned.every((item) => item.reason === 'NO_SLOT')).toBe(true);
    assertLocalConstraints(input, result);
  });

  it('禁用场地不产生安排，另一个启用场地可被选择', async () => {
    const input = context();
    input.courts[0]!.status = 'DISABLED';
    expect(
      (await suggestSchedule(input)).unassigned.every((item) => item.reason === 'NO_WINDOW'),
    ).toBe(true);
    input.courts.push({ id: 'court-b', status: 'ACTIVE' });
    input.policy.courtWindows.push({ ...input.policy.courtWindows[0]!, courtId: 'court-b' });
    const result = await suggestSchedule(input);
    expect(result.allocations).toHaveLength(3);
    expect(result.allocations.every((item) => item.courtId === 'court-b')).toBe(true);
    assertLocalConstraints(input, result);
  });

  it('所有窗口都裁剪到赛事日期，结束时刻允许正好次日零时', async () => {
    const input = context();
    input.eventDates = { startDate: '2026-12-01', endDate: '2026-12-01' };
    input.policy.courtWindows = [
      {
        courtId: court.id,
        startsAt: '2026-11-30T00:00:00.000Z',
        endsAt: '2026-12-02T00:00:00.000Z',
      },
    ];
    const result = await suggestSchedule(input);
    expect(result.allocations[0]!.startsAt).toBe('2026-11-30T16:00:00.000Z');
    assertLocalConstraints(input, result);
    input.policy.slotDurationMinutes = 1440;
    const oneDay = await suggestSchedule(input);
    expect(oneDay.allocations).toHaveLength(1);
    assertLocalConstraints(input, oneDay);
  });

  it('多个球场同一时刻不会使同队同时出赛，独立对阵可以并行', async () => {
    const input = context();
    input.fixtures = [
      { ...revision.fixtures[0]!, fixtureKey: 'R1-P1', homeEntryId: 'a', awayEntryId: 'b' },
      {
        ...revision.fixtures[1]!,
        fixtureKey: 'R1-P2',
        roundNo: 1,
        positionNo: 2,
        homeEntryId: 'c',
        awayEntryId: 'd',
      },
      {
        ...revision.fixtures[2]!,
        fixtureKey: 'R2-P1',
        roundNo: 2,
        homeEntryId: 'a',
        awayEntryId: 'c',
      },
    ];
    input.allocations = input.fixtures.map((fixture) => ({
      fixtureKey: fixture.fixtureKey,
      courtId: null,
      startsAt: null,
    }));
    input.courts.push({ id: 'court-b', status: 'ACTIVE' });
    input.policy.courtWindows.push({ ...input.policy.courtWindows[0]!, courtId: 'court-b' });
    const result = await suggestSchedule(input);
    expect(result.allocations[0]!.startsAt).toBe(result.allocations[1]!.startsAt);
    expect(result.allocations[0]!.courtId).not.toBe(result.allocations[1]!.courtId);
    assertLocalConstraints(input, result);
  });

  it('达到预算只返回完整检查的建议，不能产生半检查候选', async () => {
    const input = context();
    const result = await suggestSchedule(input, { maxChecks: 10 });
    expect(result.status).toBe('LIMIT_REACHED');
    expect(result.checks).toBe(10);
    expect(result.allocations.length).toBeLessThan(3);
    expect(result.allocations.length + result.unassigned.length).toBe(3);
    expect(result.unassigned.every((item) => item.reason === 'LIMIT_REACHED')).toBe(true);
    assertLocalConstraints(input, result);
    await expect(suggestSchedule(input, { maxChecks: MAX_SUGGESTION_CHECKS + 1 })).rejects.toThrow(
      '预算无效',
    );
  });

  it('取消信号不修改输入，并能在大批计算途中响应', async () => {
    const controller = new AbortController();
    const input = context();
    input.fixtures = Array.from({ length: 100 }, (_, index): ScheduleFixtureData => ({
      ...revision.fixtures[index % 3]!,
      fixtureKey: `fixture-${index}`,
      roundNo: index + 1,
    }));
    input.allocations = input.fixtures.map((fixture) => ({
      fixtureKey: fixture.fixtureKey,
      courtId: null,
      startsAt: null,
    }));
    const before = structuredClone(input);
    const abort = setTimeout(() => controller.abort(), 0);
    const result = await suggestSchedule(input, { signal: controller.signal });
    clearTimeout(abort);
    expect(result.status).toBe('CANCELLED');
    expect(result.checks).toBeLessThan(MAX_SUGGESTION_CHECKS);
    expect(input).toEqual(before);
    assertLocalConstraints(input, result);
  });

  it('拒绝不一致来源、非法日期和超过原单循环规模的输入', async () => {
    const input = context();
    input.allocations.pop();
    await expect(suggestSchedule(input)).rejects.toThrow('对阵不一致');
    const dates = context();
    dates.eventDates.startDate = '2026-02-30';
    await expect(suggestSchedule(dates)).rejects.toThrow('日期无效');
    const oversized = context();
    oversized.fixtures = Array(497).fill(revision.fixtures[0]!);
    await expect(suggestSchedule(oversized)).rejects.toThrow('计算范围');
  });
});

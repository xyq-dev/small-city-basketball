import { describe, expect, it } from 'vitest';
import type { ScheduleOptimizationPreview } from '@small-city-basketball/contracts';
import { parseOptimizationPreview } from './optimization-preview';
import { optimizationPreview } from './optimization-fixtures';
import { court, revision } from './test-fixtures';

describe('权威排程预演响应合同', () => {
  it('接受全量安排与达到搜索上限但已经全排的合法结果', () => {
    const result = optimizationPreview();
    expect(parseOptimizationPreview(result, revision, [court], true)).toBe(result);
    result.limitReached = true;
    expect(parseOptimizationPreview(result, revision, [court], false)).toBe(result);
  });
  it.each([
    ['陈旧赛事', (r: ScheduleOptimizationPreview) => r.eventVersion++],
    ['陈旧修订', (r: ScheduleOptimizationPreview) => r.revisionVersion++],
    ['不明算法', (r: ScheduleOptimizationPreview) => Object.assign(r, { algorithm: 'OTHER' })],
    ['错误来源哈希', (r: ScheduleOptimizationPreview) => (r.sourceHash = 'not-a-hash')],
    ['虚构最优', (r: ScheduleOptimizationPreview) => Object.assign(r, { optimality: 'OPTIMAL' })],
    ['遗漏场次', (r: ScheduleOptimizationPreview) => r.allocations.pop()],
    ['重复场次', (r: ScheduleOptimizationPreview) => (r.allocations[1] = r.allocations[0]!)],
    ['陌生场次', (r: ScheduleOptimizationPreview) => (r.allocations[0]!.fixtureKey = 'foreign')],
    ['陌生场地', (r: ScheduleOptimizationPreview) => (r.allocations[0]!.courtId = 'foreign')],
    ['半空分配', (r: ScheduleOptimizationPreview) => (r.allocations[0]!.courtId = null)],
    [
      '无效日历',
      (r: ScheduleOptimizationPreview) => (r.allocations[0]!.startsAt = '2026-02-31T01:00:00.000Z'),
    ],
    [
      '不在窗口',
      (r: ScheduleOptimizationPreview) => (r.allocations[0]!.startsAt = '2026-12-02T01:00:00.000Z'),
    ],
    ['搜索越界', (r: ScheduleOptimizationPreview) => (r.checks = 100001)],
    ['保留数量虚报', (r: ScheduleOptimizationPreview) => (r.preservedCount = 1)],
    ['已排数量错误', (r: ScheduleOptimizationPreview) => (r.score.assignedCount = 1)],
    ['未知公平度', (r: ScheduleOptimizationPreview) => (r.score.firstLastPenalty = NaN)],
    ['最晚结束错位', (r: ScheduleOptimizationPreview) => (r.score.latestEnd = null)],
    [
      '伪造未排',
      (r: ScheduleOptimizationPreview) =>
        r.unassigned.push({ fixtureKey: r.allocations[0]!.fixtureKey, reason: 'SEARCH_LIMIT' }),
    ],
    ['状态错位', (r: ScheduleOptimizationPreview) => (r.status = 'PARTIAL')],
  ])('拒绝%s', (_label, mutate) => {
    const result = optimizationPreview();
    mutate(result);
    expect(() => parseOptimizationPreview(result, revision, [court], true)).toThrow('不一致');
  });
  it('保留模式按实际时刻检查旧安排，全稿保留数量必须0', () => {
    const saved = structuredClone(revision);
    saved.fixtures[0]!.courtId = court.id;
    saved.fixtures[0]!.startsAt = '2026-12-01T09:00:00.000+08:00';
    const result = optimizationPreview(saved);
    result.preservedCount = 1;
    expect(parseOptimizationPreview(result, saved, [court], true)).toBe(result);
    result.allocations[0]!.startsAt = '2026-12-01T02:00:00.000Z';
    expect(() => parseOptimizationPreview(result, saved, [court], true)).toThrow();
    expect(() => parseOptimizationPreview(result, saved, [court], false)).toThrow();
  });
  it('部分结果精确对应null/null且未排原因与搜索状态一致', () => {
    const result = optimizationPreview();
    const last = result.allocations.at(-1)!;
    last.courtId = null;
    last.startsAt = null;
    result.unassigned = [{ fixtureKey: last.fixtureKey, reason: 'NO_FEASIBLE_SLOT_FOUND' }];
    result.status = 'PARTIAL';
    result.score.assignedCount = 2;
    result.score.latestEnd = '2026-12-01T03:30:00.000Z';
    expect(parseOptimizationPreview(result, revision, [court], false)).toBe(result);
    result.unassigned.push(result.unassigned[0]!);
    expect(() => parseOptimizationPreview(result, revision, [court], false)).toThrow();
    result.unassigned.pop();
    result.status = 'LIMIT_REACHED';
    result.limitReached = true;
    expect(() => parseOptimizationPreview(result, revision, [court], false)).toThrow();
    result.unassigned[0]!.reason = 'SEARCH_LIMIT';
    expect(parseOptimizationPreview(result, revision, [court], false)).toBe(result);
  });
  it('停用场地不可被当作有效安排', () => {
    expect(() =>
      parseOptimizationPreview(
        optimizationPreview(),
        revision,
        [{ ...court, status: 'DISABLED' }],
        false,
      ),
    ).toThrow();
  });
});

import type {
  ScheduleOptimizationPreview,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';
import { court, revision } from './test-fixtures';

export function optimizationPreview(
  saved: ScheduleRevisionData = revision,
): ScheduleOptimizationPreview {
  const allocations = saved.fixtures.map((fixture, index) => ({
    fixtureKey: fixture.fixtureKey,
    courtId: court.id,
    startsAt: new Date(Date.parse('2026-12-01T01:00:00.000Z') + index * 90 * 60000).toISOString(),
  }));
  return {
    algorithm: 'BALANCED_SEARCH_V1',
    eventVersion: saved.eventVersion,
    revisionVersion: saved.version,
    sourceHash: 'd'.repeat(64),
    status: 'COMPLETE',
    allocations,
    unassigned: [],
    preservedCount: 0,
    checks: 20,
    limitReached: false,
    score: {
      assignedCount: allocations.length,
      firstLastPenalty: 2,
      latestEnd: '2026-12-01T05:00:00.000Z',
    },
    optimality: 'BOUNDED_HEURISTIC',
  };
}

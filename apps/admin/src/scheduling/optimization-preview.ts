import type {
  CourtData,
  ScheduleOptimizationPreview,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
}

/** Validate an advisory server response against the exact saved draft requested. */
export function parseOptimizationPreview(
  value: unknown,
  revision: ScheduleRevisionData,
  courts: CourtData[],
  preserveAssigned: boolean,
): ScheduleOptimizationPreview {
  const invalid = (): never => {
    throw new Error('服务端预演与当前草稿不一致，请重新读取后再生成');
  };
  if (
    !object(value) ||
    value.algorithm !== 'BALANCED_SEARCH_V1' ||
    value.optimality !== 'BOUNDED_HEURISTIC' ||
    value.eventVersion !== revision.eventVersion ||
    value.revisionVersion !== revision.version ||
    typeof value.sourceHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sourceHash) ||
    !Array.isArray(value.allocations) ||
    value.allocations.length !== revision.fixtures.length ||
    !Array.isArray(value.unassigned) ||
    !count(value.checks, 100000) ||
    !count(value.preservedCount, revision.fixtures.length) ||
    typeof value.limitReached !== 'boolean' ||
    !object(value.score) ||
    !count(value.score.assignedCount, revision.fixtures.length) ||
    !count(value.score.firstLastPenalty) ||
    (value.score.latestEnd !== null && !timestamp(value.score.latestEnd))
  )
    return invalid();
  const original = new Map(revision.fixtures.map((fixture) => [fixture.fixtureKey, fixture]));
  if (original.size !== revision.fixtures.length || original.size > 992) return invalid();
  const activeCourts = new Set(
    courts.filter((court) => court.status === 'ACTIVE').map((c) => c.id),
  );
  const seen = new Set<string>();
  const missing = new Set<string>();
  let preserved = 0;
  let latestEnd: string | null = null;
  for (const item of value.allocations) {
    if (!object(item) || typeof item.fixtureKey !== 'string') return invalid();
    const before = original.get(item.fixtureKey);
    if (!before || seen.has(item.fixtureKey)) return invalid();
    seen.add(item.fixtureKey);
    if (item.courtId === null && item.startsAt === null) missing.add(item.fixtureKey);
    else {
      if (
        typeof item.courtId !== 'string' ||
        !activeCourts.has(item.courtId) ||
        !timestamp(item.startsAt)
      )
        return invalid();
      const start = Date.parse(item.startsAt);
      const end = start + revision.policy.slotDurationMinutes * 60000;
      if (
        !Number.isFinite(end) ||
        !revision.policy.courtWindows.some(
          (window) =>
            window.courtId === item.courtId &&
            start >= Date.parse(window.startsAt) &&
            end <= Date.parse(window.endsAt),
        )
      )
        return invalid();
      const endText = new Date(end).toISOString();
      if (latestEnd === null || endText > latestEnd) latestEnd = endText;
    }
    if (preserveAssigned && (before.courtId !== null || before.startsAt !== null)) {
      if (
        before.courtId !== item.courtId ||
        !before.startsAt ||
        !timestamp(item.startsAt) ||
        Date.parse(before.startsAt) !== Date.parse(item.startsAt)
      )
        return invalid();
      preserved++;
    }
  }
  const unassigned = new Set<string>();
  for (const item of value.unassigned) {
    if (
      !object(item) ||
      typeof item.fixtureKey !== 'string' ||
      !missing.has(item.fixtureKey) ||
      unassigned.has(item.fixtureKey) ||
      item.reason !== (value.limitReached ? 'SEARCH_LIMIT' : 'NO_FEASIBLE_SLOT_FOUND')
    )
      return invalid();
    unassigned.add(item.fixtureKey);
  }
  const status = missing.size === 0 ? 'COMPLETE' : value.limitReached ? 'LIMIT_REACHED' : 'PARTIAL';
  if (
    unassigned.size !== missing.size ||
    value.status !== status ||
    value.score.assignedCount !== original.size - missing.size ||
    value.preservedCount !== preserved ||
    value.score.latestEnd !== latestEnd
  )
    return invalid();
  return value as unknown as ScheduleOptimizationPreview;
}

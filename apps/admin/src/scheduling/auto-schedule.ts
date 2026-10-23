import type {
  CourtData,
  ScheduleFixtureData,
  SchedulePolicy,
} from '@small-city-basketball/contracts';

const MINUTE = 60_000;
const DAY = 86_400_000;
const CHINA_OFFSET = 8 * 60 * MINUTE;
export const MAX_SUGGESTION_CHECKS = 100_000;

export interface AllocationInput {
  fixtureKey: string;
  courtId: string | null;
  startsAt: string | null;
}
export interface ScheduleSuggestion {
  allocations: { fixtureKey: string; courtId: string; startsAt: string }[];
  unassigned: {
    fixtureKey: string;
    reason: 'NO_WINDOW' | 'NO_SLOT' | 'LIMIT_REACHED' | 'CANCELLED';
  }[];
  preservedCount: number;
  checks: number;
  status: 'COMPLETE' | 'PARTIAL' | 'LIMIT_REACHED' | 'CANCELLED';
}
export interface SuggestionContext {
  fixtures: ScheduleFixtureData[];
  policy: SchedulePolicy;
  courts: Pick<CourtData, 'id' | 'status'>[];
  eventDates: { startDate: string; endDate: string };
  allocations: AllocationInput[];
}
interface Occupied {
  courtId: string;
  start: number;
  end: number;
  teams: [string, string];
}
const ordinal = (instant: number) => Math.floor((instant + CHINA_OFFSET) / DAY);
function afterConflict(candidate: Occupied, busy: Occupied, policy: SchedulePolicy) {
  const { start, end } = candidate;
  const overlaps = start < busy.end && busy.start < end;
  let next = start;
  if (candidate.courtId === busy.courtId && overlaps) next = busy.end;
  if (!busy.teams.some((team) => candidate.teams.includes(team))) return next;
  const rest = policy.minRestMinutes * MINUTE;
  if (
    overlaps ||
    (start >= busy.end && start - busy.end < rest) ||
    (end <= busy.start && busy.start - end < rest)
  )
    next = Math.max(next, busy.end + rest);
  if (Math.abs(ordinal(start) - ordinal(busy.start)) < policy.minLocalDayGap)
    next = Math.max(next, (ordinal(busy.start) + policy.minLocalDayGap) * DAY - CHINA_OFFSET);
  return next;
}
function dateBoundary(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('赛事日期无效，请重新读取资料。');
  const parsed = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value)
    throw new Error('赛事日期无效，请重新读取资料。');
  return parsed - CHINA_OFFSET;
}
function timestamp(value: string) {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error('已有安排时间无效，请先修正或取消分配。');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('已有安排时间无效，请先修正或取消分配。');
  return parsed;
}

// The generator yields once for every bounded unit of work. The async driver
// lets the browser process a cancel click; no worker or second scheduling state
// is needed. This is a first-fit suggestion, never a feasibility proof.
function* compute(
  context: SuggestionContext,
  result: ScheduleSuggestion,
): Generator<void, ScheduleSuggestion, void> {
  const { policy, allocations, fixtures, eventDates, courts } = context;
  if (
    fixtures.length > 496 ||
    allocations.length > 496 ||
    policy.courtWindows.length > 200 ||
    !Number.isInteger(policy.slotDurationMinutes) ||
    policy.slotDurationMinutes < 1 ||
    policy.slotDurationMinutes > 1440 ||
    !Number.isInteger(policy.minRestMinutes) ||
    policy.minRestMinutes < 0 ||
    policy.minRestMinutes > 43_200 ||
    !Number.isInteger(policy.minLocalDayGap) ||
    policy.minLocalDayGap < 0 ||
    policy.minLocalDayGap > 365
  )
    throw new Error('当前排赛资料超出建议计算范围，请重新读取或手工安排。');
  const eventStart = dateBoundary(eventDates.startDate);
  const eventEnd = dateBoundary(eventDates.endDate) + DAY;
  if (eventEnd <= eventStart) throw new Error('赛事起止日期无效，请重新读取资料。');
  const duration = policy.slotDurationMinutes * MINUTE;
  const active = new Set(
    courts.filter((court) => court.status === 'ACTIVE').map((court) => court.id),
  );
  const windows = policy.courtWindows
    .map((window) => ({
      courtId: window.courtId,
      start: Math.max(timestamp(window.startsAt), eventStart),
      end: Math.min(timestamp(window.endsAt), eventEnd),
    }))
    .filter((window) => active.has(window.courtId) && window.end - window.start >= duration)
    .sort((a, b) => a.start - b.start || a.courtId.localeCompare(b.courtId) || a.end - b.end);
  const input = new Map(allocations.map((item) => [item.fixtureKey, item]));
  if (
    input.size !== allocations.length ||
    allocations.length !== fixtures.length ||
    new Set(fixtures.map((fixture) => fixture.fixtureKey)).size !== fixtures.length
  )
    throw new Error('当前安排与对阵不一致，请重新读取资料。');
  const occupied: Occupied[] = [];
  const pending: ScheduleFixtureData[] = [];
  for (const fixture of [...fixtures].sort(
    (a, b) =>
      a.roundNo - b.roundNo ||
      a.positionNo - b.positionNo ||
      a.fixtureKey.localeCompare(b.fixtureKey),
  )) {
    yield;
    const current = input.get(fixture.fixtureKey);
    if (!current) throw new Error('当前安排与对阵不一致，请重新读取资料。');
    if (!current.courtId && !current.startsAt) {
      pending.push(fixture);
      continue;
    }
    if (!current.courtId || !current.startsAt)
      throw new Error('已有安排尚未同时填写场地和时间，请先补全或取消分配。');
    const start = timestamp(current.startsAt);
    const retained: Occupied = {
      courtId: current.courtId,
      start,
      end: start + duration,
      teams: [fixture.homeEntryId, fixture.awayEntryId],
    };
    if (
      !active.has(retained.courtId) ||
      !windows.some(
        (window) =>
          window.courtId === retained.courtId &&
          window.start <= retained.start &&
          window.end >= retained.end,
      )
    )
      throw new Error('已有安排使用停用场地或超出赛事可用窗口，请先修正或取消分配。');
    for (const busy of occupied) {
      yield;
      if (afterConflict(retained, busy, policy) !== start)
        throw new Error('已有安排存在场地、球队或休息规则冲突，请先调整或取消分配。');
    }
    occupied.push(retained);
    result.preservedCount++;
  }
  for (const fixture of pending) {
    let chosen: Occupied | undefined;
    for (const window of windows) {
      yield;
      let start = window.start;
      while (start + duration <= window.end) {
        yield;
        let next = start;
        for (const busy of occupied) {
          yield;
          next = Math.max(
            next,
            afterConflict(
              {
                courtId: window.courtId,
                start,
                end: start + duration,
                teams: [fixture.homeEntryId, fixture.awayEntryId],
              },
              busy,
              policy,
            ),
          );
        }
        if (next === start) {
          const candidate: Occupied = {
            courtId: window.courtId,
            start,
            end: start + duration,
            teams: [fixture.homeEntryId, fixture.awayEntryId],
          };
          if (!chosen || candidate.start < chosen.start) chosen = candidate;
          break;
        }
        start = next;
      }
    }
    if (chosen) {
      occupied.push(chosen);
      result.allocations.push({
        fixtureKey: fixture.fixtureKey,
        courtId: chosen.courtId,
        startsAt: new Date(chosen.start).toISOString(),
      });
    } else {
      result.unassigned.push({
        fixtureKey: fixture.fixtureKey,
        reason: windows.length ? 'NO_SLOT' : 'NO_WINDOW',
      });
    }
  }
  result.status = result.unassigned.length ? 'PARTIAL' : 'COMPLETE';
  return result;
}

export async function suggestSchedule(
  context: SuggestionContext,
  options: { signal?: AbortSignal; maxChecks?: number } = {},
): Promise<ScheduleSuggestion> {
  const budget = options.maxChecks ?? MAX_SUGGESTION_CHECKS;
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_SUGGESTION_CHECKS)
    throw new Error('建议计算预算无效。');
  const result: ScheduleSuggestion = {
    allocations: [],
    unassigned: [],
    preservedCount: 0,
    checks: 0,
    status: 'COMPLETE',
  };
  const runner = compute(context, result);
  let checks = 0;
  // Only fully checked fixture assignments are committed into result, so a
  // budget boundary can offer completed suggestions without a half-checked one.
  while (checks < budget) {
    if (options.signal?.aborted) return incomplete('CANCELLED');
    const step = runner.next();
    if (step.done) return { ...step.value, checks };
    checks++;
    if (checks % 250 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return incomplete(options.signal?.aborted ? 'CANCELLED' : 'LIMIT_REACHED');

  function incomplete(status: 'CANCELLED' | 'LIMIT_REACHED'): ScheduleSuggestion {
    runner.return(result);
    const previousReasons = new Map(
      result.unassigned.map((item) => [item.fixtureKey, item.reason]),
    );
    return {
      allocations: result.allocations,
      unassigned: context.fixtures
        .filter((fixture) => {
          const current = context.allocations.find(
            (item) => item.fixtureKey === fixture.fixtureKey,
          );
          return (
            !current?.courtId &&
            !current?.startsAt &&
            !result.allocations.some((item) => item.fixtureKey === fixture.fixtureKey)
          );
        })
        .map((fixture) => ({
          fixtureKey: fixture.fixtureKey,
          reason:
            status === 'LIMIT_REACHED'
              ? (previousReasons.get(fixture.fixtureKey) ?? status)
              : status,
        })),
      preservedCount: context.allocations.filter((item) => item.courtId && item.startsAt).length,
      checks,
      status,
    };
  }
}

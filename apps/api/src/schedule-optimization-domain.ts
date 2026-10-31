import { createHash } from 'node:crypto';
import type { ScheduleFixtureData } from '@small-city-basketball/contracts';
import type { ScheduleOptimizationPreview } from '../../../packages/contracts/scheduling-completion.js';
import { ApiError } from './errors.js';
import {
  parseSchedulePolicy,
  parseScheduleTimestamp,
  validateSchedule,
} from './scheduling-domain.js';
import type { ScheduleValidationContext } from './scheduling-domain.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const OFFSET = 8 * 60 * MINUTE;
const SLOT_LIMIT = 4096;
const BEAM_WIDTH = 8;
export const MAX_OPTIMIZATION_CHECKS = 100_000;
const day = (n: number) => Math.floor((n + OFFSET) / DAY);
const iso = (n: number) => new Date(n).toISOString();
type Occupied = { court: string | null; start: number; end: number; teams: string[] };
type Choice = { fixtureKey: string; courtId: string | null; startsAt: string | null };
type State = {
  choices: Choice[];
  busy: Occupied[];
  assigned: number;
  penalty: number;
  latest: number;
  signature: string;
};
const sourceError = () =>
  new ApiError(422, 'SCHEDULE_OPTIMIZATION_SOURCE_INVALID', '排程优化来源无效，请重新读取');

/** Deterministic bounded beam search over the full draft. Never mutates or reserves anything. */
export function optimizeSchedule(
  input: ScheduleValidationContext,
  options: { preserveAssigned?: boolean; maxChecks?: number; earliestStart?: string } = {},
): Omit<ScheduleOptimizationPreview, 'eventVersion' | 'revisionVersion'> {
  const policy = parseSchedulePolicy(input.policy);
  const max = options.maxChecks ?? MAX_OPTIMIZATION_CHECKS;
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    max > MAX_OPTIMIZATION_CHECKS ||
    (options.preserveAssigned !== undefined && typeof options.preserveAssigned !== 'boolean') ||
    input.fixtures.length > 992 ||
    input.reservations.length > 10000
  )
    throw sourceError();
  const blank = input.fixtures.map((f) => ({ ...f, courtId: null, startsAt: null, endsAt: null }));
  if (validateSchedule({ ...input, policy, fixtures: blank }).some((c) => c.code !== 'UNASSIGNED'))
    throw sourceError();
  const preserve = options.preserveAssigned !== false;
  if (preserve && validateSchedule(input).some((c) => c.code !== 'UNASSIGNED'))
    throw new ApiError(
      422,
      'SCHEDULE_FIXED_ALLOCATION_CONFLICT',
      '已有安排存在冲突，请先调整，或明确选择全稿重排',
    );
  const teams = new Map(input.freeze.entries.map((e) => [e.entryId, e.teamId]));
  const fixtures = input.fixtures
    .slice()
    .sort(
      (a, b) =>
        a.roundNo - b.roundNo ||
        a.positionNo - b.positionNo ||
        a.fixtureKey.localeCompare(b.fixtureKey),
    );
  const from = Date.parse(input.event.startDate + 'T00:00:00+08:00');
  const until = Date.parse(input.event.endDate + 'T00:00:00+08:00') + DAY;
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) throw sourceError();
  const duration = policy.slotDurationMinutes * MINUTE;
  const earliest =
    options.earliestStart === undefined
      ? from
      : Date.parse(parseScheduleTimestamp(options.earliestStart));
  const rest = policy.minRestMinutes * MINUTE;
  const active = new Set(input.courts.filter((c) => c.status === 'ACTIVE').map((c) => c.id));
  const external: Occupied[] = input.reservations.map((r) => {
    const start = Date.parse(r.startsAt),
      end = Date.parse(r.endsAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !['COURT', 'TEAM'].includes(r.kind)
    )
      throw sourceError();
    return {
      court: r.kind === 'COURT' ? r.resourceId : null,
      teams: r.kind === 'TEAM' ? [r.resourceId] : [],
      start,
      end,
    };
  });
  const slots: { court: string; start: number; end: number }[] = [];
  let limitReached = false;
  for (const w of policy.courtWindows) {
    if (!active.has(w.courtId)) continue;
    for (
      let start = Math.max(Date.parse(w.startsAt), from, earliest);
      start + duration <= Math.min(Date.parse(w.endsAt), until);
      start += duration
    ) {
      if (slots.length >= SLOT_LIMIT) {
        limitReached = true;
        break;
      }
      slots.push({ court: w.courtId, start, end: start + duration });
    }
  }
  slots.sort((a, b) => a.start - b.start || a.court.localeCompare(b.court));
  let checks = 0;
  const budget = Symbol('search budget');
  const tick = () => {
    if (checks >= max) {
      limitReached = true;
      throw budget;
    }
    checks++;
  };
  const feasible = (candidate: Occupied, busy: Occupied[]) => {
    tick();
    for (const b of busy) {
      tick();
      const overlap = candidate.start < b.end && b.start < candidate.end;
      if (candidate.court === b.court && overlap) return false;
      if (
        b.teams.some((t) => candidate.teams.includes(t)) &&
        (overlap ||
          (candidate.start >= b.end && candidate.start - b.end < rest) ||
          (b.start >= candidate.end && b.start - candidate.end < rest) ||
          Math.abs(day(candidate.start) - day(b.start)) < policy.minLocalDayGap)
      )
        return false;
    }
    return true;
  };
  const score = (choices: Choice[], busy: Occupied[]): State => {
    const firstLast = new Map<string, { first: Occupied; last: Occupied }>();
    for (const b of busy.slice(external.length)) {
      const key = `${b.court}|${day(b.start)}`,
        old = firstLast.get(key);
      if (!old) firstLast.set(key, { first: b, last: b });
      else {
        if (b.start < old.first.start) old.first = b;
        if (b.end > old.last.end) old.last = b;
      }
    }
    const counts = new Map<string, number>();
    for (const [_, v] of firstLast)
      for (const tag of ['first', 'last'] as const)
        for (const team of v[tag].teams)
          counts.set(`${tag}|${team}`, (counts.get(`${tag}|${team}`) ?? 0) + 1);
    return {
      choices,
      busy,
      assigned: choices.filter((c) => c.startsAt).length,
      penalty: [...counts.values()].reduce((a, n) => a + n * n, 0),
      latest: Math.max(0, ...busy.slice(external.length).map((b) => b.end)),
      signature: choices
        .map((c) => `${c.fixtureKey}|${c.startsAt ?? '~'}|${c.courtId ?? '~'}`)
        .join(';'),
    };
  };
  const compare = (a: State, b: State) =>
    b.assigned - a.assigned ||
    a.penalty - b.penalty ||
    a.latest - b.latest ||
    a.signature.localeCompare(b.signature);
  const fixed = fixtures.filter((f) => preserve && f.courtId && f.startsAt && f.endsAt);
  const pending = fixtures.filter((f) => !fixed.includes(f));
  const initial = score(
    fixed.map((f) => ({ fixtureKey: f.fixtureKey, courtId: f.courtId, startsAt: f.startsAt })),
    external.concat(
      fixed.map((f) => ({
        court: f.courtId,
        start: Date.parse(f.startsAt!),
        end: Date.parse(f.endsAt!),
        teams: [teams.get(f.homeEntryId)!, teams.get(f.awayEntryId)!],
      })),
    ),
  );
  let best = initial;
  let beam: State[] = [initial];
  try {
    for (const fixture of pending) {
      const next: State[] = [];
      for (const state of beam) {
        for (const slot of slots) {
          const candidate = {
            ...slot,
            teams: [teams.get(fixture.homeEntryId)!, teams.get(fixture.awayEntryId)!],
          };
          if (!feasible(candidate, state.busy)) continue;
          const value = score(
            state.choices.concat({
              fixtureKey: fixture.fixtureKey,
              courtId: slot.court,
              startsAt: iso(slot.start),
            }),
            state.busy.concat(candidate),
          );
          if (compare(value, best) < 0) best = value;
          next.push(value);
          next.sort(compare);
          if (next.length > BEAM_WIDTH) next.length = BEAM_WIDTH;
        }
        const unassigned = score(
          state.choices.concat({ fixtureKey: fixture.fixtureKey, courtId: null, startsAt: null }),
          state.busy,
        );
        next.push(unassigned);
        next.sort(compare);
        if (next.length > BEAM_WIDTH) next.length = BEAM_WIDTH;
      }
      beam = next;
      if (beam[0] && compare(beam[0], best) < 0) best = beam[0];
    }
  } catch (error) {
    if (error !== budget) throw error;
  }
  const byKey = new Map(best.choices.map((c) => [c.fixtureKey, c]));
  const allocations = fixtures.map(
    (f) => byKey.get(f.fixtureKey) ?? { fixtureKey: f.fixtureKey, courtId: null, startsAt: null },
  );
  const byFixture = new Map(fixtures.map((f) => [f.fixtureKey, f]));
  const verified = allocations.map((a) => ({
    ...byFixture.get(a.fixtureKey)!,
    ...a,
    endsAt: a.startsAt ? iso(Date.parse(a.startsAt) + duration) : null,
  }));
  if (
    validateSchedule({ ...input, policy, fixtures: verified }).some((c) => c.code !== 'UNASSIGNED')
  )
    throw sourceError();
  const unassigned = allocations
    .filter((a) => !a.startsAt)
    .map((a) => ({
      fixtureKey: a.fixtureKey,
      reason: limitReached ? ('SEARCH_LIMIT' as const) : ('NO_FEASIBLE_SLOT_FOUND' as const),
    }));
  return {
    algorithm: 'BALANCED_SEARCH_V1',
    sourceHash: createHash('sha256')
      .update(
        JSON.stringify({
          ...input,
          policy,
          preserveAssigned: preserve,
          ...(options.earliestStart ? { earliestStart: iso(earliest) } : {}),
        }),
      )
      .digest('hex'),
    allocations,
    unassigned,
    preservedCount: fixed.length,
    checks,
    limitReached,
    status: !unassigned.length ? 'COMPLETE' : limitReached ? 'LIMIT_REACHED' : 'PARTIAL',
    score: {
      assignedCount: allocations.length - unassigned.length,
      firstLastPenalty: best.penalty,
      latestEnd: best.latest ? iso(best.latest) : null,
    },
    optimality: 'BOUNDED_HEURISTIC',
  };
}

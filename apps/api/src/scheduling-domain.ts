import { createHash } from 'node:crypto';
import type {
  RegistrationFreezeData,
  ScheduleConflict,
  ScheduleFixtureData,
  SchedulePolicy,
  ScheduleRoundData,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { calendarDate, invalid, objectInput } from './validation.js';

const ALGORITHM = 'RR_CIRCLE_V1' as const;
const MINUTE = 60_000;
const DAY = 86_400_000;
const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    invalid('请检查排赛策略', { [field]: `请输入${min}–${max}的整数` });
  return value as number;
}
function courtId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid('场地编号无效', { courtId: '请选择有效场地' });
  return value.toLowerCase();
}

/** Only an actual calendar date with an explicit numeric offset or Z is accepted. */
export function parseScheduleTimestamp(value: unknown): string {
  if (typeof value !== 'string') invalid('排赛时间必须带明确时区偏移');
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid('排赛时间必须是带明确时区偏移的ISO时间');
  calendarDate(match[1], 'startsAt');
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)
    invalid('排赛时间无效');
  if (match[6] !== 'Z') {
    const offset = match[6]!;
    if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59) invalid('时间偏移无效');
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalid('排赛时间无效');
  const normalized = new Date(timestamp).toISOString();
  if (!/^\d{4}-/.test(normalized) || normalized.startsWith('0000-'))
    invalid('排赛时间超出支持年份');
  return normalized;
}

function compareWindows(
  a: SchedulePolicy['courtWindows'][number],
  b: SchedulePolicy['courtWindows'][number],
) {
  return ascii(a.courtId, b.courtId) || ascii(a.startsAt, b.startsAt) || ascii(a.endsAt, b.endsAt);
}
export function parseSchedulePolicy(value: unknown): SchedulePolicy {
  const input = objectInput(value, [
    'slotDurationMinutes',
    'minRestMinutes',
    'minLocalDayGap',
    'courtWindows',
    'thirdPlaceMatch',
  ]);
  const slotDurationMinutes = integer(input.slotDurationMinutes, 'slotDurationMinutes', 1, 1440);
  const minRestMinutes = integer(input.minRestMinutes, 'minRestMinutes', 0, 43200);
  const minLocalDayGap = integer(input.minLocalDayGap, 'minLocalDayGap', 0, 365);
  if (
    !Array.isArray(input.courtWindows) ||
    input.courtWindows.length < 1 ||
    input.courtWindows.length > 200
  )
    invalid('请提供1–200个场地可用窗口');
  const courtWindows = input.courtWindows
    .map((raw) => {
      const window = objectInput(raw, ['courtId', 'startsAt', 'endsAt']);
      const result = {
        courtId: courtId(window.courtId),
        startsAt: parseScheduleTimestamp(window.startsAt),
        endsAt: parseScheduleTimestamp(window.endsAt),
      };
      if (result.startsAt >= result.endsAt) invalid('场地窗口结束必须晚于开始');
      return result;
    })
    .sort(compareWindows);
  for (let index = 1; index < courtWindows.length; index++) {
    const previous = courtWindows[index - 1]!;
    const current = courtWindows[index]!;
    if (previous.courtId === current.courtId && previous.endsAt > current.startsAt)
      invalid('同一场地可用窗口不能重叠');
  }
  if (input.thirdPlaceMatch !== undefined && typeof input.thirdPlaceMatch !== 'boolean')
    invalid('请明确选择是否安排季军赛');
  // Preserve the exact legacy policy/hash shape for omitted or false values.
  return {
    slotDurationMinutes,
    minRestMinutes,
    minLocalDayGap,
    courtWindows,
    ...(input.thirdPlaceMatch === true ? { thirdPlaceMatch: true } : {}),
  };
}

export type ScheduleAllocation = Pick<
  ScheduleFixtureData,
  'fixtureKey' | 'courtId' | 'startsAt' | 'endsAt'
>;
export function parseAllocationInput(
  value: unknown,
  fixtureKeys: string[],
  slotMinutes: number,
): ScheduleAllocation[] {
  integer(slotMinutes, 'slotDurationMinutes', 1, 1440);
  if (!Array.isArray(value) || value.length !== fixtureKeys.length || value.length > 496)
    invalid('分配必须精确覆盖本稿全部场次');
  const expected = new Set(fixtureKeys);
  const seen = new Set<string>();
  const result = value.map((raw) => {
    const allocation = objectInput(raw, ['fixtureKey', 'courtId', 'startsAt']);
    if (
      typeof allocation.fixtureKey !== 'string' ||
      !expected.has(allocation.fixtureKey) ||
      seen.has(allocation.fixtureKey)
    )
      invalid('分配场次缺失、重复或不属于本稿');
    seen.add(allocation.fixtureKey);
    if (allocation.courtId === null && allocation.startsAt === null)
      return { fixtureKey: allocation.fixtureKey, courtId: null, startsAt: null, endsAt: null };
    if (allocation.courtId === null || allocation.startsAt === null)
      invalid('场地和开始时间须同时填写或同时清除');
    const startsAt = parseScheduleTimestamp(allocation.startsAt);
    const endsAt = new Date(Date.parse(startsAt) + slotMinutes * MINUTE).toISOString();
    if (!/^\d{4}-/.test(endsAt)) invalid('预计结束时间超出支持年份');
    return {
      fixtureKey: allocation.fixtureKey,
      courtId: courtId(allocation.courtId),
      startsAt,
      endsAt,
    };
  });
  const byKey = new Map(result.map((allocation) => [allocation.fixtureKey, allocation]));
  return fixtureKeys.map((key) => byKey.get(key)!);
}

/** Hash JSON property order is part of RR_CIRCLE_V1, including every frozen source field. */
export function canonicalFreeze(freeze: RegistrationFreezeData): RegistrationFreezeData {
  return {
    id: freeze.id,
    eventId: freeze.eventId,
    rulesetId: freeze.rulesetId,
    rulesetVersion: freeze.rulesetVersion,
    eventVersion: freeze.eventVersion,
    entries: [...freeze.entries]
      .sort((a, b) => ascii(a.entryId, b.entryId))
      .map((entry) => ({
        entryId: entry.entryId,
        teamId: entry.teamId,
        teamName: entry.teamName,
        rosterRevisionId: entry.rosterRevisionId,
        players: [...entry.players]
          .sort((a, b) => ascii(a.memberId, b.memberId))
          .map((player) => ({
            memberId: player.memberId,
            name: player.name,
            jerseyNo: player.jerseyNo,
          })),
      })),
    excludedCounts: {
      DRAFT: freeze.excludedCounts.DRAFT,
      REJECTED: freeze.excludedCounts.REJECTED,
      WITHDRAWN: freeze.excludedCounts.WITHDRAWN,
    },
    createdAt: freeze.createdAt,
  };
}

export function generatePairings(
  freeze: RegistrationFreezeData,
  policy: SchedulePolicy,
  seed: string,
): {
  inputHash: string;
  pairingHash: string;
  rounds: ScheduleRoundData[];
  fixtures: ScheduleFixtureData[];
  orderedEntryIds: string[];
} {
  const source = canonicalFreeze(freeze);
  if (
    source.entries.length < 2 ||
    source.entries.length > 32 ||
    new Set(source.entries.map((entry) => entry.entryId)).size !== source.entries.length ||
    new Set(source.entries.map((entry) => entry.teamId)).size !== source.entries.length
  )
    throw new ApiError(422, 'INVALID_SCHEDULE_FREEZE', '冻结参赛队需为2–32支且编号不能重复');
  if (!/^[0-9a-f]{64}$/.test(seed)) invalid('抽签种子必须是256bit十六进制值');
  const normalizedPolicy = parseSchedulePolicy(policy);
  const orderedEntryIds = source.entries
    .map((entry) => ({
      id: entry.entryId,
      rank: createHash('sha256').update(`${seed}|${entry.entryId}`).digest('hex'),
    }))
    .sort((a, b) => ascii(a.rank, b.rank) || ascii(a.id, b.id))
    .map((item) => item.id);
  let rotation: (string | null)[] = [...orderedEntryIds];
  if (rotation.length % 2) rotation.push(null);
  const rounds: ScheduleRoundData[] = [];
  const fixtures: ScheduleFixtureData[] = [];
  for (let roundNo = 1; roundNo < rotation.length; roundNo++) {
    let byeEntryId: string | null = null;
    for (let positionNo = 1; positionNo <= rotation.length / 2; positionNo++) {
      const homeEntryId = rotation[positionNo - 1]!;
      const awayEntryId = rotation[rotation.length - positionNo]!;
      if (homeEntryId === null || awayEntryId === null) {
        byeEntryId = homeEntryId ?? awayEntryId;
        continue;
      }
      fixtures.push({
        fixtureKey: `R${roundNo}-P${positionNo}`,
        roundNo,
        positionNo,
        homeEntryId,
        awayEntryId,
        courtId: null,
        startsAt: null,
        endsAt: null,
      });
    }
    rounds.push({ roundNo, byeEntryId });
    rotation = [rotation[0]!, rotation[rotation.length - 1]!, ...rotation.slice(1, -1)];
  }
  const inputHash = hash({ freeze: source, policy: normalizedPolicy });
  const pairingHash = hash({
    algorithmVersion: ALGORITHM,
    seed,
    rounds: rounds.map((round) => ({ roundNo: round.roundNo, byeEntryId: round.byeEntryId })),
    fixtures: fixtures.map(({ fixtureKey, roundNo, positionNo, homeEntryId, awayEntryId }) => ({
      fixtureKey,
      roundNo,
      positionNo,
      homeEntryId,
      awayEntryId,
    })),
  });
  return { inputHash, pairingHash, rounds, fixtures, orderedEntryIds };
}

export function publicationHash(
  source: { algorithmVersion: string; seed: string; inputHash: string; pairingHash: string },
  fixtures: ScheduleFixtureData[],
): string {
  return hash({
    algorithmVersion: source.algorithmVersion,
    seed: source.seed,
    inputHash: source.inputHash,
    pairingHash: source.pairingHash,
    fixtures: [...fixtures]
      .sort((a, b) => a.roundNo - b.roundNo || a.positionNo - b.positionNo)
      .map(
        ({
          fixtureKey,
          roundNo,
          positionNo,
          homeEntryId,
          awayEntryId,
          courtId,
          startsAt,
          endsAt,
        }) => ({
          fixtureKey,
          roundNo,
          positionNo,
          homeEntryId,
          awayEntryId,
          courtId,
          startsAt,
          endsAt,
        }),
      ),
  });
}

const shanghaiDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function localDate(timestamp: number): string {
  const parts = new Map(
    shanghaiDate.formatToParts(timestamp).map(({ type, value }) => [type, value]),
  );
  return `${parts.get('year')!.padStart(4, '0')}-${parts.get('month')}-${parts.get('day')}`;
}
function ordinal(timestamp: number): number {
  const date = new Date(`${localDate(timestamp)}T00:00:00.000Z`);
  return date.getTime() / DAY;
}
type Assigned = ScheduleFixtureData & {
  courtId: string;
  startsAt: string;
  endsAt: string;
  start: number;
  end: number;
  teamIds: string[];
};
export interface ScheduleValidationContext {
  event: { id: string; startDate: string; endDate: string; timezone: string };
  freeze: RegistrationFreezeData;
  policy: SchedulePolicy;
  fixtures: ScheduleFixtureData[];
  courts: { id: string; status: string }[];
  reservations: { kind: 'COURT' | 'TEAM'; resourceId: string; startsAt: string; endsAt: string }[];
}
export function validateSchedule(context: ScheduleValidationContext): ScheduleConflict[] {
  const { event, freeze, fixtures, reservations } = context;
  const policy = parseSchedulePolicy(context.policy);
  if (event.timezone !== 'Asia/Shanghai') invalid('当前排赛仅支持Asia/Shanghai');
  const conflicts: ScheduleConflict[] = [];
  const teams = new Map(freeze.entries.map((entry) => [entry.entryId, entry.teamId]));
  const courts = new Map(context.courts.map((court) => [court.id, court.status]));
  const assigned: Assigned[] = [];
  const seen = new Set<string>();
  function sourceMismatch(): never {
    throw new ApiError(422, 'SCHEDULE_SOURCE_MISMATCH', '排赛场次与服务器来源或预计占用时长不一致');
  }
  for (const fixture of fixtures) {
    if (
      seen.has(fixture.fixtureKey) ||
      !Number.isInteger(fixture.roundNo) ||
      fixture.roundNo < 1 ||
      fixture.roundNo > 31 ||
      !Number.isInteger(fixture.positionNo) ||
      fixture.positionNo < 1 ||
      fixture.positionNo > 16 ||
      fixture.fixtureKey !== `R${fixture.roundNo}-P${fixture.positionNo}` ||
      !teams.has(fixture.homeEntryId) ||
      !teams.has(fixture.awayEntryId) ||
      fixture.homeEntryId === fixture.awayEntryId
    )
      sourceMismatch();
    seen.add(fixture.fixtureKey);
    if (fixture.courtId === null && fixture.startsAt === null && fixture.endsAt === null) {
      conflicts.push({ code: 'UNASSIGNED', fixtureKeys: [fixture.fixtureKey] });
      continue;
    }
    if (!fixture.courtId || !fixture.startsAt || !fixture.endsAt) sourceMismatch();
    try {
      if (
        courtId(fixture.courtId) !== fixture.courtId ||
        parseScheduleTimestamp(fixture.startsAt) !== fixture.startsAt ||
        parseScheduleTimestamp(fixture.endsAt) !== fixture.endsAt
      )
        sourceMismatch();
    } catch {
      sourceMismatch();
    }
    const start = Date.parse(fixture.startsAt);
    const end = Date.parse(fixture.endsAt);
    if (end - start !== policy.slotDurationMinutes * MINUTE) sourceMismatch();
    const item: Assigned = {
      ...fixture,
      courtId: fixture.courtId,
      startsAt: fixture.startsAt,
      endsAt: fixture.endsAt,
      start,
      end,
      teamIds: [teams.get(fixture.homeEntryId)!, teams.get(fixture.awayEntryId)!],
    };
    assigned.push(item);
    const detail = {
      fixtureKeys: [fixture.fixtureKey],
      resourceId: fixture.courtId,
      startsAt: fixture.startsAt,
      endsAt: fixture.endsAt,
    };
    if (courts.get(fixture.courtId) !== 'ACTIVE')
      conflicts.push({ code: 'COURT_DISABLED', ...detail });
    if (
      !policy.courtWindows.some(
        (window) =>
          window.courtId === fixture.courtId &&
          window.startsAt <= fixture.startsAt! &&
          window.endsAt >= fixture.endsAt!,
      )
    )
      conflicts.push({ code: 'OUTSIDE_WINDOW', ...detail });
    // End is exclusive: midnight after endDate remains within the declared last day.
    if (localDate(start) < event.startDate || localDate(end - 1) > event.endDate)
      conflicts.push({ code: 'OUTSIDE_EVENT_DATES', ...detail });
  }
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    a.start < b.end && b.start < a.end;
  // Keep every affected fixture addressable without emitting O(matches²) conflict objects.
  const resourceConflicts = new Map<
    string,
    { code: ScheduleConflict['code']; resourceId: string; fixtureKeys: Set<string> }
  >();
  const recordResource = (
    code: ScheduleConflict['code'],
    resourceId: string,
    fixtureKeys: string[],
  ) => {
    const key = `${code}|${resourceId}`;
    let conflict = resourceConflicts.get(key);
    if (!conflict) {
      conflict = { code, resourceId, fixtureKeys: new Set() };
      resourceConflicts.set(key, conflict);
    }
    for (const fixtureKey of fixtureKeys) conflict.fixtureKeys.add(fixtureKey);
  };
  const externalConflicts = new Set<string>();
  for (let index = 0; index < assigned.length; index++) {
    const a = assigned[index]!;
    for (const b of assigned.slice(index + 1)) {
      if (!overlaps(a, b)) continue;
      const fixtureKeys = [a.fixtureKey, b.fixtureKey];
      if (a.courtId === b.courtId) recordResource('COURT_OVERLAP', a.courtId, fixtureKeys);
      for (const teamId of a.teamIds.filter((id) => b.teamIds.includes(id)))
        recordResource('TEAM_OVERLAP', teamId, fixtureKeys);
    }
    for (const reservation of reservations) {
      const occupied = {
        start: Date.parse(reservation.startsAt),
        end: Date.parse(reservation.endsAt),
      };
      const matches =
        reservation.kind === 'COURT'
          ? reservation.resourceId === a.courtId
          : a.teamIds.includes(reservation.resourceId);
      const conflictKey = `${reservation.kind}|${reservation.resourceId}|${a.fixtureKey}`;
      if (matches && overlaps(a, occupied) && !externalConflicts.has(conflictKey)) {
        externalConflicts.add(conflictKey);
        conflicts.push({
          code: reservation.kind === 'COURT' ? 'COURT_OVERLAP' : 'TEAM_OVERLAP',
          fixtureKeys: [a.fixtureKey],
          resourceId: reservation.resourceId,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          external: true,
        });
      }
    }
  }
  for (const teamId of new Set(assigned.flatMap((item) => item.teamIds))) {
    const matches = assigned
      .filter((item) => item.teamIds.includes(teamId))
      .sort((a, b) => a.start - b.start || ascii(a.fixtureKey, b.fixtureKey));
    for (let index = 1; index < matches.length; index++) {
      const previous = matches[index - 1]!;
      const current = matches[index]!;
      const fixtureKeys = [previous.fixtureKey, current.fixtureKey];
      const rest = current.start - previous.end;
      if (rest >= 0 && rest < policy.minRestMinutes * MINUTE)
        recordResource('MIN_REST', teamId, fixtureKeys);
      if (ordinal(current.start) - ordinal(previous.start) < policy.minLocalDayGap)
        recordResource('MIN_LOCAL_DAY_GAP', teamId, fixtureKeys);
    }
  }
  return [
    ...conflicts,
    ...[...resourceConflicts.values()].map(({ fixtureKeys, ...conflict }) => ({
      ...conflict,
      fixtureKeys: [...fixtureKeys],
    })),
  ];
}

import type { KnockoutSource } from '@small-city-basketball/contracts';
export type Obj = Record<string, unknown>;
export const object = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
export const nonnegative = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const resolutionKeys = [
  'resolvedMatchCount',
  'adjudicatedMatchCount',
  'cancelledMatchCount',
];
export function exactFields(v: unknown, required: string[], optional: string[] = []): v is Obj {
  return (
    object(v) &&
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k))
  );
}
/** Legacy confirmation proofs keep their original five fields. Administrative IDs never stand in for confirmation IDs. */
export function resultSource(
  v: unknown,
  allowCancellation = false,
  entrants?: ReadonlySet<string>,
): v is KnockoutSource {
  if (!object(v) || !identifier(v.fixtureKey) || !positive(v.matchVersion)) return false;
  if (!Object.hasOwn(v, 'kind'))
    return (
      exactFields(v, [
        'fixtureKey',
        'matchId',
        'confirmationId',
        'matchVersion',
        'winnerEntryId',
      ]) &&
      identifier(v.matchId) &&
      identifier(v.confirmationId) &&
      identifier(v.winnerEntryId) &&
      (!entrants || entrants.has(v.winnerEntryId))
    );
  if (
    !exactFields(v, [
      'kind',
      'fixtureKey',
      'matchId',
      'adjudicationId',
      'adjudicationVersion',
      'matchVersion',
      'winnerEntryId',
      'loserEntryId',
    ]) ||
    !uuid(v.matchId) ||
    !uuid(v.adjudicationId) ||
    v.adjudicationVersion !== 2 ||
    !/^R(?:[1-9]|[12]\d|3[01])-P(?:[1-9]|1[0-6])$/.test(v.fixtureKey)
  )
    return false;
  if (v.kind === 'CANCELLATION')
    return allowCancellation && v.winnerEntryId === null && v.loserEntryId === null;
  return (
    v.kind === 'ADJUDICATION' &&
    uuid(v.winnerEntryId) &&
    uuid(v.loserEntryId) &&
    v.winnerEntryId !== v.loserEntryId &&
    (!entrants || (entrants.has(String(v.winnerEntryId)) && entrants.has(String(v.loserEntryId))))
  );
}
export function sourceList(
  v: unknown,
  allowCancellation = false,
  entrants?: ReadonlySet<string>,
): v is KnockoutSource[] {
  return (
    Array.isArray(v) &&
    v.every((s) => resultSource(s, allowCancellation, entrants)) &&
    new Set(v.map((s) => s.matchId)).size === v.length &&
    new Set(v.map((s) => s.fixtureKey)).size === v.length
  );
}
export function resolution(v: Obj, allowCancelledCompletion = false) {
  if (
    !nonnegative(v.confirmedMatchCount) ||
    !nonnegative(v.totalMatchCount) ||
    Number(v.confirmedMatchCount) > Number(v.totalMatchCount)
  )
    return false;
  const present = resolutionKeys.some((k) => Object.hasOwn(v, k));
  if (!present) return !v.isComplete || v.confirmedMatchCount === v.totalMatchCount;
  if (
    !resolutionKeys.every((k) => nonnegative(v[k])) ||
    v.resolvedMatchCount !==
      Number(v.confirmedMatchCount) +
        Number(v.adjudicatedMatchCount) +
        Number(v.cancelledMatchCount) ||
    Number(v.resolvedMatchCount) > Number(v.publishedMatchCount ?? v.totalMatchCount)
  )
    return false;
  return (
    !v.isComplete ||
    (allowCancelledCompletion
      ? v.resolvedMatchCount === v.totalMatchCount
      : v.resolvedMatchCount === v.totalMatchCount && v.cancelledMatchCount === 0)
  );
}
/** Public markers have no private adjudication identifiers. */
export function decisionMarker(v: Obj) {
  if (v.adjudication === undefined) return true;
  return (
    exactFields(v.adjudication, ['kind']) &&
    ['FORFEIT', 'CANCELLED'].includes(String(v.adjudication.kind)) &&
    ['SCHEDULED', 'READY'].includes(String(v.status))
  );
}
export function placementMetadata(v: Obj) {
  return (
    (v.kind === undefined && v.sourceOutcome === undefined) ||
    (v.kind === 'CHAMPIONSHIP' && v.sourceOutcome === 'WINNER' && v.positionNo === 1) ||
    (v.kind === 'THIRD_PLACE' && v.sourceOutcome === 'LOSER' && v.positionNo === 2)
  );
}
/** A bronze count is accepted only with the final-round championship/loser pair actually present. */
export function bronzeShape(rounds: unknown): boolean | null {
  if (
    !Array.isArray(rounds) ||
    !rounds.length ||
    rounds.some((r) => !object(r) || !Array.isArray(r.slots))
  )
    return null;
  const tagged = rounds
    .flatMap((r) => (r as Obj).slots as unknown[])
    .filter((s) => object(s) && (s.kind !== undefined || s.sourceOutcome !== undefined));
  if (!tagged.length) return false;
  const final = rounds.at(-1) as Obj,
    slots = final.slots as unknown[];
  if (
    tagged.length !== 2 ||
    slots.length !== 2 ||
    tagged.some((s) => !slots.includes(s)) ||
    !slots.every((s) => object(s) && placementMetadata(s))
  )
    return null;
  const first = slots.find((s) => object(s) && s.positionNo === 1),
    second = slots.find((s) => object(s) && s.positionNo === 2);
  return object(first) &&
    first.kind === 'CHAMPIONSHIP' &&
    object(second) &&
    second.kind === 'THIRD_PLACE'
    ? true
    : null;
}

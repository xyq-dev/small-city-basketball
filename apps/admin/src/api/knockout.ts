import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import type {
  EventKnockoutData,
  PublicKnockoutData,
  PublishKnockoutRoundInput,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const nullableId = (v: unknown) => v === null || id(v);
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const status = (v: unknown) =>
  v === 'BYE' || v === 'WAITING' || (MATCH_STATUSES as readonly unknown[]).includes(v);
const exact = (v: unknown, keys: string[]): v is Obj =>
  obj(v) && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
function metrics(v: Obj) {
  return (
    v.algorithmVersion === 'SE_SEEDED_V1' &&
    hash(v.sourceHash) &&
    timestamp(v.asOf) &&
    Number.isSafeInteger(v.participantCount) &&
    Number(v.participantCount) >= 2 &&
    Number(v.participantCount) <= 32 &&
    v.totalMatchCount === Number(v.participantCount) - 1 &&
    count(v.publishedMatchCount) &&
    count(v.confirmedMatchCount) &&
    Number(v.confirmedMatchCount) <= Number(v.publishedMatchCount) &&
    Number(v.publishedMatchCount) <= Number(v.totalMatchCount) &&
    typeof v.isComplete === 'boolean' &&
    (!v.isComplete || v.confirmedMatchCount === v.totalMatchCount)
  );
}
function roundShape(v: unknown, slot: (v: unknown) => boolean) {
  return (
    obj(v) &&
    Number.isInteger(v.roundNo) &&
    Number(v.roundNo) >= 1 &&
    Number(v.roundNo) <= 5 &&
    id(v.label) &&
    typeof v.published === 'boolean' &&
    Array.isArray(v.slots) &&
    v.slots.length > 0 &&
    v.slots.length <= 16 &&
    v.slots.every(slot)
  );
}
function privateSlot(v: unknown) {
  return (
    obj(v) &&
    id(v.fixtureKey) &&
    count(v.roundNo) &&
    count(v.positionNo) &&
    [
      'homeEntryId',
      'awayEntryId',
      'homeSource',
      'awaySource',
      'byeEntryId',
      'matchId',
      'winnerEntryId',
    ].every((key) => nullableId(v[key])) &&
    status(v.status)
  );
}
function fixture(v: unknown) {
  return (
    obj(v) &&
    ['fixtureKey', 'homeEntryId', 'awayEntryId'].every((key) => id(v[key])) &&
    count(v.roundNo) &&
    count(v.positionNo) &&
    ['courtId', 'startsAt', 'endsAt'].every((key) => nullableId(v[key]))
  );
}
function checked(v: unknown, eventId: string): EventKnockoutData {
  const valid =
    obj(v) &&
    obj(v.event) &&
    v.event.id === eventId &&
    v.event.format === 'SINGLE_ELIMINATION' &&
    id(v.event.name) &&
    Number.isSafeInteger(v.event.version) &&
    Number(v.event.version) > 0 &&
    nullableId(v.publicationId) &&
    Array.isArray(v.participants) &&
    v.participants.every(
      (p) =>
        obj(p) && ['entryId', 'teamId', 'teamName', 'rosterRevisionId'].every((key) => id(p[key])),
    ) &&
    obj(v.capabilities) &&
    typeof v.capabilities.canPublishNextRound === 'boolean' &&
    (v.bracket === null ||
      (obj(v.bracket) &&
        metrics(v.bracket) &&
        Array.isArray(v.bracket.rounds) &&
        v.bracket.rounds.length >= 1 &&
        v.bracket.rounds.length <= 5 &&
        v.bracket.rounds.every((r) => roundShape(r, privateSlot)) &&
        Array.isArray(v.bracket.placements) &&
        v.bracket.placements.every(
          (p) =>
            obj(p) &&
            id(p.entryId) &&
            id(p.teamName) &&
            count(p.rank) &&
            typeof p.tied === 'boolean',
        ) &&
        (v.bracket.nextRound === null ||
          (obj(v.bracket.nextRound) &&
            count(v.bracket.nextRound.roundNo) &&
            hash(v.bracket.nextRound.sourceHash) &&
            Array.isArray(v.bracket.nextRound.sources) &&
            v.bracket.nextRound.sources.every(
              (s) =>
                obj(s) &&
                ['fixtureKey', 'matchId', 'confirmationId', 'winnerEntryId'].every((key) =>
                  id(s[key]),
                ) &&
                count(s.matchVersion),
            ) &&
            Array.isArray(v.bracket.nextRound.fixtures) &&
            v.bracket.nextRound.fixtures.length > 0 &&
            v.bracket.nextRound.fixtures.every(fixture)))));
  if (!valid) throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的淘汰赛资料不完整，请重新读取');
  return structuredClone(v) as unknown as EventKnockoutData;
}
const publicTeam = (v: unknown) =>
  exact(v, ['teamKey', 'teamName']) &&
  typeof v.teamKey === 'string' &&
  /^[A-Za-z0-9_-]{22}$/.test(v.teamKey) &&
  id(v.teamName);
const nullableTeam = (v: unknown) => v === null || publicTeam(v);
/** A strict public whitelist: seed, internal IDs, rosters and control grants are never accepted. */
export function publicKnockout(v: unknown): v is PublicKnockoutData {
  return (
    exact(v, [
      'publicEventId',
      'algorithmVersion',
      'sourceHash',
      'asOf',
      'participantCount',
      'totalMatchCount',
      'publishedMatchCount',
      'confirmedMatchCount',
      'isComplete',
      'rounds',
      'placements',
    ]) &&
    id(v.publicEventId) &&
    metrics(v) &&
    Array.isArray(v.rounds) &&
    v.rounds.length >= 1 &&
    v.rounds.length <= 5 &&
    v.rounds.every(
      (r) =>
        exact(r, ['roundNo', 'label', 'published', 'slots']) &&
        roundShape(
          r,
          (slot) =>
            exact(slot, [
              'positionNo',
              'home',
              'away',
              'bye',
              'publicMatchId',
              'status',
              'winner',
            ]) &&
            count(slot.positionNo) &&
            ['home', 'away', 'bye', 'winner'].every((key) => nullableTeam(slot[key])) &&
            (slot.publicMatchId === null ||
              (typeof slot.publicMatchId === 'string' &&
                /^[A-Za-z0-9_-]{43}$/.test(slot.publicMatchId))) &&
            status(slot.status),
        ),
    ) &&
    Array.isArray(v.placements) &&
    v.placements.every(
      (p) =>
        exact(p, ['team', 'rank', 'tied']) &&
        publicTeam(p.team) &&
        count(p.rank) &&
        typeof p.tied === 'boolean',
    )
  );
}
export function createKnockoutApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有赛事权限的机构');
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}/events`;
  async function request(eventId: string, input?: PublishKnockoutRoundInput) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await client.request<unknown>(
        `${base}/${encodeURIComponent(eventId)}/${input ? 'knockout-round-commands' : 'knockout'}`,
        {
          signal: controller.signal,
          ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}),
        },
      );
      return checked(result.data, eventId);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    event: (eventId: string) => request(eventId),
    publish: (eventId: string, input: PublishKnockoutRoundInput) => request(eventId, input),
  };
}

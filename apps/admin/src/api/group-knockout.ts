import { resolution, resolutionKeys, exactFields, sourceList } from './result-proofs';
import type {
  DrawGroupTieInput,
  EventGroupKnockoutData,
  PublicGroupKnockoutData,
  PublishGroupQualificationInput,
  PublishKnockoutRoundInput,
} from '@small-city-basketball/contracts';
import type { ApiClient } from './client';
import { ApiError } from './client';
import { publicKnockout, privateKnockout, bracketSources } from './knockout';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const exact = (v: unknown, keys: string[]): v is Obj =>
  obj(v) && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const groups = (v: unknown) => v === 2 || v === 4 || v === 8;
const statuses = ['WAITING', 'TIE_BREAK_REQUIRED', 'READY', 'PUBLISHED'];
const team = (v: unknown) =>
  exact(v, ['teamKey', 'teamName']) &&
  typeof v.teamKey === 'string' &&
  /^[A-Za-z0-9_-]{22}$/.test(v.teamKey) &&
  text(v.teamName);
const rank = (v: unknown) => v === null || (Number.isSafeInteger(v) && Number(v) > 0);
const totals = [
  'played',
  'wins',
  'draws',
  'losses',
  'pointsFor',
  'pointsAgainst',
  'scoreDifference',
  'leaguePoints',
];
const row = (v: unknown, publicOnly: boolean) =>
  obj(v) &&
  totals.every((key) => Number.isSafeInteger(v[key])) &&
  text(v.teamName) &&
  rank(v.rank) &&
  typeof v.tied === 'boolean' &&
  (publicOnly
    ? exact(v, [...totals, 'teamKey', 'teamName', 'rank', 'tied']) &&
      typeof v.teamKey === 'string' &&
      /^[A-Za-z0-9_-]{22}$/.test(v.teamKey)
    : text(v.entryId) && text(v.teamId));
function metrics(v: Obj) {
  return (
    hash(v.sourceHash) &&
    time(v.asOf) &&
    groups(v.groupCount) &&
    count(v.totalMatchCount) &&
    count(v.publishedMatchCount) &&
    count(v.confirmedMatchCount) &&
    Number(v.confirmedMatchCount) <= Number(v.publishedMatchCount) &&
    Number(v.publishedMatchCount) <= Number(v.totalMatchCount) &&
    typeof v.isComplete === 'boolean' &&
    resolution(v, true)
  );
}
function rules(v: unknown) {
  return (
    exact(v, [
      'winPoints',
      'lossPoints',
      'drawPoints',
      'tiebreakers',
      'version',
      'algorithmVersion',
    ]) &&
    ['winPoints', 'lossPoints', 'drawPoints'].every(
      (key) => count(v[key]) && Number(v[key]) <= 1000,
    ) &&
    count(v.version) &&
    Number(v.version) > 0 &&
    v.algorithmVersion === 'RR_STANDINGS_V1' &&
    Array.isArray(v.tiebreakers) &&
    new Set(v.tiebreakers).size === v.tiebreakers.length &&
    v.tiebreakers.every((key) => ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'].includes(String(key)))
  );
}
function privateBracket(v: unknown, groupCount: unknown) {
  return obj(v) && v.participantCount === Number(groupCount) * 2 && privateKnockout(v);
}
function groupSources(competition: Obj, sources: unknown) {
  if (!Array.isArray(competition.groups)) return false;
  const entrants = new Set<string>();
  for (const group of competition.groups) {
    if (!obj(group) || !Array.isArray(group.participants)) return false;
    for (const participant of group.participants) {
      if (!obj(participant) || !text(participant.entryId)) return false;
      entrants.add(participant.entryId);
    }
  }
  return sourceList(sources, true, entrants);
}
/** Exact public whitelist; private IDs, draw seeds and source confirmations are rejected. */
export function publicGroups(v: unknown): v is PublicGroupKnockoutData {
  return (
    exactFields(
      v,
      [
        'publicEventId',
        'algorithmVersion',
        'sourceHash',
        'asOf',
        'groupCount',
        'totalMatchCount',
        'publishedMatchCount',
        'confirmedMatchCount',
        'isComplete',
        'rules',
        'groups',
        'qualificationStatus',
        'bracket',
        'placements',
      ],
      resolutionKeys,
    ) &&
    text(v.publicEventId) &&
    v.algorithmVersion === 'GK_BALANCED_V1' &&
    metrics(v) &&
    rules(v.rules) &&
    statuses.includes(String(v.qualificationStatus)) &&
    Array.isArray(v.groups) &&
    v.groups.length === v.groupCount &&
    v.groups.every(
      (g) =>
        exactFields(
          g,
          [
            'groupKey',
            'label',
            'confirmedMatchCount',
            'totalMatchCount',
            'isComplete',
            'rows',
            'qualified',
            'tieBreakRequired',
            'tieDrawApplied',
          ],
          resolutionKeys,
        ) &&
        resolution(g, true) &&
        text(g.groupKey) &&
        text(g.label) &&
        count(g.confirmedMatchCount) &&
        count(g.totalMatchCount) &&
        Number(g.confirmedMatchCount) <= Number(g.totalMatchCount) &&
        typeof g.isComplete === 'boolean' &&
        typeof g.tieBreakRequired === 'boolean' &&
        typeof g.tieDrawApplied === 'boolean' &&
        Array.isArray(g.rows) &&
        g.rows.every((r) => row(r, true)) &&
        Array.isArray(g.qualified) &&
        g.qualified.length <= 2 &&
        g.qualified.every(team),
    ) &&
    (v.bracket === null ||
      (publicKnockout(v.bracket) &&
        v.bracket.publicEventId === v.publicEventId &&
        v.bracket.participantCount === Number(v.groupCount) * 2)) &&
    Array.isArray(v.placements) &&
    v.placements.every(
      (p) =>
        exact(p, ['team', 'groupKey', 'groupRank', 'stage', 'rank', 'tied']) &&
        team(p.team) &&
        text(p.groupKey) &&
        rank(p.groupRank) &&
        rank(p.rank) &&
        ['KNOCKOUT', 'GROUP_ELIMINATED'].includes(String(p.stage)) &&
        (p.stage !== 'GROUP_ELIMINATED' || p.rank === null) &&
        typeof p.tied === 'boolean',
    )
  );
}
function fixture(v: unknown) {
  return (
    obj(v) &&
    ['fixtureKey', 'homeEntryId', 'awayEntryId'].every((key) => text(v[key])) &&
    count(v.roundNo) &&
    Number(v.roundNo) <= 31 &&
    count(v.positionNo) &&
    ['courtId', 'startsAt', 'endsAt'].every((key) => v[key] === null || text(v[key]))
  );
}
export function checkedGroups(v: unknown, eventId: string): EventGroupKnockoutData {
  const valid =
    obj(v) &&
    obj(v.event) &&
    v.event.id === eventId &&
    v.event.format === 'GROUP_KNOCKOUT' &&
    text(v.event.name) &&
    count(v.event.version) &&
    Number(v.event.version) > 0 &&
    (v.publicationId === null || text(v.publicationId)) &&
    obj(v.capabilities) &&
    (v.draftGroups === undefined ||
      (Array.isArray(v.draftGroups) &&
        v.draftGroups.every(
          (g) =>
            obj(g) &&
            text(g.groupKey) &&
            text(g.label) &&
            Array.isArray(g.participants) &&
            g.participants.every(
              (p) =>
                obj(p) &&
                ['entryId', 'teamId', 'teamName', 'rosterRevisionId'].every((key) => text(p[key])),
            ),
        ))) &&
    ['canDrawTies', 'canPublishQualification', 'canPublishNextRound'].every(
      (key) => typeof (v.capabilities as Obj)[key] === 'boolean',
    ) &&
    (v.config === null ||
      (obj(v.config) &&
        groups(v.config.groupCount) &&
        Array.isArray(v.config.seededEntryIds) &&
        v.config.seededEntryIds.every(text))) &&
    (v.competition === null ||
      (obj(v.competition) &&
        v.competition.algorithmVersion === 'GK_BALANCED_V1' &&
        metrics(v.competition) &&
        Array.isArray(v.competition.groups) &&
        v.competition.groups.length === v.competition.groupCount &&
        v.competition.groups.every(
          (g) =>
            obj(g) &&
            text(g.groupKey) &&
            text(g.label) &&
            Array.isArray(g.participants) &&
            g.participants.every(
              (p) =>
                obj(p) &&
                ['entryId', 'teamId', 'teamName', 'rosterRevisionId'].every((key) => text(p[key])),
            ) &&
            obj(g.standings) &&
            hash(g.standings.sourceHash) &&
            resolution(g.standings, true) &&
            Array.isArray(g.standings.rows) &&
            g.standings.rows.every((r) => row(r, false)) &&
            Array.isArray(g.unresolvedTieEntryIds) &&
            g.unresolvedTieEntryIds.every(text) &&
            (g.qualifiedEntryIds === null ||
              (Array.isArray(g.qualifiedEntryIds) &&
                g.qualifiedEntryIds.length === 2 &&
                g.qualifiedEntryIds.every(text))) &&
            (g.draw === null ||
              (obj(g.draw) &&
                text(g.draw.id) &&
                text(g.draw.reason) &&
                time(g.draw.createdAt) &&
                Array.isArray(g.draw.orderedEntryIds) &&
                g.draw.orderedEntryIds.every(text))),
        ) &&
        obj(v.competition.qualification) &&
        statuses.includes(String(v.competition.qualification.status)) &&
        hash(v.competition.qualification.sourceHash) &&
        groupSources(v.competition, v.competition.qualification.sources) &&
        Array.isArray(v.competition.qualification.slots) &&
        v.competition.qualification.slots.every(text) &&
        Array.isArray(v.competition.qualification.unresolvedGroups) &&
        v.competition.qualification.unresolvedGroups.every(text) &&
        (v.competition.qualification.publicationId === null ||
          text(v.competition.qualification.publicationId)) &&
        Array.isArray(v.competition.placements) &&
        v.competition.placements.every(
          (p) =>
            obj(p) &&
            text(p.entryId) &&
            text(p.teamName) &&
            rank(p.rank) &&
            rank(p.groupRank) &&
            text(p.groupKey) &&
            ['KNOCKOUT', 'GROUP_ELIMINATED'].includes(String(p.stage)),
        ) &&
        (v.competition.bracket === null ||
          privateBracket(v.competition.bracket, v.competition.groupCount)) &&
        (v.competition.nextRound === null ||
          (obj(v.competition.nextRound) &&
            count(v.competition.nextRound.roundNo) &&
            hash(v.competition.nextRound.sourceHash) &&
            (v.competition.bracket === null
              ? groupSources(v.competition, v.competition.nextRound.sources)
              : obj(v.competition.bracket) &&
                bracketSources(v.competition.bracket, v.competition.nextRound.sources)) &&
            Array.isArray(v.competition.nextRound.fixtures) &&
            v.competition.nextRound.fixtures.length > 0 &&
            v.competition.nextRound.fixtures.every(fixture)))));
  if (!valid)
    throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的分组晋级资料不完整，请重新读取');
  return structuredClone(v) as unknown as EventGroupKnockoutData;
}
export function createGroupKnockoutApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择有赛事权限的机构');
  const base = `/v1/orgs/${encodeURIComponent(organizationId)}/events`;
  async function request(
    eventId: string,
    command?: DrawGroupTieInput | PublishGroupQualificationInput | PublishKnockoutRoundInput,
  ): Promise<EventGroupKnockoutData> {
    const endpoint = !command
      ? 'groups'
      : command.type === 'DRAW_GROUP_TIE'
        ? 'group-tie-commands'
        : command.type === 'PUBLISH_QUALIFICATION'
          ? 'group-qualification-commands'
          : 'knockout-round-commands';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await client.request<unknown>(
        `${base}/${encodeURIComponent(eventId)}/${endpoint}`,
        {
          signal: controller.signal,
          ...(command ? { method: 'POST', body: JSON.stringify(command) } : {}),
        },
      );
      // Later rounds retain their original response DTO. Read a fresh group projection after success.
      if (command?.type === 'PUBLISH_ROUND') return request(eventId);
      return checkedGroups(result.data, eventId);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    event: (eventId: string) => request(eventId),
    command: (
      eventId: string,
      command: DrawGroupTieInput | PublishGroupQualificationInput | PublishKnockoutRoundInput,
    ) => request(eventId, command),
  };
}

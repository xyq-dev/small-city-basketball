import { ENTRY_STATUSES, EVENT_STATUSES } from '@small-city-basketball/contracts';
import type {
  ApiEnvelope,
  TeamData,
  CreateTeamInput,
  UpdateTeamInput,
  UpdateTeamMembersInput,
  InvitationData,
  IssuedInvitationData,
  CreateInvitationInput,
  TeamGrantData,
  EventRegistrationData,
  RegistrationRulesInput,
  RegistrationCommandInput,
  TeamRegistrationEventData,
  EntryData,
  EntrySummary,
  UpdateEntryRosterInput,
  EntryCommandInput,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

const encode = encodeURIComponent;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function props(value: unknown, strings: string[]) {
  return object(value) && strings.every((key) => typeof value[key] === 'string');
}
function capabilities(value: unknown, names: string[]) {
  return (
    object(value) &&
    object(value.capabilities) &&
    names.every((name) => typeof (value.capabilities as JsonObject)[name] === 'boolean')
  );
}
function validEvent(value: unknown) {
  return (
    props(value, ['id', 'name', 'startDate', 'endDate']) &&
    object(value) &&
    EVENT_STATUSES.includes(value.status as never) &&
    Number.isInteger(value.version)
  );
}
function validRules(value: unknown) {
  return (
    props(value, ['id', 'eventId', 'createdAt']) &&
    object(value) &&
    ['version', 'minPlayers', 'maxPlayers'].every((key) => Number.isInteger(value[key])) &&
    ['zeroAndDoubleZeroDistinct', 'requireIdentity', 'requireInsurance'].every(
      (key) => typeof value[key] === 'boolean',
    )
  );
}
function validGrant(value: unknown) {
  return (
    props(value, ['userId']) &&
    object(value) &&
    value.role === 'TEAM_MANAGER' &&
    (value.status === 'ACTIVE' || value.status === 'DISABLED')
  );
}
function validTeam(value: unknown) {
  return (
    props(value, ['id', 'orgId', 'name']) &&
    object(value) &&
    Number.isInteger(value.version) &&
    Array.isArray(value.members) &&
    value.members.every((member) => props(member, ['id', 'name'])) &&
    Array.isArray(value.grants) &&
    value.grants.every(validGrant) &&
    capabilities(value, ['canManage', 'canInvite'])
  );
}
function validInvitation(value: unknown) {
  return (
    props(value, [
      'id',
      'orgId',
      'teamId',
      'targetUserId',
      'issuerUserId',
      'expiresAt',
      'createdAt',
    ]) &&
    object(value) &&
    ['acceptedAt', 'revokedAt'].every(
      (key) => value[key] === null || typeof value[key] === 'string',
    ) &&
    capabilities(value, ['canRevoke'])
  );
}
function validSummary(value: unknown) {
  return (
    props(value, ['id', 'eventId', 'teamId', 'teamName']) &&
    object(value) &&
    ENTRY_STATUSES.includes(value.status as never) &&
    Number.isInteger(value.version)
  );
}
function validPlayers(value: unknown) {
  return (
    Array.isArray(value) && value.every((player) => props(player, ['memberId', 'name', 'jerseyNo']))
  );
}
function validEntry(value: unknown) {
  return (
    validSummary(value) &&
    object(value) &&
    validRules(value.rules) &&
    validPlayers(value.players) &&
    Array.isArray(value.history) &&
    value.history.every((item) => props(item, ['id', 'actorId', 'type', 'createdAt'])) &&
    capabilities(value, [
      'canEditRoster',
      'canSubmit',
      'canWithdraw',
      'canReview',
      'canApprove',
      'canRequestChanges',
      'canReject',
    ])
  );
}
function validRegistration(value: unknown) {
  return (
    object(value) &&
    validEvent(value.event) &&
    (value.rules === null || validRules(value.rules)) &&
    object(value.counts) &&
    ENTRY_STATUSES.every((key) => Number.isInteger((value.counts as JsonObject)[key])) &&
    (value.freeze === null ||
      (object(value.freeze) &&
        Array.isArray(value.freeze.entries) &&
        value.freeze.entries.every(
          (entry) =>
            props(entry, ['entryId', 'teamId', 'teamName', 'rosterRevisionId']) &&
            object(entry) &&
            validPlayers(entry.players),
        ))) &&
    capabilities(value, ['canManageRules', 'canOpen', 'canClose', 'canFreeze'])
  );
}
function validRegistrationEvent(value: unknown) {
  return (
    object(value) &&
    validEvent(value.event) &&
    (value.rules === null || validRules(value.rules)) &&
    (value.entry === null || validSummary(value.entry)) &&
    capabilities(value, ['canCreateEntry'])
  );
}
function validated<T>(value: unknown, valid: (value: unknown) => boolean): T {
  if (!valid(value))
    throw new ApiError(200, 'INVALID_RESPONSE', '服务返回的业务资料或操作权限不完整，请重新读取');
  return value as T;
}
async function pages<T>(
  client: ApiClient,
  path: string,
  valid: (value: unknown) => boolean,
  requireCreateCapability = false,
): Promise<{ data: T[]; canCreateTeam: boolean }> {
  const all: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let canCreateTeam = false;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page: ApiEnvelope<T[]> = await client.request<T[]>(`${path}?${query}`);
    if (!Array.isArray(page.data))
      throw new ApiError(200, 'INVALID_RESPONSE', '列表资料格式不正确');
    all.push(...page.data.map((value) => validated<T>(value, valid)));
    if (!cursor) {
      if (requireCreateCapability && typeof page.meta.capabilities?.canCreateTeam !== 'boolean')
        throw new ApiError(200, 'INVALID_RESPONSE', '服务未返回创建球队权限');
      canCreateTeam = page.meta.capabilities?.canCreateTeam === true;
    }
    const next: unknown = page.meta.nextCursor;
    if (next !== undefined && next !== null && (typeof next !== 'string' || !next))
      throw new ApiError(200, 'INVALID_CURSOR', '列表分页信息不正确');
    cursor = typeof next === 'string' ? next : null;
    if (cursor) {
      if (seen.has(cursor) || seen.size >= 1000)
        throw new ApiError(200, 'INVALID_CURSOR', '列表分页无法继续，请重新读取');
      seen.add(cursor);
    }
  } while (cursor);
  return { data: all, canCreateTeam };
}
export function createRegistrationApi(client: ApiClient, orgId: string) {
  const base = `/v1/orgs/${encode(orgId)}`;
  async function read<T>(path: string, valid: (value: unknown) => boolean) {
    return validated<T>((await client.request<unknown>(`${base}${path}`)).data, valid);
  }
  async function write<T>(
    path: string,
    method: string,
    input: unknown,
    valid: (value: unknown) => boolean,
  ) {
    return validated<T>(
      (await client.request<unknown>(`${base}${path}`, { method, body: JSON.stringify(input) }))
        .data,
      valid,
    );
  }
  return {
    teams: () => pages<TeamData>(client, `${base}/teams`, validTeam, true),
    team: (teamId: string) => read<TeamData>(`/teams/${encode(teamId)}`, validTeam),
    createTeam: (input: CreateTeamInput) => write<TeamData>('/teams', 'POST', input, validTeam),
    updateTeam: (teamId: string, input: UpdateTeamInput) =>
      write<TeamData>(`/teams/${encode(teamId)}`, 'PATCH', input, validTeam),
    members: (teamId: string, input: UpdateTeamMembersInput) =>
      write<TeamData>(`/teams/${encode(teamId)}/members`, 'PUT', input, validTeam),
    invitations: async (teamId: string) =>
      (
        await pages<InvitationData>(
          client,
          `${base}/teams/${encode(teamId)}/invitations`,
          validInvitation,
        )
      ).data,
    invite: (teamId: string, input: CreateInvitationInput) =>
      write<IssuedInvitationData>(
        `/teams/${encode(teamId)}/invitations`,
        'POST',
        input,
        (value) =>
          object(value) &&
          validInvitation(value.invitation) &&
          typeof value.token === 'string' &&
          Boolean(value.token),
      ),
    revoke: (teamId: string, invitationId: string) =>
      write<InvitationData>(
        `/teams/${encode(teamId)}/invitations/${encode(invitationId)}/revoke`,
        'POST',
        {},
        validInvitation,
      ),
    grant: (teamId: string, userId: string, status: 'ACTIVE' | 'DISABLED') =>
      write<TeamGrantData>(
        `/teams/${encode(teamId)}/grants/${encode(userId)}`,
        'PUT',
        { status },
        validGrant,
      ),
    registration: (eventId: string) =>
      read<EventRegistrationData>(`/events/${encode(eventId)}/registration`, validRegistration),
    rules: (eventId: string, input: RegistrationRulesInput) =>
      write<EventRegistrationData>(
        `/events/${encode(eventId)}/registration-rules`,
        'PUT',
        input,
        validRegistration,
      ),
    registrationCommand: (eventId: string, input: RegistrationCommandInput) =>
      write<EventRegistrationData>(
        `/events/${encode(eventId)}/registration-commands`,
        'POST',
        input,
        validRegistration,
      ),
    registrationEvents: async (teamId: string) =>
      (
        await pages<TeamRegistrationEventData>(
          client,
          `${base}/teams/${encode(teamId)}/registration-events`,
          validRegistrationEvent,
        )
      ).data,
    entries: async (eventId: string) =>
      (await pages<EntrySummary>(client, `${base}/events/${encode(eventId)}/entries`, validSummary))
        .data,
    createEntry: (eventId: string, teamId: string) =>
      write<EntryData>(`/events/${encode(eventId)}/entries`, 'POST', { teamId }, validEntry),
    entry: (entryId: string) => read<EntryData>(`/entries/${encode(entryId)}`, validEntry),
    roster: (entryId: string, input: UpdateEntryRosterInput) =>
      write<EntryData>(`/entries/${encode(entryId)}/roster`, 'PUT', input, validEntry),
    entryCommand: (entryId: string, input: EntryCommandInput) =>
      write<EntryData>(`/entries/${encode(entryId)}/commands`, 'POST', input, validEntry),
  };
}
export type RegistrationApi = ReturnType<typeof createRegistrationApi>;

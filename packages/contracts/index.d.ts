export const EVENT_FORMATS: readonly ['ROUND_ROBIN', 'GROUP_KNOCKOUT', 'SINGLE_ELIMINATION'];
export type EventFormat = (typeof EVENT_FORMATS)[number];
export const EVENT_STATUSES: readonly [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const ORG_ROLES: readonly [
  'ORG_OWNER',
  'ORG_ADMIN',
  'EVENT_MANAGER',
  'REVIEWER',
  'SCORER',
  'STREAMER',
];
export type OrgRole = (typeof ORG_ROLES)[number];
export const STAFF_ROLES: readonly ['EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER'];
export type StaffRole = (typeof STAFF_ROLES)[number];
export interface CreateEventInput {
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName?: string;
  format: EventFormat;
}
export interface EventData {
  permissions?: { canEditDraft: boolean };
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName: string | null;
  format: EventFormat;
  status: EventStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OrganizationSummary {
  id: string;
  name: string;
  role: OrgRole;
}
export interface SessionData {
  user: { id: string; email: string; displayName: string };
  organizations: OrganizationSummary[];
  teamContexts: TeamContext[];
}
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    nextCursor?: string | null;
    capabilities?: { canCreateTeam: boolean };
  };
}

export interface TeamContext {
  orgId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
}
export const ENTRY_STATUSES: readonly [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'WITHDRAWN',
];
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const ENTRY_COMMANDS: readonly [
  'SUBMIT',
  'WITHDRAW',
  'APPROVE',
  'REQUEST_CHANGES',
  'REJECT',
];
export type EntryCommandType = (typeof ENTRY_COMMANDS)[number];
export const REGISTRATION_COMMANDS: readonly [
  'OPEN_REGISTRATION',
  'CLOSE_REGISTRATION',
  'FREEZE_REGISTRATION',
];
export type RegistrationCommandType = (typeof REGISTRATION_COMMANDS)[number];
export interface TeamMemberData {
  id: string;
  name: string;
}
export interface TeamGrantData {
  userId: string;
  role: 'TEAM_MANAGER';
  status: 'ACTIVE' | 'DISABLED';
}
export interface TeamData {
  id: string;
  orgId: string;
  name: string;
  version: number;
  members: TeamMemberData[];
  grants: TeamGrantData[];
  createdAt: string;
  updatedAt: string;
  capabilities: { canManage: boolean; canInvite: boolean };
}
export interface CreateTeamInput {
  name: string;
}
export interface UpdateTeamInput {
  name: string;
  expectedVersion: number;
}
export interface UpdateTeamMembersInput {
  expectedVersion: number;
  members: { id?: string; name: string }[];
}
export interface InvitationData {
  id: string;
  orgId: string;
  teamId: string;
  targetUserId: string;
  issuerUserId: string;
  purpose: 'TEAM_MANAGER';
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  capabilities: { canRevoke: boolean };
}
export interface CreateInvitationInput {
  targetUserId: string;
  expiresInHours: number;
}
export interface IssuedInvitationData {
  invitation: InvitationData;
  token: string;
}
export interface UpdateTeamGrantInput {
  status: 'ACTIVE' | 'DISABLED';
}
export interface RegistrationRulesInput {
  expectedVersion: number;
  minPlayers: number;
  maxPlayers: number;
  zeroAndDoubleZeroDistinct: boolean;
  requireIdentity: boolean;
  requireInsurance: boolean;
}
export interface EventRulesetData {
  id: string;
  eventId: string;
  version: number;
  minPlayers: number;
  maxPlayers: number;
  zeroAndDoubleZeroDistinct: boolean;
  requireIdentity: boolean;
  requireInsurance: boolean;
  createdAt: string;
}
export interface EntryRosterPlayer {
  memberId: string;
  name: string;
  jerseyNo: string;
}
export interface EntryReviewData {
  id: string;
  actorId: string;
  type: EntryCommandType;
  reason: string | null;
  rosterRevisionId: string | null;
  createdAt: string;
}
export interface EntrySummary {
  id: string;
  eventId: string;
  teamId: string;
  teamName: string;
  status: EntryStatus;
  version: number;
  rosterRevisionId: string | null;
  lastSubmittedBy: string | null;
  latestReviewReason: string | null;
}
export interface EntryData extends EntrySummary {
  orgId: string;
  rules: EventRulesetData;
  players: EntryRosterPlayer[];
  history: EntryReviewData[];
  createdAt: string;
  updatedAt: string;
  capabilities: {
    canEditRoster: boolean;
    canSubmit: boolean;
    canWithdraw: boolean;
    canReview: boolean;
    canApprove: boolean;
    canRequestChanges: boolean;
    canReject: boolean;
  };
}
export interface UpdateEntryRosterInput {
  expectedVersion: number;
  players: { memberId: string; jerseyNo: string }[];
}
export interface EntryCommandInput {
  type: EntryCommandType;
  expectedVersion: number;
  reason?: string;
}
export interface RegistrationCommandInput {
  type: RegistrationCommandType;
  expectedVersion: number;
}
export interface RegistrationCounts {
  DRAFT: number;
  SUBMITTED: number;
  APPROVED: number;
  CHANGES_REQUESTED: number;
  REJECTED: number;
  WITHDRAWN: number;
}
export interface FrozenEntryData {
  entryId: string;
  teamId: string;
  teamName: string;
  rosterRevisionId: string;
  players: EntryRosterPlayer[];
}
export interface RegistrationFreezeData {
  id: string;
  eventId: string;
  rulesetId: string;
  rulesetVersion: number;
  eventVersion: number;
  entries: FrozenEntryData[];
  excludedCounts: { DRAFT: number; REJECTED: number; WITHDRAWN: number };
  createdAt: string;
}
export interface EventRegistrationData {
  event: EventData;
  rules: EventRulesetData | null;
  freeze: RegistrationFreezeData | null;
  counts: RegistrationCounts;
  capabilities: {
    canManageRules: boolean;
    canOpen: boolean;
    canClose: boolean;
    canFreeze: boolean;
  };
}
export interface TeamRegistrationEventData {
  event: EventData;
  rules: EventRulesetData | null;
  entry: EntrySummary | null;
  capabilities: { canCreateEntry: boolean };
}

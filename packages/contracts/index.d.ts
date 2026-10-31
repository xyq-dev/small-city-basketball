import type { GroupKnockoutConfig } from './group-knockout.js';
export const EVENT_FORMATS: readonly [
  'ROUND_ROBIN',
  'GROUP_KNOCKOUT',
  'SINGLE_ELIMINATION',
  'DOUBLE_ROUND_ROBIN',
];
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
  /** Display hint only; every platform API rechecks the independent operator grant. */
  platformOperator?: boolean;
  user: { id: string; email: string; displayName: string };
  organizations: OrganizationSummary[];
  teamContexts: TeamContext[];
}
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    nextCursor?: string | null;
    capabilities?: { canCreateTeam?: boolean; canCreateCourt?: boolean };
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
  /** Explicit opt-in; omitted by legacy clients. */
  requireParticipantMaterials?: boolean;
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
  /** Explicit opt-in; omitted by legacy clients. */
  requireParticipantMaterials?: boolean;
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
  participantMaterials?: {
    required: true;
    ready: boolean;
    blockers: { memberId: string; code: string; message: string }[];
  };
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
  participantMaterials?: {
    memberId: string;
    materialId: string;
    revisionId: string;
    materialVersion: number;
  }[];
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

export type ScheduleAlgorithmVersion =
  'RR_CIRCLE_V1' | 'DRR_CIRCLE_V1' | 'SE_SEEDED_V1' | 'GK_BALANCED_V1';
export type ScheduleRevisionStatus = 'DRAFT' | 'SUPERSEDED' | 'PUBLISHED';
export interface CourtData {
  id: string;
  orgId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  createdAt: string;
  updatedAt: string;
  capabilities: { canManage: boolean };
}
export interface CreateCourtInput {
  name: string;
}
export interface UpdateCourtInput {
  expectedVersion: number;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
}
export interface SchedulePolicy {
  /** Explicit opt-in; omitted/false keeps legacy scheduling hashes unchanged. */
  thirdPlaceMatch?: boolean;
  slotDurationMinutes: number;
  minRestMinutes: number;
  minLocalDayGap: number;
  courtWindows: { courtId: string; startsAt: string; endsAt: string }[];
}
export interface ScheduleParticipant {
  entryId: string;
  teamId: string;
  teamName: string;
  rosterRevisionId: string;
}
export interface ScheduleRoundData {
  roundNo: number;
  byeEntryId: string | null;
  /** SINGLE_ELIMINATION can have several first-round byes. */
  byeEntryIds?: string[];
}
export interface ScheduleFixtureData {
  fixtureKey: string;
  roundNo: number;
  positionNo: number;
  homeEntryId: string;
  awayEntryId: string;
  courtId: string | null;
  startsAt: string | null;
  endsAt: string | null;
}
export interface ScheduleFreezeSummary {
  id: string;
  rulesetId: string;
  rulesetVersion: number;
  eventVersion: number;
  entryCount: number;
}
export interface ScheduleRevisionSummary {
  groupConfig?: GroupKnockoutConfig | null;
  id: string;
  eventId: string;
  freezeId: string;
  algorithmVersion: ScheduleAlgorithmVersion;
  seed: string;
  inputHash: string;
  pairingHash: string;
  status: ScheduleRevisionStatus;
  version: number;
  redrawReason: string | null;
  previousRevisionId: string | null;
  createdAt: string;
}
export interface ScheduleRevisionData extends ScheduleRevisionSummary {
  eventVersion: number;
  isCurrent: boolean;
  policy: SchedulePolicy;
  source: RegistrationFreezeData;
  participants: ScheduleParticipant[];
  rounds: ScheduleRoundData[];
  fixtures: ScheduleFixtureData[];
  capabilities: { canEditAllocations: boolean; canValidate: boolean; canPublish: boolean };
}
export interface SchedulePublicationData {
  id: string;
  eventId: string;
  revisionId: string;
  publicationHash: string;
  publishedAt: string;
  matchCount: number;
}
export interface EventSchedulingData {
  template?: {
    expectedTeams: number | null;
    configuration: import('./event-templates.js').EventTemplateConfiguration;
  };
  event: EventData;
  freeze: ScheduleFreezeSummary | null;
  currentRevision: ScheduleRevisionSummary | null;
  publication: SchedulePublicationData | null;
  support: { supported: boolean; reason: string | null };
  capabilities: { canGenerate: boolean; canRedraw: boolean; canReadMatches: boolean };
}
export interface CreateScheduleRevisionInput {
  groupConfig?: GroupKnockoutConfig;
  expectedEventVersion: number;
  freezeId: string;
  algorithmVersion: ScheduleAlgorithmVersion;
  policy: SchedulePolicy;
  redrawReason?: string;
}
export interface ScheduleVersionInput {
  expectedEventVersion: number;
  expectedRevisionVersion: number;
}
export interface UpdateScheduleAllocationsInput extends ScheduleVersionInput {
  allocations: { fixtureKey: string; courtId: string | null; startsAt: string | null }[];
}
export type ScheduleConflictCode =
  | 'UNASSIGNED'
  | 'OUTSIDE_WINDOW'
  | 'OUTSIDE_EVENT_DATES'
  | 'COURT_DISABLED'
  | 'COURT_OVERLAP'
  | 'TEAM_OVERLAP'
  | 'MIN_REST'
  | 'MIN_LOCAL_DAY_GAP';
export interface ScheduleConflict {
  code: ScheduleConflictCode;
  fixtureKeys: string[];
  resourceId?: string;
  startsAt?: string;
  endsAt?: string;
  external?: boolean;
}
export interface ScheduleValidationData extends ScheduleVersionInput {
  revisionId: string;
  valid: boolean;
  checkedAt: string;
  conflicts: ScheduleConflict[];
}
export interface ScheduledMatchData {
  id: string;
  eventId: string;
  publicationId: string;
  fixtureKey: string;
  roundNo: number;
  positionNo: number;
  home: ScheduleParticipant;
  away: ScheduleParticipant;
  courtId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  status: MatchStatus;
  version: number;
}
export interface MatchReschedulePlan {
  courtId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
}
export interface MatchRescheduleRecord {
  id: string;
  fromMatchVersion: number;
  toMatchVersion: number;
  from: MatchReschedulePlan;
  to: MatchReschedulePlan;
  reason: string;
  createdAt: string;
}
export interface RescheduleMatchInput {
  type: 'RESCHEDULE';
  expectedEventVersion: number;
  expectedMatchVersion: number;
  courtId: string;
  startsAt: string;
  reason: string;
}
export interface MatchReschedulingData {
  event: EventData;
  match: ScheduledMatchData;
  policy: SchedulePolicy;
  history: MatchRescheduleRecord[];
  historyLimit: 20;
  historyTruncated: boolean;
  capabilities: { canReschedule: boolean };
}

export const SCHEDULE_ALGORITHM_VERSION: 'RR_CIRCLE_V1';

export const MATCH_STATUSES: readonly [
  'SCHEDULED',
  'READY',
  'LIVE',
  'PENDING_CONFIRMATION',
  'FINAL',
  'POSTPONED',
  'CANCELLED',
];
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export type ScoringSide = 'HOME' | 'AWAY';
export type ScoringStatKind = 'SCORE' | 'FOUL' | 'TIMEOUT';
export type ScoringCollectionMode = 'TEAM_ONLY' | 'PLAYER_BASIC';
export interface MatchPlayerStatRow extends EntryRosterPlayer {
  score: number;
  fouls: number;
}
export interface MatchSidePlayerStatistics {
  players: MatchPlayerStatRow[];
  unassigned: { score: number; fouls: number };
}
export interface MatchPlayerStatistics {
  mode: 'PLAYER_BASIC';
  home: MatchSidePlayerStatistics;
  away: MatchSidePlayerStatistics;
}
export interface MatchPlayerRoster {
  home: EntryRosterPlayer[];
  away: EntryRosterPlayer[];
}
export interface ScoringRules {
  regulationPeriods: number;
  periodDurationSeconds: number;
  allowedScoreValues: (1 | 2 | 3)[];
  tiePolicy: 'ALLOW_DRAW' | 'OVERTIME';
  overtimeDurationSeconds: number | null;
}
export interface ScoringRulesetData extends ScoringRules {
  id: string;
  eventId: string;
  version: number;
  createdAt: string;
}
export interface EventScoringData {
  event: EventData;
  rules: ScoringRulesetData | null;
  locked: boolean;
  capabilities: { canManageRules: boolean };
}
export interface UpdateScoringRulesInput extends ScoringRules {
  expectedEventVersion: number;
}
export interface ScoringClock {
  period: number;
  remainingMs: number;
  running: boolean;
  anchorServerTime: string;
  clockVersion: number;
}
export interface ScoringTotals {
  score: number;
  fouls: number;
  timeouts: number;
}
export interface ScoringPeriodTotals {
  period: number;
  home: ScoringTotals;
  away: ScoringTotals;
}
export interface ResultConfirmationData {
  id: string;
  matchId: string;
  confirmingUserId: string;
  rulesetId: string;
  rulesetVersion: number;
  sourceMatchVersion: number;
  lastEventSeq: number;
  home: ScoringTotals;
  away: ScoringTotals;
  periods: ScoringPeriodTotals[];
  playerStatistics: MatchPlayerStatistics | null;
  professionalStatistics?: import('./professional-statistics.js').ProfessionalStatistics | null;
  confirmedAt: string;
}
export interface ScoreSnapshot {
  matchId: string;
  eventId: string;
  eventName: string;
  status: MatchStatus;
  version: number;
  home: ScheduleParticipant;
  away: ScheduleParticipant;
  totals: { home: ScoringTotals; away: ScoringTotals };
  periods: ScoringPeriodTotals[];
  rules: ScoringRulesetData;
  clock: ScoringClock;
  lastEventSeq: number;
  latestConfirmation: ResultConfirmationData | null;
  requiresReconfirmation: boolean;
  playerStatistics: MatchPlayerStatistics | null;
  professionalStatistics?: import('./professional-statistics.js').ProfessionalStatistics | null;
  collected: { teamScore: true; teamFouls: true; teamTimeouts: true; playerStatistics: boolean };
  serverTime: string;
}
export type MatchStaffRole = 'SCORER' | 'RESULT_REVIEWER';
export interface MatchStaffData {
  userId: string;
  displayName: string;
  role: MatchStaffRole;
  status: 'ACTIVE' | 'DISABLED';
}
export interface UpdateMatchStaffInput {
  expectedMatchVersion: number;
  role: MatchStaffRole;
  status: 'ACTIVE' | 'DISABLED';
}
export interface ScoringControl {
  leaseId: string;
  fencingToken: string;
  clientInstanceId: string;
}
export interface ScorekeeperLeaseData extends ScoringControl {
  expiresAt: string;
  serverTime: string;
}
export interface LeaseAcquireInput {
  clientInstanceId: string;
}
export interface LeaseControlInput {
  control: ScoringControl;
}
export interface ScoringWorkbenchData {
  match: ScheduledMatchData;
  event: { id: string; name: string; status: EventStatus; version: number };
  rules: ScoringRulesetData | null;
  rulesLocked: boolean;
  snapshot: ScoreSnapshot | null;
  playerRoster: MatchPlayerRoster;
  staff: MatchStaffData[];
  lease: { held: boolean; expiresAt: string | null; holderUserId: string | null };
  capabilities: {
    canManageStaff: boolean;
    canPrepare: boolean;
    canAcquireControl: boolean;
    canRecord: boolean;
    canCorrect: boolean;
    canConfirm: boolean;
    canReopen: boolean;
  };
}
export interface ScoringMatchSummary {
  matchId: string;
  eventId: string;
  eventName: string;
  homeTeamName: string;
  awayTeamName: string;
  courtName: string;
  startsAt: string;
  status: MatchStatus;
  version: number;
  score: { home: number; away: number } | null;
}
export const SCORING_COMMAND_TYPES: readonly [
  'PREPARE_MATCH',
  'START_MATCH',
  'RECORD_STAT',
  'ADD_CORRECTION',
  'VOID_STAT',
  'REPLACE_STAT',
  'CLOCK_START',
  'CLOCK_PAUSE',
  'CLOCK_SET',
  'NEXT_PERIOD',
  'START_OVERTIME',
  'END_MATCH',
  'CONFIRM_RESULT',
  'REOPEN_RESULT',
  'RECORD_SHOT',
  'RECORD_TECHNICAL',
  'SET_LINEUP',
  'SUBSTITUTE_PLAYER',
  'VOID_PRO_STAT',
  'ADD_PRO_CORRECTION',
  'CORRECT_LINEUP',
];
export type ScoringCommandType = (typeof SCORING_COMMAND_TYPES)[number];
export type ScoringCommandPayload =
  | import('./professional-statistics.js').ProfessionalCommandPayload
  | {
      type: 'PREPARE_MATCH';
      payload: {
        expectedEventVersion: number;
        collectionMode?: ScoringCollectionMode;
        technicalCollection?: boolean;
      };
    }
  | { type: 'START_MATCH'; payload: { expectedEventVersion: number } }
  | {
      type: 'RECORD_STAT';
      payload: {
        kind: ScoringStatKind;
        side: ScoringSide;
        value: number;
        memberId?: string | null;
      };
    }
  | {
      type: 'ADD_CORRECTION';
      payload: {
        kind: ScoringStatKind;
        side: ScoringSide;
        value: number;
        period: number;
        reason: string;
        memberId?: string | null;
      };
    }
  | { type: 'VOID_STAT'; payload: { targetEventId: string; reason: string } }
  | {
      type: 'REPLACE_STAT';
      payload: {
        targetEventId: string;
        side: ScoringSide;
        value: number;
        reason: string;
        memberId?: string | null;
      };
    }
  | { type: 'CLOCK_SET'; payload: { remainingMs: number; reason: string } }
  | { type: 'REOPEN_RESULT'; payload: { reason: string } }
  | {
      type:
        | 'CLOCK_START'
        | 'CLOCK_PAUSE'
        | 'NEXT_PERIOD'
        | 'START_OVERTIME'
        | 'END_MATCH'
        | 'CONFIRM_RESULT';
      payload: Record<string, never>;
    };
export type ScoringCommandInput = {
  commandId: string;
  expectedVersion: number;
  capturedAt: string;
  control?: ScoringControl;
} & ScoringCommandPayload;
export interface ScoringCommandReceipt {
  commandId: string;
  matchId: string;
  type: ScoringCommandType;
  appliedVersion: number;
  firstEventSeq: number | null;
  lastEventSeq: number | null;
  acceptedAt: string;
}
export interface ScoringCommandResponse {
  receipt: ScoringCommandReceipt;
  snapshot: ScoreSnapshot;
}
export interface ScoringEventData {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  actorId: string;
  commandId: string;
  capturedAt: string;
  serverTime: string;
  targetEventId: string | null;
}

export const STANDINGS_TIEBREAKERS: readonly ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'];
export const STANDINGS_ALGORITHM_VERSION: 'RR_STANDINGS_V1';
export type StandingsTiebreaker = (typeof STANDINGS_TIEBREAKERS)[number];
export interface StandingsRules {
  winPoints: number;
  lossPoints: number;
  drawPoints: number;
  tiebreakers: StandingsTiebreaker[];
}
export interface StandingsRulesetData extends StandingsRules {
  id: string;
  eventId: string;
  version: number;
  algorithmVersion: typeof STANDINGS_ALGORITHM_VERSION;
  createdAt: string;
}
export interface StandingsTotals {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  scoreDifference: number;
  leaguePoints: number;
}
export interface StandingsRow extends StandingsTotals {
  entryId: string;
  teamId: string;
  teamName: string;
  rank: number | null;
  tied: boolean;
}
export interface StandingsData {
  mode: 'DRAFT_PREVIEW' | 'PUBLISHED';
  rulesetVersion: number;
  sourceHash: string;
  asOf: string;
  confirmedMatchCount: number;
  resolvedMatchCount?: number;
  adjudicatedMatchCount?: number;
  cancelledMatchCount?: number;
  totalMatchCount: number;
  isComplete: boolean;
  hasSharedRanks: boolean;
  rows: StandingsRow[];
}
export interface PublicViewingPublicationData {
  /** Older responses omit this and represent LIVE grants. */
  purpose?: 'LIVE' | 'HISTORY';
  publicEventId: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  revokedAt: string | null;
}
export interface EventStandingsData {
  event: EventData;
  rules: StandingsRulesetData | null;
  locked: boolean;
  standings: StandingsData | null;
  publication: PublicViewingPublicationData | null;
  capabilities: {
    canManageRules: boolean;
    canPublishRules: boolean;
    canEnablePublicViewing: boolean;
    canDisablePublicViewing: boolean;
  };
}
export interface UpdateStandingsRulesInput extends StandingsRules {
  expectedEventVersion: number;
}
export interface StandingsRuleCommandInput {
  type: 'PUBLISH_STANDINGS_RULES';
  rulesetId: string;
  expectedEventVersion: number;
}
export interface PublicViewingCommandInput {
  type: 'ENABLE' | 'ENABLE_HISTORY' | 'DISABLE';
  expectedEventVersion: number;
}
export interface PublicStandingsRow extends StandingsTotals {
  teamKey: string;
  teamName: string;
  rank: number | null;
  tied: boolean;
}
export interface PublicStandingsRules extends StandingsRules {
  version: number;
  algorithmVersion: typeof STANDINGS_ALGORITHM_VERSION;
}
export interface PublicStandingsData {
  publicEventId: string;
  rules: PublicStandingsRules;
  sourceHash: string;
  asOf: string;
  confirmedMatchCount: number;
  resolvedMatchCount?: number;
  adjudicatedMatchCount?: number;
  cancelledMatchCount?: number;
  totalMatchCount: number;
  isComplete: boolean;
  hasSharedRanks: boolean;
  rows: PublicStandingsRow[];
}
export interface PublicEventData {
  publicEventId: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName: string | null;
  status: EventStatus;
  /** Older responses omit format and represent ROUND_ROBIN. */
  format?: EventFormat;
  rules: PublicStandingsRules | null;
  confirmedMatchCount: number;
  resolvedMatchCount?: number;
  adjudicatedMatchCount?: number;
  cancelledMatchCount?: number;
  totalMatchCount: number;
  isComplete: boolean;
  serverTime: string;
}
export interface PublicTeamData {
  teamKey: string;
  teamName: string;
}
export type PublicResultStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'REQUIRES_RECONFIRMATION';
export interface PublicScheduleMatchData {
  adjudication?: { kind: 'FORFEIT' | 'CANCELLED'; winner: PublicTeamData | null };
  publicMatchId: string;
  roundNo: number;
  positionNo: number;
  home: PublicTeamData;
  away: PublicTeamData;
  courtName: string;
  startsAt: string;
  endsAt: string;
  status: MatchStatus;
  version: number;
  score: { home: number; away: number } | null;
  resultStatus: PublicResultStatus;
}
export interface PublicMatchSnapshotData extends PublicScheduleMatchData {
  publicEventId: string;
  eventName: string;
  totals: { home: ScoringTotals; away: ScoringTotals } | null;
  periods: ScoringPeriodTotals[] | null;
  rules: (ScoringRules & { version: number }) | null;
  clock: ScoringClock | null;
  collected: {
    teamScore: boolean;
    teamFouls: boolean;
    teamTimeouts: boolean;
    playerStatistics: false;
  };
  serverTime: string;
}

export const OVERLAY_TEMPLATES: readonly ['SCOREBAR_1080P_V1'];
export const OVERLAY_COMMANDS: readonly ['ISSUE', 'ROTATE', 'REVOKE'];
export type OverlayTemplate = (typeof OVERLAY_TEMPLATES)[number];
export type OverlayCommand = (typeof OVERLAY_COMMANDS)[number];
export interface OverlayGrantData {
  overlayId: string;
  template: OverlayTemplate;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  version: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
}
/** A finite projection independent of public viewing and private scoring credentials. */
export interface OverlayPreviewData {
  eventName: string;
  home: { teamName: string };
  away: { teamName: string };
  status: MatchStatus;
  matchVersion: number;
  score: { home: number; away: number } | null;
  totals: { home: ScoringTotals; away: ScoringTotals } | null;
  periods: ScoringPeriodTotals[] | null;
  rules: (ScoringRules & { version: number }) | null;
  clock: ScoringClock | null;
  collected: {
    teamScore: boolean;
    teamFouls: boolean;
    teamTimeouts: boolean;
    playerStatistics: false;
  };
  resultStatus: PublicResultStatus;
  serverTime: string;
}
export interface OverlaySnapshotData extends OverlayPreviewData {
  overlayId: string;
  template: OverlayTemplate;
  expiresAt: string;
}
export interface OverlayWorkbenchData {
  event: { id: string; name: string; version: number };
  matchId: string;
  preview: OverlayPreviewData | null;
  previewError: { code: 'RESULT_SOURCE_INVALID'; message: string } | null;
  currentGrant: OverlayGrantData | null;
  history: OverlayGrantData[];
  historyLimit: 20;
  historyTruncated: boolean;
  capabilities: { canIssue: boolean; canRotate: boolean; canRevoke: boolean };
  serverTime: string;
}
export type OverlayCommandInput =
  | { type: 'ISSUE'; expectedEventVersion: number; expiresInMinutes: number }
  | {
      type: 'ROTATE';
      expectedEventVersion: number;
      overlayId: string;
      expectedGrantVersion: number;
      expiresInMinutes: number;
      reason: string;
    }
  | {
      type: 'REVOKE';
      expectedEventVersion: number;
      overlayId: string;
      expectedGrantVersion: number;
      reason: string;
    };
export interface OverlayCommandResponse extends OverlayWorkbenchData {
  credential: { overlayId: string; token: string } | null;
}
export interface OverlayBootstrapInput {
  token: string;
}
export interface OverlayBootstrapData {
  overlayId: string;
  expiresAt: string;
  serverTime: string;
}

export interface AuthCapabilitiesData {
  canRegisterOrganization: boolean;
  canRegisterParticipant: boolean;
}

/** Explicit event closure, separate from an individual FINAL result. */
export interface EventLifecycleCommandInput {
  type: 'COMPLETE' | 'ARCHIVE' | 'REOPEN';
  expectedEventVersion: number;
  reason: string;
}
export interface EventLifecycleData {
  event: EventData;
  completion: {
    totalMatchCount: number;
    confirmedMatchCount: number;
    resolvedMatchCount?: number;
    adjudicatedMatchCount?: number;
    cancelledMatchCount?: number;
    ready: boolean;
    blockers: string[];
    sourceHash: string | null;
  };
  capabilities: { canComplete: boolean; canArchive: boolean; canReopen: boolean };
}
export interface EventPlayerStatisticsRow {
  entryId: string;
  rosterRevisionId: string;
  memberId: string;
  teamName: string;
  name: string;
  jerseyNo: string;
  score: number;
  fouls: number;
  /** Frozen-roster samples; never a claim of actual appearances. */
  rosterSampleMatchCount: number;
  rank: number;
  tied: boolean;
}
export interface EventPlayerStatisticsData {
  event: EventData;
  summary: null | {
    algorithmVersion: 'EVENT_PLAYER_BASIC_V1';
    sourceHash: string;
    asOf: string;
    totalMatchCount: number;
    includedMatchCount: number;
    teamOnlyConfirmedMatchCount: number;
    pendingMatchCount: number;
    /** All published matches are effectively confirmed PLAYER_BASIC samples. */
    coverageComplete: boolean;
    /** At least one included sample, with no unattributed points or fouls. */
    attributionComplete: boolean;
    rows: EventPlayerStatisticsRow[];
    teams: {
      entryId: string;
      teamName: string;
      attributedScore: number;
      unassignedScore: number;
      attributedFouls: number;
      unassignedFouls: number;
    }[];
  };
}

/** C04: bracket projection over original published_matches and effective confirmations. */
export interface ConfirmedKnockoutSource {
  fixtureKey: string;
  matchId: string;
  confirmationId: string;
  /** Effective CONFIRM_RESULT version; unaffected by later staff/access maintenance. */
  matchVersion: number;
  winnerEntryId: string;
}
export type KnockoutSource =
  | ConfirmedKnockoutSource
  | import('./match-exceptions.js').AdministrativeMatchSource
  | import('./match-exceptions.js').AdministrativeCancellationSource;
export interface KnockoutSlotData {
  /** Present only for an opt-in championship/bronze final round. */
  kind?: 'CHAMPIONSHIP' | 'THIRD_PLACE';
  adjudication?: { kind: 'FORFEIT' | 'CANCELLED' };
  /** Bronze contestants are genuine losers of the cited semifinals. */
  sourceOutcome?: 'WINNER' | 'LOSER';
  fixtureKey: string;
  roundNo: number;
  positionNo: number;
  homeEntryId: string | null;
  awayEntryId: string | null;
  /** Previous-round fixture keys; null in the initial draw. */
  homeSource: string | null;
  awaySource: string | null;
  byeEntryId: string | null;
  matchId: string | null;
  status: MatchStatus | 'WAITING' | 'BYE';
  winnerEntryId: string | null;
}
export interface KnockoutRoundData {
  roundNo: number;
  label: string;
  published: boolean;
  slots: KnockoutSlotData[];
}
export interface KnockoutPlacement {
  entryId: string;
  teamName: string;
  rank: number;
  tied: boolean;
}
export interface KnockoutBracket {
  algorithmVersion: 'SE_SEEDED_V1';
  sourceHash: string;
  asOf: string;
  participantCount: number;
  totalMatchCount: number;
  publishedMatchCount: number;
  confirmedMatchCount: number;
  resolvedMatchCount?: number;
  adjudicatedMatchCount?: number;
  cancelledMatchCount?: number;
  isComplete: boolean;
  rounds: KnockoutRoundData[];
  /** Only populated after every required final-round game is independently confirmed. */
  placements: KnockoutPlacement[];
  nextRound: {
    roundNo: number;
    sourceHash: string;
    sources: KnockoutSource[];
    fixtures: ScheduleFixtureData[];
  } | null;
}
export interface EventKnockoutData {
  event: EventData;
  publicationId: string | null;
  participants: ScheduleParticipant[];
  bracket: KnockoutBracket | null;
  capabilities: { canPublishNextRound: boolean };
}
export interface PublishKnockoutRoundInput {
  type: 'PUBLISH_ROUND';
  expectedEventVersion: number;
  expectedSourceHash: string;
  roundNo: number;
  reason: string;
  allocations: { fixtureKey: string; courtId: string; startsAt: string }[];
}
export interface PublicKnockoutData {
  publicEventId: string;
  algorithmVersion: 'SE_SEEDED_V1';
  sourceHash: string;
  asOf: string;
  participantCount: number;
  totalMatchCount: number;
  publishedMatchCount: number;
  confirmedMatchCount: number;
  resolvedMatchCount?: number;
  adjudicatedMatchCount?: number;
  cancelledMatchCount?: number;
  isComplete: boolean;
  rounds: {
    roundNo: number;
    label: string;
    published: boolean;
    slots: {
      kind?: 'CHAMPIONSHIP' | 'THIRD_PLACE';
      adjudication?: { kind: 'FORFEIT' | 'CANCELLED' };
      sourceOutcome?: 'WINNER' | 'LOSER';
      positionNo: number;
      home: PublicTeamData | null;
      away: PublicTeamData | null;
      bye: PublicTeamData | null;
      publicMatchId: string | null;
      status: MatchStatus | 'WAITING' | 'BYE';
      winner: PublicTeamData | null;
    }[];
  }[];
  placements: { team: PublicTeamData; rank: number; tied: boolean }[];
}

export type * from './group-knockout.js';
export type * from './wechat.js';
export type * from './media.js';
export type * from './commerce.js';
export * from './player-booking.js';
export * from './player-performance.js';
export type * from './directory.js';
export type * from './region-catalog.js';
export type * from './media-requests.js';
export type * from './team-membership.js';
export type * from './event-follows.js';
export type * from './private-seasons.js';

export type * from './participant-materials.js';
export type * from './scheduling-completion.js';
export type * from './professional-statistics.js';
export type * from './event-templates.js';

export type * from './match-exceptions.js';

export type * from './scoring-offline.js';

export type * from './recruitment.js';
export type * from './local-services.js';
export type * from './governance.js';

export type * from './knockout-optimization.js';
export type * from './public-archives.js';

// C19 private seasons and PRIVATE_SEASON data grants (§5); frozen in docs/design/C19_CONTRACTS.md.
// Owned by the module agent after the freeze; field changes are listed in its handoff.
// Privacy: no DTO carries another person's email or contact details; names come only from
// users.display_name, long-term member names and frozen roster names. No anonymous read exists.
import type { EventStatus } from './index.js';

// ---------- seasons ----------
export type SeasonStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export interface SeasonEventData {
  eventId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  attachedAt: string;
}
export interface SeasonData {
  id: string;
  orgId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: SeasonStatus;
  version: number;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Explicitly attached events (never inferred from dates). */
  events: SeasonEventData[];
  capabilities: {
    /** DRAFT/ACTIVE only: CLOSED locks name, dates and attachments. */
    canEdit: boolean;
    canActivate: boolean;
    canClose: boolean;
  };
}
/** Detail adds the organization's events that could be attached now (in range, unattached). */
export interface SeasonDetailData extends SeasonData {
  candidates: Omit<SeasonEventData, 'attachedAt'>[];
  candidateNextCursor?: string | null;
}
export interface CreateSeasonInput {
  /** UUID v4 chosen before the first send; a replay returns the same season. */
  clientRequestId: string;
  /** 1–80 characters after trimming. */
  name: string;
  startDate: string;
  /** At most 731 days after startDate. */
  endDate: string;
}
export interface UpdateSeasonInput {
  expectedVersion: number;
  name?: string;
  startDate?: string;
  endDate?: string;
}
export type SeasonCommandType = 'ACTIVATE' | 'CLOSE' | 'ATTACH_EVENT' | 'DETACH_EVENT';
export interface SeasonCommandInput {
  type: SeasonCommandType;
  /** Required for ATTACH_EVENT / DETACH_EVENT only. */
  eventId?: string;
  expectedVersion: number;
}

// ---------- PRIVATE_SEASON grants ----------
export type SeasonGrantStatus = 'PENDING' | 'ACTIVE' | 'DECLINED' | 'WITHDRAWN' | 'REVOKED';
/** Why a grant is currently not counted; evaluated on every read. */
export type SeasonGrantIneffectiveReason =
  | 'NOT_CONSENTED'
  | 'TERMINATED'
  | 'BINDING_ENDED'
  | 'NOMINATOR_UNAUTHORIZED'
  | 'SOURCE_NOT_FROZEN'
  | 'TARGET_INACTIVE'
  | 'ORGANIZATION_INACTIVE';
export interface SeasonGrantSeasonRef {
  id: string;
  name: string;
  status: SeasonStatus;
}
export interface SeasonDataGrantData {
  id: string;
  purpose: 'PRIVATE_SEASON';
  orgId: string;
  orgName: string;
  eventId: string;
  eventName: string;
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
  targetUserId: string;
  targetDisplayName: string;
  nominatedByDisplayName: string;
  status: SeasonGrantStatus;
  version: number;
  nominateReason: string;
  withdrawReason: string | null;
  createdAt: string;
  consentedAt: string | null;
  declinedAt: string | null;
  revokedAt: string | null;
  withdrawnAt: string | null;
  /** ACTIVE and every current condition holds: only then can the source enter an aggregate. */
  effective: boolean;
  /** Permanent upstream invalidation; restoring access never revives the old consent. */
  invalidatedAt?: string | null;
  invalidationReason?: SeasonGrantIneffectiveReason | null;
  ineffectiveReasons: SeasonGrantIneffectiveReason[];
  /** The season the event is currently attached to (players never see a DRAFT season). */
  season: SeasonGrantSeasonRef | null;
  capabilities: {
    canConsent: boolean;
    canDecline: boolean;
    canRevoke: boolean;
    canWithdraw: boolean;
  };
}
/** Shown on the consent screen: scope, readers, metric definition and how to revoke. */
export interface SeasonGrantDisclosure {
  purpose: string;
  scope: string;
  readers: string;
  metrics: string;
  revocation: string;
  independence: string;
}
export interface MySeasonDataGrantsData {
  grants: SeasonDataGrantData[];
  /** True when another keyset page exists; earlier grants remain reachable for revocation. */
  truncated: boolean;
  nextCursor?: string | null;
  disclosure: SeasonGrantDisclosure;
}
export interface SeasonGrantSourceMember {
  memberId: string;
  name: string;
  jerseyNo: string;
  /** The current active binding of this long-term member, if any. */
  binding: { bindingId: string; userId: string; displayName: string } | null;
}
export interface EventSeasonGrantsData {
  event: {
    id: string;
    orgId: string;
    name: string;
    startDate: string;
    endDate: string;
    status: EventStatus;
  };
  season: SeasonGrantSeasonRef | null;
  /** Frozen registration roster of the event; empty before the freeze. */
  frozen: boolean;
  sources: { teamId: string; teamName: string; members: SeasonGrantSourceMember[] }[];
  grants: SeasonDataGrantData[];
  nextCursor?: string | null;
  disclosure: SeasonGrantDisclosure;
}
export interface NominateSeasonGrantInput {
  clientRequestId: string;
  teamId: string;
  memberId: string;
  targetUserId: string;
  /** 4–500 characters after trimming. */
  reason: string;
}
export interface WithdrawSeasonGrantInput {
  reason: string;
  expectedVersion: number;
}
export interface SeasonGrantCommandInput {
  type: 'CONSENT' | 'DECLINE' | 'REVOKE';
  expectedVersion: number;
}

// ---------- statistics ----------
export type SeasonEventCoverageState = 'INCLUDED' | 'NO_SCHEDULE' | 'INVALID' | 'OUT_OF_RANGE';
export interface SeasonEventCoverage {
  eventId: string;
  name: string;
  state: SeasonEventCoverageState;
  totalMatchCount: number;
  includedMatchCount: number;
  teamOnlyConfirmedMatchCount: number;
  pendingMatchCount: number;
  excludedAdministrativeMatchCount?: number;
  recordableMatchCount?: number;
  coverageComplete: boolean;
  attributionComplete: boolean;
}
export interface SeasonPlayerSource {
  eventId: string;
  eventName: string;
  teamName: string;
  memberName: string;
  jerseyNo: string;
  score: number;
  fouls: number;
  rosterSampleMatchCount: number;
}
export interface SeasonPlayerRow {
  userId: string;
  displayName: string;
  score: number;
  fouls: number;
  /** Matches in which the player was on a frozen roster with a confirmed per-player sample. */
  rosterSampleMatchCount: number;
  eventCount: number;
  rank: number;
  tied: boolean;
  sources: SeasonPlayerSource[];
  /** Never collected by this product: always null and shown as “未统计”. */
  rebounds: null;
  assists: null;
  minutesPlayed: null;
}
export interface SeasonStatisticsSummary {
  algorithmVersion: 'SEASON_PRIVATE_BASIC_V1';
  /** Covers the season version, the attached event set, effective grants and confirmed sources. */
  sourceHash: string;
  asOf: string;
  seasonVersion: number;
  events: SeasonEventCoverage[];
  effectiveGrantCount: number;
  /** Every counted event is fully confirmed per player with no unattributed points. */
  rankingComplete: boolean;
  rows: SeasonPlayerRow[];
  notCollected: ('REBOUNDS' | 'ASSISTS' | 'MINUTES')[];
}
export interface SeasonStatisticsData {
  season: SeasonData;
  summary: SeasonStatisticsSummary;
}
export interface MySeasonStatisticsData {
  season: {
    id: string;
    orgId: string;
    orgName: string;
    name: string;
    startDate: string;
    endDate: string;
    status: SeasonStatus;
  };
  /** rows has at most the viewer's own row; events only those of the viewer's grants. */
  summary: SeasonStatisticsSummary;
}

// C19 team requests, join codes, member bindings and claims (§3); frozen in docs/design/C19_CONTRACTS.md.
// Owned by the module agent after the freeze; field changes are listed in its handoff.
// No DTO here carries another person's email, contact details or other teams: only
// users.display_name and long-term member names.

// ---------- §3.1 team request share links and requests ----------
export type TeamRequestLinkStatus = 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'REVOKED';
export interface TeamRequestLinkData {
  id: string;
  orgId: string;
  status: TeamRequestLinkStatus;
  reason: string;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}
export interface CreateTeamRequestLinkInput {
  /** 1–168. */
  expiresInHours: number;
  /** 1–200. */
  maxUses: number;
  /** 4–500 characters after trimming. */
  reason: string;
}
/** The token is returned once, never stored in clear and never readable again. */
export interface IssuedTeamRequestLinkData {
  link: TeamRequestLinkData;
  /** 128-bit random, base64url (22 characters). */
  token: string;
}
export interface ResolvedTeamRequestLinkData {
  linkId: string;
  orgName: string;
  expiresAt: string;
}
export type TeamRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export interface SubmitTeamRequestInput {
  token: string;
  /** UUID v4 chosen by the client before the first send; reused for recovery. */
  clientRequestId: string;
  teamName: string;
  note?: string | null;
}
export interface TeamRequestData {
  id: string;
  clientRequestId: string;
  orgId: string;
  orgName: string;
  teamName: string;
  note: string | null;
  status: TeamRequestStatus;
  version: number;
  reviewReason: string | null;
  reviewedAt: string | null;
  withdrawnAt: string | null;
  /** Only when APPROVED: the created team, managed by the applicant. */
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: { canWithdraw: boolean };
}
/** Organization view: the applicant is identified by display name only. */
export interface OrgTeamRequestData extends Omit<
  TeamRequestData,
  'clientRequestId' | 'capabilities'
> {
  requesterDisplayName: string;
  capabilities: { canReview: boolean; isOwnRequest: boolean };
}
export interface WithdrawTeamRequestInput {
  expectedVersion: number;
}
export interface ReviewTeamRequestInput {
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  expectedVersion: number;
}

// ---------- §3.2 join codes, bindings, claims ----------
export type TeamJoinCodeStatus = 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'REVOKED' | 'ISSUER_INVALID';
export interface TeamJoinCodeData {
  id: string;
  teamId: string;
  status: TeamJoinCodeStatus;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  issuedByDisplayName: string;
}
export interface CreateTeamJoinCodeInput {
  /** 1–168, default 168 (7 days). */
  expiresInHours?: number;
  /** 1–30, default 30. */
  maxUses?: number;
}
export interface IssuedTeamJoinCodeData {
  joinCode: TeamJoinCodeData;
  /** 128-bit random, RFC 4648 Base32 without padding (26 characters); shown once. */
  code: string;
}
export interface JoinTeamInput {
  /** Base32; case, spaces and hyphens are ignored. */
  code: string;
  /** The name on the team's long-term member list (1–80). */
  displayName: string;
}
export type MemberBindingStatus = 'ACTIVE' | 'ENDED';
export type MemberBindingEndedReason = 'LEFT' | 'REMOVED' | 'MEMBER_REMOVED';
export type MemberBindingSource = 'JOIN_CODE' | 'CLAIM';
/** GET /v1/me/memberships, POST /v1/team-joins: the caller's own binding. */
export interface MembershipData {
  bindingId: string;
  orgId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
  source: MemberBindingSource;
  status: MemberBindingStatus;
  endedReason: MemberBindingEndedReason | null;
  createdAt: string;
  endedAt: string | null;
}
export interface MembershipTeamData {
  bindingId: string;
  organizationName: string;
  teamName: string;
  /** Current long-term member names only; never account identities. */
  members: { memberId: string; name: string; isSelf: boolean }[];
  myBinding: MembershipData;
}
/** Leader view: member name, bound account display name and binding status only. */
export interface TeamMemberBindingData {
  bindingId: string;
  memberId: string;
  memberName: string;
  accountDisplayName: string;
  source: MemberBindingSource;
  status: MemberBindingStatus;
  endedReason: MemberBindingEndedReason | null;
  createdAt: string;
  endedAt: string | null;
}
export type TeamMemberClaimStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
export interface TeamMemberClaimData {
  claimId: string;
  memberId: string;
  memberName: string;
  targetDisplayName: string;
  status: TeamMemberClaimStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}
export interface TeamMemberBindingsData {
  teamId: string;
  teamName: string;
  /** Latest 100 bindings, active first; ended rows are history. */
  bindings: TeamMemberBindingData[];
  /** Latest 50 claims. */
  claims: TeamMemberClaimData[];
  /** ACTIVE long-term members without an active binding or pending claim (claim targets). */
  claimableMembers: { memberId: string; name: string }[];
}
export interface RemoveMemberBindingInput {
  reason: string;
}
export interface CreateMemberClaimInput {
  targetUserId: string;
}
/** GET /v1/me/member-claims: what the target account sees before accepting. */
export interface MyMemberClaimData {
  claimId: string;
  organizationName: string;
  teamName: string;
  memberName: string;
  status: TeamMemberClaimStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}

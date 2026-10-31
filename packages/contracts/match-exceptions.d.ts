/** X02: administrative results are distinct from recorded basketball scores. */
export type MatchExceptionKind = 'FORFEIT' | 'CANCELLED';
export type MatchExceptionOperation = 'DECLARE' | 'REVOKE';
export interface MatchExceptionRules {
  id: string;
  eventId: string;
  version: number;
  forfeitWinPoints: number;
  forfeitLossPoints: number;
  cancellationPolicy: 'EXCLUDE_FROM_TABLE';
}
export interface MatchExceptionRequest {
  id: string;
  matchId: string;
  version: number;
  operation: MatchExceptionOperation;
  kind: MatchExceptionKind;
  forfeitingSide: 'HOME' | 'AWAY' | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  sourceMatchVersion: number;
  sourceHeadVersion: number;
  targetAdjudicationId: string | null;
  winnerEntryId: string | null;
  loserEntryId: string | null;
  rulesId: string;
  rulesVersion: number;
  proposedBy: string;
  reason: string;
  reviewedBy: string | null;
  reviewReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}
export interface MatchExceptionWorkbench {
  event: { id: string; version: number; status: string };
  match: { id: string; version: number; status: string };
  rules: MatchExceptionRules | null;
  active: MatchExceptionRequest | null;
  requests: MatchExceptionRequest[];
  capabilities: { canPropose: boolean; canReview: boolean; canRevoke: boolean };
}
/** Never use an adjudication ID in confirmationId, and never manufacture home/away scores. */
export interface AdministrativeMatchSource {
  kind: 'ADJUDICATION';
  fixtureKey: string;
  matchId: string;
  adjudicationId: string;
  adjudicationVersion: number;
  matchVersion: number;
  winnerEntryId: string;
  loserEntryId: string;
}
export interface AdministrativeMatchOutcome {
  kind: MatchExceptionKind;
  adjudicationId: string;
  adjudicationVersion: number;
  winnerEntryId: string | null;
  loserEntryId: string | null;
  homeLeaguePoints: number | null;
  awayLeaguePoints: number | null;
  /** Administrative wins/cancellations contribute no recorded player statistics. */
  contributesRecordedStatistics: false;
  source: AdministrativeMatchSource | null;
}

/** Group cancellations are resolved for the table but can never advance a knockout contestant. */
export interface AdministrativeCancellationSource {
  kind: 'CANCELLATION';
  fixtureKey: string;
  matchId: string;
  adjudicationId: string;
  adjudicationVersion: number;
  matchVersion: number;
  winnerEntryId: null;
  loserEntryId: null;
}
export type GroupResultSource = import('./index.js').KnockoutSource;

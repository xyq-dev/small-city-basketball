/** C06 reservation records. Monetary fields are integer CNY fen; no payment provider is enabled. */
export type BookingScope = 'SINGLE' | 'MULTI' | 'TOURNAMENT' | 'SEASON' | 'TIME_BLOCK';
export type BookingPosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type BookingProfileStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
export type BookingAppearanceStatus =
  | 'CONDITIONAL'
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'ARRIVED'
  | 'COMPLETED'
  | 'DISPUTED';
export interface BookingWindow {
  startAt: string;
  endAt: string;
}
export interface BookingPlayerData {
  id: string;
  userId: string;
  displayName: string;
  position: BookingPosition;
  heightCm: number;
  city: string;
  bio: string;
  priceFen: number;
  travelFen: number;
  accommodationFen: number;
  availability: BookingWindow[];
  version: number;
  status: BookingProfileStatus;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BookingProfileInput {
  commandId: string;
  expectedVersion: number;
  displayName: string;
  position: BookingPosition;
  heightCm: number;
  city: string;
  bio: string;
  priceFen: number;
  travelFen: number;
  accommodationFen?: number;
  availability: BookingWindow[];
  adultConfirmed: true;
}
export interface BookingAppearanceInput {
  profileId: string;
  matchId?: string;
  label: string;
  conditionText?: string;
  reportAt?: string;
  startAt?: string;
  endAt?: string;
  venue: string;
  /** CONDITION records never hold a calendar slot until explicit activation. */
  conditional: boolean;
}
export interface BookingCreateInput {
  acceptedTermsIds?: Record<string, string>;
  chargeConsent?: true;
  reviewedSettingsVersion: number;
  reviewedProfileVersions: Record<string, number>;
  commandId: string;
  orgId: string;
  teamId: string;
  eventId?: string;
  eventName: string;
  scope: BookingScope;
  eligibilityConfirmed: true;
  appearances: BookingAppearanceInput[];
}
export interface BookingChangeData {
  proposedByUserId: string;
  proposedByRole: 'BUYER' | 'PLAYER';
  reportAt: string;
  startAt: string;
  endAt: string;
  venue: string;
  reason: string;
  createdAt: string;
}
export interface BookingAppearanceData {
  id: string;
  orderId: string;
  profileId: string;
  playerUserId: string;
  playerName: string;
  position: BookingPosition;
  label: string;
  conditionText: string | null;
  status: BookingAppearanceStatus;
  scheduleChanged: boolean;
  version: number;
  matchId: string | null;
  reportAt: string | null;
  startAt: string | null;
  endAt: string | null;
  venue: string;
  serviceFen: number;
  travelFen: number;
  accommodationFen: number;
  bufferMinutes: 30;
  platformFeeFen: number;
  totalFen: number;
  paymentStatus: 'UNAVAILABLE';
  settlementStatus: 'BLOCKED';
  expiresAt: string | null;
  acceptedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  changeRequest: BookingChangeData | null;
  capabilities: {
    canAccept: boolean;
    canDecline: boolean;
    canCancel: boolean;
    canActivate: boolean;
    canProposeChange: boolean;
    canAcceptChange: boolean;
    canRejectChange: boolean;
    canArrive: boolean;
    canComplete: boolean;
    canDispute: boolean;
    canResolveDispute: boolean;
  };
}
export interface BookingOrderData {
  id: string;
  orgId: string;
  teamId: string;
  eventId: string | null;
  eventName: string;
  teamName: string;
  buyerUserId: string;
  scope: BookingScope;
  eligibilityStatus: 'DECLARED_NOT_VERIFIED';
  eligibilityNotice: string;
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  version: number;
  feeBps: number;
  settingsVersion: number;
  createdAt: string;
  updatedAt: string;
  appearances: BookingAppearanceData[];
  totals: {
    confirmedServiceFen: number;
    confirmedPlatformFeeFen: number;
    confirmedTravelFen: number;
    confirmedAccommodationFen: number;
    confirmedTotalFen: number;
    conditionalTotalFen: number;
    paidFen: 0;
    settledFen: 0;
    refundedFen: 0;
  };
}
export type BookingCommandType =
  | 'ACCEPT'
  | 'DECLINE'
  | 'CANCEL'
  | 'ACTIVATE'
  | 'PROPOSE_CHANGE'
  | 'ACCEPT_CHANGE'
  | 'REJECT_CHANGE'
  | 'ARRIVE'
  | 'COMPLETE'
  | 'DISPUTE'
  | 'RESOLVE_DISPUTE';
export interface BookingCommandInput {
  commandId: string;
  expectedVersion: number;
  type: BookingCommandType;
  appearanceId: string;
  reason?: string;
  reportAt?: string;
  startAt?: string;
  endAt?: string;
  venue?: string;
  eligibilityConfirmed?: true;
  resolution?: 'RESUME' | 'CANCEL' | 'COMPLETE';
}
export interface BookingSettingsData {
  feeBps: number;
  version: number;
}
export interface BookingWorkspaceData {
  viewerUserId: string;
  isPlatformOperator: boolean;
  paymentAvailable: false;
  paymentNotice: string;
  settings: BookingSettingsData;
  players: BookingPlayerData[];
  ownProfile: BookingPlayerData | null;
  reviewQueue: BookingPlayerData[];
  teams: { id: string; orgId: string; name: string }[];
  events: { id: string; orgId: string; name: string; status: string }[];
  matches: {
    id: string;
    orgId: string;
    eventId: string;
    homeTeamId: string;
    awayTeamId: string;
    label: string;
    startAt: string;
    endAt: string;
    venue: string;
  }[];
  orders: BookingOrderData[];
  ordersHasMore: boolean;
  statistics: {
    orders: number;
    completedAppearances: number;
    quotedPlatformFeeFen: number;
    collectedPlatformFeeFen: 0;
    settledPlayerFen: 0;
  };
}

import type { LocalPoint, LocalRegion } from './local-services.js';

export type DispatchKind = 'REFEREE' | 'SCORER' | 'RECORDER' | 'STREAMER' | 'PHOTOGRAPHER';
export type DispatchRequestStatus =
  | 'DRAFT'
  | 'INVITING'
  | 'PAUSED'
  | 'REVIEWING'
  | 'NEEDS_MANUAL'
  | 'SOURCE_REQUESTED'
  | 'SOURCE_CONFIRMED'
  | 'SOURCE_ENDED'
  | 'CANCELLED'
  | 'EXPIRED';
export type DispatchOfferStatus =
  | 'PENDING'
  | 'TRAVEL_REVIEW'
  | 'READY'
  | 'ACCEPTED_HELD'
  | 'CONVERTED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'EXPIRED'
  | 'SUPERSEDED';
export interface DispatchMoney {
  serviceMinor: number;
  travelMinor: number;
  lodgingMinor: number;
  platformMinor: number;
  totalMinor: number;
}
export interface DispatchQuote extends DispatchMoney {
  slotId: string;
  departureAt: string;
  arrivalAt: string;
  returnAt: string;
  protectedStartsAt: string;
  protectedEndsAt: string;
  travelMethod: string;
  travelEvidence: string;
  terms: string;
  hash: string;
  baseTermsId?: string | null;
  baseTermsVersion?: number | null;
  merchantKey?: string | null;
}
export interface DispatchRequestData {
  id: string;
  orgId: string;
  kind: DispatchKind;
  status: DispatchRequestStatus;
  version: number;
  serviceRegion: LocalRegion;
  serviceAddress: string;
  servicePoint: LocalPoint | null;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  budget: DispatchMoney;
  inviteRegionIds: string[];
  batchCount: number;
  maxBatches: number;
  batchSize: number;
  sourceBookingId: string | null;
  winnerOfferId: string | null;
  reason: string | null;
  canManage: boolean;
  canConfirm: boolean;
}
export interface DispatchOfferData {
  id: string;
  requestId: string;
  listingId: string;
  listingTitle: string;
  status: DispatchOfferStatus;
  version: number;
  expiresAt: string;
  quote: DispatchQuote | null;
  quoteHash: string | null;
  travelVerified: boolean;
  locationVisible: boolean;
  holdExpiresAt: string | null;
  sourceBookingId: string | null;
  canQuote: boolean;
  canReviewTravel: boolean;
  canAccept: boolean;
  canWithdraw: boolean;
  request: DispatchRequestData;
}
export interface DispatchCapabilities {
  enabled: boolean;
  conversionEnabled: boolean;
  maxBatches: number;
  batchSize: number;
  holdMinutes: number;
  externalNotifications: false;
}

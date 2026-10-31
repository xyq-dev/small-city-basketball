export type LocalServiceKind =
  'COURT' | 'REFEREE' | 'SCORER' | 'RECORDER' | 'STREAMER' | 'PHOTOGRAPHER' | 'MEDIC';
export type LocalListingStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type LocalBookingStatus =
  | 'HELD'
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'DISPUTED';
export interface LocalRegion {
  catalogVersion: string;
  regionId: string;
}
export interface LocalPoint {
  latitude: number;
  longitude: number;
  coordinateSystem: 'GCJ02';
}
export interface LocalListingData {
  id: string;
  kind: LocalServiceKind;
  title: string;
  description: string;
  address: string;
  region: LocalRegion;
  point: LocalPoint | null;
  coverageRegionIds: string[];
  status: LocalListingStatus;
  version: number;
  providerConfirmed: boolean;
  qualifiedUntil: string | null;
  published: boolean;
  organizationName: string;
  distanceMeters: number | null;
  distanceLabel: string | null;
  qualificationNote?: string;
  reviewReason?: string | null;
  providerUserId?: string;
  courtId?: string | null;
}
export interface LocalSlotData {
  id: string;
  listingId: string;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'CLOSED';
  version: number;
  available: boolean;
}
export interface LocalBookingData {
  id: string;
  listingId: string;
  slotId: string;
  status: LocalBookingStatus;
  version: number;
  startsAt: string;
  endsAt: string;
  holdExpiresAt: string | null;
  title: string;
  kind: LocalServiceKind;
  address: string;
  location: LocalPoint | null;
  terms: string;
  reason: string | null;
  change: {
    slotId: string;
    proposedBy: string;
    reason: string;
    startsAt: string;
    endsAt: string;
  } | null;
  paymentStatus: 'NOT_ENABLED';
  canActAs: 'BUYER' | 'PROVIDER' | 'ADMIN';
}
export interface LocalMatchupData {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeOrgId: string;
  awayOrgId: string;
  courtId: string;
  courtOrgId: string;
  startsAt: string;
  endsAt: string;
  address: string;
  terms: string;
  status: 'OPEN' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'COMPLETED';
  version: number;
  homeConfirmed: boolean;
  awayConfirmed: boolean;
  canConfirm: boolean;
}
export interface LocalLocationCandidate {
  title: string;
  address: string;
  point: LocalPoint;
  sourceCode: string | null;
  source: 'TENCENT';
  kind: 'PLACE' | 'REVERSE';
  region?: LocalRegion;
  regionLabel?: string;
}

/** C18 public event directory: explicit, audited listing of a current public publication. */
import type { EventStatus } from './index.js';
import type { RegionSelection } from './region-catalog.js';

/** Derived only from event status and publication purpose; never guessed from dates. */
export type DirectoryGroup = 'LIVE' | 'UPCOMING' | 'HISTORY';
export type DirectoryRevokeSource = 'UNLIST' | 'PUBLICATION_REVOKED' | 'ORGANIZATION_DISABLED';

/** Anonymous whitelist: no internal ids, operators, reasons, rosters or contacts. */
export interface PublicDirectoryEventData {
  publicEventId: string;
  name: string;
  startDate: string;
  endDate: string;
  venueName: string | null;
  status: EventStatus;
  purpose: 'LIVE' | 'HISTORY';
  displayCity: string | null;
}

export interface EventDirectoryListingData {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  publicEventId: string;
  displayCity: string | null;
  listedAt: string;
  region: RegionSelection | null;
  revokedAt: string | null;
  revokeSource: DirectoryRevokeSource | null;
}

/** Private, for the organizer page to re-check state before and after a command. */
export interface EventDirectoryData {
  event: { id: string; status: EventStatus; version: number };
  publication: {
    publicEventId: string;
    purpose: 'LIVE' | 'HISTORY';
    status: 'ACTIVE' | 'REVOKED';
  } | null;
  /** The ACTIVE listing, if any. */
  listing: EventDirectoryListingData | null;
  /** The most recent listing when none is ACTIVE (for explaining an automatic withdrawal). */
  lastListing: EventDirectoryListingData | null;
  /** The group the event would be listed under now, or null when it cannot be listed. */
  group: DirectoryGroup | null;
  regionCatalogVersion: string;
  capabilities: { canList: boolean; canUnlist: boolean; canReplaceRegion: boolean };
}

export interface DirectoryCommandInput {
  type: 'LIST' | 'UNLIST' | 'REPLACE_REGION';
  expectedEventVersion: number;
  /** LIST only: trimmed 1–20 characters of Chinese, letters, digits, spaces and "·". */
  displayCity?: string | null;
  /** LIST or REPLACE_REGION; mutually exclusive with displayCity. */
  region?: RegionSelection;
  /** Required only when replacing an active listing's region. */
  expectedListingId?: string;
  /** 4–500 characters after trimming. */
  reason: string;
}

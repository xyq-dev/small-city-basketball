import type { Pool } from 'pg';
import type { RestoreOwnership } from '../db/common.mjs';
export function quarantineRestoredDatabase(input: {
  pool: Pool;
  ownership: RestoreOwnership;
}): Promise<{
  status: 'quarantined';
  systemUserId: string;
  counts: {
    sessionsRevoked: number;
    platformOperatorsDisabled: number;
    wechatIdentitiesRevoked: number;
    wechatChallengesRemoved: number;
    pendingInvitationsRevoked: number;
    publicPublicationsRevoked: number;
    overlayGrantsRevoked: number;
    activeLeasesExpired: number;
    organizationsDisabled: number;
    eventsTouched: number;
  };
}>;

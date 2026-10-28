// C19 event follows (§4); frozen in docs/design/C19_CONTRACTS.md.
// Owned by the module agent after the freeze; field changes are listed in its handoff.
import type { EventStatus } from './index.js';

/**
 * ACTIVE: the follow is live and its publication is publicly readable right now.
 * INVALID: the follow was not cancelled, but its publication is no longer publicly readable
 * (revoked, organization disabled, or event status no longer matches the purpose). Derived on
 * every read; a later publication (new public key) never revives it.
 * CANCELLED: the owner cancelled it.
 */
export type FollowStatus = 'ACTIVE' | 'INVALID' | 'CANCELLED';

/** Public whitelist of the followed event; only present while the follow is ACTIVE. */
export interface FollowEventSummary {
  name: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  purpose: 'LIVE' | 'HISTORY';
}

export interface FollowData {
  followId: string;
  publicEventId: string;
  status: FollowStatus;
  /** null when INVALID or CANCELLED: withdrawn details are never returned. */
  event: FollowEventSummary | null;
  createdAt: string;
  cancelledAt: string | null;
  /**
   * Additive (C19 handoff): WeChat subscription reminders are not implemented in this round,
   * so a successful follow never implies a reminder. Always 'NOT_ENABLED'.
   */
  wechatReminder: 'NOT_ENABLED';
}

export interface FollowEventInput {
  publicEventId: string;
}

/** GET /v1/me/follows meta: ACTIVE and INVALID follows of the signed-in account, newest first. */
export interface FollowListMeta {
  requestId: string;
  nextCursor: string | null;
}

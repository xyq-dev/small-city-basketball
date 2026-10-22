/** Conservatively include the entire request round trip; a grant can never gain time. */
export function grantDeadline(
  sentAt: number,
  expiresAt: string,
  serverTime: string,
  previous = Infinity,
) {
  return Math.min(previous, sentAt + Math.max(0, Date.parse(expiresAt) - Date.parse(serverTime)));
}
export const SNAPSHOT_STALE_MS = 30_000;
export const SOURCE_POLL_MS = 2_000;
export const SOURCE_TIMEOUT_MS = 8_000;

/** Anchor against response server time rather than the browser's wall clock or timezone. */
export function clockRemaining(
  clock: { remainingMs: number; running: boolean; anchorServerTime: string },
  serverTime: string,
  elapsedSinceResponse: number,
) {
  if (!clock.running) return Math.max(0, clock.remainingMs);
  const alreadyElapsed = Math.max(0, Date.parse(serverTime) - Date.parse(clock.anchorServerTime));
  return Math.max(0, clock.remainingMs - alreadyElapsed - Math.max(0, elapsedSinceResponse));
}
export function clockLabel(milliseconds: number) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

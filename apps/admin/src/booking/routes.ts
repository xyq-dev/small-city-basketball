/** Kept dependency-free so normal workspaces and login never load booking UI or demo state. */
export function isBookingPath(path: string) {
  return /^\/(players|player-bookings|player-center|player-bookings-admin)(\/|$)/.test(path);
}

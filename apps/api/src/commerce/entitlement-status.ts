import type { EventEntitlementData } from '@small-city-basketball/contracts';

interface EntitlementStatusInput {
  revokedAt: unknown;
  activated: unknown;
  orderStatus: unknown;
  validUntil: unknown;
  statusCheckedAt: unknown;
}

function databaseTime(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  const offsetMinutes = offset
    ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1)
    : 0;
  // Date.parse normalizes impossible dates such as February 30; those are not database facts.
  const wallTime = new Date(time + offsetMinutes * 60_000).toISOString();
  return wallTime.slice(0, 19) === value.slice(0, 19) ? time : null;
}

/** Read-only display projection, never a replacement for the locked activation checks. */
export function entitlementActivationStatus(
  input: EntitlementStatusInput,
): NonNullable<EventEntitlementData['activationStatus']> {
  if (input.revokedAt !== null)
    return databaseTime(input.revokedAt) === null ? 'UNAVAILABLE' : 'REVOKED';
  // An existing activation preserves the running event even after its activation deadline.
  if (input.activated === true) return 'ACTIVATED';
  if (input.activated !== false) return 'UNAVAILABLE';
  if (input.orderStatus === 'REFUND_PENDING') return 'REFUND_PENDING';
  if (input.orderStatus !== 'PAID') return 'UNAVAILABLE';
  const deadline = databaseTime(input.validUntil);
  const checkedAt = databaseTime(input.statusCheckedAt);
  if (deadline === null || checkedAt === null) return 'UNAVAILABLE';
  return deadline <= checkedAt ? 'EXPIRED' : 'READY';
}

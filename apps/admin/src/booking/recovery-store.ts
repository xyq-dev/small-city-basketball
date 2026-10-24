export interface BookingCreateRecovery {
  actorUserId: string;
  payload: string;
  uncertain: boolean;
  inFlight?: boolean;
  resolvedOrderId?: string;
  rejectedMessage?: string;
  persistenceWarning?: boolean;
}

type RecoveryMode = 'api' | 'demo';
export const MAX_BOOKING_RECOVERY_CHARS = 256 * 1024;
export const BOOKING_RECOVERY_STORAGE_PREFIX = 'scb.booking-create-recovery.v1:api:';
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = (value: RecordValue, required: string[], allowed = required) =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => allowed.includes(key));
const resource = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
const version = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2147483647;
const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  Array.from(value).length <= maximum &&
  !/[\u0000-\u001f\u007f]/.test(value);
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const hour = Number(match[4]),
    minute = Number(match[5]),
    second = Number(match[6] ?? 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59)
    return false;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  const offset = match[7]!;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))
    return false;
  return Number.isFinite(Date.parse(value));
}
function appearance(value: unknown): value is RecordValue {
  if (
    !object(value) ||
    !ownKeys(
      value,
      ['profileId', 'label', 'venue', 'conditional'],
      [
        'profileId',
        'matchId',
        'label',
        'conditionText',
        'reportAt',
        'startAt',
        'endAt',
        'venue',
        'conditional',
      ],
    ) ||
    !resource(value.profileId) ||
    !text(value.label, 80) ||
    !text(value.venue, 120) ||
    typeof value.conditional !== 'boolean'
  )
    return false;
  if (Object.hasOwn(value, 'matchId') && !resource(value.matchId)) return false;
  if (value.conditional ? !text(value.conditionText, 200) : Object.hasOwn(value, 'conditionText'))
    return false;
  const needsTimes =
    !value.conditional || ['reportAt', 'startAt', 'endAt'].some((key) => Object.hasOwn(value, key));
  return (
    !needsTimes ||
    (timestamp(value.reportAt) &&
      timestamp(value.startAt) &&
      timestamp(value.endAt) &&
      Date.parse(value.reportAt) <= Date.parse(value.startAt) &&
      Date.parse(value.startAt) < Date.parse(value.endAt))
  );
}
function payloadValid(serialized: unknown): serialized is string {
  if (typeof serialized !== 'string' || serialized.length > MAX_BOOKING_RECOVERY_CHARS)
    return false;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return false;
  }
  if (
    !object(value) ||
    !ownKeys(
      value,
      [
        'commandId',
        'orgId',
        'teamId',
        'eventName',
        'scope',
        'eligibilityConfirmed',
        'reviewedSettingsVersion',
        'reviewedProfileVersions',
        'appearances',
      ],
      [
        'commandId',
        'orgId',
        'teamId',
        'eventId',
        'eventName',
        'scope',
        'eligibilityConfirmed',
        'reviewedSettingsVersion',
        'reviewedProfileVersions',
        'appearances',
      ],
    ) ||
    !resource(value.commandId) ||
    !resource(value.orgId) ||
    !resource(value.teamId) ||
    !text(value.eventName, 80) ||
    !['SINGLE', 'MULTI', 'TOURNAMENT', 'SEASON', 'TIME_BLOCK'].includes(String(value.scope)) ||
    value.eligibilityConfirmed !== true ||
    !version(value.reviewedSettingsVersion) ||
    !object(value.reviewedProfileVersions) ||
    !Array.isArray(value.appearances) ||
    value.appearances.length < 1 ||
    value.appearances.length > 64 ||
    !value.appearances.every(appearance)
  )
    return false;
  if (Object.hasOwn(value, 'eventId') && !resource(value.eventId)) return false;
  const profiles = new Set(value.appearances.map((item) => String(item.profileId)));
  const versions = Object.entries(value.reviewedProfileVersions);
  if (
    versions.length !== profiles.size ||
    versions.length > 64 ||
    !versions.every(([id, v]) => resource(id) && profiles.has(id) && version(v))
  )
    return false;
  if (
    value.scope === 'SINGLE' &&
    (value.appearances.some((item) => item.conditional) ||
      new Set(
        value.appearances.map(
          (item) => `${item.reportAt}:${item.startAt}:${item.endAt}:${item.venue}`,
        ),
      ).size !== 1)
  )
    return false;
  return true;
}
function modeValid(mode: unknown): mode is RecoveryMode {
  return mode === 'api' || mode === 'demo';
}
const storageKey = (actor: string) =>
  `${BOOKING_RECOVERY_STORAGE_PREFIX}${encodeURIComponent(actor)}`;

/** A tab-local receipt recovery cache. It never sends requests or supplies authorization. */
export function createBookingRecoveryStore(
  storageProvider: () => Storage = () => globalThis.sessionStorage,
) {
  const memory = new Map<string, BookingCreateRecovery>();
  const invalid = new Map<string, boolean>();
  const key = (mode: RecoveryMode, actor: string) => `${mode}:${actor}`;
  return {
    load(
      mode: RecoveryMode,
      actor: string,
    ): { entry: BookingCreateRecovery | null; invalid: boolean; storageUnavailable: boolean } {
      if (!modeValid(mode) || !resource(actor))
        return { entry: null, invalid: true, storageUnavailable: false };
      const cached = memory.get(key(mode, actor));
      if (cached)
        return {
          entry: cached,
          invalid: invalid.has(key(mode, actor)),
          storageUnavailable:
            mode === 'api' &&
            (cached.persistenceWarning === true || invalid.get(key(mode, actor)) === true),
        };
      if (invalid.has(key(mode, actor)))
        return {
          entry: null,
          invalid: true,
          storageUnavailable: invalid.get(key(mode, actor)) === true,
        };
      if (mode === 'demo') return { entry: null, invalid: false, storageUnavailable: false };
      let stored: string | null;
      try {
        stored = storageProvider().getItem(storageKey(actor));
      } catch {
        return { entry: null, invalid: false, storageUnavailable: true };
      }
      if (stored === null) return { entry: null, invalid: false, storageUnavailable: false };
      let envelope: unknown;
      if (stored.length <= MAX_BOOKING_RECOVERY_CHARS) {
        try {
          envelope = JSON.parse(stored);
        } catch {
          /* Reject corrupt data below. */
        }
      }
      if (
        object(envelope) &&
        ownKeys(envelope, ['schemaVersion', 'mode', 'actorUserId', 'status']) &&
        envelope.schemaVersion === 1 &&
        envelope.mode === 'api' &&
        envelope.actorUserId === actor &&
        envelope.status === 'INVALID'
      ) {
        invalid.set(key(mode, actor), false);
        return { entry: null, invalid: true, storageUnavailable: false };
      }
      if (
        !object(envelope) ||
        !ownKeys(envelope, ['schemaVersion', 'mode', 'actorUserId', 'status', 'payload']) ||
        envelope.schemaVersion !== 1 ||
        envelope.mode !== 'api' ||
        envelope.status !== 'UNKNOWN' ||
        envelope.actorUserId !== actor ||
        !payloadValid(envelope.payload)
      ) {
        invalid.set(key(mode, actor), false);
        let unavailable = false;
        try {
          storageProvider().setItem(
            storageKey(actor),
            JSON.stringify({
              schemaVersion: 1,
              mode: 'api',
              actorUserId: actor,
              status: 'INVALID',
            }),
          );
        } catch {
          unavailable = true;
          invalid.set(key(mode, actor), true);
          try {
            storageProvider().removeItem(storageKey(actor));
          } catch {
            /* Keep the in-memory barrier when storage cannot replace or remove corrupt data. */
          }
        }
        return { entry: null, invalid: true, storageUnavailable: unavailable };
      }
      const entry: BookingCreateRecovery = {
        actorUserId: actor,
        payload: envelope.payload,
        uncertain: true,
        inFlight: false,
      };
      memory.set(key(mode, actor), entry);
      return { entry, invalid: false, storageUnavailable: false };
    },
    save(mode: RecoveryMode, entry: BookingCreateRecovery): boolean {
      if (!modeValid(mode) || !resource(entry.actorUserId)) {
        entry.persistenceWarning = true;
        return false;
      }
      memory.set(key(mode, entry.actorUserId), entry);
      if (mode === 'demo') return true;
      if (!payloadValid(entry.payload)) {
        entry.persistenceWarning = true;
        return false;
      }
      const serialized = JSON.stringify({
        schemaVersion: 1,
        mode: 'api',
        actorUserId: entry.actorUserId,
        status: 'UNKNOWN',
        payload: entry.payload,
      });
      try {
        if (serialized.length > MAX_BOOKING_RECOVERY_CHARS)
          throw new Error('Recovery snapshot exceeds size bound');
        storageProvider().setItem(storageKey(entry.actorUserId), serialized);
        entry.persistenceWarning = false;
        return true;
      } catch {
        entry.persistenceWarning = true;
        return false;
      }
    },
    acknowledgeInvalid(mode: RecoveryMode, actor: string): boolean {
      if (!modeValid(mode) || !resource(actor)) return false;
      if (!invalid.has(key(mode, actor))) return true;
      if (mode === 'api') {
        try {
          storageProvider().removeItem(storageKey(actor));
        } catch {
          invalid.set(key(mode, actor), true);
          return false;
        }
      }
      invalid.delete(key(mode, actor));
      return true;
    },
    discard(mode: RecoveryMode, entry: BookingCreateRecovery): void {
      if (
        !modeValid(mode) ||
        !resource(entry.actorUserId) ||
        memory.get(key(mode, entry.actorUserId)) !== entry
      )
        return;
      memory.delete(key(mode, entry.actorUserId));
      if (mode === 'api') {
        try {
          storageProvider().removeItem(storageKey(entry.actorUserId));
        } catch {
          /* The receipt remains safe to recover with its original envelope. */
        }
      }
    },
  };
}
export const bookingRecoveryStore = createBookingRecoveryStore();

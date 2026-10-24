const { id, validPayload } = require('./booking-form');
const PREFIX = 'scb.mini.booking-create.v1:';
const MAX_CHARS = 256 * 1024;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
  Object.keys(value).every((key) => keys.includes(key));
const absent = (value) => value === '' || value === undefined || value === null;
const storageKey = (actor) => PREFIX + actor.toLowerCase();
function terminalRejection(error, commandId) {
  return (
    !!error &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500 &&
    object(error.details) &&
    Object.prototype.hasOwnProperty.call(error.details, 'bookingCreateOutcome') &&
    Object.prototype.hasOwnProperty.call(error.details, 'commandId') &&
    error.details.bookingCreateOutcome === 'REJECTED' &&
    error.details.commandId === commandId
  );
}
function entryFor(actor, payload) {
  const entry = { inFlight: false, promise: null, persistenceWarning: false };
  Object.defineProperties(entry, {
    actorUserId: { value: actor, enumerable: true },
    payload: { value: payload, enumerable: true },
  });
  return entry;
}
/** Actor-keyed native recovery cache. It stores no credentials and never sends automatically. */
function createRecoveryStore(storageProvider = () => wx) {
  const memory = new Map();
  const invalid = new Map();
  const persist = (entry) => {
    const status = entry.resolvedOrderId
      ? 'RESOLVED'
      : entry.rejectedMessage
        ? 'REJECTED'
        : 'UNKNOWN';
    const envelope = {
      schemaVersion: 1,
      actorUserId: entry.actorUserId,
      status,
      payload: entry.payload,
      ...(status === 'RESOLVED' ? { orderId: entry.resolvedOrderId } : {}),
      ...(status === 'REJECTED' ? { message: entry.rejectedMessage } : {}),
    };
    try {
      const serialized = JSON.stringify(envelope);
      if (!validPayload(entry.payload) || serialized.length > MAX_CHARS)
        throw new Error('Invalid recovery envelope');
      storageProvider().setStorageSync(storageKey(entry.actorUserId), serialized);
      entry.persistenceWarning = false;
      return true;
    } catch {
      entry.persistenceWarning = true;
      return false;
    }
  };
  const store = {
    load(actor) {
      if (!id(actor)) return { entry: null, invalid: true, storageUnavailable: false };
      if (invalid.has(actor))
        return { entry: null, invalid: true, storageUnavailable: invalid.get(actor) };
      const cached = memory.get(actor);
      if (cached)
        return { entry: cached, invalid: false, storageUnavailable: cached.persistenceWarning };
      let raw;
      try {
        raw = storageProvider().getStorageSync(storageKey(actor));
      } catch {
        return { entry: null, invalid: false, storageUnavailable: true };
      }
      if (absent(raw)) return { entry: null, invalid: false, storageUnavailable: false };
      let envelope;
      if (typeof raw === 'string' && raw.length <= MAX_CHARS) {
        try {
          envelope = JSON.parse(raw);
        } catch {
          /* Handle corruption as a persistent barrier below. */
        }
      }
      if (
        exact(envelope, ['schemaVersion', 'actorUserId', 'status']) &&
        envelope.schemaVersion === 1 &&
        envelope.actorUserId === actor &&
        envelope.status === 'INVALID'
      ) {
        invalid.set(actor, false);
        return { entry: null, invalid: true, storageUnavailable: false };
      }
      const keys = ['schemaVersion', 'actorUserId', 'status', 'payload'];
      const status = envelope && envelope.status;
      if (status === 'RESOLVED') keys.push('orderId');
      if (status === 'REJECTED') keys.push('message');
      const good =
        exact(envelope, keys) &&
        envelope.schemaVersion === 1 &&
        envelope.actorUserId === actor &&
        ['UNKNOWN', 'RESOLVED', 'REJECTED'].includes(status) &&
        validPayload(envelope.payload) &&
        (status !== 'RESOLVED' || id(envelope.orderId)) &&
        (status !== 'REJECTED' ||
          (typeof envelope.message === 'string' &&
            envelope.message.length > 0 &&
            envelope.message.length <= 600));
      if (!good) {
        let unavailable = false;
        invalid.set(actor, false);
        try {
          storageProvider().setStorageSync(
            storageKey(actor),
            JSON.stringify({ schemaVersion: 1, actorUserId: actor, status: 'INVALID' }),
          );
        } catch {
          unavailable = true;
          invalid.set(actor, true);
          try {
            storageProvider().removeStorageSync(storageKey(actor));
          } catch {
            /* The in-memory barrier stays active. */
          }
        }
        return { entry: null, invalid: true, storageUnavailable: unavailable };
      }
      const entry = entryFor(actor, envelope.payload);
      if (status === 'RESOLVED') entry.resolvedOrderId = envelope.orderId;
      if (status === 'REJECTED') entry.rejectedMessage = envelope.message;
      memory.set(actor, entry);
      return { entry, invalid: false, storageUnavailable: false };
    },
    begin(actor, payload) {
      const current = store.load(actor);
      if (current.invalid || current.entry) throw new Error('还有原预约待核对，不能创建新请求');
      if (!id(actor) || !validPayload(payload)) throw new Error('预约恢复内容无效，未发送请求');
      const entry = entryFor(actor, payload);
      memory.set(actor, entry);
      persist(entry);
      return entry;
    },
    execute(actor, entry, send) {
      if (
        !id(actor) ||
        actor !== entry.actorUserId ||
        memory.get(actor) !== entry ||
        invalid.has(actor)
      )
        return Promise.reject(new Error('当前身份或原请求已变化，请重新核对'));
      if (entry.resolvedOrderId) return Promise.resolve({ id: entry.resolvedOrderId });
      if (entry.rejectedMessage)
        return Promise.reject({
          status: 409,
          code: 'ORIGINAL_CREATE_REJECTED',
          message: entry.rejectedMessage,
          details: {
            bookingCreateOutcome: 'REJECTED',
            commandId: JSON.parse(entry.payload).commandId,
          },
        });
      if (entry.promise) return entry.promise;
      entry.inFlight = true;
      persist(entry); // Persist the original bytes before dispatch, never an editable form snapshot.
      entry.promise = Promise.resolve()
        .then(() => send(JSON.parse(entry.payload)))
        .then((result) => {
          if (!result || !id(result.id))
            throw { code: 'INVALID_RESPONSE', message: '建单结果无效，请核对原预约' };
          entry.resolvedOrderId = result.id;
          persist(entry);
          return result;
        })
        .catch((error) => {
          if (terminalRejection(error, JSON.parse(entry.payload).commandId)) {
            entry.rejectedMessage = String(error.message || '原预约已明确拒绝').slice(0, 600);
          }
          persist(entry);
          throw error;
        })
        .finally(() => {
          entry.inFlight = false;
          entry.promise = null;
        });
      return entry.promise;
    },
    clear(actor, entry) {
      if (
        !id(actor) ||
        actor !== entry.actorUserId ||
        entry.inFlight ||
        (!entry.resolvedOrderId && !entry.rejectedMessage)
      )
        return false;
      const current = memory.get(actor);
      if (current && current !== entry) return false;
      // A second visible page may have shared the same promise after the first
      // page removed its final receipt. Never delete a different stored intent.
      if (!current) {
        try {
          return absent(storageProvider().getStorageSync(storageKey(actor)));
        } catch {
          return false;
        }
      }
      try {
        const storage = storageProvider();
        storage.removeStorageSync(storageKey(actor));
        if (!absent(storage.getStorageSync(storageKey(actor))))
          throw new Error('Recovery marker remains');
      } catch {
        entry.persistenceWarning = true;
        return false;
      }
      memory.delete(actor);
      return true;
    },
    acknowledgeInvalid(actor) {
      if (!id(actor) || !invalid.has(actor)) return false;
      try {
        const storage = storageProvider();
        storage.removeStorageSync(storageKey(actor));
        if (!absent(storage.getStorageSync(storageKey(actor))))
          throw new Error('Invalid marker remains');
      } catch {
        invalid.set(actor, true);
        return false;
      }
      invalid.delete(actor);
      return true;
    },
  };
  return store;
}
const recoveryStore = createRecoveryStore();
module.exports = { PREFIX, MAX_CHARS, terminalRejection, createRecoveryStore, recoveryStore };

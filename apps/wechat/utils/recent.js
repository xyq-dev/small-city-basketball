// Recently watched public events on this device. Only public, already-shared identities and
// display fields are kept; no private ids or account data. A revoked link is removed when
// the public read returns 404, and the list never asserts that an event is still public.
const KEY = 'scb.recentEvents.v1';
const MAX = 10;
const publicKey = /^[A-Za-z0-9_-]{43}$/;

function storage() {
  return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' ? wx : null;
}
function list() {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getStorageSync(KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (v) =>
          v &&
          publicKey.test(v.publicEventId) &&
          typeof v.name === 'string' &&
          v.name.length <= 200 &&
          Number.isFinite(v.openedAt),
      )
      .slice(0, MAX)
      .map((v) => ({
        publicEventId: v.publicEventId,
        name: v.name,
        dateLabel: typeof v.dateLabel === 'string' ? v.dateLabel.slice(0, 40) : '',
        openedAt: v.openedAt,
      }));
  } catch {
    return [];
  }
}
function save(items) {
  const s = storage();
  if (!s) return;
  try {
    s.setStorageSync(KEY, items.slice(0, MAX));
  } catch {
    /* Storage is a convenience; viewing never depends on it. */
  }
}
function remember(event, now = Date.now()) {
  if (!event || !publicKey.test(event.publicEventId) || typeof event.name !== 'string') return;
  save([
    {
      publicEventId: event.publicEventId,
      name: event.name.slice(0, 200),
      dateLabel: event.dateLabel || '',
      openedAt: now,
    },
    ...list().filter((v) => v.publicEventId !== event.publicEventId),
  ]);
}
function forget(publicEventId) {
  save(list().filter((v) => v.publicEventId !== publicEventId));
}
function clear() {
  save([]);
}
module.exports = { KEY, list, remember, forget, clear };

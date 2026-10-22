// Each browser tab has a separate module realm. SPA navigation keeps this identity;
// a full page reload creates a new identity and must acquire its own lease.
let tabClientInstanceId: string | undefined;
export function getTabClientInstanceId() {
  return (tabClientInstanceId ??= crypto.randomUUID());
}

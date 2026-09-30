// Durable "long-term memory": the web can silently evict IndexedDB (iOS/Safari
// eviction, "clear browsing data," storage pressure). The Storage persistence API
// is the only web mechanism to ask the browser NOT to evict our data. It is not
// guaranteed everywhere, so the portable backup file remains the real safety net
// (see the durability indicator + backup nudges). Under the native Capacitor
// shell, WebView storage is durable and this reports "granted".

export type PersistenceState = "granted" | "denied" | "unknown";

/** Ask the browser to make storage persistent (idempotent). No-op → "unknown" on
 *  environments without the API. Never throws. */
export async function requestPersistence(): Promise<PersistenceState> {
  try {
    const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!s?.persist) return "unknown";
    if (s.persisted && (await s.persisted())) return "granted";
    return (await s.persist()) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

/** Current persistence state without requesting it. Never throws. */
export async function getPersistenceState(): Promise<PersistenceState> {
  try {
    const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!s?.persisted) return "unknown";
    return (await s.persisted()) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

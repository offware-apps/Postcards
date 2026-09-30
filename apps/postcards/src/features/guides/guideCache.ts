import { openDB } from "idb";

// Saved whole guides live in their own small IndexedDB, not localStorage: one
// runs to ~200 kB, and a localStorage filled with them made every setting
// (Offline mode included) silently stop persisting. The store keeps the most
// recently read GUIDE_CACHE_CAP guides and drops the rest. Overviews, a couple
// of kB each, stay in localStorage.
const DB_NAME = "postcards-guides";
const STORE = "guides";
export const GUIDE_CACHE_CAP = 40;
// The key prefix whole guides were saved under in localStorage, moved on start.
const LEGACY_PREFIX = "postcards-guidefull:";

interface Entry {
  key: string;
  value: unknown;
  /** Last read or write, for the least-recently-used eviction. */
  at: number;
}

function db() {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "key" });
    },
  });
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

// A read and a write in the same millisecond still order correctly.
let clock = 0;
const now = () => (clock = Math.max(clock + 1, Date.now()));

async function trim(): Promise<void> {
  const d = await db();
  const all = (await d.getAll(STORE)) as Entry[];
  if (all.length <= GUIDE_CACHE_CAP) return;
  all.sort((a, b) => a.at - b.at);
  await Promise.all(all.slice(0, all.length - GUIDE_CACHE_CAP).map((e) => d.delete(STORE, e.key)));
}

/** A saved guide, or null when none is saved (or storage is unavailable). */
export async function readGuide<T>(key: string): Promise<T | null> {
  if (!hasIndexedDB()) return null;
  try {
    const d = await db();
    const e = (await d.get(STORE, key)) as Entry | undefined;
    if (!e) return null;
    await d.put(STORE, { ...e, at: now() });
    return e.value as T;
  } catch {
    return null;
  }
}

/** Save a guide; shown but not kept when storage refuses it. */
export async function saveGuide(key: string, value: unknown): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const d = await db();
    await d.put(STORE, { key, value, at: now() } satisfies Entry);
    await trim();
  } catch {
    /* storage full or blocked: shown but not saved */
  }
}

/** Move whole guides saved by earlier builds out of localStorage, freeing its room. */
export async function moveLocalGuides(): Promise<void> {
  if (!hasIndexedDB()) return; // nowhere to move them
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_PREFIX));
  } catch {
    return;
  }
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) await saveGuide(k, JSON.parse(raw));
    } catch {
      /* unreadable or refused: dropped, and fetched again on the next read */
    }
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  }
}

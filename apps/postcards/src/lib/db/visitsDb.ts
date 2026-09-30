import { openDB, type IDBPDatabase } from "idb";
import type { Story, Trip, Visit } from "../schema/models";
import {
  dehydrateVisit,
  hydrateVisit,
  referencedPhotoIds,
  type PhotoBlobKV,
  type StoredVisit,
} from "../image/photoBlobs";

// On-device working store (Constitution II: local-first, no backend).
const DB_NAME = "postcards";
const LEGACY_DB_NAME = "placebeen"; // the pre-rename database — migrated once
// v2 adds the "trips" store (Travel Log). Upgrades are additive & idempotent, so
// existing v1 databases keep their visits.
// v3 adds the "stories" store (Journal) — additive again; visits and trips are untouched.
// v4 adds the "tombstones" store (device sync, spec 013): deletion markers so a
// delete propagates instead of being resurrected. Additive & idempotent again.
// v5 adds the "photos" store: a visit's photos are stored as BLOBS keyed by a
// photo id, and only lightweight `{ id, caption }` refs stay on the visit record
// (perf — a toggle no longer re-`put`s multi-MB of inline base64). Additive &
// idempotent; existing inline-photo records are migrated on the next load.
const DB_VERSION = 5;
const STORE = "visits";
const TOMBSTONES = "tombstones";
const PHOTOS = "photos";

/** Which user collection a tombstone's id belongs to (its merge namespace). */
export type TombstoneKind = "visit" | "trip" | "story";

/**
 * A stored deletion marker. `key` (`${kind}:${id}`) is the object-store keyPath so
 * a visit and a trip that happened to share an id can't collide; `kind` lets the
 * sync engine route each tombstone to the right per-collection merge.
 */
export interface TombstoneRecord {
  key: string;
  kind: TombstoneKind;
  id: string;
  deletedAt: string;
}

const tombstoneKey = (kind: TombstoneKind, id: string): string => `${kind}:${id}`;

let dbPromise: Promise<IDBPDatabase> | null = null;

// Set when reading the stores at startup failed (IndexedDB would not open, e.g. a
// private window or blocked storage). The session then runs in memory, as it does
// with no IndexedDB at all: writing to the device store later, were it to open,
// would rewrite whole tables (a sync, an import) from stores that never loaded.
let unavailable = false;

export function hasIndexedDB(): boolean {
  return !unavailable && typeof indexedDB !== "undefined";
}

/** A store's startup read. A failure switches the session to memory (see
 *  `unavailable`) and reads as empty, so the app still opens and settles loaded. */
export async function loadOrEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch {
    unavailable = true;
    return [];
  }
}

/**
 * One-time carry-over from the pre-rename ("placebeen") database, so users who
 * ran the old build keep their history (Constitution II: the device is the
 * source of truth). Best-effort: never throws, and only runs when the new store
 * is empty, so it can never clobber current data.
 */
async function migrateLegacyDb(target: IDBPDatabase): Promise<void> {
  try {
    if ((await target.count(STORE)) > 0 || (await target.count("trips")) > 0) return;
    if (typeof indexedDB.databases === "function") {
      const names = (await indexedDB.databases()).map((d) => d.name);
      if (!names.includes(LEGACY_DB_NAME)) return; // nothing to migrate
    }
    const legacy = await openDB(LEGACY_DB_NAME); // open at its existing version, no upgrade
    const legacyVisits = legacy.objectStoreNames.contains(STORE)
      ? ((await legacy.getAll(STORE)) as Visit[])
      : [];
    const legacyTrips = legacy.objectStoreNames.contains("trips")
      ? ((await legacy.getAll("trips")) as Trip[])
      : [];
    legacy.close();
    if (legacyVisits.length === 0 && legacyTrips.length === 0) return;
    const tx = target.transaction([STORE, "trips"], "readwrite");
    for (const v of legacyVisits) await tx.objectStore(STORE).put(v);
    for (const t of legacyTrips) await tx.objectStore("trips").put(t);
    await tx.done;
  } catch {
    /* best-effort: a failed migration must never block the app */
  }
}

/** Shared handle for every on-device store (visits, trips, stories). */
export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "visitId" });
        }
        if (!database.objectStoreNames.contains("trips")) {
          database.createObjectStore("trips", { keyPath: "tripId" });
        }
        if (!database.objectStoreNames.contains("stories")) {
          database.createObjectStore("stories", { keyPath: "storyId" });
        }
        if (!database.objectStoreNames.contains(TOMBSTONES)) {
          database.createObjectStore(TOMBSTONES, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(PHOTOS)) {
          database.createObjectStore(PHOTOS, { keyPath: "id" });
        }
      },
    }).then(async (database) => {
      await migrateLegacyDb(database);
      return database;
    });
  }
  return dbPromise;
}

const db = getDb;

/** A read-only blob port backed by an in-memory snapshot of the photos store, so
 *  hydrating N visits costs ONE getAll rather than N micro-transactions. */
function snapshotKv(blobs: Map<string, Blob>): PhotoBlobKV {
  return {
    async get(id) {
      return blobs.get(id);
    },
    async has(id) {
      return blobs.has(id);
    },
    async put() {
      /* hydrate never writes */
    },
  };
}

/** A read/write blob port over an open transaction's photos object store. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function txKv(store: any): PhotoBlobKV {
  return {
    async get(id) {
      return (await store.get(id))?.blob as Blob | undefined;
    },
    async has(id) {
      return (await store.getKey(id)) !== undefined;
    },
    async put(id, blob) {
      await store.put({ id, blob });
    },
  };
}

async function loadAllBlobs(database: IDBPDatabase): Promise<Map<string, Blob>> {
  const map = new Map<string, Blob>();
  const rows = (await database.getAll(PHOTOS)) as { id: string; blob: Blob }[];
  for (const r of rows) map.set(r.id, r.blob);
  return map;
}

/** Delete photo blobs no live visit references (orphans from photo removals or
 *  caption edits, and anything a restore left behind). Best-effort, on load only. */
async function gcOrphanPhotos(database: IDBPDatabase): Promise<void> {
  const keys = (await database.getAllKeys(PHOTOS)) as string[];
  if (keys.length === 0) return;
  const recs = (await database.getAll(STORE)) as StoredVisit[];
  const referenced = new Set<string>();
  for (const r of recs) for (const id of referencedPhotoIds(r)) referenced.add(id);
  const orphans = keys.filter((k) => !referenced.has(k));
  if (orphans.length === 0) return;
  const tx = database.transaction(PHOTOS, "readwrite");
  for (const k of orphans) await tx.store.delete(k);
  await tx.done;
}

export async function getAllVisits(): Promise<Visit[]> {
  if (!hasIndexedDB()) return [];
  const database = await db();
  const stored = (await database.getAll(STORE)) as StoredVisit[];
  const blobs = await loadAllBlobs(database);
  const kv = snapshotKv(blobs);
  const out: Visit[] = [];
  const migrate: Visit[] = [];
  for (const rec of stored) {
    const { visit, needsMigrate } = await hydrateVisit(rec, kv);
    out.push(visit);
    if (needsMigrate) migrate.push(visit);
  }
  // Re-persist any pre-split (inline) records once, so their bytes move to the
  // blob store and future toggles are cheap. Best-effort — never block the load.
  for (const v of migrate) {
    try {
      await putVisit(v);
    } catch {
      /* a failed migration must not stop the app from opening */
    }
  }
  try {
    await gcOrphanPhotos(database);
  } catch {
    /* GC is housekeeping — never fatal */
  }
  return out;
}

export async function putVisit(visit: Visit): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await db();
  const tx = database.transaction([STORE, PHOTOS], "readwrite");
  const slim = await dehydrateVisit(visit, txKv(tx.objectStore(PHOTOS)));
  await tx.objectStore(STORE).put(slim);
  await tx.done;
}

export async function deleteVisit(visitId: string): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await db();
  const tx = database.transaction([STORE, PHOTOS], "readwrite");
  const rec = (await tx.objectStore(STORE).get(visitId)) as StoredVisit | undefined;
  if (rec) for (const id of referencedPhotoIds(rec)) await tx.objectStore(PHOTOS).delete(id);
  await tx.objectStore(STORE).delete(visitId);
  await tx.done;
}

/**
 * Rewrite the visits table to `visits` inside an open transaction. The photo
 * blobs are kept rather than cleared: the in-memory photos keep their blob ids
 * across the rewrite, so a cleared store would leave every ref pointing at
 * nothing, and re-storing them all would decode every photo on every sync. The
 * blobs no visit references any more are deleted in the same transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rewriteVisits(visitStore: any, photoStore: any, visits: Visit[]): Promise<void> {
  const kv = txKv(photoStore);
  const referenced = new Set<string>();
  await visitStore.clear();
  for (const v of visits) {
    const slim = await dehydrateVisit(v, kv);
    for (const id of referencedPhotoIds(slim)) referenced.add(id);
    await visitStore.put(slim);
  }
  for (const id of (await photoStore.getAllKeys()) as string[]) {
    if (!referenced.has(id)) await photoStore.delete(id);
  }
}

export async function replaceAllVisits(visits: Visit[]): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await db();
  const tx = database.transaction([STORE, PHOTOS], "readwrite");
  await rewriteVisits(tx.objectStore(STORE), tx.objectStore(PHOTOS), visits);
  await tx.done;
}

/**
 * Replace visits, trips (and, when provided, stories) in a single transaction —
 * used on import so the portable file lands atomically. If any write fails the
 * whole transaction aborts and the previous data is preserved, so the device can
 * never be left with one store from the new file and another from the old
 * (single-portable-file guarantee). `stories` is optional so older 2-argument
 * callers keep working; omitting it leaves the stories store untouched.
 */
export async function replaceAllPortable(
  visits: Visit[],
  trips: Trip[],
  stories?: Story[],
  tombstones?: TombstoneRecord[],
): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await db();
  // PHOTOS rides along in the same transaction so a restore/sync lands the visit
  // refs and their blobs atomically (never refs pointing at absent images).
  const stores = [STORE, PHOTOS, "trips"];
  if (stories) stores.push("stories");
  // Device sync lands records AND tombstones in ONE transaction, so a merged pull
  // can never leave the device with the new records but the old tombstones.
  if (tombstones) stores.push(TOMBSTONES);
  const tx = database.transaction(stores, "readwrite");
  const tripStore = tx.objectStore("trips");
  await rewriteVisits(tx.objectStore(STORE), tx.objectStore(PHOTOS), visits);
  await tripStore.clear();
  for (const t of trips) await tripStore.put(t);
  if (stories) {
    const storyStore = tx.objectStore("stories");
    await storyStore.clear();
    for (const s of stories) await storyStore.put(s);
  }
  if (tombstones) {
    const tombStore = tx.objectStore(TOMBSTONES);
    await tombStore.clear();
    for (const t of tombstones) await tombStore.put(t);
  }
  await tx.done;
}

/** Record (or refresh) a deletion marker. Keyed by kind+id, so a re-delete just
 *  updates the timestamp rather than duplicating (spec 013, FR-009). */
export async function putTombstone(
  kind: TombstoneKind,
  id: string,
  deletedAt: string,
): Promise<void> {
  if (!hasIndexedDB()) return;
  await (await db()).put(TOMBSTONES, { key: tombstoneKey(kind, id), kind, id, deletedAt });
}

/** Drop a tombstone (e.g. when its record is explicitly restored/re-added). */
export async function deleteTombstone(kind: TombstoneKind, id: string): Promise<void> {
  if (!hasIndexedDB()) return;
  await (await db()).delete(TOMBSTONES, tombstoneKey(kind, id));
}

export async function getAllTombstones(): Promise<TombstoneRecord[]> {
  if (!hasIndexedDB()) return [];
  return (await db()).getAll(TOMBSTONES) as Promise<TombstoneRecord[]>;
}

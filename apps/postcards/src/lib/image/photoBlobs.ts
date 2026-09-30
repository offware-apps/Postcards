// Photo storage split (perf): a visit's photos are the heavy payload — a single
// place can hold ~2.4 MB of inline base64 across a dozen postcards. Keeping that
// on the Visit record meant EVERY visit mutation (toggle favorite, edit a note,
// mark visited) re-`put` the whole multi-MB record to IndexedDB and structured-
// cloned it on the main thread — a long task that janked the tap.
//
// The fix keeps photo BLOBS in a dedicated object store keyed by a photo id, and
// persists only lightweight `{ id, caption }` refs on the visit record. A toggle
// now writes a few hundred bytes, never the images. The IN-MEMORY Visit is
// unchanged (photos are still `{ src: dataURL, caption }`), so every consumer —
// the gallery, export, sync, publish — keeps working and the portable file stays
// byte-identical AT EXPORT (the constitution's one-file guarantee holds there).
//
// This module is the pure, storage-agnostic core (codec + hydrate/dehydrate over
// an injected key/value port) so it is unit-testable without a real IndexedDB.
// `visitsDb` wires it to the actual `photos` object store.

import { uuid } from "../store/uuid";
import type { Photo, Visit } from "../schema/models";

/** Minimal async blob store the split logic writes/reads through. */
export interface PhotoBlobKV {
  get(id: string): Promise<Blob | undefined>;
  /** Whether a blob is stored under `id` — a key lookup, the blob is not read. */
  has(id: string): Promise<boolean>;
  put(id: string, blob: Blob): Promise<void>;
}

/** A photo as persisted on the visit record: the id of its blob + its caption. */
interface PhotoRef {
  id: string;
  caption: string | null;
}

/** A visit as persisted on disk — identical to a Visit but photos are refs. */
export type StoredVisit = Omit<Visit, "photos" | "photo"> & { photos?: PhotoRef[] };

/**
 * Stable id per in-memory photo OBJECT. A toggle keeps the same photo object
 * references (a favorite flip is `{ ...visit, favorite }`, the photos array and
 * its objects are untouched), so on the hot path every photo is already mapped:
 * dehydrate writes refs with ZERO blob writes and ZERO base64 work. A WeakMap so
 * superseded photo objects (after an edit that replaces one) are collectible.
 * A mapped id is a hint, not a guarantee: deleting a visit removes its blobs
 * while an undo still holds its photo objects.
 */
const idOf = new WeakMap<object, string>();

const B64_CHUNK = 0x8000;

/** Decode an inline `data:...;base64,...` (or text) URL into a Blob. Pure, sync. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) {
    // Not a data URL — store the raw text so nothing is silently lost.
    return new Blob([dataUrl], { type: "text/plain" });
  }
  const meta = dataUrl.slice(5, comma); // between "data:" and ","
  const base64 = /;base64$/i.test(meta);
  const mime = meta.replace(/;base64$/i, "") || "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  const str = base64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Re-encode a Blob to the inline base64 data URL the rest of the app (and the
 * export) expects. Byte-identical to the original for canonical base64 (which is
 * what `canvas.toDataURL` and a normal export produce), so a load→save round-trip
 * doesn't churn the portable file.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/**
 * In-memory Visit (data-URL photos) → disk record (photo refs), storing any blob
 * that isn't stored yet. On the toggle hot path every photo is already mapped and
 * stored, so this does one key lookup per photo and no blob writes and no base64
 * decoding — just builds tiny refs.
 */
export async function dehydrateVisit(visit: Visit, kv: PhotoBlobKV): Promise<StoredVisit> {
  const { photo: _legacy, photos, ...rest } = visit as Visit & { photo?: string };
  if (!photos || photos.length === 0) return rest as StoredVisit;
  const refs: PhotoRef[] = [];
  for (const p of photos) {
    let id = idOf.get(p);
    if (!id || !(await kv.has(id))) {
      id ??= uuid();
      await kv.put(id, dataUrlToBlob(p.src));
      idOf.set(p, id);
    }
    refs.push({ id, caption: p.caption ?? null });
  }
  return { ...(rest as StoredVisit), photos: refs };
}

/**
 * Disk record → in-memory Visit (photos rehydrated to data URLs). Handles three
 * shapes so upgrades are seamless: the new `{ id, caption }` refs; a legacy inline
 * `photos: [{ src, caption }]` (pre-split); and the legacy single `photo` field
 * (schema ≤ v2). `needsMigrate` is true when the record still held inline bytes,
 * so the caller can re-persist it in the slim shape once.
 */
export async function hydrateVisit(
  rec: StoredVisit | Visit,
  kv: PhotoBlobKV,
): Promise<{ visit: Visit; needsMigrate: boolean }> {
  const any = rec as StoredVisit & { photo?: string; photos?: (PhotoRef | Photo)[] };
  const rawPhotos = any.photos ?? [];
  const legacy = typeof any.photo === "string" ? any.photo : null;
  if (rawPhotos.length === 0 && !legacy) {
    const { photo: _p, ...clean } = any;
    return { visit: clean as Visit, needsMigrate: false };
  }
  let needsMigrate = false;
  const out: Photo[] = [];
  const seen = new Set<string>();
  const push = (src: string, caption: string | null, id?: string) => {
    if (seen.has(src)) return;
    seen.add(src);
    const po: Photo = { src, caption: caption ?? null };
    if (id) idOf.set(po, id);
    out.push(po);
  };
  // Legacy single photo folds in first (matches normalizeVisitPhotos ordering).
  if (legacy) {
    needsMigrate = true;
    push(legacy, null);
  }
  for (const p of rawPhotos) {
    if ("id" in p && typeof (p as PhotoRef).id === "string" && !("src" in p)) {
      const ref = p as PhotoRef;
      const blob = await kv.get(ref.id);
      if (!blob) continue; // blob gone — drop the ref rather than surface a broken image
      push(await blobToDataUrl(blob), ref.caption ?? null, ref.id);
    } else if (typeof (p as Photo).src === "string") {
      needsMigrate = true; // inline photo from before the split — re-persist as a blob
      push((p as Photo).src, (p as Photo).caption ?? null);
    }
  }
  const { photo: _p, photos: _ph, ...base } = any;
  const visit = (out.length ? { ...base, photos: out } : base) as Visit;
  return { visit, needsMigrate };
}

/** Collect the blob ids a stored visit references (for orphan GC). */
export function referencedPhotoIds(rec: StoredVisit): string[] {
  return (rec.photos ?? []).map((p) => p.id).filter((id): id is string => typeof id === "string");
}

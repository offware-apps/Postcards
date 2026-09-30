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

/** Decode a `data:<mime>[;base64],<payload>` URL into raw bytes + its (parameter-
 *  stripped) mime. A base64 payload is decoded as base64; any other payload is
 *  percent-decoded: its text as UTF-8 bytes, each `%XX` as the byte it names. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array<ArrayBuffer>; mime: string } {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma); // between "data:" and ","
  const isBase64 = /;base64$/i.test(meta);
  // Strip the ;base64 flag AND any ;charset=… parameters to get the bare mime.
  const mime = meta.replace(/;base64$/i, "").split(";")[0] || "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  if (isBase64) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: percentDecode(payload), mime };
}

const isHex = (b: number | undefined) =>
  b !== undefined &&
  ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66));

/** Percent-decode as the URL standard does: never throws, so an escape that is
 *  not valid UTF-8 (`%89`) keeps its byte and a stray `%` stays a `%`. */
function percentDecode(s: string): Uint8Array<ArrayBuffer> {
  const input = new TextEncoder().encode(s);
  const out = new Uint8Array(input.length);
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 0x25 && isHex(input[i + 1]) && isHex(input[i + 2])) {
      out[n++] = parseInt(String.fromCharCode(input[i + 1]!, input[i + 2]!), 16);
      i += 2;
    } else {
      out[n++] = input[i]!;
    }
  }
  return out.subarray(0, n);
}

/** Decode an inline `data:...;base64,...` (or text) URL into a Blob. Pure, sync. */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) {
    // Not a data URL — store the raw text so nothing is silently lost.
    return new Blob([dataUrl], { type: "text/plain" });
  }
  const { bytes, mime } = decodeDataUrl(dataUrl);
  return new Blob([bytes], { type: mime });
}

/**
 * Re-encode a Blob to the inline base64 data URL the rest of the app (and the
 * export) expects. Byte-identical to the original for canonical base64 (which is
 * what `canvas.toDataURL` and a normal export produce), so a load→save round-trip
 * doesn't churn the portable file.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return bytesToDataUrl(
    new Uint8Array(await blob.arrayBuffer()),
    blob.type || "application/octet-stream",
  );
}

/** Encode raw bytes as an inline base64 data URL of the given mime. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
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
  // A blob id appears once; the same image under two ids is two photos, each with
  // its own caption, so bytes alone never merge them.
  const seen = new Set<string>();
  for (const p of rawPhotos) {
    if ("id" in p && typeof (p as PhotoRef).id === "string" && !("src" in p)) {
      const ref = p as PhotoRef;
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      const blob = await kv.get(ref.id);
      if (!blob) continue; // blob gone — drop the ref rather than surface a broken image
      const po: Photo = { src: await blobToDataUrl(blob), caption: ref.caption ?? null };
      idOf.set(po, ref.id);
      out.push(po);
    } else if (typeof (p as Photo).src === "string") {
      needsMigrate = true; // inline photo from before the split — re-persist as a blob
      out.push({ src: (p as Photo).src, caption: (p as Photo).caption ?? null });
    }
  }
  // Legacy single photo folds in first unless the gallery already holds it, as
  // normalizeVisitPhotos does, so the gallery copy keeps its caption.
  if (legacy) {
    needsMigrate = true;
    if (!out.some((p) => p.src === legacy)) out.unshift({ src: legacy, caption: null });
  }
  const { photo: _p, photos: _ph, ...base } = any;
  const visit = (out.length ? { ...base, photos: out } : base) as Visit;
  return { visit, needsMigrate };
}

/** Collect the blob ids a stored visit references (for orphan GC). */
export function referencedPhotoIds(rec: StoredVisit): string[] {
  return (rec.photos ?? []).map((p) => p.id).filter((id): id is string => typeof id === "string");
}

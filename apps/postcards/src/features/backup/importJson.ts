import {
  MAX_PHOTOS_PER_VISIT,
  normalizeVisitPhotos,
  placeKey,
  PostcardsFileSchema,
  SCHEMA_VERSION,
  type Story,
  type SyncTombstone,
  type Trip,
  type Visit,
} from "../../lib/schema/models";

export type ImportResult =
  | {
      ok: true;
      visits: Visit[];
      trips: Trip[];
      stories: Story[];
      /** Deletion markers carried by a sync file (empty for a plain backup). */
      tombstones: SyncTombstone[];
      warnings: string[];
    }
  | { ok: false; error: string };

/** Reject absurdly large inputs before parsing (main-thread DoS guard). Still
 *  generous for photo-rich gallery files (postcards are embedded, downscaled) — a
 *  safety ceiling, not a schema rule, so a genuine backup restores — but halved
 *  from the old 256 MB so a hostile file can't OOM a memory-constrained mobile
 *  WebView on import (or on every device-sync pull, which runs this same parser).
 *  Element-count caps in models.ts bound the record arrays independently. */
const MAX_IMPORT_CHARS = 128_000_000;

/** How far past this device's clock a stamp read from a file may sit: another
 *  device's clock can run a little fast, but not by more. */
const FUTURE_STAMP_MARGIN_MS = 10 * 60 * 1000;

/**
 * A stamp from a file, as the UTC ISO string this app writes. The schema accepts
 * an offset, and the sync merge orders stamps as text, which holds for UTC only;
 * a stamp beyond the margin in the future would win every merge, a deletion
 * included, so it is brought back to the margin.
 */
function readStamp(s: string): string {
  return new Date(Math.min(Date.parse(s), Date.now() + FUTURE_STAMP_MARGIN_MS)).toISOString();
}

function readStamps<R extends { addedAt: string; updatedAt?: string }>(r: R): R {
  return {
    ...r,
    addedAt: readStamp(r.addedAt),
    ...(r.updatedAt ? { updatedAt: readStamp(r.updatedAt) } : {}),
  };
}

/**
 * Parse + validate + sanitize an imported file (Constitution VI: data is inert).
 * The content is treated as pure data — parsed, never executed. Malformed,
 * unknown, or newer-versioned files are rejected with a clear reason. The Zod
 * schema transforms sanitize free-text fields (see models.ts / sanitize.ts).
 */
export function importFile(text: string): ImportResult {
  if (text.length > MAX_IMPORT_CHARS) {
    return { ok: false, error: "This file is too large to import safely." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }

  // Object check FIRST — JSON.parse("null") / a bare string parse fine, and
  // reading .format off them would throw instead of returning a clear error.
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "This does not look like a Postcards file (missing format marker)." };
  }
  const format = (raw as { format?: unknown }).format;
  // "placebeen" is the pre-rename marker — accept it so files exported by the
  // old build still restore, and normalize to the current marker for the schema.
  if (format !== "postcards" && format !== "placebeen") {
    return { ok: false, error: "This does not look like a Postcards file (missing format marker)." };
  }
  if (format === "placebeen") (raw as { format: string }).format = "postcards";

  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This file was made by a newer version (schema v${version}). Please update the app.`,
    };
  }

  const parsed = PostcardsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "file";
    return { ok: false, error: `Invalid data at "${where}": ${first?.message ?? "unknown error"}.` };
  }

  // Migrate every record to the current photo shape (legacy `photo` -> `photos`)
  // so both the persisted copy and the in-memory copy are v3-shaped — otherwise a
  // restored postcard is invisible until the next reload.
  // Enforce one-visit-per-place on import too (FR-015); when a hand-edited file
  // lists a place twice, keep the first record's identity but UNION the galleries
  // (photos are now the payload — dropping one silently would lose data).
  const byPlace = new Map<string, Visit>();
  for (const rawVisit of parsed.data.visits) {
    const v = readStamps(normalizeVisitPhotos(rawVisit));
    const key = placeKey(v.place);
    const existing = byPlace.get(key);
    if (!existing) {
      byPlace.set(key, v);
      continue;
    }
    const photos = [...(existing.photos ?? [])];
    for (const p of v.photos ?? []) {
      if (photos.length >= MAX_PHOTOS_PER_VISIT) break;
      if (!photos.some((q) => q.src === p.src)) photos.push(p);
    }
    byPlace.set(key, { ...v, visitId: existing.visitId, addedAt: existing.addedAt, photos });
  }
  // And one per visitId: the "visits" store is keyed on it, so two places sharing
  // an id would be two in memory and one on disk. Last-wins, like trips below.
  const visitById = new Map<string, Visit>();
  for (const v of byPlace.values()) visitById.set(v.visitId, v);
  const visits = [...visitById.values()];
  // Enforce one-record-per-tripId too — the "trips" store is keyed on tripId, so a
  // hand-edited file with a duplicate id would silently drop rows on persist and
  // diverge from the in-memory count. Keep last-wins to match the IndexedDB put order.
  const tripById = new Map<string, Trip>();
  for (const t of parsed.data.trips) tripById.set(t.tripId, readStamps(t));
  const trips = [...tripById.values()];
  // Same for stories — the "stories" store is keyed on storyId; last-wins matches
  // the IndexedDB put order.
  const storyById = new Map<string, Story>();
  for (const s of parsed.data.stories) storyById.set(s.storyId, readStamps(s));
  const stories = [...storyById.values()];
  // Deletion markers (device sync). Absent for a plain backup; when present, keep
  // the newest deletedAt per (kind,id) so a hand-merged file can't hold stale ones.
  const tombById = new Map<string, SyncTombstone>();
  for (const raw of parsed.data.tombstones ?? []) {
    const t = { ...raw, deletedAt: readStamp(raw.deletedAt) };
    const key = `${t.kind}:${t.id}`;
    const cur = tombById.get(key);
    if (!cur || t.deletedAt > cur.deletedAt) tombById.set(key, t);
  }
  const tombstones = [...tombById.values()];
  const warnings: string[] = [];
  if (visits.length !== parsed.data.visits.length) warnings.push("Merged duplicate places in the file.");
  if (trips.length !== parsed.data.trips.length) warnings.push("Merged duplicate trips in the file.");
  if (stories.length !== parsed.data.stories.length) warnings.push("Merged duplicate stories in the file.");
  return { ok: true, visits, trips, stories, tombstones, warnings };
}

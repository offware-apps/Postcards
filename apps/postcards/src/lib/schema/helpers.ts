import type { Photo, PlaceRef, Visit } from "./models";

// Zod-free constants & helpers shared by the always-loaded stores and screens.
// models.ts (the Zod schemas) re-exports everything here, so schema consumers —
// the backup codecs, the generated JSON Schema, tests — keep one import. Startup
// code must import from THIS module instead: importing models.ts for a value
// drags zod (~65 KB min) into the boot chunk, and the only runtime users of the
// schemas are the codecs behind the Export/Import buttons (loaded on demand).

export const FORMAT = "postcards" as const;
// v2 adds the optional top-level `trips` array (travel log). Files stay
// structurally back-compatible (v1 files import unchanged), but the bump means an
// older build opening a v2 file shows the graceful "update the app" prompt rather
// than a cryptic strict-parse error on the unknown `trips` key.
// v3 turns a visit's single `photo` into a `photos` gallery (each with an optional
// caption). Both fields validate, so v1/v2 files import unchanged; new exports write
// `photos`. Older builds opening a v3 file get the same graceful "update" prompt.
// v4 adds the "custom" place kind — a USER-authored point (name + coordinates) for
// places missing from the reference datasets. Reference data stays aggregated;
// custom points are personal data and live only in the user's own file.
// v5 adds the optional top-level `stories` array (Journal — a mini travel blog).
// Files stay structurally back-compatible (v4 files import unchanged), but the bump
// means an older build opening a v5 file shows the graceful "update the app" prompt
// rather than a cryptic strict-parse error on the unknown `stories` key.
// v6 adds device sync (spec 013): an optional `updatedAt` stamp on every user
// record (the newest-wins merge comparator) and an optional top-level `tombstones`
// array (deletion markers). Both are additive & optional, so v1–v5 files import
// unchanged; an older build opening a v6 sync file gets the graceful "update" prompt.
// v7 adds an optional `name` (folder label, e.g. "Japan 2024") on a trip: a short
// label that groups legs and titles a published site. Additive & optional exactly
// like `updatedAt` — never injected on parse — so v1–v6 files import unchanged and
// round-trip byte-identically; an older build opening a v7 file gets the same
// graceful "update" prompt on the (harmless) unknown value only if it were required.
// v8 adds an optional `folder` (label, e.g. "Japan 2024") on a journal story: a short
// label that groups stories in the feed, mirroring a trip's `name`. Additive & optional
// exactly like `name`/`updatedAt` — never injected on parse — so v1–v7 files import
// unchanged and round-trip byte-identically; an older build opening a v8 file gets the
// same graceful "update" prompt.
// v9 adds the same optional `folder` on a VISIT, so places can be grouped under one
// name in the list. Additive & optional, never injected on parse — v1–v8 files import
// unchanged and round-trip byte-identically.
// v10 makes a journal story's `title` and `text` BOTH optional (an image-only entry),
// guarded so a story still needs a title, text, or a photo. A relaxation, so v1–v9
// files still validate; only a file that actually omits a story title needs v10.
// v11 adds an optional ordered `stops` array on a trip (multi-stop journey
// reconstruction, spec 019) and widens a trip's `date` to accept a year (`YYYY`) or
// month (`YYYY-MM`), not only a full day. Both are additive/relaxing: v1–v10 files
// validate and round-trip byte-identically (`stops` has no default, so it is never
// injected on parse; the date regex only accepts MORE). `from`/`to` mirror the
// first/last stop, so an older build reading a v11 multi-stop trip still sees a valid
// `from → to` leg.
// v12 adds Trip.legModes (per-leg transport). It's a new key on a `.strict()`
// object, so an older (≤v11) app would reject a file that carries it — hence the
// bump, which makes such files fail the version guard gracefully instead.
// v13 is the journal redesign (spec 020): a postcard's `place` becomes OPTIONAL
// (you can journal without picking a visited place), plus four additive optional
// fields — `extraPlaces` (an ordered set beyond the primary), `endDate` (a range),
// `tags` (personal mood/weather/free labels), and `tripId` (a link to a
// reconstructed trip). The relaxation keeps v1–v12 files valid; the new `.strict()`
// keys are why the version bumps (an older app rejects a v13 file gracefully).
// v15 adds an optional per-STOP date array on a Trip (`stopDates`, spec 021),
// aligned to `stops`. Additive & optional with no default, so it's never injected:
// v1–v14 trips (no per-stop dates) validate and round-trip byte-identically; a v15
// file carrying stopDates is rejected by an older app via the version guard.
// v14 adds a "station" (railway station) place kind — an additive enum value on the
// `.strict()` PlaceRef, sourced from a named openly-licensed dataset (Wikidata CC0),
// exactly like v4 added "custom". v1–v13 files (no station refs) validate unchanged;
// a v14 file carrying a station is rejected by an older app via the version guard.
export const SCHEMA_VERSION = 15;

/** Most photos one place's gallery may hold (bounds the inline portable file). */
export const MAX_PHOTOS_PER_VISIT = 48;

/** Most photos one journal story may hold (bounds the inline portable file). */
export const MAX_PHOTOS_PER_STORY = 24;

/** Most places one postcard may reference (primary + extras combined). */
export const MAX_PLACES_PER_STORY = 24;

/** Most tags one postcard may hold, and each tag's max length. */
export const MAX_TAGS_PER_STORY = 24;
export const MAX_TAG_LEN = 40;

/** Stable key used for dedupe: one visit per (kind, id). */
export function placeKey(place: Pick<PlaceRef, "kind" | "id">): string {
  return `${place.kind}:${place.id}`;
}

/**
 * Migrate a visit's legacy single `photo` into the `photos` gallery and drop the
 * legacy field, so the rest of the app only ever reads `photos`. Idempotent —
 * safe to run on every load/import. Returns a new object (never mutates input).
 */
export function normalizeVisitPhotos(v: Visit): Visit {
  const photos: Photo[] = v.photos ? [...v.photos] : [];
  if (v.photo && !photos.some((p) => p.src === v.photo)) {
    photos.unshift({ src: v.photo, caption: null });
  }
  const { photo: _legacy, ...rest } = v;
  // Only carry `photos` when there is at least one — keeps photo-less records and
  // exports clean, and the rest of the app reads `v.photos ?? []`.
  return photos.length ? { ...rest, photos } : rest;
}

/**
 * Backfill `updatedAt` from `addedAt` for records made before the field existed
 * (spec 013 migration). Idempotent and non-mutating — a record that already has
 * `updatedAt` is returned untouched. Run on load and on any bulk set, so the
 * newest-wins merge always has a timestamp to compare while `addedAt` stays put.
 */
export function backfillUpdatedAt<T extends { addedAt: string; updatedAt?: string }>(r: T): T {
  return r.updatedAt ? r : { ...r, updatedAt: r.addedAt };
}

/** Current instant as an ISO-8601 string — the `updatedAt`/tombstone timestamp every
 *  store stamps on a write (one definition instead of a copy per store). */
export const stampNow = (): string => new Date().toISOString();

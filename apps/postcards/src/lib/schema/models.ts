import { z } from "zod";
import { sanitizeText } from "./sanitize";
import {
  FORMAT,
  MAX_PHOTOS_PER_STORY,
  MAX_PHOTOS_PER_VISIT,
  MAX_PLACES_PER_STORY,
  MAX_TAGS_PER_STORY,
  MAX_TAG_LEN,
} from "./helpers";

// Canonical, versioned schema for the portable data file.
// Single source of truth: these Zod models generate TS types AND the published
// JSON Schema (see tests/unit/schema.spec.ts). Contract: contracts/portable-data-file.md
//
// Zod-free constants & helpers (FORMAT, SCHEMA_VERSION, placeKey, …) live in
// ./helpers so the always-loaded stores and screens can use them without pulling
// zod into the boot chunk; they are re-exported here so codec code and tests keep
// importing everything schema-shaped from one module.
export {
  FORMAT,
  MAX_PHOTOS_PER_STORY,
  MAX_PHOTOS_PER_VISIT,
  MAX_PLACES_PER_STORY,
  MAX_TAGS_PER_STORY,
  MAX_TAG_LEN,
  SCHEMA_VERSION,
  backfillUpdatedAt,
  normalizeVisitPhotos,
  placeKey,
} from "./helpers";

const isoCountryId = z
  .string()
  .regex(/^[A-Z]{2}$/, "country id must be an ISO 3166-1 alpha-2 code");

export const PlaceRefSchema = z
  .object({
    // Additive: older files only ever used "country"/"city", so they still validate.
    // A file with a newer kind opened in an older app build fails closed (unknown kind), by design.
    kind: z.enum(["country", "city", "airport", "heritage", "custom", "station"]),
    id: z.string().min(1).max(64),
    name: z
      .string()
      .min(1)
      .max(200)
      .transform((s) => sanitizeText(s, 200))
      // min(1) runs on the INPUT; a name of only formula-prefix chars ("===")
      // sanitizes to "" and would poison the file — reject it clearly instead.
      .refine((s) => s.length > 0, { message: "Name is empty once sanitized" }),
    countryId: isoCountryId,
    // Coordinates carried on the record itself — only used by kind "custom"
    // (user-authored points have no reference-data entry to look coords up in).
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    // Population the user typed for a "custom" point (their own place has no
    // reference-data population). Personal annotation, never reference data — lets
    // a custom place carry a real headcount so it isn't treated as 0 by the
    // population filter. Absent = unknown = counts as 0 for filtering.
    population: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict();

// Ids are opaque, inert stable strings — the app mints UUIDs, but the portable
// file is meant to be hand- and tool-writable (AI-friendly), so we don't demand
// strict RFC-4122 form (Zod 4 tightened .uuid()); just a bounded non-empty id.
const idString = z.string().min(1).max(100);

/** A bounded, inert inline image data URL (never an external link). Constrained
 *  to RASTER subtypes: `data:image/svg+xml` can carry <script>, so even though
 *  photos are only ever rendered via <img src> today (inert), we refuse SVG at
 *  the door so a future CSS-background/`<use>`/innerHTML render path can never
 *  turn a stored photo into script. The app only ever produces jpeg/png/webp. */
const photoDataUrl = z
  .string()
  .max(6_000_000)
  .refine(
    (s) => /^data:image\/(png|jpe?g|webp|gif|avif);/i.test(s),
    "photo must be an inline raster image data URL",
  );

/**
 * One photo in a place's gallery: the inline image + an optional short caption
 * (e.g. "the old town", "the monument"). Inert & private: the image is only ever
 * rendered via <img src>, never executed, and never leaves the device except in an
 * explicit export. Downscaled on capture.
 */
/** A nullable free-text field: bounded, sanitized to inert text, null-preserving
 *  (absent/null stays null; present text is sanitized to the same bound). */
const nullableSanitized = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : sanitizeText(v, max)));

/** An optional label (folder / trip name): bounded + sanitized, with `.transform`
 *  BEFORE `.optional` so the KEY stays optional and older files round-trip
 *  byte-identically; a value that sanitizes away is dropped rather than stored empty. */
const optionalLabel = (max = 80) =>
  z
    .string()
    .max(max)
    .transform((v) => {
      const s = sanitizeText(v, max);
      return s.length ? s : undefined;
    })
    .optional();

/** One personal tag on a postcard (a mood, a weather note, a free label) — a
 *  bounded, sanitized, non-empty string. Personal data, never reference data
 *  (Constitution I): a tag invents no world fact. Mood/weather are just preset
 *  tag VALUES the composer offers; the model stays plain strings for portability. */
const tagString = z
  .string()
  .min(1)
  .max(MAX_TAG_LEN)
  .transform((s) => sanitizeText(s, MAX_TAG_LEN))
  .refine((s) => s.length > 0, "a tag cannot be empty");

export const PhotoSchema = z
  .object({
    src: photoDataUrl,
    caption: nullableSanitized(300),
  })
  .strict();

export const VisitSchema = z.object({
  visitId: idString,
  place: PlaceRefSchema,
  /** "visited" = been there; "wishlist" = want to go. Old files default to visited. */
  status: z.enum(["visited", "wishlist"]).optional().default("visited"),
  /** Starred by the user. */
  favorite: z.boolean().optional().default(false),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  note: nullableSanitized(2000),
  /**
   * Legacy single "postcard" photo (schema ≤ v2). Kept so v1/v2 files import
   * unchanged; on load it is migrated into `photos[0]` (see normalizeVisitPhotos).
   */
  photo: photoDataUrl.nullable().optional(),
  /**
   * Your gallery of photos for this place — a postcard, a monument, the view, …
   * each with an optional caption. Stored on-device (privacy/inert as above).
   */
  photos: z.array(PhotoSchema).max(MAX_PHOTOS_PER_VISIT).optional(),
  /**
   * Optional folder label (e.g. "Japan 2024") that groups places under one name
   * in the list — the same shape as a Story's `folder` and a Trip's `name`.
   * Additive & optional: absent on older files and NOT injected on parse (the
   * transform returns `undefined`, so no `folder` key is written), keeping earlier
   * files validating and round-tripping byte-identically. Sanitized to inert text
   * when present; a value that sanitizes away is dropped rather than stored empty.
   */
  folder: optionalLabel(),
  addedAt: z.string().datetime({ offset: true }),
  /**
   * When this record was last mutated (device sync, spec 013). Optional so files
   * that predate the field still validate; on load it is backfilled from `addedAt`
   * (see backfillUpdatedAt) and every store mutation stamps it. It is the
   * newest-wins comparator the record-level merge uses; `addedAt` stays immutable.
   * NOT defaulted at the schema level on purpose — a default would inject the field
   * on every parse and break the export→import equality guarantee for older files.
   */
  updatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

/** How a journey was made. Additive: unknown modes never occur (closed enum). */
export const TravelModeSchema = z.enum(["flight", "train", "bus", "ferry", "car", "other"]);

/**
 * A journey already taken (Travel Log). from/to reuse PlaceRef so a leg can join
 * cities, airports, or countries. Distance is DERIVED from endpoint coordinates
 * at read time (see features/travel/distance.ts) — never stored, never invented.
 */
export const TripSchema = z
  .object({
    tripId: idString,
    /**
     * Optional short trip/folder label (e.g. "Japan 2024") that groups legs under
     * one name and titles a published site. Additive & optional exactly like
     * `updatedAt`: absent on older files and NOT injected on parse (the transform
     * returns `undefined`, so no `name` key is written), which keeps v1–v6 files
     * validating and round-tripping byte-identically. Sanitized to inert text when
     * present; a value that sanitizes away is dropped rather than stored empty.
     */
    name: optionalLabel(),
    from: PlaceRefSchema,
    to: PlaceRefSchema,
    /**
     * Optional ordered chain of stops for a MULTI-STOP journey (spec 019). When
     * present it lists every waypoint in order (airport → city → …); `from`/`to`
     * mirror the first/last stop, so an older build reading a multi-stop trip still
     * sees a valid `from → to` leg (graceful degradation). Additive & optional with
     * no default, so the key is NEVER injected on parse — v1–v10 files (no `stops`)
     * validate and round-trip byte-identically. A reconstructed trip needs ≥2 stops.
     */
    stops: z.array(PlaceRefSchema).min(2).max(200).optional(),
    mode: TravelModeSchema.optional().default("flight"),
    /**
     * Per-LEG transport (spec 019): the mode of the leg from stop i to stop i+1, so
     * one journey can mix transports — fly Paris→Tokyo→Osaka, then take the train
     * Osaka→Kyoto — and a run of the same mode reads as a sub-trip. When present its
     * length is `stops.length - 1`; a leg with no entry falls back to `mode`.
     * Additive & optional with no default, so the key is never injected on parse —
     * a trip with a single `mode` (and every v1–v11 file) round-trips byte-identically.
     */
    legModes: z.array(TravelModeSchema).max(200).optional(),
    /**
     * Optional per-STOP date (spec 021): the day you were at each waypoint, aligned
     * to `stops` (so `stopDates[i]` dates `stops[i]`). Each entry is a vague date
     * (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`) or null for "no date". The first and last
     * non-null give the journey's start and end. Additive & optional with no
     * default, so the key is NEVER injected on parse — a trip without per-stop dates
     * (every v1–v14 file) validates and round-trips byte-identically. The trip's own
     * `date` continues to hold the representative (start) date for the log & filters.
     */
    stopDates: z
      .array(
        z
          .string()
          .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
          .nullable(),
      )
      .max(200)
      .optional(),
    // Approximate/"vague" date (spec 019): a full day `YYYY-MM-DD`, a month
    // `YYYY-MM`, or a year `YYYY` — all optional/nullable (an undated trip is fine).
    // The wider regex is a RELAXATION, so every previously-valid full-day value
    // still validates (v1–v10 files import unchanged).
    date: z
      .string()
      .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    carrier: nullableSanitized(120),
    note: nullableSanitized(2000),
    addedAt: z.string().datetime({ offset: true }),
    /** Last-mutated stamp for device sync (spec 013); see Visit.updatedAt. */
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/**
 * One journal story (Journal — a mini travel blog): a dated, titled entry about a
 * place you've been, with free text and its own small photo gallery. Personal data
 * only — the app never authors world facts here. Photos reuse PhotoSchema, so they
 * stay inline, inert data URLs that never leave the device outside an explicit export.
 */
export const StorySchema = z
  .object({
    storyId: idString,
    /**
     * The place this postcard is about. OPTIONAL as of v13 (the journal redesign):
     * you can write a dated postcard with no place at all. When present it is a
     * full PlaceRef drawn from places you've been — the composer never mints a new
     * reference place, and a blank place invents nothing (Constitution I). A
     * relaxation, so v1–v12 files (place always present) still validate; the key is
     * simply absent on a place-less postcard.
     */
    place: PlaceRefSchema.optional(),
    /**
     * Additional places this postcard spans, in order, beyond the primary `place`
     * (a travel day: Paris → Reims → back). Additive & optional, never injected on
     * parse; drawn from places you've been (mints nothing). Read-side membership
     * uses `placesOf(story) = [place, ...extraPlaces]`.
     */
    extraPlaces: z.array(PlaceRefSchema).max(MAX_PLACES_PER_STORY - 1).optional(),
    /** The day the postcard is about — required (the start day of any range). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /**
     * Optional range END day. Additive & optional and NEVER injected on parse (no
     * default, no null transform) so v1–v12 files round-trip byte-identically:
     * absent, or ≤ `date`, means a single-day postcard; a later day spans a range.
     */
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    // Title AND text are both optional so a journal entry can be image-only. Each
    // stays a (possibly empty) string — no key ripple for consumers — and the
    // whole-story refine below still requires a title, some text, OR a photo, so a
    // completely empty story can't be created or imported.
    title: z
      .string()
      .max(200)
      .transform((s) => sanitizeText(s, 200))
      .optional()
      .transform((s) => s ?? ""),
    text: z
      .string()
      .max(8000)
      .transform((s) => sanitizeText(s, 8000))
      .optional()
      .transform((s) => s ?? ""),
    /**
     * Optional folder label (e.g. "Japan 2024") that groups stories under one
     * name in the feed. Additive & optional exactly like a Trip's `name` and the
     * `updatedAt` stamp: absent on older files and NOT injected on parse (the
     * transform returns `undefined`, so no `folder` key is written), which keeps
     * v1–v7 files validating and round-tripping byte-identically. Sanitized to
     * inert text when present; a value that sanitizes away is dropped rather than
     * stored empty.
     */
    folder: optionalLabel(),
    photos: z.array(PhotoSchema).max(MAX_PHOTOS_PER_STORY).optional(),
    /**
     * Personal tags (mood, weather, free labels). Additive & optional, never
     * injected on parse. Personal data, not reference data (Constitution I).
     */
    tags: z.array(tagString).max(MAX_TAGS_PER_STORY).optional(),
    /**
     * Optional link to one reconstructed Trip (its `tripId`). Additive & optional;
     * a bare reference — a dangling id (trip since deleted) is resolved to "no trip"
     * by the UI, never an error.
     */
    tripId: idString.optional(),
    addedAt: z.string().datetime({ offset: true }),
    /** Last-mutated stamp for device sync (spec 013); see Visit.updatedAt. */
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  // A story must carry SOMETHING: a title, some text, or at least one photo. This
  // lets an image-only entry through (photos, no title/text) while still rejecting
  // a completely empty story on create or import.
  .refine((s) => s.title.trim().length > 0 || s.text.trim().length > 0 || (s.photos?.length ?? 0) > 0, {
    message: "A story needs a title, some text, or a photo",
  });

/**
 * A deletion marker carried inside the portable file so a delete on one device
 * propagates to others instead of the record being re-added on the next sync
 * (spec 013, FR-009). `kind` says which collection the `id` belongs to; the array
 * is additive & optional, so a plain backup that predates sync still validates and
 * a human can still read the file. Subject to a conservative retirement horizon.
 */
export const SyncTombstoneSchema = z
  .object({
    kind: z.enum(["visit", "trip", "story"]),
    id: idString,
    deletedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const ReferenceSourceSchema = z
  .object({
    dataset: z.string().max(100),
    license: z.string().max(100),
    version: z.string().max(50),
    url: z.string().max(300).optional(),
  })
  .strict();

export const PostcardsFileSchema = z
  .object({
    format: z.literal(FORMAT),
    schemaVersion: z.number().int().min(1),
    exportedAt: z.string().datetime({ offset: true }),
    // Element caps bound a hostile/oversized file (which the SAME parser runs on
    // every device-sync pull, so an unbounded array would re-OOM the WebView each
    // pull). The limits sit far above any real journal so a genuine backup always
    // restores — they only stop a "millions of empty records" denial-of-service.
    visits: z.array(VisitSchema).max(200_000),
    // Additive & optional: files predating the travel log import unchanged.
    trips: z.array(TripSchema).max(200_000).optional().default([]),
    // Additive & optional: files predating the journal import unchanged.
    stories: z.array(StorySchema).max(200_000).optional().default([]),
    // Additive & optional: deletion markers for device sync (spec 013). A plain
    // backup carries none; a sync file carries the current, un-retired set. Left
    // undefaulted so a normal export stays free of an empty `tombstones` key.
    tombstones: z.array(SyncTombstoneSchema).max(500_000).optional(),
    referenceSources: z.array(ReferenceSourceSchema).max(10_000).optional().default([]),
  })
  .strict();

export type PlaceKind = z.infer<typeof PlaceRefSchema>["kind"];
export type PlaceRef = z.infer<typeof PlaceRefSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Visit = z.infer<typeof VisitSchema>;
export type TravelMode = z.infer<typeof TravelModeSchema>;
export type Trip = z.infer<typeof TripSchema>;
export type Story = z.infer<typeof StorySchema>;
export type SyncTombstone = z.infer<typeof SyncTombstoneSchema>;
export type ReferenceSource = z.infer<typeof ReferenceSourceSchema>;
export type PostcardsFile = z.infer<typeof PostcardsFileSchema>;

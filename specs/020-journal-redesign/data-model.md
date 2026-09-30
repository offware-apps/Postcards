# Phase 1 Data Model: Journal Redesign — postcards

The one persisted entity that changes is the journal entry — user-facing name **Postcard**
(internal Zod type may keep the name `Story`). All changes are **additive or relaxing** and
require a single `SCHEMA_VERSION` bump (12 → 13). No other entity changes.

## Entity: Postcard (internal `Story`)

`src/lib/schema/models.ts` — `StorySchema` (`.strict()`, keeps its title/text/photo refine).

| Field | Before | After | Notes |
|-------|--------|-------|-------|
| `storyId` | `idString` (req) | unchanged | opaque id |
| `place` | `PlaceRefSchema` (**required**) | `PlaceRefSchema.optional()` | **relaxed** — the primary place; may be absent |
| `extraPlaces` | — | `z.array(PlaceRefSchema).max(MAX_PLACES_PER_STORY - 1).optional()` | **new** — additional ordered places beyond the primary |
| `date` | `regex YYYY-MM-DD` (req) | unchanged | the (start) day; still required |
| `endDate` | — | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()` | **new** — range end; absent/null/≤`date` ⇒ single-day |
| `title` | optional → `""` | unchanged | optional |
| `text` | optional → `""` | unchanged | optional |
| `tags` | — | `z.array(tagString).max(MAX_TAGS_PER_STORY).optional()` | **new** — sanitized bounded strings; mood/weather are preset values |
| `tripId` | — | `idString.optional()` | **new** — reference to one `Trip.tripId`; dangling ⇒ treated as none |
| `folder` | `optionalLabel()` | unchanged | optional |
| `photos` | `array(PhotoSchema).max(24).optional()` | unchanged | inline data-URL photos |
| `addedAt` | datetime (req) | unchanged | creation stamp |
| `updatedAt` | datetime optional | unchanged | sync stamp |

### New constants (`src/lib/schema/helpers.ts`)

- `SCHEMA_VERSION = 13` (was 12) — with a version-history note: "v13 — journal redesign:
  `Story.place` optional; add optional `extraPlaces`, `endDate`, `tags`, `tripId`."
- `MAX_PLACES_PER_STORY = 24` (primary + extras combined).
- `MAX_TAGS_PER_STORY = 24`, `MAX_TAG_LEN = 40`.

### New builder

- `tagString` — a sanitized, bounded, non-empty label: `z.string().min(1).max(MAX_TAG_LEN)
  .transform(s => sanitizeText(s, MAX_TAG_LEN)).refine(s => s.length > 0)`. (Mirrors the
  place-name sanitize-then-refine at models.ts 33-40.)

### Validation rules (unchanged where not noted)

- **Content still required**: the existing refine (title OR text OR ≥1 photo) is unchanged;
  a postcard with no content cannot be created/imported, independent of place/tags/trip.
- **Place, when present**, is a full `PlaceRefSchema` drawn from places the user has been;
  the composer never mints a new reference place; a blank place persists nothing (aggregator).
- **Range**: an `endDate` earlier than or equal to `date`, or absent/null, means single-day.
- **Tags** are sanitized on parse; empty/whitespace tags are dropped; the array key is
  omitted when empty (conditional-carry).
- **`tripId`** is not referentially enforced by the schema — a deleted trip leaves a dangling
  id that the UI resolves to "no trip"; it never throws.
- `.strict()` still rejects unknown keys; new keys are the reason for the version bump.

## Derived helpers (new pure module `src/features/journal/postcardModel.ts`)

Not persisted — pure functions the read side and composer share:

- `placesOf(story): PlaceRef[]` → `[story.place, ...(story.extraPlaces ?? [])].filter(Boolean)`.
- `primaryPlace(story): PlaceRef | null` → `story.place ?? story.extraPlaces?.[0] ?? null`.
- `dateSpan(story): { start: string; end: string | null }` → `{ start: story.date, end:
  (story.endDate && story.endDate > story.date) ? story.endDate : null }`.
- `isUnplaced(story): boolean` → `placesOf(story).length === 0`.

These localize every "assumes single required place / single date" site identified in the
read-side survey (Feed, By place, Timeline, Map, Calendar, folders, search/filter, Markdown
export, and the Publish bundle).

## Store changes (`src/lib/store/useStories.ts`)

- `addStory` input: `place: PlaceRef` → `place?: PlaceRef | null`; add optional
  `extraPlaces?`, `endDate?`, `tags?`, `tripId?`. Guard `stampPlaceCoords` when `place` is
  absent; stamp each `extraPlaces` entry too. Conditional-carry each new field (omit when
  empty), matching the existing `folder`/`photos` handling.
- `updateStory` `Partial<Pick<Story, …>>` gains `place | extraPlaces | endDate | tags |
  tripId`; the coord-restamp guard runs when `place`/`extraPlaces` change.
- `removeStory` tombstone (`kind: "story"`) unchanged. Sort still keys on start `date`.

## Migration & portability

- **Older files (≤ v13 written by older apps)**: every new field is `.optional()` with no
  default → old files validate unchanged; existing entries keep their (present) place.
- **New place-less / multi-place / ranged / tagged / trip-linked files**: validate and
  round-trip through export (`exportJson`) and import (`importJson`) and the zip archive
  (`archiveZip`) with no loss. The story-emptiness re-check on zip restore still applies
  (content rule), independent of place.
- **JSON Schema artifact** (`portable-file.schema.json`) regenerated via `pnpm schema`;
  `schemaArtifact` test guards drift.
- The canonical human-readable JSON stays the format at rest (Principle IV); no binary/CBOR
  changes here.

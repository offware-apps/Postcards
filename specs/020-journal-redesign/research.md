# Phase 0 Research: Journal Redesign — fast, keyboard-first postcards

Grounded in two codebase passes: (A) authoring/navigation plumbing, (B) schema + five-view
adaptation surface. Each decision below is anchored to real code so Phase 1 and tasks are
low-risk. Format: **Decision · Rationale · Alternatives**.

## R1 — Composer becomes a page layer, and REPLACES the inline composer

**Decision**: Add a `storyEditId` page layer to `useUi` mirroring `openTripComposer`
(`useUi.ts`: `openStoryComposer(id)`, `closeStoryComposer()`, `storyEditId` in state +
`NavState` snapshot + every page-clearing setter + `pushHistory` + `closePages`). Render a
new `StoryComposer` in `App.tsx` as a new branch in the page ladder after the `tripEditId`
branch; add `!storyEditId` to `mapVisible` and include it in `forceTop`/`viewKey`. **Retire
the inline composer** in `JournalScreen.tsx` (the `composerOpen` form): repoint its entry
points — the toolbar "write" buttons, the `journalDraftRequest` prefill path, the
"today's story" action, and the in-page long-press — to `openStoryComposer`.

**Rationale**: `openTripComposer` is a proven, identical pattern (open → history push →
`App.tsx` render branch → central Escape via `closePages` → `onClose`/`goBack` return). One
composer over one Story store avoids two divergent authoring surfaces and is the essence of
"one focused page, no blabla." Escape/Back are handled centrally (`App.tsx` Escape branch +
`popstate`), so the page layer inherits correct back-navigation for free.

**Alternatives**: *Coexist* (keep inline + add page) — rejected: two composers drift and
double the maintenance. *A modal dialog* — rejected: not a peer of city/country pages,
breaks the established Back/Escape model and full-screen focus.

## R2 — Keyboard-first capture is the P1 mechanism

**Decision**:
- **Global "write today" shortcut**: add a `w` branch to the central `keydown` handler in
  `App.tsx` (the key is currently unused; it inherits the existing input-field and
  dialog-inert guards) → `openStoryComposer("new")`. Document it in `ShortcutsHelp`.
- **Autofocus** the content field on open; **date defaults to today**.
- **Save chord** = Ctrl/Cmd+Enter; **Save & start another** = Ctrl/Cmd+Shift+Enter, plus a
  visible "Save & new" button. "Save & new" saves, then re-opens an empty postcard dated
  today with focus in the content box (stays on the page, never returns to the feed).
- **Tab order**: content field first, then the Save actions; the optional "add details"
  attachments come *after* Save in the tab order (or inside a collapsed region), so a power
  user reaches Save immediately after typing.

**Rationale**: Directly realizes Principle VII and the spec's SC-001..SC-004 keystroke
economy. Reuses the app's single global keydown seam rather than inventing a registry.

**Alternatives**: A new shortcut-registry abstraction — rejected as over-engineering; the
app already centralizes keydown in `App.tsx`. Using Enter alone to save — rejected: the
content field is multiline, Enter must insert newlines.

## R3 — Long-press the Journal nav for "write today" (+ keyboard equivalent)

**Decision**: Special-case the `journal` tab button in the `App.tsx` bottom-nav map: attach
the pointer handlers already written in `JournalScreen.tsx` (500 ms timer, >10 px cancels,
ignores presses on interactive children). Short tap → `setTab("journal")`; long-press →
`openStoryComposer("new")`. The `w` shortcut is the keyboard-accessible equivalent.

**Rationale**: Reuses existing, tested long-press logic; a long-press has no native keyboard
analog, so a documented accelerator is the correct a11y equivalent (precedent: the `f`/`x`
accelerators back the Passport/Moments taps).

**Alternatives**: A separate always-visible "＋" — we keep a visible primary "write" control
too (FR-020); the long-press is the *accelerator*, not the only path.

## R4 — Schema: relax `place` and add optional fields (additive, backward-compatible)

**Decision** (bump `SCHEMA_VERSION` 12 → 13; `StorySchema` stays `.strict()`; the
title/text/photo refine is unchanged — it never required `place`):
- **`place`**: `PlaceRefSchema` → `PlaceRefSchema.optional()` (a relaxation, exactly like
  v10 made title/text optional). No default, key never injected.
- **`extraPlaces`**: `z.array(PlaceRefSchema).max(MAX_PLACES_PER_STORY - 1).optional()` —
  additional ordered places beyond the primary (pattern of `Trip.stops`).
- **`endDate`**: `z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()` (Visit.date
  pattern) — a range end; absent/null/≤start ⇒ single-day.
- **`tags`**: `z.array(tagString).max(MAX_TAGS_PER_STORY).optional()` where `tagString` is a
  sanitized bounded string; mood/weather are **preset tag values** (emoji-prefixed labels),
  not a separate structured type — leanest, most portable, fully inert.
- **`tripId`**: `idString.optional()` — a bare reference to one of the user's trips.
- Regenerate the JSON Schema artifact (`pnpm schema` → `portable-file.schema.json`), which
  the `schemaArtifact` test guards.

**Rationale**: Every change follows an existing precedent (v10 relaxation, v11 optional
array + regex relaxation). Because `StorySchema` is `.strict()`, a *new* key would make an
older build's version-guard reject the file gracefully — hence the version bump. Keeping
`place` as the (optional) **primary** plus an `extraPlaces` array (rather than one
`places[]`) minimizes read-side churn: existing `s.place`/`placeKey(s.place)`/sort/dedupe
keep working when a place is present, and multi-place is handled by a small `placesOf()`
helper.

**Alternatives**: *Single `places: PlaceRef[]`* — rejected: rewrites every read-side keying
(sort, dedupe, map pins) and the store's coord-stamp; higher risk for no user benefit.
*Structured `TagSchema {kind: mood|weather|label}`* — rejected for v1: string tags are
simpler, portable, and inert; mood/weather presets cover the UX without a new type. (Can be
revisited later without a breaking change.)

## R5 — Read-side adaptation via small pure helpers + an "Unplaced" bucket

**Decision**: Add a pure helper module (e.g. `journal/postcardModel.ts`) exposing
`placesOf(story): PlaceRef[]` (`[place, ...extraPlaces]` filtered), `primaryPlace(story):
PlaceRef | null`, and `dateSpan(story): { start: string; end: string | null }`. Refactor
every single-place / single-date read-side site to use them, and add an **"Unplaced"**
grouping for place-keyed views:
- **Feed card**: guard all `s.place.*` derefs; place-less shows no place link; multi-place
  shows a chip row; ranged shows `start–end`. Title/aria fallbacks use `journal.untitled…`
  instead of `place.name`.
- **By place / Map / country+destination filters**: iterate `placesOf(s)` so a postcard
  appears under each of its places; place-less lands in an "Unplaced" bucket / is skipped on
  the map.
- **Timeline / Calendar / date filter**: use `dateSpan`; calendar tints every day in the
  range and picks a dominant place across `placesOf`; place-less days get a neutral tint.
- **Folders**: already `place?`-tolerant; seed suggestions from every place and rank the
  linked trip's name first (using the new `tripId`).
- **Search**: match any place, and add tag text to the searchable string; new "By tag" and
  "By trip" optgroups mirror the existing three.
- **Markdown export** (and the Publish bundle, flagged though out of the five views): print
  optional/multiple places, the range, and tags; tolerate place-less.
- **Store**: `addStory`/`updateStory` gain the new optional fields; guard `stampPlaceCoords`
  when `place` is absent and stamp each extra place; keep the "never persist empty
  arrays/keys" conditional-carry pattern. A dangling `tripId` (deleted trip) must render as
  "no trip", never break.

**Rationale**: A handful of pure helpers localizes the change and is unit-testable; the
"Unplaced" bucket is the graceful home the spec's edge cases require. All five views keep
working (per the maintainer's "keep all five" decision).

**Alternatives**: Omitting place-less postcards from place-keyed views entirely — rejected:
they'd vanish from search/destination filters; an explicit "Unplaced" bucket is discoverable.

## R6 — Naming ("postcard") and i18n

**Decision**: Rename **values only** across en/fr/ko (keep the `journal.*` keys) so no
call-site or the `MessageKey` union changes — edit the strings that surface "story"
(`journal.todayStory`, `journal.newStory`, `journal.story`, `journal.saveStory`, the
`journal.toast.*`, `noun.story_one/_other`, `city.addStory`, …). Add new keys (composer
attachments, end date, extra places, tags, trip link, "Unplaced", By-tag/By-trip filters,
the `W` shortcut help line) to **all three** catalogs. Parity is enforced at compile time
(`MessageKey`) and by the runtime parity test.

**Rationale**: Cheapest correct rename (values-only) with zero blast radius on call sites;
new strings must land in all three locales or the build/test fails (Principle VII i18n).

**Alternatives**: Rename keys to `postcard.*` — rejected: touches every call site and both
non-English catalogs for no functional gain.

## R7 — "Near you" reuses existing geolocation, coordinates never stored

**Decision**: Reuse the existing nearby logic (`findNearby`/`nearestCities` in
`JournalScreen.tsx`) in the new composer: auto-attempt a fix on open (permission-gated),
surface a short ranked list from the on-device gazetteer, one keystroke to attach the top
suggestion. Coordinates rank places only and are never written to the postcard or
transmitted; deny/offline/slow degrades silently to optional/manual place.

**Rationale**: The behavior already exists and is privacy-clean; the redesign only moves it
onto the focused page and makes it automatic-on-open (spec 017's resolved clarification).

**Alternatives**: A new geolocation stack — unnecessary; reuse what ships.

## Resolved unknowns

- No global shortcut registry exists — the single `App.tsx` keydown handler is the seam. ✅
- No `migrate.ts` — migration is inline optional-field transforms + a version guard in
  `importJson.ts`; the version bump is what makes older files reject *newer* files gracefully
  while older files still validate. ✅
- The refine that makes an entry non-empty checks title/text/photo only, so place-optional
  needs no refine change. ✅
- All NEEDS CLARIFICATION from Technical Context are resolved; none remain.

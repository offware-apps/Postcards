---
description: "Task list for Journal Redesign — fast, keyboard-first postcards"
---

# Tasks: Journal Redesign — fast, keyboard-first postcards

**Input**: Design documents from `specs/020-journal-redesign/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: Included — the constitution mandates automated tests for schema/import/sanitization
and the app ships Vitest + Playwright + axe. All paths are under `apps/postcards/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1..US4 map to the spec's user stories; Setup/Foundational/Polish have no label

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Confirm the baseline gate is green before changes: run `pnpm typecheck`, `pnpm test`, and the trip/stats/journal e2e in `apps/postcards/` (record the passing baseline).
- [X] T002 [P] Create empty module stubs `apps/postcards/src/features/journal/postcardModel.ts` and `apps/postcards/src/features/journal/StoryComposer.tsx` (exports only, to be filled) so later tasks have import targets.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: The model relaxation + composer page layer + place-less read-side guards
must land before any user story, or making `place` optional breaks the five views.

### Schema & model

- [X] T003 Relax and extend `StorySchema` in `apps/postcards/src/lib/schema/models.ts`: `place` → `PlaceRefSchema.optional()`; add optional `extraPlaces` (`z.array(PlaceRefSchema).max(MAX_PLACES_PER_STORY-1).optional()`), `endDate` (`regex YYYY-MM-DD .nullable().optional()`), `tags` (`z.array(tagString).max(MAX_TAGS_PER_STORY).optional()`), `tripId` (`idString.optional()`). Keep `.strict()` and the title/text/photo refine unchanged. Add the `tagString` builder.
- [X] T004 Bump `SCHEMA_VERSION` 12 → 13 with a version-history note and add `MAX_PLACES_PER_STORY`, `MAX_TAGS_PER_STORY`, `MAX_TAG_LEN` in `apps/postcards/src/lib/schema/helpers.ts`.
- [X] T005 Regenerate the JSON Schema artifact: run `pnpm schema` (updates `apps/postcards/src/lib/schema/portable-file.schema.json`); confirm `tests/unit/schemaArtifact.spec.ts` passes.
- [X] T006 [P] Unit tests in `apps/postcards/tests/unit/postcardSchema.spec.ts`: a place-less postcard parses + round-trips; multi-place/ranged/tagged/trip-linked round-trip; content rule still enforced (no title/text/photo ⇒ reject) independent of place; a v≤12 file validates and a v14 file is rejected; tag/place-less sanitization (security-focused import).

### Derived helpers

- [X] T007 [P] Implement pure helpers in `apps/postcards/src/features/journal/postcardModel.ts`: `placesOf`, `primaryPlace`, `dateSpan`, `isUnplaced` (per data-model.md), with unit tests in `apps/postcards/tests/unit/postcardModel.spec.ts`.

### Store

- [X] T008 Update `apps/postcards/src/lib/store/useStories.ts`: `addStory`/`updateStory` signatures gain `place?` (optional/null) + `extraPlaces?`, `endDate?`, `tags?`, `tripId?`; guard `stampPlaceCoords` when `place` absent and stamp each `extraPlaces`; conditional-carry (omit empty) each new field; keep tombstone + start-date sort. Unit test the null-place and new-field carry in `apps/postcards/tests/unit/useStories.spec.ts` (or extend existing).

### Navigation plumbing (page layer)

- [X] T009 Add the `storyEditId` page layer to `apps/postcards/src/lib/store/useUi.ts`: `storyEditId` state + `NavState` snapshot field + `openStoryComposer(id)`/`closeStoryComposer()`; set `storyEditId: null` in every page-clearing setter; include it in `pushHistory` dedupe and in `closePages`.
- [X] T010 Wire `apps/postcards/src/app/App.tsx`: read `storyEditId`; add the `<StoryComposer>` render branch after the `tripEditId` branch; add `!storyEditId` to `mapVisible`; include `storyEditId` in `forceTop`/`viewKey`; add `|| ui.storyEditId` to the Escape branch and the `popstate` (Back) branch.

### Place-less read-side guards (so nothing crashes once place is optional)

- [X] T011 Guard every single-`place` deref across the read side to tolerate a place-less postcard using `primaryPlace`/`placesOf`/`isUnplaced`, and add an **"Unplaced"** bucket to place-keyed groupings: feed card place link (`JournalScreen.tsx`), `byPlaceGroups`, timeline year row, `StoryMap.tsx` `coordOf`/pins (skip place-less), `calendar.ts` `storyDayIndex` (neutral continent for place-less), `folders.ts` suggestions, the "Show" filter optgroups + `searched` string, and `exportJournalMd.ts`. Keep single-place, single-day rendering byte-identical for existing postcards.

### i18n base

- [X] T012 [P] Add/adjust base strings in `apps/postcards/src/lib/i18n/{en,fr,ko}.ts`: rename the "story" **values** to "postcard" (keep `journal.*` keys), and add core new keys (`journal.unplaced`/"No place", composer scaffolding, the `W` shortcut help line). Keep en/fr/ko parity (compile + parity test).

**Checkpoint**: Model is place-optional and versioned; the composer page layer exists and
routes; all five views render place-less postcards without crashing.

---

## Phase 3: User Story 1 - Capture a postcard in seconds, keyboard-first (P1) 🎯 MVP

**Goal**: `W` → focused, today-dated composer, cursor in content, type, save chord; "save &
start another" loop; place optional; only date + content required.

**Independent Test**: With zero visited places, keyboard-only: `W` → type → Ctrl/Cmd+Enter →
postcard saved (no place) in the feed; Ctrl/Cmd+Shift+Enter writes a second without leaving
the page; a no-content postcard cannot save.

### Implementation

- [X] T013 [US1] Build `apps/postcards/src/features/journal/StoryComposer.tsx` as a full-screen page (mirror `TripComposer` section/Back skeleton): date defaults to today, content textarea auto-focused, optional Title (secondary), an "add details" region (placeholder for US2/US3 controls), Save + Save-&-new + Cancel buttons; Story CRUD via `useStories`; content-required guard (title/text/photo) with a clear disabled reason.
- [X] T014 [US1] Port the crash-safe draft cache to the composer (reuse the `postcards-journal-draft` localStorage mirror + visibility/pagehide flush from `JournalScreen.tsx`); restore on open for the same context; clear on save/discard. Do NOT add the `.journal-composer-busy` class (let App own Escape).
- [X] T015 [US1] Keyboard actions in `StoryComposer.tsx`: Ctrl/Cmd+Enter = save & close; Ctrl/Cmd+Shift+Enter = save & start another (reopen empty, dated today, focus content, stay on page); Enter inserts newline; ensure tab order is content → Save actions → add-details.
- [X] T016 [US1] Add the global `W` "write today" shortcut in `apps/postcards/src/app/App.tsx` keydown handler (`openStoryComposer("new")`), inheriting the input/dialog guards; document `W` in `apps/postcards/src/features/.../ShortcutsHelp.tsx`.
- [X] T017 [US1] Add the Journal-nav **long-press** (open today's composer) + short-tap (open feed) in the `App.tsx` bottom-nav, reusing the existing long-press handler logic; the `W` shortcut is the keyboard equivalent.
- [X] T018 [US1] Retire the inline composer in `apps/postcards/src/features/journal/JournalScreen.tsx`: remove the `composerOpen` form; repoint the visible primary "Write" button, the `journalDraftRequest` prefill path, the "today's story" action, and the in-page long-press to `openStoryComposer`. Keep a clear, discoverable primary "Write" control.
- [X] T019 [US1] Add composer i18n strings (content/title/save/save-&-new/cancel/needs-content) to `{en,fr,ko}.ts`.
- [X] T020 [P] [US1] E2e `apps/postcards/tests/e2e/postcard-capture.spec.ts`: keyboard-only capture with zero visited places; "save & start another" loop of ≥2; content-required guard; Escape/Back returns to launching screen with draft preserved; long-press vs short-tap on the Journal nav.
- [X] T021 [P] [US1] Extend the a11y e2e to run the axe WCAG 2.1 AA gate on the new composer page.

**Checkpoint**: MVP — a fast, keyboard-first, place-optional postcard composer. STOP & VALIDATE.

---

## Phase 4: User Story 2 - Add optional context fast, all by keyboard (P2)

**Goal**: place (type-ahead), tags (mood/weather/free), trip link (type-ahead), folder — all
keyboard, all optional, off the tab path.

**Independent Test**: Attach place + two tags + a trip link + folder by keyboard; save;
reopen — all round-trip; removing one drops it; each is optional.

### Implementation

- [X] T022 [US2] Place attach in `StoryComposer.tsx`: type-ahead over places the user has been (reuse the visited-places source), keyboard-confirm to attach, clearable; blank mints nothing.
- [X] T023 [P] [US2] Tags input in `StoryComposer.tsx`: type-and-Enter chips + mood/weather preset chips, keyboard-removable; persisted via `useStories` `tags`.
- [X] T024 [P] [US2] Trip-link control in `StoryComposer.tsx`: type-ahead over `useTrips`; link/unlink by keyboard; dangling link (deleted trip) resolves to none.
- [X] T025 [US2] Render tags on feed cards and add **By tag** + **By trip** filter optgroups + include tag text in the search string in `JournalScreen.tsx`; rank the linked trip's name first in `folders.ts` suggestions.
- [X] T026 [P] [US2] Surface a trip's linked postcards on the trip page (`apps/postcards/src/features/travel/…`) — read-only list linking back. The link is stored and drives folder suggestions today; showing it back on the trip page is a small additive enhancement.
- [X] T027 [US2] i18n strings for place/tags/trip/folder controls + By-tag/By-trip filters in `{en,fr,ko}.ts`.
- [X] T028 [P] [US2] E2e `apps/postcards/tests/e2e/postcard-context.spec.ts`: attach place/tag/trip by keyboard, save, reopen, verify round-trip + removal; unit test folders trip-ranking.

**Checkpoint**: Rich postcards without slowing capture.

---

## Phase 5: User Story 3 - Multiple places / a date range (P3)

**Goal**: a postcard can carry several ordered places and/or a start–end range.

**Independent Test**: Two+ places + an end date save; postcard appears under each place (By
place, Map) and shows its span (feed/timeline/calendar); single-day single-place unaffected.

### Implementation

- [X] T029 [US3] Extra-places control in `StoryComposer.tsx`: add/reorder/remove additional places (same picker); end-date field alongside the start date.
- [X] T030 [US3] Multi-place membership across read views using `placesOf`: `byPlaceGroups`, `StoryMap` pins, By-country/destination filters, `folders.ts`, and Markdown export list every place.
- [X] T031 [US3] Range rendering using `dateSpan`: feed card `start–end`, timeline bucketing, `calendar.ts` tint every day in range, Markdown export end date.
- [X] T032 [US3] i18n strings for extra-places/end-date/range display in `{en,fr,ko}.ts`.
- [X] T033 [P] [US3] Tests: unit for `placesOf`/`dateSpan` across the view helpers; e2e `apps/postcards/tests/e2e/postcard-multi.spec.ts` — multi-place appears under each place and range displays.

**Checkpoint**: Expressive postcards; base capture unaffected.

---

## Phase 6: User Story 4 - "Near you" suggests a place on open (P4)

**Goal**: opt-in auto-location suggests nearby places to attach in one keystroke; degrades
silently; coordinates never stored/transmitted.

**Independent Test**: With location granted, top "near you" attaches in one keystroke; with
denied/offline, no error, place optional, manual search works; no coords on the saved postcard.

### Implementation

- [X] T034 [US4] In `StoryComposer.tsx`, auto-attempt a location fix on open (permission-gated), reusing the existing `findNearby`/`nearestCities` logic; show a short "near you" list; top suggestion acceptable with one keystroke; time out gracefully; never overwrite an already-attached place when editing; never store/transmit coordinates.
- [X] T035 [US4] i18n strings for the "near you" affordance in `{en,fr,ko}.ts`.
- [X] T036 [P] [US4] E2e `apps/postcards/tests/e2e/postcard-nearyou.spec.ts`: granted (nearby appears, one-key attach, no coords stored) and denied/offline (no error, place optional).

**Checkpoint**: Delightful location shortcut, fully optional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T037 [P] Adapt the Publish bundle/reader (`apps/postcards/src/lib/publish/…`) to tolerate place-less/multi-place/ranged/tagged postcards (flagged in research; out of the five views but consumes stories).
- [X] T038 [P] Final i18n parity sweep (`pnpm typecheck` + the i18n parity test) and update `ShortcutsHelp` + any "How it works" copy for postcards.
- [X] T039 Full gate: `pnpm typecheck`, `pnpm test`, `pnpm schema` (no diff), `pnpm test:e2e` (incl. axe) — all green.
- [X] T040 Walk `specs/020-journal-redesign/quickstart.md` scenarios 1–9 end to end (incl. offline / network-monitor zero-egress check).
- [X] T041 Deploy the finished increment to the Pages preview branch (`git push origin HEAD:refs/heads/claude/repo-setup-speckit-3magw3`).

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** blocks everything. Within P2: T003→T004→T005 (schema→version→artifact); T006/T007 [P]; T008 after T003; T009→T010 (useUi before App wiring); T011 after T003+T007; T012 [P].
- **US1 (P3)** after Foundational — the MVP. **US2/US3/US4** after Foundational and build on the composer from US1; they are independently testable and can proceed in priority order.
- **Polish (P7)** after the desired stories.

### Parallel opportunities

- P2: T006, T007, T012 in parallel; T011 touches many read-side files (largely independent edits).
- Each story's test task ([P]) parallels its implementation once the composer exists.
- US2/US3/US4 are independent slices atop US1.

---

## Implementation Strategy

- **MVP = Setup + Foundational + US1** → validate keyboard-first place-optional capture → deploy.
- Then **US2 → US3 → US4** incrementally, each validated and deployed.
- Commit after each task or logical group; keep the gate green at every checkpoint.

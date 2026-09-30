# Implementation Plan: Journal Redesign — fast, keyboard-first postcards

**Branch**: `020-journal-redesign` (developed on `claude/journal-redesign-spec-kit-ku0l3d`) | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-journal-redesign/spec.md`

## Summary

Make journaling *fast* and *unblocked*. Today the composer is a six-field form under the
feed and an entry cannot be saved without first picking a previously-visited place. This
plan delivers, in priority order: (P1) a **keyboard-first capture** experience on a
**focused full-screen page layer** — a "write today" shortcut opens a today-dated composer
with the cursor already in the content box, save by keyboard chord, and a "save & start
another" rapid loop, with an entry needing only a **date + content** (place optional);
(P2) fast, keyboard-driven optional context — place (type-ahead), title, folder, tags,
trip link; (P3) multiple places / a date range; (P4) opt-in "near you" place suggestions.
Entries are renamed **postcards**. Every data change is an additive, backward-compatible
schema bump; existing entries keep everything.

Technical approach: add an `openStoryComposer` page layer to the existing `useUi` history
stack (mirroring `openTripComposer`), build a new full-screen composer component, add a
small global keyboard-shortcut seam plus a Journal-nav long-press (with keyboard
equivalent), relax `StorySchema.place` to optional and add optional `places[]`, `endDate`,
`tags[]`, and `tripId`, bump `SCHEMA_VERSION`, and adapt the five read views + export to
render the new postcard shapes gracefully (a "No place" bucket, multi-place membership,
ranged display). All offline, inert, and WCAG 2.1 AA with en/fr/ko parity.

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19, Vite (Rolldown) build.

**Primary Dependencies**: Zustand (state stores), `idb` (IndexedDB working store), Zod
(schema → generated JSON Schema), MapLibre GL JS (main map; the journal's own StoryMap is
dependency-free inline SVG), a hand-rolled i18n layer (en/fr/ko with compile-time
`MessageKey` parity). No new runtime dependency is required by this feature.

**Storage**: IndexedDB working store; canonical portable **JSON** document is the source of
truth (export/import, versioned schema); **Markdown** export for human sharing. Photos are
bounded inline data URLs on the record.

**Testing**: Vitest (unit — schema/migration/store/pure helpers), Playwright + axe-core
(e2e + WCAG 2.1 AA gate). `schema` npm script regenerates the JSON Schema artifact under test.

**Target Platform**: Self-hostable PWA + native iOS/Android via Capacitor; desktop keyboard
users are first-class. Fully offline.

**Project Type**: Web-first single codebase (PWA + Capacitor wrapper) — the workspace app
`apps/postcards/`.

**Performance Goals**: Interactions feel instantaneous (Principle VII). P1 targets: "write
today" → cursor in an empty dated postcard in ≤ 1 second / one action; a text postcard
saved keyboard-only with no field navigation; 5 postcards in a row via "save & start
another" without a pointer.

**Constraints**: Zero network for all behavior (no telemetry, no egress of content or
location); device location used only on-device and never stored/transmitted; WCAG 2.1 AA;
i18n en/fr/ko parity enforced at compile time; imported data inert & schema-validated;
additive, backward-compatible schema evolution (old files still validate).

**Scale/Scope**: Personal dataset (hundreds–low-thousands of postcards); one new full-screen
page layer; five existing read views + Markdown export adapted; ~5 additive/relaxed schema
fields; new user-facing "postcard" vocabulary across three locales.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | How this feature complies |
|-----------|---------|---------------------------|
| **I. Aggregator, never an author** | ✅ Pass | An optional/blank place mints **nothing**; attaching a place still draws only from places the user has been. Tags and mood/weather are **personal** data on the user's own record, not reference facts. "Near you" ranks the **existing** on-device gazetteer — no new reference dataset. |
| **II. Local-first & decentralized** | ✅ Pass | No server, no account; the whole flow works offline. Trip links and place references point at the user's own local records/reference data. |
| **III. Privacy by default** | ✅ Pass | No telemetry. Device coordinates are used only on-device to rank nearby places, never written to a postcard, never transmitted. Location is opt-in and permission-gated; degrades silently. |
| **IV. One portable, human-readable file** | ✅ Pass | All changes are additive/relaxing to the canonical JSON; `SCHEMA_VERSION` bumped and documented; full export/import round-trip preserved (SC-007, SC-011). Markdown export retained. |
| **V. Zero lock-in** | ✅ Pass | No new proprietary/cloud dependency; no new runtime dep at all. Geolocation is the platform's standard permission-gated API. |
| **VI. Security by design — inert data** | ✅ Pass | New/relaxed fields are validated + sanitized on import exactly like existing ones; place-optional and new arrays are parsed, never executed; malformed → rejected. Import/sanitization gets tests. |
| **VII. Efficient, accessible, keyboard-first** | ✅ Pass — **and is the P1** | The entire redesign optimizes the frequent action to near-zero overhead: global "write today" shortcut, autofocus, save chord, "save & start another", type-ahead attachments off the tab path. Every shortcut has a visible equivalent; WCAG 2.1 AA gate; reduced-motion respected; controls carry title/aria-label. |
| **VIII. Interoperable & AI-friendly** | ✅ Pass | Schema stays open, self-describing, versioned; the generated JSON Schema is updated so external tools/agents read the new shape. |

**Scope discipline** (Workflow): This is journaling — storing the user's own memories and
displaying them well. It adds no trip-planning, social, or server-backed behavior. The
trip *link* only references an already-reconstructed retrospective trip; it plans nothing.

**Result: PASS — no violations, no Complexity Tracking entries required.**

**Post-design re-check (after Phase 1)**: Still PASS. The design adds no new runtime
dependency, no network path, and no reference-data authoring: the page layer reuses the
existing `useUi` history model; the keyboard seam reuses the existing global keydown handler;
schema changes are additive/relaxing with a version bump and full round-trip; "near you"
reuses the shipped on-device gazetteer and never stores coordinates; tags are personal
strings. Principle VII is actively advanced (keyboard-first is the P1).

## Project Structure

### Documentation (this feature)

```text
specs/020-journal-redesign/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature spec (/speckit-specify)
├── research.md          # Phase 0 output (/speckit-plan)
├── data-model.md        # Phase 1 output (/speckit-plan)
├── quickstart.md        # Phase 1 output (/speckit-plan)
├── contracts/           # Phase 1 output (/speckit-plan) — schema + UX contracts
└── checklists/
    └── requirements.md  # Spec quality checklist (passing)
```

### Source Code (repository root)

```text
apps/postcards/
├── src/
│   ├── app/
│   │   └── App.tsx                     # add the StoryComposer page-layer render branch
│   ├── features/
│   │   └── journal/
│   │       ├── JournalScreen.tsx       # remove inline composer; feed/views adapt to new shapes
│   │       ├── StoryComposer.tsx       # NEW — the focused full-screen page-layer composer
│   │       ├── StoryMap.tsx            # adapt coordOf/pins for place-less/multi-place
│   │       ├── calendar.ts             # adapt storyDayIndex/dayIntensity for range + place-less
│   │       ├── folders.ts              # unchanged / suggestion inputs adapt
│   │       └── exportJournalMd.ts      # adapt to print optional place, range, tags
│   ├── lib/
│   │   ├── schema/
│   │   │   ├── models.ts               # StorySchema: place optional; add places[]/endDate/tags[]/tripId
│   │   │   └── helpers.ts              # SCHEMA_VERSION bump + version-history note
│   │   ├── store/
│   │   │   ├── useStories.ts           # add/update signatures for new optional fields
│   │   │   └── useUi.ts                # NEW openStoryComposer/storyComposer state + history wiring
│   │   ├── shortcuts/ (or hooks/)      # global "write today" keyboard-shortcut seam (+ visible equivalent)
│   │   └── i18n/{en,fr,ko}.ts          # "postcard" vocabulary + new composer/attachment strings
│   └── ...
└── tests/
    ├── unit/                           # schema/migration/store/date-range/tags/link + composer helpers
    └── e2e/                            # keyboard-capture, save-&-new, page-layer Back/Escape, a11y gate
```

**Structure Decision**: Single-codebase web/mobile app (`apps/postcards/`). The feature lives
under `src/features/journal/` (new `StoryComposer.tsx` page + adapted views), with the model
change in `src/lib/schema/`, navigation in `src/lib/store/useUi.ts`, a small keyboard-shortcut
seam under `src/lib/`, and strings in `src/lib/i18n/`. This mirrors the existing trip-composer
page layer (`src/features/travel/TripComposer.tsx` + `useUi.openTripComposer`), which is the
proven template for a focused full-screen authoring page.

## Complexity Tracking

> No Constitution Check violations — this section is intentionally empty.

---

*Phase 0 (research.md) and Phase 1 (data-model.md, contracts/, quickstart.md) follow, grounded
in the two codebase-research passes on (a) authoring/navigation plumbing and (b) the schema +
read-side adaptation surface.*

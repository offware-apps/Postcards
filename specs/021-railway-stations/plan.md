# Implementation Plan: Railway stations as a place type

**Branch**: `021-railway-stations` (developed on `claude/journal-redesign-spec-kit-ku0l3d`) | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-railway-stations/spec.md`

## Summary

Add railway stations as a first-class reference place type by **mirroring the existing
airport integration** end to end: a new `station` place `kind`, a `Station` reference type
and reference-seam methods (load / getById / search / per-country counts), map markers,
a Places "Stations" browse filter, per-country stats coverage, and use in the journal place
picker and trip stops (station→station train legs). Reference data is **Wikidata railway
stations (CC0)** produced by the existing `scripts/build-railways.mjs` into a bundled
`public/reference/railways.json`; the app authors nothing. Because the Wikidata fetch is
blocked in this environment, integration is built and tested **against a small committed
fixture**, so the moment `railways.json` is produced on a networked machine, real stations
light up everywhere. Additive, backward-compatible schema bump (v13 → v14); older files load
unchanged; everything works fully offline.

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19, Vite.

**Primary Dependencies**: Zustand, `idb`, Zod (schema → generated JSON Schema), MapLibre GL
JS + the app's marker layers, the hand-rolled i18n layer (en/fr/ko parity). **No new runtime
dependency** — stations reuse the airport machinery.

**Storage**: IndexedDB working store; canonical portable JSON (+ Markdown export). The station
dataset is a bundled static reference file (`public/reference/railways.json`), read on-device;
no runtime network calls.

**Testing**: Vitest (schema/reference/search/stats units + a station fixture), Playwright +
axe (offline station flow, Places browse, map, trip stop, a11y). `pnpm schema` regenerates the
JSON Schema artifact.

**Target Platform**: Self-hostable PWA + Capacitor iOS/Android; fully offline.

**Project Type**: Web-first single codebase (`apps/postcards/`).

**Performance Goals**: Station search feels instant against a few-thousand-row dataset; map
marker density managed exactly like airports; interactions instantaneous (Principle VII).

**Constraints**: Zero network for the whole flow (no telemetry, no egress); reference data
only from a named openly-licensed dataset with provenance (Wikidata CC0); additive
backward-compatible schema (older files still validate); imports inert & validated; WCAG 2.1
AA; i18n en/fr/ko parity at compile time.

**Scale/Scope**: One new `kind` threaded through ~10 airport touch-points; a few-thousand-row
bundled dataset (built externally); a small in-repo fixture for dev/tests until the real file
lands.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How this feature complies |
|-----------|---------|---------------------------|
| **I. Aggregator, never an author** | ✅ Pass | Station facts + per-country totals come solely from **Wikidata (CC0)** via a standalone build with recorded provenance; the app authors none. Missing data stays in the dataset build, not app code. |
| **II. Local-first & decentralized** | ✅ Pass | Stations are a bundled offline file; no server, no account; the whole flow works with no network. |
| **III. Privacy by default** | ✅ Pass | No telemetry; no new egress. Marking/searching stations touches only on-device data. |
| **IV. One portable, human-readable file** | ✅ Pass | A new place `kind` is additive; `SCHEMA_VERSION` bumped (13→14) and documented; older files validate unchanged; a station record round-trips through export/import. |
| **V. Zero lock-in** | ✅ Pass | Open CC0 dataset, open components; no proprietary/Google deps; no new runtime dependency. |
| **VI. Security by design — inert data** | ✅ Pass | Imported station references validated + sanitized like every PlaceRef; parsed, never executed; a personal record naming an absent station still loads from its stored name/country. |
| **VII. Efficient, accessible, keyboard-first** | ✅ Pass | Reuses the airport search/marker/browse mechanics (already keyboard-first + WCAG-gated); station search via the existing search shortcut; new controls meet WCAG 2.1 AA. |
| **VIII. Interoperable & AI-friendly** | ✅ Pass | Schema stays open/versioned; the generated JSON Schema is updated so external tools read the new kind; the dataset is a documented, provenance-stamped file. |

**Scope discipline** (Workflow): This stores + displays places (stations) and their coverage.
It adds **no** live train times, routing, or trip-planning — a station is just another place;
a train leg is retrospective, reusing the existing per-leg train mode. In scope.

**Result: PASS — no violations, no Complexity Tracking entries required.**

## Project Structure

### Documentation (this feature)

```text
specs/021-railway-stations/
├── plan.md              # This file
├── spec.md              # Feature spec
├── research.md          # Phase 0 (grounded in the airport-integration map)
├── data-model.md        # Phase 1 — Station type + PlaceRef kind change
├── quickstart.md        # Phase 1 — validation scenarios (fixture + offline)
├── contracts/           # Phase 1 — dataset shape + place-type integration contract
└── checklists/requirements.md   # Spec quality checklist (passing)
```

### Source Code (repository root)

```text
apps/postcards/
├── scripts/
│   └── build-railways.mjs              # EXISTS — produces public/reference/railways.json (run where Wikidata is reachable)
├── public/reference/
│   └── railways.json                   # bundled dataset (external build); a small fixture stands in for dev/tests
├── src/
│   ├── lib/schema/
│   │   ├── models.ts                   # PlaceRef kind enum += "station"
│   │   └── helpers.ts                  # SCHEMA_VERSION 13 → 14 + note
│   ├── lib/reference/
│   │   ├── types.ts                    # Station interface + ReferenceData station methods
│   │   └── referenceData.ts            # load/index/search railways.json; stationById/searchStations/per-country counts
│   ├── features/visits/
│   │   ├── search.ts                   # include stations in unified place search
│   │   └── PlacesScreen.tsx            # a "Stations" browse category (peer to Airports)
│   ├── features/map/                   # station marker style (distinct from city/airport) + density
│   ├── features/stats/                 # per-country stations coverage metric
│   ├── features/city/CityScreen.tsx    # station detail (shared place page)
│   ├── features/travel/                # station as a valid trip stop (coordsOf/myPlaces/distance) + picker
│   ├── features/journal/               # station attachable via the postcard place picker (mostly free via search)
│   └── lib/i18n/{en,fr,ko}.ts          # "Stations" labels + placeFlag (🚉)
└── tests/
    ├── unit/                           # schema kind, reference load/search, per-country counts (fixture)
    └── e2e/                            # offline search+mark, Places Stations, map marker, trip stop, a11y
```

**Structure Decision**: Single-codebase app. The change threads one new `kind` through the
existing airport touch-points (schema → reference seam → search → map → Places → stats →
detail → trips/journal → i18n), plus a bundled dataset produced by the existing build. This
mirrors how spec 002 added airports/monuments, so the surface is known and bounded.

## Complexity Tracking

> No Constitution Check violations — intentionally empty.

---

*Phase 0 (research.md) and Phase 1 (data-model.md, contracts/, quickstart.md) follow, grounded
in a codebase pass mapping every airport integration point to its station equivalent.*

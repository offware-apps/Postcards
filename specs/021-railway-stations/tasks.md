---
description: "Task list for Railway stations as a place type"
---

# Tasks: Railway stations as a place type

**Input**: Design docs from `specs/021-railway-stations/` · **Tests**: included (constitution).
All paths under `apps/postcards/`. Built against a dev fixture until `pnpm railways` runs.

> **Status: implemented + real data.** All tasks landed. The dev fixture was
> replaced with the real **Trainline EU open stations database** (ODbL, ~44k
> European stations) — the only worldwide-open station set reachable from the build
> sandbox (Wikidata/OSM/GeoNames are all egress-blocked here). `scripts/build-railways.mjs`
> builds it (`--source=trainline`, default) and also keeps the worldwide
> `--source=wikidata` path for an open-network run.
>
> Per the maintainer's steer ("people choose what they display, with a recommended
> one"), stations are now a **user-selectable data source** in Settings → Places
> (`src/lib/reference/stationSources.ts`, data-driven so a worldwide file added later
> appears automatically; default = Trainline, recommended; "None" unloads them live
> via `setStationData`).
>
> The per-story e2e tasks are consolidated into `tests/e2e/stations.spec.ts` (offline
> search+mark with zero egress; strip + map mode + Places browse; station as a train
> trip stop; Settings source switch), with per-country coverage and "transit ≠
> visiting" in `tests/unit/stats.spec.ts`. Full gate green: `pnpm typecheck`, 491 unit
> tests, `pnpm schema`, 70 e2e.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Commit a small dev fixture `apps/postcards/public/reference/railways.json` (`{_source, stations[]}` — a few well-known mainline stations, real names + approximate public coords, `subdivisionId:null`, `_source.note` marking it a placeholder for `pnpm railways`); add a Wikidata-stations provenance entry to `src/lib/reference/data/provenance.json`.

## Phase 2: Foundational (blocks all stories)

- [x] T002 Schema: add `"station"` to the `PlaceRef.kind` enum in `src/lib/schema/models.ts`; bump `SCHEMA_VERSION` 13→14 with a v14 note in `src/lib/schema/helpers.ts`; run `pnpm schema` to regenerate the JSON Schema artifact. Unit test: a `station` PlaceRef round-trips + an older-version file still validates (`tests/unit/postcardSchema` or a new `stationSchema.spec.ts`).
- [x] T003 Reference seam: add the `Station` interface + `allStations/stationById/searchStations/stationsOf` to `src/lib/reference/types.ts`; implement in `src/lib/reference/referenceData.ts` (STATIONS_URL, IndexedStation, index, raw-id `stationById`, name-only `searchStations` modeled on `searchHeritage`, `stationsOf` filter, eager load mapping `{stations}` in the `Promise.all`, thread through `initReferenceDataSync`). Unit tests `tests/unit/stations.spec.ts`: load/index the fixture, id lookup, name search, per-country filter, graceful empty when absent.
- [x] T004 Coord + glyph: add a `station` branch to the five resolvers (`travel/distance.ts`, `travel/myPlaces.ts` (+ `placeFlag` → 🚉), `lib/reference/placeCoords.ts`, `journal/StoryMap.tsx`, `backup/exportCsv.ts`) via `ref.stationById`. Unit test coords + stamping.

## Phase 3: US1 — find + mark a station offline (P1) 🎯 MVP

- [x] T005 [US1] `src/features/visits/search.ts`: add a `stationResults` block (name = `s.name`, detail = region/country, `kind:"station"`) to unified search + the country-intent branch; no IATA fast path.
- [x] T006 [US1] `src/features/visits/PlacesScreen.tsx` `placeMeta` + row glyph for `station`; `src/features/filter/applyFilters.ts` `populationFor` exempt for stations; so a marked station lists/displays correctly.
- [x] T007 [US1] Base i18n station strings (`places.meta.station`, glyph help) in `{en,fr,ko}.ts`.
- [x] T008 [P] [US1] E2e `tests/e2e/stations.spec.ts`: offline — search a fixture station, mark visited, see it in visited places, zero external requests.

## Phase 4: US2 — map markers + Places browse (P2)

- [x] T009 [US2] Map: `stationPoints` in `src/features/map/visitedLayers.ts`; in `src/features/map/MapView.tsx` add `MapMode` "stations", `MODE_LAYERS`, `makeStationDot/Pin`, `ensureStationImages`, `stations-all`/`stations` layers + sources + `styleimagemissing` + `applyMode` zoom gate + `applyViewportPoi` + `applyVisited` + `poiKey` + hit-test/`hasPage`; `src/features/map/MapScreen.tsx` POI branch + mode pill + heading + `visitedOf` type.
- [x] T010 [US2] Places browse: `Kind`/`KINDS` in `PlacesScreen.tsx`; `FilterMode` + `loadMode` in `src/lib/store/useFilters.ts`; `BrowseKind` + a stations branch in `src/features/visits/browseList.ts`; `placeMatches` mode gate in `applyFilters.ts`; `isBrowseKind` sites; `PlacesView` "stations" in `useUi.ts`.
- [x] T011 [P] [US2] E2e: Stations browse lists + filters; a station marker renders on the map; a11y gate.

## Phase 5: US3 — per-country coverage + KPI (P3)

- [x] T012 [US3] `src/features/stats/computeStats.ts`: add `stationsVisited` (global KPI, distinct visited station ids) and `CountryCoverage.stationTotal/stationVisited` via `ref.stationsOf(iso2)`; keep stations excluded from `visitedCountryIds`/bands/records (transit ≠ visiting).
- [x] T013 [US3] `StatsView.tsx` KPI tile + `StatStrip.tsx` counter + a country-card stations metric; `openWorld("stations")`/`view="stations"`; i18n `stats.kpi.stations`, `statStrip.stations`, country-card labels.
- [x] T014 [P] [US3] E2e: marking a station increments its country's stations coverage; a stationless country shows none.

## Phase 6: US4 — journal + trips (P4)

- [x] T015 [US4] `src/features/travel/MyPlacesPicker.tsx` search filter += `"station"`; `PlacePicker.tsx` callers include `"station"`; `TravelScreen.tsx` endpoint label uses `p.name` for stations; `CityScreen.tsx` station detail fall-through (resolve, coords/country, header tag, nearby); decide `CITY_PAGE_KINDS` (follow airport). i18n for detail/labels.
- [x] T016 [P] [US4] E2e: attach a station to a postcard; add two stations as trip stops with a train leg drawn + measured.

## Phase 7: Polish

- [x] T017 [P] Graceful-degradation test (rename/remove fixture → no stations, no errors, other kinds unaffected); full gate `pnpm typecheck` + `pnpm test` + `pnpm schema` + `pnpm test:e2e`; i18n parity; a11y.
- [x] T018 Deploy the finished increment to the Pages preview branch.

---

## Dependencies
Setup → Foundational (T002→T003→T004) blocks all. US1 (MVP) → US2 → US3 → US4 → Polish, each
independently testable atop the foundation. Real data (`pnpm railways`) is orthogonal — the
fixture drives dev/tests.

## MVP
Setup + Foundational + US1 = search and mark a mainline station fully offline. Ship, then layer
US2–US4.

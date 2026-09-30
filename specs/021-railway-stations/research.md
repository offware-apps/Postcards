# Phase 0 Research: Railway stations as a place type

Grounded in a full codebase pass mapping every "airport" integration point. Format:
**Decision · Rationale · Alternatives**.

## R1 — Station reference shape mirrors the dataset, not `Airport`

**Decision**: Add a `Station` interface `{ id, name, countryIso2, subdivisionId, lat, lon }`
(the exact shape `scripts/build-railways.mjs` emits) — NOT a copy of `Airport` (which has a
`city` field and no `subdivisionId`). `id` is a Wikidata QID (e.g. `Q1234`), so it is treated
as opaque and never upper-cased (unlike IATA airport ids).

**Rationale**: The build script already fixes the row shape; the app must match it. QIDs aren't
codes, so no IATA-style code search.

**Alternatives**: Reuse `Airport` verbatim — rejected (wrong fields, code semantics).

## R2 — Reference seam mirrors HERITAGE search, not airport

**Decision**: `ReferenceData` gains `allStations()`, `stationById(id)`, `searchStations(q,
limit)`, and `stationsOf(iso2)`. Loading rides the existing eager `Promise.all` in
`initReferenceData` (mapping the `{stations:[…]}` wrapper to its array). `searchStations` is a
name-only prefix/contains search modeled on `searchHeritage` (no IATA code buckets).
`stationById` looks up by raw id (no `.toUpperCase()`).

**Rationale**: Stations have names, not codes; heritage's search shape is the right precedent.
`stationsOf(iso2)` is added (airports lack it) because per-country station coverage needs it.

**Alternatives**: Copy `searchAirports` — rejected (IATA code logic is meaningless for QIDs).

## R3 — Build + test against a clearly-labeled dev fixture

**Decision**: Commit a small `public/reference/railways.json` **development fixture** — a
handful of well-known mainline stations with their real names and approximate public
coordinates, `subdivisionId: null`, and ids/`_source.note` that loudly mark it as a placeholder
to be replaced by `pnpm railways`. The app loads it exactly like the real file, so the whole
integration (search, map, Places, stats, trips) is exercisable and testable **offline now**.
When run where Wikidata is reachable, `pnpm railways` overwrites it with the authoritative
Wikidata CC0 dataset.

**Rationale**: The egress policy blocks the Wikidata fetch here, but the *integration* is what's
being built. A fixture unblocks development and tests without waiting on the data. It is
scaffolding (like a test fixture), explicitly not claimed as the authoritative dataset — the
`_source` block says so — so it does not make the app an author of reference data (the
authoritative data still comes from the named CC0 source via the build).

**Alternatives**: (a) Ship nothing until the real file exists — rejected: leaves the whole
feature untestable and unverifiable. (b) A test-only fixture injected past the fetch — rejected:
e2e loads the real app, which fetches `railways.json`; a bundled fixture is the honest,
end-to-end path and FR-017 already requires graceful "no file" degradation, which we also test.

## R4 — Per-country coverage (heritage pattern); a station does NOT mark a country visited

**Decision**: Stations contribute a per-country **"stations visited / total"** coverage figure
(dataset total via `stationsOf(iso2)`, visited via the user's visited station ids) — the
**heritage** pattern — plus a global "stations visited" KPI (the **airport** pattern). But
visiting a station **does not** mark the country as visited (it's excluded from
`visitedCountryIds`, exactly like airports — passing through a station isn't visiting a country).

**Rationale**: Matches the spec (US3/FR-010: stations count toward coverage) while staying
faithful to the app's established "transit ≠ visiting" rule for airports. Coverage is derived
from the dataset only — no invented totals (Constitution I).

**Alternatives**: (a) Make a station mark the country visited — rejected (inconsistent with
airports; over-counts). (b) No per-country coverage, KPI only — rejected (spec requires it).

## R5 — Detail page, glyph, and openable surfaces mirror airports

**Decision**: A station opens the shared `CityScreen` detail page (resolved by id fall-through
after city/monument/airport). Glyph is **🚉** (added at each hardcoded-emoji site, and
`placeFlag` extended). Map popup marks stations `hasPage`. Stations are added to the trip/journal
place pickers' kind filters. `CITY_PAGE_KINDS` (journal auto-link) follows airports — stations
open a detail page but are not treated as a city for the journal place-link (consistent with
airports). No Wikivoyage guide button (like airports).

**Rationale**: Consistency with airports keeps behavior predictable and the surface bounded.

## R6 — Coordinate resolvers + stamping

**Decision**: Add a `station` branch to all five coordinate resolvers (`travel/distance.ts`,
`travel/myPlaces.ts`, `lib/reference/placeCoords.ts`, `journal/StoryMap.tsx`,
`backup/exportCsv.ts`) so a station has coordinates for trip legs, the journal map, coord
stamping (self-locating exports), and CSV export — exactly like airports.

**Rationale**: A station must be a valid, drawable, measurable trip stop and map point.

## R7 — Schema is additive; version 13 → 14

**Decision**: Add `"station"` to the `PlaceRef.kind` enum; bump `SCHEMA_VERSION` 13 → 14 with a
version note; regenerate the JSON Schema artifact (6 enum sites). Older files (no stations) still
validate; a station record round-trips. A personal record naming a station absent from the
bundled dataset still loads from its stored name/country (personal data is self-contained).

**Rationale**: Follows the established additive-kind precedent (v4 added `"custom"`); `.strict()`
means a new enum value warrants the version bump.

## Resolved unknowns
- Per-country station count seam didn't exist (airports have none) → add `stationsOf(iso2)` (R4).
- Station id is a QID, not a code → no IATA search path, no upper-casing (R1/R2).
- Data fetch blocked here → dev fixture unblocks integration + tests (R3). No NEEDS CLARIFICATION remain.

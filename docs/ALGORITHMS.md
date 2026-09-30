# Postcards — Algorithms & Data Flow

## How to read this

This document explains the non-obvious algorithms and data-flow decisions in the Postcards
codebase, grounded in the actual source as of **2026-07-14**. It is written for developers and AI
agents who need to modify or reason about the code without re-deriving these rules from scratch.
Every section ends with a `Sources:` line pointing at the files (and, where useful, line ranges)
the claims were extracted from — trust the code over this document if they ever disagree. Pseudo-code
blocks are simplified transcriptions of the real code, not specifications of their own.

Chapters follow the lifecycle of the data: how reference data loads, how it is searched, how visits
turn into statistics, how everything is drawn on the map, how the app stays functional offline, and
finally the portable file that carries the user's data in and out.

## Table of contents

1. [Reference data & gazetteer loading](#1-reference-data--gazetteer-loading)
   - 1.1 Startup gate: the bundled core gazetteer loads before first render
   - 1.2 Indexes built at construction
   - 1.3 Stage two: the full ~135k gazetteer in a Web Worker
   - 1.4 The swap: in-place mutation plus a generation bump
   - 1.5 React consumption: `useGazetteerGeneration`
2. [Place search & ranking](#2-place-search--ranking)
   - 2.1 Normalization: NFD diacritic folding
   - 2.2 Per-kind search: two-bucket linear scans
   - 2.3 Airport search and the uppercase-IATA fast path
   - 2.4 Cross-kind assembly and the quality re-rank
   - 2.5 Result bounding and the not-found path
   - 2.6 Picking vs adding: navigation and logging are separate
3. [Country coverage & statistics derivation](#3-country-coverage--statistics-derivation)
   - 3.1 How a country becomes "visited" (derivation rule)
   - 3.2 Country scope and the world denominator
   - 3.3 World coverage: `computeCoverage` and % of world
   - 3.4 Per-country coverage: cities, regions, heritage
   - 3.5 Continent coverage and travel records
   - 3.6 Consumers: Passport and the Countries checklist
4. [Map rendering & interaction](#4-map-rendering--interaction)
   - 4.1 Cities in view: bounds filter, presorted fast path, snapshot semantics
   - 4.2 Marker layers, map modes, and the viewport-capped POI pipeline
   - 4.3 Visited-country choropleth
   - 4.4 Trip arcs: great-circle densification and haversine distance
   - 4.5 Keep-alive map: mounted once, hidden via CSS
   - 4.6 The dockable in-view list
5. [Offline & caching strategy](#5-offline--caching-strategy)
   - 5.1 Service-worker layout: precache vs runtime caches
   - 5.2 The 17 MB gazetteer: idle-time fetch behind CacheFirst
   - 5.3 Basemap chain: OSM raster, bundled overview, PMTiles pack
   - 5.4 The `MapSource` seam and the device-global PMTiles pack
   - 5.5 Explicit offline tile packs: pre-warming the OSM cache
   - 5.6 Privacy constraints: what may touch the network
6. [Portable file, validation & sanitization](#6-portable-file-validation--sanitization)
   - 6.1 The versioned portable file: one strict Zod schema, v1→v5
   - 6.2 Import pipeline: guard → parse → refuse-newer → validate → merge
   - 6.3 Text sanitization: strip invisibles, cap length
   - 6.4 Photos: bounded, inert, inline data URLs
   - 6.5 Dedupe upsert: at most one visit per (kind, id)
   - 6.6 Published JSON Schema: generated from Zod, kept honest by a test
7. [Maintenance](#7-maintenance)

---

## 1. Reference data & gazetteer loading

### 1.1 Startup gate: the bundled core gazetteer loads before first render

React never renders without reference data. `apps/postcards/src/main.tsx` wraps
`createRoot(...).render(...)` inside `initReferenceData().then(...)`, so every screen can call
`getReferenceData()` synchronously and assume it succeeds (the accessor throws if the singleton is
missing, `referenceData.ts:388-391`).

`initReferenceData()` (`referenceData.ts:289-316`) fetches seven static, service-worker-cached JSON
assets in one `Promise.all`: `reference/cities.json` (the bundled core gazetteer, ~24k cities),
plus subdivisions, airports, heritage sites, landmarks (merged into the heritage array — same
shape, one more named dataset), languages, and article names. Only `cities.json` is load-bearing:
its fetch rejects on `!r.ok`, while every other asset falls back to an empty array/object. On any
failure the whole `try` collapses to `initReferenceDataSync([], [], ...)` — the app boots with no
cities rather than not at all.

Before returning, it fire-and-forgets `upgradeToFullGazetteer(ref)` (`referenceData.ts:310`), which
begins stage two without ever blocking the returned promise:

```
initReferenceData:
  fetch 7 assets in parallel        # cities.json is required, rest optional
  instance = new ReferenceDataImpl(...)
  void upgradeToFullGazetteer(instance)   # detached
  return instance
```

`initReferenceDataSync()` (`referenceData.ts:276-286`) is the in-memory constructor used by tests
and the failure fallback; it assigns the same module-level `instance` singleton.

Sources: `apps/postcards/src/main.tsx`, `apps/postcards/src/lib/reference/referenceData.ts`

### 1.2 Indexes built at construction: id maps, folded search strings, and the population-descending contract

`ReferenceDataImpl`'s constructor (`referenceData.ts:128-166`) turns the raw arrays into the query
structures the rest of the app uses:

- **Search strings.** Every city, airport, and heritage site gains a precomputed `search` field via
  `normalize()` (`referenceData.ts:73-79`): NFD-decompose, strip `\p{Diacritic}`, lowercase, trim.
  All `search*` methods fold the query with the same function, so "Sao Paulo" matches "São Paulo".
  Search ranks prefix matches (`startsWith`) before substring matches (`includes`);
  `searchAirports` adds two higher tiers for exact and prefix IATA-code matches on `a.id`
  (`referenceData.ts:250-266`).
- **Population-descending sort.** Cities are sorted by `(b.population ?? 0) - (a.population ?? 0)`.
  The comment at `referenceData.ts:139-141` names this the contract everywhere: search relevance
  (in a linear scan over a population-sorted array, the first N prefix hits are the N biggest
  cities — which lets `searchCities` break early once both buckets hold `limit` entries,
  `referenceData.ts:243`) and the cities-in-view list's presorted fast path. The bundled file
  arrives already sorted, making this a near-free adaptive pass that also guarantees the invariant
  for injected test data.
- **Id maps.** `cityIndex`, `airportIndex`, `heritageIndex`, `subIndex` are `Map<id, row>` for O(1)
  `cityById`/`airportById`/`heritageById`/`subdivisionById`; `heritageByCountry` and
  `subsByCountry` group rows per ISO2 country. (`citiesOf()` deliberately stays a filter over the
  flat array — it preserves population order.)
- **Derived countries.** `buildCountries()` (`referenceData.ts:45-71`) does not read a countries
  dataset; it enumerates `i18n-iso-countries` English names, joins ISO3/numeric codes, overlays
  curated common names (`country-names.json`), continents, and sovereignty class, and counts each
  country's cities and subdivisions from the loaded arrays (`cityCount`, `subdivisionCount` — the
  stats denominators). Countries sort by localized name; `byIso2`/`byNumeric` maps and a folded
  `countrySearch` array are built on top.

Sources: `apps/postcards/src/lib/reference/referenceData.ts`

### 1.3 Stage two: the full ~135k gazetteer prepared in a Web Worker at first idle

The full world gazetteer (`reference/cities-all.json`, ~135k cities, ~17 MB of JSON) is too heavy
for startup: parsing plus fold plus sort on the main thread froze the UI for over a second right
when the user starts touching the map (comment, `gazetteerWorker.ts:1-6`). So
`upgradeToFullGazetteer()` (`referenceData.ts:370-378`) defers twice:

1. **Wait for idle.** `whenIdle()` (`referenceData.ts:320-328`) resolves on `requestIdleCallback`
   with a 4 s timeout (fallback: `setTimeout` 1.5 s), so the 17 MB fetch never races first paint,
   the map spinning up, or the service worker's install for bandwidth/CPU.
2. **Do the heavy work off-thread.** `loadFullGazetteer()` (`referenceData.ts:331-362`) spawns a
   module worker via `new Worker(new URL("./gazetteerWorker.ts", import.meta.url))` and posts it
   the URL. The worker (`gazetteerWorker.ts:23-40`) fetches, `res.json()`-parses, maps every row to
   `{...c, search: normalize(c.name)}` using a byte-identical copy of `normalize`, sorts
   population-descending, and posts back the prepared rows. It posts `null` on `!res.ok` or any
   exception (offline / interrupted download) — the core set simply keeps working. The main thread
   resolves on the first message and terminates the worker either way.

If `Worker` is undefined (old browsers), an inline fallback performs the same fetch+map+sort on the
main thread; if that also fails, `null`. The upgrade is applied only if
`cities.length > impl.allCities().length` (`referenceData.ts:373`) — a guard against replacing the
core set with something smaller or equal (e.g. a stale/partial file).

Sources: `apps/postcards/src/lib/reference/referenceData.ts`,
`apps/postcards/src/lib/reference/gazetteerWorker.ts`

### 1.4 The swap: in-place mutation of the live singleton plus a generation bump

The upgrade never creates a new `ReferenceData` — every consumer already holds the singleton, so
`replaceCities()` (`referenceData.ts:114-126`) mutates it in place:

```
replaceCities(cities, prepared=true):
  this.cities = cities            # worker output: search precomputed, presorted
  cityIndex.clear(); rebuild from new array
  recount cities per country; overwrite country.cityCount in place
```

With `prepared=true` (the worker path) the fold+sort is skipped entirely — re-doing it on the main
thread for ~135k rows is exactly the stall the worker exists to avoid; the only main-thread work is
the array swap, the `cityIndex` rebuild, and refreshing each `Country.cityCount` (the per-country
"known cities" denominators the stats screens show). The `prepared=false` branch re-folds and
re-sorts for callers passing raw rows. Note that `Country` objects are themselves mutated
(`country.cityCount = ...`), not replaced — another reason object identity cannot signal the change.

After a successful swap, `upgradeToFullGazetteer` increments the module-level `generation` counter
and dispatches `new Event(GAZETTEER_UPGRADED_EVENT)` (`"postcards:gazetteer-upgraded"`) on `window`
(`referenceData.ts:374-377`). The pair matters: the event is the push channel, and
`gazetteerGeneration()` (`referenceData.ts:382-385`) is the pull channel that lets late subscribers
read the current state — components that mount after the upgrade landed must not miss it.

Sources: `apps/postcards/src/lib/reference/referenceData.ts`

### 1.5 React consumption: `useGazetteerGeneration` and why memos depend on it

Because the singleton mutates in place, `getReferenceData()` returns the same object reference
before and after the upgrade — no React dependency on the instance (or on arrays/countries inside
it) will ever invalidate. `useGazetteerGeneration()` (`useGazetteer.ts:12-19`) closes that gap:

```
useGazetteerGeneration():
  return useSyncExternalStore(
    subscribe,            # add/remove GAZETTEER_UPGRADED_EVENT listener on window
    gazetteerGeneration,  # client snapshot
    gazetteerGeneration)  # server snapshot
```

`useSyncExternalStore` reads the generation at subscription time, so there is no mount race: a
component mounting after the upgrade sees generation 1 immediately, and one mounting before
re-renders when the event fires. The contract (stated in the hook's doc comment) is to include the
returned number in any `useMemo` deps that snapshot city data from the singleton — the changing
integer is what invalidates the memo, since `ref` alone never does.

Actual consumers follow this pattern: `features/stats/StatsView.tsx:92,163` ("city lists grow when
the full gazetteer lands", "denominators change..."), `features/country/CountryScreen.tsx:22`,
`features/map/MapView.tsx:567`, and `features/map/MapScreen.tsx:90` all call the hook and thread
`gazGen` into their memoized derivations. Anything else reading `allCities()`, `citiesOf()`,
`searchCities()`, or `Country.cityCount` inside a memo must do the same.

Sources: `apps/postcards/src/lib/reference/useGazetteer.ts`,
`apps/postcards/src/lib/reference/referenceData.ts`,
`apps/postcards/src/features/stats/StatsView.tsx`, `apps/postcards/src/features/map/MapView.tsx`,
`apps/postcards/src/features/map/MapScreen.tsx`,
`apps/postcards/src/features/country/CountryScreen.tsx`

---

## 2. Place search & ranking

### 2.1 Normalization: NFD diacritic folding, done once per row

All matching happens on a folded form of both the query and every place name: Unicode NFD
decomposition, strip combining marks, lowercase, trim.

```
normalize(s) = s.normalize("NFD")
                .replace(/\p{Diacritic}/gu, "")
                .toLowerCase()
                .trim()
```

This makes `"sao"` match `São Paulo` and `"koln"` match `Köln`. The exact same function exists in
three places by design: `normalize()` in `referenceData.ts:73-79` (folds names at index-build
time), `normalizeQuery()` in `search.ts:82-88` (folds the user's query for the cross-kind re-rank;
its doc comment says "Same folding the reference indexes use"), and `normalize()` in
`gazetteerWorker.ts:10-16` (folds the full 135k-city gazetteer off the main thread).

Folding of names is a one-time indexing cost, not a per-keystroke cost. `ReferenceDataImpl`'s
constructor precomputes a `search` string per row into `IndexedCity` / `IndexedAirport` /
`IndexedHeritage` and a `countrySearch` array of `{ c, search }` pairs
(`referenceData.ts:141-147`). Cities are additionally sorted population-descending at build time —
that ordering is the relevance contract for city search (comment at `referenceData.ts:139-140`).
When the full world gazetteer streams in later, the worker posts back rows with `search` already
computed and population-sorted, and `replaceCities(cities, prepared=true)` swaps them in without
re-folding on the main thread (`referenceData.ts:111-126`). Countries are sorted alphabetically by
display name (`localeCompare`, `referenceData.ts:69`); airports and heritage sites keep dataset
order.

Queries are folded once per search call. Note that trims happen on both sides, and matching is pure
substring logic on the folded strings — there is no fuzzy matching, no tokenization beyond the
folding, and no scoring model.

Sources: `apps/postcards/src/lib/reference/referenceData.ts` (normalize 73-79, constructor 141-147,
replaceCities 111-126, buildCountries sort 69), `apps/postcards/src/features/visits/search.ts`
(normalizeQuery 81-88), `apps/postcards/src/lib/reference/gazetteerWorker.ts` (normalize 9-16,
prepared rows 32-34)

### 2.2 Per-kind search: two-bucket linear scans (prefix, then contains)

Each kind has its own `search*` method on `ReferenceDataImpl`, and all of them share one shape: a
single linear scan over the folded index, splitting hits into a `starts` bucket
(`row.search.startsWith(q)`) and a `contains` bucket (`row.search.includes(q)`), then returning
`[...starts, ...contains].slice(0, limit)` with `limit = 8` by default.

- `searchCountries` (`referenceData.ts:225-235`): scans `countrySearch`; since that array is
  alphabetized, within each bucket results come back alphabetically.
- `searchHeritage` (`referenceData.ts:214-224`): same pattern over heritage sites plus landmarks
  (the landmarks dataset is merged into the heritage array at init, `referenceData.ts:305`);
  within-bucket order is dataset order.
- `searchCities` (`referenceData.ts:236-249`): same pattern over the population-descending city
  list, plus an early-exit:

```
for c of cities:                      # population-descending
  if c.search.startsWith(q):
    starts.push(c)
    if len(starts) >= limit and len(contains) >= limit: break
  elif c.search.includes(q):
    contains.push(c)
```

The scan stops as soon as *both* buckets hold `limit` entries (the break condition is only checked
when a prefix hit is pushed). Because the list is population-sorted, the first `limit` entries of
each bucket are guaranteed to be the most populous matches, so the early exit loses nothing — it
just avoids scanning the rest of ~135k rows. Countries and heritage scan their (much smaller) full
lists every time.

Within a bucket, ordering is whatever the underlying index order is: population for cities,
alphabetical for countries, dataset order for airports/heritage. Prefix always beats contains
within a kind; cross-kind ordering is decided later (sections 2.3 and 2.4).

Sources: `apps/postcards/src/lib/reference/referenceData.ts` (searchCountries 225-235, searchCities
236-249, searchHeritage 214-224)

### 2.3 Airport search and the uppercase-IATA fast path

`searchAirports` (`referenceData.ts:250-266`) is the one per-kind search with four buckets instead
of two, because airports are addressable by IATA code as well as by name:

```
code = query.trim().toUpperCase()
for a of airports:
  if a.id == code:                              codeExact
  elif len(code) >= 2 and a.id.startsWith(code): codePrefix
  elif a.search.startsWith(q):                   nameStarts
  elif a.search.includes(q):                     nameContains
return concat(all four).slice(0, limit)
```

Inside this method, code matching is case-insensitive (the query is uppercased first), so typing
`lax` still puts LAX at the head of the *airport* bucket. Single-character queries never
code-prefix-match (`code.length >= 2` guard).

Case matters one level up, in `searchPlaces` (`search.ts:49-62`). Normally airports are listed
after countries and cities. But a query that is literally three uppercase ASCII letters *and*
resolves via `ref.airportById(q)` (itself an uppercasing map lookup, `referenceData.ts:199-201`) is
treated as an explicit IATA code:

```
isIataCode = /^[A-Z]{3}$/.test(q) && ref.airportById(q) exists
if isIataCode:
  return [...airports, ...countries, ...cities, ...heritage].slice(0, limit*2)
```

On this path airports jump to the front and the quality re-rank (section 2.4) is skipped entirely —
the code comment states the rationale: an exact code match "outranks everything by intent, not by
name quality" (`search.ts:57`), so typing `LAX` surfaces the airport ahead of the like-named city
Laxou. Lowercase or mixed-case typing (`por`, `san`) is treated as a place name: prominent cities
keep priority and the airport still appears, just after the places (`search.ts:49-54`). Note the
fast-path regex tests the *raw trimmed* query, not the folded one, so a code with a diacritic would
never qualify — only plain `A-Z` triples.

Sources: `apps/postcards/src/lib/reference/referenceData.ts` (searchAirports 250-266, airportById
199-201), `apps/postcards/src/features/visits/search.ts` (IATA fast path 49-62)

### 2.4 Cross-kind assembly and the quality re-rank

`searchPlaces` (`search.ts:15-79`) is the single entry point the UI uses. It fans the query out to
all four per-kind searches (each capped at `limit`, default 8), wraps rows as
`SearchResult { place: PlaceRef, detail }` — detail lines like `"Country"`, `"City · France"`,
`"Airport · Paris, France"`, `"Heritage site · Peru"` — and gives airports a display name of
`` `${a.name} (${a.id})` ``.

Outside the IATA fast path, results are first concatenated in a fixed kind order — countries,
cities, airports, heritage (`search.ts:63`) — and then re-ranked by *how* the name matches rather
than *what kind* it is:

```
rank(name):
  n = normalizeQuery(name)
  if n.startsWith(nq):                          return 0   # starts-with
  if n.includes(" "+nq) or n.includes("-"+nq):  return 1   # word-start
  return 2                                                 # contains
```

Rank 1 catches a query hitting the start of an interior word across a space or hyphen boundary
only — `"york"` ranks `New York` at 1; other interior hits (including after `(`, so an airport's
`(LAX)` suffix) fall to rank 2. The comment's motivating example: `"Ista"` must put Istanbul
(prefix) above Afghanistan (mid-word hit) (`search.ts:64-66`).

Stability is explicit, not an assumption about `Array.prototype.sort`: each entry carries its
pre-sort index and the comparator is `a.rank - b.rank || a.i - b.i` (`search.ts:74-77`). So within
an equal rank, the original ordering survives — kind order first (country > city > airport >
heritage), and within a kind, that kind's own bucket order (prefix-before-contains,
population/alphabetical/dataset order). The rank function is applied to the display name
(`r.place.name`), which for countries is the common-name override ("Russia", not "Russian
Federation") baked in by `buildCountries` (`referenceData.ts:24-26,62`).

Sources: `apps/postcards/src/features/visits/search.ts` (searchPlaces 15-79, rank 67-73, stable
sort 74-78), `apps/postcards/src/lib/reference/referenceData.ts` (countryNames 24-26, 62)

### 2.5 Result bounding and the not-found path

Bounding happens at three layers:

1. **Per kind**: each `search*` method slices to `limit` (8) after its bucket concat, and
   `searchCities` additionally stops scanning once both buckets are full (`referenceData.ts:243`).
2. **Combined**: `searchPlaces` slices the merged, re-ranked list to `limit * 2` — 16 rows
   maximum — on both the IATA fast path and the normal path (`search.ts:58-61, 78`). So no single
   kind can contribute more than half the final list, and the UI never renders more than 16
   options.
3. **Empty query**: a whitespace-only query short-circuits to `[]` before any scan
   (`search.ts:16-17`), and each per-kind method has the same guard on the folded query.

When a query of at least 2 trimmed characters yields zero results, `PlaceSearch` flips to a
not-found state (`notFound`, `PlaceSearch.tsx:35`) and renders an inline `AddPlaceForm` seeded with
the query text (`PlaceSearch.tsx:182-187`). This is the aggregator principle's escape hatch
referenced in `search.ts:13` ("FR-016 handled by the caller when empty"): the search itself never
invents places — anything not in the loaded reference datasets must go through the explicit
user-authored-place form. A visually hidden live region announces the result count or the no-match
state to screen readers (`PlaceSearch.tsx:120-126`).

Sources: `apps/postcards/src/features/visits/search.ts` (15-17, 58-61, 78),
`apps/postcards/src/lib/reference/referenceData.ts` (searchCities break 243),
`apps/postcards/src/features/visits/PlaceSearch.tsx` (notFound 35, empty state 182-187, live region
120-126)

### 2.6 Picking vs adding: navigation and logging are separate actions

`PlaceSearch.tsx` deliberately splits the two things a search result can do; its header comment
records why: an accidental Enter used to silently mark the top match visited
(`PlaceSearch.tsx:10-16`).

**`pick(place)` — navigate only** (`PlaceSearch.tsx:46-63`). Never writes a visit:

- `country` → `useUi.getState().openCountry(countryId)` (opens the country page).
- `city` / `airport` → look up coordinates via `cityById` / `airportById` and call the
  `onFocusCity` callback to fly the map there.
- `heritage` → fly to its coordinates if they are not both zero; otherwise fall back to
  `useUi.getState().openCity(place.id)` (a coordinate-less site opens its detail view instead).
- Afterwards: clear the query, reset the active index, refocus the input.

**`toggle(place)` — the explicit log action** (`PlaceSearch.tsx:67-76`). Countries return early and
are never logged directly — country coverage is derived from visiting places inside them (also why
country rows render no Add chip, `PlaceSearch.tsx:160-176`). For other kinds it snapshots the
previous visits array, checks `findByPlace(prev, place)?.status === "visited"`, then fires
`toggleVisit(place)`. Adds are silent (the row's chip flips to "✓ Visited" in place); only a
removal — which can drop photos/notes — raises a toast with an undo callback that restores the
snapshot via `setAll(prev)`.

**Bindings** (`PlaceSearch.tsx:78-98, 144-176`): clicking the row body picks; the per-row chip
(`＋ Add` / `✓ Visited`) toggles. On the keyboard, Enter picks the active option (falling back to
the first result when none is active), Shift+Enter toggles it — explicit parity with the chip —
ArrowDown/ArrowUp move the active option with wrap-around, and Escape clears. The listbox follows
the ARIA combobox pattern (`role="combobox"`, `aria-activedescendant`, `role="option"`), and typing
resets the active index to -1.

Sources: `apps/postcards/src/features/visits/PlaceSearch.tsx` (pick 46-63, toggle 67-76, keyboard
78-98, row/chip rendering 135-179)

---

## 3. Country coverage & statistics derivation

### 3.1 How a country becomes "visited" (derivation rule)

A country is never marked visited directly; it is **derived** from the visited places inside it.
The single source of truth is `visitedCountryIds()` in `computeStats.ts`:

```
visitedCountryIds(visits) =
  distinct place.countryId over visits where
    status !== "wishlist"          // onlyVisited(): wishlist never counts
    AND place.kind !== "airport"    // layovers are not visits
    AND place.countryId !== "ZZ"    // the no-country code never counts
```

Consequences, exactly as coded:

- **Cities, monuments (`heritage`), and `custom` places count** — any visited record whose `kind`
  is not `airport` and whose `countryId` is a real ISO code contributes its country. `Visit.status`
  defaults to `"visited"` for old files (`models.ts:86`).
- **Airports deliberately do not count** (`computeStats.ts:43-45`): "changing planes in a country
  is not visiting it". The map's visited-country fill applies the same exclusion
  (`MapView.tsx:708-710`).
- **`ZZ` records never count.** `ZZ` is the ISO user-assigned code Postcards uses for places
  outside any country — open ocean custom places (`AddPlaceForm.tsx:83`) and "Moments", which are
  stored as `kind: "custom"` with `countryId: "ZZ"` precisely so they never touch country stats
  (`ExperiencesScreen.tsx:13-17,66`).
- **Direct `kind: "country"` records are legacy but still honoured.** The schema keeps the kind
  (`models.ts:32`, "older files only ever used country/city"), and such a record passes the
  `kind !== "airport"` filter, so it still turns its country visited everywhere. The UI, however,
  no longer lets you create one as "visited": `StateToggles.tsx:43-46` hides the ✓ button on
  countries unless a direct record already exists ("✓ only to UNDO a legacy direct record");
  countries keep only ⚑ want-to-go and ♥.

The Places → Countries checklist recomputes the same rule locally (`PlacesScreen.tsx:175-187`) but
keeps the two paths separate: `sub` counts non-airport, non-ZZ, non-country visited places per
country, and `explicit` collects countries with a legacy direct record. A row is visited if
`sub > 0 || explicit`; the "✓ Visited" chip and the "via N places" sub-line are shown only for the
derived case (`subCount > 0`, `PlacesScreen.tsx:512-542`).

Sources: `apps/postcards/src/features/stats/computeStats.ts` (lines 38-52),
`apps/postcards/src/features/visits/PlacesScreen.tsx` (lines 175-187, 508-545),
`apps/postcards/src/features/visits/StateToggles.tsx` (lines 43-60),
`apps/postcards/src/lib/schema/models.ts` (lines 29-46, 84-88),
`apps/postcards/src/features/experiences/ExperiencesScreen.tsx` (lines 13-17, 64-67),
`apps/postcards/src/features/map/MapView.tsx` (lines 708-711)

### 3.2 Country scope and the world denominator (all vs UN members)

"What counts as a country" is a persisted user preference, not a stats parameter buried in code.
`scope.ts` defines the whole policy:

```
type Sovereignty = "un" | "territory"   // from data/sovereignty.json (per ISO-3166 alpha-2)
type CountryScope = "all" | "un"        // DEFAULT_SCOPE = "all"
inScope(sov, scope) = scope === "all" || sov === "un"
```

The country universe is built in `referenceData.ts#buildCountries()`: every ISO 3166-1 code from
`i18n-iso-countries` that has both an alpha-3 and a numeric code becomes a `Country`, tagged
`sovereignty: sovereignty[iso2] ?? "territory"`. With the shipped `sovereignty.json` that yields
**250 countries under `"all"` and 193 UN member states under `"un"`** (the `ScopeToggle` labels
"UN · 193" / "All · 250" are hardcoded UI copy, but they match the data). The denominator itself is
computed, not hardcoded: `worldCountryCount(scope)` returns `countries.length` for `"all"`,
otherwise counts `inScope` members (`referenceData.ts:267-270`).

On the numerator side, `computeStats.ts#countryInScope()` decides whether a *visited* id counts: it
looks the iso2 up in the reference set and applies `inScope(c.sovereignty, scope)`; an **unknown id
(not in the ISO list) counts only under `"all"`** (`computeStats.ts:6-9`). This scope filter is
applied uniformly in `computeCoverage`, `computeContinentCoverage`, and `visitedCountriesList`.

The scope lives in `useSettings.countryScope` (Zustand, persisted to `localStorage` under
`postcards-country-scope`) and is toggled by the shared `ScopeToggle` rendered on the Stats screen,
the Passport, and the Places → Countries checklist — so every scoped surface flips together.

Sources: `apps/postcards/src/lib/reference/scope.ts`,
`apps/postcards/src/lib/reference/referenceData.ts` (lines 45-71, 267-270),
`apps/postcards/src/lib/reference/data/sovereignty.json`,
`apps/postcards/src/features/stats/computeStats.ts` (lines 5-9),
`apps/postcards/src/lib/store/useSettings.ts` (lines 8, 29-36, 71-80),
`apps/postcards/src/ui/ScopeToggle.tsx`

### 3.3 World coverage: `computeCoverage` and % of world

`computeCoverage(visits, ref, scope)` produces the headline numbers shown in the Stats tiles and
the map's counter strip:

```
countriesVisited = |{ id ∈ visitedCountryIds(visits) : countryInScope(id, scope) }|
worldCountryCount = ref.worldCountryCount(scope)
worldPct = countriesVisited / worldCountryCount      // 0..1; pct() returns 0 when total = 0
citiesVisited    = |distinct place.id where kind = "city"|      (visited only)
airportsVisited  = |distinct place.id where kind = "airport"|
monumentsVisited = |distinct place.id where kind = "heritage"|
```

Note the asymmetry: the country count is scope-filtered, but the city/airport/monument counts are
raw distinct-id counts across all visited records regardless of scope. All divisions in this module
go through `pct(part, total) = total > 0 ? part/total : 0`, so empty denominators render as 0%,
never NaN.

Consumers:

- `StatsView.tsx` renders `countriesVisited`, then `formatPercent(worldPct)` with the label "of
  {worldCountryCount} UN member states" or "…countries & territories" depending on scope, plus
  cities/airports/monuments tiles (airports and monuments tiles only appear when > 0). It memoizes
  on `[visits, ref, scope, gazGen]` — `gazGen` is the gazetteer generation counter, bumped when the
  full 135k-city gazetteer replaces the bundled core set, which changes per-country denominators
  (see section 3.4).
- `StatStrip.tsx` shows `countriesVisited/worldCountryCount` as "countries" plus been/want/fav
  counters; every counter is a shortcut into the matching Places view.
- `PassportScreen.tsx#exportPoster()` uses `computeCoverage` for the poster caption (countries +
  cities).

Sources: `apps/postcards/src/features/stats/computeStats.ts` (lines 11-18, 34-36, 54-86),
`apps/postcards/src/features/stats/StatsView.tsx` (lines 161-263),
`apps/postcards/src/features/stats/StatStrip.tsx`,
`apps/postcards/src/features/passport/PassportScreen.tsx` (lines 95-117)

### 3.4 Per-country coverage: % of cities, % of first-level regions, % of heritage sites

`computeCountryCoverage(visits, ref, iso2)` implements the spec's FR-007 ("both %-of-cities and
%-of-regions per country"), plus a heritage metric:

```
for each visited visit with kind = "city":
  city = ref.cityById(place.id)
  if !city || city.countryIso2 !== iso2: skip     // guard, see below
  visitedCityIds += city.id
  if city.subdivisionId: visitedRegionIds += city.subdivisionId

cityPct   = |visitedCityIds|   / country.cityCount
regionPct = |visitedRegionIds| / country.subdivisionCount
heritagePct = |visited sites ∈ heritageOf(iso2)| / |heritageOf(iso2)|
```

Key properties, straight from the code:

- **Numerator can never exceed the denominator**: only cities that exist in the loaded gazetteer
  *and* belong to this country count, so imported/hand-edited cities outside the dataset don't
  inflate the percentage (`computeStats.ts:99-102`).
- **Regions are also derived from cities**: a first-level region (state/province) is "visited" iff
  a visited gazetteer city carries its `subdivisionId`. There is no direct region record.
- **Denominators come from the reference build**: `country.cityCount` and
  `country.subdivisionCount` are counted per iso2 in `buildCountries()`; `cityCount` is *refreshed*
  by `replaceCities()` when the full world gazetteer streams in after first render — which is why
  stats screens re-memoize on the gazetteer generation.
- **Heritage membership is by the country's own site list** (`heritageOf(iso2)`), so a
  transnational site counts toward each country it spans, matching the denominator
  (`computeStats.ts:106-115`). "Heritage" here includes both UNESCO sites and the bundled
  famous-landmarks dataset, merged at load (`referenceData.ts:39-41, 305`).
- Missing data degrades explicitly: `citiesTotal === 0` renders "no city data",
  `regionsTotal === 0` renders "dataset not loaded" (`StatsView.tsx:432-456`).

`visitedCountriesList(visits, ref, sortBy, scope)` builds the Stats "By country" cards:
scope-filtered `visitedCountryIds`, each expanded via `computeCountryCoverage`, sorted by most
cities / most regions / name (ties by name). Each card's lazy drill-down calls `countryDetail()`,
which returns the *names* behind the numbers — visited cities (with ids to open their pages),
visited region names, remaining region names (the "what's left" headline), and visited/remaining
monuments; `regionsRemaining = max(0, subdivisionCount - visitedRegions)`.

Sources: `apps/postcards/src/features/stats/computeStats.ts` (lines 20-32, 88-132, 168-231,
266-285), `apps/postcards/src/lib/reference/referenceData.ts` (lines 45-71, 111-126),
`apps/postcards/src/features/stats/StatsView.tsx` (lines 83-144, 394-481)

### 3.5 Continent coverage and travel records (superlatives)

**Continents** — `computeContinentCoverage(visits, ref, scope)` computes, per continent name (from
`data/continents.json`, attached to each `Country` at build time):

```
total[continent]   = in-scope countries with that continent (countries with empty continent are skipped)
visited[continent] = in-scope visited iso2s whose country has that continent
pct = visited / total
```

Only continents where you have at least one visited country are returned (the map is built from
visited ids), sorted by visited count descending, then name. `StatsView` renders each as a progress
bar in `CONTINENT_COLORS`. A visited iso2 that is unknown to the reference set contributes nothing
here even under `"all"` (no `continent` to group by, `computeStats.ts:155-156`).

**Records** — `computeRecords(visits, ref)` scans visited records once and keeps five superlatives
(`TravelRecords`):

- `firstVisit` / `latestVisit`: min/max of the visit's own `date` string (ISO dates compare
  lexicographically), across **all** visited kinds — airports and custom places included, since the
  kind filter comes after the date check.
- `northernmost` / `southernmost` / `biggestCity`: **cities only**, and only cities resolvable in
  the gazetteer (`ref.cityById`); latitude extremes and max `population` (cities with
  `population == null` can never become `biggestCity`). Each carries its country's iso2 so the UI
  can fly the map to it.

`StatsView` renders the Records section only when at least one exists, hides Southernmost when it
names the same city as Northernmost, and hides Latest when its date equals First's.

Sources: `apps/postcards/src/features/stats/computeStats.ts` (lines 134-166, 233-264),
`apps/postcards/src/lib/reference/continents.ts`,
`apps/postcards/src/features/stats/StatsView.tsx` (lines 192-199, 291-392)

### 3.6 Consumers: Passport (flags & poster) and the Countries checklist

**Passport** (`PassportScreen`, also embedded as a Places view) turns the same derivation into
"flags collected":

```
visitedIds = visitedCountryIds(visits)              // shared with Stats
all        = ref.countries where inScope(sovereignty, scope)
collected  = all where visitedIds.has(iso2)         // flags shown
missing    = all where !visitedIds.has(iso2)        // "still to collect", paged 60 at a time
```

Flags are grouped by continent (empty continent → "Elsewhere"), each group showing `done/total`
like passport pages; only continents with at least one collected flag render. The header count is
`collected.length` of `collected.length + missing.length`. Because `collected` is intersected with
`ref.countries`, a visited iso2 that is not in the ISO list can never show a flag — whereas
`computeCoverage` under scope `"all"` would still count it; the two numbers can therefore differ by
such unknown ids.

The **world poster** (`exportPoster` → `renderPoster` in `poster.ts`) stamps only in-scope visited
countries (`stampIds` re-filtered through `inScope`), "so the flags match the caption count and the
flag grid". For countries the basemap has no geometry for (Kosovo, small territories…),
`fallbackAnchors` supplies stamp coordinates from a place you actually recorded there —
city/heritage/airport lookups or a custom place's own lat/lon; ZZ/wishlist records are skipped and
nothing is invented.

**Countries checklist** (`PlacesScreen`, view `"countries"`): rows are the scope-filtered
`ref.countries`, optionally name-filtered, sorted visited-first then alphabetically. Visitation
uses the local `countryVisited` derivation described in section 3.1; the copy states the model
outright: "A country lights up when you've visited a place inside it — there's nothing to check off
here." Rows expose `StateToggles` with `kind: "country"` places, so ⚑ wishlist (and ♥ via wishlist)
remain available while ✓ appears only on countries that already have a legacy direct record.

Sources: `apps/postcards/src/features/passport/PassportScreen.tsx`,
`apps/postcards/src/features/passport/poster.ts`,
`apps/postcards/src/features/visits/PlacesScreen.tsx` (lines 175-187, 208-215, 492-549),
`apps/postcards/src/features/visits/StateToggles.tsx` (lines 43-60),
`apps/postcards/src/features/stats/computeStats.ts` (lines 46-52)

---

## 4. Map rendering & interaction

### 4.1 Cities in view: bounds filter, presorted fast path, snapshot semantics

The "Cities in view" list is driven by `citiesInView(cities, bounds, limit, presorted)`
(`viewport.ts:26-41`). A city is in view when `bounds.south <= lat <= bounds.north` and its
longitude passes `lonInRange` (`viewport.ts:13-15`), which is antimeridian-aware:

```
lonInRange(lon, west, east) =
  west <= east ? west <= lon <= east   // normal viewport
               : lon >= west || lon <= east  // viewport crosses ±180°
```

MapLibre reports a viewport straddling the antimeridian as `west > east`, so the second branch
treats the range as wrapping. **Presorted fast path:** the function normally sorts matches by
population descending, but `MapScreen.tsx:236-239` calls it with `presorted = true` and
`limit = IN_VIEW_CAP` (2000 rows, `MapScreen.tsx:27`) — the bundled gazetteer (~135k cities) is
already population-descending, so filtering preserves that order and the per-move O(n log n) sort
is skipped entirely; every pan/zoom is a single linear filter, and the capped working set is always
the most populous cities in view (the header shows a "+" when the cap is hit,
`MapScreen.tsx:240, 580`).

`bounds` arrives from `MapView`'s `moveend` handler via `emitBounds` (`MapView.tsx:598-607`,
`899-910`), and only for *user* moves — programmatic camera moves set `suppressBoundsRef` and skip
the emit, so the list never refreshes because the app itself flew the camera
(`MapView.tsx:905-908`; any real gesture — `dragstart`/`wheel`/`dblclick` — clears the flag,
`MapView.tsx:912-916`).

**Snapshot semantics** (`MapScreen.tsx:245-270`): the filtered list state (`snapshot`) is
recomputed by an effect whose dependency array is exactly `[inView, cityFilter, sortAZ]`. The
visited-city ID set used for the "Hide visited"/"Visited" filters is read imperatively at recompute
time via `useVisits.getState()` (`visitedCityIdsNow()`, `MapScreen.tsx:263-270`), deliberately
*not* a React dependency. Consequence: under "Hide visited", checking a city off keeps its row on
screen until the next map move or filter change instead of yanking it away mid-action. The `sortAZ`
toggle re-sorts a copy with a module-hoisted `Intl.Collator` (`MapScreen.tsx:29` — per-pair
`localeCompare` over 135k rows janked panning). Paging: `shown` resets to `PAGE = 30` on every
snapshot, `visible = snapshot.slice(0, shown)`, and "Show more" adds 30
(`MapScreen.tsx:271, 718-727`). The header counters (`inView.length`, `visitedInView`) *do* track
live visit state — only the row list is snapshotted. The `visible` slice is also fed back into
`MapView` as `viewCities`, becoming the `cities-inview` white-circle layer, so exactly the listed
cities are marked on the map (`MapScreen.tsx:439`, `MapView.tsx:215-229, 752-756`).

Sources: `apps/postcards/src/features/map/viewport.ts:13-41`,
`apps/postcards/src/features/map/MapScreen.tsx:26-29, 236-275, 718-727`,
`apps/postcards/src/features/map/MapView.tsx:598-607, 899-916, 752-756`

### 4.2 Marker layers, map modes, and the viewport-capped POI pipeline

All overlays sit on top of whichever base style is active, declared once in `overlayLayers`
(`MapView.tsx:366-526`). Layer inventory, bottom to top: `countries-base` (land fill on the offline
"simple" base; a fully transparent fill over rich bases), `countries-visited-fill` (choropleth, see
section 4.3), `countries-outline` (always drawn, so tile failure never yields a featureless
rectangle), `trip-arcs`, `cities-all` (the full ~135k-point gazetteer dot field, hidden unless the
"Towns" toggle is on), `airports-all` (every browsable airport, one shared ✈ chip image),
`cities-inview` (white circles for the listed cities), `cities-wishlist` (amber-ringed circles),
`poi-monuments` (UNESCO badges), `cities-visited` (flag pills), `airports` (logged-airport
`[✈ CODE]` pills).

**Marker images are rasterized lazily on demand.** Each symbol layer computes its `icon-image` name
from feature properties — `pill-{cc}-{fav}`, `mon-{cat}-{seen}`, `air-{iata}-{wish}-{fav}`,
`airport-all-dot` — and a single `styleimagemissing` handler (`MapView.tsx:851-867`) parses the
requested id and draws the image on a 2× canvas: `makeCityPill` (bare flag emoji with white halo,
gold ⭐ for favourites), `makeMonumentPin` (per-category emoji/ring from `MONUMENT_STYLE`, filled +
✅ once seen), `makeAirportDot`, `makeAirportPin` (`MapView.tsx:89-213`). So only marker variants
actually on screen ever get drawn. Visited-city features carry `sortKey: -(population)` so
`symbol-sort-key` renders the most populous first, and `icon-allow-overlap: true` guarantees every
visited flag stays visible even when crowded (`visitedLayers.ts:54`, `MapView.tsx:496-504`).

**Modes** (`MapMode = "all" | "cities" | "monuments" | "airports"`): `applyMode`
(`MapView.tsx:725-750`) flips layer visibility from the `MODE_LAYERS` table and sets zoom gates: in
"All" mode monuments only appear from zoom 4.5 and browsable airports from zoom 5 (dedicated modes
show them from zoom 0), and `cities-all` shows only when the Towns toggle is on *and* the mode is
all/cities.

**Viewport cap:** monuments and browsable airports never load as full world layers.
`applyViewportPoi` (`MapView.tsx:630-690`) runs on *every* `moveend` (including programmatic ones):
it filters the datasets to the current bounds with the same antimeridian-aware test (`inViewport`,
`MapView.tsx:623-628`), sorts your own seen places to the front, and slices to the `maxMarkers`
setting — so a dense region never blankets the map, and the cap never hides a place you've marked.

**Tap dispatch:** one `click` handler queries all tappable layers together (per-layer handlers
would all fire on overlapping features). The winner is picked by score — monuments −1, browsable
airports −0.5, cities by population — and gets a single popup (`MapView.tsx:937-991`). The popup
body itself is the visited toggle (tap marker, tap card: two taps and you're done); it stays open
so the flip is visible and reversible, with wish/story buttons swapping on visited state
(`openPlacePopup`, `MapView.tsx:235-332`). The click also `easeTo`s the point (zoom ≥ 6.5) with
`suppressBoundsRef` set so the list holds still.

Sources: `apps/postcards/src/features/map/MapView.tsx:89-229, 235-332, 350-354, 366-526, 623-750,
851-867, 937-998`, `apps/postcards/src/features/map/visitedLayers.ts:16-109, 186-203`

### 4.3 Visited-country choropleth (binary coverage tint over Natural Earth geometry)

Country polygons come from a single static asset, Natural Earth 50m TopoJSON at
`public/basemap/countries-50m.json`, fetched and decoded with `topojson-client`'s `feature()` at
most once per session — the promise is cached at module scope (with retry allowed after a failed
offline load), so basemap-switch remounts never re-download or re-parse it
(`MapView.tsx:26, 45-75, 786-797`). Each decoded feature gets `properties.numeric = String(f.id)` —
the ISO 3166-1 numeric code, the join key. The `countries` GeoJSON source is created with
`tolerance: 0`: per-zoom simplification of the huge Arctic multipolygons produced degenerate
triangles rendering as land-coloured streaks over the ocean (`MapView.tsx:818-822`).

The choropleth itself is `countries-visited-fill` (`MapView.tsx:380-393`) — not a graded choropleth
but a binary membership tint: a green fill whose *filter* holds the numeric codes of visited
countries:

```
filter = ["in", ["get", "numeric"], ["literal", nums]]
```

`applyCountryFill` (`MapView.tsx:711-723`) rebuilds `nums` whenever visits change:
`visitedCountryIds(visits)` yields ISO2 codes, mapped to numeric via
`ref.countryByIso2(iso2)?.numeric`. Which visits count is defined in `computeStats.ts:46-52`: any
non-wishlist visit *except* airports and the neutral `"ZZ"` country — so passing through an airport
never shades its country, matching the stats and passport (country coverage is derived from place
visits; there is no per-country record). Fill colour/opacity are theme-dependent (`#1f7a4d` @ 0.34
dark, `#34d399` @ 0.28 light) and re-applied by `applyTheme` on scheme change.

The layer ships `visibility: "none"` in the style, but MapScreen's "My countries" toggle defaults
ON (`loadPref` treats anything but `"0"` as on, `MapScreen.tsx:109-111`) and a dedicated effect
flips the layout property (`MapView.tsx:1054-1063`). Since only visited countries are ever shaded,
a fresh install shows no tint regardless.

Sources: `apps/postcards/src/features/map/MapView.tsx:26, 45-75, 380-393, 711-723, 764-783,
786-797, 818-822, 1054-1063`, `apps/postcards/src/features/stats/computeStats.ts:46-52`,
`apps/postcards/src/features/map/MapScreen.tsx:109-111`

### 4.4 Trip arcs: great-circle densification and haversine distance

`tripArcs(trips, ref)` (`visitedLayers.ts:165-178`) turns each logged trip into a `LineString`
tagged with its travel mode, provided *both* endpoints resolve to coordinates via `coordsOf`
(`distance.ts:5-20`): cities, airports, and heritage sites resolve (heritage stored as `0,0` means
"no coordinate in the source" and is treated as unknown); whole countries return `null` and the
trip is skipped — nothing is invented.

The geometry is produced by `greatCircle` (`visitedLayers.ts:126-158`), a spherical linear
interpolation: both endpoints are converted to unit XYZ vectors, the central angle is
`omega = acos(A·B)`, and 48 segments are placed at

```
P(t) = A·sin((1−t)·omega)/sin(omega) + B·sin(t·omega)/sin(omega)
```

then converted back to lon/lat. Near-coincident endpoints (`omega < 1e-6`) short-circuit to a
two-point line. Because a straight LineString would render as a projection-straight chord, this
densification makes the route curve correctly in Mercator. Longitudes are *unwrapped* with a
running offset: whenever a point would jump more than 180° from its predecessor, ±360° is added, so
a route crossing the antimeridian draws continuously instead of streaking across the whole map.

The `trip-arcs` line layer colours by mode with a `match` expression — flight `#2563eb`, train
`#16a34a`, bus `#d97706`, ferry `#0891b2`, car `#7c3aed`, fallback slate (`MapView.tsx:406-425`).
Which trips are drawn honours the Travel-log time filter shared through `useUi`: `MapScreen` runs
`tripsInPeriod(trips, tripYear, tripMonth)` before building arcs, and the "Trips" layer toggle
passes `null` to clear the source (`MapScreen.tsx:341-348, 440`).

Distance is separate from rendering: `haversineKm` (`distance.ts:26-37`) is the standard haversine
with mean Earth radius 6371 km and a clamped `asin` for numerical safety. `tripDistanceKm` returns
`null` when an endpoint lacks coordinates; `travelTotals` (`distance.ts:57-70`) still counts such
trips but adds 0 km, aggregating per-mode `{trips, km}` in the fixed `MODE_ORDER` display order.

Sources: `apps/postcards/src/features/map/visitedLayers.ts:111-178`,
`apps/postcards/src/features/travel/distance.ts:5-70`,
`apps/postcards/src/features/map/MapView.tsx:406-425, 758-762`,
`apps/postcards/src/features/map/MapScreen.tsx:341-348, 440`

### 4.5 Keep-alive map: mounted once, hidden via CSS, camera persisted at module scope

MapLibre teardown is expensive — unmounting made every return to the Map tab a full map reload — so
the map mounts once and is *hidden*, never unmounted. In `App.tsx:45-49, 265-274`, a `mapShown` ref
flips true the first time the Map tab is opened; from then on the `<div className="map-keep">`
wrapper always renders, gaining `.map-keep-hidden { display: none }` (`styles.css:194-204`)
whenever another tab or a city/country page is up. `MapScreen` receives `active={mapVisible}`:
while hidden, the MapLibre canvas stays alive in the DOM but the stat strip and the in-view list
*unrender* (`MapScreen.tsx:68-75, 425-429, 550`), so their text never shadows the visible screen
for screen readers or tests. `MapScreen` itself is code-split (`React.lazy`) so MapLibre only loads
when the map is first shown.

Two module-scope caches make remounts cheap when they *do* happen (the `MapView` is keyed on the
effective basemap, `MapScreen.tsx:433`, so switching basemaps rebuilds the map): `lastCamera`
records center/zoom on every `moveend` and seeds the next `Map` instance
(`MapView.tsx:30-36, 836-841, 899-901`), and the country-geometry promise cache avoids refetching
(see section 4.3). The full style — base + all nine overlay sources (empty) + overlay layers +
projection — is assembled *before* `new maplibregl.Map(...)`, so the map is never a blank canvas
waiting on an async `setStyle` (`MapView.tsx:812-833`).

**First open:** if no camera was saved (`hasSavedCamera()`), MapScreen fits instantly to the user's
own places (visited + wishlist cities + custom points) before the basemap even finishes
(`MapScreen.tsx:381-389`). The fit's longitude framing is antimeridian-aware via a largest-gap
algorithm (`MapScreen.tsx:391-415`): sort all longitudes, find the largest gap between consecutive
values (the wraparound counts as a gap), and frame the *complement* of that gap — so Fiji + Samoa
frame the Pacific tightly instead of the whole globe; if east < west after picking, 360 is added.

Programmatic camera moves (row-click focus, fit, popup ease) set `suppressBoundsRef` so their
`moveend` skips `emitBounds` — the in-view list only follows the user's own gestures — while
`applyViewportPoi` still runs so capped markers track the camera (`MapView.tsx:899-916,
1075-1101`). Resilience: if the online OSM raster base logs 4 source errors, `onBaseUnavailable`
fires once and MapScreen falls back to the offline vector base with a toast
(`MapView.tsx:920-931`, `MapScreen.tsx:447-453`); the privacy setting `onlineMap=false` forces the
offline base outright (`MapScreen.tsx:220-221`); `new Map` throwing (no WebGL) renders a text
fallback (`MapView.tsx:1103-1112`).

Sources: `apps/postcards/src/app/App.tsx:22-24, 45-49, 265-274`,
`apps/postcards/src/styles.css:194-204`, `apps/postcards/src/features/map/MapScreen.tsx:68-75,
220-221, 381-415, 433, 447-453`, `apps/postcards/src/features/map/MapView.tsx:30-36, 812-841,
899-931, 1075-1112`

### 4.6 The dockable in-view list

The list panel is never hidden (the old "Bigger map" button removed it, which read as losing your
data); instead it *docks*. `listSide` is `"end"` (right on desktop / below on mobile) or `"start"`
(left / above), persisted under `postcards-list-side`; a `min-width: 900px` media query (`wide`)
decides which axis the dock moves along, and the choice is applied purely via a `list-first` CSS
class on the `.map-screen` container (`MapScreen.tsx:112-137, 417-423`).

Re-docking is drag-driven: the ⠿ grab handle (a `<button>`) uses pointer capture with a 6 px dead
zone before a movement counts as a drag; once dragging, every pointermove compares the pointer to
the screen container's midline — x-midline when wide, y-midline when narrow — and calls
`setSideTo(firstHalf ? "start" : "end")`, so the panel re-docks *live* as the pointer crosses the
middle (`MapScreen.tsx:142-171`). Because it's a button, plain click/Enter also flips the side,
keeping the action keyboard- and single-tap-operable; a `dragMoved` guard swallows the click that
follows a real drag so the panel isn't flipped back on release (`MapScreen.tsx:172-179`). CSS gives
the handle `touch-action: none` so a touch drag moves the panel rather than scrolling the list
(`styles.css:521-535`).

A separate `listTall` toggle ("▲ List" / "▼ Map") adds the `list-tall` class, expanding the list
over the map without unmounting either (`MapScreen.tsx:112, 552-560`). Row interaction model:
clicking a row always *zooms* the map to that city (via the `focus` prop → `easeTo`, list held
still by the suppression flag) and expands inline detail; it never navigates away — the detail page
is behind the 📖 `GuideButton` that appears only on the selected row (`MapScreen.tsx:355-357,
675-715`).

Sources: `apps/postcards/src/features/map/MapScreen.tsx:112-179, 355-357, 417-423, 550-577,
675-715`, `apps/postcards/src/styles.css:521-535`

---

## 5. Offline & caching strategy

### 5.1 Service-worker layout: what precaches vs what runtime-caches

The PWA is configured entirely in `apps/postcards/vite.config.ts` via `vite-plugin-pwa`
(`registerType: "autoUpdate"` — new builds replace the old worker without a prompt). The Workbox
config splits the offline story into two tiers.

**Precache (installed with the SW, versioned with each build).**
`globPatterns: ["**/*.{js,css,html,json,geojson,pmtiles,woff2}"]` pulls in the app shell (compiled
JS/CSS, `index.html`, fonts) plus every bundled dataset under `public/`: the core gazetteer
`reference/cities.json` (~3.1 MB), `reference/airports.json` (~0.6 MB), `subdivisions.json`,
`heritage.json`, `landmarks.json`, `languages.json`, `article-names.json`, `experiences.json`, and
the Natural Earth 50m country geometry `basemap/countries-50m.json` (~0.76 MB) — roughly 5 MB of data plus the app
bundle, the "~6.7 MB shell + datasets" total. `maximumFileSizeToCacheInBytes: 8 * 1024 * 1024`
raises Workbox's 2 MB default so the 3.1 MB core gazetteer qualifies.

**Deliberately excluded from precache.** `globIgnores: ["**/reference/cities-all.json"]` keeps the
full 17 MB world gazetteer out of the install manifest. The comment in the config records why: the
app fetches that file once at first idle anyway, and precaching it made SW install and the app race
to each download 17 MB on first visit.

**Runtime caches (filled by use, not by install).** Two `runtimeCaching` rules, both `CacheFirst`:

```
url ends with /reference/cities-all.json → cache "gazetteer-v1"   (maxEntries 2,      60-day expiry, statuses [200])
url hostname ends with tile.openstreetmap.org → cache "osm-tiles-v2" (maxEntries 50_000, 30-day expiry, statuses [200])
```

Both rules whitelist `statuses: [200]` so error pages and opaque responses never poison a cache.
Everything cached is same-origin static data except the OSM tiles — and no tile is fetched until
the user is on the OpenStreetMap basemap (which is opt-out-able, see section 5.6).

Sources: `apps/postcards/vite.config.ts` (lines 17–74), `apps/postcards/public/reference/`,
`apps/postcards/public/basemap/countries-50m.json`

### 5.2 The 17 MB gazetteer: idle-time fetch behind a CacheFirst rule

`src/lib/reference/referenceData.ts` implements a two-stage gazetteer load that the SW config is
shaped around. `initReferenceData()` loads the precached core datasets at startup (all same-origin
`fetch`es served from the precache when offline), then fire-and-forgets `upgradeToFullGazetteer()`:

```
upgradeToFullGazetteer:
  await whenIdle()            # requestIdleCallback (timeout 4 s) or setTimeout 1.5 s
  cities = loadFullGazetteer() # fetch cities-all.json — parsed/folded/sorted in a Web Worker
                               # (gazetteerWorker.ts); inline fallback if Worker unavailable
  if cities.length > current: replaceCities(); generation++; dispatch "postcards:gazetteer-upgraded"
```

That single idle-time `fetch(CITIES_ALL_URL)` is what populates the `gazetteer-v1` runtime cache.
Because the handler is `CacheFirst`, every later launch — online or offline — reads the 17 MB file
from the Cache API without touching the network; the file only changes with a release, and the
60-day `maxAgeSeconds` forces an eventual revalidation. `maxEntries: 2` allows the old and new
base-path variant to coexist briefly without unbounded growth. The failure mode is graceful: if the
fetch fails (offline first run), `loadFullGazetteer()` returns null and the app simply keeps the
precached ~core-city set; the map and search work, just with fewer small towns, and the upgrade is
retried on a later launch.

Sources: `apps/postcards/src/lib/reference/referenceData.ts` (lines 30–43, 289–378),
`apps/postcards/vite.config.ts` (lines 44–55)

### 5.3 Basemap chain: OSM raster by default, bundled overview as automatic fallback, PMTiles pack when installed

Three basemaps exist, all resolved through the `MapSource` seam
(`src/lib/map-source/bundledMapSource.ts`):

- **`osm-raster` ("Detailed map", the default)** — a MapLibre raster style over
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (maxzoom 19), with a neutral `osm-bg` background
  layer so un-cached areas show grey instead of black when offline. `MapScreen.loadBasemap()`
  migrates any saved value that isn't `"detail"` to `"osm"` — the online map is "the one true
  basemap now" and the simple map is no longer a user-pickable option.
- **`world-overview` ("simple", the fallback)** — a fully offline style: an ocean-coloured
  background with **no tile sources at all**. The land you see on it comes from `MapView`'s
  overlay: Natural Earth 50m country polygons (`public/basemap/countries-50m.json`, TopoJSON,
  precached) loaded module-scope-once via `getCountries()` into a GeoJSON source and drawn as
  fill/outline layers. Attribution: "Boundaries © Natural Earth (public domain)".
- **`world-detail` ("Offline streets")** — an optional street-level vector style over a PMTiles
  archive, only offered when a pack is actually installed (section 5.4).

**The failure fallback.** When the base is OSM, `MapView` counts MapLibre `error` events whose
`sourceId === "osm"`; on the 4th error it fires `onBaseUnavailable()` exactly once. `MapScreen`
responds by switching state to `"simple"`, persisting it, and showing a toast ("Online map
unavailable — showing the offline map."). Because `loadBasemap()` coerces `"simple"` back to
`"osm"`, the fallback is effectively session-scoped — the next launch tries OSM again. Two
belt-and-braces details make the OSM base degrade before the fallback even triggers: previously
viewed tiles come from the `osm-tiles-v2` cache, and the overlay always draws a faint
`countries-outline` line layer "so the map is never a featureless rectangle even if rich-base tiles
fail to load".

```
effectiveBasemap = onlineMap ? saved(osm|detail) : "simple"   # MapScreen.tsx:221
MapView(basemap=osm): map.on("error") { if sourceId=="osm" && ++errors>=4 → onBaseUnavailable() }
MapScreen.onBaseUnavailable: setBasemap("simple"); toast
```

Sources: `apps/postcards/src/lib/map-source/bundledMapSource.ts`,
`apps/postcards/src/features/map/MapView.tsx` (lines 26–75, 366–405, 918–931),
`apps/postcards/src/features/map/MapScreen.tsx` (lines 59–66, 216–225, 447–453)

### 5.4 The `MapSource` seam and the device-global PMTiles pack

The map consumes basemaps only through the `MapSource` interface (`src/lib/map-source/types.ts`):
`listPacks()`, `isAvailableOffline(packId)`, `resolveStyle(packId) → {style, attribution}`. This is
the ecosystem seam from the constitution — the MVP backs it with `BundledMapSource`; a future
Capacitor Shared Offline Map Store (iOS App Group / Android SAF) implements the same interface with
no app-facing change.

Where a street-level pack comes from is a second, nested seam: `OfflineMapStore.detailPack()`
(`src/lib/map-source/offlineMapStore.ts`). The web implementation, `BundledOfflineMapStore`, probes
`${BASE_URL}basemap/world-detail.pmtiles` — a file the self-hosting operator may place next to the
app's assets; none is bundled (a world street pack is device-global and far too large to ship
in-app). The probe is defensive: it Range-GETs bytes 0–6 and requires a non-HTML `content-type` and
the literal 7-byte `PMTiles` magic, because a common SPA history-fallback
(`try_files … /index.html`) answers 200 with HTML for missing files and a bare-200 check would
advertise a basemap that renders broken. Any failure returns null — gracefully absent.

`BundledMapSource.listPacks()` only advertises `world-detail` when `detailPack()` succeeds;
`resolveStyle("world-detail")` builds `detailVectorStyle("pmtiles://<url>")` — layers following the
Protomaps "basemap" schema (earth/landuse/water/roads/boundaries) — and falls back to the overview
style if the pack vanished between listing and resolving. On the consuming side,
`MapView.ensurePmtilesProtocol()` registers the `pmtiles://` protocol with MapLibre exactly once,
and `MapScreen` checks `isAvailableOffline("world-detail")` on mount to decide whether the
basemap-cycle button offers "Offline streets" (and to migrate a stale saved `"detail"` preference
back to `"osm"` if the pack is gone). The store rule is absolute: packs are never read via
hard-coded app-private paths — only via the URL this store resolves.

Sources: `apps/postcards/src/lib/map-source/types.ts`,
`apps/postcards/src/lib/map-source/offlineMapStore.ts`,
`apps/postcards/src/lib/map-source/bundledMapSource.ts` (lines 99–154),
`apps/postcards/src/features/map/MapView.tsx` (lines 38–43),
`apps/postcards/src/features/map/MapScreen.tsx` (lines 190–205)

### 5.5 Explicit offline tile packs: pre-warming the OSM runtime cache

"Offline maps" in Settings is not a separate storage system — it deliberately pre-warms the same
`osm-tiles-v2` SW cache that normal browsing fills. The machinery lives in the extractable,
app-import-free seam `src/lib/offline/` (re-exported through shims `features/map/offlineTiles.ts`
and `features/settings/regions.ts`).

`tiles.ts:tilesForBounds(bounds, baseZoom, levels, maxTiles)` is pure slippy-map math: standard
lon→x / Mercator lat→y tile formulas, iterating zoom levels coarsest-first so a cap keeps wide-area
coverage, and splitting a west>east viewport into two x-spans so antimeridian regions download
correctly. `saveAreaOffline()` then just fetches every URL so the SW's CacheFirst rule stores the
responses:

```
for url in dedupe(tilesForBounds(...)):        # 3 concurrent workers by default —
  fetch(url, { mode: "cors",                   # modest, per OSM tile usage policy
               referrerPolicy: "strict-origin-when-cross-origin" })
  # CORS ⇒ only real 200s are cacheable (no opaque error tiles);
  # explicit referrerPolicy ⇒ the Referer OSM requires is actually sent
```

It is abortable (`AbortSignal`), progress-reporting, and counts failures honestly. `regions.ts`
defines the catalog: a `world` overview pack (whole world, zooms 0–5) plus 8 continent-scale packs
(base zoom 3–4, 4 levels), with `estimateRegion()` computing the **exact** tile count from the grid
before download and an estimated size at ~18 KB/tile, capped at `REGION_MAX_TILES = 40_000`. That
cap explains the SW cache's `maxEntries: 50_000` — the LRU limit must exceed the largest explicit
download plus browsing headroom, or eviction would silently delete tiles the user explicitly saved.
The cache name is `osm-tiles-v2` because v1 predated the CORS/Referrer-Policy fix and could contain
opaque "Referer required" error tiles (status 0); renaming dropped them wholesale. Settings' "reset
maps" deletes only caches whose names start with `osm-tiles` plus map-view localStorage keys —
visits/journal/backups live in IndexedDB and are untouched.

Sources: `apps/postcards/src/lib/offline/tiles.ts`, `apps/postcards/src/lib/offline/regions.ts`,
`apps/postcards/src/lib/offline/README.md`,
`apps/postcards/src/features/settings/SettingsScreen.tsx` (lines 48–99, 158–164),
`apps/postcards/vite.config.ts` (lines 56–71)

### 5.6 Privacy constraints: what may touch the network, and how to turn it all off

The caching design enforces the constitution's privacy posture (local-first, no telemetry, data
leaves the device only on explicit user action):

- **No request ever carries user data.** The only recurring third-party requests the map can make
  are OSM tile GETs of the form `/z/x/y.png` — coordinates of the viewed map area, no identifiers,
  no query params. `referrerPolicy: "strict-origin-when-cross-origin"` on explicit downloads sends
  only the origin. Everything else the offline system fetches (`cities-all.json`,
  `countries-50m.json`, all `reference/*` files, an operator-provided `world-detail.pmtiles`) is
  same-origin static data.
- **Online maps are opt-out with one switch.** `useSettings.onlineMap` (localStorage
  `postcards-online-map`, default on, only `"0"` disables) is described in code as "the privacy
  escape hatch": when off, `MapScreen` computes `effectiveBasemap = "simple"` regardless of the
  saved preference, and the basemap-cycle button is hidden. The `world-overview` style has zero
  sources, so the map then makes **no outbound requests at all** — its geometry is the precached
  Natural Earth file. Settings states the contract in user-facing words: "Turn it off to use the
  plain offline map only, so the app makes no network requests at all. Either way, no personal data
  ever leaves your device."
- **Nothing third-party is fetched at startup.** The SW precache and the idle gazetteer fetch are
  same-origin; per the offline seam's README, tile downloads "happen only on explicit user
  action" — either the user enabled/kept the OSM basemap and panned the map, or tapped Download on
  a region pack. Wikivoyage guides (a separate opt-in seam under `src/lib/wikivoyage/`,
  `referrerPolicy: "no-referrer"`) follow the same pattern but are outside the map path.
- **Failure never punishes offline use.** Every network-dependent path degrades: OSM errors fall
  back to the offline base, a missing PMTiles pack de-advertises itself, a failed gazetteer upgrade
  leaves the core set in place with a retry on a later launch, and failed country geometry gets an
  in-map Retry button (`loadGeometry(map, force)` clears the module-scope promise so a retry can
  succeed without a remount).

Sources: `apps/postcards/src/lib/store/useSettings.ts` (lines 49–58, 65–66, 90–98),
`apps/postcards/src/features/map/MapScreen.tsx` (lines 83–85, 220–221, 538–542),
`apps/postcards/src/features/settings/SettingsScreen.tsx` (lines 123–128),
`apps/postcards/src/lib/offline/README.md`, `apps/postcards/src/features/map/MapView.tsx` (lines
63–75, 786–797, 1122–1139)

---

## 6. Portable file, validation & sanitization

### 6.1 The versioned portable file: one strict Zod schema, additive versions v1→v5

The canonical portable file is a single JSON document validated by `PostcardsFileSchema` in
`apps/postcards/src/lib/schema/models.ts`. Its envelope is:

```
{ format: "postcards",          // z.literal(FORMAT)
  schemaVersion: int >= 1,       // current SCHEMA_VERSION = 5
  exportedAt: ISO datetime (offset allowed),
  visits:  Visit[],
  trips:   Trip[]   (optional, default []),   // added v2
  stories: Story[]  (optional, default []),   // added v5
  referenceSources: ReferenceSource[] (optional, default []) }
```

Every object schema — `PlaceRefSchema`, `PhotoSchema`, `VisitSchema`, `TripSchema`, `StorySchema`,
`ReferenceSourceSchema`, and the file itself — is `.strict()`: unknown keys are a hard parse
failure, not silently dropped. This is what makes the version bump strategy work (see below).

There is **no chain of migration functions**. Versions are additive and the *current* schema
accepts every older shape directly:

- **v2** added optional top-level `trips`.
- **v3** replaced a visit's single `photo` (a data URL) with a `photos` gallery (each
  `{src, caption}`); *both* fields still validate, and `normalizeVisitPhotos(v)` migrates on every
  load/import: it copies `photos`, unshifts the legacy `photo` as `{src, caption: null}` if not
  already present by `src`, and drops the `photo` key. It is idempotent and non-mutating, and
  returns a record *without* a `photos` key when the gallery is empty. New exports only ever write
  `photos`.
- **v4** added the `"custom"` value to `PlaceRef.kind` (user-authored point with optional
  `lat`/`lon` carried on the record, since custom places have no reference-data entry).
- **v5** added optional top-level `stories`.

The version bumps exist for the *reverse* direction: because the schema is strict, an **older**
build opening a newer file would otherwise fail with a cryptic unknown-key error. Instead the
importer checks `schemaVersion > SCHEMA_VERSION` *before* Zod parsing and refuses with `"This file
was made by a newer version (schema vN). Please update the app."` (see
`apps/postcards/src/features/backup/importJson.ts:51-57`). Similarly, `PlaceRef.kind` is a closed
enum, so a file using a newer kind fails closed in an older app by design (comment at
`models.ts:30-31`).

Other notable field rules: `PlaceRef.countryId` must match `/^[A-Z]{2}$/` (ISO 3166-1 alpha-2); ids
(`visitId`, `tripId`, `storyId`) are deliberately *not* required to be RFC-4122 UUIDs — just
bounded non-empty strings (1–100 chars) — so the file stays hand- and AI-writable; dates are
`YYYY-MM-DD` strings; `Visit.status` defaults to `"visited"` and `favorite` to `false` so
pre-wishlist files import unchanged. ``placeKey({kind,id}) = `${kind}:${id}` ``
(`models.ts:230-233`) is the stable identity used for dedupe everywhere.

Sources: `apps/postcards/src/lib/schema/models.ts`,
`apps/postcards/src/features/backup/importJson.ts`

### 6.2 Import pipeline: guard → parse → refuse-newer → strict validate → merge

`importFile(text)` in `apps/postcards/src/features/backup/importJson.ts` treats file content as
pure inert data (Constitution VI). It is a pure function returning
`{ok:true, visits, trips, stories, warnings}` or `{ok:false, error}` — every failure is a clear
English reason, never an exception. The stages, in order:

```
1. text.length > 256_000_000        → "too large to import safely"   (main-thread DoS guard,
                                       generous because photos are inline; a ceiling, not a schema rule)
2. JSON.parse fails                 → "not valid JSON"
3. not a non-null object            → "does not look like a Postcards file"
   (checked BEFORE reading .format — JSON.parse("null") or a bare string parse fine)
4. format not in {"postcards","placebeen"} → same refusal;
   "placebeen" (pre-rename marker) is accepted and rewritten to "postcards" in place
5. schemaVersion is a number > SCHEMA_VERSION → "made by a newer version … update the app"
6. PostcardsFileSchema.safeParse    → on failure, report the FIRST Zod issue with its
                                       dotted path: `Invalid data at "visits.0.place.name": …`
7. merge duplicates (below), collect warnings
```

Step 6 is also where all sanitization happens: the Zod `.transform()`s in `models.ts` run
`sanitizeText` on every free-text field during parsing, so a successfully imported file is already
clean.

Step 7 enforces the app's identity invariants on hand-edited files:

- **Visits** — one record per `placeKey(place)` (FR-015). First occurrence wins the record
  identity, but galleries are **unioned**: later duplicates' photos are appended if their `src`
  isn't already present, capped at `MAX_PHOTOS_PER_VISIT` (photos are the payload; dropping one
  silently would lose data). The merged record keeps the *first* record's `visitId` and `addedAt`
  but the *last* record's other fields
  (`{...v, visitId: existing.visitId, addedAt: existing.addedAt, photos}`). Every visit passes
  through `normalizeVisitPhotos` first so both persisted and in-memory copies are v3-shaped.
- **Trips** and **stories** — one record per `tripId` / `storyId`, **last-wins**, deliberately
  matching what IndexedDB `put` order would produce anyway (the stores are keyed on those ids, so a
  duplicate id would silently drop rows on persist and diverge from the in-memory count).

If any merging happened, the result carries human-readable warnings ("Merged duplicate places in
the file." etc.) rather than failing.

Sources: `apps/postcards/src/features/backup/importJson.ts`,
`apps/postcards/src/lib/schema/models.ts`

### 6.3 Text sanitization: strip invisibles, cap length

`sanitizeText(input, maxLength = 2000)` in `apps/postcards/src/lib/schema/sanitize.ts` renders
untrusted free text inert — it never evaluates anything, only removes. The algorithm:

```
1. input.replace(/\r\n?/g, "\n")        — normalize CRLF/CR to LF
2. stripControlChars(...)                — drop, per code point:
     • C0/C1 controls: 0–31 except tab(9)/newline(10), plus DEL(127)
     • zero-width: U+200B, U+2060, U+FEFF (the joiners U+200C/U+200D stay:
       emoji sequences and Persian or Indic spelling need them)
     • directional marks U+200E, U+200F, U+061C
     • bidi overrides/isolates: U+202A–202E, U+2066–2069  ("Trojan Source" spoofing)
3. .trim()
4. slice(0, maxLength)
```

A leading `=`, `+`, `-` or `@` is left alone: it is plain text in the JSON file and in the app
("- packed: boots"). Spreadsheet formula injection is handled where a spreadsheet opens the text,
in the CSV writer (`features/backup/exportCsv.ts`), which prefixes such a field with `'`; the CSV
importer drops that apostrophe again so the name round-trips.

Note the iteration is over code points (`for (const ch of input)` + `codePointAt`), so astral
characters (emoji) survive intact rather than being split into surrogates.

Sanitization is wired in as **Zod transforms on the models**, so it runs on every import and on the
app's own export self-validation — never as a separate pass someone could forget. Per-field caps:
`PlaceRef.name` 200, `Photo.caption` 300, `Visit.note` 2000, `Trip.carrier` 120, `Trip.note` 2000,
`Story.title` 200, `Story.text` 8000. Two fields (`PlaceRef.name`, `Story.title`) add a
`.refine(s => s.length > 0)` *after* the transform because Zod's `min(1)` checks the input: a name
consisting only of invisible characters (e.g. a lone U+200B) sanitizes to `""` and is rejected with an
explicit "empty once sanitized" message instead of poisoning the file. Nullable optional fields
transform `null | undefined → null` uniformly.

The same helper is reused for text entered *inside* the app: `useVisits.setDetails` sanitizes notes
with the identical 2000-char cap before persisting
(`apps/postcards/src/lib/store/useVisits.ts:147-161`), so local edits and imports converge on the
same invariants.

Sources: `apps/postcards/src/lib/schema/sanitize.ts`, `apps/postcards/src/lib/schema/models.ts`,
`apps/postcards/src/lib/store/useVisits.ts`

### 6.4 Photos: bounded, inert, inline data URLs — never external links

Photos live *inside* the portable file as data URLs, keeping the file single and self-contained (no
filesystem side-car, nothing to fetch). The schema enforces inertness and bounds in `models.ts`:

- `photoDataUrl = z.string().max(6_000_000).refine(s => s.startsWith("data:image/"))` — at most
  ~6 MB of string per image, and only inline `data:image/…` sources; an `https://` or
  `javascript:` URL fails validation. Images are only ever rendered via `<img src>`, never
  executed, and are downscaled on capture.
- `PhotoSchema = { src: photoDataUrl, caption: string ≤ 300 | null }.strict()`, caption sanitized.
- Gallery caps: `MAX_PHOTOS_PER_VISIT = 48`, `MAX_PHOTOS_PER_STORY = 24`, enforced by
  `z.array(PhotoSchema).max(...)`.

The caps are defended at every entry point, not just at parse time:

- **In-app**: `useVisits.addPhoto` refuses to append past `MAX_PHOTOS_PER_VISIT` — explicitly so
  that an over-full gallery can never make `buildFile`'s self-validation throw and block backup
  entirely (`useVisits.ts:120-129`).
- **On import**: the duplicate-place gallery union stops at the cap (`importJson.ts:81-85`).
- **Legacy shape**: the pre-v3 single `photo` field uses the same `photoDataUrl` rule and is folded
  into `photos[0]` by `normalizeVisitPhotos`.

On export, `buildFile` strips empty `photos` arrays from visits and stories
(`visits.map(({photos, ...rest}) => photos?.length ? {...rest, photos} : rest)`) so a photo-less
export stays lean and human-readable, then **validates its own output** with
`PostcardsFileSchema.parse(file)` before handing it to the user. `serializeFile` writes
pretty-printed 2-space JSON; the canonical filename is `places.postcards.json`. The overall import
size ceiling (256 M chars in `importJson.ts`) is sized so a photo-rich backup always restores.

Sources: `apps/postcards/src/lib/schema/models.ts`,
`apps/postcards/src/features/backup/exportJson.ts`, `apps/postcards/src/lib/store/useVisits.ts`,
`apps/postcards/src/features/backup/importJson.ts`

### 6.5 Dedupe upsert: at most one visit per (kind, id)

A place is identified by ``placeKey(place) = `${kind}:${id}` `` (`models.ts:230-233`) — e.g.
`city:2988507` or `country:FR`. Country coverage is derived from city visits, so there is exactly
one visit record per place, whatever its status.

The live store enforces this with `dedupeUpsert(list, visit)` in
`apps/postcards/src/lib/store/useVisits.ts:18-25`, a pure function (exported for IndexedDB-free
unit tests):

```
key = placeKey(visit.place)
idx = first index in list with the same key
if none: return [...list, visit]                    // append
else:    replace list[idx] with
         { ...visit, visitId: old.visitId, addedAt: old.addedAt }
```

Re-logging a place therefore *updates* the existing record — new fields win, but the record's
identity (`visitId`) and original `addedAt` timestamp are preserved. `addVisit` builds the
candidate visit by merging with `findByPlace(...)`: it keeps the existing gallery
(`photos: existing?.photos ?? []`), existing `favorite`, and falls back to the existing
`date`/`note` when the caller passes none — so toggling status (`toggleVisit`: none→visited,
wishlist→visited, visited→removed; `toggleWish`: none→wishlist, wishlist→removed,
visited→no-op) never loses photos or notes. After the in-memory upsert, the single record is
persisted with `db.putVisit`.

The import path applies the same invariant to whole files (see section 6.2): duplicates by
`placeKey` are merged first-record-identity + gallery-union, so restore and live logging obey one
rule (FR-015).

Sources: `apps/postcards/src/lib/store/useVisits.ts`, `apps/postcards/src/lib/schema/models.ts`,
`apps/postcards/src/features/backup/importJson.ts`

### 6.6 Published JSON Schema: generated from Zod (input form), kept honest by a test

The publicly documented file format is a JSON Schema artifact committed at
`apps/postcards/src/lib/schema/portable-file.schema.json`, but it is never hand-edited — it is
*generated* from the Zod models by `portableFileJsonSchema()` in
`apps/postcards/src/lib/schema/jsonSchema.ts`:

```
z.toJSONSchema(PostcardsFileSchema, {
  io: "input",              // shape BEFORE sanitizing transforms run
  target: "draft-2020-12",
  unrepresentable: "any",
})
```

plus a stable `$id` (the artifact's GitHub URL) and a `title` embedding the current
`SCHEMA_VERSION`. The `io: "input"` choice is the key design point: Zod schemas with `.transform()`
have two shapes, and the published one must describe what a file looks like **before** the app's
sanitization runs — that is the form external tools, people, and AI agents author. (Transforms like
`sanitizeText` are unrepresentable in JSON Schema anyway; `unrepresentable: "any"` keeps generation
from throwing on them.)

Sync is enforced mechanically by `apps/postcards/tests/unit/schemaArtifact.spec.ts`: it calls
`portableFileJsonSchema()` and asserts deep equality with the committed artifact, so any change to
`models.ts` without a regenerated artifact fails CI. The same test doubles as the generator — when
`UPDATE_SCHEMA=1` is set it rewrites the artifact before asserting. The `pnpm schema` script
(`apps/postcards/package.json:14`) is exactly
`UPDATE_SCHEMA=1 vitest run tests/unit/schemaArtifact.spec.ts`. A second test asserts the output is
self-describing draft 2020-12 with the expected title and a `visits` property. Net effect: Zod
models are the single source of truth for the TypeScript types, the runtime validator, *and* the
published contract, and the three cannot drift.

Sources: `apps/postcards/src/lib/schema/jsonSchema.ts`,
`apps/postcards/tests/unit/schemaArtifact.spec.ts`,
`apps/postcards/src/lib/schema/portable-file.schema.json`, `apps/postcards/package.json`

---

## 7. Maintenance

This document describes the code **as of 2026-07-14**. Line-number citations are anchors into that
snapshot and will drift as files change. When any of the cited files changes materially — in
particular `computeStats.ts`, `referenceData.ts`, `search.ts`, `MapView.tsx`, `MapScreen.tsx`,
`models.ts`, `importJson.ts`, `sanitize.ts`, or `vite.config.ts` — update the corresponding section
(and its `Sources:` line) in the same change set. If a section and the code disagree, the code
wins; fix the doc.

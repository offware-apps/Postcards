# Architecture

How Postcards is put together: the tech baseline, the workspace layout, and the
handful of **seams** — small, replaceable interfaces — that keep the
[Constitution](Privacy-and-Constitution.md)'s promises (offline-first, zero lock-in,
privacy, one portable file) enforceable in code rather than by convention.

Everything below is grounded in the code under `apps/postcards/`. If you're new,
read [Home](Home.md) first, then this page, then [Data and provenance](Data-and-Provenance.md).

---

## Tech stack

| Layer | Choice | Where |
| --- | --- | --- |
| Language / UI | **TypeScript** + **React 19** | all of `src/` |
| Build / dev | **Vite 8** (+ `@vitejs/plugin-react`) | `vite.config.ts` |
| PWA | **`vite-plugin-pwa`** (Workbox, `registerType: "autoUpdate"`) | `vite.config.ts` |
| Native | **Capacitor 6** wraps the same `dist/` build as iOS/Android | `capacitor.config.ts` |
| Map | **MapLibre GL 5** + **`pmtiles`** protocol | `features/map/`, `lib/map-source/` |
| State | **Zustand 5** | `lib/store/` |
| Storage | **IndexedDB** via **`idb` 8** | `lib/db/` |
| Validation | **Zod 4** → generated JSON Schema | `lib/schema/` |
| Geometry | `topojson-client`, `world-atlas` (Natural Earth) | `features/map/MapView.tsx` |
| i18n | zero-dependency in-house dictionary (EN/FR/KO) | `lib/i18n/` |
| Tests | **Vitest 4** (jsdom), **Playwright**, **axe-core** | `tests/` — see [Testing](Development.md#testing) |
| License | **AGPL-3.0-or-later** | `package.json` |

There is **no Google, no proprietary SDK, no backend**. The GitHub connector
(below) is plain `fetch` against the REST API, not the Octokit SDK, precisely so
it stays a replaceable component (Constitution: zero lock-in).

**One build, three targets.** The same Vite build is the self-hostable website,
the PWA installed to a home screen, and the payload Capacitor ships natively.
`vite.config.ts` keeps `base` configurable via `VITE_BASE` so it can serve from
a domain root locally/natively or from a repo subpath on GitHub Pages
(`/Postcards/`), which keeps asset URLs, the manifest scope, and the service
worker all resolving correctly. Workbox precaches the app shell plus the bundled
reference and basemap assets; the **17 MB full gazetteer is deliberately not
precached** (it would race the app for bandwidth on first visit) and is instead
runtime-cached `CacheFirst` on its first idle fetch. OSM raster tiles are
runtime-cached the same way, but only ever fetched once the user opts into the
online basemap.

---

## Workspace layout

A pnpm workspace (`pnpm-workspace.yaml`). The one app today lives under
`apps/postcards/`; `packages/` is reserved for shared ecosystem packages.

```
apps/postcards/
├── src/                      # the app (see next section)
├── public/
│   ├── basemap/              # Natural Earth outlines + lakes/rivers (public domain)
│   │   ├── countries-50m.json  lakes-110m.json  rivers-110m.json
│   │   └── PROVENANCE.md
│   ├── reference/            # aggregated, openly-licensed datasets (built asset)
│   │   ├── cities.json  cities-all.json  subdivisions.json  airports.json
│   │   ├── heritage.json  landmarks.json  languages.json  article-names.json
│   │   ├── experiences.json
│   │   └── PROVENANCE.md
│   └── icons/                # PWA icons
├── scripts/build-reference.mjs   # regenerates public/reference/* from npm datasets
├── tests/                    # unit (Vitest) + e2e (Playwright)
├── vite.config.ts   capacitor.config.ts   package.json
└── android/  ios/            # Capacitor native projects (both committed)
```

Personal data is **never** committed here — visits, trips, stories, and photos
live only in IndexedDB and the user's own exported file. See
[Privacy and security](Privacy-and-Constitution.md).

---

## Source layout: `features`, `lib`, `ui`

`src/` is split into three tiers plus a small app shell:

- **`src/app/`** — `App.tsx`, the shell: the five-tab nav (Map, Places, Trips,
  Journal, Stats), global keyboard shortcuts, and the boot effect that loads the
  three data stores. **MapLibre is code-split** here with `React.lazy` so it
  loads only when the map is first shown, then the map screen stays mounted
  (hidden with CSS) so returning to the tab never reloads the map.

- **`src/features/`** — one folder per user-facing area, each owning its screens
  and feature-local logic:
  `backup`, `city`, `country`, `experiences` (Moments), `guides` (Wikivoyage),
  `journal`, `map`, `passport`, `publish`, `settings`, `stats`, `travel`
  (trips + boarding-pass import), `visits`.

- **`src/lib/`** — framework-agnostic building blocks and the **seams**:
  `map-source` · `offline` · `publish` · `sync` · `reference` · `schema` ·
  `db` · `store` · `format` · `i18n` · `image` · `bcbp` · `hooks` · `wikivoyage`.

- **`src/ui/`** — shared presentational components (`Toast`, `ScopeToggle`,
  `ThemeToggle`, `LanguageToggle`, `CityLine`, `ListPager`, `icons`, …).

The dependency direction is one-way: `features/*` and `app/` depend on `lib/*`;
`lib/*` modules depend only on each other and never import a feature. That is
what lets the seams below be swapped without touching screens.

---

## Seam 1 — `MapSource`: the offline-first basemap

`lib/map-source/types.ts` defines the only contract the map consumes tiles
through:

```ts
export interface MapSource {
  listPacks(): Promise<MapPackRef[]>;
  isAvailableOffline(packId: string): Promise<boolean>;
  resolveStyle(packId: string): Promise<ResolvedMapStyle>;   // { style, attribution }
}
```

`bundledMapSource` (a singleton `BundledMapSource` in `bundledMapSource.ts`) is
the MVP implementation, exposing three packs:

- **`world-overview`** — a bundled, **fully-offline** base (a flat background
  the app fills with Natural Earth country outlines). The default; issues no
  network requests, ever.
- **`osm-raster`** — an **opt-in online** OpenStreetMap raster style. Explicitly
  labelled "(online)" and never the default.
- **`world-detail`** — an **opt-in, offline** street-level vector style over a
  PMTiles archive (`detailVectorStyle()` targets the Protomaps "basemap" flavor,
  ODbL). Only advertised when a pack is actually installed — none is bundled,
  because a world street pack is device-global and far too large to ship in-app.

`MapView.tsx` calls `bundledMapSource.resolveStyle(pack)` and merges the returned
base style with its own overlay sources/layers into one complete `StyleSpecification`
up front, so the map is never a blank canvas waiting on an async `setStyle`. It
registers the `pmtiles://` protocol with `maplibregl.addProtocol` once, so the
detail pack can be read through MapLibre without an HTTP tile server.

See [Offline maps](../docs/OFFLINE-MAPS.md) and [Map](Features.md#the-map).

## Seam 2 — `OfflineMapStore`: device-global map packs

The ecosystem constraint (offline maps must be **device-global / cross-app**,
never app-private) is enforced by a second seam, `lib/map-source/offlineMapStore.ts`:

```ts
export interface OfflineMapStore {
  detailPack(): Promise<OfflineMapPack | null>;   // { id, pmtilesUrl } or null
}
```

`BundledMapSource` never reads a tile pack by a hard-coded app-private path — it
asks *this* store for a URL. Today `BundledOfflineMapStore` probes for a PMTiles
file placed alongside the app's assets, and it does so carefully: it `Range`-GETs
only the **first 7 bytes** and checks for the literal `PMTiles` magic header
(and that the content-type isn't HTML), so a self-host `try_files … /index.html`
fallback can't trick the app into advertising a "Streets (offline)" base that
renders broken. Tomorrow a Capacitor `SharedOfflineMapStore` plugin (iOS App
Group / Android SAF) implements the **same interface** with no app-facing
change.

## Seam 3 — the publish / sync git target

`lib/publish/gitTarget.ts` decides **where a push goes**, kept behind a seam so
the app never hard-codes a vendor:

```ts
export interface PublishTarget {
  readonly name: string;
  putFiles(files: PublishFile[], message: string): Promise<void>;
}
```

`GitHubTarget` is one optional implementation, plain `fetch` against the GitHub
REST **Contents API** (no SDK). Every push is an explicit user action, and the
fine-grained token is held only in memory / on-device — it is **never bundled
into an export**. The same target backs two features:

- **Journal publishing** (`features/publish/`) — pushes a self-contained,
  read-only travel-blog site (`putFiles`). See [Journal publishing](Publishing.md).
- **Device sync** (`lib/sync/`) — pushes the one portable data file. For this it
  uses the conditional pair `getFile()` / `putFileConditional()`: the file's git
  blob SHA is the version token, and a non-fast-forward write returns 409/422,
  which `GitHubTarget` raises as `GitPushConflictError`.

The **sync engine** (`lib/sync/engine.ts`) is deliberately I/O-agnostic: the git
host lives behind a `SyncRemote` interface (`gitHubSyncRemote()` adapts a
`GitHubTarget`, translating `GitPushConflictError` → `SyncConflictError`).
`syncOnce()` runs **pull → merge → write-local → push**, and on a push race it
re-pulls, re-merges, and retries automatically, so the user never resolves a git
text conflict by hand. Local data is written only *after* a successful push, so
a failed sync leaves the device byte-identical to its prior state.

The merge itself (`lib/sync/merge.ts`) is a pure, record-level convergent merge:
**newest-wins** by `updatedAt` (falling back to `addedAt`), with deletions
represented as **tombstones** so a delete isn't resurrected by a stale copy. It
is deterministic, commutative (`merge(a,b) == merge(b,a)`), and idempotent
(`merge(a,a) == a`). See [Device sync](Device-Sync.md).

---

## Reference data: pipeline, two-stage gazetteer, spatial grid index

Postcards is an **aggregator, never an author** — so all world facts are built
from named datasets and shipped as static assets, never invented in app code.

### The build pipeline

`scripts/build-reference.mjs` (`pnpm reference`) reshapes openly-licensed npm
datasets into `public/reference/*.json`:

- **`all-the-cities`** (GeoNames, CC BY 4.0) → cities, plus per-region centroid
  accumulation.
- **GeoNames `cities500` and `admin1CodesASCII`**, vendored under
  `scripts/data/` from one retrieval day → each city's current region code and
  each code's name; a city GeoNames no longer lists takes its nearest listed
  city's region, and France's regions keep their French names.
- **`country-state-city`** (dr5hn, ODbL) → a name, by nearest centroid, only for
  a code GeoNames does not name.
- **`airport-data`** (OpenFlights / OurAirports) → IATA-coded airports; rows
  whose country can't be resolved are **dropped, never guessed**.
- `i18n-iso-countries` + `world-countries` supply ISO codes, continents, and
  UN-member vs. territory status.

Provenance is recorded in machine-readable `src/lib/reference/data/provenance.json`
(shown in Settings) and mirrored in `public/reference/PROVENANCE.md`. See
[Reference data](Data-and-Provenance.md).

### The two-stage gazetteer

The build emits **two tiers** so 17 MB never sits on the first-paint path:

- `cities.json` — a small **core** set (population ≥ 15,000).
- `cities-all.json` — the **full** world gazetteer (~135k cities, ~17 MB).

`lib/reference/referenceData.ts` orchestrates the staged load:

1. `initReferenceData()` fetches the **core** cities plus subdivisions, airports,
   heritage, landmarks, languages, and article-names **in parallel**, builds the
   `ReferenceDataImpl` singleton (all the lookup maps + search indices), and
   returns — so the UI and map come up immediately.
2. It then fires `upgradeToFullGazetteer()` (fire-and-forget). That waits for a
   calm moment (`requestIdleCallback`), fetches and folds the full set **off the
   main thread** in a Web Worker (`gazetteerWorker.ts` — normalizes the search
   string and sorts population-descending), then calls `replaceCities(prepared)`
   to swap the array **in place** on the same singleton every consumer holds.
3. A generation counter is bumped and a `postcards:gazetteer-upgraded` window
   event fires. React screens subscribe via `useGazetteerGeneration()`
   (`useSyncExternalStore`), which they thread into `useMemo` deps so snapshots
   of city data re-compute when the bigger set lands — the singleton mutates in
   place, so the `ref` reference alone would never invalidate those memos.

### The viewport spatial grid index

Scanning ~135k cities on every map pan is the felt lag at city/region zoom.
`features/map/viewport.ts` fixes this with a **1°×1° spatial grid** (`GRID_COLS =
360`, 180 rows) built **once** and rebuilt only when the cities array *identity*
changes (i.e. the core→full upgrade):

- **Zoomed-in view** (covered cells ≤ `CELL_MAX = 1024`, ≈ a 32°×32° window):
  visit only the handful of grid cells the viewport covers, collect candidates,
  and sort that small set — the fast path.
- **Wide view / unbounded**: fall back to a population-ordered early-break over
  the presorted array (already fast because the top cities are everywhere).

All membership tests are **antimeridian-aware** (`lonInRange`, `wrapCol`,
`columnSpan`), so a viewport straddling ±180° still lists the right cities.
`citiesInView()` powers the live "cities in view" list and the map's in-view
markers. See [Map](Features.md#the-map).

---

## Zustand stores

State lives in `lib/store/` as small Zustand stores, one per concern:

| Store | Holds |
| --- | --- |
| `useVisits` | the `Visit[]` and every mutation (`toggleVisit`, `toggleWish`, `toggleFavorite`, photos, details, import merge); writes through to `visitsDb` and records tombstones on delete |
| `useTrips` | the travel log (`Trip[]`) |
| `useStories` | journal stories (`Story[]`) |
| `useSettings` | country scope, online-map toggle, marker cap, theme, language |
| `useUi` | current tab, open city/country page, map focus, trip year/month filter |
| `useToast` | transient toasts |

Two patterns worth knowing:

- **Imperative map repaint.** `MapView` does **not** subscribe to `visits` for
  rendering. It calls `useVisits.subscribe(...)` and repaints visited markers
  imperatively (key-guarded so unrelated changes are cheap no-ops), so tapping a
  place flips its flag synchronously without waiting for a React re-render — what
  makes the map feel instant on a phone.
- **Array-identity index cache.** `visitIndex()` memoizes a `placeKey → Visit`
  map in a `WeakMap` keyed by the `visits` array reference, so the hundreds of
  mounted per-place selectors don't each linear-scan the list on every `set()`.

---

## IndexedDB working store (`visitsDb`)

The on-device working store (Constitution: local-first, no backend) is one
IndexedDB database opened with `idb` in `lib/db/visitsDb.ts`:

- **Database:** `postcards`, **version 4**. `tripsDb.ts` and `storiesDb.ts`
  reuse the same `getDb()` handle — one database, several object stores.
- **Object stores** (keyPath in parentheses):
  - `visits` (`visitId`)
  - `trips` (`tripId`)
  - `stories` (`storyId`)
  - `tombstones` (`key`, where `key = "${kind}:${id}"`)
- **Versioned upgrades**, all additive and idempotent, so an existing database
  keeps its data: **v2** added `trips` (travel log), **v3** added `stories`
  (journal), **v4** added `tombstones` (device sync). The `upgrade` callback only
  ever *creates* missing stores.
- **One-time legacy migration.** On first open it carries data over from the
  pre-rename `placebeen` database — best-effort, and only when the new store is
  empty, so it can never clobber current data.
- **Atomic import/sync.** `replaceAllPortable(visits, trips, stories, tombstones)`
  clears and rewrites the relevant stores in a **single transaction**, so an
  import or a merged sync-pull can never leave the device with the new records
  from one store and the old from another (the single-portable-file guarantee).

`hasIndexedDB()` guards every call, so the app degrades gracefully where
IndexedDB is unavailable (e.g. some private-mode contexts). See
[Data model](Data-and-Provenance.md) and [Backup and restore](Features.md#backup-import--reset).

---

## The Zod schema and generated JSON Schema

`lib/schema/models.ts` is the **single source of truth** for the portable file.
The Zod models generate both the TypeScript types *and* the published JSON
Schema, so the two can never drift.

- `PostcardsFileSchema` is the top-level file: `format: "postcards"`,
  `schemaVersion` (currently **6**, from `helpers.ts`), `exportedAt`, and the
  arrays `visits`, `trips`, `stories`, optional `tombstones`, and
  `referenceSources`. It is `.strict()` — unknown keys are rejected.
- Records (`VisitSchema`, `TripSchema`, `StorySchema`, `PlaceRefSchema`,
  `PhotoSchema`) use additive, optional fields so **older files still validate**
  and a newer file opened in an older build **fails closed** on unknown enum
  values (e.g. a new `place.kind`) rather than silently mis-parsing.
- **Inert by construction** (Constitution: data is inert). Text fields run
  through `sanitizeText` transforms; photos must be inline `data:image/…` URLs
  (never external links), bounded in size. Imports are *validated and sanitized*,
  never executed. See [Privacy and security](Privacy-and-Constitution.md).
- **Zod-free constants** (`FORMAT`, `SCHEMA_VERSION`, `placeKey`,
  `MAX_PHOTOS_PER_*`, …) live in `schema/helpers.ts` so the always-loaded stores
  and screens can use them without pulling Zod into the boot chunk; `models.ts`
  re-exports them.

`lib/schema/jsonSchema.ts` derives the JSON Schema with
`z.toJSONSchema(PostcardsFileSchema, { io: "input", target: "draft-2020-12" })`.
`io: "input"` publishes the shape a file must have **before** the sanitizing
transforms run — i.e. what other tools and people author (AI-friendly, per the
Constitution). The committed artifact `portable-file.schema.json` is kept in
sync by `tests/unit/schemaArtifact.spec.ts`; `pnpm schema` regenerates it.

---

## Putting the seams together: a mark-visited, end to end

1. You tap a marker → `MapView`'s popup calls `useVisits.getState().toggleVisit(place)`.
2. `useVisits` upserts the `Visit` (deduped by `placeKey`), stamps `updatedAt`,
   and writes it through to the `visits` object store via `visitsDb.putVisit`.
3. The store's `subscribe` fires; `MapView` repaints that flag imperatively —
   no React render in the loop.
4. Later, an explicit **Backup** serializes the stores through the Zod schema to
   the one JSON file; an explicit **Device sync** pushes that file through the
   git-target seam and merges convergently.

Each step crosses exactly one seam, and each seam has a swappable second
implementation on the roadmap (a shared Offline Map Store, a non-GitHub git
remote) — which is how the [Constitution](Privacy-and-Constitution.md) stays enforced in
code, not just documented.

---

## Related pages

- [Privacy and the Constitution](Privacy-and-Constitution.md) — the principles these seams enforce, and how inert-data imports keep the one file safe.
- [Data and provenance](Data-and-Provenance.md) — the datasets, their provenance, and how personal records point at them.
- [Features](Features.md) — the seams in use across the screens: [the map](Features.md#the-map), [backup & restore](Features.md#backup-import--reset), and more.
- [Device sync](Device-Sync.md) · [Publishing](Publishing.md) — the git-target seam in use.
- [Development](Development.md) — building, testing, and the Spec-Driven workflow on top of this architecture.
- Repo deep-dives: [`docs/ALGORITHMS.md`](../docs/ALGORITHMS.md) · [`docs/OFFLINE-MAPS.md`](../docs/OFFLINE-MAPS.md) · [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md).

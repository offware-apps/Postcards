# Data and provenance

Postcards is an **aggregator, never an author**. Every place name, boundary,
coordinate, population, country list, and cultural fact it shows comes from a
**named, externally-maintained, openly-licensed dataset** whose source, license,
and version are recorded and shown to you. The app invents none of it.

This page lists every reference dataset the app ships or fetches, its license,
and how that provenance is recorded in the repo and surfaced in the app.

Related: [Architecture → Reference data](Architecture.md#reference-data-pipeline-two-stage-gazetteer-spatial-grid-index)
(how the data is loaded, indexed, and queried), [Privacy and the Constitution](Privacy-and-Constitution.md)
(Principle I, the rule itself), [Backup and restore](Features.md#backup-import--reset), and how
attribution is [surfaced in Settings](Features.md#also-worth-knowing).

---

## The aggregator rule (Constitution I)

The first — and only NON-NEGOTIABLE — principle of the
[Constitution](Privacy-and-Constitution.md) is *Aggregator, Never an Author*:

> The application aggregates, records, and displays existing facts about the
> world; it MUST NOT invent, mint, or become the authoritative source of world
> data (place names, boundaries, coordinates, populations, country lists, etc.).

Three concrete obligations follow, and the codebase honours all three:

- **Reference data MUST originate from a named, external, openly-licensed dataset
  with recorded provenance (source + version).** Every dataset below carries a
  `dataset`, `license`, `version`, and `url`.
- **When a needed dataset does not exist, it MUST be produced as a separate,
  standalone, publicly shareable dataset** — its own repo or release artifact —
  never hard-wired into app code or bundled as an un-attributed blob.
- **User-generated content is limited to the user's own records** (what they
  visited, when, personal notes, photos) — never fabricated reference facts.

The type layer states the rule in code. `src/lib/reference/types.ts` opens with:

```ts
// Reference data is aggregated from external openly-licensed datasets and is
// read-only (Constitution I: aggregator, never an author). User records point at
// this data by stable id.
```

Visits, trips, stories, and photos never store a copy of a place — they hold a
`PlaceRef` (a kind plus a stable id) that *points at* the reference data. See
[Data model](Architecture.md#the-zod-schema-and-generated-json-schema).

---

## Reference data vs. your data

The two are kept strictly apart, in different places, with different lifecycles:

| | Reference data (world facts) | Personal data (your records) |
|---|---|---|
| **What** | Countries, cities, regions, airports, monuments, languages, map geometry | Visits, trips, journal stories, favourites, photos |
| **Author** | External datasets (below) | You |
| **Where it lives** | Bundled JSON in `public/reference/` + `public/basemap/`, and `src/lib/reference/data/`; loaded read-only at startup | IndexedDB working store + your one portable JSON export file |
| **Leaves the device?** | It is public data already | Only on your explicit action (export / share) |

The repo's `public/reference/PROVENANCE.md` states the boundary outright:

> Personal data (visits, trips, stories, photos) is **never** stored here — it
> lives in IndexedDB and the user's own portable export file only.

---

## The datasets and their licenses

Everything below is recorded canonically in
[`src/lib/reference/data/provenance.json`](../apps/postcards/src/lib/reference/data/provenance.json)
and mirrored in the two `PROVENANCE.md` files. Record counts are from the files
as shipped.

### Map geometry — Natural Earth (Public Domain)

The offline overview basemap is three **Natural Earth** files in
`public/basemap/`, bundled and cached for offline use. They render only on the
offline base; the opt-in online OpenStreetMap base draws its own geometry (see
[Offline maps](Architecture.md#seam-1--mapsource-the-offline-first-basemap)).

| File | What it is | Source | License |
|------|-----------|--------|---------|
| `countries-50m.json` | World country boundaries, 1:50m, TopoJSON — the base land layer, shaded when visited | Natural Earth *Admin 0 – Countries* via [`world-atlas`](https://github.com/topojson/world-atlas) | Public Domain |
| `lakes-110m.json` | Major lakes, 1:110m, GeoJSON — water over the land | Natural Earth *Physical – Lakes* (`ne_110m_lakes`) | Public Domain |
| `rivers-110m.json` | Major rivers + lake centerlines, 1:110m, GeoJSON | Natural Earth *Physical – Rivers + lake centerlines* (`ne_110m_rivers_lake_centerlines`) | Public Domain |

Upstream: <https://www.naturalearthdata.com>. A street-level PMTiles basemap
(OpenStreetMap / ODbL) remains a planned follow-up behind the same `MapSource`
seam (`specs/004-offline-map-seam`).

### City & region gazetteer — GeoNames (CC BY 4.0)

Cities and first-level regions come from **GeoNames**, packaged via
`all-the-cities`.

| File | What it is | Source | License | Records |
|------|-----------|--------|---------|---------|
| `cities.json` | Core gazetteer, population ≥ 15,000 — loads first so the map appears immediately | [GeoNames](https://www.geonames.org) via `all-the-cities` 3.1.0 | CC BY 4.0 | 24,323 |
| `cities-all.json` | Full world gazetteer — streams in behind first paint in a Web Worker | GeoNames via `all-the-cities` 3.1.0 | CC BY 4.0 | 135,233 |
| `subdivisions.json` | First-level regions (states/provinces), the denominator for per-country region coverage | GeoNames admin-1: each city's code and each code's name from one GeoNames day; [dr5hn `countries-states-cities`](https://github.com/dr5hn/countries-states-cities-database) only for a code GeoNames does not name | CC BY 4.0 (GeoNames) / ODbL 1.0 (dr5hn) | 3,751 |

### Airports — OpenFlights / OurAirports (ODbL 1.0 / Public Domain)

| File | What it is | Source | License | Records |
|------|-----------|--------|---------|---------|
| `airports.json` | IATA-coded airports worldwide, real coordinates | [OpenFlights](https://openflights.org/data.html) (`airport-data` 1.0.1), aggregated from OurAirports | ODbL 1.0 / OurAirports public domain | 5,609 |

### Countries, continents, names & languages

Country codes and the country → continent grouping do not come from the app —
they come from ISO 3166-1 (via `i18n-iso-countries`) and `world-countries`.
`referenceData.ts` builds each `Country` from these at startup; nothing is
hand-typed.

| Data | What it is | Source | License |
|------|-----------|--------|---------|
| ISO 3166-1 codes | alpha-2 / alpha-3 / numeric, used to join map geometry | [`i18n-iso-countries`](https://github.com/michaelwittig/node-i18n-iso-countries) 7.x | MIT (library); the codes are public facts |
| Continent + UN-member/territory status | `continents.json`, `sovereignty.json` (baked from `world-countries`) | [`world-countries`](https://github.com/mledoze/countries) 5.1.0 | ODbL 1.0 |
| `languages.json` | Per-country spoken languages (for Wikivoyage phrasebook/alphabet links) | `world-countries` 5.1.0 | ODbL 1.0 | 
| `article-names.json` | Common country names ("Russia" not "Russian Federation") — the Wikivoyage article title | `world-countries` 5.1.0 | ODbL 1.0 |

The common-name and official-ISO-name split matters downstream: the
[Travel guides](Features.md#travel-guides) seam needs the *common* name to form a valid
Wikivoyage URL, so it is shipped as `article-names.json` rather than derived.

### Monuments — UNESCO World Heritage + famous landmarks

Monuments are a generic "category" seam (`HeritageSite` shape); the first
category is UNESCO World Heritage, with a small famous-landmarks seed merged in
at load.

| File | What it is | Source | License | Records |
|------|-----------|--------|---------|---------|
| `heritage.json` | UNESCO World Heritage List | [UNESCO World Heritage Centre](https://whc.unesco.org/en/list/) — 2025 list incl. 47th session, retrieved 2026-07-11 | CC BY-SA 3.0 IGO — © UNESCO World Heritage Centre | 1,353 sites |
| `landmarks.json` | Famous-landmarks seed (Eiffel Tower, …); full set via a Wikidata build script | [Wikidata](https://www.wikidata.org) | CC0 (facts) | 64 |

### Moments — a curated, aggregated concept list

`experiences.json` powers [Moments](Features.md#moments) (once-in-a-lifetime world
experiences linked to real places). It is the one file with *any* app-authored
content, and it is scrupulous about scope: **only each moment's short name, hint,
and emoji are app-authored (CC0)**. Everything factual is aggregated. Its own
header says so:

> Moments are aggregated, not authored: anchor coordinates come from Wikidata
> (CC0) and GeoNames (CC BY 4.0); the experience concepts are attributed to
> UNESCO World Heritage / UNESCO Intangible Cultural Heritage (CC BY-SA 3.0 IGO)
> and Wikivoyage travel topics (CC BY-SA 3.0).

The provenance entries behind Moments are:

| Concept source | License |
|---|---|
| UNESCO Intangible Cultural Heritage — Representative List ([ich.unesco.org](https://ich.unesco.org/en/lists)) | CC BY-SA 3.0 IGO — © UNESCO |
| UNESCO World Heritage List | CC BY-SA 3.0 IGO |
| Wikivoyage travel topics & itineraries ([en.wikivoyage.org](https://en.wikivoyage.org)) | CC BY-SA 3.0 |
| Wikidata (anchor coordinates) | CC0 |
| GeoNames (anchor coordinates) | CC BY 4.0 |

Of the 105 Moments shipped, 30 carry a **per-item `sources` array** citing the
specific record (e.g. a single WHS entry with its list number and URL, plus the
Wikidata QID for the anchor). Example:

```json
"sources": [
  { "dataset": "UNESCO World Heritage List — Kilimanjaro National Park",
    "license": "CC BY-SA 3.0 IGO", "version": "WHS 403",
    "url": "https://whc.unesco.org/en/list/403" },
  { "dataset": "Wikidata — Mount Kilimanjaro",
    "license": "CC0-1.0", "url": "https://www.wikidata.org/wiki/Q7296" }
]
```

A community-maintained dataset can replace `experiences.json` later — same shape,
same ids — which is exactly the "separate, shareable dataset" the Constitution
prescribes.

### Wikivoyage — opt-in, online, attributed

Travel guides and article summaries are fetched live from **Wikivoyage**, and
only ever on an explicit user action. The [Travel guides](Features.md#travel-guides) seam
(`src/lib/wikivoyage/`) is framework-agnostic and inert: it reads only the
plain-text `extract`, strips markup, sends `no-referrer` with no credentials, and
degrades to `null` when offline or blocked.

| Data | License | Notes |
|---|---|---|
| Wikivoyage travel guides, phrasebooks & overviews | CC BY-SA 4.0 | opt-in online fetch; `attribution` is returned by `fetchSummary()` and **must be shown** |
| Wikivoyage travel topics & itineraries (feeding Moments) | CC BY-SA 3.0 | concept attribution only |

---

## How provenance is recorded

Provenance lives in three complementary places, with `provenance.json` as the
single source of truth:

1. **`src/lib/reference/data/provenance.json`** — the **canonical,
   machine-readable list**. Each entry is `{ dataset, license, version, url? }`,
   typed as `ReferenceProvenance` (`types.ts`). It is imported directly by
   `referenceData.ts` and exposed on the singleton as `ref.provenance`, so the
   same list the repo ships is the list the app displays and the list an export
   embeds — they cannot drift.

2. **`public/reference/PROVENANCE.md`** and **`public/basemap/PROVENANCE.md`** —
   human-readable **mirrors** for anyone browsing the repository, one row per
   shipped file. `public/reference/PROVENANCE.md` states plainly that it mirrors
   the machine-readable list:

   > The canonical, machine-readable provenance list ships inside the app at
   > `src/lib/reference/data/provenance.json` and is displayed in Settings; this
   > file mirrors it for people browsing the repository.

3. **Per-item `sources`** inside `experiences.json` — where a single Moment draws
   on specific records, it cites them individually (dataset + license + version +
   url), the finest grain of provenance in the project.

The repo's top-level `README.md` also carries a data-sources table and points at
`provenance.json` as the authority.

---

## How provenance is surfaced to the user

Recording provenance is not enough — the app shows it:

- **In Settings.** The [Settings](Features.md#also-worth-knowing) screen renders the
  `<Attribution />` component (`src/ui/Attribution.tsx`), which reads
  `getReferenceData().provenance` and lists every dataset with its license:

  ```tsx
  <strong>Data sources:</strong>{" "}
  {ref.provenance.map((p) => <span>{p.dataset} ({p.license})</span>)}
  ```

  Because it renders straight from `provenance.json`, adding a dataset there makes
  it appear in Settings automatically — no separate UI edit.

- **In every export.** When you back up, `exportJson.ts` copies the provenance
  list into the portable file as `referenceSources` (validated by
  `ReferenceSourceSchema` in `src/lib/schema/models.ts`). Your one JSON file
  therefore travels with the attribution for the reference data it points at, so
  the file is self-describing and auditable. See [Backup and restore](Features.md#backup-import--reset).

- **In the repository.** The two `PROVENANCE.md` files and the README table make
  the same facts visible to anyone reading the source without running the app.

---

## When data is missing: make a dataset, not app facts

The rule's corollary is a workflow constraint. If Postcards needs a fact the
existing datasets don't cover, the answer is **never** to type it into app code.
It must be produced as a **separate, standalone, publicly shareable dataset** —
its own repo or release artifact with its own license and provenance — and then
aggregated like any other source. The monuments seam is the live example: the
`heritage` place kind, its build script, and the UNESCO World Heritage dataset are
wired, tested, and **shipping** (1,353 sites, plus a 64-entry famous-landmarks
seed). The **same** `HeritageSite` seam is built to take further categories —
national parks, museums, city districts — each of which lights up as soon as a
named, licensed dataset is vendored in that shape with a new `provenance.json`
row. Adding data and adding its provenance are the same act.

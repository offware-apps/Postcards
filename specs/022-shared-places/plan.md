# Implementation Plan: Worldwide stations and landmarks from Offware's shared data

**Spec**: `specs/022-shared-places/spec.md`

## Constitution Check

- **I. Aggregator, never an author**: pass. Data comes from Wikidata (CC0) through the places
  dataset; ids are Wikidata items; provenance updated.
- **Local-first / offline**: pass. Files are bundled at build time; stations runtime-cached.
- **Privacy**: pass. The fetch happens in CI at build time, never from a user's device.
- **Data is inert**: pass. The build script validates shape, licence and coordinates.
- **Zero lock-in**: pass. Static JSON on GitHub Pages; `DATA_BASE` points it elsewhere.
- **Licences**: pass. Each file is taken only while its dataset carries the licence provenance
  names; share-alike sources (ODbL, CC BY-SA) keep their licence and credit.

## Design

- `scripts/fetch-data.mjs` (`pnpm data`): reads `catalog.json`, then downloads and validates each
  file (licence, shape, record count), keeps the 10,000 best-known landmarks, and writes the
  files; a file that fails stays as committed.
- The build scripts for cities, regions, airports, UNESCO sites, Trainline stations, languages
  and sovereignty, and their vendored sources, move to offware-apps/data (`src/reference/`),
  with the gazetteer checks against the vendored GeoNames day.
- `src/lib/reference/stationSources.ts`: adds `wikidata` (default, recommended); the first
  `loadStationSource()` without a saved choice pins Trainline for a returning user (intro already
  seen) and Wikidata for a new one.
- `vite.config.ts`: `railways-wikidata.json` out of the precache, into a runtime cache.
- Workflows: `pages.yml` and `android-apk.yml` run `pnpm places` before building; `pages.yml` also
  runs weekly after the dataset's Monday build.
- `railways-wikidata.json` is git-ignored: it is produced at build time.

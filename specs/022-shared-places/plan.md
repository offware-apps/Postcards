# Implementation Plan: Worldwide stations and landmarks from the shared places dataset

**Spec**: `specs/022-shared-places/spec.md`

## Constitution Check

- **I. Aggregator, never an author**: pass. Data comes from Wikidata (CC0) through the places
  dataset; ids are Wikidata items; provenance updated.
- **Local-first / offline**: pass. Files are bundled at build time; stations runtime-cached.
- **Privacy**: pass. The fetch happens in CI at build time, never from a user's device.
- **Data is inert**: pass. The build script validates shape, licence and coordinates.
- **Zero lock-in**: pass. Static JSON on GitHub Pages; `PLACES_BASE` points it elsewhere.

## Design

- `scripts/fetch-places.mjs` (`pnpm places`): downloads, validates, keeps the 10,000 best-known
  landmarks, writes the two files; failure leaves files as they are.
- `src/lib/reference/stationSources.ts`: adds `wikidata` (default, recommended); the first
  `loadStationSource()` without a saved choice pins Trainline for a returning user (intro already
  seen) and Wikidata for a new one.
- `vite.config.ts`: `railways-wikidata.json` out of the precache, into a runtime cache.
- Workflows: `pages.yml` and `android-apk.yml` run `pnpm places` before building; `pages.yml` also
  runs weekly after the dataset's Monday build.
- `railways-wikidata.json` is git-ignored: it is produced at build time.

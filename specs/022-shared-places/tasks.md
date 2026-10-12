# Tasks: Worldwide stations and landmarks from the shared places dataset

All paths under `apps/postcards/` unless noted.

- [x] T001 `scripts/fetch-places.mjs` + `pnpm places`, with validation and a never-failing fallback
- [x] T002 `wikidata` station source as the recommended default; returning users pinned to Trainline
- [x] T003 Unit tests: default source, new vs returning user, saved choice kept (`tests/unit/stations.spec.ts`)
- [x] T004 Runtime cache for `railways-wikidata.json` (`vite.config.ts`)
- [x] T005 en/fr/ko strings for the new source and the updated Trainline description
- [x] T006 Provenance: `src/lib/reference/data/provenance.json`, `public/reference/PROVENANCE.md`
- [x] T007 Workflows: fetch before building (`.github/workflows/pages.yml`, `android-apk.yml`); weekly Pages build

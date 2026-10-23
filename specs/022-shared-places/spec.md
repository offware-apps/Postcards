# Feature Specification: Reference data from Offware's shared data

**Feature Branch**: `022-shared-places`

**Created**: 2026-10-12

**Status**: Implemented

**Input**: Maintainer: "update Postcards to use that centralized dataset. It uses only European
trains; make sure it uses worldwide train stations." The dataset is
[offware-apps/data](https://github.com/offware-apps/data), shared by the Offware apps: towns,
sights and railway stations from Wikidata (CC0), every record keeping its Wikidata id.

## Overview

Postcards' railway stations come from Trainline's open database, which covers Europe only, and its
landmarks are a hand-picked seed of ~70. Offware's shared data publishes, every week,
open railway stations worldwide and the best-known sights of every town, both from Wikidata. This
feature makes Postcards read both from it, keeping Constitution I: the app still authors nothing,
and every record's provenance (its Wikidata item) travels with it.

## User Scenarios & Testing

### User Story 1 - Mark a station anywhere in the world (Priority: P1)

A traveller who took the train in Japan searches "Tokyo Station", finds it, and marks it visited,
offline once the stations have loaded.

**Acceptance Scenarios**:

1. **Given** a new install, **When** the user searches a station outside Europe, **Then** it is
   found, from the worldwide set, which is the recommended default.
2. **Given** the user marked stations from the Europe (Trainline) set before this release and never
   chose a source, **When** they update, **Then** they stay on Trainline, so their marked stations
   keep resolving; Settings offers the worldwide set.
3. **Given** any user, **When** they pick a source in Settings, **Then** that choice is kept.

### User Story 2 - See well-known sights beyond UNESCO's list (Priority: P2)

Museums, monuments, castles, palaces and parks show among sites & landmarks: the 10,000 best known
worldwide (by how many Wikipedia editions cover them), replacing the seed. UNESCO sites keep coming
from UNESCO's own list, so none is listed twice.

### User Story 3 - All reference data in one shared place (Priority: P2)

Maintainer: "every data we use on every application on a central place, so it can be managed by
a central application." Cities, regions, airports, UNESCO sites, European stations, countries and
moments are built in the shared data too, not in Postcards. Postcards fetches them at build time,
and keeps its committed copies so it always builds and works offline. Nothing a user sees changes:
the shared files are the same as the ones Postcards built.

## Requirements

- **FR-001**: The build fetches every reference file from the shared data
  (`scripts/fetch-data.mjs`): worldwide stations and landmarks (Wikidata), and cities, regions,
  airports, UNESCO sites, European stations, countries and moments.
- **FR-002**: A file is written only when it validates: the dataset still carries the licence the
  app's provenance names (`catalog.json`), the file has the expected shape and enough valid
  records. Otherwise the committed file stays. The build fails only when no worldwide stations
  file exists at all, since the default source would then be empty.
- **FR-003**: A "World — Wikidata" station source is the recommended default; Trainline and None
  stay selectable.
- **FR-004**: A person who used the app before and never chose keeps Trainline (FR scenario 1.2).
- **FR-005**: The worldwide station file is runtime-cached (stale-while-revalidate), as it can
  outgrow the precache size limit.
- **FR-006**: Provenance (Settings and `public/reference/PROVENANCE.md`) names each original
  source and licence, and that it comes by way of the shared data.
- **FR-008**: The scripts that built these files, and their vendored sources, live in the shared
  data, not in Postcards.
- **FR-007**: Strings in en, fr and ko.

## Out of scope

Converting Trainline-id visits to Wikidata ids; per-category landmark glyphs.

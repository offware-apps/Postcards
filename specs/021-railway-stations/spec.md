# Feature Specification: Railway stations as a place type

**Feature Branch**: `021-railway-stations`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Add railway/train stations as a first-class reference place type — mark stations visited, see them on the map, search them, count them toward per-country coverage, attach them to journal postcards and reconstructed trips (a train leg station→station). Reference data comes only from a named, openly-licensed dataset (Wikidata railway stations, CC0) via the existing build pipeline into a bundled file; the app authors no station data. Honor the constitution: aggregator-never-author, local-first/offline, privacy, one portable versioned file (additive schema), inert data, zero lock-in, WCAG 2.1 AA/keyboard-first, i18n en/fr/ko. Out of scope: metro/tram/subway stops, live times/routing, per-station photos beyond the existing gallery."

## Overview

Postcards already remembers cities, countries, airports and heritage sites. Trains are
central to how many people travel, and the app already supports a **train** transport mode
per trip leg — but there are no stations to be the endpoints of those legs, nowhere to say
"I've been through Gare de Lyon," and no station coverage in the stats. This feature adds
**railway stations** as a new reference place type, sourced entirely from a named,
openly-licensed dataset (**Wikidata railway stations, CC0**) and bundled offline, so a
station behaves like any other place: searchable, markable, mappable, countable, and usable
in journals and trips.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find and mark a station visited, fully offline (Priority: P1)

A traveller who took the train through a major station wants to record it. They search the
station by name (or a well-known code), see it in results with its country, and mark it
visited — with no network connection. It then counts among the places they've been.

**Why this priority**: This is the core value — stations as recordable places — and it
stands alone. Everything else (map, stats, journal, trips) builds on stations existing as a
searchable, markable reference place.

**Independent Test**: With the network disabled, search a mainline station by name, mark it
visited, and confirm it appears in the user's visited places; confirm the app makes no
network request during the flow.

**Acceptance Scenarios**:

1. **Given** the app is offline, **When** the user searches a mainline station's name, **Then** matching stations appear with their names and countries, drawn from the bundled dataset.
2. **Given** a station in results, **When** the user marks it visited, **Then** it is stored as a visited place exactly like a city or airport, and no new reference data is invented.
3. **Given** the user marks a station, **When** the flow completes, **Then** no outbound network request was made.

### User Story 2 - See stations on the map and browse them in Places (Priority: P2)

The user wants stations to show up spatially and to be browsable as their own category. On
the map, visited/known stations appear as markers distinct from cities and airports. In the
Places browse, a **Stations** filter (peer to Cities / Airports / Monuments) lists them and
supports the same visited/want/not-been slicing.

**Why this priority**: Makes stations first-class in the two main browsing surfaces; depends
only on stations existing (US1).

**Independent Test**: Enable the Stations filter in Places and confirm stations list and can
be marked; open the map and confirm station markers render and are visually distinguishable.

**Acceptance Scenarios**:

1. **Given** the Places browse, **When** the user selects the Stations category, **Then** stations are listed and can be filtered by visited / want / not-been like other kinds.
2. **Given** the map, **When** stations are shown, **Then** station markers are visually distinct from city and airport markers and open the same place preview/detail.
3. **Given** a dense area, **When** many stations exist, **Then** marker density is managed the same way as airports/monuments (existing decluttering applies).

### User Story 3 - Stations count toward per-country coverage (Priority: P3)

The stats screen already shows per-country coverage across categories. Visiting stations in a
country contributes to that country's coverage the same way sites and airports do, giving a
"stations seen / total" style signal without the app inventing any totals.

**Why this priority**: A satisfying completeness signal, but secondary to being able to
record and see stations; depends on the dataset's per-country counts.

**Independent Test**: Mark a station visited and confirm its country's stats reflect the
station toward coverage (a stations metric appears and increments), using only bundled counts.

**Acceptance Scenarios**:

1. **Given** a country with stations in the dataset, **When** the user opens that country's stats, **Then** a stations coverage figure (visited / total from the dataset) is shown.
2. **Given** the user marks a station visited, **When** they reopen the country's stats, **Then** the visited-stations figure has increased accordingly.
3. **Given** a country with no stations in the dataset, **When** stats are shown, **Then** the stations figure is simply absent (no invented zero-of-zero noise).

### User Story 4 - Use stations in journals and trips (Priority: P4)

A station can be attached to a **postcard** (journal entry) like any place, and can be a
**stop** in a reconstructed trip — so a train leg can run station→station, complementing the
existing per-leg train transport mode. The user reconstructs "Paris Gare de Lyon → Lyon
Part-Dieu (train)" and writes a postcard about the journey.

**Why this priority**: Ties stations into the two features that most benefit from them, but
only after stations exist and are pickable (US1); it reuses existing journal/trip mechanics.

**Independent Test**: Attach a station to a postcard and save; add two stations as trip stops
with a train leg between them and confirm the leg is drawn and measured like any other.

**Acceptance Scenarios**:

1. **Given** the postcard composer's place picker, **When** the user searches a station, **Then** it can be attached to the postcard like a city or airport.
2. **Given** the trip composer, **When** the user adds two stations as consecutive stops, **Then** a leg between them is valid, drawn, and its distance measured; the leg's transport can be train.
3. **Given** a saved trip or postcard referencing a station, **When** it is displayed, **Then** the station's name and country render correctly with a station indicator.

### Edge Cases

- **Data not yet bundled**: Until the station dataset file is produced (the fetch runs where the source is reachable), the app must behave gracefully — no station results, no errors, and every other place type unaffected. Integration and tests can run against a small fixture.
- **Older portable files**: A backup written before stations existed must still import and load unchanged; adding the station kind must not alter or reject any existing record.
- **A station with no coordinates or no name**: Excluded at dataset-build time; the app never shows a nameless or unplaceable station.
- **Duplicate or renamed stations**: The dataset build dedupes by stable id; the app treats a station like any place keyed by (kind, id).
- **Metro/tram exclusion**: Urban-transit stops are out of scope; only mainline/intercity stations appear (enforced by the dataset threshold, not the app).
- **Name language**: Station names are reference data and stay in their own language; only station-related UI chrome is translated.
- **A station referenced in an import that isn't in the bundled dataset**: The personal record still validates and displays from its stored name/country (personal data is self-contained); it simply has no extra reference detail.

## Requirements *(mandatory)*

### Functional Requirements

#### Data & provenance (aggregator)

- **FR-001**: Railway-station reference data MUST come solely from a named, openly-licensed external dataset with recorded provenance (source, license, version/date); the application MUST author no station facts.
- **FR-002**: The station dataset MUST be produced by a standalone, repeatable build from the source (not hand-edited into the app) and bundled as a static file read entirely on-device — no runtime network calls to fetch stations.
- **FR-003**: The dataset MUST be thresholded to mainline/intercity stations (a few thousand), excluding metro/tram/subway stops; each station MUST carry a stable id, a name, a country (ISO 3166-1 alpha-2), and coordinates.
- **FR-004**: The station's country (and, where available, region) MUST drive per-country coverage counts derived from the dataset — the app MUST NOT invent totals.

#### Place-type integration

- **FR-005**: The portable data model MUST gain a station place kind as an **additive, backward-compatible** change: older files (no stations) MUST still validate and load unchanged, and existing records MUST be untouched; the schema version MUST be bumped and documented.
- **FR-006**: A station MUST be a first-class place everywhere a place is used: searchable, markable (visited / want / not-been), openable to a detail view, and referencable by personal records — identical to how airports work.
- **FR-007**: Station search MUST work fully offline against the bundled dataset and MUST be reachable by keyboard (the app's existing search shortcut), returning matches by name.
- **FR-008**: The Places browse MUST offer a **Stations** category/filter (peer to Cities / Airports / Monuments) with the same visited/want/not-been slicing.
- **FR-009**: The map MUST render station markers that are visually distinguishable from cities and airports, open the same place preview/detail, and obey the app's existing marker-density management.
- **FR-010**: Per-country stats MUST include a stations coverage figure (visited / dataset total) that increments as stations are marked, and MUST omit it for countries with no stations in the dataset.

#### Journals & trips

- **FR-011**: A station MUST be attachable to a journal postcard via the existing place picker, like any other place.
- **FR-012**: A station MUST be a valid trip stop, so a leg may run station→station; the leg MUST be drawn and its distance measured like any other leg, and its transport MUST be selectable as train (reusing the existing per-leg train mode).

#### Cross-cutting (constitution)

- **FR-013**: Adding stations MUST NOT introduce telemetry or any egress; the entire station flow (search, mark, map, stats, journal, trip) MUST work with zero network connectivity.
- **FR-014**: Imported/restored station references MUST be validated and sanitized and remain inert (parsed, never executed); a personal record naming a station absent from the bundled dataset MUST still load from its stored name/country.
- **FR-015**: Export/import MUST round-trip a station record losslessly, and the documented versioned schema MUST be updated so external tools read the new kind.
- **FR-016**: All new station-related UI strings MUST exist in en, fr, ko with compile-time parity; station NAMES remain reference data in their own language; all new controls MUST meet WCAG 2.1 AA (labels, focus, target size, keyboard operability).
- **FR-017**: Until the full dataset file is present, the app MUST degrade gracefully (no station results, no errors, all other kinds unaffected); development and tests MAY run against a small station fixture.

### Key Entities *(include if feature involves data)*

- **Station (reference)**: A mainline railway station from the openly-licensed dataset — a stable id, a name, a country (ISO 3166-1 alpha-2), coordinates, and (where available) a region for coverage. Read-only reference data, bundled offline, authored by no one in-app. Mirrors the Airport reference shape.
- **Place reference (changed)**: The existing personal place reference gains a station kind (additive) so a visit, a postcard, or a trip stop can point at a station exactly as it points at a city or airport. No other personal-record shape changes.
- **Per-country station coverage (derived)**: A count of stations per country from the dataset, against which the user's visited stations are measured on the stats screen. Derived, never invented.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can search a mainline station by name and mark it visited **fully offline**, in under 15 seconds, with a network monitor recording zero outbound requests.
- **SC-002**: Marked/known stations appear on the map with a marker visually distinct from cities and airports, and open the same place detail.
- **SC-003**: The Places browse lists stations under a Stations category and supports visited / want / not-been filtering identically to airports.
- **SC-004**: Visiting a station increases that country's stations-coverage figure on the stats screen; countries with no dataset stations show no stations figure.
- **SC-005**: A station can be attached to a postcard and used as a trip stop, and a station→station train leg is drawn and measured.
- **SC-006**: A backup file created before this feature imports and loads with no change; a file containing a station record round-trips through export→import losslessly.
- **SC-007**: With the station dataset absent, every other place type works unchanged and no error is shown; with a fixture present, all station flows work.
- **SC-008**: 100% of the station flow works with the network disabled (zero egress), and the build fails if any en/fr/ko station string is missing.
- **SC-009**: Every station total shown to the user is traceable to the named dataset's provenance record (no app-authored counts).

## Assumptions

- The recommended source is **Wikidata railway stations (CC0)** — global, 1:1 mappable to the app's reference shape (id, name, country ISO-2, coordinates), with no attribution/share-alike burden — thresholded to mainline stations (metro/tram excluded). OpenStreetMap `railway=station` (ODbL) is a documented fallback for exhaustive coverage.
- The dataset is produced by the existing standalone build pipeline and bundled like the city/airport datasets; **the source fetch runs where it is reachable (a developer machine or CI)**, since the authoring environment's egress policy blocks it. App integration proceeds against a small fixture until the full file lands.
- A station reuses the app's existing place mechanics wholesale (search, marking, map markers, detail page, place picker, trip stops) — the pattern airports established — so this feature is integration, not new interaction design.
- Per-country station totals come from the dataset's own per-country counts; the app derives coverage, never authoring totals.
- Personal records are self-contained: a stored station reference carries its own name + country, so it displays even if the bundled dataset changes or a station is absent.
- Supported locales are en/fr/ko; station names stay in their source language as reference data.
- Out of scope: metro/tram/subway stops, live train times or routing (Postcards is not a trip planner), and any per-station photo handling beyond the existing gallery.

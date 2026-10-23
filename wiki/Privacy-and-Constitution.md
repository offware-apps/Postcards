# Privacy and the Constitution

Postcards is governed by a written **constitution** — eight non-negotiable
principles plus technology and data standards — that every specification, plan,
and line of code must obey. It lives at `.specify/memory/constitution.md`
(mirrored in brief in [`CLAUDE.md`](../CLAUDE.md) and on the [Home](Home.md) page), and it is not aspirational prose:
each principle is realized by concrete code and pinned in place by automated
tests. This page walks the principles and shows, file by file, where each one is
made real.

> The user's location history is among the most sensitive data a person holds.
> Postcards treats it that way: no server, no account, no telemetry — your whole
> history is one file on your device that leaves only when *you* send it.

The constitution is **versioned like software** (current **version 1.2.0**,
ratified 2026-07-01): MAJOR for removing/redefining a principle, MINOR for new
guidance, PATCH for wording. Amendments are documented changes to the file with a
"Sync Impact Report" header and a version bump. See
[How the constitution is enforced](#how-the-constitution-is-enforced) at the end.

---

## The eight principles at a glance

| # | Principle | The promise |
| --- | --- | --- |
| I | **Aggregator, never an author** | All world facts come from named, openly-licensed datasets with recorded provenance. The app invents no reference data. |
| II | **Local-first & fully decentralized** | No server, no account. Works fully offline. The device is the source of truth. |
| III | **Privacy by default** | No telemetry, analytics, ads, or beacons — ever. Nothing leaves the device except on an explicit, informed action. |
| IV | **One portable, human-readable file** | A single, git-diffable JSON document (plus a Markdown export), lossless round-trip, documented versioned schema. |
| V | **Zero lock-in** | No Google, no proprietary SaaS, no closed data. Every core dependency is open and replaceable. |
| VI | **Security by design — data is inert** | Imported data is parsed, validated, and sanitized — never executed. |
| VII | **Efficient, accessible, keyboard-first** | WCAG 2.1 AA, full keyboard operability, reduced-motion, regional adaptivity. |
| VIII | **Interoperable & AI-friendly** | Open, self-describing, versioned formats other tools and agents can read and write. |

The rest of this page takes them one at a time. For how the pieces fit together
in code, read [Architecture](Architecture.md) alongside this.

---

## I — Aggregator, never an author

Postcards records and displays existing facts about the world; it must never
become the *authoritative source* of place names, boundaries, coordinates, or
country lists.

- **Reference data is built from named datasets, not invented.**
  `public/reference/*.json` is a *built asset*, built in Offware's shared data
  ([offware-apps/data](https://github.com/offware-apps/data)) from openly-licensed
  datasets (GeoNames, dr5hn regions, OpenFlights airports, UNESCO heritage, Wikidata, …)
  and fetched at build time by `scripts/fetch-data.mjs`.
  Provenance is recorded machine-readably in
  `src/lib/reference/data/provenance.json`, mirrored for humans in
  `public/reference/PROVENANCE.md`, **shown in Settings**, and stamped into every
  export as the file's `referenceSources` array (see
  `features/backup/exportJson.ts`). See [Reference data](Data-and-Provenance.md).
- **Derived, not authored.** Country coverage is *derived* — visiting a city (or
  a monument) counts its country; there is no separate authored per-country
  record. Trip distance is likewise **derived from endpoint coordinates at read
  time, never stored** (`TripSchema` in `lib/schema/models.ts` documents this
  explicitly).
- **User content only.** The only records the app authors are the user's own:
  which places they visited, when, a note, a photo, the trips between them, and
  journal stories. It never fabricates a reference fact.

Missing data becomes a *separate shareable dataset*, never hard-wired into app
code — a rule the reference-build pipeline embodies.

## II — Local-first & fully decentralized

Every core feature works with **zero central server and zero network
connection**.

- **On-device working store.** State persists in IndexedDB (database `postcards`,
  currently **version 4**) opened with `idb` in `lib/db/visitsDb.ts`; `trips`,
  `stories`, and `tombstones` live in the same database. Every call is guarded by
  `hasIndexedDB()`, so the app degrades gracefully where storage is unavailable
  (e.g. some private-mode contexts). See [Architecture](Architecture.md) and
  [Data model](Architecture.md#the-zod-schema-and-generated-json-schema).
- **The bundled map needs no network.** The default `world-overview`
  [MapSource](Architecture.md#seam-1--mapsource-the-offline-first-basemap) is a fully-offline base the app fills with bundled
  Natural Earth outlines; it "issues no network requests, ever." A world street
  pack is consumed through the same seam and read via the `pmtiles://` protocol —
  no HTTP tile server.
- **Proven offline.** `tests/e2e/offline.spec.ts` aborts every request that would
  leave the device, then asserts the map still renders, a visit persists across a
  reload (IndexedDB), and Stats still compute — no blank screen, no spinner trap.
- **Sync is a transport the user chooses, never a mandate.** Optional
  [Device sync](Device-Sync.md) (`lib/sync/`) pushes the one portable file through
  a git target behind a `SyncRemote` seam; it is opt-in and swappable, never a
  project-run backend.

## III — Privacy by default

- **No telemetry, analytics, ads, or beacons — ever.** This is pinned by
  `tests/e2e/privacy.spec.ts`: it records **every** outbound request during the
  core flows (add, map, stats, places, export surface) and asserts the list is
  empty except for anonymous OpenStreetMap tiles. Telemetry, analytics, remote
  fonts — *anything* else — fails the test.
- **The one allowed request carries no personal data — and is switchable off.**
  The opt-in OpenStreetMap detail basemap fetches anonymous map tiles from
  `tile.openstreetmap.org`. `useSettings.onlineMap` (persisted in `localStorage`)
  turns it off to restore a **zero-outbound-request** posture and use the bundled
  offline map only. Optional online guides are similarly gated: Wikivoyage
  summaries are **opt-in, on-demand, and fetched with `no-referrer`**
  (`src/lib/wikivoyage/README.md`), and even the auto-load toggle only fires when
  you open a place — itself an explicit action.
- **Data leaves only on an explicit, informed action.** Export routes through
  `features/backup/Backup.tsx`, which uses the OS share sheet (Capacitor `Share`
  on native, the Web Share API on mobile browsers) and falls back to a plain
  download — "No proprietary cloud." Personal data is **never** committed to the
  repo; it lives only in IndexedDB and the user's own exported file.

See [Backup and restore](Features.md#backup-import--reset), [Settings](Features.md#theme-status--language), and
[Travel guides](Features.md#travel-guides).

## IV — One portable, human-readable file

All of a user's data lives in **a single file they can read, diff, back up, and
move anywhere**.

- **Canonical JSON, one strict schema.** `PostcardsFileSchema` in
  `lib/schema/models.ts` is `.strict()` — unknown top-level keys are rejected. A
  file carries `format: "postcards"`, `schemaVersion` (currently **6**),
  `exportedAt`, and the record arrays. `serializeFile()` pretty-prints it
  (`JSON.stringify(..., null, 2)`) so it stays human-readable and git-diffable;
  the export filename is `places.postcards.json`.
- **Lossless round-trip.** The app validates its own output before handing it over
  (`PostcardsFileSchema.parse(file)`), and the schema is deliberately careful to
  preserve export→import equality — e.g. `updatedAt` is *not* schema-defaulted,
  precisely so an older file re-exported is byte-for-byte what it was.
- **Atomic import.** `visitsDb.replaceAllPortable(...)` clears and rewrites the
  stores in a **single IndexedDB transaction**, so a restore can never leave the
  device half-updated.
- **Markdown for humans.** `features/backup/exportMarkdown.ts` renders a readable,
  non-authoritative summary for sharing with friends — "not re-importable;
  contains no executable content."

See [Data model](Architecture.md#the-zod-schema-and-generated-json-schema) and [Backup and restore](Features.md#backup-import--reset).

## V — Zero lock-in — no proprietary or cloud dependencies

- **License.** The project is **AGPL-3.0-or-later** (`package.json`).
- **Open, replaceable components only.** The runtime dependencies are
  MapLibre GL, `pmtiles`, `idb`, Zod, Zustand, and React — no Google Maps, no
  proprietary SDK, **no backend**. Even the optional GitHub connector for
  publish/sync is plain `fetch` against the REST API (not the Octokit SDK)
  precisely so it stays a replaceable component (see [Architecture](Architecture.md)).
- **Optional integrations degrade gracefully.** With Wikivoyage or the online map
  absent or unreachable, the app remains fully usable — the offline map and all
  reference data are bundled.

## VI — Security by design: data is inert

Data files (the user's own or community-sourced) are treated as **untrusted,
inert content — parsed, never executed**.

- **Sanitization.** `lib/schema/sanitize.ts` runs every free-text field through
  `sanitizeText`, which: normalizes newlines; strips C0/C1 control characters,
  zero-width characters, and Unicode **bidirectional overrides/isolates** (the
  "Trojan Source" visual-spoofing class); neutralizes leading
  spreadsheet-**formula** triggers (`=`, `+`, `-`, `@`); and bounds length. The
  Zod models apply it via `.transform(...)` on names, notes, captions, titles,
  and carrier text.
- **Strict, fail-closed schema.** Records are `.strict()`; photos must be inline
  `data:image/…` URLs (**never external links**) bounded to ~6 MB. A name that
  sanitizes down to empty is *rejected*, not silently accepted. A newer file's
  unknown enum value fails closed rather than mis-parsing.
- **Validated, never executed on import.** `features/backup/importJson.ts` parses
  JSON, checks the format marker and schema version, `safeParse`s against the
  schema, and enforces a `MAX_IMPORT_CHARS` DoS ceiling — all before the data
  reaches the store. `tests/e2e/import-security.spec.ts` drives the **real import
  UI** with hostile fixtures: malformed JSON, a wrong format marker, a
  newer-than-supported version, and unknown top-level keys are each rejected with
  a clear reason; a payload like `=2+5*8<img src=x onerror=alert(1)>` is stored
  **sanitized** and never becomes a live element (a dialog listener would throw if
  anything executed).
- **Inert exports too.** The Markdown exporter escapes pipes, newlines, angle
  brackets, and backticks per cell, so an imported name can't smuggle markup or a
  code span into a downstream renderer.

## VII — Efficient, accessible, keyboard-first

The interface targets **WCAG 2.1 AA**, full keyboard operability, and regional
adaptivity.

- **Accessibility gate in CI.** `tests/e2e/a11y.spec.ts` runs `@axe-core/playwright`
  with the `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` tag set across the Map, Stats,
  Places, Passport, and Settings screens and fails on **any** serious or critical
  violation.
- **Keyboard-first.** The global handler in `src/app/App.tsx`: `/` focuses search,
  `?` opens the shortcuts overlay, `1`–`5` (or a section's initial letter) switch
  tabs, `f`/`x` open Passport/Moments, and `Escape` (or the phone Back gesture)
  retraces *your own* steps rather than quitting. Adding is always explicit —
  plain Enter shows a place, Shift+Enter adds it. `tests/e2e/keyboard.spec.ts`
  performs the whole add-and-browse flow with the keyboard alone.
- **Screen-reader and motion.** ARIA labels throughout, `aria-current` on the
  active tab, and an `sr-only` `role="status" aria-live="polite"` region announce
  state. Reduced motion is honored via `lib/hooks/usePrefersReducedMotion.ts`
  (which gates MapLibre fly/fit camera moves) and a
  `@media (prefers-reduced-motion: reduce)` block in `styles.css`.
- **Regional adaptivity.** A zero-dependency in-house i18n dictionary ships
  **English, French, and Korean** (`lib/i18n/`); the chosen locale is reflected
  onto `<html lang>` for assistive tech and threaded into the `Intl`
  number/date/percent formatters. Theme follows the device (`prefers-color-scheme`)
  or can be forced light/dark.
- **Performance is a feature.** The map repaints visited markers imperatively
  (no React render in the tap loop), and the ~135k-city gazetteer is scanned
  through a 1°×1° spatial grid index — so interactions stay instant on a phone
  (see [Architecture](Architecture.md)).

## VIII — Interoperable & AI-friendly

Data and exports are trivially consumable by other tools and agents.

- **Published, self-describing schema.** `lib/schema/jsonSchema.ts` derives a
  JSON Schema from the same Zod models with
  `z.toJSONSchema(PostcardsFileSchema, { io: "input", target: "draft-2020-12" })`.
  `io: "input"` publishes the shape a file must have **before** the sanitizing
  transforms run — i.e. exactly what a human or an AI would author. The committed
  `portable-file.schema.json` is kept in sync by a unit test
  (`tests/unit/schemaArtifact.spec.ts`).
- **Hand- and tool-writable.** Ids are bounded, opaque strings rather than strict
  RFC-4122 UUIDs, on purpose, so the portable file can be authored by tools and
  agents (`lib/schema/models.ts`).
- **Stable and versioned.** Records use additive, optional fields, so older files
  keep validating and the format can evolve without breaking external readers.

---

## How the constitution is enforced

The principles are not enforced by good intentions but by process and tests:

- **Spec-Driven Development.** Every feature flows through the GitHub Spec Kit
  workflow — `/speckit-specify` → (`/speckit-clarify`) → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement` — and **no implementation happens
  without an approved spec and plan** (see [Architecture](Architecture.md) for the
  seams these plans must respect).
- **The Constitution Check.** Every plan includes a gate confirming alignment with
  these principles; any deviation must be justified explicitly or the design
  revised. Scope creep toward trip planning, social networks, or server-backed
  services is rejected by mandate.
- **Tests that hold the line.** The e2e and unit suites are the executable
  constitution: `privacy.spec.ts` (no beacons), `offline.spec.ts` (works with no
  network), `import-security.spec.ts` + `sanitize.spec.ts` (inert data),
  `a11y.spec.ts` + `keyboard.spec.ts` (accessible, keyboard-first), and
  `schema.spec.ts` + `schemaArtifact.spec.ts` (the one portable, published
  format). See [Testing](Development.md#testing).
- **Governance.** The constitution supersedes ad-hoc practice; conflicts are
  resolved before merge. Amendments are documented changes to
  `.specify/memory/constitution.md` with a rationale and a semantic version bump,
  and must update any dependent templates.

---

## Related pages

- [Home](Home.md) — what Postcards is, and the constitution in brief.
- [Architecture](Architecture.md) — the seams that keep these promises enforceable in code.
- [Data model](Architecture.md#the-zod-schema-and-generated-json-schema) · [Backup and restore](Features.md#backup-import--reset) — the one portable file, in detail.
- [Reference data](Data-and-Provenance.md) — the named, openly-licensed datasets and their provenance.
- [Offline maps](Architecture.md#seam-1--mapsource-the-offline-first-basemap) · [Device sync](Device-Sync.md) — the local-first map and the opt-in, server-less sync.
- [Travel guides](Features.md#travel-guides) · [Settings](Features.md#theme-status--language) — the opt-in online features and their toggles.
- [Testing](Development.md#testing) — the suites that pin each principle in place.

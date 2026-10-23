# Development

How to build, run, and test Postcards, how the repo is laid out, and how work gets
done here — Spec-Driven Development via GitHub Spec Kit, with the project
[constitution](Privacy-and-Constitution.md) as the non-negotiable backdrop.

For what the app *is* and how it's structured at runtime, see [Home](Home.md),
[Architecture](Architecture.md), and [Features](Features.md). For where the reference
datasets come from, see [Data and Provenance](Data-and-Provenance.md).

---

## At a glance

- **Monorepo**: a pnpm workspace. The app lives in `apps/postcards/`; `packages/` is
  reserved for future shared ecosystem packages (`pnpm-workspace.yaml` globs `apps/*`
  and `packages/*`).
- **Stack**: React 19 + TypeScript + Vite → PWA, wrapped for native iOS/Android by
  Capacitor. MapLibre GL + PMTiles, IndexedDB (`idb`), Zustand, Zod. No Google, no
  backend.
- **Package manager**: `pnpm@10.33.0` (pinned via `packageManager`).
- **Node**: 22 (`.nvmrc`; CI uses `node-version: 22`).
- **License**: AGPL-3.0-or-later (open source, non-commercial intent).
- **Tests**: Vitest (unit) + Playwright (e2e, including an axe-core WCAG 2.1 AA gate).

---

## Prerequisites

- Node.js **22** (`nvm use` reads `.nvmrc`).
- **pnpm** 10.33.0 (`corepack enable` then `corepack use pnpm@10.33.0`, or install
  pnpm directly).
- For native builds only: Xcode (iOS) / Android Studio (Android). See
  [`docs/NATIVE-BUILDS.md`](../docs/NATIVE-BUILDS.md).

---

## Install, run, build

Run these from the **repo root** unless noted. The root `package.json` proxies the
common tasks to the app via `pnpm --filter postcards …`, so both spellings work.

```bash
pnpm install                       # install workspace deps (once)

pnpm dev                           # Vite dev server (http://localhost:5173)
pnpm build                         # production PWA build (tsc --noEmit && vite build)
pnpm preview                       # serve the built dist/

pnpm test                          # unit tests (Vitest, run once)
pnpm test:e2e                      # Playwright e2e (a11y, keyboard, privacy, offline, …)
```

Equivalent app-scoped forms (run from anywhere in the tree):

```bash
pnpm --filter postcards dev
pnpm --filter postcards build
pnpm --filter postcards test
pnpm --filter postcards test:e2e
```

### Base path

The same build is the self-hostable website, the PWA, and the payload Capacitor wraps
natively. `vite.config.ts` serves from `/` by default; the GitHub Pages workflow sets
`VITE_BASE=/Postcards/` so asset URLs, the PWA manifest scope, and the service worker
resolve under the repo subpath. See [Publishing](Publishing.md) for deployment.

---

## Scripts reference

All scripts below live in `apps/postcards/package.json`.

| Script | What it does |
| --- | --- |
| `dev` | `vite` — dev server with HMR. |
| `build` | `tsc --noEmit && vite build` — typecheck-gated production build. |
| `preview` | `vite preview` — serve `dist/` locally. |
| `typecheck` | `tsc --noEmit` — strict TypeScript, no emit. |
| `test` | `vitest run` — unit tests once (`tests/unit/**`). |
| `test:watch` | `vitest` — unit tests in watch mode. |
| `test:e2e` | `playwright test` — end-to-end suite (`tests/e2e/**`). |
| `schema` | `UPDATE_SCHEMA=1 vitest run tests/unit/schemaArtifact.spec.ts` — regenerate the JSON Schema artifact from the Zod models. |
| `format` | `prettier --write .` — format (config: `.prettierrc.json`, 100 cols, double quotes, trailing commas). |
| `data` | `node scripts/fetch-data.mjs` — fetch the reference data from [Offware's shared data](https://github.com/offware-apps/data) into `public/reference/` and `src/lib/reference/data/` (see [Data and Provenance](Data-and-Provenance.md)). |
| `cap:sync` / `cap:copy` | Capacitor sync / copy web assets into native shells. |
| `cap:add:android` / `cap:add:ios` | Add a native platform. |
| `cap:open:android` / `cap:open:ios` | Open the native project in Android Studio / Xcode. |
| `native:android` | `pnpm build && cap sync android && cap open android`. |
| `native:ios` | `pnpm build && cap sync ios && cap open ios`. |

The reference data is built in [offware-apps/data](https://github.com/offware-apps/data),
the data every Offware app shares: it reshapes existing openly-licensed datasets, each
keeping its licence. `pnpm data` fetches them at build time, checking each dataset's
licence, shape and record count, and keeps the committed copy of any file that fails, so
the app always builds. The app itself never invents reference data.

---

## Testing

Tests are a constitutional quality gate, not an afterthought: *"Core logic (stats,
import/export, schema validation, sanitization) MUST be covered by automated tests.
Import/sanitization paths MUST have security-focused tests."*
(`.specify/memory/constitution.md`, Development Workflow & Quality Gates).

### Unit tests — Vitest

- Config: the `test` block in `apps/postcards/vite.config.ts` (jsdom environment,
  globals on, `include: tests/unit/**/*.spec.{ts,tsx}`).
- Setup: `tests/setup.ts` pulls in `@testing-library/jest-dom` and loads the **real**
  bundled reference data (`cities-all.json`, `subdivisions.json`, `airports.json`)
  synchronously via `initReferenceDataSync`, so unit tests exercise the actual gazetteer.
- ~36 unit spec files under `tests/unit/`, covering the constitutionally-mandated
  surfaces and more: `stats.spec.ts` / `statsPerf.spec.ts` (coverage math),
  `schema.spec.ts` / `schemaArtifact.spec.ts` (Zod models + generated JSON Schema),
  `sanitize.spec.ts` + `importCsv.spec.ts` (inert-data import),
  `backup.spec.ts` / `exportCsv.spec.ts` (portable file round-trips), `bcbp.spec.ts`
  (boarding-pass parsing), `encrypt.spec.ts` / `publishBundle.spec.ts` (publish),
  `syncEngine.spec.ts` / `syncMerge.spec.ts` / `syncTimestamps.spec.ts` (device sync),
  and feature logic (`visits`, `travel`, `journal`, `experiences`, `wikivoyage`,
  `gazetteer`, `search`, `mapSource`, `offlineTiles`, …).

```bash
pnpm --filter postcards test          # once
pnpm --filter postcards test:watch    # watch mode
```

### End-to-end tests — Playwright

- Config: `apps/postcards/playwright.config.ts`. `testDir: ./tests/e2e`, `baseURL:
  http://localhost:4173`. The `webServer` block runs `pnpm build && pnpm preview
  --port 4173` automatically, so e2e always tests the **production build**. It prefers
  a preinstalled Chromium at `/opt/pw-browsers/...` when present, otherwise Playwright's
  own browser.
- ~15 e2e spec files under `tests/e2e/`, one per critical guarantee: `a11y.spec.ts`,
  `keyboard.spec.ts`, `privacy.spec.ts`, `offline.spec.ts`, `import-security.spec.ts`,
  `import-csv.spec.ts`, `smoke.spec.ts`, plus feature flows (`trips`, `tripedit`,
  `tripfilter`, `airports`, `boardingpass`, `countryscope`, `globe`, `photo`).
  `nav-helper.ts` is a shared navigation helper, not a test.

```bash
pnpm --filter postcards test:e2e
```

### Accessibility gate — axe-core

`tests/e2e/a11y.spec.ts` enforces WCAG 2.1 AA (spec success criterion **SC-005**):
it drives the app through the map, stats, places, passport, and settings screens and
asserts **zero serious/critical** axe violations on each, using `@axe-core/playwright`
with the `wcag2a wcag2aa wcag21a wcag21aa` tag set. Accessibility is keyboard-first and
non-negotiable per the constitution — `keyboard.spec.ts` covers keyboard-only operation.

### Privacy & security gates

`privacy.spec.ts` asserts zero unexpected external network requests (the local-first,
no-telemetry promise), and `import-security.spec.ts` + `sanitize.spec.ts` verify that
imported data is validated and sanitized, never executed (data is inert). These are the
tests that keep the [constitution](Privacy-and-Constitution.md) honest.

---

## Continuous integration

Two GitHub Actions workflows under `.github/workflows/`:

- **`tests.yml`** — the quality-gate workflow. On every push (to the deploy branch) and
  every pull request it runs, in order: `typecheck` → unit tests → install Playwright
  Chromium → e2e tests (including the a11y gate). Node 22, pnpm via
  `pnpm/action-setup`, `pnpm install --frozen-lockfile`.
- **`pages.yml`** — builds with `VITE_BASE=/Postcards/` and deploys the PWA to GitHub
  Pages. See [Publishing](Publishing.md).

Keep the lockfile committed and current: CI installs with `--frozen-lockfile` and will
fail if `pnpm-lock.yaml` is out of sync.

---

## Repository layout

```
Postcards/
├── CLAUDE.md                     # working guidance + constitution summary
├── README.md                     # project overview
├── package.json                  # workspace root (proxies dev/build/test to the app)
├── pnpm-workspace.yaml           # workspace globs: apps/*, packages/*
├── .nvmrc                        # Node 22
├── .specify/                     # Spec Kit engine (see "Workflow" below)
│   ├── memory/constitution.md    # the constitution (source of truth for principles)
│   ├── templates/                # spec / plan / tasks / checklist templates
│   ├── scripts/bash/             # create-new-feature, setup-plan, setup-tasks, …
│   └── workflows/                # speckit workflow definition
├── specs/                        # one directory per feature (see "Where specs live")
├── docs/                         # deep-dive docs (algorithms, performance, exceptions, …)
├── .github/workflows/            # tests.yml + pages.yml
├── apps/postcards/               # THE APP
│   ├── src/
│   │   ├── app/                  # shell, routing, keyboard shortcuts
│   │   ├── features/             # visits, map, stats, backup, travel, journal,
│   │   │                         #   experiences, passport, guides, publish,
│   │   │                         #   city, country, settings
│   │   ├── lib/                  # schema, db, store, reference, map-source, format,
│   │   │                         #   bcbp, sync, publish, offline, wikivoyage, i18n,
│   │   │                         #   image, hooks
│   │   └── ui/                   # shared components (attribution, a11y primitives)
│   ├── public/                   # PWA assets + bundled reference/basemap data
│   ├── scripts/                  # reference-data build scripts (aggregators)
│   ├── tests/{unit,e2e}/         # Vitest + Playwright suites
│   ├── android/ · ios/           # Capacitor native shells
│   ├── vite.config.ts            # Vite + PWA + Vitest config
│   └── playwright.config.ts
└── packages/                     # reserved for shared ecosystem packages (empty for now)
```

See [Architecture](Architecture.md) for how the `src/` seams (`MapSource`, schema,
store, reference) fit together at runtime.

---

## Spec-Driven Development (Spec Kit)

Postcards uses **GitHub Spec Kit**. The constitution mandates it: *"Every feature flows
through the Spec Kit workflow … No implementation without an approved spec and plan."*
The engine lives in `.specify/` (templates, bash scripts, workflow definition) and is
driven through slash commands:

```
/speckit-specify  →  (/speckit-clarify)  →  /speckit-plan  →  /speckit-tasks  →  /speckit-implement
```

| Step | Command | Produces |
| --- | --- | --- |
| Specify | `/speckit-specify` | `spec.md` — user scenarios, requirements, success criteria (the *what/why*, no tech). |
| Clarify | `/speckit-clarify` | up to 5 targeted questions, answers folded back into `spec.md` (optional). |
| Plan | `/speckit-plan` | `plan.md` (+ `research.md`, `data-model.md`, `contracts/`, `quickstart.md`) — the *how*, gated by a **Constitution Check**. |
| Tasks | `/speckit-tasks` | `tasks.md` — dependency-ordered, story-grouped tasks with test tasks included. |
| Implement | `/speckit-implement` | code that satisfies the tasks. |

Supporting commands also exist: `/speckit-analyze` (cross-artifact consistency),
`/speckit-checklist`, `/speckit-constitution`, `/speckit-converge`, and
`/speckit-taskstoissues`.

**The Constitution Check is the hard gate.** Every `plan.md` must include a section
confirming alignment with the principles in [Privacy and Constitution](Privacy-and-Constitution.md);
any violation must be justified explicitly or the design revised. Features that drift
toward trip planning, social networking, or server-backed services are rejected as
scope creep — the mandate is *store data and display it well*.

---

## Where specs live

`specs/` holds one directory per feature. `specs/README.md` is the index.

- **`001-cities-countries/`** — the MVP, and the only feature carrying the **full**
  workflow artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
  `contracts/` (`map-source.md`, `portable-data-file.md`, `reference-data.md`),
  `checklists/requirements.md`, `quickstart.md`, and `tasks.md`.
- **`002-`…`014-`** — later features. Most are **retro-specs**: `spec.md` (sometimes
  `plan.md`) written *after* the feature shipped, by design. They cover place types,
  travel log, the offline-map seam, native packaging, boarding-pass import, journal,
  moments, passport poster, Wikivoyage guides, photo gallery, journal publishing,
  device sync, and intra-city places.

### Workflow exceptions & retro-specs

Several features beyond the MVP were built during rapid iteration guided by the
constitution **directly** rather than by a written spec, then retro-specified. That
exception is recorded explicitly (never silently) in
[`docs/WORKFLOW-EXCEPTIONS.md`](../docs/WORKFLOW-EXCEPTIONS.md), which lists exactly
which features shipped spec-first vs. retro-spec, and states the policy going forward:

> New feature-sized work SHOULD return to the spec-first workflow (`/speckit-specify`).
> … if one of [the retro-specced features] grows materially, that growth gets a spec first.

So: retro-specs are documentation of what shipped; new material work starts from a spec.

---

## Contributing (honoring the constitution)

Postcards is AGPL-3.0-or-later, open source for personal, non-commercial use. The bar
for a change is not "does it work" but "does it honor the
[constitution](Privacy-and-Constitution.md)". Before opening a PR:

1. **Start from a spec for new features.** Feature-sized work goes through
   `/speckit-specify` → `/speckit-plan` (with a passing Constitution Check) →
   `/speckit-tasks` → `/speckit-implement`. Small fixes don't need a spec, but must
   still respect the principles.
2. **Stay an aggregator, never an author.** All world facts come from named,
   openly-licensed external datasets with recorded provenance. Missing data becomes a
   separate shareable dataset (and a `scripts/build-*.mjs` aggregator), never
   hard-coded reference facts in app code. See [Data and Provenance](Data-and-Provenance.md).
3. **Keep it local-first and private.** No server, no account, no telemetry; the device
   is the source of truth; data leaves only on explicit user action. The `privacy`
   e2e test must stay green.
4. **Keep imported data inert.** Anything imported is validated (Zod) and sanitized,
   never executed. Import/sanitization paths need security-focused tests
   (`import-security`, `sanitize`).
5. **Respect the seams.** Consume maps only through `MapSource`; never read tiles from
   hard-coded app-private paths (offline maps must stay device-global/cross-app for the
   wider Capacitor ecosystem). Keep reference vs. personal data strictly separated.
6. **Meet the quality gates.** `pnpm --filter postcards typecheck`, unit tests, and e2e
   (including the axe WCAG 2.1 AA gate and keyboard-only flows) must all pass — the same
   `tests.yml` CI runs on every PR. Add tests for core logic you touch.
7. **Format before committing.** `pnpm --filter postcards format` (Prettier).
8. **Don't add scope creep.** Trip *planning*, social/leaderboard features, and
   server-backed services are explicitly out of scope.

---

## Further reading (in-repo)

- [`docs/ALGORITHMS.md`](../docs/ALGORITHMS.md) — how coverage stats, search, map layers,
  sync merge, and other core logic actually compute.
- [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md) — performance budgets and measurements.
- [`docs/OFFLINE-MAPS.md`](../docs/OFFLINE-MAPS.md) — the offline map seam and tile strategy.
- [`docs/NATIVE-BUILDS.md`](../docs/NATIVE-BUILDS.md) — building the iOS/Android shells.
- [`docs/SIMPLIFICATIONS.md`](../docs/SIMPLIFICATIONS.md) — deliberate simplifications and
  their rationale.
- Sibling wiki pages: [Home](Home.md) · [Architecture](Architecture.md) ·
  [Features](Features.md) · [Data and Provenance](Data-and-Provenance.md) ·
  [Privacy and Constitution](Privacy-and-Constitution.md) · [Publishing](Publishing.md).

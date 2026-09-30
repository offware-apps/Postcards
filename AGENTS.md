# AGENTS.md — working agreement for Postcards

Read this alongside `CLAUDE.md` (what the app is + its non-negotiable
constitution), `docs/USER-STORIES.md` (the durable record of what the owner wants
built — read it to know the product direction; append to it when they articulate
a new want), and `BACKLOG.md` (the tracked request list). This file is about
*how to work* so nothing the user asks for gets silently dropped.

App lives in `apps/postcards/`. Run all tooling from there.

## The rule that matters most: verify, then claim

A request is **not done because the code exists** — it's done when it's been
observed working:

- **UI change → screenshot it.** Build (or use the dev server) and look at the
  actual pixels before saying it's done. "tsc + tests pass" is necessary, not
  sufficient. Most missed requests were "written but not where the user could
  see/reach it" (e.g. a button left inside a panel instead of beside it).
- **Logic change → a test.** Prefer a unit test; fall back to a rendered check.
- If you can't verify it, say so plainly instead of claiming completion.

## Don't lose requests

- When the user fires several asks in one turn, **log each to `BACKLOG.md`
  immediately** (or the task list), then work them one by one. Reconcile the
  backlog every turn and surface what's still open.
- Answering a question is not the same as doing the thing next to it — do both.
- A quoted line the user says is "not there" is often a **stale cached PWA**
  (see below), not a missing feature. Check the current build before assuming
  either way, and tell the user which it is.

## Verify + ship checklist (every change)

1. `cd apps/postcards`
2. `npx tsc --noEmit` — zero errors. Note: i18n has **compile-time key parity**;
   a key added to `en.ts` must be added to `fr.ts` and `ko.ts` (and removing one
   means removing it from all three), or tsc fails.
3. `npx vitest run` — full unit suite green.
4. `npx playwright test` — e2e green. On a host whose network interfaces churn
   (many docker containers, for one), Chromium aborts in-flight requests with
   `net::ERR_NETWORK_CHANGED`, and a spec can find the app never booted (the
   reload message or a blank page); re-run the file, and CI's retry absorbs it.
5. For any UI change, **screenshot and eyeball it** (Playwright's Chromium,
   from `npx playwright install chromium` in `apps/postcards`).
6. Commit with a clear message. **Never** put the model identifier in commits,
   PRs, or code — chat only.
7. Deploy: push HEAD to the feature branch **and** fast-forward the deployed
   branch so GitHub Pages ships it. Keep both in sync.
8. Confirm the Pages + Tests workflows go green before calling it shipped.

## Deploy topology

- Feature branch: `claude/monument-display-optimize-x1j6le`
- GitHub Pages deploys `main`: a merged pull request ships.

## Stale-build gotcha (PWA)

Postcards is a PWA with a service worker. An open tab keeps serving the **old**
build until a hard reload, so a shipped change can look undone. There is an
in-app "new version — reload" prompt; still, when the user reports something is
missing, first check whether they're on a cached build (ask for a hard reload:
Cmd/Ctrl+Shift+R) before re-implementing.

## Guardrails (from the constitution — never regress these)

- Aggregator only: reference facts come from named, licensed datasets with
  provenance. Invent no world data.
- Local-first, offline, no telemetry. Data leaves the device only on an explicit
  user action. Optional egress (map tiles, guides, photos) is opt-in and off by
  default; **Offline mode** is the master switch that forces zero egress.
- The GitHub sync token stays on-device: never in exports, published sites, or
  logs. The `connect-src` CSP in `index.html` keeps a script in the page from
  sending it to any host outside its list; it does not stop a request to
  `api.github.com`, which the list allows, carrying the token to a repository
  of the script's choosing. The token's safety also depends on the app being
  the only app served from its origin, since every page of an origin shares its
  localStorage: `offware-apps.github.io` currently also serves another app, and
  a custom domain or another dedicated origin removes that dependency. Hence
  the fine-grained token, one repository, Contents read and write only.
- Imports are validated + sanitized, never executed. One portable JSON file.
- WCAG 2.1 AA, keyboard-first; every interactive control carries a `title`
  (plus `aria-label` when icon-only).

## Bigger features

Use the Spec Kit flow already in the repo (`/speckit-specify → plan → tasks →
implement`) for anything multi-part. Keep quick chat for one-off tweaks.

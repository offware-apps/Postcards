# Quickstart: validating the Journal Redesign

How to prove the redesign works end-to-end. Run from `apps/postcards/`. This is a
validation/run guide — implementation lives in `tasks.md` and the code.

## Prerequisites

- `pnpm install` (already set up in this workspace).
- Dev server: `pnpm dev` (Vite). Native/PWA build: `pnpm build`.

## Gate (must stay green)

```bash
pnpm typecheck          # tsc --noEmit — also enforces en/fr/ko MessageKey parity
pnpm test               # vitest: schema/migration/store/postcardModel/date-range/tags/i18n parity
pnpm schema             # regenerate portable-file.schema.json after any model change
pnpm test:e2e           # Playwright + axe: keyboard capture, save-&-new, page-layer, a11y
```

## Scenario 1 — Power-user keyboard capture (P1, SC-001/002)

1. Start with **zero visited places**. Press **`W`** anywhere.
2. Expect: a full-screen composer, dated **today**, **cursor already in the content box**.
3. Type a note. Press **Ctrl/Cmd+Enter**.
4. Expect: saved, page closes, the new **postcard** shows in the feed — dated, **no place**.
   Done using only the keyboard, no field navigation.

## Scenario 2 — Rapid loop "Save & new" (SC-003)

1. Press `W`, type, press **Ctrl/Cmd+Shift+Enter**.
2. Expect: saved, and a fresh empty postcard dated today reopens with focus in content —
   **without returning to the feed**. Repeat 5× with no pointer. Feed then shows 5 postcards.

## Scenario 3 — Content rule & place-optional (SC-005/006)

1. Open a new postcard, leave content empty and add no photo → **Save is unavailable**, the
   reason is clear.
2. Add only a photo (no text, no place) → **saves**.
3. Optionally attach a place via type-ahead (a few letters + confirm); leave blank to save
   place-less. Confirm no new reference place is ever created.

## Scenario 4 — Optional context by keyboard (P2, SC-004)

1. In the composer's "add details": attach a place, add two **tags** (type-and-Enter; try a
   **mood** and a **weather** preset, remove one), set an optional **title** and **folder**,
   and **link a trip** by type-ahead.
2. Save, reopen to edit → every attachment round-trips; removing one and re-saving drops it.

## Scenario 5 — Multiple places / date range (P3)

1. Attach a second and third place (ordered); set an **end date** after the start.
2. Save. Expect: the postcard appears under **each** of its places in "By place" and on the
   **Map**; the feed/timeline show the **date span**; sorting keys on the start date.

## Scenario 6 — "Near you" (P4, SC-010)

1. With location granted, open a new postcard → a short **"near you"** list appears; the top
   suggestion attaches with **one keystroke**.
2. With location denied/offline → no error, place stays optional, manual search works.
   Confirm no coordinates are stored on the saved postcard.

## Scenario 7 — Read side keeps working (all five views)

- Feed / By place / Timeline / Map / Calendar all render place-less, multi-place, ranged,
  tagged, and trip-linked postcards gracefully; place-less land in an **"Unplaced"** bucket
  in place-keyed views (or are skipped on the map). New **By tag** / **By trip** filters work.

## Scenario 8 — Portability & offline (SC-007/008/011)

1. **Export** the JSON, **re-import** it → all postcards (incl. place-less/multi-place/ranged/
   tagged/trip-linked) restore identically; pre-redesign entries keep their place.
2. Repeat via the **zip archive** (photos included).
3. Load an **older-version** file → validates; a **newer-version** file → rejected with the
   update message.
4. With the **network disabled**, run scenarios 1–7 → all work; a network monitor records
   **zero** outbound requests.

## Scenario 9 — Navigation & a11y (SC-008/009/012)

- Escape / Back / Cancel from the composer return to the exact launching screen with the
  typed draft preserved. Long-press the Journal nav opens today's composer; a short tap opens
  the feed. The composer passes the **axe WCAG 2.1 AA** gate; a missing en/fr/ko key fails
  the build; `W` and both save chords have visible button equivalents (documented in the
  shortcuts help).

# Feature Specification: Journal Redesign — fast, keyboard-first postcards

**Feature Branch**: `020-journal-redesign`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Journal redesign — make writing as simple and FAST as 'put a date and fill it in', no blabla. **Priority 1 is UX: easy and fast to use, tuned for power users** (keyboard-first, minimal keystrokes, rapid capture). An entry is a DATE + free CONTENT (text and/or photos); place is OPTIONAL. Keep an optional Title. Move the composer into its own focused full-screen page (superseding never-implemented draft spec 017). Entries are called **postcards** (the app is Postcards). Keep all five read views (Feed / By place / Timeline / Map / Calendar). Bigger powers to include this round: link a postcard to a reconstructed trip; lightweight mood/weather/tags; a postcard can span multiple places or a date range. Auto-suggest 'near you' places on open. Honor the constitution: local-first, no telemetry, inert data, aggregator-not-author, WCAG 2.1 AA keyboard-first, i18n en/fr/ko. Requires additive, backward-compatible schema bumps (place optional; optional trip link, tags, extra places, end date); existing entries keep everything they have."

## Overview

Writing in the journal today is slow and gated: the composer is a six-field form stacked
under the feed, and you **cannot save an entry without first picking a place you've
already visited**. This redesign makes capturing a memory *fast* — the app's Priority 1 —
and reframes an entry as a **postcard**: a dated card, optionally from a place, with a
note and/or a picture. The bar is set by the power user who journals every day and wants
to go from "I want to write" to "written" in seconds, using only the keyboard.

**Naming**: a journal entry is a **postcard** throughout the UI (en/fr/ko); the Journal is
where your postcards live. The internal record keeps its identity/portable-file shape
(renaming internal identifiers is optional and not user-visible).

## User Scenarios & Testing *(mandatory)*

This redesign supersedes the never-implemented draft **spec 017 (Journal Compose Flow)**,
folding its focused-page, one-gesture, and "near you" ideas into a delivered redesign, and
adds the two things that make the journal *fast* and *unblocked*: **keyboard-first capture**
and **place is no longer required**.

### User Story 1 - Capture a postcard in seconds, keyboard-first (Priority: P1)

**This is the point of the redesign.** A power user who journals daily wants the shortest
possible path from intent to saved. From anywhere in the app, one action opens a focused
composer that is **already dated today with the cursor blinking in the content box** — no
field to click first, nothing required but the writing. They type a note, press a
save chord, and it's stored — and if they're on a roll, a **"save & start another"** keeps
them in a rapid loop without bouncing back to the feed. Place, title, folder, tags, trip,
photos are all optional and out of the tab path, so a plain text postcard costs only the
open, the typing, and the save. Everything is operable without a pointer.

**Why this priority**: Fast, frictionless capture is the whole reason to redesign. It
subsumes the minimal model (date + content, place optional) and the focused page, because
speed requires both. Delivered alone it is already a dramatically better journal.

**Independent Test**: With no visited places logged, using **only the keyboard**: trigger
the "write today" shortcut, type a note, save with the keyboard; confirm the postcard is
stored, dated today, with no place. Then use "save & start another" to write a second
postcard without touching the pointer or returning to the feed. Confirm a postcard with no
text and no photo cannot be saved.

**Acceptance Scenarios**:

1. **Given** any screen, **When** the user invokes the "write today" action (a documented keyboard shortcut, the long-press shortcut, or the visible primary button), **Then** the composer opens as a full-screen page, dated today, with focus already in the content field, ready to type.
2. **Given** the composer with a note typed, **When** the user presses the save chord (keyboard), **Then** the postcard is stored locally, the page closes, and it appears in the feed — with no place, title, or other field required.
3. **Given** a just-saved postcard, **When** the user chose "save & start another", **Then** a fresh empty postcard dated today opens immediately with focus in the content field, without returning to the feed.
4. **Given** the composer, **When** the user has typed neither text nor added any photo, **Then** Save is unavailable and the reason (needs some content) is clear.
5. **Given** the composer, **When** the user presses Escape (or Cancel), **Then** it closes without saving, returns to the launching screen, and any typed content is preserved as a resumable draft.
6. **Given** a brand-new user with zero visited places, **When** they write, **Then** they can complete and save a postcard with no place — the old "pick a visited place first" block is gone.

---

### User Story 2 - Add optional context fast, all by keyboard (Priority: P2)

When the user *does* want more than a note, every extra is one quick, keyboard-driven
gesture and none is required. From the composer they can, in any order and without leaving
it: attach a **place** (type a few letters → the places they've been filter → confirm), a
**title**, a **folder**, **mood/weather/free tags** (type-and-Enter chips), and **link the
postcard to a trip** they've reconstructed (type-ahead over their trips). Attachments live
in an "add details" area that is present but off the default tab path, so power users who
want them reach them instantly and everyone else never trips over them.

**Why this priority**: Rich postcards without slowing the P1 capture. Each attachment is
independent and optional, so this ships incrementally on top of the fast core.

**Independent Test**: In the composer, using only the keyboard: attach a place by typing a
few letters and confirming; add two tags via type-and-Enter and remove one; set an optional
title; link the postcard to an existing trip via type-ahead; save; reopen and confirm all
attachments round-tripped. Confirm each is optional by saving a postcard with none of them.

**Acceptance Scenarios**:

1. **Given** the composer, **When** the user opens the place control and types a few letters, **Then** the places they've been filter to matches and a single confirming keypress attaches one; leaving it blank attaches no place, and no new reference place is ever created.
2. **Given** the composer, **When** the user types a tag and presses Enter, **Then** it becomes a chip; mood and weather are offered as quick preset tags; chips are removable by keyboard.
3. **Given** the composer, **When** the user opens the trip control and types, **Then** their reconstructed trips filter and one can be linked in a keypress; the linked trip is shown on the postcard and the trip's page can surface its postcards.
4. **Given** the composer, **When** the user adds an optional title and a folder (type-ahead over existing folders), **Then** both save with the postcard and are omitted when left empty.
5. **Given** any of these attachments, **When** the user saves and reopens the postcard to edit, **Then** every attached value is present and editable, and removing one and re-saving drops it cleanly.

---

### User Story 3 - One postcard can span several places or a date range (Priority: P3)

A real travel day isn't one place at one instant — it's "Paris, then Reims, then back," or
"that week in Lisbon." A postcard can optionally carry **more than one place** (an ordered
set, reusing the same "places you've been" picker) and/or a **date range** (a start and an
end day) instead of a single day. Both are optional refinements of the base postcard; a
plain single-day, single-or-no-place postcard is unaffected.

**Why this priority**: Expressive power for serious journalers, but strictly additive and
lower-frequency than daily capture, so it ships after the fast core and single attachments.

**Independent Test**: Create a postcard, attach two places in order, set a start and end
date, and save; confirm both places and the range persist and display sensibly (and sort
correctly among single-day postcards). Confirm a single-place, single-day postcard still
works unchanged.

**Acceptance Scenarios**:

1. **Given** the composer, **When** the user attaches a second (and third) place, **Then** the postcard records them in order, and the read views that key on place associate the postcard with each.
2. **Given** the composer, **When** the user sets an end date later than the start date, **Then** the postcard is stored as spanning that range and displays as a range; an end date equal to or absent leaves it a single-day postcard.
3. **Given** a multi-place or ranged postcard exported and re-imported, **When** it round-trips, **Then** all places and both dates are preserved.

---

### User Story 4 - "Near you" suggests a place without being asked (Priority: P4)

Because attaching a place is optional, the app never demands it — but when you're writing
from where you are, it helps. On opening a new postcard, the app **automatically attempts**
a location fix and, if available, offers a short list of **places near you** to attach in
one keystroke/tap. It is opt-in and permission-gated: if permission is absent, denied,
offline, or slow, the composer is fully usable with place still optional and no error
noise. Coordinates are used only on-device to rank nearby reference places, never stored on
the postcard, never transmitted.

**Why this priority**: A delightful shortcut for the common case, but entirely optional and
privacy-sensitive, so it ships last.

**Independent Test**: Open a new postcard with location granted and a known position;
confirm nearby places appear and one keystroke/tap attaches a place. Open it with permission
denied/unavailable; confirm no error, place stays optional, and manual search works.

**Acceptance Scenarios**:

1. **Given** location permission granted and a position available, **When** the composer opens, **Then** a short "near you" list appears within a couple of seconds and the top suggestion can be accepted with one keystroke.
2. **Given** permission undecided, **When** the composer opens, **Then** it is requested in context, and whatever the answer the composer stays fully usable with place optional.
3. **Given** permission denied, offline, or a slow/failed fix, **When** the composer opens, **Then** no error is shown, nothing blocks the form, and manual place search is available immediately.
4. **Given** a location was obtained, **When** the postcard is saved, **Then** raw coordinates are not stored on it and not transmitted; editing an existing postcard never lets auto-location overwrite an already-attached place.

---

### Edge Cases

- **Place-less & multi-place postcards in the five read views**: The read side (Feed / By place / Timeline / Map / Calendar) is kept, but must handle the new shapes gracefully — a place-less postcard shows dated with no place link and groups under a clear "No place" bucket in place-keyed views (or is omitted from the map, not crashed or given an invented place); a multi-place postcard appears under each of its places; a ranged postcard sorts by its start day and shows its span.
- **Empty postcard**: No text AND no photos ⇒ cannot save, regardless of place, tags, or trip.
- **Save & start another**: The rapid loop must clear content and photos but may sensibly carry forward the date (today) and, if the user wishes, the last place/trip/folder; it must never silently duplicate the previous postcard.
- **Unsaved draft on leave**: Leaving (Escape/Cancel/Back, tab switch, phone Back) with typed content auto-preserves a resumable draft; no discard modal.
- **Keyboard vs long-press ambiguity**: A short tap on the Journal nav opens the feed; a long-press opens today's composer; a keyboard shortcut does the same; a drag/scroll on the button cancels the long-press; a normal tap never opens the composer.
- **Tab order**: Optional attachments must not sit between the content field and the Save action in the tab order, so a power user reaches Save immediately after typing.
- **Location denied earlier / slow / offline**: Never nag, never block, silently fall back to optional/manual place.
- **Trip link integrity**: If a linked trip is later deleted, the postcard must not break — the link degrades to "no trip" gracefully.
- **Migration**: Every existing entry keeps its place, date, title, text, folder, and photos; new optional fields (extra places, end date, tags, trip link) simply start empty. Making place optional never strips a stored place.
- **Near-midnight**: The old "which day is this for?" disambiguation ceremony is removed; the editable date field (default today) handles it.

## Requirements *(mandatory)*

### Functional Requirements

#### Fast, keyboard-first capture (P1 — the priority)

- **FR-001**: A documented **keyboard shortcut** MUST open a new "write today" postcard from anywhere in the app; a visible primary "write" control and the Journal nav long-press MUST reach the same action, so the shortcut is never the only path.
- **FR-002**: On opening a new postcard the composer MUST auto-focus the content field and default the date to today, so the user can type immediately with no preliminary interaction.
- **FR-003**: Save MUST be operable by a keyboard chord and Cancel by Escape, each with a visible equivalent button.
- **FR-004**: The composer MUST offer a **"save & start another"** action (keyboard and visible) that saves the current postcard and immediately opens a fresh one dated today with focus in the content field, without returning to the feed, enabling rapid successive capture.
- **FR-005**: Every optional attachment (place, title, folder, tags, trip link, photos) MUST be fully keyboard-operable and MUST NOT sit in the tab path between the content field and Save; reaching Save right after typing MUST require no tabbing through optional fields.
- **FR-006**: Attaching a place, a folder, or a trip MUST use **type-ahead**: typing a few characters filters candidates and a single confirming keypress applies the choice — no pointer-only dropdown.
- **FR-007**: The composer MUST apply smart, overridable defaults to minimize input — date = today; the last-used folder/trip offered; the top "near you" place (when available) acceptable in one keystroke — each skippable and never required.
- **FR-008**: The "which day is this?" near-midnight disambiguation MUST be removed; the editable date field is the single mechanism for the day.

#### Minimal postcard model (place optional, content required)

- **FR-009**: A postcard MUST be saveable with only a date and content (text and/or at least one photo); no other field may be required.
- **FR-010**: Place MUST be optional — a postcard can be saved with no place attached.
- **FR-011**: A postcard MUST still require content: saving MUST be prevented when there is neither text nor any photo, with the reason clearly conveyed.
- **FR-012**: When a place is attached it MUST come from the places the user has been; the composer MUST NOT mint a new reference place, and a blank place MUST create nothing (aggregator-not-author).
- **FR-013**: The date MUST default to today and stay editable; it is the one always-present required field besides content.
- **FR-014**: An optional **Title** MUST be available (collapsed/secondary), saved when present and omitted when empty.

#### Focused composer page

- **FR-015**: The composer MUST be its own full-screen page layer (peer to the city/country detail pages), not an inline form beneath the feed.
- **FR-016**: By default the page MUST surface the date, the content field (with the optional title secondary), and nothing else required; place, folder, tags, trip link, and per-photo captions MUST live in a clearly-labelled, keyboard-reachable "add details" area.
- **FR-017**: Save persists the postcard locally and returns to the launching screen; Cancel/Escape/Back return without saving, consistent with the app's existing page-layer behavior.
- **FR-018**: Leaving with unsaved, non-empty content MUST auto-preserve a resumable local draft and restore it when the composer next opens for the same context; no discard-confirmation modal. The draft is transient on-device state only — never written as reference/shared data, never transmitted — cleared once saved or explicitly discarded.
- **FR-019**: Editing an existing postcard MUST reuse the composer page and return to the launching screen on save/cancel.
- **FR-020**: The Journal MUST expose a clear, discoverable primary "write" entry point.

#### Optional context: tags, trip link, folder

- **FR-021**: A postcard MUST support optional **tags** entered as type-and-Enter chips, removable by keyboard, with **mood** and **weather** offered as quick presets; tags are personal data (not reference data) and are stored on the postcard.
- **FR-022**: A postcard MUST support an optional **link to one reconstructed trip**, chosen by type-ahead over the user's trips; the trip's page MAY surface its linked postcards, and a deleted trip degrades the link to none without breaking the postcard.
- **FR-023**: The existing optional **folder** MUST remain, chosen by type-ahead over existing folders.

#### Multiple places & date range (additive)

- **FR-024**: A postcard MUST optionally carry **more than one place**, as an ordered set drawn from the places the user has been (still minting nothing); a single-place or place-less postcard is the default.
- **FR-025**: A postcard MUST optionally carry an **end date** (a range) in addition to its start date; absent or equal end date leaves it a single-day postcard; ranges sort by start day and display as a span.

#### "Near you" suggestion

- **FR-026**: On opening a NEW postcard, the app MUST automatically attempt a device location fix to *suggest* nearby places — on open, no separate tap — subject to permission (silent if granted; in-context request if undecided).
- **FR-027**: Location MUST be opt-in and permission-gated; the composer MUST NOT block waiting for a result and MUST time out gracefully.
- **FR-028**: If permission is absent/denied, offline, or the fix fails/times out, the composer MUST stay fully usable (place optional, manual search) with no error or blocking state.
- **FR-029**: Coordinates MUST be used only on-device to rank nearby reference places; they MUST NOT be stored on the postcard or transmitted; auto-location MUST NOT overwrite a place already attached when editing.

#### Cross-cutting (constitution)

- **FR-030**: The read side (Feed / By place / Timeline / Map / Calendar), search, filters, Markdown export, and Publish mode MUST keep working, adapted only as needed to render the new postcard shapes (place-less, multi-place, ranged, tagged, trip-linked) gracefully — including a "No place" grouping for place-keyed views.
- **FR-031**: All new/renamed user-visible strings (including the "postcard" vocabulary) MUST exist in en, fr, ko with compile-time key parity, and all interactive elements MUST meet WCAG 2.1 AA (labels, focus order, target size, keyboard operability); every keyboard shortcut MUST have a visible, discoverable equivalent.
- **FR-032**: The feature MUST NOT introduce telemetry or any egress of user content or location; the entire flow MUST work with zero network connectivity.
- **FR-033**: The portable file's documented, versioned schema MUST be bumped for the additive, backward-compatible changes (place optional; optional tags, trip link, extra places, end date); older files MUST still validate, new files MUST round-trip through export/import, and imported postcards MUST remain inert (no execution, no reference-data creation).

### Key Entities *(include if feature involves data)*

- **Postcard (formerly "Story", changed)**: A journal entry — a dated card with content. **Required**: a start date and content (text and/or ≥1 photo). **Optional (existing)**: title, text, folder, photos with captions. **Optional (new)**: a place *or an ordered set of places* drawn from places you've been (previously a single required place); an end date (range); tags (mood/weather/free); a link to one reconstructed trip. No coordinates are ever stored. Additive, backward-compatible; existing entries keep everything.
- **Composer session (transient)**: The in-progress draft while the page is open — date(s), content, and any optional attachments — plus its "return target" and a "save & start another" continuation. A locally-cached resumable draft only; never reference/shared data; cleared on save/discard.
- **Nearby suggestion (transient, derived)**: A short ranked list of reference places closest to the current device position, computed on-device from existing reference data and non-persisted coordinates. Ephemeral input to the optional place picker.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (speed): From anywhere in the app, the "write today" shortcut brings up a composer with the cursor in an empty, today-dated postcard in ≤ 1 second and a single action.
- **SC-002** (keystroke economy): A power user captures a text-only postcard for today using **only the keyboard** with no more than the open action + typing + a save chord — no field navigation required to save.
- **SC-003** (rapid loop): A user can write and save 5 postcards in a row using "save & start another" without using a pointer and without returning to the feed between them.
- **SC-004** (fast attach): After opening the place control, attaching a place takes ≤ 3 keystrokes (a few letters + confirm); linking a trip and adding a tag are each similarly ≤ 3 keystrokes.
- **SC-005** (unblocked): A brand-new user with zero visited places can write and save their first postcard (a dated note) in under 30 seconds, attaching no place.
- **SC-006** (content rule): A postcard saves with text only, photo only, or both — and never with neither — independent of place, tags, or trip.
- **SC-007** (no data loss): 100% of pre-redesign entries keep their place, date, title, text, folder, and photos after the change, verified by export/import round-trip; new optional fields start empty.
- **SC-008** (return fidelity): 100% of composer exits via Back/Escape/Cancel return to the exact launching screen with nothing saved and the typed draft preserved.
- **SC-009** (one gesture): A long-press on the Journal nav opens today's composer in a single gesture while a short tap opens the feed, and the same "write today" is reachable by keyboard only.
- **SC-010** (near you): With location available, the top "near you" place is acceptable in one keystroke within 2 seconds of opening; with location denied/offline, the composer is fully usable with zero errors and place optional.
- **SC-011** (offline & inert): With the network disabled, the whole flow (open, write, near-you, attach, save, export, re-import) works and a network monitor records zero outbound requests attributable to this feature.
- **SC-012** (a11y & i18n): The composer passes automated WCAG 2.1 AA checks, every keyboard shortcut has a visible equivalent, and the build fails if any en/fr/ko translation key is missing.

## Assumptions

- Power-user speed is the top priority; the design optimizes the *common, frequent* action (write a dated note today) to near-zero overhead, while keeping every richer capability one keyboard gesture away and fully optional.
- The composer reuses the app's existing page-layer navigation (the city/country detail pattern) for open/close/Back/Escape and "return to where you were"; this delivers the page layer draft spec 017 proposed but never shipped.
- All five read views are kept; they are adjusted only as much as needed to render the new postcard shapes gracefully (place-less "No place" grouping, multi-place membership, ranged display).
- "Postcard" becomes the user-facing name for a journal entry across en/fr/ko; renaming internal identifiers is an optional implementation detail with no user-facing effect.
- Tags, trip links, extra places, and end dates are additive optional fields; each is a documented, backward-compatible schema addition, and older files (single required place, no new fields) still validate.
- "Near you" ranks places from the existing on-device reference gazetteer; no new reference dataset is introduced (Constitution: aggregator, never an author).
- Photo capture/downscale/sanitization, storage in the portable file, and feed rendering are reused; the model changes are the place-optional relaxation plus the additive optional fields.
- The exact keyboard shortcut keys and the long-press threshold are UX details tuned for feel during implementation; both always have accessible, visible equivalents.
- Supported locales are en/fr/ko; desktop keyboard users are first-class.

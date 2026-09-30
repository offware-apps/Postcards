# Contract: Composer UX & keyboard interface (P1)

The interface *is* the contract for this app (Principle VII). This fixes the fast,
keyboard-first behavior so it is testable. Every shortcut has a visible equivalent.

## Entry points (all reach the same "write today" composer)

| Path | Action | A11y equivalent |
|------|--------|-----------------|
| Global shortcut **`W`** | Open a new postcard dated today, cursor in content | is itself the keyboard path |
| Journal nav **long-press** | Open a new postcard dated today | the `W` shortcut |
| Journal nav **short tap** | Open the Journal feed (unchanged) | — |
| Visible primary **"Write"** button (in Journal) | Open a new postcard | button is focusable/operable |
| From a city page ("write about this place") | Open composer with that place pre-attached, return to the city page | button |

`W` is inert while typing in an input/textarea/select or while any dialog layer is open
(inherits the existing global-keydown guards).

## The composer page

- Renders as a **full-screen page layer** (peer of city/country/trip pages); Escape and
  Back/`popstate` close it via the app's central `closePages`, returning to the launching
  screen. No custom Escape inside the composer.
- **On open (new)**: date = today; **focus is in the content field**; nothing else required.
- **Default view**: date + content field (+ optional Title secondary). Place, extra places,
  folder, tags, trip link, per-photo captions live under a labelled **"add details"** region.
- **Tab order**: content → Save actions → (then) the "add details" controls. Reaching Save
  after typing requires no tabbing through optional fields.

## Keyboard actions

| Keys | Action |
|------|--------|
| **Ctrl/Cmd + Enter** | Save & close (returns to launching screen) |
| **Ctrl/Cmd + Shift + Enter** | **Save & start another** — save, then reopen an empty postcard dated today, focus in content, without leaving the page |
| **Escape** | Cancel & close; unsaved content is preserved as a resumable draft (no discard modal) |
| **Enter** (in content) | newline (content is multiline; Enter never saves) |

Visible buttons mirror all three: **Save**, **Save & new**, **Cancel**.

## Attachments (each optional, keyboard-operable)

- **Place**: type-ahead over places the user has been; a few letters filter, one confirming
  key attaches. Blank attaches nothing and mints nothing.
- **Extra places**: same picker, added in order (up to the max); removable by keyboard.
- **Trip link**: type-ahead over the user's reconstructed trips; one key links; a deleted
  trip degrades to none.
- **Tags**: type-and-Enter chips; **mood** and **weather** offered as preset chips; chips
  removable by keyboard.
- **Folder**: type-ahead over existing folders.
- **Title**: optional single line.
- **Date range**: an optional end date alongside the start date.

## "Near you" (opt-in, P4)

- On opening a NEW postcard, auto-attempt a location fix (permission-gated). If available,
  show a short "near you" list; the **top suggestion is acceptable with one keystroke**.
- Denied / offline / slow / undecided ⇒ no error, nothing blocks, place stays optional,
  manual search available. Coordinates rank places on-device only; never stored on the
  postcard; never transmitted. Editing never overwrites an already-attached place.

## Draft safety

- Leaving with unsaved, non-empty content auto-preserves a resumable local draft (reuse the
  existing `postcards-journal-draft` cache + visibility/pagehide flush), restored on next
  open for the same context; cleared on save or explicit discard. Transient device state
  only — never reference/shared data, never transmitted.

## Acceptance (maps to spec Success Criteria)

- SC-001: `W` → cursor blinking in an empty, today-dated postcard in ≤ 1 s / one action.
- SC-002: a text postcard saved keyboard-only with no field navigation.
- SC-003: 5 postcards via "Save & new" with no pointer, never leaving the page.
- SC-004: attach a place / link a trip / add a tag each in ≤ 3 keystrokes after opening the control.
- SC-005: brand-new user (no visited places) saves a first postcard, no place, < 30 s.
- SC-008/009/012: correct Back/Escape return; long-press vs tap distinct; WCAG 2.1 AA;
  every shortcut has a visible equivalent; en/fr/ko parity enforced.

## Test obligations (e2e / a11y)

- Keyboard-only capture (open via `W`, type, save chord) with zero visited places.
- "Save & new" loop of ≥ 2 postcards without a pointer.
- Escape/Back returns to the launching screen with the draft preserved.
- Long-press opens today's composer; short tap opens the feed.
- axe WCAG 2.1 AA gate on the composer page; missing en/fr/ko key fails the build.

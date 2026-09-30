# Device sync

Keep your postcards the same on your phone and your laptop **without a server, an
account, or the cloud** — by putting the one portable JSON file you already own in a
**git repo** and having each device pull it, merge it record-by-record, and push it
back. Sync is always an explicit tap; nothing moves on a timer or in the background.

This is feature **[013 — Device sync](../specs/013-device-sync)** (`spec.md`,
`tasks.md`). The git-mode MVP (Stories 1–3) is built; direct device-to-device sync
(Story 4) is a specified Phase 2.

**Where it lives in the code**

| Concern | File |
| --- | --- |
| Pure convergent merge (records + tombstones) | `src/lib/sync/merge.ts` |
| Sync engine — one pull → merge → write → push run | `src/lib/sync/engine.ts` |
| Git remote (GitHub) behind the seam | `src/lib/publish/gitTarget.ts` |
| Settings UI (config + "Sync now") | `src/features/settings/SyncSection.tsx` |
| Shared connector form (owner/repo/branch/token) | `src/ui/GitHubConnectorFields.tsx` |
| Tombstone store (IndexedDB) | `src/lib/db/visitsDb.ts` |
| `updatedAt` stamping + backfill | `src/lib/store/*`, `src/lib/schema/helpers.ts` |

See also [Architecture](Architecture.md) (Seam 3 — the publish/sync git target),
[Features](Features.md#device-sync), [Publishing](Publishing.md) (the sibling
feature that shares the git target), and [Privacy & constitution](Privacy-and-Constitution.md).

---

## What actually syncs

The synced unit is the **same one portable JSON file** that Backup/Export writes —
unchanged as a format (schema `postcards` v6). Because sync moves nothing more than
that file, **the sync repo doubles as a plain, readable backup** you can restore
without the app (FR-021).

Three personal collections travel, each as a `records + tombstones` snapshot:

- **Visits** (keyed by `visitId`)
- **Trips** (keyed by `tripId`)
- **Stories** — the journal (keyed by `storyId`)

Bundled read-only **reference datasets are deliberately excluded** — you move only
your own records (FR-017). See [Data & provenance](Data-and-Provenance.md) for why
reference data is inert and never authored by the app.

---

## The convergent merge

The reason this feature exists rather than "copy the file across" is that a
whole-file overwrite would silently lose one device's offline work. Instead the merge
runs at the **record level**, and it is a pure function with no I/O — unit-tested in
isolation (`src/lib/sync/merge.ts`).

```ts
export function mergeById<R>(
  a: SyncSnapshot<R>,
  b: SyncSnapshot<R>,
  idOf: (r: R) => string,
  tsOf: (r: R) => string | null | undefined,
): SyncSnapshot<R>
```

Given two snapshots of the same collection, it:

1. **Unions tombstones** per id, keeping the newest `deletedAt`.
2. **Upserts records** per id — for each id it keeps a single winner across both
   sides (`pick`), so a record added only on one device is never dropped (FR-004).
3. **Applies deletions**: a record survives only if no tombstone stands
   *at-or-after* its timestamp. A delete newer than the last edit removes it; an edit
   *strictly* newer than the delete revives it (an explicit re-add) — FR-010.
4. **Sorts output** (records and tombstones by id) so the result is byte-stable.

### Newest-wins, with a deterministic tie-break

Each record carries an `updatedAt` timestamp; the merge orders two versions of the
same id by it (falling back to `addedAt`). The newer one wins (FR-005). On an *exact*
timestamp tie the winner is chosen by comparing the JSON of the two records, so the
outcome **never depends on argument order**:

```ts
function pick<R>(a, b, tsOf) {
  const ta = stamp(a, tsOf), tb = stamp(b, tsOf);
  if (ta > tb) return a;
  if (tb > ta) return b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b; // stable tie-break
}
```

This matters because device clocks can collide or skew — the app trusts the recorded
`updatedAt` and no more, and the tie-break guarantees both devices still pick the same
winner (FR-008; spec Edge Cases).

### Three properties that make convergence safe

The merge is:

- **Deterministic** — same inputs, same output, every run.
- **Commutative** — `merge(a, b) == merge(b, a)`, so **sync order doesn't matter**:
  A-then-B and B-then-A reach byte-identical states (SC-003).
- **Idempotent** — `merge(a, a) == a`, so **re-running sync on converged data is a
  genuine no-op** (SC-005).

These are the properties (CRDT-style, without a CRDT library) that let two devices
converge no matter who synced first or how many times — see [Architecture](Architecture.md#seam-3--the-publish--sync-git-target).

> **Scope**: this is single-user, multi-device sync. The conflict rule is per-record
> newest-wins (last writer wins by wall-clock `updatedAt`); there is **no sub-record
> field merging, OT, or multi-user co-editing** (spec Out of Scope).

---

## Deletions as tombstones, and their garbage collection

Without an explicit deletion signal, a naive newest-wins merge reads "missing on
device A" as "A hasn't seen it yet" and re-adds the record forever. So deletions are
**first-class tombstones** — `{ id, deletedAt }` — carried inside the synced file
(FR-009).

- Every store's remove path writes a tombstone to a small IndexedDB store. Example
  from `useVisits.removeVisit`: after `db.deleteVisit(visitId)` it calls
  `db.putTombstone("visit", visitId, stampNow())`. Restoring/re-adding a record
  drops its tombstone (`deleteTombstone`) and bumps `updatedAt` so the revived copy
  wins.
- Tombstones are namespaced by `kind` (`"visit" | "trip" | "story"`) so the engine
  routes each to the right per-collection merge (`TombstoneRecord` in `visitsDb.ts`).
- In the file they live in an optional top-level `tombstones` array
  (`SyncTombstoneSchema`, strict Zod). A **plain backup carries none**; a sync file
  carries the current, un-retired set — the field is left undefaulted so ordinary
  exports stay clean.

**Garbage collection.** Tombstones can't live forever, but retiring one too early
lets a long-offline device resurrect the record. `gcTombstones(snap, horizonIso)`
drops only tombstones older than a conservative horizon — the engine passes
**90 days** by default (`DEFAULT_GC_HORIZON_DAYS`) — applied at the safe sync point
(FR-011). It is caller-driven and deliberately simple, honouring the constitution's
"no clever server-side coordination."

---

## The sync engine: pull → merge → write local → push

`syncOnce(ports)` in `src/lib/sync/engine.ts` orchestrates **one** run, in this
order (FR-003):

1. **Pull** the remote file (`remote.pull()` → `{ content, version }`; a missing file
   means a fresh repo to seed).
2. **Parse** the pulled text through the *same* validate-and-sanitize path a manual
   import uses — a malformed or hostile file **throws here and aborts the run before
   any local write** (FR-013). A file on an older schema version is migrated first
   (FR-014).
3. **Merge** every collection with `mergeById`, then GC old tombstones.
4. **Short-circuit**: if the remote already equals the converged set (compared via a
   canonical, metadata-independent string), there's **nothing to push** — a true
   idempotent no-op (SC-005).
5. **Push** the serialized merge with the conditional write (below).
6. **Persist locally** — records *and* tombstones in **one IndexedDB transaction**
   (`replaceAllPortable`), then update the Zustand stores.

Crucially, **local data is written only *after* a successful push**. A failed sync
(no network, auth denied, retries exhausted) throws before `persist` and leaves the
device **byte-identical** to its prior state — never a partial or corrupt mix
(FR-015 / SC-008). The run returns per-collection `SyncCounts` (added / updated /
removed) plus a `createdRemote` flag for the status line (FR-016).

The engine is **I/O-agnostic**: the git host lives behind a `SyncRemote` interface
and the file codec + local write are injected ports, so it unit-tests against an
in-memory remote and any git remote works (zero lock-in). `gitHubSyncRemote(target,
path)` adapts a `GitHubTarget` and translates its `GitPushConflictError` into the
engine's `SyncConflictError`, keeping the retry branch provider-agnostic.

### The conditional-push retry (never hand-resolve a git conflict)

The race: two devices both pull, both merge, both try to push. The second push would
be a non-fast-forward. The engine handles it automatically (FR-012):

- **Pull** returns an opaque `version` token — for GitHub this is the file's **git
  blob SHA**.
- **Push** asserts that token via `putFileConditional(path, content, message,
  expectedVersion)`. GitHub's Contents API answers **409/422** if the remote moved
  on, which `GitHubTarget` raises as `GitPushConflictError` → `SyncConflictError`.
- On that error the engine **re-pulls, re-merges, and retries** — up to
  `DEFAULT_MAX_RETRIES` (3). Because the merge is commutative and idempotent, folding
  in the other device's push and pushing again is always safe.

The user **never sees a git text conflict** and never merges by hand. Any other error
(network, auth) is not retried — it propagates and local data is left untouched.

---

## Setting it up

Everything is in **Settings → "Sync across your devices"**
(`SyncSection.tsx`), built on the shared `GitHubConnectorFields` form so the token
form isn't duplicated between Publish and Sync.

1. Create (or reuse) a git repo you own.
2. Fill in **Owner**, **Repo**, **Branch** (defaults to `main`), and a **Token** — a
   fine-grained GitHub PAT with **Repository access: only that repo** and
   **Permissions: Contents → Read and write**, nothing else. The hint under the
   token field says the same.
3. Tap **Sync now**.

The file is written to `places.postcards.json` at the repo root. On the first sync
against an empty repo, the app **seeds** the file and reports "Created the file on the
remote and pushed your data." On later runs the status line summarises what changed,
e.g. *"Synced. Places: +2 added, 1 updated, −0 removed."*, or "Already in sync —
nothing changed."

**Where the config lives.** Owner/repo/branch/token are stored **on this device
only** (`localStorage`), keyed `postcards-sync-*`, alongside a `postcards-sync-last`
timestamp shown as "Last synced …". The **token is never written into the synced file
or any export** (FR-020) — it stays on-device. The heavy codec (Zod), the engine, and
the connector are **loaded on demand** when you tap Sync, so this section costs the
boot chunk nothing.

**Why the narrow token.** Browser storage belongs to an origin, not to one app: every
page served from the same origin shares it. On GitHub Pages the origin is the owner's
`<owner>.github.io`, which serves every Pages site of that owner, and
`offware-apps.github.io` currently serves another app beside Postcards. A token limited
to the one sync repository, with Contents read and write only, bounds what the token
can do wherever it is read from. Serving the app from its own origin (a custom domain,
or the native app) removes that dependency.

---

## `updatedAt`: the newest-wins comparator, and migration

Newest-wins needs a field to compare, so schema **v6** adds an optional `updatedAt`
(ISO string) to Visit, Trip, and Story (`models.ts`), plus the optional `tombstones`
array. Both are additive and optional, so **v1–v5 files import unchanged**; an older
build opening a v6 file gets the graceful "update the app" prompt rather than a
strict-parse error.

- **Stamping**: every mutating store path writes `updatedAt = new Date().toISOString()`
  (`stampNow()` in `useVisits`/`useTrips`/`useStories`) — add, update, favourite
  toggle, photo edit, and so on — while **`addedAt` stays immutable**.
- **Backfill**: records made before the field existed get `updatedAt = addedAt` on
  load and on any bulk set, via `backfillUpdatedAt` (`schema/helpers.ts`). It's
  idempotent and non-mutating, so the merge always has a timestamp to compare
  (spec Assumptions).

See the [Architecture](Architecture.md#the-zod-schema-and-generated-json-schema) page
for how the Zod schema and versioning work.

---

## Safety, privacy, and failure behaviour

Sync inherits the app's [constitution](Privacy-and-Constitution.md):

- **Explicit action only** — nothing syncs on a timer or in the background; only "Sync
  now" moves data (FR-001).
- **Inert imports** — the pulled file is validated against the versioned schema and
  sanitized exactly as a manual import, **never executed**; malformed, truncated, or
  hostile content aborts the run (FR-013 / SC-007).
- **No third party but your remote** — no account, no telemetry, no analytics in the
  sync path; data goes only to the git remote you configured (FR-018 / SC-006).
- **Encrypted in transit** — the connection uses the remote's own transport security
  (GitHub over HTTPS); the app never downgrades it (FR-019).
- **Local data never corrupted** — on any failure (no network, auth denied, malformed
  file, retries exhausted) the status line reads "Sync failed: … Your data on this
  device is unchanged." and local state is byte-identical to before (FR-015 / SC-008).
- **Same readable file** — the synced artifact stays the one human-readable JSON
  backup; the app does **not** add at-rest encryption on the remote (a repo you
  control) — that's out of scope by design.

---

## Phase 2 — direct device-to-device (P2P)

Story 4 / **FR-022–FR-023** (task **T014**) is specified but **not part of the
git-mode MVP**. The plan: two devices on the **same local network** sync directly with
**no git remote, no internet, no server** —

- **Pair by QR code**: one device shows a QR, the other scans it to open an
  **encrypted peer-to-peer channel** (e.g. a WebRTC data channel).
- **Same merge core**: the identical record-level merge (newest-wins + tombstones,
  deterministic/commutative/idempotent) runs over that channel, so convergence,
  conflict, and deletion behaviour match git mode exactly (FR-023). This is why the
  engine is I/O-agnostic and the merge is a pure module — the transport swaps, the
  convergence logic doesn't.
- **No cloud, even in transit** (SC-009): network inspection should show zero traffic
  to any remote host — the fullest expression of the constitution's decentralization
  principle.

It's heavier to build (pairing, signalling, a data channel) and unnecessary to deliver
working cross-device sync, so it's a future phase rather than MVP scope.

---

## Requirement map

| Requirement | Where |
| --- | --- |
| FR-001 explicit, user-initiated | `SyncSection.onSync` (tap only) |
| FR-003 pull → merge → push order | `engine.syncOnce` |
| FR-004/005/007/008 record-level, newest-wins, deterministic/commutative/idempotent | `merge.mergeById`, `merge.pick` |
| FR-009/010 tombstones + delete-vs-edit | `merge.ts`; `db.putTombstone` in stores |
| FR-011 tombstone GC (90-day horizon) | `merge.gcTombstones`, `engine.gcAll` |
| FR-012 conditional-push retry | `putFileConditional` → `GitPushConflictError` → `SyncConflictError` retry loop |
| FR-013/014 inert import + migration | `parse` port (reuses `importFile`) |
| FR-015 all-or-nothing local write | `persist` after push; `replaceAllPortable` one transaction |
| FR-016 change report | `SyncCounts`, `summarize()` |
| FR-020 token on-device only | `localStorage` `postcards-sync-token`, never serialized |
| FR-021 file doubles as backup | `places.postcards.json` = the portable file |
| FR-022/023 P2P (Phase 2) | task T014 — not yet built |

## Related pages

- [Architecture](Architecture.md) — Seam 3 (git target), the Zod schema, IndexedDB store.
- [Publishing](Publishing.md) — the sibling feature that shares the `GitHubTarget` seam.
- [Features](Features.md#device-sync) — the user-facing summary.
- [Data & provenance](Data-and-Provenance.md) — why reference data is excluded from sync.
- [Privacy & constitution](Privacy-and-Constitution.md) — the principles sync upholds.
- [Home](Home.md) — the wiki index.

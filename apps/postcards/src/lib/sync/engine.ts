// Device-sync engine (git mode) — spec 013.
//
// Orchestrates ONE sync run: pull the remote portable file, merge it record-by-
// record into local data (reusing the convergent core in ./merge), write the
// merged result back to local, and push it to the remote — in that order (FR-003).
// A non-fast-forward on push (the other device pushed between our pull and push)
// makes us re-pull, re-merge and retry automatically, so the user never resolves a
// git text conflict by hand (FR-012).
//
// The engine is deliberately I/O-agnostic: the git host lives behind `SyncRemote`
// (GitHub is one impl — see gitHubSyncRemote), and the portable-file codec + the
// local write land through injected ports. That keeps it pure enough to unit-test
// with an in-memory remote and keeps zero-lock-in honest (any git remote works).

import { canonicalJson, gcTombstones, mergeById, type SyncSnapshot } from "./merge";
import type { Story, Trip, Visit } from "../schema/models";
import { MAX_PHOTOS_PER_VISIT, placeKey } from "../schema/helpers";
import { GitHubTarget, GitPushConflictError } from "../publish/gitTarget";

/** The three synced collections, each as a records+tombstones snapshot. */
export interface StoreSnapshots {
  visits: SyncSnapshot<Visit>;
  trips: SyncSnapshot<Trip>;
  stories: SyncSnapshot<Story>;
}

/** An empty starting point (a fresh install, or a remote that has no file yet). */
export function emptySnapshots(): StoreSnapshots {
  return {
    visits: { records: [], tombstones: [] },
    trips: { records: [], tombstones: [] },
    stories: { records: [], tombstones: [] },
  };
}

/**
 * Signals a non-fast-forward: the remote advanced since we pulled. The engine
 * catches it to re-pull and re-merge; a `SyncRemote` raises it from `push`.
 */
export class SyncConflictError extends Error {
  constructor(message = "The remote advanced since the last pull.") {
    super(message);
    this.name = "SyncConflictError";
  }
}

/**
 * Raised by the SAFETY GUARD (spec 013 remediation): applying this pull would
 * remove a large share of the device's records — the remote was probably reset,
 * emptied, or replaced by a stale/small backup. The engine throws this BEFORE any
 * push or local write, so both the remote and local data are left byte-identical:
 * the surprise mass-deletion is surfaced for the user to confirm rather than
 * silently applied. Re-run with `force: true` to apply it deliberately. It carries
 * the counts so the UI can explain exactly what it prevented.
 */
export class SyncGuardError extends Error {
  readonly localCount: number;
  readonly removedCount: number;
  constructor(localCount: number, removedCount: number) {
    super(`Sync would remove ${removedCount} of ${localCount} local records; blocked pending confirmation.`);
    this.name = "SyncGuardError";
    this.localCount = localCount;
    this.removedCount = removedCount;
  }
}

/**
 * A git remote holding the one portable file. `version` is an opaque token (a git
 * blob SHA for GitHub) that pins the copy we pulled; `push` asserts it so a racing
 * device's write can't be silently clobbered — on mismatch it throws
 * SyncConflictError. Provider-agnostic on purpose (Constitution: zero lock-in).
 */
export interface SyncRemote {
  readonly name: string;
  /** Current file text + version, or null content when the file doesn't exist. */
  pull(): Promise<{ content: string | null; version: string | null }>;
  /** Write the file, requiring the remote is still at `expectedVersion`. */
  push(content: string, message: string, expectedVersion: string | null): Promise<void>;
}

/** Records added / updated / removed by a merge, for the user-facing report (FR-016). */
export interface SyncCounts {
  added: number;
  updated: number;
  removed: number;
}

export interface SyncResult {
  visits: SyncCounts;
  trips: SyncCounts;
  stories: SyncCounts;
  total: SyncCounts;
  /** True when the remote had no file yet and this run seeded it. */
  createdRemote: boolean;
}

export interface SyncPorts {
  /** Local data right now (records + tombstones per collection). */
  localSnapshots: StoreSnapshots;
  /** The git remote. */
  remote: SyncRemote;
  /**
   * Parse a pulled portable file's text into snapshots. MUST validate + sanitize
   * exactly as a manual import does (inert data) and throw on invalid content, so
   * a malformed/hostile file aborts the sync instead of corrupting local data
   * (FR-013). Wired from the existing import path by the caller.
   */
  parse: (text: string) => StoreSnapshots;
  /** Serialize merged snapshots back to the canonical portable file text. */
  serialize: (merged: StoreSnapshots) => string;
  /** Persist the merged result locally in one transaction (FR-015). */
  persist: (merged: StoreSnapshots) => Promise<void>;
  /** Commit message for the push. */
  message?: string;
  /** Injectable clock (tests). */
  now?: () => Date;
  /** How many times to re-pull/re-merge on a push race before giving up. */
  maxRetries?: number;
  /** Tombstones older than this many days may be retired at the sync point (FR-011). */
  gcHorizonDays?: number;
  /**
   * Safety guard against a surprise mass-deletion. Called with the total local
   * record count and how many of them this merge would remove, BEFORE any push or
   * local write. Return true to ABORT with a SyncGuardError (leaving remote + local
   * untouched) so the user can confirm; false to proceed. Skipped entirely when
   * `force` is set. Kept as an injected predicate so the threshold lives with the
   * caller and the engine stays policy-free + easy to unit-test.
   */
  guard?: (info: { local: number; removed: number }) => boolean;
  /** Bypass `guard` for a deliberate, user-confirmed "apply anyway" run. */
  force?: boolean;
}

const DEFAULT_MESSAGE = "Sync Postcards via device sync";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_GC_HORIZON_DAYS = 90;

const ts = <R extends { updatedAt?: string; addedAt: string }>(r: R): string => r.updatedAt ?? r.addedAt;

/**
 * One visit per place (FR-015), across devices too: two devices that marked the
 * same place before syncing hold two visitIds for it, which a merge by id keeps
 * both of. Keep the newest (ties by visitId, so every device picks the same one),
 * join the others' photos onto it, and tombstone the others as of their own
 * stamp so they stay deleted wherever they are still held.
 */
function onePerPlace(snap: SyncSnapshot<Visit>): SyncSnapshot<Visit> {
  const byPlace = new Map<string, Visit[]>();
  for (const v of snap.records) {
    const k = placeKey(v.place);
    byPlace.set(k, [...(byPlace.get(k) ?? []), v]);
  }
  if (byPlace.size === snap.records.length) return snap;
  const records: Visit[] = [];
  const tombstones = [...snap.tombstones];
  for (const group of byPlace.values()) {
    group.sort((a, b) => ts(b).localeCompare(ts(a)) || a.visitId.localeCompare(b.visitId));
    const [kept, ...rest] = group as [Visit, ...Visit[]];
    if (!rest.length) {
      records.push(kept);
      continue;
    }
    const photos = [...(kept.photos ?? [])];
    for (const v of rest) {
      for (const p of v.photos ?? []) if (!photos.some((q) => q.src === p.src)) photos.push(p);
      tombstones.push({ id: v.visitId, deletedAt: ts(v) });
    }
    records.push(photos.length ? { ...kept, photos: photos.slice(0, MAX_PHOTOS_PER_VISIT) } : kept);
  }
  records.sort((x, y) => x.visitId.localeCompare(y.visitId));
  tombstones.sort((x, y) => x.id.localeCompare(y.id));
  return { records, tombstones };
}

/** Merge every collection newest-wins, honouring tombstones (reuses ./merge). */
function mergeAll(local: StoreSnapshots, remote: StoreSnapshots): StoreSnapshots {
  return {
    visits: onePerPlace(mergeById(local.visits, remote.visits, (v) => v.visitId, ts)),
    trips: mergeById(local.trips, remote.trips, (t) => t.tripId, ts),
    stories: mergeById(local.stories, remote.stories, (s) => s.storyId, ts),
  };
}

/** Retire tombstones older than the horizon across every collection (FR-011). */
function gcAll(s: StoreSnapshots, horizonIso: string): StoreSnapshots {
  return {
    visits: gcTombstones(s.visits, horizonIso),
    trips: gcTombstones(s.trips, horizonIso),
    stories: gcTombstones(s.stories, horizonIso),
  };
}

/** Deterministic string form of a snapshot set (records + tombstones sorted by id,
 *  keys sorted), independent of file metadata like exportedAt — used to detect
 *  "nothing to push". */
function canonical(s: StoreSnapshots): string {
  const sortSnap = <R>(snap: SyncSnapshot<R>, idOf: (r: R) => string): SyncSnapshot<R> => ({
    records: [...snap.records].sort((a, b) => idOf(a).localeCompare(idOf(b))),
    tombstones: [...snap.tombstones].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return canonicalJson({
    visits: sortSnap(s.visits, (v) => v.visitId),
    trips: sortSnap(s.trips, (t) => t.tripId),
    stories: sortSnap(s.stories, (s2) => s2.storyId),
  });
}

function countChanges<R>(before: R[], after: R[], idOf: (r: R) => string): SyncCounts {
  const b = new Map(before.map((r) => [idOf(r), r]));
  const a = new Map(after.map((r) => [idOf(r), r]));
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [id, r] of a) {
    const prev = b.get(id);
    if (prev === undefined) added++;
    else if (JSON.stringify(prev) !== JSON.stringify(r)) updated++;
  }
  for (const id of b.keys()) if (!a.has(id)) removed++;
  return { added, updated, removed };
}

function sumCounts(...parts: SyncCounts[]): SyncCounts {
  return parts.reduce(
    (acc, c) => ({
      added: acc.added + c.added,
      updated: acc.updated + c.updated,
      removed: acc.removed + c.removed,
    }),
    { added: 0, updated: 0, removed: 0 },
  );
}

/**
 * Run one full sync: pull → merge → write local → push, retrying on a push race.
 * Local data is written only AFTER a successful push, so a failed sync (no network,
 * auth denied) leaves local byte-identical to its prior state (FR-015 / SC-008).
 */
export async function syncOnce(ports: SyncPorts): Promise<SyncResult> {
  const {
    localSnapshots: local,
    remote,
    parse,
    serialize,
    persist,
    message = DEFAULT_MESSAGE,
  } = ports;
  const now = ports.now?.() ?? new Date();
  const maxRetries = ports.maxRetries ?? DEFAULT_MAX_RETRIES;
  const gcDays = ports.gcHorizonDays ?? DEFAULT_GC_HORIZON_DAYS;
  const horizonIso = new Date(now.getTime() - gcDays * 24 * 60 * 60 * 1000).toISOString();

  let pulled = await remote.pull();
  let createdRemote = pulled.content == null;
  let merged: StoreSnapshots;
  let attempt = 0;

  for (;;) {
    // A malformed/hostile pulled file throws here (parse validates+sanitizes) and
    // aborts the run before any local write — local data is never corrupted.
    const remoteSnap = pulled.content == null ? emptySnapshots() : parse(pulled.content);
    merged = gcAll(mergeAll(local, remoteSnap), horizonIso);

    // SAFETY GUARD (checked before BOTH the push and the "nothing to push" break,
    // since persist runs either way): if this merge would wipe a large share of
    // local records, throw before touching remote or local so nothing is lost by
    // surprise. `force` bypasses it for a confirmed re-run.
    if (!ports.force && ports.guard) {
      const removed =
        countChanges(local.visits.records, merged.visits.records, (v) => v.visitId).removed +
        countChanges(local.trips.records, merged.trips.records, (t) => t.tripId).removed +
        countChanges(local.stories.records, merged.stories.records, (s) => s.storyId).removed;
      const localTotal =
        local.visits.records.length + local.trips.records.length + local.stories.records.length;
      if (ports.guard({ local: localTotal, removed })) throw new SyncGuardError(localTotal, removed);
    }

    // If the remote already holds the converged set, there is nothing to push —
    // idempotent re-sync is a genuine no-op (SC-005). Compared as the file would
    // read back once pushed: the import cleans text up, so a local copy it would
    // change is the same record, not a new one to push on every run.
    const text = serialize(merged);
    if (pulled.content != null && canonical(parse(text)) === canonical(remoteSnap)) break;

    try {
      await remote.push(text, message, pulled.version);
      break;
    } catch (err) {
      if (err instanceof SyncConflictError && attempt < maxRetries) {
        attempt++;
        pulled = await remote.pull();
        createdRemote = false;
        continue;
      }
      throw err; // network/auth/other, or retries exhausted — local left untouched
    }
  }

  await persist(merged);

  const visits = countChanges(local.visits.records, merged.visits.records, (v) => v.visitId);
  const trips = countChanges(local.trips.records, merged.trips.records, (t) => t.tripId);
  const stories = countChanges(local.stories.records, merged.stories.records, (s) => s.storyId);
  return { visits, trips, stories, total: sumCounts(visits, trips, stories), createdRemote };
}

/**
 * Adapt a GitHubTarget (the connector shared with Publish mode) to `SyncRemote`,
 * translating its GitPushConflictError into the engine's SyncConflictError so the
 * retry loop stays provider-agnostic.
 */
export function gitHubSyncRemote(target: GitHubTarget, path: string): SyncRemote {
  return {
    name: target.name,
    async pull() {
      const file = await target.getFile(path);
      return file ? { content: file.content, version: file.version } : { content: null, version: null };
    },
    async push(content, message, expectedVersion) {
      try {
        await target.putFileConditional(path, content, message, expectedVersion);
      } catch (err) {
        if (err instanceof GitPushConflictError) throw new SyncConflictError(err.message);
        throw err;
      }
    },
  };
}

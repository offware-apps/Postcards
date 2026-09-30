// One reusable device-sync RUN (spec 013), shared by the manual "Sync now" button
// and background auto-sync so both go through the exact same convergent path.
//
// It gathers local data from the stores + the tombstone table, wires the validated
// /sanitized import as the pull parser (inert data — a hostile file aborts the run,
// never executes), calls the conflict-free `syncOnce` engine, applies the safety
// guard, and records a transparent outcome in the on-device sync log. The heavy
// bits (Zod codec, engine, git connector) are imported ON DEMAND so none of this
// touches the app's boot chunk — auto-sync only pays for them when it actually runs.
//
// SECURITY: the token is read from on-device config and handed only to the git
// connector. `serialize` builds the portable file from records + tombstones only —
// the token is NEVER part of it — so it can't leak into the pushed file or a backup.

import { normalizeVisitPhotos, backfillUpdatedAt, stampDeletion } from "../schema/helpers";
import type { SyncTombstone } from "../schema/models";
import {
  getAllTombstones,
  replaceAllPortable,
  type TombstoneRecord,
  type TombstoneKind,
} from "../db/visitsDb";
import { useVisits } from "../store/useVisits";
import { useTrips } from "../store/useTrips";
import { sortStories, useStories } from "../store/useStories";
import { useSyncStatus } from "../store/useSyncStatus";
import type { StoreSnapshots, SyncResult } from "./engine";
import { mergeById, type SyncSnapshot } from "./merge";
import { markApplyingSync } from "./applyMark";
import { SYNC_PATH, shouldGuardRemoval, type RemoteConfig } from "./syncConfig";

const kinds: TombstoneKind[] = ["visit", "trip", "story"];

/** Project a tombstone list to the {id, deletedAt} pairs for ONE kind. */
const partitionTombs = (list: SyncTombstone[], kind: TombstoneKind) =>
  list.filter((t) => t.kind === kind).map(({ id, deletedAt }) => ({ id, deletedAt }));

/** The snapshot (records + tombstones) for one kind out of a merged set. */
const snapFor = (merged: StoreSnapshots, kind: TombstoneKind) =>
  kind === "visit" ? merged.visits : kind === "trip" ? merged.trips : merged.stories;

/**
 * Fold the edits made WHILE a run was in flight onto its merged result. The run
 * merged a snapshot of the store taken before its pull, so a record added, edited
 * or deleted since would otherwise be overwritten by that older copy. Store writes
 * are immutable, so a record edited since is a new object; one gone from the store
 * was deleted here and gets a tombstone as of now. Newest still wins.
 */
function withEditsSince<R extends { updatedAt?: string; addedAt: string }>(
  merged: SyncSnapshot<R>,
  snapshot: R[],
  current: R[],
  idOf: (r: R) => string,
): SyncSnapshot<R> {
  if (current === snapshot) return merged;
  const before = new Map(snapshot.map((r) => [idOf(r), r]));
  const now = new Set(current.map(idOf));
  const edited = current.filter((r) => before.get(idOf(r)) !== r);
  const deleted = snapshot
    .filter((r) => !now.has(idOf(r)))
    .map((r) => ({ id: idOf(r), deletedAt: stampDeletion(r) }));
  return mergeById(
    merged,
    { records: edited, tombstones: deleted },
    idOf,
    (r) => r.updatedAt ?? r.addedAt,
  );
}

/** The result of one run — a discriminated union so callers branch without relying
 *  on thrown control-flow. `blocked` is the safety guard; `error` carries an i18n
 *  code (see `sync.log.*`) so messages localise at render time. */
export type SyncOutcome =
  | { ok: true; result: SyncResult }
  | { ok: false; kind: "blocked"; local: number; removed: number }
  | { ok: false; kind: "error"; code: string };

export interface RunSyncOptions {
  /** Bypass the safety guard for a deliberate, user-confirmed "apply anyway" run. */
  force?: boolean;
  /** Injectable clock (tests). */
  now?: () => Date;
}

/** Map a thrown error to a stable i18n code for the log + status line, so the user
 *  always gets a distinct, clear reason (auth / network / push-race / bad file). */
function classifyError(
  err: unknown,
  isConflict: (e: unknown) => boolean,
): "auth" | "network" | "race" | "malformed" | "failed" {
  if (isConflict(err)) return "race";
  const msg = err instanceof Error ? err.message : String(err);
  if (/\(401\)|\(403\)|token'?s? scope|unauthor|forbidden/i.test(msg)) return "auth";
  if (
    /not valid JSON|does not look like a Postcards|Invalid data|too large to import|newer version/i.test(
      msg,
    )
  ) {
    return "malformed";
  }
  if (
    err instanceof TypeError ||
    /failed to fetch|network|load failed|connection|ecconn|timed? out|offline/i.test(msg)
  ) {
    return "network";
  }
  return "failed";
}

/**
 * Run one sync against the configured remote. Never rejects for an EXPECTED
 * condition (blocked / auth / network / race / bad file) — those come back as a
 * typed `SyncOutcome` and are recorded in the log; only a genuinely unexpected bug
 * would throw, which the auto-sync scheduler still swallows. A failed run leaves
 * local data byte-identical (the engine persists only after a successful push).
 */
export async function runDeviceSync(
  cfg: RemoteConfig,
  options: RunSyncOptions = {},
): Promise<SyncOutcome> {
  const status = useSyncStatus.getState();
  status.setBusy(true);
  try {
    // On-demand: keep the Zod codec + engine + connector off the boot path.
    const [{ importFile }, { serializeFile }, { GitHubTarget }, engine] = await Promise.all([
      import("../../features/backup/importJson"),
      import("../../features/backup/exportJson"),
      import("../publish/gitTarget"),
      import("./engine"),
    ]);

    // A store still loading reads as empty, and persist would write that over the
    // device: "Sync now" can be pressed before the startup read is done (auto-sync
    // waits for it), so finish loading first.
    await Promise.all(
      [useVisits, useTrips, useStories].map((s) => !s.getState().loaded && s.getState().load()),
    );

    const localTombs = await getAllTombstones();
    const pickTombs = (kind: TombstoneKind) => partitionTombs(localTombs, kind);

    const local: StoreSnapshots = {
      visits: { records: useVisits.getState().visits, tombstones: pickTombs("visit") },
      trips: { records: useTrips.getState().trips, tombstones: pickTombs("trip") },
      stories: { records: useStories.getState().stories, tombstones: pickTombs("story") },
    };

    // Validate + sanitize the pulled file exactly as a manual import does (inert;
    // never executed) — a malformed/hostile file throws and aborts the sync.
    const parse = (text: string): StoreSnapshots => {
      const r = importFile(text);
      if (!r.ok) throw new Error(r.error);
      const partition = (kind: TombstoneKind) => partitionTombs(r.tombstones, kind);
      return {
        visits: { records: r.visits.map(backfillUpdatedAt), tombstones: partition("visit") },
        trips: { records: r.trips.map(backfillUpdatedAt), tombstones: partition("trip") },
        stories: { records: r.stories.map(backfillUpdatedAt), tombstones: partition("story") },
      };
    };

    // The token is NOT part of the serialized file — only records + tombstones.
    const serialize = (merged: StoreSnapshots): string => {
      const tombs: SyncTombstone[] = kinds.flatMap((kind) => {
        const snap = snapFor(merged, kind);
        return snap.tombstones.map((t) => ({ kind, id: t.id, deletedAt: t.deletedAt }));
      });
      return serializeFile(
        merged.visits.records,
        merged.trips.records,
        merged.stories.records,
        new Date(),
        tombs,
      );
    };

    const persist = async (merged: StoreSnapshots): Promise<void> => {
      // The user kept editing while the pull and push ran: keep those edits. They
      // are pushed by the next run, which auto-sync schedules for any edit.
      const withEdits = (): StoreSnapshots => ({
        visits: withEditsSince(
          merged.visits,
          local.visits.records,
          useVisits.getState().visits,
          (v) => v.visitId,
        ),
        trips: withEditsSince(
          merged.trips,
          local.trips.records,
          useTrips.getState().trips,
          (t) => t.tripId,
        ),
        stories: withEditsSince(
          merged.stories,
          local.stories.records,
          useStories.getState().stories,
          (s) => s.storyId,
        ),
      });
      const onDisk = withEdits();
      const records: TombstoneRecord[] = kinds.flatMap((kind) => {
        const snap = snapFor(onDisk, kind);
        return snap.tombstones.map((t) => ({
          key: `${kind}:${t.id}`,
          kind,
          id: t.id,
          deletedAt: t.deletedAt,
        }));
      });
      // Records AND tombstones in one transaction (FR-015).
      await replaceAllPortable(
        onDisk.visits.records,
        onDisk.trips.records,
        onDisk.stories.records,
        records,
      );
      // An edit made during that write lands in IndexedDB in its own, later
      // transaction; fold it into memory too.
      const inMemory = withEdits();
      // Bracket the store writes so auto-sync's own subscribers ignore them and
      // don't mistake a persisted pull for a fresh local edit (would loop forever).
      markApplyingSync(() => {
        useVisits.setState({
          visits: inMemory.visits.records.map(normalizeVisitPhotos).map(backfillUpdatedAt),
        });
        useTrips.setState({ trips: inMemory.trips.records.map(backfillUpdatedAt) });
        useStories.setState({
          stories: sortStories(inMemory.stories.records.map(backfillUpdatedAt)),
        });
      });
    };

    const target = new GitHubTarget({
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      token: cfg.token,
    });
    const remote = engine.gitHubSyncRemote(target, SYNC_PATH);

    try {
      const result = await engine.syncOnce({
        localSnapshots: local,
        remote,
        parse,
        serialize,
        persist,
        now: options.now,
        force: options.force,
        guard: shouldGuardRemoval,
      });

      // Log only MEANINGFUL runs, so background auto-sync's frequent no-op pulls
      // never flood the 10-entry history and hide the runs that actually changed data.
      const changed =
        result.total.added > 0 || result.total.updated > 0 || result.total.removed > 0;
      if (result.createdRemote) {
        status.record({ at: new Date().toISOString(), status: "ok", code: "created" });
      } else if (changed) {
        status.record({
          at: new Date().toISOString(),
          status: "ok",
          code: "changed",
          params: {
            added: result.total.added,
            updated: result.total.updated,
            removed: result.total.removed,
          },
        });
      }
      status.markSynced(new Date().toISOString());
      return { ok: true, result };
    } catch (err) {
      if (err instanceof engine.SyncGuardError) {
        status.record({
          at: new Date().toISOString(),
          status: "blocked",
          code: "blocked",
          params: { local: err.localCount, removed: err.removedCount },
        });
        return { ok: false, kind: "blocked", local: err.localCount, removed: err.removedCount };
      }
      const code = classifyError(err, (e) => e instanceof engine.SyncConflictError);
      status.record({ at: new Date().toISOString(), status: "error", code });
      return { ok: false, kind: "error", code };
    }
  } catch (err) {
    // Failure BEFORE the engine ran (e.g. the dynamic import or GitHubTarget
    // constructor). Still leaves local data untouched; record a generic reason.
    const code =
      err instanceof Error && /owner, repo, branch/i.test(err.message) ? "auth" : "failed";
    status.record({ at: new Date().toISOString(), status: "error", code });
    return { ok: false, kind: "error", code };
  } finally {
    status.setBusy(false);
  }
}

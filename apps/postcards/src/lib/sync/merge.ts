// Record-level convergent merge for device sync (spec 013).
//
// Two devices each hold the portable data (visits, trips, stories). To sync
// without a server we merge at the RECORD level — never whole-file — so
// concurrent edits on a phone and a laptop converge instead of one clobbering
// the other. Each record is kept by NEWEST timestamp (updatedAt, falling back to
// addedAt); deletions are represented as TOMBSTONES so a delete on one device
// isn't resurrected by the other's stale copy.
//
// The merge is DETERMINISTIC, COMMUTATIVE (merge(a,b) == merge(b,a)) and
// IDEMPOTENT (merge(a,a) == a) — the properties that make eventual convergence
// safe regardless of sync order. Pure, no I/O — unit-tested.

export interface Tombstone {
  id: string;
  /** ISO timestamp of the deletion. */
  deletedAt: string;
}

export interface SyncSnapshot<R> {
  records: R[];
  tombstones: Tombstone[];
}

/**
 * JSON with every object's keys sorted, so two copies of the same record compare
 * equal however their keys were ordered (an edit appends keys; a parsed file has
 * the schema's order).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Timestamp used to order two versions of the same record. */
function stamp<R>(r: R, tsOf: (r: R) => string | null | undefined): string {
  return tsOf(r) ?? "";
}

/**
 * Pick the winner between two versions of the SAME record. Newest wins; on an
 * exact timestamp tie we break deterministically by the canonical JSON, so
 * the outcome never depends on argument order (commutativity).
 */
function pick<R>(a: R, b: R, tsOf: (r: R) => string | null | undefined): R {
  const ta = stamp(a, tsOf);
  const tb = stamp(b, tsOf);
  if (ta > tb) return a;
  if (tb > ta) return b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

/**
 * Merge two snapshots of the same record type. `idOf` extracts the stable key,
 * `tsOf` the ordering timestamp. Returns a new snapshot; inputs are untouched.
 */
export function mergeById<R>(
  a: SyncSnapshot<R>,
  b: SyncSnapshot<R>,
  idOf: (r: R) => string,
  tsOf: (r: R) => string | null | undefined,
): SyncSnapshot<R> {
  // Latest deletion per id (union, keeping the newest deletedAt).
  const tombs = new Map<string, string>();
  for (const t of [...a.tombstones, ...b.tombstones]) {
    const cur = tombs.get(t.id);
    if (!cur || t.deletedAt > cur) tombs.set(t.id, t.deletedAt);
  }

  // Newest record per id across both snapshots.
  const byId = new Map<string, R>();
  for (const r of [...a.records, ...b.records]) {
    const id = idOf(r);
    const cur = byId.get(id);
    byId.set(id, cur === undefined ? r : pick(cur, r, tsOf));
  }

  // A record survives only if no tombstone is at-or-after its timestamp (a delete
  // that happened after the last edit wins; an edit strictly newer than a delete
  // revives the record — an explicit re-add).
  const records: R[] = [];
  for (const [id, r] of byId) {
    const del = tombs.get(id);
    if (del !== undefined && del >= stamp(r, tsOf)) continue;
    records.push(r);
  }
  // Stable output order by id so the merge result is fully deterministic.
  records.sort((x, y) => idOf(x).localeCompare(idOf(y)));

  const tombstones: Tombstone[] = [...tombs.entries()]
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .sort((x, y) => x.id.localeCompare(y.id));

  return { records, tombstones };
}

/**
 * Drop tombstones older than `horizonIso` — but ONLY the ones no longer needed.
 * A tombstone can be forgotten once every device is guaranteed to have seen the
 * deletion; callers pass a conservative horizon (e.g. 90 days) so a device that
 * has been offline a long time can't resurrect a deleted record. Kept simple and
 * caller-driven on purpose (constitution: no clever server-side coordination).
 */
export function gcTombstones<R>(snap: SyncSnapshot<R>, horizonIso: string): SyncSnapshot<R> {
  return {
    records: snap.records,
    tombstones: snap.tombstones.filter((t) => t.deletedAt >= horizonIso),
  };
}

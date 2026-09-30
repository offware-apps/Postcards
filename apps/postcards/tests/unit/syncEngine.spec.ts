import { describe, it, expect } from "vitest";
import { importFile } from "../../src/features/backup/importJson";
import { serializeFile } from "../../src/features/backup/exportJson";
import { backfillUpdatedAt } from "../../src/lib/schema/helpers";
import type { SyncTombstone, Visit } from "../../src/lib/schema/models";
import {
  syncOnce,
  emptySnapshots,
  SyncConflictError,
  SyncGuardError,
  type StoreSnapshots,
  type SyncRemote,
} from "../../src/lib/sync/engine";

// End-to-end device-sync tests through the REAL portable-file codec (export +
// validated/sanitized import), against an in-memory git remote. This exercises the
// pull → merge → push cycle, tombstones and the push-race retry — no network.

/** A minimal git remote in memory: `version` is the opaque token, bumped per push;
 *  a push whose expectedVersion is stale throws, exactly like a non-fast-forward. */
class MemoryRemote implements SyncRemote {
  readonly name = "memory";
  content: string | null = null;
  version = 0;
  pushes = 0;

  private token(): string | null {
    return this.content == null ? null : String(this.version);
  }

  async pull() {
    return { content: this.content, version: this.token() };
  }

  async push(content: string, _message: string, expectedVersion: string | null): Promise<void> {
    if (this.token() !== expectedVersion) throw new SyncConflictError();
    this.content = content;
    this.version += 1;
    this.pushes += 1;
  }
}

const part = (tombs: SyncTombstone[], kind: SyncTombstone["kind"]) =>
  tombs.filter((t) => t.kind === kind).map(({ id, deletedAt }) => ({ id, deletedAt }));

function parse(text: string): StoreSnapshots {
  const r = importFile(text);
  if (!r.ok) throw new Error(r.error);
  return {
    visits: { records: r.visits.map(backfillUpdatedAt), tombstones: part(r.tombstones, "visit") },
    trips: { records: r.trips.map(backfillUpdatedAt), tombstones: part(r.tombstones, "trip") },
    stories: { records: r.stories.map(backfillUpdatedAt), tombstones: part(r.tombstones, "story") },
  };
}

function serialize(m: StoreSnapshots): string {
  const tombs: SyncTombstone[] = [
    ...m.visits.tombstones.map((t) => ({ kind: "visit" as const, id: t.id, deletedAt: t.deletedAt })),
    ...m.trips.tombstones.map((t) => ({ kind: "trip" as const, id: t.id, deletedAt: t.deletedAt })),
    ...m.stories.tombstones.map((t) => ({ kind: "story" as const, id: t.id, deletedAt: t.deletedAt })),
  ];
  return serializeFile(m.visits.records, m.trips.records, m.stories.records, new Date(), tombs);
}

// A fixed "now" AFTER every fixture timestamp, so the 90-day tombstone-retirement
// horizon is deterministic (independent of the wall clock the tests run on).
const NOW = "2026-03-15T00:00:00.000Z";

/** Run one sync for a device holding `local`, capturing what it persists. */
async function sync(local: StoreSnapshots, remote: MemoryRemote) {
  let persisted: StoreSnapshots = emptySnapshots();
  const result = await syncOnce({
    localSnapshots: local,
    remote,
    parse,
    serialize,
    persist: async (m) => {
      persisted = m;
    },
    now: () => new Date(NOW),
  });
  return { result, persisted };
}

/** A distinct visit — distinct place so the import's one-per-place rule never merges two. */
function visit(id: string, updatedAt: string, note: string | null = null): Visit {
  return {
    visitId: id,
    place: { kind: "city", id: `${id}-place`, name: `Place ${id}`, countryId: "FR" },
    status: "visited",
    favorite: false,
    date: null,
    note,
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

const visits = (...v: Visit[]): StoreSnapshots => ({
  visits: { records: v, tombstones: [] },
  trips: { records: [], tombstones: [] },
  stories: { records: [], tombstones: [] },
});

/** Order-independent identity of a converged state (sorted records + tombstones). */
function canonical(s: StoreSnapshots): string {
  const ids = s.visits.records.map((v) => v.visitId).sort();
  return JSON.stringify({
    visitIds: ids,
    records: [...s.visits.records].sort((a, b) => a.visitId.localeCompare(b.visitId)),
    tombstones: [...s.visits.tombstones].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

describe("syncOnce (git-mode device sync)", () => {
  it("two devices' divergent edits converge after a round-trip (SC-001/SC-002)", async () => {
    const remote = new MemoryRemote();
    const a1 = await sync(visits(visit("a", "2026-02-01T00:00:00.000Z")), remote); // seeds remote
    expect(a1.result.createdRemote).toBe(true);

    const b1 = await sync(visits(visit("b", "2026-02-02T00:00:00.000Z")), remote);
    // B pulled A's record and added its own.
    expect(b1.persisted.visits.records.map((v) => v.visitId).sort()).toEqual(["a", "b"]);

    // A re-syncs (still only knows "a") and now sees "b" too.
    const a2 = await sync(visits(visit("a", "2026-02-01T00:00:00.000Z")), remote);
    expect(a2.persisted.visits.records.map((v) => v.visitId).sort()).toEqual(["a", "b"]);

    // Both devices reached the identical converged state.
    expect(canonical(a2.persisted)).toBe(canonical(b1.persisted));
  });

  it("keeps the newer edit when the same record changed on both devices (FR-005)", async () => {
    const remote = new MemoryRemote();
    await sync(visits(visit("c", "2026-01-01T00:00:00.000Z", "orig")), remote); // seed

    // A edits at T1, B edits the same record at the later T2.
    await sync(visits(visit("c", "2026-02-01T00:00:00.000Z", "from A")), remote);
    const b = await sync(visits(visit("c", "2026-03-01T00:00:00.000Z", "from B")), remote);
    // Re-sync A: it must converge to the newest (B's) version.
    const a = await sync(visits(visit("c", "2026-02-01T00:00:00.000Z", "from A")), remote);

    expect(a.persisted.visits.records[0]!.note).toBe("from B");
    expect(b.persisted.visits.records[0]!.note).toBe("from B");
  });

  it("a deletion propagates and stays deleted across further syncs (SC-004)", async () => {
    const remote = new MemoryRemote();
    await sync(visits(visit("x", "2026-01-01T00:00:00.000Z")), remote); // seed the record
    const b = await sync(visits(visit("x", "2026-01-01T00:00:00.000Z")), remote); // B has it
    expect(b.persisted.visits.records.map((v) => v.visitId)).toEqual(["x"]);

    // A deletes it (record gone + tombstone), then syncs.
    const aDeleted: StoreSnapshots = {
      visits: { records: [], tombstones: [{ id: "x", deletedAt: "2026-02-01T00:00:00.000Z" }] },
      trips: { records: [], tombstones: [] },
      stories: { records: [], tombstones: [] },
    };
    await sync(aDeleted, remote);

    // B (still holding the record) syncs → the record is removed.
    const b2 = await sync(visits(visit("x", "2026-01-01T00:00:00.000Z")), remote);
    expect(b2.persisted.visits.records).toEqual([]);
    expect(b2.result.visits.removed).toBe(1);

    // And it does not come back on a second round.
    const b3 = await sync(b2.persisted, remote);
    expect(b3.persisted.visits.records).toEqual([]);
  });

  it("re-syncing already-converged data is a no-op (SC-005): 0 changes, no push", async () => {
    const remote = new MemoryRemote();
    const seeded = await sync(visits(visit("n", "2026-01-01T00:00:00.000Z")), remote);
    const pushesAfterSeed = remote.pushes;

    const again = await sync(seeded.persisted, remote);
    expect(again.result.total).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(remote.pushes).toBe(pushesAfterSeed); // nothing to push
  });

  it("recovers from a push race by re-pulling and re-merging (FR-012)", async () => {
    // A remote that lets a competitor land once, mid-push, forcing a non-fast-forward.
    class RacingRemote extends MemoryRemote {
      raceContent: string | null = null;
      private raced = false;
      override async push(content: string, message: string, expected: string | null): Promise<void> {
        if (!this.raced && this.raceContent != null) {
          this.raced = true;
          // The competitor's write lands first...
          this.content = this.raceContent;
          this.version += 1;
          throw new SyncConflictError();
        }
        return super.push(content, message, expected);
      }
    }
    const remote = new RacingRemote();
    await sync(visits(visit("seed", "2026-01-01T00:00:00.000Z")), remote); // seed
    // Competitor has added record "comp"; it will land during our push.
    remote.raceContent = serialize(
      visits(visit("seed", "2026-01-01T00:00:00.000Z"), visit("comp", "2026-01-05T00:00:00.000Z")),
    );

    const mine = await sync(visits(visit("mine", "2026-01-06T00:00:00.000Z")), remote);
    // After the retry, our merge includes the seed, the competitor's and our own record.
    expect(mine.persisted.visits.records.map((v) => v.visitId).sort()).toEqual([
      "comp",
      "mine",
      "seed",
    ]);
  });

  it("rejects a malformed pulled file without touching local (SC-007)", async () => {
    const remote = new MemoryRemote();
    // Seed the remote with hostile, non-Postcards content.
    remote.content = "{ not json";
    remote.version = 1;
    await expect(sync(visits(visit("safe", "2026-01-01T00:00:00.000Z")), remote)).rejects.toThrow();
    // The remote was never overwritten (local push never happened).
    expect(remote.content).toBe("{ not json");
  });
});

describe("syncOnce safety guard (mass-deletion remediation)", () => {
  const T = "2026-02-01T00:00:00.000Z"; // record edit time
  const DEL = "2026-02-10T00:00:00.000Z"; // deletion time (after the edit, before NOW)

  /** A remote whose file was RESET to nothing but a tombstone for each id — the
   *  "remote was emptied/reset" scenario that would silently wipe local data. */
  function resetRemoteTombstoning(ids: string[]): MemoryRemote {
    const remote = new MemoryRemote();
    const reset: StoreSnapshots = {
      visits: { records: [], tombstones: ids.map((id) => ({ id, deletedAt: DEL })) },
      trips: { records: [], tombstones: [] },
      stories: { records: [], tombstones: [] },
    };
    remote.content = serialize(reset);
    remote.version = 1;
    return remote;
  }

  // Gate a pull that would remove more than half of local records.
  const gateHalf = (info: { local: number; removed: number }) =>
    info.removed > 0 && info.removed > info.local / 2;

  it("blocks a pull that would wipe a large share of local records (nothing written or pushed)", async () => {
    const remote = resetRemoteTombstoning(["v1", "v2", "v3", "v4"]);
    const local = visits(visit("v1", T), visit("v2", T), visit("v3", T), visit("v4", T));
    let persisted: StoreSnapshots | null = null;
    await expect(
      syncOnce({
        localSnapshots: local,
        remote,
        parse,
        serialize,
        persist: async (m) => {
          persisted = m;
        },
        now: () => new Date(NOW),
        guard: gateHalf,
      }),
    ).rejects.toBeInstanceOf(SyncGuardError);
    expect(persisted).toBeNull(); // local never touched
    expect(remote.pushes).toBe(0); // remote never overwritten
  });

  it("the guard error carries the exact counts it prevented", async () => {
    const remote = resetRemoteTombstoning(["v1", "v2", "v3", "v4"]);
    const local = visits(visit("v1", T), visit("v2", T), visit("v3", T), visit("v4", T));
    try {
      await syncOnce({
        localSnapshots: local,
        remote,
        parse,
        serialize,
        persist: async () => {},
        now: () => new Date(NOW),
        guard: gateHalf,
      });
      throw new Error("expected SyncGuardError");
    } catch (e) {
      expect(e).toBeInstanceOf(SyncGuardError);
      expect((e as SyncGuardError).localCount).toBe(4);
      expect((e as SyncGuardError).removedCount).toBe(4);
    }
  });

  it("force bypasses the guard and applies the deletion deliberately", async () => {
    const remote = resetRemoteTombstoning(["v1", "v2", "v3", "v4"]);
    const local = visits(visit("v1", T), visit("v2", T), visit("v3", T), visit("v4", T));
    let persisted: StoreSnapshots = emptySnapshots();
    const result = await syncOnce({
      localSnapshots: local,
      remote,
      parse,
      serialize,
      persist: async (m) => {
        persisted = m;
      },
      now: () => new Date(NOW),
      guard: gateHalf,
      force: true,
    });
    expect(persisted.visits.records).toEqual([]);
    expect(result.visits.removed).toBe(4);
  });

  it("does not gate a normal converging sync that removes nothing", async () => {
    const remote = new MemoryRemote();
    await sync(visits(visit("a", T)), remote); // seed (no guard)
    let persisted: StoreSnapshots = emptySnapshots();
    const result = await syncOnce({
      localSnapshots: visits(visit("b", "2026-02-05T00:00:00.000Z")),
      remote,
      parse,
      serialize,
      persist: async (m) => {
        persisted = m;
      },
      now: () => new Date(NOW),
      guard: gateHalf, // present, but no removal occurs → not triggered
    });
    expect(persisted.visits.records.map((v) => v.visitId).sort()).toEqual(["a", "b"]);
    expect(result.visits.removed).toBe(0);
  });
});

describe("the same place marked on two devices", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const PNG2 = PNG.replace("ggg==", "ggA=");
  const paris = (id: string, updatedAt: string, src: string, note: string | null): Visit => ({
    ...visit(id, updatedAt, note),
    place: { kind: "city", id: "2988507", name: "Paris", countryId: "FR" },
    photos: [{ src, caption: id }],
  });

  it("collapses into one record, the newest, with both galleries, on both devices", async () => {
    const remote = new MemoryRemote();
    const b = await sync(visits(paris("b", "2026-02-01T00:00:00.000Z", PNG, "from B")), remote);
    const a = await sync(visits(paris("a", "2026-02-02T00:00:00.000Z", PNG2, "from A")), remote);
    expect(a.persisted.visits.records).toHaveLength(1);
    const kept = a.persisted.visits.records[0]!;
    expect(kept.visitId).toBe("a");
    expect(kept.note).toBe("from A");
    expect(kept.photos!.map((p) => p.caption)).toEqual(["a", "b"]);
    expect(a.persisted.visits.tombstones.map((t) => t.id)).toEqual(["b"]);

    // B syncs again with what it holds and reaches the same state.
    const b2 = await sync(b.persisted, remote);
    expect(b2.persisted.visits).toEqual(a.persisted.visits);
  });
});

describe("a sync with nothing new to push", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const FR = { kind: "country" as const, id: "FR", name: "France", countryId: "FR" };
  const JP = { kind: "country" as const, id: "JP", name: "Japan", countryId: "JP" };

  it("does not push again a record whose keys sit in another order", async () => {
    const remote = new MemoryRemote();
    // An edit appends `folder` after the other keys; the parsed file has it before
    // `photos`, so the local copy wins the tie-break on its key order alone.
    const story = {
      storyId: "s1",
      place: FR,
      date: "2026-01-20",
      title: "Paris",
      text: "t",
      photos: [{ src: "data:image/png;base64,iVBORw0KGgo=", caption: null }],
      addedAt: at,
      updatedAt: at,
      folder: "Europe",
    };
    const local: StoreSnapshots = {
      ...emptySnapshots(),
      stories: { records: [story], tombstones: [] },
    };
    for (let i = 0; i < 3; i++) await sync(local, remote);
    expect(remote.pushes).toBe(1);
  });

  it("does not push again a text the import cleans up", async () => {
    const remote = new MemoryRemote();
    const trip = {
      tripId: "t1",
      from: FR,
      to: JP,
      mode: "flight" as const,
      date: null,
      carrier: null,
      note: "Bon voyage​!",
      addedAt: at,
      updatedAt: at,
    };
    const local: StoreSnapshots = {
      ...emptySnapshots(),
      trips: { records: [trip], tombstones: [] },
    };
    for (let i = 0; i < 3; i++) await sync(local, remote);
    expect(remote.pushes).toBe(1);
  });
});

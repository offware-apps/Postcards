import { describe, it, expect, vi, afterEach } from "vitest";
import {
  VisitSchema,
  PostcardsFileSchema,
  backfillUpdatedAt,
  type Visit,
  type PlaceRef,
  type SyncTombstone,
} from "../../src/lib/schema/models";
import { serializeFile } from "../../src/features/backup/exportJson";
import { importFile } from "../../src/features/backup/importJson";
import { useVisits } from "../../src/lib/store/useVisits";

// Phase A/B: the `updatedAt` stamp (newest-wins comparator) and file-level
// tombstones. Backward compatibility with pre-sync files is the load-bearing part.

function baseVisit(): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "country", id: "FR", name: "France", countryId: "FR" },
    status: "visited",
    favorite: false,
    date: null,
    note: null,
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("backfillUpdatedAt (migration)", () => {
  it("fills updatedAt from addedAt when absent", () => {
    const r = backfillUpdatedAt(baseVisit());
    expect(r.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves an existing updatedAt untouched (and does not mutate input)", () => {
    const input = { ...baseVisit(), updatedAt: "2026-05-05T00:00:00.000Z" };
    const r = backfillUpdatedAt(input);
    expect(r.updatedAt).toBe("2026-05-05T00:00:00.000Z");
    expect(r).toBe(input); // no-op returns the same reference
  });
});

describe("VisitSchema.updatedAt (additive, backward-compatible)", () => {
  it("still validates an older record that lacks updatedAt", () => {
    expect(VisitSchema.safeParse(baseVisit()).success).toBe(true);
  });

  it("accepts and preserves updatedAt when present", () => {
    const parsed = VisitSchema.parse({ ...baseVisit(), updatedAt: "2026-06-01T00:00:00.000Z" });
    expect(parsed.updatedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("does NOT inject updatedAt on parse (keeps the export round-trip intact)", () => {
    const parsed = VisitSchema.parse(baseVisit());
    expect(parsed.updatedAt).toBeUndefined();
  });
});

describe("portable file tombstones (device sync)", () => {
  it("a plain export writes no tombstones key and import reports none", () => {
    const text = serializeFile([baseVisit()]);
    expect(text).not.toContain("tombstones");
    const r = importFile(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tombstones).toEqual([]);
  });

  it("round-trips tombstones through export -> validated import", () => {
    const tombs: SyncTombstone[] = [
      { kind: "visit", id: "gone-1", deletedAt: "2026-02-01T00:00:00.000Z" },
      { kind: "story", id: "gone-2", deletedAt: "2026-03-01T00:00:00.000Z" },
    ];
    const text = serializeFile([baseVisit()], [], [], new Date(), tombs);
    const r = importFile(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tombstones).toEqual(tombs);
  });

  it("rejects a tombstone with an unknown kind (strict, inert)", () => {
    const r = PostcardsFileSchema.safeParse({
      format: "postcards",
      schemaVersion: 6,
      exportedAt: new Date().toISOString(),
      visits: [],
      tombstones: [{ kind: "planet", id: "x", deletedAt: new Date().toISOString() }],
    });
    expect(r.success).toBe(false);
  });
});

describe("store stamps updatedAt on mutation (addedAt stays immutable)", () => {
  afterEach(() => {
    vi.useRealTimers();
    useVisits.setState({ visits: [] });
  });

  const place: PlaceRef = { kind: "city", id: "lyon-fr", name: "Lyon", countryId: "FR" };

  it("addVisit sets updatedAt; toggleFavorite bumps it while addedAt holds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    useVisits.setState({ visits: [] });

    const added = await useVisits.getState().addVisit({ place });
    expect(added.updatedAt).toBe("2026-05-01T00:00:00.000Z");
    const addedAt = added.addedAt;

    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"));
    await useVisits.getState().toggleFavorite(place);
    const after = useVisits.getState().visits[0]!;
    expect(after.favorite).toBe(true);
    expect(after.updatedAt).toBe("2026-05-02T00:00:00.000Z"); // bumped
    expect(after.addedAt).toBe(addedAt); // never moves
  });
});

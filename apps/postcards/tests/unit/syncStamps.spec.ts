import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("idb", () => import("./fakeIdb"));
import { clearDatabases } from "./fakeIdb";
import * as db from "../../src/lib/db/visitsDb";
import { importFile } from "../../src/features/backup/importJson";
import { serializeFile } from "../../src/features/backup/exportJson";
import { mergeById } from "../../src/lib/sync/merge";
import { useVisits } from "../../src/lib/store/useVisits";
import { useTrips } from "../../src/lib/store/useTrips";
import type { Visit } from "../../src/lib/schema/models";

// The merge orders versions by comparing their ISO stamps as text; that holds
// only for UTC stamps, and a deletion must sort after the version it deletes.

(globalThis as { indexedDB?: unknown }).indexedDB = {};
const FR = { kind: "country" as const, id: "FR", name: "France", countryId: "FR" };
const visit = (note: string, updatedAt: string): Visit => ({
  visitId: "v1",
  place: FR,
  status: "visited",
  favorite: false,
  date: null,
  note,
  addedAt: "2024-01-01T00:00:00.000Z",
  updatedAt,
});
const ts = (v: { updatedAt?: string; addedAt: string }) => v.updatedAt ?? v.addedAt;
const imported = (v: Visit) => {
  const r = importFile(serializeFile([v]));
  if (!r.ok) throw new Error(r.error);
  return r.visits[0]!;
};

describe("stamps read from a file", () => {
  it("an offset stamp is read as UTC, so the newer edit wins", () => {
    // 12:00+09:00 is 03:00Z: two hours older than the local 05:00Z edit.
    const remote = imported(visit("remote, older", "2024-06-01T12:00:00+09:00"));
    expect(remote.updatedAt).toBe("2024-06-01T03:00:00.000Z");
    const local = visit("local, newer", "2024-06-01T05:00:00.000Z");
    const merged = mergeById(
      { records: [local], tombstones: [] },
      { records: [remote], tombstones: [] },
      (v) => v.visitId,
      ts,
    );
    expect(merged.records[0]!.note).toBe("local, newer");
  });

  it("a stamp far in the future is brought back to about now", () => {
    const v = imported(visit("from a file", "2999-01-01T00:00:00.000Z"));
    expect(Date.parse(v.updatedAt!)).toBeLessThan(Date.now() + 60 * 60 * 1000);
  });
});

describe("a deletion", () => {
  beforeEach(() => {
    clearDatabases();
    useVisits.setState({ visits: [], loaded: true });
    useTrips.setState({ trips: [], loaded: true });
  });

  it("wins over the version it deleted, stamped by a clock running ahead", async () => {
    const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // written by a fast device
    useVisits.setState({ visits: [visit("edited on a fast device", ahead)] });
    await useVisits.getState().removeVisit("v1");
    const tombs = (await db.getAllTombstones()).map(({ id, deletedAt }) => ({ id, deletedAt }));
    const merged = mergeById(
      { records: [], tombstones: tombs },
      { records: [visit("edited on a fast device", ahead)], tombstones: [] },
      (v) => v.visitId,
      ts,
    );
    expect(merged.records).toEqual([]);
  });

  it("of a trip wins the same way", async () => {
    const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const trip = {
      tripId: "t1",
      from: FR,
      to: FR,
      mode: "flight" as const,
      date: null,
      carrier: null,
      note: null,
      addedAt: ahead,
      updatedAt: ahead,
    };
    useTrips.setState({ trips: [trip] });
    await useTrips.getState().removeTrip("t1");
    const [tomb] = await db.getAllTombstones();
    expect(tomb!.deletedAt > ahead).toBe(true);
  });
});

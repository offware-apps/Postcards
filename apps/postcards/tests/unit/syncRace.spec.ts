import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("idb", () => import("./fakeIdb"));
const hooks: { duringPull?: () => Promise<void> } = {};
vi.mock("../../src/lib/publish/gitTarget", () => {
  class GitPushConflictError extends Error {}
  class GitHubTarget {
    name = "github";
    async getFile() {
      await hooks.duringPull?.();
      return null;
    }
    async putFileConditional() {}
  }
  return { GitHubTarget, GitPushConflictError };
});
import { clearDatabases } from "./fakeIdb";
import * as db from "../../src/lib/db/visitsDb";
import { useVisits } from "../../src/lib/store/useVisits";
import { useTrips } from "../../src/lib/store/useTrips";
import { runDeviceSync } from "../../src/lib/sync/runSync";

// A sync merges a snapshot of the stores taken before its pull; whatever the user
// does while the pull is in flight must survive the run, in memory and on disk.

(globalThis as { indexedDB?: unknown }).indexedDB = {};
const cfg = { owner: "o", repo: "r", branch: "main", token: "t" };
const place = (id: string) => ({ kind: "country" as const, id, name: id, countryId: id });
const ids = (list: { place: { id: string } }[]) => list.map((v) => v.place.id).sort();

describe("edits made while a sync is in flight", () => {
  beforeEach(() => {
    clearDatabases();
    useVisits.setState({ visits: [], loaded: true });
    useTrips.setState({ trips: [], loaded: true });
    hooks.duringPull = undefined;
  });

  it("a place added during the pull is kept", async () => {
    await useVisits.getState().addVisit({ place: place("FR") });
    hooks.duringPull = async () => {
      await useVisits.getState().addVisit({ place: place("JP") });
    };
    expect((await runDeviceSync(cfg)).ok).toBe(true);
    expect(ids(useVisits.getState().visits)).toEqual(["FR", "JP"]);
    expect(ids(await db.getAllVisits())).toEqual(["FR", "JP"]);
  });

  it("a place deleted during the pull stays deleted, with its tombstone", async () => {
    const fr = await useVisits.getState().addVisit({ place: place("FR") });
    hooks.duringPull = async () => {
      await useVisits.getState().removeVisit(fr.visitId);
    };
    await runDeviceSync(cfg);
    expect(useVisits.getState().visits).toEqual([]);
    expect(await db.getAllVisits()).toEqual([]);
    expect((await db.getAllTombstones()).map((t) => t.id)).toEqual([fr.visitId]);
  });

  it("an edit made during the pull is kept", async () => {
    const trip = await useTrips.getState().addTrip({ from: place("FR"), to: place("JP") });
    hooks.duringPull = async () => {
      await new Promise((r) => setTimeout(r, 2)); // a later updatedAt
      await useTrips.getState().updateTrip(trip.tripId, { note: "window seat" });
    };
    await runDeviceSync(cfg);
    expect(useTrips.getState().trips[0]!.note).toBe("window seat");
  });
});

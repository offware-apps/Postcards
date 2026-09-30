import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("idb", () => import("./fakeIdb"));
vi.mock("../../src/lib/publish/gitTarget", () => {
  class GitPushConflictError extends Error {}
  class GitHubTarget {
    name = "github";
    async getFile() {
      return null;
    }
    async putFileConditional() {}
  }
  return { GitHubTarget, GitPushConflictError };
});
import { clearDatabases, openDB } from "./fakeIdb";
import * as db from "../../src/lib/db/visitsDb";
import { useVisits } from "../../src/lib/store/useVisits";
import { useTrips } from "../../src/lib/store/useTrips";
import { useStories } from "../../src/lib/store/useStories";
import { followOtherTabs } from "../../src/lib/store/portable";
import { runDeviceSync } from "../../src/lib/sync/runSync";
import type { Visit } from "../../src/lib/schema/models";

// Two tabs share one database. "Another tab" here writes straight to it and says
// so on the channel the app listens to, as that tab's own stores would.

(globalThis as { indexedDB?: unknown }).indexedDB = {};

const place = (id: string): Visit => ({
  visitId: `v-${id}`,
  place: { kind: "country", id, name: id, countryId: id },
  status: "visited",
  favorite: false,
  date: null,
  note: null,
  addedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const otherTab = {
  async mark(v: Visit) {
    await (await openDB("postcards")).put("visits", v);
    new BroadcastChannel("postcards-db").postMessage("write");
  },
  async remove(v: Visit) {
    const d = await openDB("postcards");
    await d.delete("visits", v.visitId);
    await d.put("tombstones", {
      key: `visit:${v.visitId}`,
      kind: "visit",
      id: v.visitId,
      deletedAt: "2024-02-01T00:00:00.000Z",
    });
    new BroadcastChannel("postcards-db").postMessage("write");
  },
};
const onDisk = async () => (await db.getAllVisits()).map((v) => v.visitId).sort();
const here = () =>
  useVisits
    .getState()
    .visits.map((v) => v.visitId)
    .sort();

describe("another tab's writes", () => {
  beforeEach(async () => {
    clearDatabases();
    await db.putVisit(place("FR"));
    useVisits.setState({ visits: [], loaded: false });
    useTrips.setState({ trips: [], loaded: false });
    useStories.setState({ stories: [], loaded: false });
    await Promise.all([
      useVisits.getState().load(),
      useTrips.getState().load(),
      useStories.getState().load(),
    ]);
  });

  it("a CSV import here keeps a place another tab marked", async () => {
    await otherTab.mark(place("JP"));
    await useVisits
      .getState()
      .mergeVisits([
        { place: { kind: "country", id: "IT", name: "IT", countryId: "IT" }, status: "visited" },
      ]);
    expect((await onDisk()).length).toBe(3);
    expect(await onDisk()).toContain("v-JP");
  });

  it("a sync here keeps a place another tab marked", async () => {
    await otherTab.mark(place("JP"));
    const out = await runDeviceSync({ owner: "o", repo: "r", branch: "main", token: "t" });
    expect(out.ok).toBe(true);
    expect(await onDisk()).toEqual(["v-FR", "v-JP"]);
  });

  it("a place marked in another tab shows up here", async () => {
    const stop = followOtherTabs();
    await otherTab.mark(place("JP"));
    await vi.waitFor(() => expect(here()).toEqual(["v-FR", "v-JP"]));
    stop();
  });

  it("a place removed in another tab leaves here too", async () => {
    const stop = followOtherTabs();
    await otherTab.remove(place("FR"));
    await vi.waitFor(() => expect(here()).toEqual([]));
    stop();
  });
});

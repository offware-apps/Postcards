import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("idb", () => import("./fakeIdb"));
const remote: { content: string | null; version: number } = { content: null, version: 0 };
vi.mock("../../src/lib/publish/gitTarget", () => {
  class GitPushConflictError extends Error {}
  class GitHubTarget {
    name = "github";
    async getFile() {
      return remote.content == null
        ? null
        : { content: remote.content, version: String(remote.version) };
    }
    async putFileConditional(_path: string, content: string) {
      remote.content = content;
      remote.version++;
    }
  }
  return { GitHubTarget, GitPushConflictError };
});
import { clearDatabases } from "./fakeIdb";
import { useVisits } from "../../src/lib/store/useVisits";
import { useTrips } from "../../src/lib/store/useTrips";
import { useStories } from "../../src/lib/store/useStories";
import { restoreFromJson } from "../../src/features/backup/restore";
import { serializeFile } from "../../src/features/backup/exportJson";
import { runDeviceSync } from "../../src/lib/sync/runSync";
import type { TFunction } from "../../src/lib/i18n";

// A restore brings back records the device deleted since the backup; their
// tombstones must not delete them again on the next sync.

(globalThis as { indexedDB?: unknown }).indexedDB = {};
const cfg = { owner: "o", repo: "r", branch: "main", token: "t" };
const t = ((k: string) => k) as unknown as TFunction;
const tick = () => new Promise((r) => setTimeout(r, 2));

describe("a restored place survives the next sync", () => {
  beforeEach(() => {
    clearDatabases();
    remote.content = null;
    useVisits.setState({ visits: [], loaded: true });
    useTrips.setState({ trips: [], loaded: true });
    useStories.setState({ stories: [], loaded: true });
  });

  it("when the deletion was never synced", async () => {
    const v = await useVisits.getState().addVisit({
      place: { kind: "country", id: "FR", name: "France", countryId: "FR" },
    });
    const backup = serializeFile(useVisits.getState().visits);
    await tick();
    await useVisits.getState().removeVisit(v.visitId);
    expect((await restoreFromJson(backup, t)).ok).toBe(true);
    await runDeviceSync(cfg);
    expect(useVisits.getState().visits.map((x) => x.visitId)).toEqual([v.visitId]);
  });

  it("when the remote already holds the deletion", async () => {
    const trip = await useTrips.getState().addTrip({
      from: { kind: "country", id: "FR", name: "France", countryId: "FR" },
      to: { kind: "country", id: "JP", name: "Japan", countryId: "JP" },
    });
    const backup = serializeFile([], useTrips.getState().trips);
    await runDeviceSync(cfg);
    await tick();
    await useTrips.getState().removeTrip(trip.tripId);
    await runDeviceSync(cfg);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    expect((await restoreFromJson(backup, t)).ok).toBe(true);
    await runDeviceSync(cfg);
    expect(useTrips.getState().trips.map((x) => x.tripId)).toEqual([trip.tripId]);
  });
});

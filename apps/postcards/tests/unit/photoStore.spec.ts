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
import { clearDatabases, databases } from "./fakeIdb";
import * as db from "../../src/lib/db/visitsDb";
import { useVisits } from "../../src/lib/store/useVisits";
import { runDeviceSync } from "../../src/lib/sync/runSync";
import type { Visit } from "../../src/lib/schema/models";

// The photo blobs live in their own object store; these drive the real store →
// IndexedDB paths that rewrite the visits table and check a reload still finds
// every photo.

(globalThis as { indexedDB?: unknown }).indexedDB = {};

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function withPhoto(visitId: string, id: string): Visit {
  return {
    visitId,
    place: { kind: "country", id, name: id, countryId: id },
    status: "visited",
    favorite: false,
    date: null,
    note: null,
    photos: [{ src: PNG, caption: "view" }],
    addedAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

const photoRows = () => databases.get("postcards")!.get("photos")!.size;

async function reloadedPhotos(visitId: string): Promise<number> {
  const v = (await db.getAllVisits()).find((x) => x.visitId === visitId);
  return v?.photos?.length ?? 0;
}

describe("photos survive the paths that rewrite the visits table", () => {
  beforeEach(async () => {
    clearDatabases();
    useVisits.setState({ visits: [], loaded: false });
    await db.putVisit(withPhoto("v1", "FR"));
    await useVisits.getState().load(); // app start: the photo is hydrated from its blob
  });

  it("a CSV merge keeps the photos of the places already logged", async () => {
    await useVisits
      .getState()
      .mergeVisits([
        { place: { kind: "country", id: "JP", name: "Japan", countryId: "JP" }, status: "visited" },
      ]);
    expect(await reloadedPhotos("v1")).toBe(1);
  });

  it("a device sync keeps every photo", async () => {
    const out = await runDeviceSync({ owner: "o", repo: "r", branch: "main", token: "t" });
    expect(out.ok).toBe(true);
    expect(await reloadedPhotos("v1")).toBe(1);
  });

  it("undoing a removal brings the photos back for good", async () => {
    const prev = useVisits.getState().visits[0]!;
    await useVisits.getState().removeVisit(prev.visitId);
    await useVisits.getState().restoreVisit(prev);
    expect(await reloadedPhotos("v1")).toBe(1);
  });

  it("a toggle writes no blob for a photo already stored", async () => {
    await useVisits.getState().toggleFavorite(useVisits.getState().visits[0]!.place);
    expect(photoRows()).toBe(1);
  });

  it("replacing everything drops the blobs nothing references any more", async () => {
    await db.replaceAllPortable([], [], []);
    expect(photoRows()).toBe(0);
  });
});

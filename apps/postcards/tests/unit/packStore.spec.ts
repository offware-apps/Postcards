import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny in-memory stand-in for the one `idb` store the packs use.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb", () => ({
  openDB: async () => ({
    getAll: async () => [...rows.values()],
    put: async (_s: string, v: { id: string }) => void rows.set(v.id, v),
    delete: async (_s: string, k: string) => void rows.delete(k),
  }),
}));

import { useDataPacks } from "../../src/lib/packs/store";
import { parsePack, type InstalledPack } from "../../src/lib/packs/schema";
import { getReferenceData, setPackPlaces } from "../../src/lib/reference/referenceData";

const TEXT = JSON.stringify({
  format: "postcards-pack",
  version: 1,
  name: "Huts",
  license: "CC0",
  places: [{ id: "hut-1", name: "Refuge du Goûter", lat: 45.85, lon: 6.83, countryIso2: "FR" }],
});

const hutId = () => getReferenceData().allCities().find((c) => c.name === "Refuge du Goûter")?.id;

// A fresh device: nothing installed, nothing remembered.
function freshDevice() {
  rows.clear();
  localStorage.clear();
  setPackPlaces([]);
  useDataPacks.setState({ packs: [], loaded: false });
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", {});
  freshDevice();
});

describe("pack place ids", () => {
  it("stay the same when a pack is removed and added again", async () => {
    await useDataPacks.getState().addFromText(TEXT, null);
    const first = hutId();
    await useDataPacks.getState().remove(useDataPacks.getState().packs[0]!.id);
    expect(hutId()).toBeUndefined();
    await useDataPacks.getState().addFromText(TEXT, null);
    expect(hutId()).toBe(first);
  });

  it("are the same for the same pack on another device", async () => {
    await useDataPacks.getState().addFromText(TEXT, "https://raw.githubusercontent.com/a/b/main/huts.json");
    const first = hutId();
    freshDevice();
    await useDataPacks.getState().addFromText(TEXT, null);
    expect(hutId()).toBe(first);
  });

  it("installs a pack added twice once", async () => {
    await useDataPacks.getState().addFromText(TEXT, null);
    await useDataPacks.getState().addFromText(TEXT, null);
    expect(useDataPacks.getState().packs).toHaveLength(1);
    expect(rows.size).toBe(1);
    expect(getReferenceData().allCities().filter((c) => c.name === "Refuge du Goûter")).toHaveLength(1);
  });

  it("keep resolving for a pack installed under an older, random id", async () => {
    const parsed = parsePack(TEXT);
    if (!parsed.ok) throw new Error(parsed.error);
    const legacy: InstalledPack = {
      id: "08053efd-101c-4695-830f-e5530286694e",
      addedAt: "2026-01-01T00:00:00.000Z",
      sourceUrl: null,
      pack: parsed.pack,
    };
    rows.set(legacy.id, legacy);
    await useDataPacks.getState().load();
    const oldId = `pack:${legacy.id}:hut-1`;
    expect(hutId()).toBe(oldId);

    // Visits point at the old id: removing and re-adding the pack keeps it.
    await useDataPacks.getState().remove(legacy.id);
    await useDataPacks.getState().addFromText(TEXT, null);
    expect(hutId()).toBe(oldId);

    // A visit made on a device that installed the pack fresh resolves here too.
    freshDevice();
    await useDataPacks.getState().addFromText(TEXT, null);
    const freshId = hutId()!;
    expect(freshId).not.toBe(oldId);
    freshDevice();
    rows.set(legacy.id, legacy);
    await useDataPacks.getState().load();
    expect(hutId()).toBe(oldId);
    expect(getReferenceData().cityById(freshId)?.id).toBe(oldId);
  });
});

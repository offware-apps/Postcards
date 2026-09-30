import { describe, it, expect, vi } from "vitest";
vi.mock("idb", () => import("./fakeIdb"));
import { openDB } from "./fakeIdb";
import type { Visit } from "../../src/lib/schema/models";

// The pre-rename "placebeen" database is carried over into "postcards" once, when
// that database is created. Each launch below is a fresh copy of the db module
// over the same fake IndexedDB.

(globalThis as { indexedDB?: unknown }).indexedDB = {};

const launch = async () => {
  vi.resetModules();
  return import("../../src/lib/db/visitsDb");
};

const paris: Visit = {
  visitId: "v1",
  place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
  status: "visited",
  favorite: false,
  date: null,
  note: null,
  addedAt: "2020-01-01T00:00:00.000Z",
};

describe("the pre-rename database", () => {
  it("is carried over once and stays gone after erasing everything", async () => {
    const legacy = await openDB("placebeen", 1, {
      upgrade(d) {
        const db = d as { createObjectStore(n: string): void };
        db.createObjectStore("visits");
        db.createObjectStore("trips");
      },
    });
    await legacy.put("visits", paris);

    const first = await launch();
    expect((await first.getAllVisits()).map((v) => v.visitId)).toEqual(["v1"]);

    await first.replaceAllPortable([], [], []); // Erase everything
    const second = await launch();
    expect(await second.getAllVisits()).toEqual([]);
  });
});

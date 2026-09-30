import { it, expect, vi } from "vitest";
vi.mock("idb", () => ({
  openDB: () =>
    Promise.reject(new DOMException("A mutation operation was attempted.", "InvalidStateError")),
}));
import { useVisits } from "../../src/lib/store/useVisits";
import { useTrips } from "../../src/lib/store/useTrips";
import { useStories } from "../../src/lib/store/useStories";

// IndexedDB that cannot open (a private window, blocked storage): the app still
// opens, in memory, as it does with no IndexedDB at all.

(globalThis as { indexedDB?: unknown }).indexedDB = {};

it("the stores settle loaded, and later writes do not reject", async () => {
  await Promise.all([
    useVisits.getState().load(),
    useTrips.getState().load(),
    useStories.getState().load(),
  ]);
  expect([
    useVisits.getState().loaded,
    useTrips.getState().loaded,
    useStories.getState().loaded,
  ]).toEqual([true, true, true]);
  await useVisits
    .getState()
    .addVisit({ place: { kind: "country", id: "FR", name: "France", countryId: "FR" } });
  expect(useVisits.getState().visits).toHaveLength(1);
});

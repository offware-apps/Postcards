import type { Trip } from "../schema/models";
import { getDb, hasIndexedDB } from "./visitsDb";

// Travel Log working store — shares the "postcards" IndexedDB opened by visitsDb
// (v2 adds the "trips" object store). Local-first, no backend.
const STORE = "trips";

export async function getAllTrips(): Promise<Trip[]> {
  if (!hasIndexedDB()) return [];
  return (await getDb()).getAll(STORE) as Promise<Trip[]>;
}

export async function putTrip(trip: Trip): Promise<void> {
  if (!hasIndexedDB()) return;
  await (await getDb()).put(STORE, trip);
}

export async function deleteTrip(tripId: string): Promise<void> {
  if (!hasIndexedDB()) return;
  await (await getDb()).delete(STORE, tripId);
}

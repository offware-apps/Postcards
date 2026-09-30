import { create } from "zustand";
import { backfillUpdatedAt, stampNow } from "../schema/helpers";
import type { PlaceRef, TravelMode, Trip } from "../schema/models";
import * as db from "../db/tripsDb";
import * as visitsDb from "../db/visitsDb";
import { uuid } from "./uuid";

/** Now, as the ISO stamp written to `updatedAt` on every mutating path (spec 013). */

interface TripsState {
  trips: Trip[];
  loaded: boolean;
  load: () => Promise<void>;
  addTrip: (input: {
    from: PlaceRef;
    to: PlaceRef;
    /** Ordered stops for a multi-stop journey (spec 019); ≥2 or omitted. */
    stops?: PlaceRef[];
    mode?: TravelMode;
    /** Per-leg transport (spec 019); omitted when every leg uses `mode`. */
    legModes?: TravelMode[];
    /** Per-stop dates (spec 021), aligned to `stops`; omitted when none are set. */
    stopDates?: (string | null)[];
    date?: string | null;
    carrier?: string | null;
    note?: string | null;
    /** Optional folder label (e.g. "Japan 2024"); omitted when empty. */
    name?: string | null;
  }) => Promise<Trip>;
  updateTrip: (
    tripId: string,
    changes: Partial<
      Pick<
        Trip,
        "from" | "to" | "stops" | "mode" | "legModes" | "stopDates" | "date" | "carrier" | "note" | "name"
      >
    >,
  ) => Promise<void>;
  removeTrip: (tripId: string) => Promise<void>;
  setAll: (trips: Trip[]) => Promise<void>;
}

export const useTrips = create<TripsState>((set, get) => ({
  trips: [],
  loaded: false,
  async load() {
    // Backfill `updatedAt` from `addedAt` for trips made before sync existed.
    const trips = (await db.getAllTrips()).map(backfillUpdatedAt);
    set({ trips, loaded: true });
  },
  async addTrip({
    from,
    to,
    stops,
    mode = "flight",
    legModes,
    stopDates,
    date = null,
    carrier = null,
    note = null,
    name = null,
  }) {
    const at = new Date().toISOString();
    const trip: Trip = {
      tripId: uuid(),
      from,
      to,
      // Only carry `stops` for a real multi-stop journey (≥2); a single-leg trip
      // stays lean and never gains the key (mirrors the schema's optional field).
      ...(stops && stops.length >= 2 ? { stops } : {}),
      mode,
      // Only carry per-leg modes when a leg actually differs from `mode` (a
      // uniform trip stays lean and byte-identical to a pre-legModes file).
      ...(legModes && legModes.length ? { legModes } : {}),
      // Only carry per-stop dates when at least one is set — an all-null/absent
      // array never persists (stays byte-identical to a pre-stopDates file).
      ...(stopDates && stopDates.some((d) => d) ? { stopDates } : {}),
      date,
      carrier,
      note,
      // Only carry `name` when set — keep photo-less/label-less trips clean and
      // never store an empty/undefined key (mirrors the schema's optional field).
      ...(name && name.trim() ? { name: name.trim() } : {}),
      addedAt: at,
      updatedAt: at,
    };
    set({ trips: [...get().trips, trip] });
    await db.putTrip(trip);
    return trip;
  },
  async updateTrip(tripId, changes) {
    const existing = get().trips.find((t) => t.tripId === tripId);
    if (!existing) return;
    const updated: Trip = { ...existing, ...changes, updatedAt: stampNow() };
    // Normalize an edited folder label: trim it, and drop the key entirely when
    // cleared so we never persist an empty `name` (the schema forbids it).
    if ("name" in changes) {
      const nm = changes.name?.trim();
      if (nm) updated.name = nm;
      else delete updated.name;
    }
    // Drop `legModes` when it's cleared (a uniform-mode edit), so the trip never
    // keeps a stale per-leg array and stays lean.
    if ("legModes" in changes && !changes.legModes?.length) delete updated.legModes;
    // Drop `stopDates` when no date remains, so clearing every per-stop date leaves
    // the trip byte-identical to one that never had them.
    if ("stopDates" in changes && !changes.stopDates?.some((d) => d)) delete updated.stopDates;
    set({ trips: get().trips.map((t) => (t.tripId === tripId ? updated : t)) });
    await db.putTrip(updated);
  },
  async removeTrip(tripId) {
    set({ trips: get().trips.filter((t) => t.tripId !== tripId) });
    await db.deleteTrip(tripId);
    // Tombstone the deletion so it propagates on sync (spec 013, FR-009).
    await visitsDb.putTombstone("trip", tripId, stampNow());
  },
  async setAll(trips) {
    // Bulk load: backfill `updatedAt` without stamping "now" (keep real ages).
    const backfilled = trips.map(backfillUpdatedAt);
    set({ trips: backfilled });
    await db.replaceAllTrips(backfilled);
  },
}));

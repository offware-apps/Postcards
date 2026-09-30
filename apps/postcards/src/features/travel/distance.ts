import type { PlaceRef, TravelMode, Trip } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { MODE_ORDER } from "./modes";

/** Resolve a place reference to coordinates, if it has any (cities, airports, heritage sites do). */
export function coordsOf(place: PlaceRef, ref: ReferenceData): { lon: number; lat: number } | null {
  if (place.kind === "city") {
    const c = ref.cityById(place.id);
    return c ? { lon: c.lon, lat: c.lat } : null;
  }
  if (place.kind === "airport") {
    const a = ref.airportById(place.id);
    return a ? { lon: a.lon, lat: a.lat } : null;
  }
  if (place.kind === "station") {
    const s = ref.stationById(place.id);
    return s ? { lon: s.lon, lat: s.lat } : null;
  }
  if (place.kind === "heritage") {
    const h = ref.heritageById(place.id);
    // Some sites have no coordinate in the source (stored as 0,0) — treat as unknown.
    return h && (h.lat !== 0 || h.lon !== 0) ? { lon: h.lon, lat: h.lat } : null;
  }
  // A user-authored "custom" pin carries its own coordinates on the record (there's
  // no reference entry to look up). The trip pool already resolves these the same
  // way, so a custom stop's leg must draw + measure here too — not vanish.
  if (place.kind === "custom") {
    return place.lat != null && place.lon != null ? { lon: place.lon, lat: place.lat } : null;
  }
  return null; // countries have no single coordinate
}

const R_KM = 6371; // mean Earth radius
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km between two lon/lat points. */
export function haversineKm(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Total great-circle distance along an ordered chain of stops (spec 019): the sum of
 * the leg distances between consecutive stops. A leg touching a stop with no
 * coordinate contributes nothing and is counted in `unresolvedLegs`, so one missing
 * point never zeroes the whole trip. Fewer than two stops → zero.
 */
export function tripPathKm(
  stops: PlaceRef[],
  ref: ReferenceData,
): { km: number; unresolvedLegs: number } {
  let km = 0;
  let unresolvedLegs = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = coordsOf(stops[i]!, ref);
    const b = coordsOf(stops[i + 1]!, ref);
    if (a && b) km += haversineKm(a, b);
    else unresolvedLegs += 1;
  }
  return { km, unresolvedLegs };
}

/**
 * A trip's great-circle distance. A multi-stop trip (stops present) sums its path;
 * a legacy single-leg trip uses its `from → to` endpoints. Returns null only when a
 * single-leg trip has an unresolvable endpoint (a multi-stop trip always returns a
 * number — possibly 0 — because partial paths still count).
 */
export function tripDistanceKm(trip: Trip, ref: ReferenceData): number | null {
  if (trip.stops && trip.stops.length >= 2) return tripPathKm(trip.stops, ref).km;
  const from = coordsOf(trip.from, ref);
  const to = coordsOf(trip.to, ref);
  if (!from || !to) return null;
  return haversineKm(from, to);
}

export interface TravelTotals {
  trips: number;
  totalKm: number;
  /** Per-mode { trips, km }, in a stable display order. */
  byMode: { mode: TravelMode; trips: number; km: number }[];
}

/** Aggregate totals across trips. Distance is summed PER LEG under that leg's own
 *  transport (spec 019 per-leg modes), so a mixed-mode journey splits correctly;
 *  a trip is counted once under each distinct mode it uses. */
export function travelTotals(trips: Trip[], ref: ReferenceData): TravelTotals {
  const per = new Map<TravelMode, { trips: number; km: number }>();
  const slot = (m: TravelMode) => {
    const s = per.get(m) ?? { trips: 0, km: 0 };
    per.set(m, s);
    return s;
  };
  let totalKm = 0;
  for (const t of trips) {
    const chain = t.stops && t.stops.length >= 2 ? t.stops : [t.from, t.to];
    const modesUsed = new Set<TravelMode>();
    for (let i = 0; i < chain.length - 1; i++) {
      const mode = t.legModes?.[i] ?? t.mode;
      modesUsed.add(mode);
      const a = coordsOf(chain[i]!, ref);
      const b = coordsOf(chain[i + 1]!, ref);
      if (a && b) {
        const km = haversineKm(a, b);
        totalKm += km;
        slot(mode).km += km;
      }
    }
    // Count the trip once per distinct transport it used (single-mode → its mode).
    for (const m of modesUsed) slot(m).trips += 1;
  }
  const byMode = MODE_ORDER.filter((m) => per.has(m)).map((mode) => ({ mode, ...per.get(mode)! }));
  return { trips: trips.length, totalKm, byMode };
}

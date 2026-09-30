import type { PlaceRef, Trip, Visit } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { placeKey } from "../../lib/schema/helpers";
import { countryFlag } from "../../lib/format/format";

/** The emoji that stands in for a place in the trip UI — a plane for airports,
 *  else the country flag. One definition shared by every trip picker/row. */
export const placeFlag = (p: PlaceRef): string =>
  p.kind === "airport" ? "✈️" : p.kind === "station" ? "🚉" : countryFlag(p.countryId);

// The pool the trip composer picks stops from (spec 019, fast-reconstruction): ONLY
// places you've already been — your visited records plus every place already used in
// a trip — each resolved to a coordinate (so it can be a leg) and carrying its flag.
// Pure & offline; invents nothing.

export interface MyPlace {
  key: string;
  place: PlaceRef;
  name: string;
  countryId: string;
  lon: number;
  lat: number;
  /** City population (0 for non-cities). Lets the map snap a tap to the MOST
   *  populous place in a dense cluster instead of a near-random neighbour. */
  population: number;
}

/** Coordinates for a place: reference data for city/airport/heritage, the point
 *  itself for a custom pin; countries have none. */
function coordOf(ref: ReferenceData, p: PlaceRef): { lon: number; lat: number } | null {
  if (p.kind === "city") {
    const c = ref.cityById(p.id);
    return c ? { lon: c.lon, lat: c.lat } : null;
  }
  if (p.kind === "airport") {
    const a = ref.airportById(p.id);
    return a ? { lon: a.lon, lat: a.lat } : null;
  }
  if (p.kind === "station") {
    const s = ref.stationById(p.id);
    return s ? { lon: s.lon, lat: s.lat } : null;
  }
  if (p.kind === "heritage") {
    const h = ref.heritageById(p.id);
    return h && (h.lat !== 0 || h.lon !== 0) ? { lon: h.lon, lat: h.lat } : null;
  }
  if (p.kind === "custom") {
    return p.lat != null && p.lon != null ? { lon: p.lon, lat: p.lat } : null;
  }
  return null; // country
}

/**
 * Every distinct place the user has been — visited records (not wishlist) and all
 * trip endpoints/stops — that has a coordinate, deduped and sorted by name. This is
 * the tap-to-add pool for reconstructing a journey from where you've actually been.
 */
export function myPlaces(visits: Visit[], trips: Trip[], ref: ReferenceData): MyPlace[] {
  const out = new Map<string, MyPlace>();
  const add = (p: PlaceRef) => {
    const k = placeKey(p);
    if (out.has(k)) return;
    const c = coordOf(ref, p);
    if (!c) return;
    const population = p.kind === "city" ? (ref.cityById(p.id)?.population ?? 0) : 0;
    out.set(k, { key: k, place: p, name: p.name, countryId: p.countryId, lon: c.lon, lat: c.lat, population });
  };
  for (const v of visits) if (v.status !== "wishlist") add(v.place);
  for (const t of trips) {
    add(t.from);
    add(t.to);
    if (t.stops) for (const s of t.stops) add(s);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

import type { Trip, Visit } from "../../lib/schema/models";
import type { Airport, ReferenceData } from "../../lib/reference/types";
import { tripChain } from "./tripStops";

export interface AirportCount {
  airport: Airport;
  /** How many times this airport appears across the traveller's been-there data. */
  count: number;
}

/**
 * How many times each airport appears across your travel data, busiest first.
 *
 * Every trip leg that starts or ends at an airport counts once (a round trip
 * through a hub is two touches), the legs of a multi-stop trip included, so a
 * connection logged as one journey counts as it would logged as two trips; and
 * every explicitly-marked airport visit counts
 * once too — so the airport you keep connecting through rises to the top. Wishlist
 * airports (not yet been) are excluded, and IATA codes the gazetteer doesn't know
 * are skipped, so nothing is invented.
 *
 * Pure and period-agnostic: the caller decides which trips/visits to pass in
 * (e.g. all of them for a lifetime roll-up).
 */
export function airportVisitCounts(
  trips: Trip[],
  visits: Visit[],
  ref: ReferenceData,
): AirportCount[] {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const t of trips) {
    const chain = tripChain(t);
    for (let i = 0; i < chain.length - 1; i++) {
      for (const end of [chain[i]!, chain[i + 1]!]) if (end.kind === "airport") bump(end.id);
    }
  }
  for (const v of visits) {
    if (v.place.kind === "airport" && v.status !== "wishlist") bump(v.place.id);
  }
  const out: AirportCount[] = [];
  for (const [id, count] of counts) {
    const airport = ref.airportById(id);
    if (airport) out.push({ airport, count });
  }
  // Busiest first; ties broken by IATA code so the order is stable.
  out.sort((a, b) => b.count - a.count || a.airport.id.localeCompare(b.airport.id));
  return out;
}

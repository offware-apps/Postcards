import { describe, it, expect } from "vitest";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import { airportVisitCounts } from "../../src/features/travel/airports";
import type { PlaceRef, Trip, Visit } from "../../src/lib/schema/models";

const ref = getReferenceData();
const air = (iata: string): PlaceRef => {
  const a = ref.airportById(iata)!;
  return { kind: "airport", id: a.id, name: `${a.name} (${a.id})`, countryId: a.countryIso2 };
};
const cityRef: PlaceRef = { kind: "city", id: "x", name: "Somewhere", countryId: "FR" };

const trip = (from: PlaceRef, to: PlaceRef): Trip => ({
  tripId: crypto.randomUUID(),
  from,
  to,
  mode: "flight",
  date: null,
  carrier: null,
  note: null,
  addedAt: new Date().toISOString(),
});
const airportVisit = (iata: string, status: Visit["status"] = "visited"): Visit => ({
  visitId: crypto.randomUUID(),
  place: air(iata),
  date: null,
  note: null,
  status,
  favorite: false,
  addedAt: new Date().toISOString(),
});

describe("airportVisitCounts", () => {
  it("counts every trip endpoint and ranks the busiest airport first", () => {
    // JFK: out+back to CDG and a third leg to LHR → 3; CDG → 2; LHR → 1.
    const trips = [trip(air("JFK"), air("CDG")), trip(air("CDG"), air("JFK")), trip(air("JFK"), air("LHR"))];
    const out = airportVisitCounts(trips, [], ref);
    expect(out.map((a) => [a.airport.id, a.count])).toEqual([
      ["JFK", 3],
      ["CDG", 2],
      ["LHR", 1],
    ]);
  });

  it("folds in explicitly-marked airport visits and excludes wishlist ones", () => {
    const trips = [trip(air("JFK"), air("CDG"))];
    const visits = [airportVisit("JFK"), airportVisit("LHR", "wishlist")];
    const out = airportVisitCounts(trips, visits, ref);
    const byId = Object.fromEntries(out.map((a) => [a.airport.id, a.count]));
    expect(byId["JFK"]).toBe(2); // one trip endpoint + one explicit visit
    expect(byId["CDG"]).toBe(1);
    expect(byId["LHR"]).toBeUndefined(); // wishlist airports don't count as been-there
  });

  it("ignores non-airport endpoints and never invents unknown airports", () => {
    const bogus: PlaceRef = { kind: "airport", id: "ZZZ", name: "Nowhere", countryId: "FR" };
    const trips = [trip(cityRef, air("CDG")), trip(bogus, air("CDG"))];
    const out = airportVisitCounts(trips, [], ref);
    // The city endpoint contributes nothing; ZZZ is not in the gazetteer so it's
    // dropped; only CDG (touched by both trips) survives, counted twice.
    expect(out).toHaveLength(1);
    expect(out[0]!.airport.id).toBe("CDG");
    expect(out[0]!.count).toBe(2);
  });

  it("counts the intermediate stops of a multi-stop trip like separate legs", () => {
    const hop: Trip = { ...trip(air("CDG"), air("KIX")), stops: [air("CDG"), air("NRT"), air("KIX")] };
    const legs = [trip(air("CDG"), air("NRT")), trip(air("NRT"), air("KIX"))];
    const counts = (trips: Trip[]) =>
      airportVisitCounts(trips, [], ref).map((a) => `${a.airport.id}:${a.count}`).sort();
    expect(counts([hop])).toEqual(["CDG:1", "KIX:1", "NRT:2"]);
    expect(counts([hop])).toEqual(counts(legs));
  });

  it("returns an empty list when there's no airport data", () => {
    expect(airportVisitCounts([], [], ref)).toEqual([]);
    expect(airportVisitCounts([trip(cityRef, cityRef)], [], ref)).toEqual([]);
  });
});

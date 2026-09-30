import { describe, it, expect } from "vitest";
import type { Feature, FeatureCollection, Point } from "geojson";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import {
  visitedCityPoints,
  wishlistCityPoints,
  optimizeVisitedPoints,
  stackSameCountry,
  tripArcs,
} from "../../src/features/map/visitedLayers";
import type { PlaceRef, Trip, Visit } from "../../src/lib/schema/models";
import { haversineKm } from "../../src/features/travel/distance";

const ref = getReferenceData();
const paris = ref.searchCities("Paris")[0]!;

function cityVisit(id: string, name: string, countryId: string): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "city", id, name, countryId },
    date: null,
    note: null,
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  };
}

describe("map layers", () => {
  const visits = [cityVisit(paris.id, paris.name, paris.countryIso2)];

  it("emits a point at the city's [lon, lat] (GeoJSON order)", () => {
    const fc = visitedCityPoints(visits, ref);
    expect(fc.features).toHaveLength(1);
    const [lon, lat] = fc.features[0]!.geometry.coordinates;
    expect(lon).toBeCloseTo(paris.lon, 3);
    expect(lat).toBeCloseTo(paris.lat, 3);
  });

  it("tags each point with its country code for the flag marker", () => {
    const fc = visitedCityPoints(visits, ref);
    expect(fc.features[0]!.properties?.cc).toBe("FR");
  });
});

describe("optimize visited points (one city per area)", () => {
  // Minimal feature carrying only what the reducer reads.
  const pt = (
    name: string,
    props: { cc?: string; region?: string; pop?: number; custom?: number; fav?: number },
  ): Feature<Point> => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { name, cc: "FR", region: "", pop: 0, custom: 0, fav: 0, ...props },
  });
  const fc = (features: Feature<Point>[]): FeatureCollection<Point> => ({
    type: "FeatureCollection",
    features,
  });
  const names = (out: FeatureCollection<Point>) =>
    out.features.map((f) => f.properties?.name).sort();

  it("keeps only the most-populous city in an area", () => {
    const out = optimizeVisitedPoints(
      fc([
        pt("Big", { region: "IDF", pop: 2_000_000 }),
        pt("Small", { region: "IDF", pop: 5_000 }),
        pt("Mid", { region: "IDF", pop: 40_000 }),
      ]),
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0]!.properties?.name).toBe("Big");
  });

  it("treats country + subdivision as the area (same region name, different country stays)", () => {
    const out = optimizeVisitedPoints(
      fc([
        pt("A", { cc: "FR", region: "West", pop: 100 }),
        pt("B", { cc: "US", region: "West", pop: 100 }),
      ]),
    );
    expect(names(out)).toEqual(["A", "B"]);
  });

  it("always keeps favourites and custom points, even when a bigger city shares the area", () => {
    const out = optimizeVisitedPoints(
      fc([
        pt("Capital", { region: "IDF", pop: 2_000_000 }),
        pt("MyFavVillage", { region: "IDF", pop: 200, fav: 1 }),
        pt("MyPin", { region: "IDF", pop: 0, custom: 1 }),
      ]),
    );
    // Biggest area rep + the favourite + the custom pin all survive.
    expect(names(out)).toEqual(["Capital", "MyFavVillage", "MyPin"]);
  });

  it("leaves a set that is already one-per-area untouched", () => {
    const input = fc([
      pt("Paris", { region: "IDF", pop: 2_000_000 }),
      pt("Lyon", { region: "ARA", pop: 500_000 }),
    ]);
    expect(names(optimizeVisitedPoints(input))).toEqual(["Lyon", "Paris"]);
  });

  it("granularity 'country' (zoomed out) keeps one flag per COUNTRY", () => {
    const input = fc([
      pt("Paris", { cc: "FR", region: "IDF", pop: 2_000_000 }),
      pt("Lyon", { cc: "FR", region: "ARA", pop: 500_000 }),
      pt("Berlin", { cc: "DE", region: "BE", pop: 3_500_000 }),
    ]);
    // Default "area" keeps all three (distinct subdivisions); "country" collapses
    // France's two to its biggest (Paris) — "the more you zoom, the more appear".
    expect(names(optimizeVisitedPoints(input, "area"))).toEqual(["Berlin", "Lyon", "Paris"]);
    expect(names(optimizeVisitedPoints(input, "country"))).toEqual(["Berlin", "Paris"]);
  });
});

describe("declutter priority (symbol-sort-key)", () => {
  const parisCity = ref.searchCities("Paris")[0]!;
  const cityV = (favorite: boolean): Visit => ({
    visitId: crypto.randomUUID(),
    place: { kind: "city", id: parisCity.id, name: parisCity.name, countryId: parisCity.countryIso2 },
    date: null,
    note: null,
    status: "visited",
    favorite,
    addedAt: new Date().toISOString(),
  });
  const customV: Visit = {
    visitId: crypto.randomUUID(),
    place: { kind: "custom", id: "c1", name: "My spot", countryId: "FR", lat: 48.8, lon: 2.3 },
    date: null,
    note: null,
    status: "visited",
    favorite: false,
    addedAt: new Date().toISOString(),
  };

  it("pins favourites and custom pins below every browse city (never thinned)", () => {
    const fc = visitedCityPoints([cityV(false), cityV(true), customV], ref);
    const nonFav = fc.features.find((f) => f.properties!.fav === 0 && f.properties!.custom === 0)!
      .properties!;
    const fav = fc.features.find((f) => f.properties!.fav === 1)!.properties!;
    const cust = fc.features.find((f) => f.properties!.custom === 1)!.properties!;
    // Lower symbol-sort-key wins the collision, so pinned marks must sort below.
    expect(fav.sortKey).toBeLessThan(nonFav.sortKey);
    expect(cust.sortKey).toBeLessThan(nonFav.sortKey);
    // A plain visited city: -population, less the bias its country's main city gets.
    expect(nonFav.sortKey).toBe(-100_000_000 - (parisCity.population ?? 0));
  });
});

describe("flags at world zoom: one per country before any second one", () => {
  const city = (q: string, cc: string) => ref.searchCities(q).find((c) => c.countryIso2 === cc)!;
  const lyon = city("Lyon", "FR");
  const brussels = city("Brussels", "BE");
  const antwerp = city("Antwerp", "BE");
  const visits = [
    cityVisit(paris.id, paris.name, "FR"),
    cityVisit(lyon.id, lyon.name, "FR"),
    cityVisit(brussels.id, brussels.name, "BE"),
    cityVisit(antwerp.id, antwerp.name, "BE"),
  ];
  const names = (fc: FeatureCollection<Point>) => fc.features.map((f) => f.properties?.name).sort();

  it("ranks every country's main city ahead of any country's second city", () => {
    const marseille = city("Marseille", "FR");
    const set = [
      cityVisit(paris.id, paris.name, "FR"),
      cityVisit(marseille.id, marseille.name, "FR"),
      cityVisit(antwerp.id, antwerp.name, "BE"),
    ];
    const key = (name: string) =>
      visitedCityPoints(set, ref).features.find((f) => f.properties?.name === name)!.properties!
        .sortKey as number;
    // Marseille outnumbers Antwerp, yet Belgium keeps its one flag first.
    expect(marseille.population!).toBeGreaterThan(antwerp.population!);
    expect(key(antwerp.name)).toBeLessThan(key(marseille.name));
    expect(key(paris.name)).toBeLessThan(key(antwerp.name));
  });

  it("stacks a country's own flags where they would overlap, never another country's", () => {
    const fc = visitedCityPoints(visits, ref);
    expect(names(stackSameCountry(fc, 1))).toEqual([brussels.name, paris.name].sort());
    // Close enough in and every city has its own flag again.
    expect(names(stackSameCountry(fc, 6))).toEqual(
      [antwerp.name, brussels.name, lyon.name, paris.name].sort(),
    );
  });

  it("never stacks a favourite away, and a favourite heads its country's pile", () => {
    const fav = (c: typeof paris) => ({ ...cityVisit(c.id, c.name, "FR"), favorite: true });
    expect(names(stackSameCountry(visitedCityPoints([fav(paris), fav(lyon)], ref), 1))).toEqual(
      [lyon.name, paris.name].sort(),
    );
    expect(names(stackSameCountry(visitedCityPoints([visits[0]!, fav(lyon)], ref), 1))).toEqual([
      lyon.name,
    ]);
  });
});

describe("wishlist points share the visited shape (unified marker + optimise)", () => {
  const parisCity = ref.searchCities("Paris")[0]!;
  const wishV = (favorite = false): Visit => ({
    visitId: crypto.randomUUID(),
    place: { kind: "city", id: parisCity.id, name: parisCity.name, countryId: parisCity.countryIso2 },
    date: null,
    note: null,
    status: "wishlist",
    favorite,
    addedAt: new Date().toISOString(),
  });

  it("emits wish=1 plus the fav + sortKey the flag pill and collision need", () => {
    const p = wishlistCityPoints([wishV(false)], ref).features[0]!.properties!;
    expect(p.wish).toBe(1);
    expect(p.cc).toBe("FR");
    expect(p.custom).toBe(0);
    expect(p.fav).toBe(0);
    // Same collision key as a visited city (the only one of its country).
    expect(p.sortKey).toBe(-100_000_000 - (parisCity.population ?? 0));
  });

  it("carries the favourite star and pins a favourite want-list city (kept in a collision)", () => {
    const p = wishlistCityPoints([wishV(true)], ref).features[0]!.properties!;
    expect(p.fav).toBe(1);
    expect(p.sortKey).toBeLessThan(0); // -PINNED bias keeps favourites
  });

  it("flows through the SAME region optimisation as visited (one want-list city per area)", () => {
    const out = optimizeVisitedPoints({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { name: "Big", cc: "FR", region: "IDF", pop: 2_000_000, custom: 0, fav: 0, wish: 1 } },
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { name: "Small", cc: "FR", region: "IDF", pop: 5_000, custom: 0, fav: 0, wish: 1 } },
      ],
    });
    expect(out.features).toHaveLength(1);
    expect(out.features[0]!.properties?.name).toBe("Big");
  });
});

describe("trip arcs", () => {
  const airport = (iata: string): PlaceRef => {
    const a = ref.airportById(iata)!;
    return { kind: "airport", id: a.id, name: a.id, countryId: a.countryIso2 };
  };
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

  it("draws a densified great-circle arc tagged with the mode", () => {
    const fc = tripArcs([trip(airport("CDG"), airport("JFK"))], ref);
    expect(fc.features).toHaveLength(1);
    const line = fc.features[0]!;
    expect(line.properties?.mode).toBe("flight");
    const coords = line.geometry.coordinates;
    expect(coords.length).toBeGreaterThan(10); // densified, not just 2 endpoints
    // Endpoints match the airports.
    const cdg = ref.airportById("CDG")!;
    const jfk = ref.airportById("JFK")!;
    expect(coords[0]![0]).toBeCloseTo(cdg.lon, 3);
    expect(coords[coords.length - 1]![1]).toBeCloseTo(jfk.lat, 3);
    // The arc bulges north of the straight lon/lat chord (great-circle behaviour).
    const mid = coords[Math.floor(coords.length / 2)]!;
    expect(mid[1]).toBeGreaterThan((cdg.lat + jfk.lat) / 2);
    // Total polyline length ≈ the great-circle distance.
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      len += haversineKm(
        { lon: coords[i - 1]![0], lat: coords[i - 1]![1] },
        { lon: coords[i]![0], lat: coords[i]![1] },
      );
    }
    expect(len).toBeGreaterThan(5700);
    expect(len).toBeLessThan(5950);
  });

  it("skips trips whose endpoint has no coordinate (never invents a line)", () => {
    const country: PlaceRef = { kind: "country", id: "FR", name: "France", countryId: "FR" };
    const fc = tripArcs([trip(country, airport("JFK"))], ref);
    expect(fc.features).toHaveLength(0);
  });

  it("draws one arc PER LEG for a multi-stop trip (spec 019)", () => {
    // CDG → JFK → LHR: two legs, so two arc features (not one endpoint shortcut).
    const multi: Trip = {
      ...trip(airport("CDG"), airport("LHR")),
      stops: [airport("CDG"), airport("JFK"), airport("LHR")],
    };
    const fc = tripArcs([multi], ref);
    expect(fc.features).toHaveLength(2);
    // Each leg is its own great-circle arc, tagged with the mode.
    for (const f of fc.features) expect(f.properties?.mode).toBe("flight");
    // Leg 1 starts at CDG, leg 2 ends at LHR — the route is traced through JFK.
    const cdg = ref.airportById("CDG")!;
    const lhr = ref.airportById("LHR")!;
    const first = fc.features[0]!.geometry.coordinates;
    const last = fc.features[1]!.geometry.coordinates;
    expect(first[0]![0]).toBeCloseTo(cdg.lon, 3);
    expect(last[last.length - 1]![1]).toBeCloseTo(lhr.lat, 3);
  });

  it("skips only the unresolvable leg of a multi-stop trip", () => {
    const country: PlaceRef = { kind: "country", id: "FR", name: "France", countryId: "FR" };
    // CDG → [country] → JFK: both legs touch the coordinate-less country → 0 arcs;
    // but CDG → JFK → LHR with a good middle keeps both.
    const withGap: Trip = {
      ...trip(airport("CDG"), airport("JFK")),
      stops: [airport("CDG"), country, airport("JFK")],
    };
    expect(tripArcs([withGap], ref).features).toHaveLength(0);
  });
});

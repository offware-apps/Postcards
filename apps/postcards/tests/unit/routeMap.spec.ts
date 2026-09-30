import { describe, it, expect } from "vitest";
import { fitBounds } from "../../src/features/map/mapFit";
import { pickPointsFC } from "../../src/features/travel/pickPoints";
import { stopsArcs } from "../../src/features/map/visitedLayers";
import { placeKey } from "../../src/lib/schema/helpers";
import type { MyPlace } from "../../src/features/travel/myPlaces";
import type { PlaceRef } from "../../src/lib/schema/models";
import type { City, ReferenceData } from "../../src/lib/reference/types";

const city = (id: string, name: string, lon: number, lat: number): City => ({
  id, name, countryIso2: "FR", subdivisionId: null, lon, lat, population: 1000,
});
const cities: Record<string, City> = {
  paris: city("paris", "Paris", 2.35, 48.85),
  tokyo: city("tokyo", "Tokyo", 139.69, 35.68),
  osaka: city("osaka", "Osaka", 135.5, 34.69),
};
const ref = {
  cityById: (id: string) => cities[id],
  airportById: () => undefined,
  heritageById: () => undefined,
} as unknown as ReferenceData;

const cityRef = (id: string): PlaceRef => ({ kind: "city", id, name: cities[id]!.name, countryId: "FR" });
const myPlace = (id: string, population = 1000): MyPlace => {
  const place = cityRef(id);
  const c = cities[id]!;
  return { key: placeKey(place), place, name: c.name, countryId: "FR", lon: c.lon, lat: c.lat, population };
};

describe("mapFit.fitBounds", () => {
  it("returns null for no coordinates", () => {
    expect(fitBounds([])).toBeNull();
  });
  it("frames a simple spread west→east, south→north", () => {
    const b = fitBounds([{ lon: 2, lat: 48 }, { lon: 140, lat: 35 }]);
    expect(b).toEqual([[2, 35], [140, 48]]);
  });
  it("frames antimeridian pairs tight (Fiji + Samoa), not the whole globe", () => {
    // Fiji ~178, Samoa ~-172: the tight frame wraps 178 → 188 (east > 180), width 10°.
    const b = fitBounds([{ lon: 178, lat: -18 }, { lon: -172, lat: -13 }])!;
    const width = b[1][0] - b[0][0];
    expect(width).toBeCloseTo(10, 5);
    expect(b[0][0]).toBe(178);
    expect(b[1][0]).toBe(188);
  });
});

describe("pickPoints.pickPointsFC", () => {
  it("emits one feature per pool place with a stable key and kind", () => {
    const pool = [myPlace("paris"), myPlace("tokyo")];
    const fc = pickPointsFC(pool, []);
    expect(fc.features).toHaveLength(2);
    expect(fc.features.every((f) => f.properties!.seq === 0 && f.properties!.added === false)).toBe(true);
    expect(fc.features[0]!.properties!.kind).toBe("city");
  });
  it("carries each place's population so a tap can snap to the most populous pin", () => {
    const fc = pickPointsFC([myPlace("paris", 2_140_000), myPlace("osaka", 2_700_000)], []);
    const byKey = new Map(fc.features.map((f) => [f.properties!.key, f.properties!.pop]));
    expect(byKey.get(placeKey(cityRef("paris")))).toBe(2_140_000);
    expect(byKey.get(placeKey(cityRef("osaka")))).toBe(2_700_000);
  });
  it("labels added stops with their 1-based route index and an added flag", () => {
    const pool = [myPlace("paris"), myPlace("tokyo"), myPlace("osaka")];
    const fc = pickPointsFC(pool, [cityRef("tokyo"), cityRef("paris")]);
    const byKey = new Map(fc.features.map((f) => [f.properties!.key, f.properties!]));
    expect(byKey.get(placeKey(cityRef("tokyo")))!.seq).toBe(1);
    expect(byKey.get(placeKey(cityRef("paris")))!.seq).toBe(2);
    expect(byKey.get(placeKey(cityRef("osaka")))!.seq).toBe(0); // not on the route
  });
});

describe("visitedLayers.stopsArcs", () => {
  it("draws one great-circle leg per consecutive resolvable pair", () => {
    const fc = stopsArcs([cityRef("paris"), cityRef("tokyo"), cityRef("osaka")], ref, "flight");
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.geometry.type).toBe("LineString");
    expect(fc.features[0]!.properties!.mode).toBe("flight");
  });
  it("skips a leg touching a coordinate-less stop without dropping the rest", () => {
    const country: PlaceRef = { kind: "country", id: "JP", name: "Japan", countryId: "JP" };
    // paris → JP(no coord) → tokyo: only the JP legs are skipped; nothing else.
    const fc = stopsArcs([cityRef("paris"), country, cityRef("tokyo")], ref, "flight");
    expect(fc.features).toHaveLength(0);
  });
  it("returns empty for fewer than two stops", () => {
    expect(stopsArcs([cityRef("paris")], ref, "flight").features).toHaveLength(0);
    expect(stopsArcs([], ref, "flight").features).toHaveLength(0);
  });
});

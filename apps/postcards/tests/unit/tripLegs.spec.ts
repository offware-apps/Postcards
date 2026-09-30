import { describe, it, expect } from "vitest";
import {
  appendStop,
  removeStopAt,
  moveStopTo,
  setLegMode,
  type StopChain,
} from "../../src/features/travel/tripStops";
import { stopsArcs } from "../../src/features/map/visitedLayers";
import { travelTotals } from "../../src/features/travel/distance";
import type { PlaceRef, Trip, TravelMode } from "../../src/lib/schema/models";
import type { City, ReferenceData } from "../../src/lib/reference/types";

const cityRef = (id: string, name: string): PlaceRef => ({ kind: "city", id, name, countryId: "FR" });
const P = cityRef("paris", "Paris");
const T = cityRef("tokyo", "Tokyo");
const O = cityRef("osaka", "Osaka");
const empty: StopChain = { stops: [], legModes: [] };

describe("per-leg chain helpers keep legModes in sync with stops", () => {
  it("appendStop adds a leg (filled) only once there are ≥2 stops", () => {
    let c = appendStop(empty, P, "flight");
    expect(c.stops).toHaveLength(1);
    expect(c.legModes).toHaveLength(0); // no leg yet
    c = appendStop(c, T, "flight");
    expect(c.legModes).toEqual(["flight"]);
    c = appendStop(c, O, "train"); // new legs continue the caller's fill
    expect(c.stops).toHaveLength(3);
    expect(c.legModes).toEqual(["flight", "train"]);
  });

  it("setLegMode overrides one leg; a run of one mode is a sub-trip", () => {
    const c = setLegMode({ stops: [P, T, O], legModes: ["flight", "flight"] }, 1, "train");
    expect(c.legModes).toEqual(["flight", "train"]);
  });

  it("removeStopAt drops the right leg and refits length", () => {
    const c = removeStopAt({ stops: [P, T, O], legModes: ["flight", "train"] }, 1, "flight");
    expect(c.stops).toEqual([P, O]);
    expect(c.legModes).toHaveLength(1); // 2 stops → 1 leg
  });

  it("moveStopTo keeps legModes valid (right length)", () => {
    const c = moveStopTo({ stops: [P, T, O], legModes: ["flight", "train"] }, 2, 0, "flight");
    expect(c.stops[0]).toBe(O);
    expect(c.legModes).toHaveLength(2);
  });
});

// ── per-leg arcs + totals ────────────────────────────────────────────────────
const cities: Record<string, City> = {
  paris: { id: "paris", name: "Paris", countryIso2: "FR", subdivisionId: null, lon: 2.35, lat: 48.85, population: 1 },
  tokyo: { id: "tokyo", name: "Tokyo", countryIso2: "JP", subdivisionId: null, lon: 139.69, lat: 35.68, population: 1 },
  osaka: { id: "osaka", name: "Osaka", countryIso2: "JP", subdivisionId: null, lon: 135.5, lat: 34.69, population: 1 },
};
const ref = {
  cityById: (id: string) => cities[id],
  airportById: () => undefined,
  heritageById: () => undefined,
} as unknown as ReferenceData;

describe("custom stops draw + measure (regression: coordsOf ignored kind=custom)", () => {
  const cA: PlaceRef = { kind: "custom", id: "a", name: "Cabin", countryId: "FR", lon: 2, lat: 48 };
  const cB: PlaceRef = { kind: "custom", id: "b", name: "Lake", countryId: "FR", lon: 9, lat: 45 };
  it("a leg between two custom pins draws an arc and contributes distance", async () => {
    const { tripPathKm } = await import("../../src/features/travel/distance");
    expect(stopsArcs([cA, cB], ref, "car").features).toHaveLength(1);
    expect(tripPathKm([cA, cB], ref).km).toBeGreaterThan(0);
    expect(tripPathKm([cA, cB], ref).unresolvedLegs).toBe(0);
  });
});

describe("stopsArcs tags each leg with its own mode", () => {
  it("uses legModes[i] when present, else the trip default", () => {
    const fc = stopsArcs([P, T, O], ref, "flight", ["flight", "train"]);
    expect(fc.features.map((f) => f.properties!.mode)).toEqual(["flight", "train"]);
    // No per-leg array → every arc uses the default.
    expect(stopsArcs([P, T, O], ref, "car").features.map((f) => f.properties!.mode)).toEqual(["car", "car"]);
  });
});

describe("travelTotals splits distance by per-leg transport", () => {
  it("sums each leg's km under its own mode; counts the trip under each mode used", () => {
    const trip = {
      tripId: "t1",
      from: P,
      to: O,
      stops: [P, T, O],
      mode: "flight" as TravelMode,
      legModes: ["flight", "train"] as TravelMode[],
      date: null,
      addedAt: new Date(0).toISOString(),
    } as Trip;
    const tot = travelTotals([trip], ref);
    const byMode = Object.fromEntries(tot.byMode.map((m) => [m.mode, m]));
    expect(byMode.flight!.km).toBeGreaterThan(0); // Paris→Tokyo
    expect(byMode.train!.km).toBeGreaterThan(0); // Tokyo→Osaka
    expect(byMode.train!.km).toBeLessThan(byMode.flight!.km); // the short leg
    expect(byMode.flight!.trips).toBe(1);
    expect(byMode.train!.trips).toBe(1);
    // Total is the sum of both legs.
    expect(tot.totalKm).toBeCloseTo(byMode.flight!.km + byMode.train!.km, 3);
  });
});

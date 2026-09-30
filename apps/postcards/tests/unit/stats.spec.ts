import { describe, it, expect } from "vitest";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import {
  computeCoverage,
  computeCityBands,
  computeCountryCoverage,
  computeContinentCoverage,
  countryDetail,
  visitedCountriesList,
  visitedCountryIds,
} from "../../src/features/stats/computeStats";
import type { Visit } from "../../src/lib/schema/models";
import type { City } from "../../src/lib/reference/types";

const ref = getReferenceData();

function visitOf(city: City): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "city", id: city.id, name: city.name, countryId: city.countryIso2 },
    date: null,
    note: null,
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  };
}

const paris = ref.searchCities("Paris")[0]!; // most populous Paris = Paris, FR
const lyon = ref.searchCities("Lyon")[0]!;
const tokyo = ref.searchCities("Tokyo")[0]!;

describe("coverage statistics (real gazetteer)", () => {
  const visits = [visitOf(paris), visitOf(lyon), visitOf(tokyo)];

  it("resolves the expected reference cities", () => {
    expect(paris.countryIso2).toBe("FR");
    expect(paris.id).toBe("2988507"); // GeoNames id from the contract example
    expect(lyon.countryIso2).toBe("FR");
    expect(tokyo.countryIso2).toBe("JP");
  });

  it("counts countries, cities and % of world", () => {
    const cov = computeCoverage(visits, ref);
    expect(cov.countriesVisited).toBe(2); // FR, JP
    expect(cov.citiesVisited).toBe(3);
    expect(cov.worldCountryCount).toBeGreaterThan(190);
    expect(cov.worldPct).toBeCloseTo(2 / cov.worldCountryCount, 6);
  });

  it("reports big-city coverage against the whole gazetteer (headline bar)", () => {
    const cov = computeCoverage(visits, ref);
    // The gazetteer is a large worldwide set (15k+ people), so the denominator is
    // in the tens of thousands and three cities is a sliver of it.
    expect(cov.worldCityCount).toBeGreaterThan(10_000);
    expect(cov.cityPct).toBeCloseTo(cov.citiesVisited / cov.worldCityCount, 9);
    expect(cov.cityPct).toBeGreaterThan(0);
    expect(cov.cityPct).toBeLessThan(0.01);
  });

  it("buckets visited cities by size (megacity / large / town)", () => {
    const bands = computeCityBands(visits, ref);
    expect(bands.total).toBe(3);
    expect(bands.mega).toBe(2); // Paris + Tokyo are both 1M+
    expect(bands.large + bands.small).toBe(1); // Lyon is below 1M
    expect(bands.mega + bands.large + bands.small).toBe(bands.total);
  });

  it("computes BOTH per-country metrics against real denominators", () => {
    const country = ref.countryByIso2("FR")!;
    expect(country.cityCount).toBeGreaterThan(500); // full FR gazetteer loaded
    expect(country.subdivisionCount).toBe(13);
    const fr = computeCountryCoverage(visits, ref, "FR");
    expect(fr.citiesVisited).toBe(2);
    expect(fr.citiesTotal).toBe(country.cityCount);
    expect(fr.regionsVisited).toBe(2); // Île-de-France + Auvergne-Rhône-Alpes
    expect(fr.cityPct).toBeCloseTo(2 / country.cityCount, 6);
    expect(fr.regionPct).toBeCloseTo(2 / 13, 6);
  });

  it("computes big-city (100k+) coverage as a generous subset of all cities", () => {
    const fr = computeCountryCoverage(visits, ref, "FR");
    // Paris (~2.1M) and Lyon (~0.5M) are both 100k+, so both count as big cities.
    expect(fr.bigCitiesVisited).toBe(2);
    // Big cities are a strict subset of the country's gazetteer cities…
    expect(fr.bigCitiesTotal).toBeGreaterThan(0);
    expect(fr.bigCitiesTotal).toBeLessThan(fr.citiesTotal);
    expect(fr.bigCitiesTotal).toBeGreaterThanOrEqual(fr.bigCitiesVisited);
    expect(fr.bigCityPct).toBeCloseTo(fr.bigCitiesVisited / fr.bigCitiesTotal, 9);
    // …so the same two visits read as much more progress than against every town.
    expect(fr.bigCityPct).toBeGreaterThan(fr.cityPct);
    expect(fr.bigCityPct).toBeLessThanOrEqual(1);
  });

  it("never exceeds 100%: cities outside the gazetteer don't count", () => {
    const unknown: Visit = {
      visitId: crypto.randomUUID(),
      place: { kind: "city", id: "not-in-dataset", name: "Somewhere", countryId: "FR" },
      date: null,
      note: null,
      status: "visited" as const,
      favorite: false,
      addedAt: new Date().toISOString(),
    };
    const fr = computeCountryCoverage([visitOf(paris), unknown], ref, "FR");
    expect(fr.citiesVisited).toBe(1);
    expect(fr.cityPct).toBeLessThanOrEqual(1);
  });

  it("computes continent coverage from visited countries", () => {
    const cov = computeContinentCoverage(visits, ref);
    const europe = cov.find((c) => c.continent === "Europe");
    const asia = cov.find((c) => c.continent === "Asia");
    expect(europe?.visited).toBe(1);
    expect(asia?.visited).toBe(1);
    expect(europe!.total).toBeGreaterThan(30);
    expect(europe!.pct).toBeCloseTo(1 / europe!.total, 6);
  });

  it("drill-down lists visited city and region names", () => {
    const d = countryDetail(visits, ref, "FR");
    const cityNames = d.cities.map((c) => c.name);
    expect(cityNames).toContain("Paris");
    expect(cityNames).toContain("Lyon");
    // Every drill-down city carries its id, so the UI can open the city page.
    expect(d.cities.every((c) => c.id.length > 0)).toBe(true);
    expect(d.regionsVisited).toContain("Île-de-France");
    expect(d.regionsRemaining).toBe(11);
  });

  it("sorts the by-country list by coverage", () => {
    const list = visitedCountriesList(visits, ref, "cities");
    expect(list[0]!.iso2).toBe("FR"); // 2 cities beats 1
  });

  it("wishlist records never count as visited", () => {
    const wish: Visit = { ...visitOf(tokyo), status: "wishlist" };
    const cov = computeCoverage([visitOf(paris), wish], ref);
    expect(cov.countriesVisited).toBe(1); // FR only — wished Tokyo doesn't count
    expect(cov.citiesVisited).toBe(1);
    const jp = computeCountryCoverage([wish], ref, "JP");
    expect(jp.citiesVisited).toBe(0);
  });
});

describe("railway stations in coverage (spec 021)", () => {
  const stationVisit = (id: string, country: string): Visit => ({
    visitId: crypto.randomUUID(),
    place: { kind: "station", id, name: id, countryId: country },
    date: null,
    note: null,
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  });

  it("counts distinct visited stations as their own KPI", () => {
    const cov = computeCoverage([stationVisit("Q1", "FR"), stationVisit("Q2", "JP")], ref);
    expect(cov.stationsVisited).toBe(2);
  });

  it("a station does NOT mark its country visited (like an airport)", () => {
    expect(visitedCountryIds([stationVisit("Q1", "FR")]).has("FR")).toBe(false);
    expect(computeCoverage([stationVisit("Q1", "FR")], ref).countriesVisited).toBe(0);
  });

  it("a city still counts its country even alongside a station there", () => {
    const cov = computeCoverage([visitOf(paris), stationVisit("Q1", "FR")], ref);
    expect(cov.countriesVisited).toBe(1); // FR — via the city, never the station
    expect(cov.stationsVisited).toBe(1);
  });
});

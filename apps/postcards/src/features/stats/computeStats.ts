import type { Visit } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { BIG_CITY_MIN_POPULATION, MEGA_CITY_MIN_POPULATION } from "../../lib/reference/types";
import { inScope, type CountryScope } from "../../lib/reference/scope";

/** Whether a visited country id counts under the chosen scope (unknown ids: only under "all"). */
function countryInScope(ref: ReferenceData, iso2: string, scope: CountryScope): boolean {
  const c = ref.countryByIso2(iso2);
  return c ? inScope(c.sovereignty, scope) : scope === "all";
}

export interface Coverage {
  countriesVisited: number;
  worldCountryCount: number;
  worldPct: number; // 0..1
  citiesVisited: number;
  /** Every city in the gazetteer (GeoNames, 15k+ people) counted under the scope —
   *  the denominator for the headline "big cities visited" bar. */
  worldCityCount: number;
  cityPct: number; // 0..1 — citiesVisited / worldCityCount
  airportsVisited: number;
  monumentsVisited: number;
  stationsVisited: number;
}

// A "big city" is population ≥ BIG_CITY_MIN_POPULATION (100k, the "large" band
// floor, defined in reference/types). The per-country Cities % is measured against
// every 15k+ gazetteer town, so for a big country it's a demotivating sliver; the
// Big cities % is the achievable "how much of the notable ones have I done" metric.

export interface CountryCoverage {
  iso2: string;
  name: string;
  citiesVisited: number;
  citiesTotal: number;
  cityPct: number; // 0..1
  /** Cities with 100k+ people — the notable ones (see BIG_CITY_MIN_POPULATION). */
  bigCitiesVisited: number;
  bigCitiesTotal: number;
  bigCityPct: number; // 0..1
  /** Cities with 1M+ people — the metropolises (see MEGA_CITY_MIN_POPULATION).
   *  Only meaningful when megaCitiesTotal > 0 (many countries have none). */
  megaCitiesVisited: number;
  megaCitiesTotal: number;
  megaCityPct: number; // 0..1
  regionsVisited: number;
  regionsTotal: number;
  regionPct: number; // 0..1
  heritageVisited: number;
  heritageTotal: number;
  heritagePct: number; // 0..1
  stationsVisited: number;
  stationsTotal: number;
  stationPct: number; // 0..1
}

function pct(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/** Coverage counts only places actually visited — never the wishlist. */
function onlyVisited(visits: Visit[]): Visit[] {
  return visits.filter((v) => v.status !== "wishlist");
}

/** Distinct country ids across visited records (a city visit implies its
 *  country). Airports and railway stations deliberately do NOT count: changing
 *  planes — or trains — in a country is not visiting it. */
export function visitedCountryIds(visits: Visit[]): Set<string> {
  return new Set(
    onlyVisited(visits)
      .filter(
        (v) => v.place.kind !== "airport" && v.place.kind !== "station" && v.place.countryId !== "ZZ",
      )
      .map((v) => v.place.countryId),
  );
}

export function computeCoverage(
  visits: Visit[],
  ref: ReferenceData,
  scope: CountryScope = "all",
): Coverage {
  const countriesVisited = [...visitedCountryIds(visits)].filter((iso2) =>
    countryInScope(ref, iso2, scope),
  ).length;
  const cityIds = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "city")
      .map((v) => v.place.id),
  );
  const airportIds = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "airport")
      .map((v) => v.place.id),
  );
  const monumentIds = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "heritage")
      .map((v) => v.place.id),
  );
  const stationIds = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "station")
      .map((v) => v.place.id),
  );
  const worldCountryCount = ref.worldCountryCount(scope);
  // World gazetteer-city total = the sum of every in-scope country's cityCount
  // (metadata, so it's the FULL count regardless of which cities are lazily
  // loaded). This is the denominator for the "big cities" headline coverage bar.
  let worldCityCount = 0;
  for (const c of ref.countries) {
    if (inScope(c.sovereignty, scope)) worldCityCount += c.cityCount;
  }
  return {
    countriesVisited,
    worldCountryCount,
    worldPct: pct(countriesVisited, worldCountryCount),
    citiesVisited: cityIds.size,
    worldCityCount,
    cityPct: pct(cityIds.size, worldCityCount),
    airportsVisited: airportIds.size,
    monumentsVisited: monumentIds.size,
    stationsVisited: stationIds.size,
  };
}

export interface CityBands {
  mega: number; // >= 1,000,000
  large: number; // 100,000 .. 999,999
  small: number; // < 100,000 (the gazetteer floor is ~15,000)
  total: number; // distinct visited gazetteer cities counted here
}

/** Distribution of your visited cities by size — a dense "what kind of traveller
 *  are you" summary (megacities vs towns) for the Stats screen. Counts distinct
 *  gazetteer cities only; custom pins and airports have no population and don't
 *  count here. */
export function computeCityBands(visits: Visit[], ref: ReferenceData): CityBands {
  const seen = new Set<string>();
  let mega = 0;
  let large = 0;
  let small = 0;
  for (const v of onlyVisited(visits)) {
    if (v.place.kind !== "city" || seen.has(v.place.id)) continue;
    const c = ref.cityById(v.place.id);
    if (!c) continue;
    seen.add(v.place.id);
    const p = c.population ?? 0;
    if (p >= 1_000_000) mega++;
    else if (p >= 100_000) large++;
    else small++;
  }
  return { mega, large, small, total: mega + large + small };
}

/** Both per-country metrics: % of the country's cities AND % of its regions (FR-007). */
export function computeCountryCoverage(
  visits: Visit[],
  ref: ReferenceData,
  iso2: string,
): CountryCoverage {
  const country = ref.countryByIso2(iso2);
  const visitedCityIds = new Set<string>();
  const visitedBigCityIds = new Set<string>();
  const visitedMegaCityIds = new Set<string>();
  const visitedRegionIds = new Set<string>();
  for (const v of onlyVisited(visits)) {
    if (v.place.kind !== "city") continue;
    // Only count cities that exist in this country's gazetteer, so the numerator
    // can never exceed the denominator (imported cities outside the dataset don't inflate %).
    const city = ref.cityById(v.place.id);
    if (!city || city.countryIso2 !== iso2) continue;
    visitedCityIds.add(v.place.id);
    const pop = city.population ?? 0;
    if (pop >= BIG_CITY_MIN_POPULATION) visitedBigCityIds.add(v.place.id);
    if (pop >= MEGA_CITY_MIN_POPULATION) visitedMegaCityIds.add(v.place.id);
    if (city.subdivisionId) visitedRegionIds.add(city.subdivisionId);
  }
  // Denominator: how many 100k+ cities the country has. Precomputed in one pass
  // over the gazetteer (Country.bigCityCount), so this is an O(1) lookup — never a
  // per-country rescan. Like cityCount it's refreshed when the full gazetteer lands.
  const bigCitiesTotal = country?.bigCityCount ?? 0;
  const megaCitiesTotal = country?.megaCityCount ?? 0;
  // Heritage sites (a "category"): visited sites in this country vs the total there.
  // Membership is by the country's own site list (heritageOf), so a transnational
  // site that spans several countries counts toward each — matching the denominator.
  const heritageIdsHere = new Set(ref.heritageOf(iso2).map((h) => h.id));
  const heritageTotal = heritageIdsHere.size;
  const heritageVisited = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "heritage" && heritageIdsHere.has(v.place.id))
      .map((v) => v.place.id),
  ).size;
  // Railway stations in this country vs its total, by the country's own station
  // list (stationsOf) — same shape as heritage. Stations don't mark the country
  // visited, but "how many of its stations have I passed through" is a fair metric.
  const stationIdsHere = new Set(ref.stationsOf(iso2).map((s) => s.id));
  const stationsTotal = stationIdsHere.size;
  const stationsVisited = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "station" && stationIdsHere.has(v.place.id))
      .map((v) => v.place.id),
  ).size;

  const citiesTotal = country?.cityCount ?? 0;
  const regionsTotal = country?.subdivisionCount ?? 0;
  return {
    iso2,
    name: country?.name ?? iso2,
    citiesVisited: visitedCityIds.size,
    citiesTotal,
    cityPct: pct(visitedCityIds.size, citiesTotal),
    bigCitiesVisited: visitedBigCityIds.size,
    bigCitiesTotal,
    bigCityPct: pct(visitedBigCityIds.size, bigCitiesTotal),
    megaCitiesVisited: visitedMegaCityIds.size,
    megaCitiesTotal,
    megaCityPct: pct(visitedMegaCityIds.size, megaCitiesTotal),
    regionsVisited: visitedRegionIds.size,
    regionsTotal,
    regionPct: pct(visitedRegionIds.size, regionsTotal),
    heritageVisited,
    heritageTotal,
    heritagePct: pct(heritageVisited, heritageTotal),
    stationsVisited,
    stationsTotal,
    stationPct: pct(stationsVisited, stationsTotal),
  };
}

export interface ContinentCoverage {
  continent: string;
  visited: number;
  total: number;
  pct: number; // 0..1
}

/** Countries visited per continent, against each continent's full country count. */
export function computeContinentCoverage(
  visits: Visit[],
  ref: ReferenceData,
  scope: CountryScope = "all",
): ContinentCoverage[] {
  const totals = new Map<string, number>();
  for (const c of ref.countries) {
    if (!c.continent || !inScope(c.sovereignty, scope)) continue;
    totals.set(c.continent, (totals.get(c.continent) ?? 0) + 1);
  }
  const visitedByContinent = new Map<string, Set<string>>();
  for (const iso2 of visitedCountryIds(visits)) {
    if (!countryInScope(ref, iso2, scope)) continue;
    const continent = ref.countryByIso2(iso2)?.continent;
    if (!continent) continue;
    if (!visitedByContinent.has(continent)) visitedByContinent.set(continent, new Set());
    visitedByContinent.get(continent)!.add(iso2);
  }
  return [...visitedByContinent.entries()]
    .map(([continent, set]) => {
      const total = totals.get(continent) ?? 0;
      return { continent, visited: set.size, total, pct: pct(set.size, total) };
    })
    .sort((a, b) => b.visited - a.visited || a.continent.localeCompare(b.continent));
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface CountryDetail {
  /** Visited cities here, with ids so the UI can open each city's page. */
  cities: NamedRef[];
  regionsVisited: string[];
  regionsRemaining: number;
  /** Names of the country's first-level regions not yet visited (what's left to see). */
  regionsRemainingNames: string[];
  monumentsVisited: NamedRef[];
  monumentsRemaining: NamedRef[];
}

/** Names behind a country's numbers: visited cities + covered regions + monuments,
 *  and — the headline for "what's left" — the NAMES of the regions still to visit. */
export function countryDetail(visits: Visit[], ref: ReferenceData, iso2: string): CountryDetail {
  const cities: NamedRef[] = [];
  const regionIds = new Set<string>();
  for (const v of onlyVisited(visits)) {
    if (v.place.kind !== "city") continue;
    const city = ref.cityById(v.place.id);
    if (!city || city.countryIso2 !== iso2) continue;
    cities.push({ id: city.id, name: city.name });
    if (city.subdivisionId) regionIds.add(city.subdivisionId);
  }
  cities.sort((a, b) => a.name.localeCompare(b.name));
  const regionsVisited = [...regionIds]
    .map((id) => ref.subdivisionById(id)?.name ?? id)
    .sort((a, b) => a.localeCompare(b));
  const allSubs = ref.subdivisionsOf(iso2);
  const regionsRemainingNames = allSubs
    .filter((s) => !regionIds.has(s.id))
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b));
  const totalRegions = ref.countryByIso2(iso2)?.subdivisionCount ?? 0;

  // Monuments (heritage) visited here vs the rest of the country's list.
  const visitedMonumentIds = new Set(
    onlyVisited(visits)
      .filter((v) => v.place.kind === "heritage")
      .map((v) => v.place.id),
  );
  const here = ref.heritageOf(iso2);
  const monumentsVisited = here
    .filter((h) => visitedMonumentIds.has(h.id))
    .map((h) => ({ id: h.id, name: h.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const monumentsRemaining = here
    .filter((h) => !visitedMonumentIds.has(h.id))
    .map((h) => ({ id: h.id, name: h.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    cities,
    regionsVisited,
    regionsRemaining: Math.max(0, totalRegions - regionIds.size),
    regionsRemainingNames,
    monumentsVisited,
    monumentsRemaining,
  };
}

export interface TravelRecords {
  northernmost: { name: string; iso2: string; lat: number } | null;
  southernmost: { name: string; iso2: string; lat: number } | null;
  biggestCity: { name: string; iso2: string; population: number } | null;
  firstVisit: { name: string; date: string } | null;
  latestVisit: { name: string; date: string } | null;
}

/** Fun superlatives across visited cities (dates use the visit's own date field).
 *  City records carry their country's iso2 so the UI can fly the map to them. */
export function computeRecords(visits: Visit[], ref: ReferenceData): TravelRecords {
  let north: { name: string; iso2: string; lat: number } | null = null;
  let south: { name: string; iso2: string; lat: number } | null = null;
  let biggest: { name: string; iso2: string; population: number } | null = null;
  let first: { name: string; date: string } | null = null;
  let latest: { name: string; date: string } | null = null;
  for (const v of onlyVisited(visits)) {
    if (v.date) {
      if (!first || v.date < first.date) first = { name: v.place.name, date: v.date };
      if (!latest || v.date > latest.date) latest = { name: v.place.name, date: v.date };
    }
    if (v.place.kind !== "city") continue;
    const c = ref.cityById(v.place.id);
    if (!c) continue;
    if (!north || c.lat > north.lat) north = { name: c.name, iso2: c.countryIso2, lat: c.lat };
    if (!south || c.lat < south.lat) south = { name: c.name, iso2: c.countryIso2, lat: c.lat };
    if (c.population != null && (!biggest || c.population > biggest.population)) {
      biggest = { name: c.name, iso2: c.countryIso2, population: c.population };
    }
  }
  return { northernmost: north, southernmost: south, biggestCity: biggest, firstVisit: first, latestVisit: latest };
}

export type CountrySort = "cities" | "regions" | "name";

/** Countries with recorded visits, sorted by the chosen key, for the stats list. */
export function visitedCountriesList(
  visits: Visit[],
  ref: ReferenceData,
  sortBy: CountrySort = "cities",
  scope: CountryScope = "all",
): CountryCoverage[] {
  const list = [...visitedCountryIds(visits)]
    .filter((iso2) => countryInScope(ref, iso2, scope))
    .map((iso2) => computeCountryCoverage(visits, ref, iso2));
  const byName = (a: CountryCoverage, b: CountryCoverage) => a.name.localeCompare(b.name);
  const cmp: Record<CountrySort, (a: CountryCoverage, b: CountryCoverage) => number> = {
    cities: (a, b) => b.citiesVisited - a.citiesVisited || byName(a, b),
    regions: (a, b) => b.regionsVisited - a.regionsVisited || byName(a, b),
    name: byName,
  };
  return list.sort(cmp[sortBy]);
}

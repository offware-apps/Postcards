import { describe, it, expect, beforeEach } from "vitest";
import { browseList, __resetBrowseCache } from "../../src/features/visits/browseList";
import { DEFAULT_FILTERS } from "../../src/lib/store/useFilters";
import type { ReferenceData, City, HeritageSite, Airport, Country } from "../../src/lib/reference/types";
import type { Visit } from "../../src/lib/schema/models";
import { getReferenceData } from "../../src/lib/reference/referenceData";

const cities: City[] = [
  { id: "paris", name: "Paris", countryIso2: "FR", subdivisionId: null, lat: 48.85, lon: 2.35, population: 2_100_000 },
  { id: "lyon", name: "Lyon", countryIso2: "FR", subdivisionId: null, lat: 45.75, lon: 4.85, population: 500_000 },
  { id: "tokyo", name: "Tokyo", countryIso2: "JP", subdivisionId: null, lat: 35.68, lon: 139.69, population: 9_000_000 },
];
const heritage: HeritageSite[] = [
  { id: "h1", name: "Mont-Saint-Michel", countryIso2: "FR", lat: 48.6, lon: -1.5, category: "cultural" },
  { id: "h2", name: "Yakushima", countryIso2: "JP", lat: 30.3, lon: 130.5, category: "natural" },
];
const airports: Airport[] = [
  { id: "CDG", name: "Charles de Gaulle", city: "Paris", countryIso2: "FR", lat: 49, lon: 2.5 },
  { id: "HND", name: "Haneda", city: "Tokyo", countryIso2: "JP", lat: 35.5, lon: 139.8 },
];
const countries: Record<string, Country> = {
  FR: { iso2: "FR", iso3: "FRA", numeric: "250", name: "France", continent: "Europe", cityCount: 2, bigCityCount: 2, megaCityCount: 1, subdivisionCount: 1, sovereignty: "un" },
  JP: { iso2: "JP", iso3: "JPN", numeric: "392", name: "Japan", continent: "Asia", cityCount: 1, bigCityCount: 1, megaCityCount: 1, subdivisionCount: 1, sovereignty: "un" },
};

const lc = (s: string) => s.toLowerCase();
const ref = {
  allCities: () => cities,
  cityById: (id: string) => cities.find((c) => c.id === id),
  allHeritage: () => heritage,
  allAirports: () => airports,
  citiesOf: (iso2: string) =>
    cities.filter((c) => c.countryIso2 === iso2).sort((a, b) => (b.population ?? 0) - (a.population ?? 0)),
  heritageOf: (iso2: string) => heritage.filter((h) => h.countryIso2 === iso2),
  searchCities: (q: string) => cities.filter((c) => lc(c.name).includes(lc(q))),
  searchHeritage: (q: string) => heritage.filter((h) => lc(h.name).includes(lc(q))),
  searchAirports: (q: string) => airports.filter((a) => lc(a.name).includes(lc(q)) || lc(a.id) === lc(q)),
  searchCountries: (q: string) => Object.values(countries).filter((c) => lc(c.name).includes(lc(q))),
  countryByIso2: (iso2: string) => countries[iso2],
  continentOf: (iso2: string) => countries[iso2]?.continent ?? "",
} as unknown as ReferenceData;

const visit = (
  kind: "city" | "heritage" | "airport",
  id: string,
  status: "visited" | "wishlist",
  favorite = false,
): Visit =>
  ({ visitId: `v-${id}`, place: { kind, id, name: id, countryId: "FR" }, status, favorite }) as Visit;

const F = DEFAULT_FILTERS;
const bl = (...args: Parameters<typeof browseList>) => browseList(...args).rows;

beforeEach(() => __resetBrowseCache());

describe("browseList — reference browse + personal status overlay (spec 018 US2)", () => {
  it("lists ALL reference cities, most-populous first, marked not-visited by default", () => {
    const rows = bl("cities", "all", F, ref, [], "");
    expect(rows.map((r) => r.id)).toEqual(["tokyo", "paris", "lyon"]); // population-ranked
    expect(rows.every((r) => r.status === "none")).toBe(true);
  });

  it("overlays personal status from visits", () => {
    const rows = bl("cities", "all", F, ref, [visit("city", "tokyo", "visited")], "");
    expect(rows.find((r) => r.id === "tokyo")?.status).toBe("visited");
    expect(rows.find((r) => r.id === "paris")?.status).toBe("none");
  });

  it("status = notVisited excludes anything you've logged", () => {
    const rows = bl("cities", "notVisited", F, ref, [visit("city", "tokyo", "visited")], "");
    expect(rows.map((r) => r.id)).not.toContain("tokyo");
    expect(rows.map((r) => r.id)).toEqual(["paris", "lyon"]);
  });

  it("status = visited / wishlist / favorites filter the overlay", () => {
    const visits = [visit("city", "tokyo", "visited", true), visit("city", "paris", "wishlist")];
    expect(bl("cities", "visited", F, ref, visits, "").map((r) => r.id)).toEqual(["tokyo"]);
    expect(bl("cities", "wishlist", F, ref, visits, "").map((r) => r.id)).toEqual(["paris"]);
    expect(bl("cities", "favorites", F, ref, visits, "").map((r) => r.id)).toEqual(["tokyo"]);
  });

  it("search narrows within the kind", () => {
    expect(bl("cities", "all", F, ref, [], "tok").map((r) => r.id)).toEqual(["tokyo"]);
  });

  it("monuments carry their category; the category filter narrows them", () => {
    const all = bl("monuments", "all", F, ref, [], "");
    expect(all.find((r) => r.id === "h1")?.category).toBe("cultural");
    const cultural = bl("monuments", "all", { ...F, category: "cultural" }, ref, [], "");
    expect(cultural.map((r) => r.id)).toEqual(["h1"]);
  });

  it("airports browse the world, name includes the IATA code", () => {
    const rows = bl("airports", "all", F, ref, [], "");
    expect(rows.map((r) => r.id).sort()).toEqual(["CDG", "HND"]);
    expect(rows.find((r) => r.id === "CDG")?.name).toContain("(CDG)");
  });

  it("monuments & airports are searchable BY COUNTRY (FR-007)", () => {
    // "France" matches no monument NAME, but France's site (h1) surfaces by country.
    const mon = bl("monuments", "all", F, ref, [], "France");
    expect(mon.map((r) => r.id)).toContain("h1");
    expect(mon.map((r) => r.id)).not.toContain("h2"); // Japan's site excluded
    // "Japan" surfaces Japanese airports by country (HND), not French ones (CDG).
    const air = bl("airports", "all", F, ref, [], "Japan");
    expect(air.map((r) => r.id)).toContain("HND");
    expect(air.map((r) => r.id)).not.toContain("CDG");
  });

  it("continent filter narrows every kind", () => {
    const rows = bl("cities", "all", { ...F, continent: "Asia" }, ref, [], "");
    expect(rows.map((r) => r.id)).toEqual(["tokyo"]);
  });

  it("country filter scopes every kind to one country (stats drill-down)", () => {
    const fr = { ...F, country: "FR" };
    // Cities drill from the country's own list (all of them), population-desc.
    expect(bl("cities", "all", fr, ref, [], "").map((r) => r.id)).toEqual(["paris", "lyon"]);
    expect(bl("monuments", "all", fr, ref, [], "").map((r) => r.id)).toEqual(["h1"]);
    expect(bl("airports", "all", fr, ref, [], "").map((r) => r.id)).toEqual(["CDG"]);
    // Country + population tier compose: only FR cities over the threshold.
    expect(bl("cities", "all", { ...fr, minPop: 1_000_000 }, ref, [], "").map((r) => r.id)).toEqual(["paris"]);
  });

  it("pages with a limit and reports hasMore (uncapped load-more, perf)", () => {
    // 3 cities in the pool; a limit of 2 materialises 2 rows and flags more remain.
    const page1 = browseList("cities", "all", F, ref, [], "", 2);
    expect(page1.rows.map((r) => r.id)).toEqual(["tokyo", "paris"]); // population-ranked page
    expect(page1.hasMore).toBe(true);
    // Raising the limit reveals the rest with nothing left over.
    const page2 = browseList("cities", "all", F, ref, [], "", 5);
    expect(page2.rows.map((r) => r.id)).toEqual(["tokyo", "paris", "lyon"]);
    expect(page2.hasMore).toBe(false);
    // Only the requested rows are built — never the whole pool.
    expect(browseList("airports", "all", F, ref, [], "", 1).rows).toHaveLength(1);
    expect(browseList("airports", "all", F, ref, [], "", 1).hasMore).toBe(true);
  });
});

describe("browseList — your own cities beyond the populous pool", () => {
  it("status = visited / wishlist / favorites list a small town you logged", () => {
    const world = getReferenceData();
    const town = [...world.allCities()].sort((a, b) => (a.population ?? 0) - (b.population ?? 0))[0]!;
    const v = (status: "visited" | "wishlist", favorite = false): Visit =>
      ({
        visitId: `v-${town.id}`,
        place: { kind: "city", id: town.id, name: town.name, countryId: town.countryIso2 },
        status,
        favorite,
      }) as Visit;
    expect(bl("cities", "visited", F, world, [v("visited")], "").map((r) => r.id)).toEqual([town.id]);
    expect(bl("cities", "wishlist", F, world, [v("wishlist")], "").map((r) => r.id)).toEqual([town.id]);
    expect(bl("cities", "favorites", F, world, [v("visited", true)], "").map((r) => r.id)).toEqual([town.id]);
  });

  it("orders your cities most-populous first, like the pool", () => {
    const visits = [visit("city", "lyon", "visited"), visit("city", "tokyo", "visited")];
    expect(bl("cities", "visited", F, ref, visits, "").map((r) => r.id)).toEqual(["tokyo", "lyon"]);
  });
});

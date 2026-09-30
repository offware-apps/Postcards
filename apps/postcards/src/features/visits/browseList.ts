import type { City, HeritageSite, ReferenceData, Station } from "../../lib/reference/types";
import type { PlaceRef, Visit } from "../../lib/schema/models";
import { visitIndex } from "../../lib/store/useVisits";
import { placeKey } from "../../lib/schema/helpers";
import type { FilterState } from "../../lib/store/useFilters";

// The unified browse engine (spec 018 US2): given a place KIND and a STATUS/scope,
// list the reference places (the whole world) with each row's personal status
// overlaid from the user's records. Pure & offline — reads only the passed-in
// reference data + visits, invents nothing (Constitution I).
//
// Paged & UNCAPPED (perf): the ordered base pools are built ONCE (memoised), and a
// call materialises only up to `limit` rows for the current page — so a visit
// toggle or a filter change never rebuilds thousands of row objects (that was the
// list lag). `hasMore` drives an infinite "load more": raise the limit to reveal
// the next page. Only the visible rows are ever built.

export type BrowseKind = "cities" | "monuments" | "airports" | "stations";
/** The single status axis, mapped to a browse predicate. */
export type BrowseStatus = "all" | "visited" | "wishlist" | "favorites" | "notVisited";

export interface BrowseRow {
  kind: PlaceRef["kind"];
  id: string;
  name: string;
  /** Secondary line — country (+ city for airports), + category tag handled by the UI. */
  sub: string;
  countryIso2: string;
  place: PlaceRef;
  status: "visited" | "wishlist" | "none";
  favorite: boolean;
  category?: string;
}

/** A page of browse rows plus whether more remain (drives infinite load-more). */
export interface BrowseResult {
  rows: BrowseRow[];
  hasMore: boolean;
}

/** How many most-populous cities to keep browsable (the notable-cities pool; smaller
 *  towns are reached via search). Airports & monuments are browsed in full. */
const CITY_POOL = 2000;

// The ordered base pools are expensive to build (a sort over the gazetteer), so
// they're memoised at module scope, re-derived only when a dataset's size changes
// (it streams in once). Keyed by source length — a cheap generation proxy. Building
// them "beforehand" (once) is what keeps paging cheap.
let cityPool: { srcLen: number; cities: City[] } | null = null;
function populousCities(ref: ReferenceData): City[] {
  const all = ref.allCities();
  if (cityPool && cityPool.srcLen === all.length) return cityPool.cities;
  const sorted = [...all].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, CITY_POOL);
  cityPool = { srcLen: all.length, cities: sorted };
  return sorted;
}

let monPool: { srcLen: number; sites: HeritageSite[] } | null = null;
function sortedMonuments(ref: ReferenceData): HeritageSite[] {
  const all = ref.allHeritage();
  if (monPool && monPool.srcLen === all.length) return monPool.sites;
  const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
  monPool = { srcLen: all.length, sites: sorted };
  return sorted;
}

let staPool: { srcLen: number; stations: Station[] } | null = null;
function sortedStations(ref: ReferenceData): Station[] {
  const all = ref.allStations();
  if (staPool && staPool.srcLen === all.length) return staPool.stations;
  const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
  staPool = { srcLen: all.length, stations: sorted };
  return sorted;
}

/** Reset the memoised pools (tests only). */
export function __resetBrowseCache(): void {
  cityPool = null;
  monPool = null;
  staPool = null;
}

export function browseList(
  kind: BrowseKind,
  status: BrowseStatus,
  filter: FilterState,
  ref: ReferenceData,
  visits: Visit[],
  query: string,
  limit = Infinity,
): BrowseResult {
  const idx = visitIndex(visits);
  const q = query.trim();

  const overlay = (place: PlaceRef) => {
    const v = idx.get(placeKey(place));
    if (!v) return { status: "none" as const, favorite: false };
    return { status: (v.status === "wishlist" ? "wishlist" : "visited") as "visited" | "wishlist", favorite: !!v.favorite };
  };
  const passStatus = (s: "visited" | "wishlist" | "none", fav: boolean): boolean => {
    switch (status) {
      case "visited": return s === "visited";
      case "wishlist": return s === "wishlist";
      case "favorites": return fav;
      case "notVisited": return s === "none";
      default: return true; // "all"
    }
  };
  const continentOk = (iso2: string) => !filter.continent || ref.continentOf(iso2) === filter.continent;
  const countryOk = (iso2: string) => !filter.country || iso2 === filter.country;
  const countryName = (iso2: string) => ref.countryByIso2(iso2)?.name ?? iso2;

  const rows: BrowseRow[] = [];
  let hasMore = false;
  // Materialise up to `limit` rows; the first passing item beyond it just flips
  // `hasMore` (never built), so the scan stops early and no extra objects allocate.
  const take = (row: BrowseRow): boolean => {
    if (rows.length >= limit) {
      hasMore = true;
      return true; // stop
    }
    rows.push(row);
    return false;
  };

  if (kind === "cities") {
    // Country drill-down browses ALL of that country's cities (already population-
    // desc), not just the global top-2000 pool, so nothing is missing from it.
    const base: City[] = q
      ? ref.searchCities(q, 500)
      : filter.country
        ? ref.citiesOf(filter.country)
        : populousCities(ref);
    for (const c of base) {
      if (!countryOk(c.countryIso2)) continue;
      if (!continentOk(c.countryIso2)) continue;
      if (filter.minPop > 0 && (c.population ?? 0) < filter.minPop) continue;
      const place: PlaceRef = { kind: "city", id: c.id, name: c.name, countryId: c.countryIso2 };
      const o = overlay(place);
      if (!passStatus(o.status, o.favorite)) continue;
      if (take({
        kind: "city", id: c.id, name: c.name, sub: countryName(c.countryIso2),
        countryIso2: c.countryIso2, place, status: o.status, favorite: o.favorite,
      })) break;
    }
    return { rows, hasMore };
  }

  if (kind === "monuments") {
    let base: HeritageSite[] = q
      ? ref.searchHeritage(q, 500)
      : filter.country
        ? ref.heritageOf(filter.country)
        : sortedMonuments(ref);
    // Searchable BY COUNTRY (FR-007): a query that names a country surfaces that
    // country's sites, not only ones whose own name matches the query.
    if (q) {
      const iso2s = new Set(ref.searchCountries(q, 3).map((c) => c.iso2));
      if (iso2s.size) {
        const have = new Set(base.map((h) => h.id));
        base = [...base, ...ref.allHeritage().filter((h) => iso2s.has(h.countryIso2) && !have.has(h.id))];
      }
    }
    for (const h of base) {
      if (filter.category && h.category !== filter.category) continue;
      if (!countryOk(h.countryIso2)) continue;
      if (!continentOk(h.countryIso2)) continue;
      const place: PlaceRef = { kind: "heritage", id: h.id, name: h.name, countryId: h.countryIso2 };
      const o = overlay(place);
      if (!passStatus(o.status, o.favorite)) continue;
      if (take({
        kind: "heritage", id: h.id, name: h.name, sub: countryName(h.countryIso2),
        countryIso2: h.countryIso2, place, status: o.status, favorite: o.favorite, category: h.category,
      })) break;
    }
    return { rows, hasMore };
  }

  if (kind === "airports") {
    // airports — browsed in full (uncapped), paged by `limit`
    let base = q ? ref.searchAirports(q, 500) : ref.allAirports();
    // Searchable BY COUNTRY (FR-007): a query naming a country surfaces its airports.
    if (q) {
      const iso2s = new Set(ref.searchCountries(q, 3).map((c) => c.iso2));
      if (iso2s.size) {
        const have = new Set(base.map((a) => a.id));
        base = [...base, ...ref.allAirports().filter((a) => iso2s.has(a.countryIso2) && !have.has(a.id))];
      }
    }
    for (const a of base) {
      if (!countryOk(a.countryIso2)) continue;
      if (!continentOk(a.countryIso2)) continue;
      const name = `${a.name} (${a.id})`;
      const place: PlaceRef = { kind: "airport", id: a.id, name, countryId: a.countryIso2 };
      const o = overlay(place);
      if (!passStatus(o.status, o.favorite)) continue;
      if (take({
        kind: "airport", id: a.id, name, sub: [a.city, countryName(a.countryIso2)].filter(Boolean).join(" · "),
        countryIso2: a.countryIso2, place, status: o.status, favorite: o.favorite,
      })) break;
    }
    return { rows, hasMore };
  }

  // stations — browsed in full (uncapped), paged by `limit`. No short code and no
  // home-city on the record, so the row is just the name over its country.
  let base = q ? ref.searchStations(q, 500) : sortedStations(ref);
  // Searchable BY COUNTRY (FR-007): a query naming a country surfaces its stations.
  if (q) {
    const iso2s = new Set(ref.searchCountries(q, 3).map((c) => c.iso2));
    if (iso2s.size) {
      const have = new Set(base.map((s) => s.id));
      base = [...base, ...ref.allStations().filter((s) => iso2s.has(s.countryIso2) && !have.has(s.id))];
    }
  }
  for (const s of base) {
    if (!countryOk(s.countryIso2)) continue;
    if (!continentOk(s.countryIso2)) continue;
    const place: PlaceRef = { kind: "station", id: s.id, name: s.name, countryId: s.countryIso2 };
    const o = overlay(place);
    if (!passStatus(o.status, o.favorite)) continue;
    if (take({
      kind: "station", id: s.id, name: s.name, sub: countryName(s.countryIso2),
      countryIso2: s.countryIso2, place, status: o.status, favorite: o.favorite,
    })) break;
  }
  return { rows, hasMore };
}

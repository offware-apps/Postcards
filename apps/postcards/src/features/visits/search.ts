import type { PlaceRef } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";

export interface SearchResult {
  place: PlaceRef;
  /** Secondary line for the UI (e.g. country name for a city). */
  detail: string;
}

/**
 * Search reference data for countries and cities matching the query.
 * Returns PlaceRefs ready to log. Aggregator-only: results come from reference
 * data; nothing is invented (FR-016 handled by the caller when empty).
 */
export function searchPlaces(ref: ReferenceData, query: string, limit = 8): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const countryResults: SearchResult[] = ref.searchCountries(q, limit).map((c) => ({
    place: { kind: "country", id: c.iso2, name: c.name, countryId: c.iso2 },
    detail: "Country",
  }));

  const cityResults: SearchResult[] = ref.searchCities(q, limit).map((c) => {
    const country = ref.countryByIso2(c.countryIso2);
    return {
      place: { kind: "city", id: c.id, name: c.name, countryId: c.countryIso2 },
      detail: country ? `City · ${country.name}` : "City",
    };
  });

  const airportResults: SearchResult[] = ref.searchAirports(q, limit).map((a) => {
    const country = ref.countryByIso2(a.countryIso2);
    const where = [a.city, country?.name].filter(Boolean).join(", ");
    return {
      place: { kind: "airport", id: a.id, name: `${a.name} (${a.id})`, countryId: a.countryIso2 },
      detail: where ? `Airport · ${where}` : "Airport",
    };
  });

  const heritageResults: SearchResult[] = ref.searchHeritage(q, limit).map((h) => {
    const country = ref.countryByIso2(h.countryIso2);
    return {
      place: { kind: "heritage", id: h.id, name: h.name, countryId: h.countryIso2 },
      detail: country ? `Heritage site · ${country.name}` : "Heritage site",
    };
  });

  // Railway stations — name-only (a QID is not a code), like heritage.
  const stationResults: SearchResult[] = ref.searchStations(q, limit).map((s) => {
    const country = ref.countryByIso2(s.countryIso2);
    return {
      place: { kind: "station", id: s.id, name: s.name, countryId: s.countryIso2 },
      detail: country ? `Station · ${country.name}` : "Station",
    };
  });

  // A query typed as an explicit UPPERCASE 3-letter IATA code (e.g. "LAX", "CDG")
  // means the airport — surface it first, ahead of a like-named city ("Laxou").
  // Lowercase/mixed prefix typing ("por", "san") is treated as a place name, so
  // prominent cities keep priority; the airport still appears in the list, just
  // after the places. Case is the disambiguator IATA codes are conventionally
  // written in.
  const isIataCode = /^[A-Z]{3}$/.test(q) && !!ref.airportById(q);
  if (isIataCode) {
    // An exact code match outranks everything by intent, not by name quality.
    return [...airportResults, ...countryResults, ...cityResults, ...heritageResults].slice(
      0,
      limit * 2,
    );
  }
  const grouped = [...countryResults, ...cityResults, ...airportResults, ...stationResults, ...heritageResults];
  // Rank by HOW a name matches, not by what kind it is: "Ista" must put
  // Istanbul (prefix) above Afghanistan (mid-word hit). The sort is stable, so
  // within a rank the kind order above still breaks ties.
  const nq = normalizeQuery(q);
  const rank = (name: string): number => {
    const n = normalizeQuery(name);
    if (n.startsWith(nq)) return 0;
    if (n.includes(` ${nq}`) || n.includes(`-${nq}`)) return 1; // word start ("new york" for "york")
    return 2;
  };
  const ranked = grouped
    .map((r, i) => ({ r, i, rank: rank(r.place.name) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r);

  // Country-intent: when the query NAMES a country, also surface that country's
  // monuments & airports (searchable BY COUNTRY, FR-007), boosted above places
  // whose own name merely matches — so "France" shows French sites & airports,
  // not only the country. Only for a clear country-name prefix, so city/place
  // queries are unaffected.
  const topCountry = ref.searchCountries(q, 1)[0];
  if (topCountry && nq.length >= 3 && normalizeQuery(topCountry.name).startsWith(nq)) {
    const iso2 = topCountry.iso2;
    const cName = topCountry.name;
    const her: SearchResult[] = ref.heritageOf(iso2).slice(0, limit).map((h) => ({
      place: { kind: "heritage", id: h.id, name: h.name, countryId: iso2 },
      detail: `Heritage site · ${cName}`,
    }));
    const air: SearchResult[] = ref
      .allAirports()
      .filter((a) => a.countryIso2 === iso2)
      .slice(0, limit)
      .map((a) => ({
        place: { kind: "airport", id: a.id, name: `${a.name} (${a.id})`, countryId: iso2 },
        detail: `Airport · ${[a.city, cName].filter(Boolean).join(", ")}`,
      }));
    const sta: SearchResult[] = ref
      .stationsOf(iso2)
      .slice(0, limit)
      .map((s) => ({
        place: { kind: "station" as const, id: s.id, name: s.name, countryId: iso2 },
        detail: `Station · ${cName}`,
      }));
    const country: SearchResult = {
      place: { kind: "country", id: iso2, name: cName, countryId: iso2 },
      detail: "Country",
    };
    const seen = new Set<string>();
    return [country, ...her, ...air, ...sta, ...ranked]
      .filter((r) => {
        const k = `${r.place.kind}:${r.place.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, limit * 3);
  }
  return ranked.slice(0, limit * 2);
}

/** Same folding the reference indexes use: diacritics off, lowercase. */
function normalizeQuery(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

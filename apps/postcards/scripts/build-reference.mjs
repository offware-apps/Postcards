// Build the bundled reference data from openly-licensed sources:
//  - public/reference/cities.json        GeoNames cities >= 15k (all-the-cities, CC BY 4.0)
//  - public/reference/subdivisions.json  first-level regions (GeoNames admin-1 taxonomy):
//                                         each city's current code and each code's name from
//                                         one GeoNames day (CC BY 4.0), vendored at scripts/data/
//                                         by build-city-admin1.mjs and admin1CodesASCII.txt.
//  - public/reference/airports.json      IATA-coded airports (OpenFlights, aggregated from the
//                                         public-domain OurAirports), via `airport-data`.
// A city GeoNames no longer lists takes the region of its nearest city that it does, and a
// code with no GeoNames name keeps one from the dr5hn countries-states-cities dataset
// (ODbL), matched by nearest centroid. Aggregator-only: reshapes existing data.
//
// Run: node scripts/build-reference.mjs  (from apps/postcards)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const allCities = require("all-the-cities");
const { State } = require("country-state-city");
const airportData = require("airport-data");
const countries = require("i18n-iso-countries");
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

// 0 = ship EVERY city in the GeoNames-derived package (~135k) — full world
// coverage (small islands like Lombok included), at the cost of a ~15 MB asset
// (cached once by the service worker).
const MIN_POPULATION = 0;

// France: GeoNames names four of the 13 metropolitan regions in English
// ("Brittany"), so all 13 take their own French names, by INSEE region code.
const FR_REGION_NAMES = {
  11: "Île-de-France", 24: "Centre-Val de Loire", 27: "Bourgogne-Franche-Comté",
  28: "Normandie", 32: "Hauts-de-France", 44: "Grand Est", 52: "Pays de la Loire",
  53: "Bretagne", 75: "Nouvelle-Aquitaine", 76: "Occitanie", 84: "Auvergne-Rhône-Alpes",
  93: "Provence-Alpes-Côte d'Azur", 94: "Corse",
};


// dr5hn states per country, with usable centroids.
const statesByCountry = new Map();
function statesOf(cc) {
  if (!statesByCountry.has(cc)) {
    const list = (State.getStatesOfCountry(cc) || [])
      .map((s) => ({ name: s.name, lat: parseFloat(s.latitude), lon: parseFloat(s.longitude) }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0));
    statesByCountry.set(cc, list);
  }
  return statesByCountry.get(cc);
}

const here = dirname(fileURLToPath(import.meta.url));
const refDir = join(here, "..", "public", "reference");

// GeoNames admin-1 names by "CC-code", from https://download.geonames.org/export/dump/admin1CodesASCII.txt
const ADMIN1_NAMES = new Map(
  gunzipSync(readFileSync(join(here, "data", "admin1CodesASCII.txt.gz")))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [code, name] = line.split("\t");
      return [code.replace(".", "-"), name];
    }),
);

// Each city's admin-1 code on the same GeoNames day as ADMIN1_NAMES, by geonameid.
// all-the-cities carries codes from an older snapshot, and GeoNames has since given
// some of them to other regions (Vietnam's 2025 provinces), so its own are not used.
const CITY_ADMIN1 = new Map(
  gunzipSync(readFileSync(join(here, "data", "city-admin1.tsv.gz")))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, code] = line.split("\t");
      return [id, code];
    }),
);

// --- Cities, each with its current region code where GeoNames still lists it ---
const cities = [];
const seen = new Set();
for (const c of allCities) {
  if ((c.population || 0) < MIN_POPULATION || !c.cityId || seen.has(c.cityId)) continue;
  const [lon, lat] = c.loc.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  seen.add(c.cityId);
  const current = CITY_ADMIN1.get(String(c.cityId));
  const [cc, admin1] = current ? current.split(".") : [];
  cities.push({
    id: String(c.cityId), name: c.name, countryIso2: c.country,
    subdivisionId: cc === c.country && admin1 ? `${cc}-${admin1}` : null,
    lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4,
    // GeoNames uses 0 for "unknown population" — store null, never a fake 0.
    population: c.population > 0 ? c.population : null,
    // Only a city GeoNames no longer lists falls back to its nearest neighbour.
    unlisted: !current && !!c.adminCode,
  });
}
const coded = new Map(); // country -> cities carrying a current code
for (const c of cities) {
  if (!c.subdivisionId) continue;
  if (!coded.has(c.countryIso2)) coded.set(c.countryIso2, []);
  coded.get(c.countryIso2).push(c);
}
let borrowed = 0;
for (const c of cities) {
  if (c.unlisted) {
    let best = null, bestD = Infinity;
    for (const o of coded.get(c.countryIso2) ?? []) {
      const d = (o.lat - c.lat) ** 2 + (o.lon - c.lon) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) { c.subdivisionId = best.subdivisionId; borrowed++; }
  }
  delete c.unlisted;
}
console.log(`cities GeoNames no longer lists, placed by nearest neighbour: ${borrowed}`);

const regions = new Map(); // "CC-code" -> { cc, adminCode, sumLat, sumLon, n }
for (const c of cities) {
  if (!c.subdivisionId) continue;
  let r = regions.get(c.subdivisionId);
  if (!r) {
    const adminCode = c.subdivisionId.slice(c.countryIso2.length + 1);
    regions.set(c.subdivisionId, (r = { cc: c.countryIso2, adminCode, sumLat: 0, sumLon: 0, n: 0 }));
  }
  r.sumLat += c.lat;
  r.sumLon += c.lon;
  r.n++;
}
cities.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
// Two tiers: a small CORE file — the world's top CORE_COUNT cities by population —
// that the app bundles + precaches and blocks on at startup, and the FULL world
// gazetteer (~135k) that is downloaded ON DEMAND (like an offline map pack), never
// bundled and never auto-fetched. Keeping only the top 10k in the app keeps the
// install small; the long tail is a one-tap download in Settings.
const CORE_COUNT = 10000;
const core = cities.slice(0, CORE_COUNT); // already population-descending
writeFileSync(join(refDir, "cities.json"), JSON.stringify(core) + "\n");
writeFileSync(join(refDir, "cities-all.json"), JSON.stringify(cities) + "\n");
console.log(`core cities: ${core.length} | full: ${cities.length}`);

// --- Name each region by its GeoNames code, else by nearest state centroid ---
function nearestName(cc, lat, lon) {
  let best = null, bestD = Infinity;
  for (const s of statesOf(cc)) {
    const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (d < bestD) { bestD = d; best = s.name; }
  }
  return best;
}

let named = 0;
const subdivisions = [];
for (const [id, r] of regions) {
  const cLat = r.sumLat / r.n, cLon = r.sumLon / r.n;
  const name =
    (r.cc === "FR" ? FR_REGION_NAMES[r.adminCode] : undefined) ??
    ADMIN1_NAMES.get(id) ??
    nearestName(r.cc, cLat, cLon);
  if (name) named++;
  subdivisions.push({ id, countryIso2: r.cc, name: name ?? `${r.cc} region ${r.adminCode}` });
}
subdivisions.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(refDir, "subdivisions.json"), JSON.stringify(subdivisions) + "\n");

console.log(`cities: ${cities.length} | subdivisions: ${subdivisions.length}`);
console.log(`named: ${named}/${subdivisions.length} (${Math.round((named / subdivisions.length) * 100)}%)`);
console.log(`named by GeoNames code: ${subdivisions.filter((s) => ADMIN1_NAMES.has(s.id)).length}`);
console.log(`countries with regions: ${new Set(subdivisions.map((s) => s.countryIso2)).size}`);
console.log(`Paris subId: ${cities.find((c) => c.id === "2988507")?.subdivisionId}`);

// --- Airports (IATA-coded, OpenFlights via airport-data) ---
// A few OpenFlights country names differ from ISO 3166 English names; map them to
// alpha-2 explicitly. "Netherlands Antilles" is deliberately absent — the country
// dissolved in 2010 into CW/SX/BQ and the source can't tell us which, so those few
// airports are dropped rather than guessed (Constitution I: never invent).
const AIRPORT_CC_OVERRIDES = {
  "Congo (Kinshasa)": "CD", "Congo (Brazzaville)": "CG", Burma: "MM", Laos: "LA",
  Syria: "SY", Micronesia: "FM", "Virgin Islands": "VI", "British Virgin Islands": "VG",
  "Falkland Islands": "FK", Moldova: "MD", Macedonia: "MK", Swaziland: "SZ", Macau: "MO",
  Brunei: "BN", "East Timor": "TL", "Midway Islands": "UM", "Johnston Atoll": "UM",
  "Wake Island": "UM",
};

const airports = [];
const seenIata = new Set();
let airportsDropped = 0;
for (const a of airportData) {
  const iata = a.iata;
  if (!iata || !/^[A-Z]{3}$/.test(iata) || seenIata.has(iata)) continue;
  if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) continue;
  const cc = AIRPORT_CC_OVERRIDES[a.country] ?? countries.getAlpha2Code(a.country, "en");
  if (!cc) {
    airportsDropped++;
    continue;
  }
  seenIata.add(iata);
  airports.push({
    id: iata,
    name: a.name,
    city: a.city && a.city !== a.name ? a.city : "",
    countryIso2: cc,
    lat: Math.round(a.latitude * 1e4) / 1e4,
    lon: Math.round(a.longitude * 1e4) / 1e4,
  });
}
airports.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(refDir, "airports.json"), JSON.stringify(airports) + "\n");
console.log(`airports: ${airports.length} (dropped ${airportsDropped} with unresolved country)`);
console.log(`countries with airports: ${new Set(airports.map((a) => a.countryIso2)).size}`);
// Fetch Offware's shared data (https://github.com/offware-apps/data) into the bundled
// reference files, at build time. Every dataset the app ships comes from there:
//
//   public/reference/railways-wikidata.json   stations/railways.json         Wikidata, CC0
//   public/reference/landmarks.json            places/landmarks.json          Wikidata, CC0
//   public/reference/railways.json             stations-europe/railways.json  Trainline, ODbL
//   public/reference/cities.json               cities/top.json                GeoNames, CC BY 4.0
//   public/reference/cities-all.json           cities/all.json                GeoNames, CC BY 4.0
//   public/reference/subdivisions.json         regions/regions.json           GeoNames + dr5hn, ODbL
//   public/reference/airports.json             airports/airports.json         OpenFlights, ODbL
//   public/reference/heritage.json             heritage/unesco.json           UNESCO, CC BY-SA 3.0 IGO
//   public/reference/languages.json            countries/languages.json       world-countries, ODbL
//   public/reference/article-names.json        countries/article-names.json   world-countries, ODbL
//   public/reference/experiences.json          moments/moments.json           per item, as cited
//   src/lib/reference/data/country-names.json  countries/names.json           world-countries, ODbL
//   src/lib/reference/data/continents.json     countries/continents.json      world-countries, ODbL
//   src/lib/reference/data/sovereignty.json    countries/sovereignty.json     world-countries, ODbL
//
// Aggregator-only (Constitution I): the shared data reshapes named, openly-licensed
// datasets; this script only downloads and checks it. A file is written only when its
// dataset still carries the licence the app's provenance names (catalog.json), and its
// records have the shape the app reads. Otherwise the committed copy is kept, so the app
// always builds and works offline. With no worldwide stations file at all the script
// fails: they're the default station source, and a build without them would leave every
// new user with no stations.
//
//   node scripts/fetch-data.mjs
//   DATA_BASE=https://example.org/data/v1 node scripts/fetch-data.mjs

import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.DATA_BASE ?? process.env.PLACES_BASE ?? "https://offware-apps.github.io/data/v1";
const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(APP, "public", "reference");
const DATA = join(APP, "src", "lib", "reference", "data");
const LANDMARK_MAX = 10_000;
const UA = "Postcards-reference-build/1.0 (https://github.com/offware-apps/Postcards)";

/** The licence each dataset must still carry: the one the app's provenance names. */
const LICENSES = {
  stations: "CC0-1.0",
  places: "CC0-1.0",
  "stations-europe": "ODbL-1.0",
  cities: "CC-BY-4.0",
  regions: "ODbL-1.0",
  airports: "ODbL-1.0",
  heritage: "CC-BY-SA-3.0-IGO",
  countries: "ODbL-1.0",
  moments: "CC0-1.0 AND CC-BY-4.0 AND CC-BY-SA-3.0-IGO AND CC-BY-SA-4.0",
};

const finite = (n, max) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max;
const iso2 = (s) => typeof s === "string" && /^[A-Z]{2}$/.test(s);
const text = (s) => typeof s === "string" && s.trim() !== "";
const validPoint = (p) => p && text(p.id) && text(p.name) && iso2(p.countryIso2) && finite(p.lat, 90) && finite(p.lon, 180);

async function get(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** A list of `item`s, all valid, at least `min` of them. */
function list(json, min, valid) {
  if (!Array.isArray(json)) throw new Error("not a list");
  if (json.length < min || !json.every(valid)) throw new Error(`${json.length} records, or some invalid`);
  return json;
}

/** An object keyed by country code, at least `min` keys, every value valid. */
function byCountry(json, min, valid) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("not an object");
  const entries = Object.entries(json);
  if (entries.length < min || !entries.every(([k, v]) => iso2(k) && valid(v))) throw new Error(`${entries.length} countries, or some invalid`);
  return json;
}

function stationsFile(json, license, min) {
  if (json?._source?.license !== license || !Array.isArray(json.stations)) throw new Error("unexpected shape or licence");
  const stations = json.stations.filter(validPoint);
  if (stations.length < min) throw new Error(`only ${stations.length} valid stations`);
  return { _source: json._source, stations };
}

function landmarks(json) {
  // The best known LANDMARK_MAX, so the file stays small enough to load at start-up.
  // Postcards' landmarks are one category; the dataset's finer kinds stay out of the app.
  const out = list(json, 100, () => true)
    .filter(validPoint)
    .sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0) || a.id.localeCompare(b.id))
    .slice(0, LANDMARK_MAX)
    .map(({ id, name, countryIso2, lat, lon }) => ({ id, name, countryIso2, lat, lon, category: "landmark" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (out.length < 100) throw new Error(`only ${out.length} valid landmarks`);
  return out;
}

const city = (c) => validPoint(c) && (c.population === null || finite(c.population, 1e9)) && (c.subdivisionId === null || text(c.subdivisionId));

/** [dataset, path in the shared data, file written, check and reshape]. */
const FILES = [
  ["stations", "stations/railways.json", join(REF, "railways-wikidata.json"), (j) => stationsFile(j, "CC0-1.0", 1000)],
  ["places", "places/landmarks.json", join(REF, "landmarks.json"), landmarks],
  ["stations-europe", "stations-europe/railways.json", join(REF, "railways.json"), (j) => stationsFile(j, "ODbL-1.0", 10_000)],
  ["cities", "cities/top.json", join(REF, "cities.json"), (j) => list(j, 5000, city)],
  ["cities", "cities/all.json", join(REF, "cities-all.json"), (j) => list(j, 100_000, city)],
  ["regions", "regions/regions.json", join(REF, "subdivisions.json"), (j) => list(j, 1000, (r) => text(r.id) && iso2(r.countryIso2) && text(r.name))],
  ["airports", "airports/airports.json", join(REF, "airports.json"), (j) => list(j, 3000, (a) => validPoint(a) && /^[A-Z]{3}$/.test(a.id) && typeof a.city === "string")],
  ["heritage", "heritage/unesco.json", join(REF, "heritage.json"), (j) => list(j, 1000, (h) => validPoint(h) && ["cultural", "natural", "mixed"].includes(h.category))],
  ["countries", "countries/languages.json", join(REF, "languages.json"), (j) => byCountry(j, 200, (v) => Array.isArray(v) && v.every((l) => text(l.code) && text(l.name)))],
  ["countries", "countries/article-names.json", join(REF, "article-names.json"), (j) => byCountry(j, 200, text)],
  ["countries", "countries/names.json", join(DATA, "country-names.json"), (j) => byCountry(j, 200, text)],
  ["countries", "countries/continents.json", join(DATA, "continents.json"), (j) => byCountry(j, 200, text)],
  ["countries", "countries/sovereignty.json", join(DATA, "sovereignty.json"), (j) => byCountry(j, 240, (v) => v === "un" || v === "territory")],
  ["moments", "moments/moments.json", join(REF, "experiences.json"), (j) => {
    if (!Array.isArray(j?.experiences) || j.experiences.length < 50) throw new Error("no experiences");
    return j;
  }],
];

let catalog = null;
try {
  catalog = await get("catalog.json");
} catch (e) {
  process.stderr.write(`data: catalog not read, every file kept as it was (${e?.message ?? e})\n`);
}
const licenseOf = new Map((catalog?.datasets ?? []).map((d) => [d.id, d.license]));

for (const [dataset, path, out, check] of FILES) {
  try {
    if (licenseOf.get(dataset) !== LICENSES[dataset]) throw new Error(`licence is ${licenseOf.get(dataset)}, provenance names ${LICENSES[dataset]}`);
    const body = check(await get(path));
    writeFileSync(out, JSON.stringify(body) + "\n");
    process.stderr.write(`data: ${path} written\n`);
  } catch (e) {
    process.stderr.write(`data: ${path} kept as it was (${e?.message ?? e})\n`);
  }
}

if (!existsSync(join(REF, "railways-wikidata.json"))) {
  process.stderr.write("data: no worldwide railway stations file, the default station source would be empty\n");
  process.exit(1);
}

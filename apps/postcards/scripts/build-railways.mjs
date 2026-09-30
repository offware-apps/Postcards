// Build the bundled RAILWAY STATION reference data.
//
//   public/reference/railways.json   railway stations (id, name, country, coords)
//
// SOURCES (pick with --source=<name>; default: trainline)
//
//   trainline  Trainline EU open stations database (ODbL). A single, clean CSV of
//              ~72k European stations with coordinates and ISO-3166-1 country codes.
//              Fetched from GitHub raw, which is reachable from restricted networks
//              where the worldwide endpoints below are not. This is the RECOMMENDED
//              default bundled with the app.
//              https://github.com/trainline-eu/stations
//
//   wikidata   Worldwide railway stations from Wikidata (CC0) via SPARQL. The most
//              portable global source (QID + name + P17 country + P625 coords) but
//              query.wikidata.org must be reachable (often blocked). See buildWikidata.
//
// Aggregator-only (Constitution I): this script RESHAPES existing, openly-licensed
// facts into the app's reference shape; it invents nothing. Provenance (named
// dataset + license + date) is written into the emitted file, and the chosen source
// is surfaced in-app so people can see — and swap — which dataset they loaded.
//
//   node scripts/build-railways.mjs                 # trainline (default)
//   node scripts/build-railways.mjs --source=wikidata
//
// The file is bundled under public/reference/ like cities/airports and loaded
// through the same reference-data seam.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "reference", "railways.json");
const UA = "Postcards-reference-build/1.0 (local-first travel journal; contact via repo)";

const arg = process.argv.find((a) => a.startsWith("--source="));
const SOURCE = arg ? arg.slice("--source=".length) : "trainline";

// ── Trainline (default) ──────────────────────────────────────────────────────
const TRAINLINE_CSV =
  "https://raw.githubusercontent.com/trainline-eu/stations/master/stations.csv";

/** Parse Trainline's `;`-separated CSV. Fields are unquoted (the dataset uses no
 *  embedded semicolons in the columns we read), so a plain split per line is safe
 *  and avoids pulling in a CSV dependency for a build script. */
function parseTrainline(text) {
  const lines = text.split("\n");
  const header = lines[0].split(";");
  const col = (name) => header.indexOf(name);
  const iName = col("name");
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iCc = col("country");
  const iSugg = col("is_suggestable");
  const iCity = col("is_city");
  const iAir = col("is_airport");
  const iId = col("id");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(";");
    // Only real, bookable stations: suggestable, with coordinates, and NOT a
    // city-grouping hub (those sit at city centroids and duplicate the city) nor
    // an airport (we already bundle airports as their own place kind).
    if (f[iSugg] !== "t" || f[iCity] === "t" || f[iAir] === "t") continue;
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    const cc = (f[iCc] || "").trim().toUpperCase();
    const name = (f[iName] || "").trim();
    if (!name || !/^[A-Z]{2}$/.test(cc) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // id namespaced to the source so it never collides with a QID/GeoNames id.
    out.push({ id: `tl-${f[iId]}`, name, countryIso2: cc, subdivisionId: null, lat, lon });
  }
  return out;
}

async function buildTrainline() {
  const res = await fetch(TRAINLINE_CSV, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Trainline CSV ${res.status} ${res.statusText}`);
  const text = await res.text();
  const byId = new Map();
  for (const s of parseTrainline(text)) if (!byId.has(s.id)) byId.set(s.id, s);
  const stations = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    stations,
    source: {
      dataset: "Trainline EU open stations database (railway stations)",
      url: "https://github.com/trainline-eu/stations",
      license: "ODbL-1.0",
      retrieved: new Date().toISOString().slice(0, 10),
      note: "Suggestable stations with coordinates; airports and city-grouping hubs excluded. Coverage is Europe-focused.",
      coverage: "europe",
    },
  };
}

// ── Wikidata (worldwide; needs query.wikidata.org reachable) ──────────────────
const ENDPOINT = "https://query.wikidata.org/sparql";
const PAGE = 5000;
const query = (limit, offset) => `
SELECT ?station ?stationLabel ?iso2 ?lat ?lon WHERE {
  ?station wdt:P31 wd:Q55488 ;
           wdt:P625 ?coord ;
           wdt:P17 ?country .
  ?country wdt:P297 ?iso2 .
  FILTER NOT EXISTS { ?station wdt:P576 ?abolished. }
  FILTER NOT EXISTS { ?station wdt:P5817 wd:Q56556915. }
  FILTER NOT EXISTS { ?station wdt:P5817 wd:Q45382883. }
  FILTER( EXISTS { ?station wdt:P954 ?uic. }
          || EXISTS { ?sl schema:about ?station ; schema:isPartOf ?wiki .
                      FILTER(CONTAINS(STR(?wiki), "wikipedia.org")) } )
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?station
LIMIT ${limit} OFFSET ${offset}`;

async function buildWikidata() {
  const byId = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query(PAGE, offset))}`;
    const res = await fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status} ${res.statusText}`);
    const rows = (await res.json()).results.bindings;
    if (!rows.length) break;
    for (const r of rows) {
      const id = r.station.value.replace("http://www.wikidata.org/entity/", "");
      const name = r.stationLabel?.value?.trim();
      if (!name || name === id || byId.has(id)) continue;
      const iso2 = r.iso2.value.toUpperCase();
      const lat = Number(r.lat.value);
      const lon = Number(r.lon.value);
      if (!/^[A-Z]{2}$/.test(iso2) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      byId.set(id, { id, name, countryIso2: iso2, subdivisionId: null, lat, lon });
    }
    process.stderr.write(`  …${byId.size} stations so far\n`);
    if (rows.length < PAGE) break;
  }
  const stations = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    stations,
    source: {
      dataset: "Wikidata railway stations (instance of Q55488)",
      url: "https://query.wikidata.org/",
      license: "CC0-1.0",
      retrieved: new Date().toISOString().slice(0, 10),
      note: "Mainline stations with coordinates and a Wikipedia sitelink or UIC code; metro/tram excluded.",
      coverage: "worldwide",
    },
  };
}

const BUILDERS = { trainline: buildTrainline, wikidata: buildWikidata };

async function main() {
  const build = BUILDERS[SOURCE];
  if (!build) throw new Error(`Unknown --source=${SOURCE} (expected: ${Object.keys(BUILDERS).join(", ")})`);
  const { stations, source } = await build();
  writeFileSync(OUT, JSON.stringify({ _source: source, stations }));
  process.stderr.write(`Wrote ${stations.length} railway stations (${SOURCE}) → ${OUT}\n`);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exitCode = 1;
});

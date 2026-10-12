// Fetch the shared Offware places dataset (https://github.com/offware-apps/places) into
// the bundled reference files, at build time:
//
//   public/reference/railways-wikidata.json   railway stations worldwide (Wikidata, CC0)
//   public/reference/landmarks.json            sights beyond UNESCO's list (Wikidata, CC0)
//
// Aggregator-only (Constitution I): the dataset reshapes Wikidata facts, each record
// keeping its Wikidata id as provenance; this script only downloads and checks it.
// A file that can't be fetched or doesn't validate is left as it is (the committed
// landmarks seed, or the stations of an earlier run). With no stations file at all the
// script fails: they're the default station source, and a build without them would
// leave every new user with no stations.
//
//   node scripts/fetch-places.mjs
//   PLACES_BASE=https://example.org/places/v1 node scripts/fetch-places.mjs

import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.PLACES_BASE ?? "https://offware-apps.github.io/places/v1";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "reference");
const LANDMARK_MAX = 10_000;
const UA = "Postcards-reference-build/1.0 (https://github.com/offware-apps/Postcards)";

const finite = (n, max) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max;
const validPoint = (p) =>
  p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim() &&
  /^[A-Z]{2}$/.test(p.countryIso2) && finite(p.lat, 90) && finite(p.lon, 180);

async function get(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function stations() {
  const json = await get("stations.json");
  if (json?._source?.license !== "CC0-1.0" || !Array.isArray(json.stations)) throw new Error("stations.json: unexpected shape or licence");
  const list = json.stations.filter(validPoint);
  if (list.length < 1000) throw new Error(`stations.json: only ${list.length} valid stations`);
  writeFileSync(join(OUT, "railways-wikidata.json"), JSON.stringify({ _source: json._source, stations: list }));
  return `${list.length} stations`;
}

async function landmarks() {
  const [list, sources] = await Promise.all([get("landmarks.json"), get("sources.json")]);
  const wikidata = sources?.sources?.find((s) => s.id === "wikidata");
  if (wikidata?.license !== "CC0-1.0" || !Array.isArray(list)) throw new Error("landmarks.json: unexpected shape or licence");
  // The best known LANDMARK_MAX, so the file stays small enough to load at start-up.
  // Postcards' landmarks are one category; the dataset's finer kinds stay out of the app.
  const out = list
    .filter(validPoint)
    .sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0) || a.id.localeCompare(b.id))
    .slice(0, LANDMARK_MAX)
    .map(({ id, name, countryIso2, lat, lon }) => ({ id, name, countryIso2, lat, lon, category: "landmark" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (out.length < 100) throw new Error(`landmarks.json: only ${out.length} valid landmarks`);
  writeFileSync(join(OUT, "landmarks.json"), JSON.stringify(out));
  return `${out.length} landmarks`;
}

for (const [name, run] of [["stations", stations], ["landmarks", landmarks]]) {
  try {
    process.stderr.write(`places: ${await run()} written\n`);
  } catch (e) {
    process.stderr.write(`places: ${name} kept as it was (${e?.message ?? e})\n`);
  }
}

if (!existsSync(join(OUT, "railways-wikidata.json"))) {
  process.stderr.write("places: no railway stations file, the default station source would be empty\n");
  process.exit(1);
}

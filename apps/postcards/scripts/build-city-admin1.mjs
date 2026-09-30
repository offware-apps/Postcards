// Vendor GeoNames' current admin-1 code for every city the app ships, so
// build-reference.mjs names regions from codes and names of one GeoNames day.
//
//   curl -LO https://download.geonames.org/export/dump/cities500.zip && unzip cities500.zip
//   node scripts/build-city-admin1.mjs cities500.txt   (from apps/postcards)
//
// Writes scripts/data/city-admin1.tsv.gz: one "<geonameid>\t<CC>.<admin1>" line per
// city of all-the-cities that cities500 still lists (CC BY 4.0, GeoNames).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const allCities = require("all-the-cities");

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-city-admin1.mjs <path to cities500.txt>");
  process.exit(1);
}

const wanted = new Set(allCities.map((c) => String(c.cityId)));
const rows = [];
for (const line of readFileSync(source, "utf8").split("\n")) {
  const f = line.split("\t");
  if (f.length < 11 || !wanted.has(f[0])) continue;
  rows.push([Number(f[0]), `${f[0]}\t${f[8]}.${f[10]}`]);
}
rows.sort((a, b) => a[0] - b[0]);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "data", "city-admin1.tsv.gz");
writeFileSync(out, gzipSync(rows.map((r) => r[1]).join("\n") + "\n", { level: 9 }));
console.log(`cities with a current admin-1 code: ${rows.length} of ${wanted.size}`);

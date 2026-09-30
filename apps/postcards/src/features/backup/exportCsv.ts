import type { ReferenceData } from "../../lib/reference/types";
import type { Visit } from "../../lib/schema/models";

export const PLACES_CSV_FILENAME = "places.csv";

/** Where a visit sits on the map, resolved from reference data (or a custom
 *  point's own coordinates). Country-kind records have no point. */
function coordOf(ref: ReferenceData, v: Visit): { lat: number; lon: number } | null {
  const p = v.place;
  if (p.kind === "city") {
    const c = ref.cityById(p.id);
    return c ? { lat: c.lat, lon: c.lon } : null;
  }
  if (p.kind === "heritage") {
    const h = ref.heritageById(p.id);
    return h && (h.lat !== 0 || h.lon !== 0) ? { lat: h.lat, lon: h.lon } : null;
  }
  if (p.kind === "airport") {
    const a = ref.airportById(p.id);
    return a ? { lat: a.lat, lon: a.lon } : null;
  }
  if (p.kind === "station") {
    const s = ref.stationById(p.id);
    return s ? { lat: s.lat, lon: s.lon } : null;
  }
  if (p.kind === "custom" && p.lat != null && p.lon != null) return { lat: p.lat, lon: p.lon };
  return null;
}

/** Quote a CSV string field (doubling any embedded quote). */
function q(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Serialize visits to the app's own places CSV — the exact shape importCsv
 * reads back (`lat;lon;country;city;been`), so places round-trip losslessly.
 * `been` carries the state as comma tags: visited→`been`, wishlist→`want`, plus
 * `fave` when starred. Semicolon-delimited precisely so those commas survive.
 * Country-kind records are skipped (country coverage is derived from the places
 * inside, so a bare country has nothing to place on a map).
 */
export function serializePlacesCsv(visits: Visit[], ref: ReferenceData): string {
  // `date` is the last column so old importers (which read the first five) still
  // round-trip; the app's own importer reads it back to preserve when you were there.
  const rows = ["lat;lon;country;city;been;date"];
  for (const v of visits) {
    if (v.place.kind === "country") continue;
    const coord = coordOf(ref, v);
    const tags = [v.status === "visited" ? "been" : "want"];
    if (v.favorite) tags.push("fave");
    rows.push(
      [
        coord ? String(coord.lat) : "",
        coord ? String(coord.lon) : "",
        q(v.place.countryId.toLowerCase()),
        q(v.place.name),
        q(tags.join(",")),
        v.date ?? "",
      ].join(";"),
    );
  }
  return rows.join("\n") + "\n";
}

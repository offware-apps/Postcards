import type { ReferenceData } from "../../lib/reference/types";
import type { PlaceRef, Visit } from "../../lib/schema/models";
import { haversineKm } from "../travel/distance";

/**
 * One place resolved from a delimited (CSV/TSV) row: a PlaceRef plus the state
 * to log it in. Pure data — the store turns these into Visit records (assigning
 * ids/timestamps), so parsing stays deterministic and unit-testable.
 */
export interface ImportedPlace {
  place: PlaceRef;
  status: Visit["status"];
  favorite: boolean;
  date: string | null;
}

export interface CsvImportResult {
  places: ImportedPlace[];
  total: number;
  skipped: number;
}

/** Match-fold: diacritics off, lowercased, punctuation → spaces, collapsed.
 *  Looser than the gazetteer's search fold so "Xi'an"/"Xi’an", "Köln"/"Koln"
 *  and "San-Sebastian"/"San Sebastián" match the same city. */
function matchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A short, stable, id-safe slug for a custom place (so re-import upserts it). */
function slug(s: string): string {
  return matchKey(s).replace(/\s+/g, "-").slice(0, 48) || "place";
}

/**
 * Split one delimited line into fields, honouring "quoted" fields (which may
 * contain the delimiter, e.g. a "been,want" tag list inside a comma file).
 * Minimal RFC-4180-ish: doubled quotes inside a quoted field are a literal quote.
 */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Header aliases → our canonical column names. */
const COLUMN_ALIASES: Record<string, "lat" | "lon" | "country" | "name" | "status" | "date"> = {
  lat: "lat", latitude: "lat",
  lon: "lon", lng: "lon", long: "lon", longitude: "lon",
  country: "country", cc: "country", iso: "country", iso2: "country", countrycode: "country",
  city: "name", name: "name", place: "name", town: "name",
  been: "status", status: "status", tags: "status", visited: "status", state: "status",
  date: "date", when: "date", visitedon: "date", day: "date",
};

/**
 * Parse a places CSV/TSV into ImportedPlaces. Understands the app's own export
 * shape (`lat;lon;country;city;been`) and reasonable variants: `;`, `,` or tab
 * delimited; flexible column order and header names; a "been"/"status" column
 * whose comma-separated tags map to state — `been` → visited, `want` →
 * wishlist, `fave`/`fav` → favorite (been wins over want). Each row resolves to
 * a real gazetteer city (name + country, nearest coordinate) so it counts in
 * stats and links to a city page; unmatched rows become a custom point that
 * still shows on the map and collects its country's flag. Inert: only plain
 * fields are read; nothing is executed. Rows without a usable place are skipped.
 */
export function parsePlacesCsv(text: string, ref: ReferenceData): CsvImportResult {
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { places: [], total: 0, skipped: 0 };

  // Delimiter: the header's most frequent of ; \t , (semicolons first — the
  // app's own export uses ; precisely so "been,want" tags keep their commas).
  const header = lines[0]!;
  const delim =
    header.includes(";") ? ";" : header.includes("\t") ? "\t" : ",";
  const cols = splitLine(header, delim).map((h) => matchKey(h).replace(/\s+/g, ""));
  const idx: Partial<Record<"lat" | "lon" | "country" | "name" | "status" | "date", number>> = {};
  cols.forEach((c, i) => {
    const key = COLUMN_ALIASES[c];
    if (key && idx[key] === undefined) idx[key] = i;
  });
  if (idx.name === undefined || idx.country === undefined) {
    return { places: [], total: lines.length - 1, skipped: lines.length - 1 };
  }

  const places: ImportedPlace[] = [];
  let skipped = 0;
  for (let r = 1; r < lines.length; r++) {
    const f = splitLine(lines[r]!, delim);
    // Our export writes a formula-like name as '=… so spreadsheets keep it inert;
    // drop that apostrophe so the name round-trips as it was.
    const name = (f[idx.name] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
    const cc = (f[idx.country] ?? "").trim().toUpperCase();
    if (!name || !/^[A-Z]{2}$/.test(cc) || !ref.countryByIso2(cc)) {
      skipped++;
      continue;
    }
    const lat = idx.lat !== undefined ? Number(f[idx.lat]) : NaN;
    const lon = idx.lon !== undefined ? Number(f[idx.lon]) : NaN;
    const hasCoord = Number.isFinite(lat) && Number.isFinite(lon);

    // State from the tag column (default: visited when there is no such column).
    const tags = (idx.status !== undefined ? f[idx.status] ?? "" : "been")
      .toLowerCase()
      .split(/[,|/]/)
      .map((t) => t.trim());
    const status: Visit["status"] = tags.includes("been")
      ? "visited"
      : tags.includes("want") || tags.includes("wishlist")
        ? "wishlist"
        : "visited";
    const favorite = tags.some((t) => t === "fave" || t === "fav" || t === "favorite" || t === "star");

    // Preserve the visit date when the file carries one (our export does); accept
    // only a plain ISO calendar date so nothing odd slips into the record.
    const rawDate = idx.date !== undefined ? (f[idx.date] ?? "").trim() : "";
    const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : null;

    places.push({ place: resolvePlace(ref, name, cc, hasCoord ? lat : null, hasCoord ? lon : null), status, favorite, date });
  }
  return { places, total: lines.length - 1, skipped };
}

/** Resolve a row to a gazetteer city (exact folded name in that country,
 *  nearest coordinate within 120 km) or, failing that, a stable custom point. */
function resolvePlace(
  ref: ReferenceData,
  name: string,
  cc: string,
  lat: number | null,
  lon: number | null,
): PlaceRef {
  const key = matchKey(name);
  const named = ref.citiesOf(cc).filter((c) => matchKey(c.name) === key);
  if (named.length) {
    let best = named[0]!;
    if (lat != null && lon != null && named.length > 1) {
      let bestKm = Infinity;
      for (const c of named) {
        const km = haversineKm({ lat, lon }, { lat: c.lat, lon: c.lon });
        if (km < bestKm) {
          bestKm = km;
          best = c;
        }
      }
    }
    // With coordinates, only accept a same-name city that's actually near (a
    // homonym in the same country far away is a different place → custom).
    if (lat == null || lon == null || haversineKm({ lat, lon }, { lat: best.lat, lon: best.lon }) <= 120) {
      return { kind: "city", id: best.id, name: best.name, countryId: cc };
    }
  }
  const place: PlaceRef = { kind: "custom", id: `csv:${cc}:${slug(name)}`, name, countryId: cc };
  if (lat != null && lon != null) {
    place.lat = lat;
    place.lon = lon;
  }
  return place;
}

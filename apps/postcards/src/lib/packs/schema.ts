// Community data packs — a shareable, openly-licensed set of PLACES anyone can
// publish (a raw JSON file on GitHub, a gist, or a plain download) and install to
// make those places searchable, mappable and markable-visited.
//
// Constitution I (aggregator, never an author): a pack is EXTERNAL reference data
// and MUST carry provenance — a name and a license — so every place it adds keeps
// its source. Constitution VI (data is inert): a pack is parsed, validated and
// sanitized, NEVER executed; strings are neutralised exactly like the portable
// backup file, coordinates are bounds-checked, and the whole thing is size-capped.
import { z } from "zod";
import { sanitizeText } from "../schema/sanitize";

/** Bounds on a pack so a hostile/oversized file can't OOM the device. */
const MAX_PACK_PLACES = 50_000;

const nonEmptySanitized = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => sanitizeText(s, max))
    .refine((s) => s.length > 0, { message: "value is empty once sanitized" });

const optSanitized = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => {
      const v = sanitizeText(s, max);
      return v.length ? v : undefined;
    })
    .optional();

/** One place a pack contributes. Same shape the app needs to search + map it. */
export const PackPlaceSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    name: nonEmptySanitized(120),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    countryIso2: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((s) => s.toUpperCase()),
  })
  .strict();


/** A community data pack. `license` is REQUIRED — provenance is non-negotiable. */
export const DataPackSchema = z
  .object({
    format: z.literal("postcards-pack"),
    version: z.number().int().min(1),
    name: nonEmptySanitized(120),
    description: optSanitized(2000),
    /** Where the data came from (a dataset name or a URL). */
    source: optSanitized(500),
    /** The open licence the data is under, e.g. "ODbL", "CC BY 4.0". Required. */
    license: nonEmptySanitized(120),
    /** Human attribution line shown with the pack, e.g. "© OpenStreetMap contributors". */
    attribution: optSanitized(300),
    places: z.array(PackPlaceSchema).min(1).max(MAX_PACK_PLACES),
  })
  .strict();

export type DataPack = z.infer<typeof DataPackSchema>;

/** An installed pack (validated data + when it was added + where from). */
export interface InstalledPack {
  id: string; // packNamespace(pack); a pack installed before that keeps its random id
  addedAt: string;
  sourceUrl: string | null; // the URL it was fetched from, if any
  pack: DataPack;
}

/** Char ceiling before parsing a pack — mobile-safe, like the JSON import guard. */
export const MAX_PACK_CHARS = 32_000_000;

/**
 * Parse + validate + sanitize raw pack text. Inert: never executed. Returns the
 * validated pack or a clear error string — mirrors importFile's contract.
 */
export function parsePack(text: string): { ok: true; pack: DataPack } | { ok: false; error: string } {
  if (text.length > MAX_PACK_CHARS) return { ok: false, error: "This pack file is too large." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This pack is not valid JSON." };
  }
  const parsed = DataPackSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "file";
    return { ok: false, error: `Invalid pack at "${where}": ${first?.message ?? "unknown"}.` };
  }
  return { ok: true, pack: parsed.data };
}

/**
 * Normalise a GitHub link to a raw, CSP-allowed URL. Accepts a raw.githubusercontent
 * or gist URL as-is, and rewrites a github.com "blob" URL to its raw form. Returns
 * null for anything else — the caller then tells the user to download + import the
 * file instead (so the strict connect-src is never widened to arbitrary hosts).
 */
export function toRawGitHubUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "raw.githubusercontent.com" || u.hostname === "gist.githubusercontent.com") {
    return u.toString();
  }
  // github.com/<owner>/<repo>/blob/<ref>/<path> -> raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  return null;
}

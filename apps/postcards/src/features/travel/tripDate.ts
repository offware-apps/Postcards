import { formatDate } from "../../lib/format/format";

// Approximate ("vague") trip dates (spec 019). A trip date is deliberately coarse:
// a full day `YYYY-MM-DD`, a month `YYYY-MM`, a year `YYYY`, or nothing. These pure
// helpers parse/format/compare that one string consistently so partial and full
// dates sort and display sensibly side by side. No I/O.

/** The stored form: full day, month, year, or null (undated). */
export type TripDate = string | null;

const RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export interface ParsedTripDate {
  year: number;
  /** 1–12, or null when only a year is known. */
  month: number | null;
  /** 1–31, or null when no day is given. */
  day: number | null;
}

/** Parse a trip date into its known parts, or null if empty/malformed. */
export function parseTripDate(s: TripDate): ParsedTripDate | null {
  if (!s) return null;
  const m = RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] != null ? Number(m[2]) : null;
  const day = m[3] != null ? Number(m[3]) : null;
  if (month != null && (month < 1 || month > 12)) return null;
  if (day != null && (day < 1 || day > 31)) return null;
  return { year, month, day };
}

/** True when `s` is a valid trip date (year, month, or full day). */
export function isValidTripDate(s: string): boolean {
  return parseTripDate(s) != null;
}

/** Human label for the granularity present: a year "2024", a month "Aug 2024", or a
 *  full day formatted like every other date in the app (via `formatDate`), and "" for
 *  undated. Keeps full-date display identical to the rest of the UI. */
export function formatTripDate(s: TripDate, locale: string): string {
  const p = parseTripDate(s);
  if (!p) return "";
  if (p.month == null) return String(p.year);
  if (p.day == null) {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(p.year, p.month - 1, 1)),
    );
  }
  // A full day reuses the app-wide date format so trip rows match visits/journal.
  return formatDate(s, locale);
}

/** A single sortable number for a trip date; undated sorts LAST. Year-only counts
 *  as its January (start of the year) so it orders before that year's dated trips. */
function sortKey(s: TripDate): number {
  const p = parseTripDate(s);
  if (!p) return Number.POSITIVE_INFINITY;
  return p.year * 10000 + (p.month ?? 1) * 100 + (p.day ?? 1);
}

/** Compare two trip dates ascending; undated sorts last. */
export function compareTripDate(a: TripDate, b: TripDate): number {
  return sortKey(a) - sortKey(b);
}

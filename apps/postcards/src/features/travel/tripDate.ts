import { formatDate } from "../../lib/format/format";
import { isCalendarDate } from "../../lib/schema/helpers";

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

/** Parse a trip date into its known parts, or null if empty, malformed or not a
 *  real calendar date (month 13, Feb 30). */
export function parseTripDate(s: TripDate): ParsedTripDate | null {
  if (!s) return null;
  const m = RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] != null ? Number(m[2]) : null;
  const day = m[3] != null ? Number(m[3]) : null;
  if (!isCalendarDate(s)) return null;
  return { year, month, day };
}

/** True when `s` is a valid trip date (year, month, or full day). */
export function isValidTripDate(s: string): boolean {
  return parseTripDate(s) != null;
}

/** Human label for the granularity present: a year "2024", a month "Aug 2024", or a
 *  full day, all via the app-wide `formatDate` so trip rows match visits/journal,
 *  and "" for undated or malformed. */
export function formatTripDate(s: TripDate, locale: string): string {
  if (!parseTripDate(s)) return "";
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

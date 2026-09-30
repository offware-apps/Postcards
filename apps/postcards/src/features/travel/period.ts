import type { Trip } from "../../lib/schema/models";
import { tripDateSpan } from "./tripDate";

/** Localized full month name for a 2-digit month ("01".."12"), via the platform
 *  Intl formatter — the same way the Journal calendar localizes months, so fr/ko
 *  users never see hardcoded English. Defaults to English (keeps pure-label tests
 *  stable and gives a sane fallback when no locale is threaded through). */
export function monthName(month: string, locale: string = "en"): string {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(
    new Date(2023, Number(month) - 1, 1),
  );
}

/** "all" (no time filter) or a 4-digit year string. */
export type YearFilter = "all" | string;
/** "all" (whole year) or a 2-digit month string ("01".."12"). */
export type MonthFilter = "all" | string;

/** Distinct 4-digit years across dated items, newest first. Undated items are ignored. */
export function distinctYearsDesc(items: { date: string | null }[]): string[] {
  const set = new Set<string>();
  for (const it of items) if (it.date) set.add(it.date.slice(0, 4));
  return [...set].sort((a, b) => b.localeCompare(a));
}

/**
 * A date-bucket selection shared by the year filters (Places/Journal/Trips and
 * now the map): "all" = any date, "none" = undated only, else a 4-digit year.
 */
export type DateFilter = "all" | "none" | string;

/** Whether a (possibly missing) date falls in the selected bucket. */
export function matchesDateFilter(date: string | null | undefined, filter: DateFilter): boolean {
  if (filter === "all") return true;
  if (filter === "none") return !date;
  return typeof date === "string" && date.slice(0, 4) === filter;
}

/** Keep only the items whose date qualifies for the selected bucket. */
export function itemsInDateBucket<T extends { date: string | null }>(
  items: T[],
  filter: DateFilter,
): T[] {
  return items.filter((it) => matchesDateFilter(it.date, filter));
}

/**
 * The map's richer date selection. The quick year chips are presets over this:
 *   • all — any date
 *   • undated — only places with no date
 *   • range — an inclusive [from, to] window ("" = open on that end), which a
 *     year chip fills as that whole year and the date pickers set precisely.
 * A single exact day is just a range with from === to.
 */
export type MapDate =
  | { mode: "all" }
  | { mode: "undated" }
  | { mode: "range"; from: string; to: string };

/** ISO YYYY-MM-DD bounds for a whole 4-digit year (used by the year-chip preset). */
export function yearRange(year: string): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Whether a (possibly missing) date falls in the map's date selection. A bounded
 *  range excludes undated places; the fully-open "all" keeps them. A month- or
 *  year-dated trip matches when the range covers its whole span, so the 2024 chip
 *  keeps a trip dated "2024" or "2024-01". */
export function mapDateMatches(date: string | null | undefined, f: MapDate): boolean {
  if (f.mode === "all") return true;
  if (f.mode === "undated") return !date;
  // Read the date prefix so a stored "2024-06-30T…" timestamp still counts as its
  // day; dates here are plain YYYY-MM-DD (or a vague trip date) in practice.
  const span = tripDateSpan(date ? date.slice(0, 10) : null);
  if (!span) return false;
  if (f.from && span.first < f.from) return false;
  if (f.to && span.last > f.to) return false;
  return true;
}

/** The 4-digit year a range represents exactly (Jan 1–Dec 31), else null — lets
 *  the UI light the matching year chip when the window is exactly one year. */
export function rangeExactYear(f: MapDate): string | null {
  if (f.mode !== "range" || !f.from || !f.to) return null;
  const y = f.from.slice(0, 4);
  return f.from === `${y}-01-01` && f.to === `${y}-12-31` ? y : null;
}

/**
 * The year chips for a set of dated items: the distinct years (newest first)
 * plus whether any item is undated (the "No date" bucket). Mirrors the
 * Places-screen year filter so the map can offer the same chips over visits.
 */
export function dateBuckets(items: { date: string | null }[]): {
  years: string[];
  undated: boolean;
} {
  return { years: distinctYearsDesc(items), undated: items.some((it) => !it.date) };
}

/** Distinct years present across dated trips, newest first. Undated trips are ignored. */
export function tripYears(trips: Trip[]): string[] {
  return distinctYearsDesc(trips);
}

/** Distinct months ("01".."12") that have a dated trip in the given year, ascending. */
export function tripMonths(trips: Trip[], year: string): string[] {
  const set = new Set<string>();
  const prefix = `${year}-`;
  for (const t of trips) if (t.date && t.date.startsWith(prefix)) set.add(t.date.slice(5, 7));
  return [...set].sort();
}

/**
 * Filter trips to a time period. "all" year → every trip (dated or not). A
 * specific year (optionally + month) keeps only dated trips in that window;
 * undated trips fall out, since they can't belong to a period.
 */
export function tripsInPeriod(trips: Trip[], year: YearFilter, month: MonthFilter): Trip[] {
  if (year === "all") return trips;
  const prefix = `${year}-`;
  return trips.filter((t) => {
    if (!t.date || !t.date.startsWith(prefix)) return false;
    if (month !== "all" && t.date.slice(5, 7) !== month) return false;
    return true;
  });
}

/** Human label for the active period, e.g. "2024", "August 2024", or "" for all-time.
 *  `locale` localizes the month name (default English keeps the label stable for
 *  callers that don't pass one). */
export function periodLabel(year: YearFilter, month: MonthFilter, locale: string = "en"): string {
  if (year === "all") return "";
  if (month === "all") return year;
  return `${monthName(month, locale)} ${year}`;
}

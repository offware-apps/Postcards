import { continentColor } from "../../lib/reference/continents";

/**
 * Month-calendar helpers for the Journal. All PURE (no store, no DOM, no
 * reference-data reads — a `continentOf` lookup is injected) so the grid layout
 * and the per-day colour/count derivation are unit-testable in isolation.
 *
 * Colour scheme (rationale): a day with entries is tinted by its DOMINANT place's
 * continent — country → continent → CONTINENT_COLORS — so the calendar reads like
 * the rest of the app's maps/stats (same palette, CVD-checked). The tint's alpha
 * scales with the entry COUNT (busier day = stronger tint). Colour is never the
 * only signal: every day also carries a count badge and an aria-label, and the day
 * number keeps full contrast (WCAG 2.1 AA, "don't rely on colour alone").
 */

/** Week starts on Monday — common in the app's fr/ko locales; header labels are localized separately. */
export const FIRST_DAY_OF_WEEK = 1; // 0 = Sunday, 1 = Monday

/** "YYYY-MM" of an ISO day (or any "YYYY-MM…" string). */
export function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Shift a "YYYY-MM" month string by `delta` months (can cross year boundaries). */
export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  // UTC math avoids DST/timezone drift; we only ever read the Y/M back out.
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface CalendarDay {
  /** Local YYYY-MM-DD for the cell. */
  iso: string;
  /** True for days of `ym`; false for the leading/trailing days that pad the grid. */
  inMonth: boolean;
  /** 1–31, the day number to display. */
  dayOfMonth: number;
}

/** Zero-padded YYYY-MM-DD from Y/M/D numbers (month is 1-based). */
function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A month laid out as full weeks (rows of 7), padded with the adjacent months'
 * days so every row has 7 cells. `firstDayOfWeek` picks the leftmost column.
 */
export function monthMatrix(ym: string, firstDayOfWeek = FIRST_DAY_OF_WEEK): CalendarDay[][] {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  const lead = (firstWeekday - firstDayOfWeek + 7) % 7;

  const cells: CalendarDay[] = [];
  // Leading days from the previous month.
  if (lead > 0) {
    const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    for (let i = lead; i > 0; i--) {
      const day = prevDays - i + 1;
      cells.push({ iso: isoOf(py, pm, day), inMonth: false, dayOfMonth: day });
    }
  }
  // The month itself.
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: isoOf(y, m, day), inMonth: true, dayOfMonth: day });
  }
  // Trailing days from the next month to complete the final week.
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  let nd = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ iso: isoOf(ny, nm, nd), inMonth: false, dayOfMonth: nd });
    nd++;
  }
  // Chunk into weeks.
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Tint strength (alpha, 0..1) for a day with `count` entries. Kept deliberately
 * light so the semi-transparent tint never swamps the day number's contrast:
 * one entry ≈ 0.22, growing ~0.11 per extra entry, capped at 0.55.
 */
export function dayIntensity(count: number): number {
  if (count <= 0) return 0;
  return Math.min(0.55, 0.22 + 0.11 * (count - 1));
}

/** Hex "#rrggbb" → "rgba(r, g, b, a)" (alpha applied so the surface shows through). */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface StoryDayCell {
  /** YYYY-MM-DD. */
  iso: string;
  /** Number of stories on this day (drives the badge and the tint alpha). */
  count: number;
  /** ISO2 of the day's dominant place (most entries; ties → lexicographically first). */
  countryId: string;
  /** Continent of the dominant country ("" when unknown). */
  continent: string;
  /** Continent colour (falls back to the neutral CONTINENT_FALLBACK). */
  color: string;
  /** Tint alpha for the cell background (see dayIntensity). */
  intensity: number;
}

/** Minimal story shape the day index needs. `place` is optional (a place-less
 *  postcard, v13) — such a day tints with a neutral (empty) country/continent. */
type DatedPlaced = { date: string; place?: { countryId: string } | null };

/**
 * Index stories by day. For each day that has ≥1 entry, returns its count and the
 * DOMINANT country (the countryId with the most entries that day; ties break to
 * the lexicographically-smallest code for determinism regardless of input order),
 * plus that country's continent, colour, and tint alpha. Days with no entries are
 * simply absent from the map (they render neutral).
 */
export function storyDayIndex(
  stories: DatedPlaced[],
  continentOf: (iso2: string) => string,
): Map<string, StoryDayCell> {
  // day -> (countryId -> count)
  const byDay = new Map<string, Map<string, number>>();
  for (const s of stories) {
    if (!s.date) continue;
    let counts = byDay.get(s.date);
    if (!counts) byDay.set(s.date, (counts = new Map()));
    const cid = s.place?.countryId ?? "";
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }

  const index = new Map<string, StoryDayCell>();
  for (const [iso, counts] of byDay) {
    let total = 0;
    let bestId = "";
    let bestN = -1;
    for (const [cid, n] of counts) {
      total += n;
      // Higher count wins; on a tie the smaller code wins (stable ordering).
      if (n > bestN || (n === bestN && cid < bestId)) {
        bestN = n;
        bestId = cid;
      }
    }
    const continent = continentOf(bestId);
    index.set(iso, {
      iso,
      count: total,
      countryId: bestId,
      continent,
      color: continentColor(continent),
      intensity: dayIntensity(total),
    });
  }
  return index;
}

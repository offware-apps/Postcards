// Intl-based formatting so numbers/percents/dates adapt to the viewer's locale
// (Constitution VII: regional adaptivity). Each helper takes an explicit locale,
// but defaults to the app's ACTIVE UI locale — the settings store threads it in
// via setFormatLocale on load and on every language change, so numbers, percents,
// distances and dates follow the chosen language (e.g. French "1 234", "12 %")
// without every call site having to pass it. When unset (tests, first boot) the
// locale is undefined and Intl falls back to the environment default, exactly as
// before — so existing behaviour and snapshots are unchanged.

import { isCalendarDate } from "../schema/helpers";

let activeLocale: string | undefined;

/** Set the locale used by the formatters when no explicit locale is passed. */
export function setFormatLocale(locale: string | undefined): void {
  activeLocale = locale;
}

export function formatInt(n: number, locale = activeLocale): string {
  return new Intl.NumberFormat(locale).format(Math.round(n));
}

/**
 * Flag emoji for an ISO 3166-1 alpha-2 country/territory code ("FR" -> 🇫🇷).
 * Pure Unicode regional indicators — offline, no assets; platforms without a
 * flag font show the letter pair, which stays informative.
 */
export function countryFlag(iso2: string): string {
  // "ZZ" is the ISO user-assigned code Postcards uses for places outside any
  // country (open ocean, world moments); it has no flag, so show a pin.
  if (iso2.toUpperCase() === "ZZ") return "📍";
  return iso2
    .toUpperCase()
    .replace(/[A-Z]/g, (ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Great-circle distance in km -> localized "1,234 km" (rounded to the km). */
export function formatKm(km: number, locale = activeLocale): string {
  return `${formatInt(km, locale)} km`;
}

/** value in [0,1] -> localized percentage, e.g. 0.1234 -> "12%". */
export function formatPercent(value: number, locale = activeLocale, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value);
}

/** Like formatPercent, but a real but tiny share (rounds to 0%) floors to "<1%" so
 *  progress never reads as "nothing" (coverage %s over huge denominators). */
export function formatPercentFloor(value: number, locale = activeLocale): string {
  const s = formatPercent(value, locale);
  return value > 0 && s === formatPercent(0, locale) ? "<1%" : s;
}

/** A calendar date -> localized label at the precision it carries: a day
 *  `YYYY-MM-DD` ("Aug 12, 2024"), a month `YYYY-MM` ("Aug 2024") or a year `YYYY`
 *  ("2024"), so a vague trip date never gains a day it doesn't have. Formatted in
 *  UTC, so the label is the same in every time zone. Passthrough if unparseable or
 *  not a real day (Feb 30 is shown as typed, not rolled into March). */
export function formatDate(iso: string | null, locale = activeLocale): string {
  if (!iso) return "";
  if (!isCalendarDate(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number) as [number, number?, number?];
  if (month == null) return String(year);
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day ?? 1);
  return new Intl.DateTimeFormat(
    locale,
    day == null
      ? { year: "numeric", month: "short", timeZone: "UTC" }
      : { dateStyle: "medium", timeZone: "UTC" },
  ).format(d);
}

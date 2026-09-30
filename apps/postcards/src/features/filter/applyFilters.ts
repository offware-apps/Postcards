import type { Visit } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import type { FilterState, FilterStatus } from "../../lib/store/useFilters";
import { mapDateMatches, rangeExactYear } from "../travel/period";
import { countryFlag } from "../../lib/format/format";
import type { TFunction, MessageKey } from "../../lib/i18n";

// Pure predicates shared by every screen that slices places (spec 016 D3). No I/O,
// no mutation — deterministic for a given (input, FilterState). The map feeds its
// browse cities through viewport.ts (status + population there); THESE cover the
// Places lists and the active-filter summary, so both screens agree.

/** A place's headcount for the population filter, or null when population does NOT
 *  apply to that kind (monuments, airports, countries) so they're never filtered
 *  out by it. Cities read the gazetteer; a custom pin uses the number the user
 *  typed (absent = 0), so a custom "city" with no people counts as 0. */
function populationFor(v: Visit, ref: ReferenceData): number | null {
  if (v.place.kind === "city") return ref.cityById(v.place.id)?.population ?? 0;
  if (v.place.kind === "custom") return v.place.population ?? 0;
  return null; // heritage / airport / station / country: no population — exempt from the filter
}

/** Whether one visit record passes the filter (Places lists). `status` is owned by
 *  the Places tab, so callers pass state.status = "all" there; the population gate
 *  applies to cities and custom pins (a missing/0 headcount fails a positive
 *  threshold); monuments and airports have no population and always pass it. */
export function placeMatches(v: Visit, ref: ReferenceData, s: FilterState): boolean {
  // Multi-select status: a saved record shows only if its own status is among the
  // selected ones (empty = all). A saved record is never "unvisited", so a filter
  // of only "unvisited" excludes every saved place.
  if (s.status.length > 0 && !s.status.includes(v.status as FilterStatus)) return false;
  // Kind filter — the shared map "mode". "cities" also covers your own custom pins
  // (they ride with cities on the map); "monuments" = heritage sites; "airports" =
  // airports. "all" (the default) filters nothing by kind.
  if (s.mode === "cities" && v.place.kind !== "city" && v.place.kind !== "custom") return false;
  if (s.mode === "monuments" && v.place.kind !== "heritage") return false;
  if (s.mode === "airports" && v.place.kind !== "airport") return false;
  if (s.mode === "stations" && v.place.kind !== "station") return false;
  // Monument category (cultural / natural / mixed) — a dataset tag, honoured only
  // for heritage so the Places browse and the personal list agree (FR-008/FR-012).
  // No-op for every other kind and when no category is selected.
  if (s.category && v.place.kind === "heritage" && ref.heritageById(v.place.id)?.category !== s.category)
    return false;
  if (!mapDateMatches(v.date, s.date)) return false;
  if (s.folder && v.folder !== s.folder) return false;
  if (s.favoritesOnly && !v.favorite) return false;
  if (s.hasPhoto && !(v.photos && v.photos.length > 0)) return false;
  if (s.hasNote && !(v.note && v.note.trim())) return false;
  if (s.minPop > 0) {
    const pop = populationFor(v, ref);
    // Only kinds that HAVE a population (city, custom) are gated; null = exempt.
    if (pop !== null && pop < s.minPop) return false;
  }
  if (s.continent && ref.continentOf(v.place.countryId) !== s.continent) return false;
  // One-country drill-down (set from the Stats country card). ISO codes compare
  // directly; a place with no country ("ZZ") never matches a real code.
  if (s.country && v.place.countryId !== s.country) return false;
  return true;
}

/** Population of a visit's place for sorting (city + custom; others sort as 0). */
function popOf(v: Visit, ref: ReferenceData): number {
  return populationFor(v, ref) ?? 0;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/** Order a visit list per state.sort ("pop" = most people first; "az" = by name). */
export function sortPlaces(list: Visit[], ref: ReferenceData, s: FilterState): Visit[] {
  const out = [...list];
  if (s.sort === "az") out.sort((a, b) => collator.compare(a.place.name, b.place.name));
  else out.sort((a, b) => popOf(b, ref) - popOf(a, ref) || collator.compare(a.place.name, b.place.name));
  return out;
}

export interface ActiveFilterChip {
  field: keyof FilterState;
  label: string;
}

/** Localised, ordered summary of every non-default dimension (one chip each). The
 *  caller wires each chip's ✕ to clearField(field). Pure: no store dependency.
 *  `ref` (optional) names the country chip — without it, the ISO code shows. */
export function activeChips(s: FilterState, t: TFunction, ref?: ReferenceData): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  // Only a partial selection is a "filter" (empty or all three = show everything).
  if (s.status.length > 0 && s.status.length < 3) {
    const label = s.status.map((st) => t(`filter.status.${st}` as MessageKey)).join(", ");
    chips.push({ field: "status", label });
  }
  if (s.minPop > 0) {
    const label = s.minPop >= 1_000_000 ? "1M+" : s.minPop >= 100_000 ? "100k+" : "10k+";
    chips.push({ field: "minPop", label });
  }
  if (s.date.mode === "undated") {
    chips.push({ field: "date", label: t("filter.date.undated") });
  } else if (s.date.mode === "range") {
    const y = rangeExactYear(s.date);
    chips.push({ field: "date", label: y ?? [s.date.from, s.date.to].filter(Boolean).join(" – ") });
  }
  if (s.folder) chips.push({ field: "folder", label: `📁 ${s.folder}` });
  if (s.mode !== "all") {
    chips.push({ field: "mode", label: t(`filter.mode.${s.mode}` as MessageKey) });
  }
  if (s.favoritesOnly) chips.push({ field: "favoritesOnly", label: t("filter.favoritesOnly") });
  if (s.hasPhoto) chips.push({ field: "hasPhoto", label: t("filter.hasPhoto") });
  if (s.hasNote) chips.push({ field: "hasNote", label: t("filter.hasNote") });
  if (s.continent) chips.push({ field: "continent", label: s.continent });
  if (s.country) {
    const name = ref?.countryByIso2(s.country)?.name ?? s.country;
    chips.push({ field: "country", label: `${countryFlag(s.country)} ${name}` });
  }
  if (s.sort !== "pop") chips.push({ field: "sort", label: t("filter.sort.az") });
  return chips;
}

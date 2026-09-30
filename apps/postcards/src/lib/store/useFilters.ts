import { create } from "zustand";

// The ONE shared filter state. Every screen that slices the user's places — the
// map (markers + in-view list + counters) and the Places lists — reads THIS, so
// they can never disagree (spec 016). Preference dimensions persist to
// localStorage (reusing the keys the old scattered controls used); the rest are
// session-scoped, exactly as the map's date/folder always were.

// Structurally identical to the map's CityStatus / MapMode / MapDate so a
// FilterState value passes straight into viewport.ts and MapView without adapters
// (TypeScript structural typing), while this module stays free of feature imports.
// Personal status is MULTI-SELECT (spec 016 + user ask): pick any combination of
// visited / want-list / not-been. An EMPTY array = show everything (the default),
// so you see it all by default and can quickly narrow to any mix.
export type FilterStatus = "visited" | "wishlist" | "unvisited";
/** True iff `statuses` shows a given kind — empty (or all three) means "show all". */
export function statusShows(statuses: readonly FilterStatus[], kind: FilterStatus): boolean {
  return statuses.length === 0 || statuses.length === 3 || statuses.includes(kind);
}
export type SortOrder = "pop" | "az";
export type FilterMode = "all" | "cities" | "monuments" | "airports" | "stations";
export type FilterDate =
  | { mode: "all" }
  | { mode: "undated" }
  | { mode: "range"; from: string; to: string };

export interface FilterState {
  /** Which personal statuses to show. Empty = all (default). */
  status: FilterStatus[];
  /** Minimum city population (0 = any). Gates cities only (spec 016 D4). */
  minPop: number;
  date: FilterDate;
  /** "" = all folders/trips. */
  folder: string;
  sort: SortOrder;
  /** Map-only: which place kind the markers show. */
  mode: FilterMode;
  /** Monument category filter (kind = monuments): "" (all) | cultural | natural | mixed.
   *  Session-scoped, like date/folder; the map ignores it. */
  category: string;
  /** Narrow every list to ONE country (ISO 3166-1 alpha-2; "" = all). Set from the
   *  Stats country card ("show France's mega cities…"); session-scoped and, like
   *  category, a lists dimension the map ignores (you pan to a country there). */
  country: string;
  // Growth dimensions (US4) — off by default, hosted in the one panel.
  favoritesOnly: boolean;
  hasPhoto: boolean;
  hasNote: boolean;
  /** "" = all continents. */
  continent: string;
  /** Scope: when true, the filter applies to the LISTS only and the MAP shows
   *  everything (its markers ignore status/people/date/folder). Session-scoped; a
   *  meta-flag, so it never counts as an "active filter" chip. */
  listOnly: boolean;
}

export const POP_CHOICES = [0, 10_000, 100_000, 1_000_000] as const;

export const DEFAULT_FILTERS: FilterState = {
  status: [],
  minPop: 0,
  date: { mode: "all" },
  folder: "",
  sort: "pop",
  mode: "all",
  category: "",
  country: "",
  favoritesOnly: false,
  hasPhoto: false,
  hasNote: false,
  continent: "",
  listOnly: false,
};

// Every filter VALUE persists across sessions (the map and the lists both read
// this store, so both reopen exactly as you left them). status/minPop/sort/mode
// keep their own legacy keys (so upgrading users keep those choices); the rest
// ride in one JSON blob. `listOnly` is the only thing NOT saved — it's a per-
// session scope toggle (whether the filter also narrows the map), not a value.
const STATUS_KEY = "postcards-city-filter";
const MINPOP_KEY = "postcards-city-minpop";
const SORT_KEY = "postcards-list-sort";
const MODE_KEY = "postcards-map-mode";
const EXTRA_KEY = "postcards-filter-extra";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: not persisted */
  }
}

function loadStatus(): FilterStatus[] {
  // Stored as a comma list; older builds stored a single value ("visited") or
  // "all" — both parse cleanly ("all" / "" → empty = show everything).
  const raw = readLocal(STATUS_KEY);
  if (!raw) return [];
  const kinds: FilterStatus[] = ["visited", "wishlist", "unvisited"];
  return raw.split(",").filter((v): v is FilterStatus => kinds.includes(v as FilterStatus));
}
function loadMinPop(): number {
  const n = Number(readLocal(MINPOP_KEY));
  return (POP_CHOICES as readonly number[]).includes(n) ? n : 0;
}
function loadSort(): SortOrder {
  return readLocal(SORT_KEY) === "az" ? "az" : "pop";
}
function loadMode(): FilterMode {
  const v = readLocal(MODE_KEY);
  return v === "cities" || v === "monuments" || v === "airports" || v === "stations" ? v : "all";
}

/** The remaining value dimensions (date/folder/category/country/continent/growth),
 *  restored from the JSON blob and validated field-by-field so a corrupt or stale
 *  entry falls back to its default rather than throwing. */
function loadExtra(): Pick<
  FilterState,
  "date" | "folder" | "category" | "continent" | "favoritesOnly" | "hasPhoto" | "hasNote"
> {
  // `country` is deliberately excluded — a drill-down never persists across
  // restarts (see persist()), so any stale value from an older build is ignored.
  const base = {
    date: DEFAULT_FILTERS.date,
    folder: DEFAULT_FILTERS.folder,
    category: DEFAULT_FILTERS.category,
    continent: DEFAULT_FILTERS.continent,
    favoritesOnly: DEFAULT_FILTERS.favoritesOnly,
    hasPhoto: DEFAULT_FILTERS.hasPhoto,
    hasNote: DEFAULT_FILTERS.hasNote,
  };
  const raw = readLocal(EXTRA_KEY);
  if (!raw) return base;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
    let date: FilterDate = DEFAULT_FILTERS.date;
    const d = p.date as Record<string, unknown> | undefined;
    if (d && d.mode === "undated") date = { mode: "undated" };
    else if (d && d.mode === "range" && typeof d.from === "string" && typeof d.to === "string")
      date = { mode: "range", from: d.from, to: d.to };
    return {
      date,
      folder: str(p.folder) ?? base.folder,
      category: str(p.category) ?? base.category,
      continent: str(p.continent) ?? base.continent,
      favoritesOnly: bool(p.favoritesOnly) ?? base.favoritesOnly,
      hasPhoto: bool(p.hasPhoto) ?? base.hasPhoto,
      hasNote: bool(p.hasNote) ?? base.hasNote,
    };
  } catch {
    return base;
  }
}

function persist(state: FilterState): void {
  writeLocal(STATUS_KEY, state.status.join(","));
  writeLocal(MINPOP_KEY, String(state.minPop));
  writeLocal(SORT_KEY, state.sort);
  writeLocal(MODE_KEY, state.mode);
  writeLocal(
    EXTRA_KEY,
    // NOTE: `country` is intentionally NOT persisted. It's a transient drill-down
    // (tapping into a country from a Stats card), not a saved preference — it
    // survives navigation within a session (it lives in the store) but must reset
    // on restart, so the app never reopens stuck filtered to one country.
    JSON.stringify({
      date: state.date,
      folder: state.folder,
      category: state.category,
      continent: state.continent,
      favoritesOnly: state.favoritesOnly,
      hasPhoto: state.hasPhoto,
      hasNote: state.hasNote,
    }),
  );
}

/** True iff every dimension is at its default (⇒ no active filters, empty summary). */
export function isDefault(s: FilterState): boolean {
  return (
    s.status.length === 0 &&
    s.minPop === 0 &&
    s.date.mode === "all" &&
    s.folder === "" &&
    s.sort === "pop" &&
    s.mode === "all" &&
    s.category === "" &&
    s.country === "" &&
    !s.favoritesOnly &&
    !s.hasPhoto &&
    !s.hasNote &&
    s.continent === ""
  );
}

/** A copy of `s` with exactly `field` reset to its default (for a chip's ✕). */
export function withFieldCleared(s: FilterState, field: keyof FilterState): FilterState {
  return { ...s, [field]: DEFAULT_FILTERS[field] } as FilterState;
}

interface FilterStore extends FilterState {
  set: (partial: Partial<FilterState>) => void;
  clearField: (field: keyof FilterState) => void;
  clearAll: () => void;
}

export const useFilters = create<FilterStore>((set, get) => ({
  ...DEFAULT_FILTERS,
  status: loadStatus(),
  minPop: loadMinPop(),
  sort: loadSort(),
  mode: loadMode(),
  ...loadExtra(),
  set: (partial) => {
    set(partial);
    persist(get());
  },
  clearField: (field) => {
    set({ [field]: DEFAULT_FILTERS[field] } as Partial<FilterState>);
    persist(get());
  },
  clearAll: () => {
    set({ ...DEFAULT_FILTERS });
    persist(get());
  },
}));

/** Read the current FilterState (the persisted/session fields only) without the actions. */
export function currentFilters(s: FilterStore): FilterState {
  return {
    status: s.status,
    minPop: s.minPop,
    date: s.date,
    folder: s.folder,
    sort: s.sort,
    mode: s.mode,
    category: s.category,
    country: s.country,
    favoritesOnly: s.favoritesOnly,
    hasPhoto: s.hasPhoto,
    hasNote: s.hasNote,
    continent: s.continent,
    listOnly: s.listOnly,
  };
}

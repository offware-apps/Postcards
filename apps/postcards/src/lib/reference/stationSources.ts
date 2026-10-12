// The railway-station reference datasets the user can choose between (Settings →
// "Railway stations"). Each is an openly-licensed external dataset (Constitution I:
// aggregator, never author) bundled as its own file under public/reference/; the
// user picks which one they load — or "None" to carry none at all.
//
// This catalogue is DATA-DRIVEN: the Settings picker lists exactly what's here.
// The worldwide set comes from the shared Offware places dataset (Wikidata, CC0),
// fetched at build time by `scripts/fetch-places.mjs`.

const BASE = import.meta.env.BASE_URL;

/** Stable ids, persisted in localStorage — never renumber. "none" loads nothing. */
export type StationSourceId = "wikidata" | "trainline" | "none";

export interface StationSourceDef {
  id: StationSourceId;
  /** Bundled JSON to fetch (`{_source, stations[]}`), or null for "None". */
  url: string | null;
  /** SPDX-ish licence id, surfaced in Settings + provenance. "" for "None". */
  license: string;
  coverage: "europe" | "worldwide" | "none";
  /** The suggested default, badged in the picker. Exactly one should be true. */
  recommended: boolean;
}

// Wikidata (CC0, worldwide) is the recommended default. Trainline (ODbL, Europe)
// stays selectable: its station ids differ, so people who marked stations from it
// keep it until they choose otherwise (see loadStationSource).
export const STATION_SOURCES: readonly StationSourceDef[] = [
  {
    id: "wikidata",
    url: `${BASE}reference/railways-wikidata.json`,
    license: "CC0-1.0",
    coverage: "worldwide",
    recommended: true,
  },
  {
    id: "trainline",
    url: `${BASE}reference/railways.json`,
    license: "ODbL-1.0",
    coverage: "europe",
    recommended: false,
  },
  { id: "none", url: null, license: "", coverage: "none", recommended: false },
];

export const DEFAULT_STATION_SOURCE: StationSourceId = "wikidata";

const STATION_SOURCE_KEY = "postcards-station-source";
// Set once the app has been opened before (App.tsx). Before the worldwide set,
// Trainline was everyone's default, so an earlier user who never chose keeps it:
// their marked stations carry Trainline ids, which the worldwide set doesn't have.
const RETURNING_USER_KEY = "postcards-intro-seen";

export function isStationSource(v: unknown): v is StationSourceId {
  return STATION_SOURCES.some((s) => s.id === v);
}

export function stationSourceById(id: StationSourceId): StationSourceDef {
  return STATION_SOURCES.find((s) => s.id === id) ?? STATION_SOURCES[0]!;
}

/** The persisted choice (localStorage), validated. Read at reference-data init and
 *  by the settings store's initial state, so both agree without a hydration race. */
export function loadStationSource(): StationSourceId {
  try {
    const v = localStorage.getItem(STATION_SOURCE_KEY);
    if (isStationSource(v)) return v;
    // Either way the choice is saved now: a new user's intro flag, set on this
    // first run, must not turn them into a "returning" Trainline user next time.
    const choice: StationSourceId = localStorage.getItem(RETURNING_USER_KEY) != null ? "trainline" : DEFAULT_STATION_SOURCE;
    localStorage.setItem(STATION_SOURCE_KEY, choice);
    return choice;
  } catch {
    return DEFAULT_STATION_SOURCE;
  }
}

export function saveStationSource(id: StationSourceId): void {
  try {
    localStorage.setItem(STATION_SOURCE_KEY, id);
  } catch {
    /* private mode: not persisted */
  }
}

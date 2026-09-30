// The railway-station reference datasets the user can choose between (Settings →
// "Railway stations"). Each is an openly-licensed external dataset (Constitution I:
// aggregator, never author) bundled as its own file under public/reference/; the
// user picks which one they load — or "None" to carry none at all.
//
// This catalogue is DATA-DRIVEN: the Settings picker lists exactly what's here, so
// adding a worldwide build output (e.g. railways-wikidata.json from
// `node scripts/build-railways.mjs --source=wikidata`) is a one-line addition that
// automatically shows up as a selectable source — no UI change needed.

const BASE = import.meta.env.BASE_URL;

/** Stable ids, persisted in localStorage — never renumber. "none" loads nothing. */
export type StationSourceId = "trainline" | "none";

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

// Trainline (ODbL, Europe) is the recommended default — the only full open station
// set reachable from the build sandbox. A future worldwide file (Wikidata CC0 /
// OSM ODbL), produced by the build script on an open network, slots in here.
export const STATION_SOURCES: readonly StationSourceDef[] = [
  {
    id: "trainline",
    url: `${BASE}reference/railways.json`,
    license: "ODbL-1.0",
    coverage: "europe",
    recommended: true,
  },
  { id: "none", url: null, license: "", coverage: "none", recommended: false },
];

export const DEFAULT_STATION_SOURCE: StationSourceId = "trainline";

const STATION_SOURCE_KEY = "postcards-station-source";

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
    return isStationSource(v) ? v : DEFAULT_STATION_SOURCE;
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

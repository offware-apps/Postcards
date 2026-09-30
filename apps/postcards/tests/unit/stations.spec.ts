import { describe, it, expect } from "vitest";
import { initReferenceDataSync, setStationData } from "../../src/lib/reference/referenceData";
import type { Station } from "../../src/lib/reference/types";
import {
  STATION_SOURCES,
  DEFAULT_STATION_SOURCE,
  isStationSource,
  stationSourceById,
} from "../../src/lib/reference/stationSources";
import { PlaceRefSchema } from "../../src/lib/schema/models";

const stations: Station[] = [
  { id: "Q-gdl", name: "Paris Gare de Lyon", countryIso2: "FR", subdivisionId: null, lat: 48.84, lon: 2.37 },
  { id: "Q-pdd", name: "Lyon Part-Dieu", countryIso2: "FR", subdivisionId: null, lat: 45.76, lon: 4.86 },
  { id: "Q-tok", name: "Tokyo Station", countryIso2: "JP", subdivisionId: null, lat: 35.68, lon: 139.77 },
];

function ref() {
  return initReferenceDataSync([], [], [], [], {}, {}, stations);
}

describe("reference seam: railway stations", () => {
  it("indexes and returns all stations", () => {
    expect(ref().allStations()).toHaveLength(3);
  });

  it("looks a station up by its raw (opaque) id — no upper-casing", () => {
    expect(ref().stationById("Q-gdl")?.name).toBe("Paris Gare de Lyon");
    expect(ref().stationById("Q-GDL")).toBeUndefined(); // ids are opaque, not codes
  });

  it("searches stations by name (prefix before contains), accent/case-insensitive", () => {
    const r = ref();
    expect(r.searchStations("gare").map((s) => s.id)).toEqual(["Q-gdl"]);
    expect(r.searchStations("part").map((s) => s.id)).toEqual(["Q-pdd"]);
    expect(r.searchStations("station").map((s) => s.id)).toEqual(["Q-tok"]);
    expect(r.searchStations("")).toEqual([]);
  });

  it("groups stations per country for coverage (stationsOf)", () => {
    const r = ref();
    expect(r.stationsOf("FR").map((s) => s.id).sort()).toEqual(["Q-gdl", "Q-pdd"]);
    expect(r.stationsOf("jp")).toHaveLength(1); // case-insensitive iso2
    expect(r.stationsOf("ZZ")).toEqual([]);
  });

  it("degrades gracefully when no station data is present", () => {
    const r = initReferenceDataSync([], []);
    expect(r.allStations()).toEqual([]);
    expect(r.searchStations("gare")).toEqual([]);
    expect(r.stationsOf("FR")).toEqual([]);
  });
});

describe("schema: a station PlaceRef (v14)", () => {
  it("accepts kind 'station' and round-trips", () => {
    const parsed = PlaceRefSchema.parse({ kind: "station", id: "Q-gdl", name: "Paris Gare de Lyon", countryId: "FR" });
    expect(parsed.kind).toBe("station");
    expect(parsed.name).toBe("Paris Gare de Lyon");
  });
});

describe("station data sources (Settings choice)", () => {
  it("offers a recommended, bundled default and a 'none' escape hatch", () => {
    expect(isStationSource(DEFAULT_STATION_SOURCE)).toBe(true);
    expect(stationSourceById(DEFAULT_STATION_SOURCE).recommended).toBe(true);
    expect(stationSourceById(DEFAULT_STATION_SOURCE).url).toBeTruthy();
    const none = STATION_SOURCES.find((s) => s.id === "none");
    expect(none?.url).toBeNull();
    // Exactly one source is badged recommended.
    expect(STATION_SOURCES.filter((s) => s.recommended)).toHaveLength(1);
  });

  it("rejects unknown source ids", () => {
    expect(isStationSource("osm")).toBe(false);
    expect(isStationSource(null)).toBe(false);
  });

  it("setStationData swaps the live station set (Settings source switch)", () => {
    const ref = initReferenceDataSync([], [], [], [], {}, {}, stations);
    expect(ref.allStations()).toHaveLength(3);
    // Switch to a different set — e.g. a worldwide source, or clear for "None".
    setStationData([{ id: "Q-ny", name: "New York Penn", countryIso2: "US", subdivisionId: null, lat: 40.75, lon: -73.99 }]);
    expect(ref.allStations()).toHaveLength(1);
    expect(ref.stationById("Q-ny")?.name).toBe("New York Penn");
    expect(ref.stationsOf("FR")).toEqual([]); // old set gone
    setStationData([]); // "None"
    expect(ref.allStations()).toEqual([]);
  });
});

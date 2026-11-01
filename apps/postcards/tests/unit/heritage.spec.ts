import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initReferenceDataSync } from "../../src/lib/reference/referenceData";
import { computeCountryCoverage } from "../../src/features/stats/computeStats";
import { searchPlaces } from "../../src/features/visits/search";
import { coordsOf } from "../../src/features/travel/distance";
import type { HeritageSite } from "../../src/lib/reference/types";
import type { Visit } from "../../src/lib/schema/models";

// The shipped heritage.json is the FULL UNESCO World Heritage List (all ~1,248
// sites, one entry per country for transnational sites), built by
// Offware's shared data (offware-apps/data) from the official UNESCO data (CC BY-SA 3.0 IGO).
// The logic tests below still use small injected data so the wiring is verified
// independently of the shipped file; the bundled file itself is validated at the end.
const heritage: HeritageSite[] = [
  { id: "Q1", name: "Palace of Versailles", countryIso2: "FR", lat: 48.8, lon: 2.1 },
  { id: "Q2", name: "Mont-Saint-Michel", countryIso2: "FR", lat: 48.6, lon: -1.5 },
  { id: "Q3", name: "Historic Centre of Rome", countryIso2: "IT", lat: 41.9, lon: 12.5 },
  // A transnational site: one id, listed under both countries it spans.
  { id: "Q4", name: "Roman Frontiers", countryIso2: "FR", lat: 49.0, lon: 6.0 },
  { id: "Q4", name: "Roman Frontiers", countryIso2: "DE", lat: 50.0, lon: 8.0 },
];
const ref = initReferenceDataSync([], [], [], heritage);

function heritageVisit(id: string, iso2: string): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "heritage", id, name: id, countryId: iso2 },
    date: null,
    note: null,
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  };
}

describe("reference: heritage sites", () => {
  it("indexes sites by id and by country, and searches by name", () => {
    expect(ref.allHeritage()).toHaveLength(5); // 3 single-country + 2 rows of the transnational one
    expect(ref.heritageOf("FR")).toHaveLength(3); // Versailles, Mont-Saint-Michel, Roman Frontiers
    expect(ref.heritageOf("IT")).toHaveLength(1);
    expect(ref.heritageOf("DE")).toHaveLength(1);
    expect(ref.heritageOf("JP")).toHaveLength(0);
    expect(ref.heritageById("Q1")?.name).toBe("Palace of Versailles");
    expect(ref.searchHeritage("versailles")[0]?.id).toBe("Q1");
  });

  it("surfaces heritage sites in the unified place search", () => {
    const results = searchPlaces(ref, "Mont-Saint");
    expect(results.some((r) => r.place.kind === "heritage" && r.place.id === "Q2")).toBe(true);
  });
});

describe("stats: per-country heritage coverage", () => {
  it("counts visited sites against the country's total", () => {
    const fr = computeCountryCoverage([heritageVisit("Q1", "FR")], ref, "FR");
    expect(fr.heritageTotal).toBe(3); // Versailles, Mont-Saint-Michel, Roman Frontiers
    expect(fr.heritageVisited).toBe(1);
    expect(fr.heritagePct).toBeCloseTo(1 / 3);
  });

  it("never counts a site toward the wrong country", () => {
    const fr = computeCountryCoverage([heritageVisit("Q3", "IT")], ref, "FR");
    expect(fr.heritageVisited).toBe(0);
    expect(fr.heritageTotal).toBe(3); // Versailles, Mont-Saint-Michel, Roman Frontiers
  });

  it("credits a transnational site to every country whose list includes it", () => {
    const visits = [heritageVisit("Q4", "FR")]; // logged via the France result
    expect(computeCountryCoverage(visits, ref, "FR").heritageVisited).toBe(1);
    expect(computeCountryCoverage(visits, ref, "DE").heritageVisited).toBe(1); // spans DE too
    expect(computeCountryCoverage(visits, ref, "IT").heritageVisited).toBe(0);
  });
});

describe("travel: heritage endpoints resolve coordinates", () => {
  it("coordsOf returns a heritage site's coordinates for trip distance", () => {
    const c = coordsOf({ kind: "heritage", id: "Q2", name: "Mont-Saint-Michel", countryId: "FR" }, ref);
    expect(c).toEqual({ lon: -1.5, lat: 48.6 });
  });
});

describe("bundled heritage.json integrity (full UNESCO World Heritage List)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sites = JSON.parse(
    readFileSync(join(here, "..", "..", "public", "reference", "heritage.json"), "utf8"),
  ) as HeritageSite[];

  it("is the full list (~1,248 sites; transnational ones expanded per country)", () => {
    expect(sites.length).toBeGreaterThan(1000);
    expect(new Set(sites.map((s) => s.countryIso2)).size).toBeGreaterThan(150);
    // Landmarks we specifically expect from the full list (absent from the old 42-site seed).
    expect(sites.some((s) => s.name === "Taj Mahal")).toBe(true);
    // A transnational site appears once per country with country-suffixed ids.
    const struve = sites.filter((s) => s.id.startsWith("whs-struve-geodetic-arc"));
    expect(struve.length).toBe(10);
    expect(new Set(struve.map((s) => s.countryIso2)).size).toBe(10);
    expect(new Set(struve.map((s) => s.id)).size).toBe(10);
  });

  it("has unique whs- ids and valid records", () => {
    // Plain-loop validation (per-record expect() calls would be needlessly slow).
    const ids = new Set<string>();
    let bad = 0;
    for (const s of sites) {
      if (
        ids.has(s.id) ||
        !/^whs-[a-z0-9-]+$/.test(s.id) ||
        !/^[A-Z]{2}$/.test(s.countryIso2) ||
        s.name.length === 0 ||
        /[<>]/.test(s.name) || // names must be inert plain text, never HTML
        s.lat < -90 ||
        s.lat > 90 ||
        s.lon < -180 ||
        s.lon > 180 ||
        !["cultural", "natural", "mixed"].includes(s.category ?? "")
      ) {
        bad++;
      }
      ids.add(s.id);
    }
    expect(bad).toBe(0);
    expect(ids.size).toBe(sites.length);
  });

  it("carries real coordinates for essentially every site (0,0 means source had none)", () => {
    const zero = sites.filter((s) => s.lat === 0 && s.lon === 0);
    // Only the WWI Funerary and memory sites (BE+FR) ship without coordinates upstream.
    expect(zero.length).toBeLessThanOrEqual(3);
    expect(sites.length - zero.length).toBeGreaterThan(1000);
  });
});

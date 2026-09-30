import { describe, it, expect } from "vitest";
import {
  dateBuckets,
  mapDateMatches,
  yearRange,
  type MapDate,
} from "../../src/features/travel/period";
import { visitedCountryIds } from "../../src/features/stats/computeStats";
import type { PlaceRef, Visit } from "../../src/lib/schema/models";

// The map's date filter narrows YOUR visited places to a period. These tests pin
// country shading (visitedCountryIds over the set mapDateMatches keeps), plus the
// year chips.

function visit(
  id: string,
  countryId: string,
  date: string | null,
  extra: Partial<Visit> = {},
): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "city", id, name: id, countryId } as PlaceRef,
    date,
    note: null,
    status: "visited",
    favorite: false,
    addedAt: "2024-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("country shading over a period (visitedCountryIds of the filtered set)", () => {
  const visits = [
    visit("a", "FR", "2024-08-14"),
    visit("b", "JP", "2023-03-02"),
    visit("c", "FR", "2023-06-01"), // FR again, different year
    visit("d", "DE", null), // undated
  ];
  const shaded = (f: MapDate) => visitedCountryIds(visits.filter((v) => mapDateMatches(v.date, f)));
  const year = (y: string): MapDate => ({ mode: "range", ...yearRange(y) });

  it("'all' shades every visited country", () => {
    expect([...shaded({ mode: "all" })].sort()).toEqual(["DE", "FR", "JP"]);
  });
  it("a year shades only countries with a qualifying visit that year", () => {
    expect([...shaded(year("2024"))]).toEqual(["FR"]);
    expect([...shaded(year("2023"))].sort()).toEqual(["FR", "JP"]);
  });
  it("'undated' shades only countries reached by an undated visit", () => {
    expect([...shaded({ mode: "undated" })]).toEqual(["DE"]);
  });
});

describe("dateBuckets (the year chips over visited places)", () => {
  it("lists distinct years newest-first and flags the undated bucket", () => {
    const b = dateBuckets([
      visit("a", "FR", "2024-08-14"),
      visit("b", "JP", "2023-03-02"),
      visit("c", "IT", "2024-01-05"),
      visit("d", "DE", null),
    ]);
    expect(b.years).toEqual(["2024", "2023"]);
    expect(b.undated).toBe(true);
  });
  it("has no undated bucket when every visit is dated", () => {
    const b = dateBuckets([visit("a", "FR", "2024-08-14")]);
    expect(b.years).toEqual(["2024"]);
    expect(b.undated).toBe(false);
  });
  it("is empty for no visits", () => {
    expect(dateBuckets([])).toEqual({ years: [], undated: false });
  });
});

import { describe, it, expect } from "vitest";
import { parseRoute, routeHash } from "../../src/app/route";

describe("app: the screen in the address", () => {
  it("round-trips a tab, a city page and a country page", () => {
    for (const r of [
      { tab: "places" as const, cityPageId: null, countryPageId: null },
      { tab: "map" as const, cityPageId: "2988507", countryPageId: null },
      { tab: "stats" as const, cityPageId: null, countryPageId: "FR" },
      { tab: "journal" as const, cityPageId: "custom:a b/c", countryPageId: null },
    ])
      expect(parseRoute(routeHash(r))).toEqual(r);
    expect(routeHash({ tab: "stats", cityPageId: null, countryPageId: "FR" })).toBe(
      "#/stats/country/FR",
    );
  });

  it("names nothing for an empty, foreign or malformed hash", () => {
    for (const h of ["", "#", "#main", "#/nowhere", "#/places/country/fr", "#/map/city/", "#/map/city/1/x", "#/map/city/%E0%A4%A"])
      expect(parseRoute(h), h).toBeNull();
  });
});

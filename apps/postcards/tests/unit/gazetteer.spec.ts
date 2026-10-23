import { describe, it, expect } from "vitest";
import { getReferenceData } from "../../src/lib/reference/referenceData";

const ref = getReferenceData();

describe("bundled gazetteer integrity (full GeoNames-derived world gazetteer)", () => {
  const cities = ref.allCities();

  it("is the full world gazetteer (small towns & islands included)", () => {
    expect(cities.length).toBeGreaterThan(100000);
    expect(new Set(cities.map((c) => c.countryIso2)).size).toBeGreaterThan(180);
    // Regressions we specifically guard: Lombok (Indonesia) coverage and Beaumont, US.
    const lombok = cities.filter(
      (c) => c.countryIso2 === "ID" && c.lon > 115.8 && c.lon < 116.8 && c.lat > -9.2 && c.lat < -8.1,
    );
    expect(lombok.length).toBeGreaterThan(10);
    expect(cities.some((c) => c.name === "Beaumont" && c.countryIso2 === "US")).toBe(true);
  });

  it("has unique GeoNames ids and valid records", () => {
    // Plain-loop validation (an expect() per record × 135k would take minutes).
    const ids = new Set<string>();
    let bad = 0;
    for (const c of cities) {
      if (
        ids.has(c.id) ||
        c.name.length === 0 ||
        c.lat < -90 ||
        c.lat > 90 ||
        c.lon < -180 ||
        c.lon > 180 ||
        // Population is a real positive count or null (unknown) — never a fake 0.
        (c.population != null && c.population <= 0)
      ) {
        bad++;
      }
      ids.add(c.id);
    }
    expect(bad).toBe(0);
    expect(ids.size).toBe(cities.length);
  });

  it("keeps the population-sorted order the ranking relies on", () => {
    let sorted = true;
    for (let i = 1; i < cities.length; i++) {
      if ((cities[i - 1]!.population ?? 0) < (cities[i]!.population ?? 0)) {
        sorted = false;
        break;
      }
    }
    expect(sorted).toBe(true);
  });

  it("maps every French city to a real (named) region", () => {
    const frRegions = new Set(ref.subdivisionsOf("FR").map((s) => s.id));
    expect(frRegions.size).toBe(13); // 13 metropolitan regions
    const fr = cities.filter((c) => c.countryIso2 === "FR");
    expect(fr.length).toBeGreaterThan(500);
    for (const c of fr) {
      expect(c.subdivisionId).toBeTruthy();
      expect(frRegions.has(c.subdivisionId!)).toBe(true);
    }
  });

  it("names first-level regions worldwide (Paris in Île-de-France, Tokyo prefecture)", () => {
    const paris = ref.cityById("2988507");
    expect(paris?.name).toBe("Paris");
    expect(paris?.subdivisionId).toBe("FR-11");
    expect(ref.subdivisionById(paris!.subdivisionId!)?.name).toBe("Île-de-France");
    // A non-FR country resolves a real region name (not a code placeholder).
    const tokyo = ref.searchCities("Tokyo")[0]!;
    const tokyoRegion = ref.subdivisionById(tokyo.subdivisionId!);
    expect(tokyoRegion?.name).toBeTruthy();
    expect(tokyoRegion?.name.includes(" region ")).toBe(false);
  });

  // That each city carries the region code GeoNames lists today, and each region GeoNames'
  // name for it, is checked where the files are built: offware-apps/data.

  it("puts well-known cities in their own region", () => {
    const regionOf = (name: string, cc: string) => {
      const city = cities.find((c) => c.name === name && c.countryIso2 === cc);
      return ref.subdivisionById(city?.subdivisionId ?? "")?.name;
    };
    expect(regionOf("Hanoi", "VN")).toBe("Hanoi");
    expect(regionOf("Ho Chi Minh City", "VN")).toBe("Ho Chi Minh City (HCMC)");
    expect(regionOf("Drammen", "NO")).toBe("Buskerud");
    expect(regionOf("Riyadh", "SA")).toBe("Riyadh Region");
    expect(regionOf("Casablanca", "MA")).toBe("Casablanca-Settat");
    expect(regionOf("Brest", "FR")).toBe("Bretagne");
  });
});

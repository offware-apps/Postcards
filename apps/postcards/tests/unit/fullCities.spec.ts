import { describe, it, expect, vi, afterEach } from "vitest";
import {
  downloadFullCities,
  fullCitiesEnabled,
  initReferenceDataSync,
} from "../../src/lib/reference/referenceData";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("downloadFullCities", () => {
  it("does not record the full city list as downloaded when the download fails", async () => {
    // The bundled core set only, so the full list really has to be fetched.
    initReferenceDataSync(
      [
        {
          id: "paris",
          name: "Paris",
          countryIso2: "FR",
          subdivisionId: null,
          lat: 48.85,
          lon: 2.35,
          population: 2_100_000,
        },
      ],
      [],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await downloadFullCities()).toBe(false);
    // Settings reads this flag to show "✓ downloaded", and launches reload the
    // list from the cache because of it.
    expect(fullCitiesEnabled()).toBe(false);
  });
});

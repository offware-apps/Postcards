import { describe, it, expect, vi, afterEach } from "vitest";

// The first render waits on initReferenceData. On a phone the airports,
// heritage and station files held it back by seconds; it now needs only the
// cities and their regions, and the rest lands behind it.
describe("reference data at startup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves on the cities and regions, then merges airports, heritage sites and stations", async () => {
    const late: Record<string, (body: unknown) => void> = {};
    const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/cities.json"))
          return json([{ id: "1", name: "Lisbon", countryIso2: "PT", lat: 38.7, lon: -9.1, population: 500000 }]);
        if (url.endsWith("/subdivisions.json")) return json([]);
        // Everything else answers only when the test says so.
        return new Promise((resolve) => {
          late[url.split("/").pop()!] = (body) => resolve({ ok: true, json: () => Promise.resolve(body) });
        });
      }),
    );
    // A fresh module: the test setup already built the shared instance.
    vi.resetModules();
    const { initReferenceData, gazetteerGeneration, GAZETTEER_UPGRADED_EVENT } = await import(
      "../../src/lib/reference/referenceData"
    );
    const ref = await initReferenceData();
    expect(ref.cityById("1")?.name).toBe("Lisbon");
    expect(ref.airportById("LIS")).toBeUndefined();
    expect(ref.stationById("Q1")).toBeUndefined();

    const gen = gazetteerGeneration();
    const landed = new Promise((r) => window.addEventListener(GAZETTEER_UPGRADED_EVENT, r, { once: true }));
    late["airports.json"]!([{ id: "LIS", name: "Lisbon Portela", countryIso2: "PT", lat: 38.8, lon: -9.1 }]);
    late["heritage.json"]!([{ id: "h1", name: "Belém Tower", countryIso2: "PT", lat: 38.7, lon: -9.2 }]);
    late["landmarks.json"]!([]);
    late["languages.json"]!({});
    late["article-names.json"]!({});
    late["railways.json"]!({
      stations: [{ id: "Q1", name: "Lisboa Oriente", countryIso2: "PT", lat: 38.77, lon: -9.1 }],
    });
    await landed;
    expect(ref.airportById("LIS")?.name).toBe("Lisbon Portela");
    expect(ref.heritageById("h1")?.name).toBe("Belém Tower");
    expect(ref.stationById("Q1")?.name).toBe("Lisboa Oriente");
    expect(gazetteerGeneration()).toBe(gen + 1);
  });

  it("keeps a station source picked in Settings before the default one lands", async () => {
    const late: Record<string, (body: unknown) => void> = {};
    const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/cities.json")) return json([]);
        if (url.endsWith("/subdivisions.json")) return json([]);
        return new Promise((resolve) => {
          late[url.split("/").pop()!] = (body) => resolve({ ok: true, json: () => Promise.resolve(body) });
        });
      }),
    );
    vi.resetModules();
    const { initReferenceData, setStationData, GAZETTEER_UPGRADED_EVENT } = await import(
      "../../src/lib/reference/referenceData"
    );
    const ref = await initReferenceData();
    // "None" picked while the bundled stations are still on their way.
    setStationData([]);
    const landed = new Promise((r) => window.addEventListener(GAZETTEER_UPGRADED_EVENT, r, { once: true }));
    for (const name of ["airports.json", "heritage.json", "landmarks.json"]) late[name]!([]);
    late["languages.json"]!({});
    late["article-names.json"]!({});
    late["railways.json"]!({
      stations: [{ id: "Q1", name: "Lisboa Oriente", countryIso2: "PT", lat: 38.77, lon: -9.1 }],
    });
    await landed;
    expect(ref.allStations()).toEqual([]);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";

// The first render waits on initReferenceData. On a phone the airports,
// heritage and station files held it back by seconds; it now needs only the
// cities and their regions, and the rest lands behind it, the stations once
// the map (or a screen that needs them) is up.
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
    const {
      initReferenceData,
      gazetteerGeneration,
      referenceExtrasPending,
      requestStations,
      GAZETTEER_UPGRADED_EVENT,
    } =
      await import("../../src/lib/reference/referenceData");
    const ref = await initReferenceData();
    expect(ref.cityById("1")?.name).toBe("Lisbon");
    expect(ref.airportById("LIS")).toBeUndefined();
    expect(ref.stationById("Q1")).toBeUndefined();

    // The stations, the biggest file, are not asked for until a screen asks
    // (the map once it has loaded), so they never compete with it.
    expect(late["railways.json"]).toBeUndefined();

    const gen = gazetteerGeneration();
    const next = () =>
      new Promise((r) => window.addEventListener(GAZETTEER_UPGRADED_EVENT, r, { once: true }));
    let landed = next();
    late["airports.json"]!([{ id: "LIS", name: "Lisbon Portela", countryIso2: "PT", lat: 38.8, lon: -9.1 }]);
    late["heritage.json"]!([{ id: "h1", name: "Belém Tower", countryIso2: "PT", lat: 38.7, lon: -9.2 }]);
    late["landmarks.json"]!([]);
    late["languages.json"]!({});
    late["article-names.json"]!({});
    await landed;
    expect(ref.airportById("LIS")?.name).toBe("Lisbon Portela");
    expect(ref.heritageById("h1")?.name).toBe("Belém Tower");
    expect(gazetteerGeneration()).toBe(gen + 1);
    expect(referenceExtrasPending()).toBe(true);

    // Not on idle either: only on request.
    await new Promise((r) => setTimeout(r, 1600));
    expect(late["railways.json"]).toBeUndefined();
    requestStations();
    await vi.waitFor(() => expect(late["railways.json"]).toBeDefined(), { timeout: 3000 });
    landed = next();
    late["railways.json"]!({
      stations: [{ id: "Q1", name: "Lisboa Oriente", countryIso2: "PT", lat: 38.77, lon: -9.1 }],
    });
    await landed;
    expect(ref.stationById("Q1")?.name).toBe("Lisboa Oriente");
    expect(gazetteerGeneration()).toBe(gen + 2);
    expect(referenceExtrasPending()).toBe(false);
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
    const { initReferenceData, setStationData, requestStations, GAZETTEER_UPGRADED_EVENT } =
      await import("../../src/lib/reference/referenceData");
    const ref = await initReferenceData();
    // "None" picked while the bundled stations are still on their way.
    setStationData([]);
    for (const name of ["airports.json", "heritage.json", "landmarks.json"]) late[name]!([]);
    late["languages.json"]!({});
    late["article-names.json"]!({});
    requestStations();
    await vi.waitFor(() => expect(late["railways.json"]).toBeDefined(), { timeout: 3000 });
    const landed = new Promise((r) => window.addEventListener(GAZETTEER_UPGRADED_EVENT, r, { once: true }));
    late["railways.json"]!({
      stations: [{ id: "Q1", name: "Lisboa Oriente", countryIso2: "PT", lat: 38.77, lon: -9.1 }],
    });
    await landed;
    expect(ref.allStations()).toEqual([]);
  });
});

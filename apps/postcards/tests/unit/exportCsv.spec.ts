import { describe, it, expect } from "vitest";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import { serializePlacesCsv } from "../../src/features/backup/exportCsv";
import { parsePlacesCsv } from "../../src/features/backup/importCsv";
import type { Visit } from "../../src/lib/schema/models";

const ref = getReferenceData();

function visit(over: Partial<Visit> & { place: Visit["place"] }): Visit {
  return {
    visitId: "v-" + over.place.id,
    status: "visited",
    favorite: false,
    date: null,
    note: null,
    photos: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("serializePlacesCsv", () => {
  it("writes the header and the been/want/fave tags", () => {
    const paris = ref.searchCities("Paris").find((c) => c.countryIso2 === "FR")!;
    const csv = serializePlacesCsv(
      [
        visit({ place: { kind: "city", id: paris.id, name: paris.name, countryId: "FR" }, favorite: true }),
        visit({
          place: { kind: "custom", id: "csv:JP:somewhere", name: "Somewhere", countryId: "JP", lat: 35, lon: 139 },
          status: "wishlist",
        }),
      ],
      ref,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("lat;lon;country;city;been;date");
    expect(lines[1]).toContain('"fr"');
    expect(lines[1]).toContain('"been,fave"');
    expect(lines[2]).toContain('"want"');
    expect(lines[2]).toContain('"Somewhere"');
  });

  it("round-trips through the CSV importer", () => {
    const tokyo = ref.searchCities("Tokyo").find((c) => c.countryIso2 === "JP")!;
    const original = visit({
      place: { kind: "city", id: tokyo.id, name: tokyo.name, countryId: "JP" },
      favorite: true,
      date: "2025-06-14",
    });
    const csv = serializePlacesCsv([original], ref);
    const { places } = parsePlacesCsv(csv, ref);
    expect(places).toHaveLength(1);
    expect(places[0]!.place.kind).toBe("city");
    expect(places[0]!.place.id).toBe(tokyo.id); // same gazetteer record
    expect(places[0]!.status).toBe("visited");
    expect(places[0]!.favorite).toBe(true);
    expect(places[0]!.date).toBe("2025-06-14"); // the visit date round-trips
  });

  it("writes a formula-like name inert for spreadsheets and reads it back as typed", () => {
    const evil = visit({
      place: { kind: "custom", id: "csv:FR:x", name: '=HYPERLINK("http://x")', countryId: "FR", lat: 1, lon: 2 },
    });
    const minus = visit({
      place: { kind: "custom", id: "csv:FR:y", name: "-Le Bout du Monde", countryId: "FR", lat: 3, lon: 4 },
    });
    const csv = serializePlacesCsv([evil, minus], ref);
    const lines = csv.trim().split("\n");
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[2]).toContain(`"'-Le Bout du Monde"`);
    const { places } = parsePlacesCsv(csv, ref);
    expect(places.map((p) => p.place.name)).toEqual(['=HYPERLINK("http://x")', "-Le Bout du Monde"]);
  });

  it("skips bare country records (nothing to place on a map)", () => {
    const csv = serializePlacesCsv([visit({ place: { kind: "country", id: "FR", name: "France", countryId: "FR" } })], ref);
    expect(csv.trim().split("\n")).toHaveLength(1); // header only
  });
});

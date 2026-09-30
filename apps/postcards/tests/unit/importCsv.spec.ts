import { describe, it, expect } from "vitest";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import { parsePlacesCsv } from "../../src/features/backup/importCsv";
import { serializeFile } from "../../src/features/backup/exportJson";
import type { Visit } from "../../src/lib/schema/models";

const ref = getReferenceData();

// The app's own export shape: semicolon-delimited, quoted fields, a "been"
// column whose comma-separated tags carry the state.
const SAMPLE = [
  "lat;lon;country;city;been",
  '35.6895;139.69171;"jp";"Tokyo";"been"',
  '48.85341;2.3488;"fr";"Paris";"been,fave"',
  '39.9075;116.39723;"cn";"Beijing";"want"',
  '37.566;126.9784;"kr";"Seoul";"been,fave"',
  '0;0;"zz";"Nowhere";"want"', // invalid country → skipped
].join("\n");

describe("parsePlacesCsv (multi-format place import)", () => {
  it("maps been/want/fave tags to status + favorite", () => {
    const { places, total, skipped } = parsePlacesCsv(SAMPLE, ref);
    expect(total).toBe(5);
    expect(skipped).toBe(1); // the "zz" row
    const byName = Object.fromEntries(places.map((p) => [p.place.name, p]));

    expect(byName["Tokyo"]!.status).toBe("visited");
    expect(byName["Tokyo"]!.favorite).toBe(false);
    expect(byName["Paris"]!.status).toBe("visited");
    expect(byName["Paris"]!.favorite).toBe(true); // been,fave
    expect(byName["Beijing"]!.status).toBe("wishlist"); // want
    expect(byName["Seoul"]!.favorite).toBe(true);
  });

  it("resolves known cities to real gazetteer records (not custom points)", () => {
    const { places } = parsePlacesCsv(SAMPLE, ref);
    const paris = places.find((p) => p.place.name === "Paris")!;
    expect(paris.place.kind).toBe("city");
    // A real gazetteer id, so it counts in stats and links to a city page.
    expect(paris.place.countryId).toBe("FR");
    expect(paris.place.id).not.toMatch(/^csv:/);
  });

  it("falls back to a stable custom point for an unknown place name", () => {
    const csv = 'lat;lon;country;city;been\n48.805;2.1194;"fr";"Palace and Park of Versailles";"been"';
    const { places } = parsePlacesCsv(csv, ref);
    expect(places).toHaveLength(1);
    expect(places[0]!.place.kind).toBe("custom");
    expect(places[0]!.place.id).toBe("csv:FR:palace-and-park-of-versailles");
    expect(places[0]!.place.lat).toBeCloseTo(48.805, 2);
  });

  it("accepts a comma-delimited file and flexible headers/order", () => {
    const csv = "Name,Country,Latitude,Longitude,Status\nLisbon,PT,38.72,-9.13,want";
    const { places } = parsePlacesCsv(csv, ref);
    expect(places).toHaveLength(1);
    expect(places[0]!.place.name).toBe("Lisbon");
    expect(places[0]!.place.countryId).toBe("PT");
    expect(places[0]!.status).toBe("wishlist");
  });

  it("defaults to visited when there is no status column", () => {
    const csv = "city;country\nRome;IT";
    const { places } = parsePlacesCsv(csv, ref);
    expect(places[0]!.status).toBe("visited");
  });

  it("returns nothing (not a crash) for a file missing name/country columns", () => {
    const { places, skipped } = parsePlacesCsv("foo;bar\n1;2", ref);
    expect(places).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips and counts a row the portable file would reject, so export still works", () => {
    const csv = [
      "lat;lon;country;city;been",
      '999;10;"fr";"Nowhere";"been"', // latitude out of range
      `1;2;"fr";"${"x".repeat(300)}";"been"`, // name over the 200 cap
      '1;2;"fr";"Somewhere";"been"',
    ].join("\n");
    const { places, total, skipped } = parsePlacesCsv(csv, ref);
    expect({ total, skipped }).toEqual({ total: 3, skipped: 2 });
    expect(places.map((p) => p.place.name)).toEqual(["Somewhere"]);
    const visits: Visit[] = places.map((p, i) => ({
      visitId: `v${i}`,
      place: p.place,
      status: p.status,
      favorite: p.favorite,
      date: p.date,
      note: null,
      addedAt: "2024-01-01T00:00:00.000Z",
    }));
    expect(() => serializeFile(visits)).not.toThrow();
  });

  it("reads empty coordinates as none, not 0,0", () => {
    const { places } = parsePlacesCsv('lat;lon;country;city;been\n;;"fr";"My Cabin";"been"\n', ref);
    expect(places[0]!.place.kind).toBe("custom");
    expect(places[0]!.place.lat).toBeUndefined();
    expect(places[0]!.place.lon).toBeUndefined();
  });

  it("keeps a real visit date and drops one that names no day", () => {
    const csv = 'lat;lon;country;city;been;date\n1;2;"fr";"A";"been";2024-02-29\n3;4;"fr";"B";"been";2024-13-45\n';
    expect(parsePlacesCsv(csv, ref).places.map((p) => p.date)).toEqual(["2024-02-29", null]);
  });
});

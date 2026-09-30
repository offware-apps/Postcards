import { describe, it, expect } from "vitest";
import { z } from "zod";
import { PostcardsFileSchema, StorySchema, TripSchema, VisitSchema } from "../../src/lib/schema/models";

function baseVisit() {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "country", id: "FR", name: "France", countryId: "FR" },
    date: null,
    note: null,
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  };
}

describe("PostcardsFileSchema", () => {
  it("accepts a well-formed file", () => {
    const r = PostcardsFileSchema.safeParse({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [baseVisit()],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const r = PostcardsFileSchema.safeParse({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [],
      evil: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a bad country id", () => {
    const bad = baseVisit();
    bad.place.countryId = "France";
    const r = VisitSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("defaults status/favorite for records from older files", () => {
    const legacy = { ...baseVisit() } as Record<string, unknown>;
    delete legacy.status;
    delete legacy.favorite;
    const r = VisitSchema.parse(legacy);
    expect(r.status).toBe("visited");
    expect(r.favorite).toBe(false);
  });

  it("accepts wishlist + favorite records", () => {
    const r = VisitSchema.parse({ ...baseVisit(), status: "wishlist", favorite: true });
    expect(r.status).toBe("wishlist");
    expect(r.favorite).toBe(true);
  });

  it("keeps a note's leading formula char (plain text in the file)", () => {
    const v = { ...baseVisit(), note: "=HYPERLINK(evil)" };
    const r = VisitSchema.parse(v);
    expect(r.note).toBe("=HYPERLINK(evil)");
  });

  it("keeps an optional folder (sanitized) and never injects the key when absent", () => {
    // Present: sanitized and kept.
    const withFolder = VisitSchema.parse({ ...baseVisit(), folder: "  Japan 2024  " });
    expect(withFolder.folder).toBe("Japan 2024");
    // Absent: the key must NOT be injected, so folder-less files round-trip byte-identically.
    const without = VisitSchema.parse(baseVisit());
    expect("folder" in without).toBe(false);
    // A folder that sanitizes away is dropped to undefined — which JSON.stringify
    // omits, so it never persists an empty folder.
    const blank = VisitSchema.parse({ ...baseVisit(), folder: "   " });
    expect(blank.folder).toBeUndefined();
    expect(JSON.stringify(blank).includes("folder")).toBe(false);
  });

  it("keeps real calendar dates and loads an impossible visit or trip date as undated", () => {
    expect(VisitSchema.parse({ ...baseVisit(), date: "2024-02-29" }).date).toBe("2024-02-29");
    expect(VisitSchema.parse({ ...baseVisit(), date: "2024-13-45" }).date).toBeNull();
    expect(VisitSchema.parse({ ...baseVisit(), date: "2023-02-29" }).date).toBeNull();
    const trip = {
      tripId: "t",
      from: { kind: "country", id: "FR", name: "France", countryId: "FR" },
      to: { kind: "country", id: "JP", name: "Japan", countryId: "JP" },
      mode: "flight",
      carrier: null,
      note: null,
      addedAt: new Date().toISOString(),
    };
    for (const d of ["2024", "2024-03", "2024-03-31"]) expect(TripSchema.parse({ ...trip, date: d }).date).toBe(d);
    for (const d of ["2024-13", "2024-00", "2024-04-31"]) expect(TripSchema.parse({ ...trip, date: d }).date).toBeNull();
    // A file the app wrote before dates were checked (a CSV import let 2024-13-45
    // through) still loads whole.
    const r = PostcardsFileSchema.safeParse({
      format: "postcards",
      schemaVersion: 12,
      exportedAt: new Date().toISOString(),
      visits: [{ ...baseVisit(), date: "2024-13-45" }, { ...baseVisit(), date: "2024-01-02" }],
      trips: [{ ...trip, date: "2024-02-30" }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.visits.map((v) => v.date)).toEqual([null, "2024-01-02"]);
  });

  it("rejects a story dated on a day that does not exist", () => {
    const story = {
      storyId: "s",
      place: { kind: "country", id: "FR", name: "France", countryId: "FR" },
      title: "t",
      text: "",
      addedAt: new Date().toISOString(),
    };
    expect(StorySchema.safeParse({ ...story, date: "2024-02-29" }).success).toBe(true);
    expect(StorySchema.safeParse({ ...story, date: "2024-13-45" }).success).toBe(false);
    expect(StorySchema.safeParse({ ...story, date: "2024-02-30" }).success).toBe(false);
  });

  it("can generate a JSON Schema for external tools (interoperability)", () => {
    // Zod 4 ships a native JSON-Schema exporter. Our schema has sanitizing
    // transforms, so describe the *input* shape and allow unrepresentable nodes.
    const json = z.toJSONSchema(PostcardsFileSchema, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    expect(json).toHaveProperty("type", "object");
    expect(JSON.stringify(json)).toContain("postcards"); // the "format" marker literal
  });
});

import { describe, it, expect } from "vitest";
import { StorySchema } from "../../src/lib/schema/models";

// Spec 020: a postcard's `place` is OPTIONAL; `extraPlaces`, `endDate`, `tags`,
// `tripId` are additive & optional; the content rule (title/text/photo) is unchanged.

const base = {
  storyId: "abc",
  date: "2024-05-01",
  text: "a lovely day",
  addedAt: "2024-05-01T00:00:00.000Z",
};

const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("StorySchema — place optional + additive fields (v13)", () => {
  it("accepts a place-less postcard and never injects a place key", () => {
    const s = StorySchema.parse(base);
    expect("place" in s).toBe(false);
    expect(s.text).toBe("a lovely day");
  });

  it("still requires content (title OR text OR a photo), independent of place", () => {
    expect(() => StorySchema.parse({ ...base, text: "" })).toThrow();
    // photo-only, place-less is fine
    expect(() =>
      StorySchema.parse({ storyId: "x", date: "2024-05-01", addedAt: base.addedAt, photos: [{ src: dataUrl, caption: null }] }),
    ).not.toThrow();
  });

  it("round-trips multiple places, a range, tags and a trip link", () => {
    const place = { kind: "city", id: "paris", name: "Paris", countryId: "FR" };
    const extra = { kind: "city", id: "reims", name: "Reims", countryId: "FR" };
    const s = StorySchema.parse({
      ...base,
      place,
      extraPlaces: [extra],
      endDate: "2024-05-05",
      tags: ["☀️ sunny", "with Léa"],
      tripId: "trip-1",
    });
    expect(s.place?.id).toBe("paris");
    expect(s.extraPlaces?.map((p) => p.id)).toEqual(["reims"]);
    expect(s.endDate).toBe("2024-05-05");
    expect(s.tags).toEqual(["☀️ sunny", "with Léa"]);
    expect(s.tripId).toBe("trip-1");
  });

  it("does not inject the new optional keys when they are absent", () => {
    const s = StorySchema.parse({ ...base, place: { kind: "city", id: "p", name: "P", countryId: "FR" } });
    expect("extraPlaces" in s).toBe(false);
    expect("endDate" in s).toBe(false);
    expect("tags" in s).toBe(false);
    expect("tripId" in s).toBe(false);
  });

  it("rejects an empty/whitespace tag", () => {
    expect(() => StorySchema.parse({ ...base, tags: ["  "] })).toThrow();
  });
});

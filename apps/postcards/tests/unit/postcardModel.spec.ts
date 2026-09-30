import { describe, it, expect } from "vitest";
import { placesOf, primaryPlace, isUnplaced, dateSpan } from "../../src/features/journal/postcardModel";
import type { PlaceRef, Story } from "../../src/lib/schema/models";

const P = (id: string, name: string): PlaceRef => ({ kind: "city", id, name, countryId: "FR" });
const story = (over: Partial<Story>): Story =>
  ({ storyId: "s", date: "2024-05-01", title: "", text: "hi", addedAt: "2024-05-01T00:00:00Z", ...over }) as Story;

describe("postcardModel helpers", () => {
  it("placesOf returns [] for a place-less postcard", () => {
    expect(placesOf(story({}))).toEqual([]);
    expect(isUnplaced(story({}))).toBe(true);
    expect(primaryPlace(story({}))).toBeNull();
  });

  it("placesOf lists the primary then extras, in order", () => {
    const s = story({ place: P("paris", "Paris"), extraPlaces: [P("reims", "Reims"), P("lyon", "Lyon")] });
    expect(placesOf(s).map((p) => p.id)).toEqual(["paris", "reims", "lyon"]);
    expect(primaryPlace(s)?.id).toBe("paris");
    expect(isUnplaced(s)).toBe(false);
  });

  it("primaryPlace falls back to the first extra when there's no primary", () => {
    const s = story({ extraPlaces: [P("reims", "Reims")] });
    expect(primaryPlace(s)?.id).toBe("reims");
    expect(isUnplaced(s)).toBe(false);
  });

  it("dateSpan is single-day unless a strictly-later end date is set", () => {
    expect(dateSpan(story({ date: "2024-05-01" }))).toEqual({ start: "2024-05-01", end: null });
    expect(dateSpan(story({ date: "2024-05-01", endDate: "2024-05-01" }))).toEqual({ start: "2024-05-01", end: null });
    expect(dateSpan(story({ date: "2024-05-01", endDate: "2024-04-30" }))).toEqual({ start: "2024-05-01", end: null });
    expect(dateSpan(story({ date: "2024-05-01", endDate: "2024-05-07" }))).toEqual({
      start: "2024-05-01",
      end: "2024-05-07",
    });
  });
});

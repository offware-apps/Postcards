import { describe, it, expect } from "vitest";
import {
  distinctFolders,
  folderSuggestions,
  matchesFolder,
} from "../../src/features/journal/folders";
import type { PlaceRef, Story, Trip } from "../../src/lib/schema/models";

function place(id: string, name: string, countryId: string): PlaceRef {
  return { kind: "city", id, name, countryId };
}

function trip(name: string, from: PlaceRef, to: PlaceRef, date: string | null): Trip {
  return {
    tripId: `t:${name}`,
    name,
    from,
    to,
    mode: "flight",
    date,
    carrier: null,
    note: null,
    addedAt: "2024-01-01T00:00:00.000Z",
  };
}

function story(folder?: string): Pick<Story, "folder"> {
  return folder === undefined ? {} : { folder };
}

const kyoto = place("kyoto-jp", "Kyoto", "JP");
const tokyo = place("tokyo-jp", "Tokyo", "JP");
const santiago = place("santiago-cl", "Santiago", "CL");
const mendoza = place("mendoza-ar", "Mendoza", "AR");

describe("distinctFolders", () => {
  it("returns the distinct, non-empty folders sorted", () => {
    const stories = [story("Weekend trips"), story("Japan 2024"), story(), story("Japan 2024")];
    expect(distinctFolders(stories)).toEqual(["Japan 2024", "Weekend trips"]);
  });
});

describe("matchesFolder (feed 'By folder' filter)", () => {
  it("keeps only the stories in a named folder; folder-less stories never match", () => {
    expect(matchesFolder({ folder: "A" }, "A")).toBe(true);
    expect(matchesFolder({ folder: "B" }, "A")).toBe(false);
    expect(matchesFolder({}, "A")).toBe(false);
  });
});

describe("folderSuggestions (proposed folders at creation)", () => {
  it("offers existing folders first, then place/country, deduped case-insensitively", () => {
    const stories = [story("Japan 2024"), story("Weekend trips"), story()];
    const trips = [
      trip("japan 2024", kyoto, tokyo, "2024-05-01"), // case-dup of an existing folder + place match → deduped
      trip("Andes", santiago, mendoza, "2019-01-01"), // unrelated country + year → excluded
    ];
    const out = folderSuggestions(stories, {
      place: kyoto,
      countryName: "Japan",
      date: "2024-05-10",
      trips,
    });

    expect(out).toContain("Japan 2024");
    expect(out).toContain("Weekend trips");
    expect(out).toContain("Kyoto"); // the place's own name
    expect(out).toContain("Japan"); // the country name
    expect(out).not.toContain("Andes"); // trip not in this story's context

    // Case-insensitive dedupe keeps a single spelling of "Japan 2024".
    expect(out.filter((f) => f.toLowerCase() === "japan 2024")).toHaveLength(1);
    // Existing folders precede the contextual proposals.
    expect(out.indexOf("Japan 2024")).toBeLessThan(out.indexOf("Kyoto"));
  });

  it("proposes a trip name that matches the story's place/country", () => {
    const out = folderSuggestions([], {
      place: kyoto,
      trips: [trip("JP & KR hop", tokyo, place("seoul-kr", "Seoul", "KR"), null)],
    });
    // The trip touches Japan (Tokyo) → same country as the story's place.
    expect(out).toContain("JP & KR hop");
  });

  it("proposes a multi-stop trip whose middle stop is the story's country", () => {
    const paris = place("paris-fr", "Paris", "FR");
    const seoul = place("seoul-kr", "Seoul", "KR");
    const hop = { ...trip("Round the world", paris, seoul, null), stops: [paris, tokyo, seoul] };
    expect(folderSuggestions([], { place: kyoto, trips: [hop] })).toContain("Round the world");
  });

  it("proposes a trip name from the same year even without a place match", () => {
    const out = folderSuggestions([], {
      date: "2024-07-01",
      trips: [trip("Spring break", santiago, mendoza, "2024-03-01")],
    });
    expect(out).toContain("Spring break");
  });

  it("returns nothing to propose from an empty journal and no context", () => {
    expect(folderSuggestions([], {})).toEqual([]);
  });
});

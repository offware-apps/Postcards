import { describe, it, expect } from "vitest";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import { toMarkdown } from "../../src/features/backup/exportMarkdown";
import type { PlaceRef, Trip, Visit } from "../../src/lib/schema/models";

const ref = getReferenceData();

function visit(name: string, note: string | null): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "city", id: "x", name, countryId: "FR" },
    date: null,
    note,
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  };
}

describe("toMarkdown", () => {
  it("renders a title and a table", () => {
    const md = toMarkdown([visit("Paris", null)], [], ref);
    expect(md).toContain("# Places I've been");
    expect(md).toContain("| Place | Type | Country | Date |");
    expect(md).toContain("Paris");
  });

  it("escapes pipes so free text cannot break the table", () => {
    const md = toMarkdown([visit("A|B", "note|with|pipes")], [], ref);
    expect(md).toContain("A\\|B");
    expect(md).not.toMatch(/\| A\|B \|/); // raw unescaped pipe must not appear
  });

  it("neutralizes inline HTML in names so a shared summary stays inert", () => {
    const md = toMarkdown([visit("<img src=x onerror=alert(1)>", null)], [], ref);
    expect(md).not.toContain("<img"); // raw HTML must not survive to the shared file
    expect(md).toContain("&lt;img");
  });

  it("lists a multi-stop trip's intermediate stops, every leg's mode and a vague date", () => {
    const P = (id: string, cc: string): PlaceRef => ({ kind: "country", id, name: id, countryId: cc });
    const hop: Trip = {
      tripId: "t",
      from: P("France", "FR"),
      to: P("Japan", "JP"),
      stops: [P("France", "FR"), P("Korea", "KR"), P("China", "CN"), P("Japan", "JP")],
      mode: "flight",
      legModes: ["flight", "train", "flight"],
      date: "2024-03",
      carrier: null,
      note: null,
      addedAt: "2024-03-01T00:00:00.000Z",
    };
    const row = toMarkdown([], [hop], ref).split("\n").find((l) => l.startsWith("| France"));
    expect(row).toContain("| France | Japan (via Korea, China) | Flight, Train | Mar 2024 |");
  });
});


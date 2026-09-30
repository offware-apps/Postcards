import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PlacesScreen } from "../../src/features/visits/PlacesScreen";
import { useVisits } from "../../src/lib/store/useVisits";
import { useFilters, DEFAULT_FILTERS } from "../../src/lib/store/useFilters";
import { initReferenceDataSync } from "../../src/lib/reference/referenceData";
import type { Visit } from "../../src/lib/schema/models";
import type { Airport, City, HeritageSite, Subdivision } from "../../src/lib/reference/types";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(here, "..", "..", "public", "reference", name), "utf8"));
const heritage = read("heritage.json") as HeritageSite[];
initReferenceDataSync(
  read("cities-all.json") as City[],
  read("subdivisions.json") as Subdivision[],
  read("airports.json") as Airport[],
  heritage,
);

const site = (category: string) => heritage.find((h) => h.category === category)!;
const visitOf = (h: HeritageSite): Visit => ({
  visitId: `v-${h.id}`,
  place: { kind: "heritage", id: h.id, name: h.name, countryId: h.countryIso2 },
  date: null,
  note: null,
  status: "visited",
  favorite: false,
  addedAt: new Date().toISOString(),
});

beforeEach(() => {
  localStorage.clear();
  useFilters.setState({ ...DEFAULT_FILTERS });
});
afterEach(() => {
  cleanup();
  useVisits.setState({ visits: [] });
});

describe("PlacesScreen monument category", () => {
  it("narrows your list as soon as it changes, with a chip to clear it", () => {
    const cultural = site("cultural");
    const natural = site("natural");
    useVisits.setState({ visits: [visitOf(cultural), visitOf(natural)] });
    render(<PlacesScreen />);
    expect(document.body.textContent).toContain(cultural.name);
    act(() => useFilters.getState().set({ category: "natural" }));
    expect(document.body.textContent).not.toContain(cultural.name);
    expect(document.body.textContent).toContain(natural.name);
    act(() => screen.getByRole("button", { name: "Remove Natural filter" }).click());
    expect(useFilters.getState().category).toBe("");
    expect(document.body.textContent).toContain(cultural.name);
  });
});

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, act, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StatsView } from "../../src/features/stats/StatsView";
import { StatStrip } from "../../src/features/stats/StatStrip";
import { PlacesScreen } from "../../src/features/visits/PlacesScreen";
import { useVisits } from "../../src/lib/store/useVisits";
import { useFilters, DEFAULT_FILTERS } from "../../src/lib/store/useFilters";
import { useUi } from "../../src/lib/store/useUi";
import { initReferenceDataSync, getReferenceData } from "../../src/lib/reference/referenceData";
import type { PlaceRef, Visit } from "../../src/lib/schema/models";
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
const ref = getReferenceData();

const mk = (place: PlaceRef): Visit => ({
  visitId: `v-${place.kind}-${place.id}`,
  place,
  date: null,
  note: null,
  status: "visited",
  favorite: false,
  addedAt: new Date().toISOString(),
});
const paris = ref.searchCities("Paris")[0]!;
const site = heritage.find((h) => h.countryIso2 === "FR")!;
const visits = [
  mk({ kind: "city", id: paris.id, name: paris.name, countryId: "FR" }),
  mk({ kind: "heritage", id: site.id, name: site.name, countryId: "FR" }),
  mk({ kind: "airport", id: "CDG", name: "Charles de Gaulle (CDG)", countryId: "FR" }),
  mk({ kind: "country", id: "IT", name: "Italy", countryId: "IT" }),
];

beforeEach(() => {
  localStorage.clear();
  useFilters.setState({ ...DEFAULT_FILTERS });
  useUi.setState({ placesViewRequest: null });
  useVisits.setState({ visits });
});
afterEach(() => cleanup());

function listLength(): number {
  const lists = document.querySelectorAll("ul.city-list");
  return [...lists].reduce((n, ul) => n + ul.querySelectorAll(":scope > li").length, 0);
}

describe("stats tiles drill into the places they count", () => {
  it.each([
    ["cities", 1],
    ["big cities", 1],
    ["megacities", 1],
    ["monuments", 1],
  ])("the %s tile opens a list of %i", (label, n) => {
    const stats = render(<StatsView />);
    const tile = within(stats.container.querySelector(".kpi-row") as HTMLElement)
      .getAllByRole("button")
      .find((b) => b.querySelector(".kpi-label")?.textContent === label)!;
    expect(tile.querySelector(".kpi-num")?.textContent).toBe(String(n));
    act(() => tile.click());
    stats.unmount();
    render(<PlacesScreen />);
    expect(listLength()).toBe(n);
  });

  it("the strip's been counter opens a list of the cities it counts", () => {
    const strip = render(<StatStrip />);
    const been = screen.getByRole("button", { name: "Open your been" });
    expect(been.querySelector(".ss-num")?.textContent).toBe("1");
    act(() => been.click());
    strip.unmount();
    render(<PlacesScreen />);
    expect(listLength()).toBe(1);
  });
});

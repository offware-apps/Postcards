import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { StatsView } from "../../src/features/stats/StatsView";
import { useVisits } from "../../src/lib/store/useVisits";
import { useUi } from "../../src/lib/store/useUi";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import type { Visit } from "../../src/lib/schema/models";
import type { City } from "../../src/lib/reference/types";

const ref = getReferenceData();
const visitOf = (c: City): Visit => ({
  visitId: `v-${c.id}`,
  place: { kind: "city", id: c.id, name: c.name, countryId: c.countryIso2 },
  date: null,
  note: null,
  status: "visited",
  favorite: false,
  addedAt: new Date().toISOString(),
});

// Two cities of one country sharing a name, the second listed further north.
function namesake(): [City, City] {
  for (const country of ref.countries) {
    const seen = new Map<string, City>();
    for (const c of ref.citiesOf(country.iso2)) {
      const first = seen.get(c.name);
      if (first && c.lat > first.lat + 1) return [first, c];
      if (!first) seen.set(c.name, c);
    }
  }
  throw new Error("no namesake pair in the gazetteer");
}

afterEach(() => {
  cleanup();
  useVisits.setState({ visits: [] });
  useUi.setState({ selectedPlace: null });
});

describe("StatsView records", () => {
  it("opens the record's own city when another one shares its name", () => {
    const [, north] = namesake();
    const south = ref.searchCities("Ushuaia")[0]!;
    useVisits.setState({ visits: [visitOf(north), visitOf(south)] });
    render(<StatsView />);
    const record = screen.getByText("Northernmost:").parentElement!;
    act(() => (record.querySelector("button") as HTMLButtonElement).click());
    expect(useUi.getState().selectedPlace?.place.id).toBe(north.id);
  });

  it("lists the southernmost city when it shares the northernmost one's name", () => {
    const [south, north] = namesake();
    useVisits.setState({ visits: [visitOf(north), visitOf(south)] });
    render(<StatsView />);
    expect(screen.queryByText("Southernmost:")).not.toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { formatTripDate } from "../../src/features/travel/tripDate";
import { TripComposer } from "../../src/features/travel/TripComposer";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
import { useStories } from "../../src/lib/store/useStories";
import { useTrips } from "../../src/lib/store/useTrips";
import { useVisits } from "../../src/lib/store/useVisits";
import type { Story } from "../../src/lib/schema/models";

// Calendar labels must not depend on the device's time zone. A date built at UTC
// midnight and formatted in local time reads as the day before west of UTC, so
// every case runs under a zone on each side of UTC (Node applies a TZ change at
// runtime); `TZ=America/New_York npx vitest run` exercises the same from outside.
const ZONES = ["UTC", "America/New_York", "Asia/Tokyo"];

describe.each(ZONES)("calendar labels in %s", (zone) => {
  const saved = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
  });
  afterEach(() => {
    cleanup();
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it("a month-precision trip date shows its own month", () => {
    expect(formatTripDate("2024-08", "en")).toBe("Aug 2024");
    expect(formatTripDate("2024-01", "en")).toBe("Jan 2024");
  });

  it("the trip composer's month options name the month they save", () => {
    useTrips.setState({ trips: [] });
    useVisits.setState({ visits: [] });
    render(<TripComposer tripId={null} onClose={() => {}} />);
    const sel = screen.getByLabelText("Month") as HTMLSelectElement;
    const opts = [...sel.options].slice(1).map((o) => `${o.value}=${o.textContent}`);
    expect(opts[0]).toBe("01=January");
    expect(opts[11]).toBe("12=December");
  });

  it("the Monday-first journal calendar is headed Mon…Sun", () => {
    const story: Story = {
      storyId: "s1",
      place: { kind: "country", id: "FR", name: "France", countryId: "FR" },
      date: "2024-07-01",
      title: "t",
      text: "",
      addedAt: "2024-07-01T00:00:00Z",
    };
    useStories.setState({ loaded: true, stories: [story] });
    useVisits.setState({ visits: [] });
    render(<JournalScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Calendar/ }));
    const heads = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(heads).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

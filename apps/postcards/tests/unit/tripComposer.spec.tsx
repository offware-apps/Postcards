import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TripComposer } from "../../src/features/travel/TripComposer";
import { useTrips } from "../../src/lib/store/useTrips";
import { useVisits } from "../../src/lib/store/useVisits";
import type { PlaceRef, Trip } from "../../src/lib/schema/models";

const P = (id: string, countryId: string): PlaceRef => ({ kind: "country", id, name: id, countryId });

function editTrip(date: string, stopDates?: (string | null)[]) {
  const trip: Trip = {
    tripId: "t1",
    from: P("FR", "FR"),
    to: P("JP", "JP"),
    stops: [P("FR", "FR"), P("KR", "KR"), P("JP", "JP")],
    ...(stopDates ? { stopDates } : {}),
    mode: "flight",
    date,
    carrier: null,
    note: null,
    addedAt: "2024-03-01T00:00:00.000Z",
  };
  const updateTrip = vi.fn(async () => {});
  useTrips.setState({ trips: [trip], updateTrip });
  useVisits.setState({ visits: [] });
  render(<TripComposer tripId="t1" onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Save trip" }));
  return updateTrip;
}

describe("TripComposer editing a dated trip", () => {
  afterEach(cleanup);

  it("keeps the day of a full date left untouched", () => {
    const updateTrip = editTrip("2024-03-15");
    expect(updateTrip).toHaveBeenCalledWith("t1", expect.objectContaining({ date: "2024-03-15" }));
  });

  it("keeps a month-dated trip's month", () => {
    const updateTrip = editTrip("2024-03");
    expect(updateTrip).toHaveBeenCalledWith("t1", expect.objectContaining({ date: "2024-03" }));
  });

  it("keeps each stop's day and dates the trip by its first", () => {
    const updateTrip = editTrip("2024-03-16", [null, "2024-03-16", "2024-03-20"]);
    expect(updateTrip).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ date: "2024-03-16", stopDates: [null, "2024-03-16", "2024-03-20"] }),
    );
  });
});

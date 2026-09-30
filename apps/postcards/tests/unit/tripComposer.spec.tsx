import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TripComposer } from "../../src/features/travel/TripComposer";
import { useTrips } from "../../src/lib/store/useTrips";

const SH = { kind: "city", id: "1796236", name: "Shanghai", countryId: "CN" } as const;
const IS = { kind: "city", id: "745044", name: "Istanbul", countryId: "TR" } as const;
const MO = { kind: "city", id: "524901", name: "Moscow", countryId: "RU" } as const;

beforeEach(() => {
  localStorage.clear();
  useTrips.setState({
    trips: [{ tripId: "t1", from: SH, to: MO, stops: [SH, IS, MO], mode: "flight", date: null, addedAt: "x", updatedAt: "x" }] as never,
  });
});
afterEach(() => {
  cleanup();
  useTrips.setState({ trips: [] });
});

const stopNames = () => [...document.querySelectorAll(".trip-stop-name")].map((n) => n.textContent);

describe("TripComposer stop order", () => {
  it("keeps keyboard focus on the moved stop's button", () => {
    render(<TripComposer tripId="t1" onClose={() => {}} />);
    const down = screen.getByRole("button", { name: "Move Shanghai down" });
    down.focus();
    fireEvent.click(down);
    expect(stopNames()).toEqual(["Istanbul", "Shanghai", "Moscow"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Shanghai down" }));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(stopNames()).toEqual(["Istanbul", "Moscow", "Shanghai"]);
    // Down is disabled at the end, so focus lands on the row's Up.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Shanghai up" }));
  });
});

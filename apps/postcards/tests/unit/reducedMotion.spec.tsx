import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TravelScreen } from "../../src/features/travel/TravelScreen";
import { useTrips } from "../../src/lib/store/useTrips";

// A reader who asked for reduced motion gets jumps, not smooth scrolls, when a
// form opens further down the page.

const PARIS = { kind: "city", id: "2988507", name: "Paris", countryId: "FR" } as const;
const TOKYO = { kind: "city", id: "1850147", name: "Tokyo", countryId: "JP" } as const;
const scrolls: (ScrollIntoViewOptions | boolean | undefined)[] = [];

beforeEach(() => {
  localStorage.clear();
  scrolls.length = 0;
  Element.prototype.scrollIntoView = (arg) => void scrolls.push(arg);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  useTrips.setState({
    trips: [{ tripId: "t1", from: PARIS, to: TOKYO, mode: "flight", date: null, addedAt: "x", updatedAt: "x" }] as never,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("editing a trip scrolls to the form without animation", async () => {
  render(<TravelScreen />);
  fireEvent.click(screen.getByRole("button", { name: /Edit trip/ }));
  await act(() => new Promise((r) => requestAnimationFrame(r)));
  expect(scrolls).toEqual([expect.objectContaining({ behavior: "auto" })]);
});

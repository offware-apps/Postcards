import { it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TravelScreen } from "../../src/features/travel/TravelScreen";
import { PlaceSearch } from "../../src/features/visits/PlaceSearch";
import { useTrips } from "../../src/lib/store/useTrips";

// Escape that closes a suggestion list is spent there: it must not also reach
// the form or the app behind it (a discarded trip form, a step back).

beforeEach(() => useTrips.setState({ trips: [] }));
afterEach(cleanup);

it("Escape in the From list closes the list, not the trip form", () => {
  render(<TravelScreen />);
  fireEvent.click(screen.getByRole("button", { name: /New trip/ }));
  fireEvent.change(screen.getByLabelText("Trip name (optional)"), {
    target: { value: "Japan 2024" },
  });
  const from = screen.getByRole("combobox", { name: "From" });
  fireEvent.change(from, { target: { value: "Shang" } });
  expect(from.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(from, { key: "Escape" });
  expect(from.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByLabelText<HTMLInputElement>("Trip name (optional)").value).toBe("Japan 2024");
});

it("Escape that clears the top-bar search does not also reach the app", () => {
  let reached = 0;
  const onKey = (e: KeyboardEvent) => void (e.key === "Escape" && reached++);
  window.addEventListener("keydown", onKey);
  render(<PlaceSearch />);
  const search = screen.getByRole("combobox");
  fireEvent.change(search, { target: { value: "Shang" } });
  fireEvent.keyDown(search, { key: "Escape" });
  window.removeEventListener("keydown", onKey);
  expect((search as HTMLInputElement).value).toBe("");
  expect(reached).toBe(0);
});

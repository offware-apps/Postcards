import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const download = vi.fn(async () => true);
vi.mock("../../src/lib/reference/referenceData", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/reference/referenceData")>()),
  downloadFullCities: () => download(),
  fullCitiesEnabled: () => false,
}));

import { IntroScreen } from "../../src/ui/IntroScreen";
import { useSettings } from "../../src/lib/store/useSettings";

beforeEach(() => {
  localStorage.clear();
  download.mockClear();
  useSettings.getState().setOnlineMap(false);
  useSettings.getState().setOfflineMode(false);
});
afterEach(cleanup);

const map = () => screen.getByRole("switch", { name: "Detailed map" }) as HTMLInputElement;
const cities = () => screen.getByRole("switch", { name: "Full city list" }) as HTMLInputElement;

it("starts a first run with the detailed map and full city list switched on", () => {
  render(<IntroScreen onClose={() => {}} />);
  expect(map().checked).toBe(true);
  expect(cities().checked).toBe(true);
  // Nothing reaches the network before Start.
  expect(useSettings.getState().onlineMap).toBe(false);
  expect(download).not.toHaveBeenCalled();
});

it("turns both on when Start is tapped", () => {
  const onClose = vi.fn();
  render(<IntroScreen onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(useSettings.getState().onlineMap).toBe(true);
  expect(download).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalled();
});

it("leaves off what was switched off, and Skip applies neither", () => {
  render(<IntroScreen onClose={() => {}} />);
  fireEvent.click(cities());
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(useSettings.getState().onlineMap).toBe(true);
  expect(download).not.toHaveBeenCalled();
  cleanup();

  useSettings.getState().setOnlineMap(false);
  render(<IntroScreen onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(useSettings.getState().onlineMap).toBe(false);
  expect(download).not.toHaveBeenCalled();
});

it("shows the current settings once the welcome has been seen", () => {
  localStorage.setItem("postcards-intro-seen", "1");
  render(<IntroScreen onClose={() => {}} />);
  expect(map().checked).toBe(false);
  expect(cities().checked).toBe(false);
});

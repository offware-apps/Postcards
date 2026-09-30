import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TravelScreen } from "../../src/features/travel/TravelScreen";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
import { PassportScreen } from "../../src/features/passport/PassportScreen";
import { SyncSection } from "../../src/features/settings/SyncSection";
import { SettingsScreen } from "../../src/features/settings/SettingsScreen";
import { IntroScreen } from "../../src/ui/IntroScreen";
import { useSettings } from "../../src/lib/store/useSettings";
import { useTrips } from "../../src/lib/store/useTrips";
import { useStories } from "../../src/lib/store/useStories";
import { writeRemoteConfig } from "../../src/lib/sync/syncConfig";

vi.mock("../../src/features/passport/poster", () => ({
  renderPoster: async () => new Blob(["png"], { type: "image/png" }),
}));
vi.mock("../../src/lib/sync/runSync", () => ({
  runDeviceSync: async () => ({ kind: "blocked", local: 40, removed: 30 }),
}));

// Each control below removes itself when clicked. Focus must land on the
// control that takes its place, never on the page body (WCAG 2.4.3).

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
  URL.createObjectURL = () => "blob:poster";
  URL.revokeObjectURL = () => {};
  useTrips.setState({ trips: [] });
  useStories.setState({ loaded: true, stories: [] });
});
afterEach(cleanup);

function press(name: string | RegExp) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

it("New trip focuses the trip form, and Escape gives focus back", () => {
  render(<TravelScreen />);
  press(/New trip/);
  expect(document.activeElement).toBe(screen.getByLabelText("Trip name (optional)"));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /New trip/ }));
});

it("the boarding pass panel takes focus, and Close gives it back", () => {
  render(<TravelScreen />);
  press(/Add from a boarding pass/);
  expect(document.activeElement).toBe(screen.getByLabelText("Boarding-pass code"));
  press("Close");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Add from a boarding pass/ }));
});

it("closing the world poster gives focus back to its button", async () => {
  render(<PassportScreen />);
  press(/World poster/);
  await screen.findByRole("dialog");
  press("Close");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /World poster/ }));
});

it("Disconnect leaves focus on Sync now", () => {
  writeRemoteConfig({ owner: "someone", repo: "places", branch: "main", token: "t" });
  render(<SyncSection />);
  press("Disconnect");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sync now" }));
});

it("cancelling the offline-map reset gives focus back to its link", () => {
  render(<SettingsScreen />);
  press(/Reset offline maps/);
  press("Cancel");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Reset offline maps/ }));
});

it("skipping the sync guard gives focus back to Sync now", async () => {
  writeRemoteConfig({ owner: "someone", repo: "places", branch: "main", token: "t" });
  render(<SyncSection />);
  press("Sync now");
  await screen.findByRole("dialog");
  press("Skip for now");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sync now" }));
});

it("closing Publish gives focus back to Publish site", async () => {
  const place = { kind: "city", id: "1796236", name: "Shanghai", countryId: "CN" } as const;
  useStories.setState({
    stories: [{ storyId: "s1", place, date: "2024-07-01", title: "Bund walk", text: "t", addedAt: "x", updatedAt: "x" }],
  });
  render(<JournalScreen />);
  press(/Publish site/);
  await screen.findByRole("dialog");
  press("Close publish");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Publish site/ }));
});

it("applying the phone recommendation moves focus to the next row", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
  act(() => {
    useSettings.getState().setReduceMapWork(false);
    useSettings.getState().setOptimizeMarkers(false);
  });
  render(<IntroScreen onClose={() => {}} />);
  press("Use recommended");
  expect(screen.getByRole("group", { name: "Connection" })).toContainElement(
    document.activeElement as HTMLElement,
  );
  vi.unstubAllGlobals();
});

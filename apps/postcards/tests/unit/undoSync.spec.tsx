import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
vi.mock("idb", () => import("./fakeIdb"));
const remote: { content: string | null; version: number } = { content: null, version: 0 };
vi.mock("../../src/lib/publish/gitTarget", () => {
  class GitPushConflictError extends Error {}
  class GitHubTarget {
    name = "github";
    async getFile() {
      return remote.content == null
        ? null
        : { content: remote.content, version: String(remote.version) };
    }
    async putFileConditional(_path: string, content: string) {
      remote.content = content;
      remote.version++;
    }
  }
  return { GitHubTarget, GitPushConflictError };
});
import { clearDatabases } from "./fakeIdb";
import { TravelScreen } from "../../src/features/travel/TravelScreen";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
import { useTrips } from "../../src/lib/store/useTrips";
import { useStories } from "../../src/lib/store/useStories";
import { useVisits } from "../../src/lib/store/useVisits";
import { useToast } from "../../src/lib/store/useToast";
import { runDeviceSync } from "../../src/lib/sync/runSync";

// Every Undo on the Travel and Journal screens must still hold after the next
// device sync, including when the action it undoes was already synced.

(globalThis as { indexedDB?: unknown }).indexedDB = {};
Element.prototype.scrollIntoView = () => {};
const cfg = { owner: "o", repo: "r", branch: "main", token: "t" };
const SH = { kind: "city", id: "1796236", name: "Shanghai", countryId: "CN" } as const;
const MO = { kind: "city", id: "524901", name: "Moscow", countryId: "RU" } as const;

/** Let the store writes a click fired settle, then move the clock on a tick. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 3)));
const sync = async () => {
  await act(async () => {
    expect((await runDeviceSync(cfg)).ok).toBe(true);
  });
  await settle();
};
const undo = async () => {
  await act(async () => {
    await useToast.getState().toast!.undo!();
  });
  await settle();
};

beforeEach(() => {
  clearDatabases();
  localStorage.clear();
  remote.content = null;
  useTrips.setState({ trips: [], loaded: true });
  useStories.setState({ stories: [], loaded: true });
  useVisits.setState({ visits: [], loaded: true });
  useToast.setState({ toast: null });
});
afterEach(cleanup);

describe("Travel undo", () => {
  it("brings a removed trip back for good", async () => {
    await useTrips.getState().addTrip({ from: SH, to: MO });
    await sync();
    render(<TravelScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Remove trip/ }));
    await settle();
    await undo();
    await sync();
    expect(useTrips.getState().trips).toHaveLength(1);
  });

  it("takes back an added trip for good", async () => {
    render(<TravelScreen />);
    fireEvent.click(screen.getByRole("button", { name: /New trip/ }));
    for (const [field, city] of [
      ["From", "Shanghai"],
      ["To", "Moscow"],
    ]) {
      const input = screen.getByRole("combobox", { name: field });
      fireEvent.change(input, { target: { value: city } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    fireEvent.click(screen.getByRole("button", { name: "Add trip" }));
    await settle();
    expect(useTrips.getState().trips).toHaveLength(1);
    await sync();
    await undo();
    await sync();
    expect(useTrips.getState().trips).toHaveLength(0);
  });

  it("takes back an edit for good", async () => {
    await useTrips.getState().addTrip({ from: SH, to: MO, note: "aisle" });
    await sync();
    render(<TravelScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    fireEvent.change(screen.getByDisplayValue("aisle"), { target: { value: "window" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    await sync();
    await undo();
    await sync();
    expect(useTrips.getState().trips[0]!.note).toBe("aisle");
  });
});

describe("Journal undo", () => {
  const story = () =>
    useStories
      .getState()
      .addStory({ place: SH, date: "2024-07-01", title: "Bund walk", text: "t" });

  it("brings a removed story back for good", async () => {
    await story();
    await sync();
    render(<JournalScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove story Bund walk" })[0]!);
    await settle();
    await undo();
    await sync();
    expect(useStories.getState().stories).toHaveLength(1);
  });
});

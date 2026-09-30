import { describe, it, expect, beforeEach } from "vitest";
import {
  useFilters,
  DEFAULT_FILTERS,
  isDefault,
  withFieldCleared,
  statusShows,
  type FilterState,
} from "../../src/lib/store/useFilters";

describe("filter state helpers", () => {
  it("isDefault is true only when every dimension is at its default", () => {
    expect(isDefault(DEFAULT_FILTERS)).toBe(true);
    expect(isDefault({ ...DEFAULT_FILTERS, status: ["visited"] })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, minPop: 100_000 })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, favoritesOnly: true })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, date: { mode: "undated" } })).toBe(false);
    // An empty status array is the default (= show everything).
    expect(isDefault({ ...DEFAULT_FILTERS, status: [] })).toBe(true);
  });

  it("statusShows: empty or all-three means show everything", () => {
    expect(statusShows([], "visited")).toBe(true);
    expect(statusShows(["visited", "wishlist", "unvisited"], "unvisited")).toBe(true);
    expect(statusShows(["visited"], "visited")).toBe(true);
    expect(statusShows(["visited"], "wishlist")).toBe(false);
    expect(statusShows(["visited", "wishlist"], "unvisited")).toBe(false);
  });

  it("withFieldCleared resets exactly one dimension", () => {
    const s: FilterState = { ...DEFAULT_FILTERS, status: ["visited"], minPop: 1_000_000 };
    const cleared = withFieldCleared(s, "minPop");
    expect(cleared.minPop).toBe(0); // reset
    expect(cleared.status).toEqual(["visited"]); // untouched
  });
});

describe("useFilters store", () => {
  beforeEach(() => {
    useFilters.getState().clearAll();
  });

  it("set merges dimensions and clearField / clearAll reset", () => {
    useFilters.getState().set({ status: ["wishlist"], minPop: 100_000 });
    expect(useFilters.getState().status).toEqual(["wishlist"]);
    expect(useFilters.getState().minPop).toBe(100_000);

    useFilters.getState().clearField("minPop");
    expect(useFilters.getState().minPop).toBe(0);
    expect(useFilters.getState().status).toEqual(["wishlist"]); // only minPop reset

    useFilters.getState().clearAll();
    expect(useFilters.getState().status).toEqual([]); // empty = show everything
    expect(useFilters.getState().minPop).toBe(0);
  });

  it("persists preference dimensions to localStorage (status as a comma list)", () => {
    useFilters.getState().set({ status: ["visited", "wishlist"], minPop: 1_000_000, sort: "az" });
    expect(localStorage.getItem("postcards-city-filter")).toBe("visited,wishlist");
    expect(localStorage.getItem("postcards-city-minpop")).toBe("1000000");
    expect(localStorage.getItem("postcards-list-sort")).toBe("az");
  });

  it("persists every PREFERENCE dimension (date/folder/category/continent/growth) across sessions", () => {
    useFilters.getState().set({
      date: { mode: "range", from: "2020-01-01", to: "2020-12-31" },
      folder: "Japan 2019",
      category: "cultural",
      country: "FR",
      continent: "Europe",
      favoritesOnly: true,
      hasPhoto: true,
      hasNote: true,
    });
    const blob = JSON.parse(localStorage.getItem("postcards-filter-extra") ?? "{}");
    expect(blob.date).toEqual({ mode: "range", from: "2020-01-01", to: "2020-12-31" });
    expect(blob.folder).toBe("Japan 2019");
    expect(blob.category).toBe("cultural");
    expect(blob.continent).toBe("Europe");
    expect(blob.favoritesOnly).toBe(true);
    expect(blob.hasPhoto).toBe(true);
    expect(blob.hasNote).toBe(true);
    // country is a transient DRILL-DOWN, never persisted — so the app can't reopen
    // stuck filtered to one country (it stays in the in-memory store for the session).
    expect("country" in blob).toBe(false);
    expect(useFilters.getState().country).toBe("FR"); // still active this session

    useFilters.getState().clearAll();
    const cleared = JSON.parse(localStorage.getItem("postcards-filter-extra") ?? "{}");
    expect(cleared.folder).toBe("");
    expect(cleared.favoritesOnly).toBe(false);
    expect(cleared.date).toEqual({ mode: "all" });
    expect(useFilters.getState().country).toBe(""); // clearAll still resets it in-memory
  });
});

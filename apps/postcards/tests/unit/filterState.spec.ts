import { describe, it, expect, beforeEach } from "vitest";
import { useFilters, statusShows } from "../../src/lib/store/useFilters";

describe("filter state helpers", () => {
  it("statusShows: empty or all-three means show everything", () => {
    expect(statusShows([], "visited")).toBe(true);
    expect(statusShows(["visited", "wishlist", "unvisited"], "unvisited")).toBe(true);
    expect(statusShows(["visited"], "visited")).toBe(true);
    expect(statusShows(["visited"], "wishlist")).toBe(false);
    expect(statusShows(["visited", "wishlist"], "unvisited")).toBe(false);
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

  it("persists EVERY value dimension (date/folder/category/country/continent/growth) across sessions", () => {
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
    expect(blob.country).toBe("FR");
    expect(blob.continent).toBe("Europe");
    expect(blob.favoritesOnly).toBe(true);
    expect(blob.hasPhoto).toBe(true);
    expect(blob.hasNote).toBe(true);
    // clearAll wipes the persisted blob back to defaults.
    useFilters.getState().clearAll();
    const cleared = JSON.parse(localStorage.getItem("postcards-filter-extra") ?? "{}");
    expect(cleared.country).toBe("");
    expect(cleared.folder).toBe("");
    expect(cleared.favoritesOnly).toBe(false);
    expect(cleared.date).toEqual({ mode: "all" });
  });
});

import { describe, it, expect } from "vitest";
import { buildJourney, type JourneyInput } from "../../src/lib/publish/bundle";
import type { PlaceRef, Story, Trip, Visit } from "../../src/lib/schema/models";

const NOW = "2026-07-15T00:00:00.000Z";
const city = (id: string, name: string, cc: string, lat: number, lon: number): PlaceRef => ({
  kind: "city",
  id,
  name,
  countryId: cc,
  lat,
  lon,
});

const paris = city("par", "Paris", "FR", 48.85, 2.35);
const rome = city("rom", "Rome", "IT", 41.9, 12.5);
const cairo = city("cai", "Cairo", "EG", 30.04, 31.24);

const trip = (id: string, from: PlaceRef, to: PlaceRef, mode: Trip["mode"], date: string): Trip => ({
  tripId: id,
  from,
  to,
  mode,
  date,
  carrier: null,
  note: null,
  addedAt: NOW,
});

const resolveCoords: JourneyInput["resolveCoords"] = (p) =>
  typeof p.lat === "number" && typeof p.lon === "number" ? { lat: p.lat, lon: p.lon } : null;

describe("buildJourney (trips-driven)", () => {
  it("stitches connected legs into an ordered route with transport", () => {
    const trips = [
      trip("t1", paris, rome, "flight", "2026-05-02"),
      trip("t2", rome, cairo, "ferry", "2026-05-06"),
    ];
    const j = buildJourney({ visits: [], trips, stories: [], resolveCoords }, { title: "Trip" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome", "Cairo"]);
    expect(j.steps.map((s) => s.arriveBy)).toEqual([null, "flight", "ferry"]);
    expect(j.totals.countries).toBe(3);
    expect(j.totals.places).toBe(3);
    expect(j.totals.distanceKm).toBeGreaterThan(2000);
    expect(j.dateRange).toEqual({ start: "2026-05-02", end: "2026-05-06" });
  });

  it("orders by date regardless of array order", () => {
    const trips = [
      trip("t2", rome, cairo, "ferry", "2026-05-06"),
      trip("t1", paris, rome, "flight", "2026-05-02"),
    ];
    const j = buildJourney({ visits: [], trips, stories: [], resolveCoords }, { title: "Trip" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome", "Cairo"]);
  });

  it("attaches the earliest story and its photos to a step", () => {
    const stories: Story[] = [
      {
        storyId: "s1",
        place: rome,
        date: "2026-05-04",
        title: "Roman holiday",
        text: "Gelato and ruins.",
        photos: [{ src: "data:image/png;base64,AAAA", caption: "Colosseum" }],
        addedAt: NOW,
      },
    ];
    const trips = [trip("t1", paris, rome, "flight", "2026-05-02")];
    const j = buildJourney({ visits: [], trips, stories, resolveCoords }, { title: "Trip" });
    const romeStep = j.steps.find((s) => s.place.name === "Rome")!;
    expect(romeStep.story?.title).toBe("Roman holiday");
    expect(romeStep.photos).toHaveLength(1);
  });

  it("falls back to stories in date order when there are no trips", () => {
    const stories: Story[] = [
      { storyId: "s2", place: cairo, date: "2026-06-01", title: "Cairo", text: "", addedAt: NOW },
      { storyId: "s1", place: paris, date: "2026-05-01", title: "Paris", text: "", addedAt: NOW },
    ];
    const j = buildJourney({ visits: [], trips: [], stories, resolveCoords }, { title: "Stories" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Cairo"]);
  });

  it("falls back to VISITED places when there are no trips and no stories", () => {
    // A user who only marks places visited (never logs a trip or writes a story)
    // must still get a non-empty map — otherwise Publish shows nothing.
    const visit = (place: PlaceRef, date: string | null, status: Visit["status"]): Visit => ({
      visitId: "v-" + place.id,
      place,
      status,
      favorite: false,
      date,
      note: null,
      photos: [],
      addedAt: NOW,
      updatedAt: NOW,
    });
    const visits = [
      visit(cairo, "2026-06-01", "visited"),
      visit(paris, "2026-05-01", "visited"),
      visit(rome, null, "wishlist"), // a place you WANT to go — excluded
    ];
    const j = buildJourney({ visits, trips: [], stories: [], resolveCoords }, { title: "Been" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Cairo"]);
    expect(j.steps.some((s) => s.place.name === "Rome")).toBe(false);
  });

  it("prefers stories over the visited-places fallback when both exist", () => {
    const stories: Story[] = [
      { storyId: "s1", place: paris, date: "2026-05-01", title: "Paris", text: "", addedAt: NOW },
    ];
    const visits: Visit[] = [
      {
        visitId: "v1",
        place: cairo,
        status: "visited",
        favorite: false,
        date: "2026-06-01",
        note: null,
        photos: [],
        addedAt: NOW,
        updatedAt: NOW,
      },
    ];
    const j = buildJourney({ visits, trips: [], stories, resolveCoords }, { title: "Mix" });
    // Stories win — the visited-only fallback never runs, so Cairo is not added.
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris"]);
  });

  it("honors a tripIds selection and a date range", () => {
    const trips = [
      trip("t1", paris, rome, "flight", "2026-05-02"),
      trip("t2", rome, cairo, "ferry", "2026-06-06"),
    ];
    const only = buildJourney({ visits: [], trips, stories: [], resolveCoords }, {
      title: "Just one",
      tripIds: ["t1"],
    });
    expect(only.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome"]);

    const may = buildJourney({ visits: [], trips, stories: [], resolveCoords }, {
      title: "May only",
      dateTo: "2026-05-31",
    });
    expect(may.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome"]);
  });

  it("skips places whose coordinates can't be resolved (map-led reader)", () => {
    const ghost = { kind: "city", id: "ghost", name: "Nowhere", countryId: "ZZ" } as PlaceRef;
    const trips = [trip("t1", paris, ghost, "flight", "2026-05-02")];
    const j = buildJourney({ visits: [], trips, stories: [], resolveCoords }, { title: "Trip" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris"]);
  });
});

// A multi-stop trip dates each stop (stopDates); a date range keeps the stops that
// fall inside it, so a trip counts by where you were on those days, not by its start.
describe("buildJourney (per-stop dates)", () => {
  const journey: Trip = {
    ...trip("j1", paris, cairo, "flight", "2026-05-02"),
    stops: [paris, rome, cairo],
    legModes: ["flight", "ferry"],
    stopDates: ["2026-05-02", "2026-05-10", "2026-05-20"],
  };
  const build = (sel: { dateFrom?: string; dateTo?: string }, t: Trip = journey) =>
    buildJourney({ visits: [], trips: [t], stories: [], resolveCoords }, { title: "Trip", ...sel });

  it("dates each stop of the journey by its own day", () => {
    const j = build({});
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome", "Cairo"]);
    expect(j.steps.map((s) => s.arriveBy)).toEqual([null, "flight", "ferry"]);
    expect(j.steps.map((s) => s.date)).toEqual(["2026-05-02", "2026-05-10", "2026-05-20"]);
  });

  it("includes a trip whose later stops fall in the range, from the first stop inside it", () => {
    const j = build({ dateFrom: "2026-05-08", dateTo: "2026-05-31" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Rome", "Cairo"]);
    expect(j.steps.map((s) => s.arriveBy)).toEqual([null, "ferry"]);
    expect(j.dateRange).toEqual({ start: "2026-05-10", end: "2026-05-20" });
  });

  it("leaves out the stops of a trip that fall after the range", () => {
    const j = build({ dateTo: "2026-05-12" });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome"]);
    expect(j.dateRange).toEqual({ start: "2026-05-02", end: "2026-05-10" });
  });

  it("dates an undated stop by the stop before it", () => {
    const j = build({ dateTo: "2026-05-12" }, { ...journey, stopDates: ["2026-05-02", null, "2026-05-20"] });
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome"]);
    expect(j.steps.map((s) => s.date)).toEqual(["2026-05-02", "2026-05-02"]);
  });
});

// The PublishScreen "By trip" (folder) scope resolves a trip NAME to the set of
// tripIds sharing it, then feeds those to buildJourney. This verifies that path.
describe("buildJourney (by trip name / folder selection)", () => {
  it("gathers every leg that shares a trip name into one ordered journey", () => {
    const trips: Trip[] = [
      { ...trip("t1", paris, rome, "flight", "2026-05-02"), name: "Japan 2024" },
      { ...trip("t2", rome, cairo, "ferry", "2026-05-06"), name: "Summer road trip" },
      { ...trip("t3", cairo, paris, "flight", "2026-05-10"), name: "Japan 2024" },
    ];
    const folder = "Japan 2024";
    // Same resolution the screen performs: name -> the legs that carry it.
    const tripIds = trips.filter((t) => (t.name ?? "") === folder).map((t) => t.tripId);
    expect(tripIds).toEqual(["t1", "t3"]);

    const j = buildJourney(
      { visits: [], trips, stories: [], resolveCoords },
      { title: folder, tripIds },
    );
    // Only the two "Japan 2024" legs contribute — the "Summer road trip" leg is excluded.
    expect(j.steps.map((s) => s.place.name)).toEqual(["Paris", "Rome", "Cairo", "Paris"]);
    expect(j.title).toBe("Japan 2024");
  });
});

// A visit's photos also flow into its place's step even without a story.
describe("buildJourney (visit photos)", () => {
  it("pulls visit photos onto the matching step", () => {
    const visits: Visit[] = [
      {
        visitId: "v1",
        place: rome,
        status: "visited",
        favorite: false,
        photos: [{ src: "data:image/png;base64,BBBB", caption: null }],
        addedAt: NOW,
      } as Visit,
    ];
    const trips = [trip("t1", paris, rome, "flight", "2026-05-02")];
    const j = buildJourney({ visits, trips, stories: [], resolveCoords }, { title: "Trip" });
    expect(j.steps.find((s) => s.place.name === "Rome")!.photos).toHaveLength(1);
  });

  it("keeps a month- or year-dated trip in a range covering it", () => {
    const year = trip("t1", paris, rome, "flight", "2026");
    const march = trip("t2", rome, cairo, "ferry", "2026-03");
    const sel = (dateFrom: string, dateTo: string) =>
      buildJourney({ visits: [], trips: [year, march], stories: [], resolveCoords }, { title: "T", dateFrom, dateTo })
        .steps.map((s) => s.place.name);
    expect(sel("2026-03-01", "2026-03-31")).toEqual(["Rome", "Cairo"]);
    expect(sel("2026-01-01", "2026-12-31")).toEqual(["Paris", "Rome", "Cairo"]);
    expect(sel("2026-03-10", "2026-03-31")).toEqual([]); // the range covers part of March only
  });

  it("publishes every stop of a multi-stop trip with each leg's mode", () => {
    const athens = city("ath", "Athens", "GR", 37.98, 23.73);
    const hop: Trip = {
      ...trip("t1", paris, cairo, "flight", "2026-05-02"),
      stops: [paris, rome, athens, cairo],
      legModes: ["flight", "train", "ferry"],
    };
    const j = buildJourney({ visits: [], trips: [hop], stories: [], resolveCoords }, { title: "T" });
    expect(j.steps.map((s) => `${s.place.name}/${s.arriveBy}`)).toEqual([
      "Paris/null",
      "Rome/flight",
      "Athens/train",
      "Cairo/ferry",
    ]);
  });

  it("leaves out photos of stories and visits outside the date range", () => {
    const old: Story = {
      storyId: "s-old",
      place: rome,
      date: "2019-05-05",
      title: "Years ago",
      text: "",
      photos: [{ src: "data:image/png;base64,OLD1", caption: "2019 private" }],
      addedAt: NOW,
    };
    const visit: Visit = {
      visitId: "v-old",
      place: rome,
      status: "visited",
      favorite: false,
      photos: [{ src: "data:image/png;base64,OLD2", caption: "visit 2019" }],
      date: "2019-05-05",
      note: null,
      addedAt: NOW,
    };
    const trips = [trip("t1", paris, rome, "flight", "2026-05-02")];
    const input = { visits: [visit], trips, stories: [old], resolveCoords };
    const captions = (sel: { dateFrom?: string; dateTo?: string }) =>
      buildJourney(input, { title: "T", ...sel }).steps.flatMap((s) => s.photos.map((p) => p.caption));
    expect(captions({ dateFrom: "2026-05-01", dateTo: "2026-05-31" })).toEqual([]);
    // With no range the place's whole gallery still publishes.
    expect(captions({})).toEqual(["visit 2019", "2019 private"]);
  });
});


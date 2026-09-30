import { useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useGazetteerGeneration } from "../../lib/reference/useGazetteer";
import { useVisits } from "../../lib/store/useVisits";
import { useTrips } from "../../lib/store/useTrips";
import { useToast } from "../../lib/store/useToast";
import { useUi } from "../../lib/store/useUi";
import { useSettings, type ThemeMode } from "../../lib/store/useSettings";
import { usePrefersReducedMotion } from "../../lib/hooks/usePrefersReducedMotion";
import { useOnlineStatus } from "../../lib/hooks/useOnlineStatus";
import { countryFlag, formatInt } from "../../lib/format/format";
import { heritageGlyph } from "../../lib/reference/heritageGlyph";
import { StateToggles } from "../visits/StateToggles";
import { AddPlaceForm } from "../visits/AddPlaceForm";
import { GuideButton } from "../guides/GuideButton";
import { StatStrip } from "../stats/StatStrip";
import { MapView, hasSavedCamera, type Basemap, type MapFocus, type MapFit } from "./MapView";
import { tripArcs } from "./visitedLayers";
import { fitBounds } from "./mapFit";
import { dateBuckets, mapDateMatches, rangeExactYear, type MapDate } from "../travel/period";
import { citiesInView, IN_VIEW_CAP, type Bounds } from "./viewport";
import { bundledMapSource } from "../../lib/map-source/bundledMapSource";
import type { City } from "../../lib/reference/types";
import type { PlaceRef } from "../../lib/schema/models";
import { placeKey } from "../../lib/schema/helpers";
import { CityLine } from "../../ui/CityLine";
import { MoreButton } from "../../ui/MoreButton";
import {
  useFilters,
  currentFilters,
  statusShows,
  type FilterState,
  type FilterMode,
} from "../../lib/store/useFilters";
import { activeChips } from "../filter/applyFilters";
import { FilterPanel } from "../../ui/FilterPanel";
import { FilterSummary } from "../../ui/FilterSummary";
import { useT, type MessageKey } from "../../lib/i18n";

// Fewer rows, faster everything: the list pages in small steps, and the
// in-view working set is capped (population-presorted, so it's always the
// most relevant cities) — reactions to a toggle stay instant even at world
// zoom instead of recounting 135k rows.
const PAGE = 30;
const POI_LIST_CAP = 50;
const collator = new Intl.Collator(); // hoisted: per-pair localeCompare over 135k rows janks pans
const BASEMAP_KEY = "postcards-basemap";
const GLOBE_KEY = "postcards-globe";
const TRIPS_LAYER_KEY = "postcards-layer-trips";
// The growth dimensions filter SAVED records (favourite / photo / note / continent),
// so they belong to the record-based screens (Places). The map neither exposes them
// in its panel nor counts them in its badge/summary.
const MAP_HIDDEN_FIELDS: (keyof FilterState)[] = [
  "favoritesOnly",
  "hasPhoto",
  "hasNote",
  "continent",
  // One-country drill-down is a lists action (set from the Stats card); on the map
  // you just pan to the country, so it neither filters the markers nor shows a chip.
  "country",
  // Monument category is a Places list dimension; the map's markers ignore it.
  "category",
  // Place-kind mode is its own prominent pill now, not a filter — its state is
  // visible in the pill itself, so it must not double up as a summary chip or
  // light the Filter badge.
  "mode",
];

// i18n key for each basemap's label (translated at the call site).
const BASEMAP_LABEL_KEY: Record<Basemap, MessageKey> = {
  simple: "map.basemap.simple",
  osm: "map.basemap.osm",
  detail: "map.basemap.detail",
};

// Resolve the effective dark boolean for the basemap from the explicit theme
// choice: forced dark/light win outright; "system" follows the device query.
function resolveDark(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

// localStorage may throw (private mode); loading then parses null → the default,
// and saving is silently skipped.
function loadPref<T>(key: string, parse: (v: string | null) => T): T {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return parse(null);
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: not persisted */
  }
}

// The detailed OpenStreetMap map is the one true basemap now (real coastlines,
// colour, street detail — and it's downloadable for offline in Settings). The
// bland vector-outline "simple" map survives only as an automatic fallback when
// OSM tiles can't load offline, so it's no longer an option here. A previously
// saved "simple" preference migrates to "osm".
function loadBasemap(): Basemap {
  return loadPref(BASEMAP_KEY, (v) => (v === "detail" ? "detail" : "osm"));
}

/**
 * The map screen stays mounted for the app's whole life (App hides it with CSS
 * instead of unmounting — tearing down MapLibre made every return to the tab a
 * full map reload). While `active` is false only the map box itself stays in
 * the DOM; the counter strip and the in-view list unrender so their text never
 * shadows the visible screen for screen readers or tests.
 */
export function MapScreen({ active = true }: { active?: boolean } = {}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const showToast = useToast((s) => s.show);
  const mapFocus = useUi((s) => s.mapFocus);
  const selectedPlace = useUi((s) => s.selectedPlace);
  const reducedMotion = usePrefersReducedMotion();
  // The privacy escape hatch: when off, the app uses the no-network offline map
  // only (zero outbound requests), overriding whatever detailed basemap is saved.
  const onlineMap = useSettings((s) => s.onlineMap);
  // The master self-contained switch: when on, it overrides onlineMap entirely —
  // no tiles, no consent offer, no reconnect prompt. Zero optional egress.
  const offlineMode = useSettings((s) => s.offlineMode);
  const maxMarkers = useSettings((s) => s.maxMarkers);
  const optimizeMarkers = useSettings((s) => s.optimizeMarkers);
  const showAllMarkers = useSettings((s) => s.showAllMarkers);
  const reduceMapWork = useSettings((s) => s.reduceMapWork);
  // The explicit colour-theme choice (System / Light / Dark) drives the
  // basemap's dark palette too, so it never desyncs from the UI.
  const theme = useSettings((s) => s.theme);

  // gazGen invalidates city snapshots when the full 135k-city set streams in —
  // the singleton mutates in place, so `ref` alone never re-fires these memos.
  const gazGen = useGazetteerGeneration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allCities = useMemo(() => ref.allCities(), [ref, gazGen]);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fit, setFit] = useState<MapFit | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  // When a place is picked elsewhere (search/chip/list), the id whose list row
  // should scroll into view once it appears in the in-view list.
  const scrollToIdRef = useRef<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap>(loadBasemap);
  const [hasDetail, setHasDetail] = useState(false);
  const online = useOnlineStatus();
  // The online base fell back to the offline base (offline / blocked tiles). Set
  // when it happens; drives the manual "Reconnect" prompt — never auto-switches.
  const [fellBackOffline, setFellBackOffline] = useState(false);
  // "Add your own place" seeded from the map (long-press/right-click a spot, or
  // the ＋ Add place button which seeds the current map centre).
  const [addPlaceAt, setAddPlaceAt] = useState<{ lon: number; lat: number } | null>(null);
  const [addPlaceOpen, setAddPlaceOpen] = useState(false);
  // The one shared filter state (spec 016) replaces the map's old per-control local
  // state: status, population, date window and folder now live in `useFilters` — the
  // same store the Places lists read — and the single Filter panel is where they
  // change. These aliases keep the rest of the map reading the familiar names.
  const filters = useFilters();
  // "Apply to list only" (Filter panel): when on, the MAP ignores the slicing
  // dimensions and shows everything — the filter still narrows the Places lists.
  // The place-kind pill (`mode`) is a map control, not a filter, so it always applies.
  const listOnly = filters.listOnly;
  const cityFilter = listOnly ? [] : filters.status;
  const minPop = listOnly ? 0 : filters.minPop;
  const dateFilter: MapDate = listOnly ? { mode: "all" } : filters.date;
  const folder = listOnly ? "" : filters.folder;
  const trips = useTrips((s) => s.trips);
  // Remembered across sessions, like the basemap and globe (default on).
  const [showTrips, setShowTrips] = useState(() => loadPref(TRIPS_LAYER_KEY, (v) => v !== "0"));
  const [globe, setGlobe] = useState(() => loadPref(GLOBE_KEY, (v) => v === "1"));
  const [showTowns, setShowTowns] = useState(() => loadPref("postcards-towns", (v) => v === "1"));
  // ON by default: "visited countries visually distinguished" is a core map
  // promise (US2-AC2) — the layer only paints countries you've actually visited,
  // so a fresh map stays clean anyway. The Layers toggle still turns it off.
  const [showCountries, setShowCountries] = useState(() =>
    loadPref("postcards-countries", (v) => v !== "0"),
  );
  // The list always sits right of the map (desktop) / below it (mobile);
  // the slider decides how much room it gets. The axis follows the layout.
  const [wide, setWide] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(min-width: 900px)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(min-width: 900px)");
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const screenRef = useRef<HTMLDivElement>(null);

  // The SLIDER between the panes: drag it to give the list more or less room —
  // continuously, not in dock-flips. On phones it slides up/down (map height);
  // on desktop it slides left/right (list width). Arrow keys nudge it (window-
  // splitter pattern), and the chosen size persists.
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const [mapH, setMapH] = useState<number | null>(() =>
    loadPref("postcards-map-h", (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 120 ? Math.round(n) : null;
    }),
  );
  const [listW, setListW] = useState<number | null>(() =>
    loadPref("postcards-list-w", (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 260 ? Math.round(n) : null;
    }),
  );
  const dividerDrag = useRef(false);
  function onDivDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dividerDrag.current = true;
  }
  function onDivMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dividerDrag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const box = screenRef.current?.getBoundingClientRect();
    if (!box) return;
    if (wide) {
      const raw = box.right - e.clientX;
      setListW(clamp(Math.round(raw), 260, Math.max(320, Math.round(box.width * 0.6))));
    } else {
      const mapBox = screenRef.current?.querySelector(".map-box")?.getBoundingClientRect();
      if (!mapBox) return;
      const raw = e.clientY - mapBox.top;
      // The list may be slid nearly shut — it compresses to header + rows
      // (see the @container rule) instead of clamping early.
      setMapH(clamp(Math.round(raw), 120, Math.max(180, Math.round(box.height - 140))));
    }
  }
  function onDivUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!dividerDrag.current) return;
    dividerDrag.current = false;
    if (wide && listW != null) savePref("postcards-list-w", String(listW));
    if (!wide && mapH != null) savePref("postcards-map-h", String(mapH));
  }
  function onDivKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = 24;
    if (wide && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Moving the divider left grows the (right-docked) list.
      const grow = e.key === "ArrowLeft" ? step : -step;
      const next = clamp((listW ?? 360) + grow, 260, 640);
      setListW(next);
      savePref("postcards-list-w", String(next));
      e.preventDefault();
    } else if (!wide && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const mapBox = screenRef.current?.querySelector(".map-box")?.getBoundingClientRect();
      const cur = mapH ?? Math.round(mapBox?.height ?? 300);
      const ceiling = Math.max(
        180,
        Math.round((screenRef.current?.getBoundingClientRect().height ?? 940) - 140),
      );
      const next = clamp(cur + (e.key === "ArrowUp" ? -step : step), 120, ceiling);
      setMapH(next);
      savePref("postcards-map-h", String(next));
      e.preventDefault();
    }
  }
  const paneVars = {
    ...(mapH != null ? { "--map-h": `${mapH}px` } : {}),
    ...(listW != null ? { "--list-w": `${listW}px` } : {}),
  } as React.CSSProperties;
  // A focusable separator is the ARIA "window splitter" pattern — it must
  // expose its position as a value (axe: aria-required-attr).
  const dividerValue = wide
    ? Math.round((clamp((listW ?? 360) - 260, 0, 380) / 380) * 100)
    : mapH != null
      ? Math.round((clamp(mapH - 120, 0, 680) / 680) * 100)
      : 50;
  const [layersOpen, setLayersOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const mode = filters.mode;
  const [dark, setDark] = useState(() => resolveDark(theme));

  // Offer the offline street basemap only when a PMTiles pack is actually
  // installed (via the device-global Offline Map Store). None is bundled.
  useEffect(() => {
    let alive = true;
    void bundledMapSource.isAvailableOffline("world-detail").then((ok) => {
      if (!alive) return;
      setHasDetail(ok);
      if (!ok && loadBasemap() === "detail") {
        setBasemap("osm");
        savePref(BASEMAP_KEY, "osm");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Keep the offline basemap's palette in sync with the resolved theme. A forced
  // Light/Dark choice ignores the device query; under "system" we follow
  // prefers-color-scheme live. Re-resolves whenever the theme choice changes.
  useEffect(() => {
    setDark(resolveDark(theme));
    if (typeof matchMedia === "undefined" || theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (theme !== "system") return; // forced themes ignore the device query
      setDark(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Only the detailed map (and, if a device-global streets pack is installed, the
  // offline streets map) are user choices now — no bland outline map to cycle to.
  const basemapCycle: Basemap[] = hasDetail ? ["osm", "detail"] : ["osm"];
  const nextBasemap = basemapCycle[(basemapCycle.indexOf(basemap) + 1) % basemapCycle.length]!;
  // When online maps are turned off in Settings — or Offline mode overrides
  // everything — force the bundled offline vector map (zero outbound requests).
  const effectiveBasemap: Basemap = onlineMap && !offlineMode ? basemap : "simple";

  function switchBasemap() {
    setBasemap(nextBasemap);
    savePref(BASEMAP_KEY, nextBasemap);
  }


  function toggleGlobe() {
    setGlobe((on) => {
      savePref(GLOBE_KEY, !on ? "1" : "0");
      return !on;
    });
  }

  const inView = useMemo(
    () => citiesInView(allCities, bounds, IN_VIEW_CAP, true),
    [allCities, bounds],
  );
  const inViewCapped = inView.length === IN_VIEW_CAP;

  // One predicate decides whether a visit passes the map's date window AND folder
  // filter — every count, marker set and the in-view list use it, so they always
  // agree. A bounded date range excludes undated places; a folder narrows to that
  // folder only.
  const visitPasses = (v: (typeof visits)[number]) =>
    mapDateMatches(v.date, dateFilter) && (!folder || v.folder === folder);
  // Quick-pick chips: a year (→ that whole year) or the undated bucket, from YOUR
  // visited places' dates (never the 135k gazetteer). Which chip is lit is derived
  // from the current window so the date pickers and the chips stay in step.
  const yearBuckets = useMemo(
    () =>
      dateBuckets([
        ...visits.filter((v) => v.status !== "wishlist").map((v) => ({ date: v.date })),
        ...trips.map((tr) => ({ date: tr.date })),
      ]),
    [visits, trips],
  );
  // Folders in use, gathered from your visits AND your trip names (both are
  // "folders" on the map), for the folder picker inside the one Filter panel.
  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) if (v.folder) set.add(v.folder);
    for (const tr of trips) {
      const n = tr.name?.trim();
      if (n) set.add(n);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [visits, trips]);
  // The map acts on status / people / date / folder / sort / mode — but NOT the
  // growth dimensions (favourites-only / has-photo / has-note / continent filter
  // saved records; see Places). So they don't count toward the map's badge or its
  // summary chips.
  // With "list only" on, the map isn't filtered — so it shows no active-filter
  // chips or badge (the filter's effect lives on the Places lists).
  const mapChips = listOnly
    ? []
    : activeChips(currentFilters(filters), t).filter((c) => !MAP_HIDDEN_FIELDS.includes(c.field));
  const filterActive = mapChips.length > 0;
  const activeCount = mapChips.length;
  // A short human label for the active window (for the trip-arc period tag etc.).
  const exactYear = dateFilter.mode === "range" ? rangeExactYear(dateFilter) : null;
  const periodTag =
    dateFilter.mode === "undated"
      ? ""
      : exactYear
        ? exactYear
        : dateFilter.mode === "range"
          ? [dateFilter.from, dateFilter.to].filter(Boolean).join(" – ")
          : "";

  const visitedCityIds = useMemo(
    () =>
      new Set(
        visits.filter((v) => v.place.kind === "city" && visitPasses(v)).map((v) => v.place.id),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visits, dateFilter, folder],
  );
  // The filtered list is a SNAPSHOT: it recomputes only when the viewport or the
  // filter changes — never when a visit is toggled. So under "Hide visited",
  // checking a city keeps its row until the next map move / filter change
  // instead of yanking it away mid-action.
  const [snapshot, setSnapshot] = useState<City[]>([]);
  const [shown, setShown] = useState(PAGE);
  const sortAZ = filters.sort === "az";
  useEffect(() => {
    // Three explicit personal buckets in view (date/folder window applied): the
    // cities you've VISITED, the ones on your WANT list, and everything else.
    const cityVisits = useVisits
      .getState()
      .visits.filter((v) => v.place.kind === "city" && visitPasses(v));
    const visitedIds = new Set(
      cityVisits.filter((v) => v.status === "visited").map((v) => v.place.id),
    );
    const wishlistIds = new Set(
      cityVisits.filter((v) => v.status === "wishlist").map((v) => v.place.id),
    );
    // MULTI-SELECT status (empty = show all): a city shows if its own bucket is
    // among the selected statuses. statusShows treats empty/all-three as "show all".
    const showVisited = statusShows(cityFilter, "visited");
    const showWish = statusShows(cityFilter, "wishlist");
    const showUnvisited = statusShows(cityFilter, "unvisited");
    const arr =
      folder
        ? // A selected folder → just YOUR cities in view (visited + want-list),
          // matching the map, no browse noise.
          inView.filter((c) => visitedIds.has(c.id) || wishlistIds.has(c.id))
        : inView.filter((c) => {
            if (visitedIds.has(c.id)) return showVisited;
            if (wishlistIds.has(c.id)) return showWish;
            return showUnvisited; // neither visited nor want-list
          });
    // "By number of people" narrows the list in lock-step with the map dots.
    const arrP = minPop > 0 ? arr.filter((c) => (c.population ?? 0) >= minPop) : arr;
    setSnapshot(sortAZ ? [...arrP].sort((a, b) => collator.compare(a.name, b.name)) : arrP);
    setShown(PAGE);
    // visitedCityIds deliberately NOT a dependency — see comment above. The date
    // window / folder ARE: a new selection re-partitions the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, cityFilter, sortAZ, dateFilter, folder, minPop]);
  const visible = useMemo(() => snapshot.slice(0, shown), [snapshot, shown]);
  const visitedInView = useMemo(
    () => inView.reduce((n, c) => n + (visitedCityIds.has(c.id) ? 1 : 0), 0),
    [inView, visitedCityIds],
  );

  // POI lists for the non-city map modes (Monuments / Airports in view).
  const inB = (lat: number, lon: number) =>
    !!bounds &&
    lat >= bounds.south &&
    lat <= bounds.north &&
    (bounds.west <= bounds.east
      ? lon >= bounds.west && lon <= bounds.east
      : lon >= bounds.west || lon <= bounds.east);
  const poi = useMemo(() => {
    // The header shows totals over EVERYTHING in view (visited counted from
    // your records of this kind), even though the list renders at most 100.
    const visitedOf = (kind: "heritage" | "airport") =>
      new Set(
        useVisits
          .getState()
          .visits.filter(
            (v) => v.place.kind === kind && v.status !== "wishlist" && visitPasses(v),
          )
          .map((v) => v.place.id),
      );
    if (mode === "monuments") {
      const all = ref
        .allHeritage()
        .filter((h) => (h.lat !== 0 || h.lon !== 0) && inB(h.lat, h.lon));
      const seen = visitedOf("heritage");
      return {
        total: all.length,
        visited: all.reduce((n, h) => n + (seen.has(h.id) ? 1 : 0), 0),
        items: all.slice(0, POI_LIST_CAP).map((h) => ({
          key: h.id,
          flag: heritageGlyph(h.category),
          name: h.name,
          sub: ref.countryByIso2(h.countryIso2)?.name ?? h.countryIso2,
          lat: h.lat,
          lon: h.lon,
          place: { kind: "heritage" as const, id: h.id, name: h.name, countryId: h.countryIso2 },
          page: true,
          seen: seen.has(h.id),
        })),
      };
    }
    if (mode === "airports") {
      const all = ref.allAirports().filter((a) => inB(a.lat, a.lon));
      const seen = visitedOf("airport");
      return {
        total: all.length,
        visited: all.reduce((n, a) => n + (seen.has(a.id) ? 1 : 0), 0),
        items: all.slice(0, POI_LIST_CAP).map((a) => ({
          key: a.id,
          flag: "✈️",
          name: `${a.name} (${a.id})`,
          sub: ref.countryByIso2(a.countryIso2)?.name ?? a.countryIso2,
          lat: a.lat,
          lon: a.lon,
          place: { kind: "airport" as const, id: a.id, name: `${a.name} (${a.id})`, countryId: a.countryIso2 },
          page: false,
          seen: seen.has(a.id),
        })),
      };
    }
    return null;
    // visits deliberately via getState() — the header count refreshing on a
    // check is fine to defer to the next bounds/mode change. The date window /
    // folder ARE deps so the "seen" counts re-derive when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bounds, ref, dateFilter, folder]);
  // The monument/airport list AFTER the visited/hide-visited filter — hoisted so
  // the list can show an honest empty message when the filter matches nothing
  // (before, the chips floated above a blank void and it read as broken).
  const shownPoi = useMemo(() => {
    if (!poi) return [];
    // MULTI-SELECT status, same as the city list: a POI shows if its bucket
    // (visited / want-list / neither) is among the selected statuses.
    const showVisited = statusShows(cityFilter, "visited");
    const showWish = statusShows(cityFilter, "wishlist");
    const showUnvisited = statusShows(cityFilter, "unvisited");
    if (showVisited && showWish && showUnvisited) return poi.items;
    const wishKeys = new Set(
      visits.filter((v) => v.status === "wishlist").map((v) => placeKey(v.place)),
    );
    return poi.items.filter((x) => {
      if (x.seen) return showVisited;
      if (wishKeys.has(placeKey(x.place))) return showWish;
      return showUnvisited;
    });
  }, [poi, cityFilter, visits]);

  // Trip arcs honour the SAME map filter as the places: a trip shows only when
  // its date is in the window AND (if a folder is chosen) its name is that
  // folder. Undated trips have no arc, so a bounded window simply clears them.
  const arcTrips = useMemo(
    () =>
      trips.filter(
        (tr) => mapDateMatches(tr.date, dateFilter) && (!folder || (tr.name ?? "").trim() === folder),
      ),
    [trips, dateFilter, folder],
  );
  const arcs = useMemo(() => tripArcs(arcTrips, ref), [arcTrips, ref]);
  const hasArcs = arcs.features.length > 0;

  // Another tab asked the map to fly somewhere (Places row → map).
  useEffect(() => {
    if (mapFocus) setFocus({ lon: mapFocus.lon, lat: mapFocus.lat, key: mapFocus.nonce });
  }, [mapFocus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // A place picked anywhere OFF the map (search, a Places row) flies here, opens
  // its preview card — exactly like tapping the marker — and flags its list row
  // to scroll into view once the list catches up to the fly.
  useEffect(() => {
    if (!selectedPlace) return;
    const { place, lon, lat } = selectedPlace;
    scrollToIdRef.current = place.id;
    openPlaceCard({
      lon,
      lat,
      name: place.name,
      sub: cardSubFor(place),
      place,
      // Cities, monuments and airports each have a detail page; a custom pin
      // doesn't (the pin itself IS the record).
      hasPage: place.kind !== "custom",
    });
  }, [selectedPlace?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // The "· Country - Region" context line for a place's preview card — the same
  // secondary line the map's own list rows already show.
  function cardSubFor(place: PlaceRef): string {
    const country = ref.countryByIso2(place.countryId)?.name ?? place.countryId;
    if (place.kind === "city") {
      const c = ref.cityById(place.id);
      const region = c?.subdivisionId ? ref.subdivisionById(c.subdivisionId)?.name : null;
      return `${country}${region ? ` - ${region}` : ""}`;
    }
    return country;
  }

  // Fly to a place AND open its preview card — the SAME result as tapping the
  // place's marker on the map. Every list row and every cross-screen pick
  // (search, a Places row jumping here) routes through this, so "click the row"
  // is exactly "click the point on the map": a card you can read, mark visited,
  // wishlist, journal or open in full — never a silent re-centre.
  function openPlaceCard(info: {
    lon: number;
    lat: number;
    name: string;
    sub: string;
    place: PlaceRef;
    hasPage: boolean;
  }) {
    setSelectedCityId(info.place.id);
    setFocus((f) => ({
      lon: info.lon,
      lat: info.lat,
      key: (f?.key ?? 0) + 1,
      popup: {
        name: info.name,
        sub: info.sub,
        place: info.place,
        hasPage: info.hasPage,
        // A photo only for cities & monuments — matches the marker-tap card;
        // airports carry none (MapView gates it on the guides opt-in).
        showImage: info.place.kind === "city" || info.place.kind === "heritage",
      },
    }));
  }

  // Everything of YOURS with coordinates — visited & wishlist cities, plus your
  // own custom points. This is what the first frame frames.
  const myPlaceCoords = useMemo(() => {
    const out: { lon: number; lat: number }[] = [];
    for (const v of visits) {
      if (v.place.kind === "city") {
        const c = ref.cityById(v.place.id);
        if (c) out.push({ lon: c.lon, lat: c.lat });
      } else if (v.place.kind === "custom" && v.place.lat != null && v.place.lon != null) {
        out.push({ lon: v.place.lon, lat: v.place.lat });
      }
    }
    return out;
    // gazGen: a restored visit to a small town resolves once the full set lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, ref, gazGen]);

  // First open: SNAP to your world (visited + wishlist + custom) before the
  // basemap even finishes — never a generic world view first.
  const didInitFit = useRef(false);
  useEffect(() => {
    if (didInitFit.current || hasSavedCamera() || myPlaceCoords.length === 0) return;
    didInitFit.current = true;
    fitToMyPlaces(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlaceCoords]);

  function fitToMyPlaces(instant = false) {
    const bounds = fitBounds(myPlaceCoords);
    if (!bounds) return;
    setFit((f) => ({ bounds, key: (f?.key ?? 0) + 1, instant }));
  }

  return (
    <div
      ref={screenRef}
      style={paneVars}
      className="map-screen"
    >
      {/* Search lives in the app top bar now — this row is just the counters. */}
      {active && (
        <div className="map-top">
          <StatStrip />
        </div>
      )}

      <div className="map-box">
        <MapView
          key={effectiveBasemap}
          basemap={effectiveBasemap}
          dark={dark}
          onBounds={setBounds}
          focus={focus}
          fit={fit}
          cityFilter={cityFilter}
          minPop={minPop}
          tripArcs={showTrips ? arcs : null}
          globe={globe}
          mode={mode}
          showTowns={showTowns}
          showCountries={showCountries}
          maxMarkers={maxMarkers}
          optimizeMarkers={optimizeMarkers}
          showAllMarkers={showAllMarkers}
          reduceMapWork={reduceMapWork}
          dateFilter={dateFilter}
          folder={folder}
          reducedMotion={reducedMotion}
          onBaseUnavailable={() => {
            if (basemap === "osm") {
              // Session-only fallback — do NOT persist. A transient outage must
              // not strand the user on the offline base forever; reconnecting (or
              // a reload) restores the online map with the saved preference intact.
              setBasemap("simple");
              setFellBackOffline(true);
              showToast(t("map.toast.offlineFallback"));
            }
          }}
          onAddHere={(c) => {
            setAddPlaceAt(c);
            setAddPlaceOpen(true);
          }}
        />
        {online && fellBackOffline && onlineMap && (
          <div className="map-reconnect" role="status">
            <span className="small">{t("map.reconnect.back")}</span>
            <button
              type="button"
              className="mini-btn"
              onClick={() => {
                setBasemap("osm");
                savePref(BASEMAP_KEY, "osm");
                setFellBackOffline(false);
              }}
            >
              {t("map.reconnect.button")}
            </button>
          </div>
        )}
        {/* Place-kind switch, front and centre. Cities / monuments / airports are
            genuinely DIFFERENT data, not one more filter to bury in the panel — so
            it's a first-class map control (its own prominent pill), never a row in
            the Filter menu. */}
        <div className="map-ctl map-ctl-top">
          <div className="segmented map-mode" role="group" aria-label={t("filter.mode.title")}>
            {(["all", "cities", "monuments", "airports"] as FilterMode[]).map((m) => {
              const label = t(`filter.mode.${m}` as const);
              const icon = m === "cities" ? "🏙" : m === "monuments" ? "🏛" : m === "airports" ? "✈" : "";
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  aria-label={label}
                  className={active ? "seg-on" : ""}
                  onClick={() => filters.set({ mode: m })}
                  title={label}
                >
                  {/* Inactive segments are icon-only so the pill stays small; the
                      ACTIVE one spells out its label beside its icon so the current
                      dataset is legible in words, not just by the highlight. "All"
                      has no glyph, so it always shows its word. aria-label carries
                      the full name on every segment (screen readers + e2e). */}
                  {icon}
                  {active || !icon ? (icon ? " " : "") + label : ""}
                </button>
              );
            })}
          </div>
        </div>
        {addPlaceOpen && (
          <div
            className="map-add-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t("map.addDialogAria")}
            onClick={() => setAddPlaceOpen(false)}
          >
            <div className="map-add-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="section-head">
                <h3>{t("map.addDialogTitle")}</h3>
                <button
                  className="link"
                  type="button"
                  onClick={() => setAddPlaceOpen(false)}
                  aria-label={t("common.close")}
                >
                  {t("common.close")}
                </button>
              </div>
              <AddPlaceForm
                initialName=""
                initialCoords={addPlaceAt ?? undefined}
                onDone={() => setAddPlaceOpen(false)}
              />
            </div>
          </div>
        )}
        <div className="map-ctl map-ctl-right">
          {/* The ONE Filter control (spec 016) for slicing WITHIN a place kind —
              status, people, date, folder, sort. The place-kind switch itself
              (cities / monuments / airports) is its own prominent pill above, since
              those are different datasets, not just another filter. */}
          <button
            className={"map-btn" + (filterOpen ? " on" : "") + (filterActive ? " map-btn-dot" : "")}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-label={
              filterActive
                ? `${t("filter.open")} · ${t("filter.activeAria", { count: activeCount })}`
                : t("filter.open")
            }
            title={t("filter.open")}
            onClick={() => {
              setFilterOpen(true);
              setLayersOpen(false);
            }}
          >
            {t("filter.open")}
          </button>
          <button
            className={"map-btn" + (layersOpen ? " on" : "")}
            type="button"
            aria-expanded={layersOpen}
            aria-haspopup="true"
            title={t("map.layersTitle")}
            onClick={() => {
              setLayersOpen((v) => !v);
              setFilterOpen(false);
            }}
          >
            ≡ {t("map.layersButton")}
          </button>
          {/* The map carries NO online/"detailed map" toggle: one global Online/Offline
              mode (the top-bar chip) governs egress, and Settings holds the single
              "detailed online map" control. This is the coherence fix — the map surface
              never re-grows its own connectivity button. */}
          {layersOpen && (
            <div className="layers-panel" role="group" aria-label={t("map.layersAria")}>
              <button
                className={"map-btn" + (globe ? " on" : "")}
                type="button"
                aria-pressed={globe}
                onClick={toggleGlobe}
              >
                🌐 {t("map.layer.globe")}
              </button>
              {hasArcs && (
                <button
                  className={"map-btn" + (showTrips ? " on" : "")}
                  type="button"
                  aria-pressed={showTrips}
                  onClick={() =>
                    setShowTrips((s) => {
                      savePref(TRIPS_LAYER_KEY, s ? "0" : "1");
                      return !s;
                    })
                  }
                  title={periodTag ? t("map.layer.tripsTitle", { period: periodTag }) : undefined}
                >
                  🧵 {t("map.layer.trips")}{showTrips && periodTag ? ` · ${periodTag}` : ""}
                </button>
              )}
              <button
                className={"map-btn" + (showTowns ? " on" : "")}
                type="button"
                aria-pressed={showTowns}
                title={t("map.layer.townsTitle")}
                onClick={() => {
                  setShowTowns((v) => {
                    savePref("postcards-towns", !v ? "1" : "0");
                    return !v;
                  });
                }}
              >
                ∴ {t("map.layer.towns")}
              </button>
              <button
                className={"map-btn" + (showCountries ? " on" : "")}
                type="button"
                aria-pressed={showCountries}
                title={t("map.layer.myCountriesTitle")}
                onClick={() => {
                  setShowCountries((v) => {
                    savePref("postcards-countries", !v ? "1" : "0");
                    return !v;
                  });
                }}
              >
                🗺 {t("map.layer.myCountries")}
              </button>
              {onlineMap && basemapCycle.length > 1 && (
                <button className="map-btn" type="button" onClick={switchBasemap}>
                  ⤳ {t(BASEMAP_LABEL_KEY[nextBasemap])}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {active && (
        <div
          className="pane-divider"
          role="separator"
          tabIndex={0}
          aria-orientation={wide ? "vertical" : "horizontal"}
          aria-valuenow={dividerValue}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("map.dividerAria")}
          title={t("map.dividerTitle")}
          onPointerDown={onDivDown}
          onPointerMove={onDivMove}
          onPointerUp={onDivUp}
          onPointerCancel={onDivUp}
          onKeyDown={onDivKey}
        />
      )}
      {active && (
      <section className="view-list" aria-label={t("map.list.aria")}>
        <div className="section-head">
          <h2>{mode === "monuments" ? t("map.list.headingMonuments") : mode === "airports" ? t("map.list.headingAirports") : t("map.list.headingCities")}</h2>
          <span className="list-head-meta muted">
            <span>
              {t("map.list.inView", {
                count: poi ? poi.total : formatInt(inView.length) + (inViewCapped ? "+" : ""),
              })}
            </span>
            {(poi ? poi.visited : visitedInView) > 0 && (
              <span>{t("map.list.visited", { count: poi ? poi.visited : visitedInView })}</span>
            )}
          </span>
        </div>

        {/* With "list only" on, the map isn't filtered — hide its chip summary too
            (the filter's effect shows on the Places lists, not here). */}
        {!listOnly && <FilterSummary exclude={MAP_HIDDEN_FIELDS} />}

        {poi ? (
          poi.items.length === 0 ? (
            <p className="muted empty">{t("map.list.poiEmpty")}</p>
          ) : (
            <>
            {shownPoi.length === 0 ? (
              <p className="muted empty">
                {cityFilter.length === 1 && cityFilter[0] === "visited"
                  ? t("map.poiNoneVisited")
                  : cityFilter.length === 1 && cityFilter[0] === "wishlist"
                    ? t("map.poiNoneWishlist")
                    : t("map.poiAllVisited")}
              </p>
            ) : (
              <ul className="city-list">
                {shownPoi.map((x) => (
                  <li key={x.key} className="city-row compact">
                    <button
                      className="city-focus"
                      type="button"
                      title={t("stats.records.showOnMap", { name: x.name })}
                      onClick={() =>
                        // Same as tapping this monument/airport's marker: fly in
                        // and open its preview card (mark visited / Details), not
                        // just a re-centre.
                        openPlaceCard({
                          lon: x.lon,
                          lat: x.lat,
                          name: x.name,
                          sub: x.sub,
                          place: x.place,
                          hasPage: true,
                        })
                      }
                    >
                      <CityLine flag={x.flag} name={x.name} sub={<>· {x.sub}</>} multiline />
                    </button>
                    {/* 📖 opens the Wikivoyage guide — distinct from the card's Details. */}
                    {x.page && <GuideButton place={x.place} />}
                    <StateToggles place={x.place} />
                  </li>
                ))}
              </ul>
            )}
            {poi.total > poi.items.length && (
              <p className="muted small">
                {t("map.poiShowing", { shown: poi.items.length, total: poi.total })}
              </p>
            )}
            </>
          )
        ) : (
        <>
        {inView.length === 0 ? (
          <p className="muted empty">
            <span className="empty-emoji" aria-hidden>
              🗺️
            </span>
            {t("map.emptyNoCities")}
          </p>
        ) : snapshot.length === 0 ? (
          <p className="muted empty">
            {/* A population / date / folder narrowing emptied the list → name it
                (the chip summary above carries the one-tap Clear all). Otherwise
                fall back to the friendly status-specific line. */}
            {mapChips.some((c) => c.field !== "status")
              ? t("filter.emptyFiltered")
              : cityFilter.length === 1 && cityFilter[0] === "unvisited"
                ? t("map.emptyAllVisited")
                : cityFilter.length === 1 && cityFilter[0] === "wishlist"
                  ? t("map.emptyNoWishlist")
                  : t("map.emptyNoVisited")}
          </p>
        ) : (
          <ul className="city-list">
            {visible.map((c) => {
              const country = ref.countryByIso2(c.countryIso2)?.name ?? c.countryIso2;
              const region = c.subdivisionId ? ref.subdivisionById(c.subdivisionId)?.name : null;
              const selected = selectedCityId === c.id;
              const place = { kind: "city" as const, id: c.id, name: c.name, countryId: c.countryIso2 };
              return (
                <li
                  key={c.id}
                  ref={
                    selected && scrollToIdRef.current === c.id
                      ? (el) => {
                          if (el) {
                            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                            scrollToIdRef.current = null;
                          }
                        }
                      : undefined
                  }
                  className={"city-row compact" + (selected ? " selected" : "")}
                >
                  <button
                    className="city-focus"
                    type="button"
                    aria-expanded={selected}
                    title={t("stats.records.showOnMap", { name: c.name })}
                    onClick={() =>
                      // A row click is a marker tap: zoom in AND open the preview
                      // card (photo + been-there/wishlist/story/Details) above the
                      // marker — visited or not — instead of a silent re-centre.
                      openPlaceCard({
                        lon: c.lon,
                        lat: c.lat,
                        name: c.name,
                        sub: `${country}${region ? ` - ${region}` : ""}`,
                        place,
                        hasPage: true,
                      })
                    }
                  >
                    <CityLine
                      flag={countryFlag(c.countryIso2)}
                      name={c.name}
                      sub={
                        <>
                          · {country}
                          {region ? ` - ${region}` : ""}
                        </>
                      }
                    />
                    {selected && (
                      <span className="city-detail">
                        {c.population != null
                          ? t("map.cityPeople", { count: formatInt(c.population) })
                          : t("map.populationUnknown")}
                      </span>
                    )}
                  </button>
                  {selected && <GuideButton place={place} />}
                  <StateToggles place={place} />
                </li>
              );
            })}
          </ul>
        )}
        {snapshot.length > shown && (
          <div className="list-pager">
            <span className="muted small">
              {t("map.pagerMostPopulous", {
                shown,
                total: formatInt(snapshot.length) + (inViewCapped ? "+" : ""),
              })}
            </span>
            <MoreButton onMore={() => setShown((n) => n + PAGE)}>
              {t("journal.showMore", { count: Math.min(PAGE, snapshot.length - shown) })}
            </MoreButton>
          </div>
        )}
        </>
        )}
      </section>
      )}

      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        folders={folderOptions}
        years={{ list: yearBuckets.years, undated: yearBuckets.undated }}
      />
    </div>
  );
}

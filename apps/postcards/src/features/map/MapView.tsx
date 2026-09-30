import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
  type FilterSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { feature } from "topojson-client";
import type { FeatureCollection, Polygon, MultiPolygon, Point, Feature, LineString } from "geojson";
import { getReferenceData, gazetteerGeneration } from "../../lib/reference/referenceData";
import { useGazetteerGeneration } from "../../lib/reference/useGazetteer";
import { bundledMapSource } from "../../lib/map-source/bundledMapSource";
import { useVisits, findByPlace } from "../../lib/store/useVisits";
import { useUi } from "../../lib/store/useUi";
import { useT } from "../../lib/i18n";
import { visitedCountryIds } from "../stats/computeStats";
import { mapDateMatches, type MapDate } from "../travel/period";
import {
  airportPoints,
  optimizeVisitedPoints,
  stationPoints,
  visitedCityPoints,
  wishlistCityPoints,
} from "./visitedLayers";
import { prefetchAroundBounds, prefetchAroundPoint, OSM_TILE_TEMPLATE } from "../../lib/offline/tiles";
import { markerCitiesInView, type Bounds } from "./viewport";
import { statusShows, type FilterStatus } from "../../lib/store/useFilters";
import type { City } from "../../lib/reference/types";
import type { PlaceRef, Visit } from "../../lib/schema/models";
import { countryFlag, formatInt } from "../../lib/format/format";

// Natural Earth 50m country geometry, served as a static asset (SW-cached for
// offline). Fetched ONCE and cached at module scope so remounts (basemap change,
// tab switch) never re-download or re-parse it.
const GEOMETRY_URL = `${import.meta.env.BASE_URL}basemap/countries-50m.json`;
// Natural Earth physical geometry (public domain) enriching the OFFLINE overview
// only — real lakes and rivers instead of a flat land silhouette. Tiny (110m,
// geometry-only), bundled and SW-cached like the country outlines; rich online
// bases already draw their own water, so these are never fetched there.
const LAKES_URL = `${import.meta.env.BASE_URL}basemap/lakes-110m.json`;
const RIVERS_URL = `${import.meta.env.BASE_URL}basemap/rivers-110m.json`;

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// The camera survives remounts (basemap switch, tab changes) at module scope.
let lastCamera: { center: maplibregl.LngLatLike; zoom: number } | null = null;
/** Whether a previous map instance left a camera to restore (used to decide
 *  whether the first load should fit to the user's own places instead). */
export function hasSavedCamera(): boolean {
  return lastCamera !== null;
}

let pmtilesRegistered = false;
function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

async function fetchCountries(): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  try {
    const res = await fetch(GEOMETRY_URL);
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo: any = await res.json();
    const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<
      Polygon | MultiPolygon
    >;
    for (const f of fc.features) {
      f.properties = { ...(f.properties ?? {}), numeric: String(f.id ?? "") };
    }
    return fc;
  } catch {
    return null;
  }
}

// Module-level cache: resolve the country geometry at most once per session, and
// allow a retry after a failed load (offline first-run) without a full remount.
// (The static file is also SW-precached; the app fetches the SAME plain URL that
// Workbox's precache route serves from cache, so there is ONE network download
// per install and this promise guarantees ONE parse per session — no double
// fetch even across basemap-toggle remounts.)
let countriesPromise: Promise<FeatureCollection<Polygon | MultiPolygon> | null> | null = null;
function getCountries(force = false): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  if (force) countriesPromise = null;
  if (!countriesPromise) {
    countriesPromise = fetchCountries().then((fc) => {
      if (!fc) countriesPromise = null; // let a later attempt retry
      return fc;
    });
  }
  return countriesPromise;
}

// Lakes & rivers get the SAME module-scoped memoisation as the country
// geometry: fetched + parsed at most once per session, so a remount (basemap
// toggle, tab switch) never re-downloads or re-parses them. A failed load
// (offline first-run) clears its slot so a later attempt can retry.
async function fetchWater(url: string): Promise<FeatureCollection | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as FeatureCollection;
  } catch {
    return null;
  }
}
let lakesPromise: Promise<FeatureCollection | null> | null = null;
let riversPromise: Promise<FeatureCollection | null> | null = null;
function getLakes(): Promise<FeatureCollection | null> {
  if (!lakesPromise) {
    lakesPromise = fetchWater(LAKES_URL).then((fc) => {
      if (!fc) lakesPromise = null; // let a later attempt retry
      return fc;
    });
  }
  return lakesPromise;
}
function getRivers(): Promise<FeatureCollection | null> {
  if (!riversPromise) {
    riversPromise = fetchWater(RIVERS_URL).then((fc) => {
      if (!fc) riversPromise = null; // let a later attempt retry
      return fc;
    });
  }
  return riversPromise;
}

const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const PILL_FONT = '600 21px "Inter Variable", system-ui, sans-serif';

/**
 * City marker, at ONE size for both states so a want-list city is never bigger
 * than a visited one. VISITED is the bare country flag. WANT-LIST is a distinct
 * amber DOT — a "you haven't unlocked the flag yet" placeholder that visiting
 * swaps for the real flag (the little unlock reward). Favourites (either state)
 * get a gold star at the corner.
 */
function makeCityPill(iso2: string, favorite: boolean, wish: boolean): ImageData {
  const w = 44;
  const h = 38; // ~19px on screen
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (wish) {
    // Amber dot placeholder — sized to the flag's footprint (never the oversized
    // always-on blob it used to be), with a white ring so it reads on any basemap.
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 + 1, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#f59e0b";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  } else {
    ctx.font = `27px ${EMOJI_FONT}`;
    ctx.fillText(countryFlag(iso2), w / 2, h / 2 + 1);
  }
  if (favorite) {
    ctx.font = `14px ${EMOJI_FONT}`;
    ctx.fillText("⭐", w - 9, 9);
  }
  return ctx.getImageData(0, 0, w, h);
}

// Each UNESCO kind gets its own emoji + ring colour, so a glance tells a temple
// from a national park from a mixed site. The category comes from the dataset —
// nothing is invented (Constitution: aggregator, never an author).
const MONUMENT_STYLE: Record<string, { emoji: string; ring: string; seenFill: string }> = {
  cultural: { emoji: "🏛️", ring: "#b45309", seenFill: "#f6c98a" },
  natural: { emoji: "🌲", ring: "#15803d", seenFill: "#bbf7d0" },
  mixed: { emoji: "🏞️", ring: "#7c3aed", seenFill: "#ddd6fe" },
};

/** Monument pin: a category emoji on a crisp white chip with a coloured ring —
 * the bare emoji vanished against the basemap. Filled once seen, + a ✅ badge. */
function makeMonumentPin(category: string, seen: boolean): ImageData {
  const st = MONUMENT_STYLE[category] ?? MONUMENT_STYLE.cultural!;
  const s = 50; // 25px on screen — the emoji has to read at a glance
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = seen ? st.seenFill : "#ffffff";
  ctx.fill();
  ctx.lineWidth = seen ? 3.5 : 2.5;
  ctx.strokeStyle = st.ring;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `29px ${EMOJI_FONT}`;
  ctx.fillText(st.emoji, s / 2, s / 2 + 1);
  if (seen) {
    ctx.font = `15px ${EMOJI_FONT}`;
    ctx.fillText("✅", s - 10, 10);
  }
  return ctx.getImageData(0, 0, s, s);
}

/** Browsable airport marker: a plain ✈ chip, one shared image for every airport
 * (the [✈ CODE] pill is reserved for airports you've actually logged). */
function makeAirportDot(): ImageData {
  const s = 34; // 17px on screen
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#0284c7";
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `17px ${EMOJI_FONT}`;
  ctx.fillText("✈️", s / 2, s / 2 + 1);
  return ctx.getImageData(0, 0, s, s);
}

/** Airport marker: [✈ CODE] pill, tinted (sky = been, amber = wish). */
function makeAirportPin(iata: string, wish: boolean, favorite: boolean): ImageData {
  const h = 30;
  const pad = 8;
  const gap = 5;
  const planeFont = `16px ${EMOJI_FONT}`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const plane = "✈️";
  ctx.font = planeFont;
  const planeW = ctx.measureText(plane).width;
  ctx.font = PILL_FONT;
  const codeW = ctx.measureText(iata).width;
  const w = Math.ceil(pad + planeW + gap + codeW + pad);
  canvas.width = w;
  canvas.height = h;

  const accent = wish ? "#d97706" : "#0284c7";
  const bg = wish ? "#fff7ed" : "#eff6ff";
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.arcTo(w - 1, 1, w - 1, h - 1, r - 1);
  ctx.arcTo(w - 1, h - 1, 1, h - 1, r - 1);
  ctx.arcTo(1, h - 1, 1, 1, r - 1);
  ctx.arcTo(1, 1, w - 1, 1, r - 1);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = favorite ? 3 : 1.5;
  ctx.strokeStyle = favorite ? "#f59e0b" : accent;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = planeFont;
  ctx.fillText(plane, pad, h / 2 + 1);
  ctx.font = PILL_FONT;
  ctx.fillStyle = accent;
  ctx.fillText(iata, pad + planeW + gap, h / 2 + 1);
  return ctx.getImageData(0, 0, w, h);
}

/** Browsable station marker: a plain 🚉 chip, one shared image for every station
 * (the tinted pin below is reserved for stations you've actually logged). */
function makeStationDot(): ImageData {
  const s = 34; // 17px on screen
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#0d9488";
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `17px ${EMOJI_FONT}`;
  ctx.fillText("🚉", s / 2, s / 2 + 1);
  return ctx.getImageData(0, 0, s, s);
}

/** Logged-station marker: a 🚉 chip tinted (teal = been, amber = wish), gold ring
 * when a favourite. No code label — station names are long, so the name shows on
 * tap; only four image variants exist (been/wish × fav) so they share cheaply. */
function makeStationPin(wish: boolean, favorite: boolean): ImageData {
  const s = 30; // 15px on screen
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const accent = wish ? "#d97706" : "#0d9488";
  const bg = wish ? "#fff7ed" : "#f0fdfa";
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = favorite ? 3 : 2;
  ctx.strokeStyle = favorite ? "#f59e0b" : accent;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `15px ${EMOJI_FONT}`;
  ctx.fillText("🚉", s / 2, s / 2 + 1);
  return ctx.getImageData(0, 0, s, s);
}

// Pre-generate the flag/airport marker images for EVERY place currently in a
// personal source, so a camera move (a zoom-OUT especially) never reveals a
// symbol whose image hasn't been made yet. Relying on `styleimagemissing`
// alone meant flags for countries that only scrolled into view on the zoom-out
// were requested mid-render and only painted on the NEXT frame/interaction —
// the "flags load in late" bug. hasImage-guarded, so this is a cheap no-op once
// warm. A repaint is nudged only when something new was actually added.
function ensurePillImages(map: MlMap, fc: FeatureCollection<Point>): void {
  let added = false;
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const cc = String(p.cc ?? "");
    const fav = Number(p.fav) === 1;
    const wish = Number(p.wish) === 1;
    const id = `pill-${cc}-${fav ? 1 : 0}-${wish ? 1 : 0}`;
    if (!map.hasImage(id)) {
      map.addImage(id, makeCityPill(cc, fav, wish), { pixelRatio: 2 });
      added = true;
    }
  }
  if (added) map.triggerRepaint();
}

function ensureAirImages(map: MlMap, fc: FeatureCollection<Point>): void {
  let added = false;
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const iata = String(p.iata ?? "");
    const wish = Number(p.wish) === 1;
    const fav = Number(p.fav) === 1;
    const id = `air-${iata}-${wish ? 1 : 0}-${fav ? 1 : 0}`;
    if (!map.hasImage(id)) {
      map.addImage(id, makeAirportPin(iata, wish, fav), { pixelRatio: 2 });
      added = true;
    }
  }
  if (added) map.triggerRepaint();
}

function ensureStationImages(map: MlMap, fc: FeatureCollection<Point>): void {
  let added = false;
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const wish = Number(p.wish) === 1;
    const fav = Number(p.fav) === 1;
    const id = `sta-${wish ? 1 : 0}-${fav ? 1 : 0}`;
    if (!map.hasImage(id)) {
      map.addImage(id, makeStationPin(wish, fav), { pixelRatio: 2 });
      added = true;
    }
  }
  if (added) map.triggerRepaint();
}

/** Zoom → how coarsely "Show one city per area" groups your visited flags, so
 *  they never pile up at low zoom yet more appear as you zoom in: one flag per
 *  country when far out, per subdivision closer, and every flag once you're in. */
function optimizeGranularity(zoom: number): "country" | "area" | null {
  if (zoom < 4) return "country";
  if (zoom < 7) return "area";
  return null; // zoomed in enough — show every flag
}

function inViewPoints(cities: City[]): FeatureCollection<Point> {
  const ref = getReferenceData();
  const features: Feature<Point>[] = cities.map((c) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    properties: {
      id: c.id,
      name: c.name,
      cc: c.countryIso2,
      pop: c.population ?? 0,
      region: c.subdivisionId ? ref.subdivisionById(c.subdivisionId)?.name ?? "" : "",
    },
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Popup for any tappable place marker: name, region · population, and actions —
 * check/uncheck visited right from the map, plus the city detail page.
 */
/** Load a small Wikipedia thumbnail of the place into the popup's photo slot,
 *  online only. Never touches the network offline (the caller gates on the live
 *  basemap, which Offline mode forces to the no-network "simple" base). Removes
 *  the slot if there's no image or the request fails — no empty gap, no spinner. */
async function loadPopupThumb(name: string, fig: HTMLElement): Promise<void> {
  try {
    const { fetchSummary } = await import("../../lib/wikivoyage");
    const sum = await fetchSummary(name, { project: "wikipedia" });
    if (!sum?.thumb) {
      fig.remove();
      return;
    }
    const img = document.createElement("img");
    img.className = "map-popup-img";
    img.src = sum.thumb;
    img.alt = name;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => fig.remove();
    fig.appendChild(img);
  } catch {
    fig.remove();
  }
}

/** How far to seat a place's marker BELOW the map's vertical centre so its
 *  preview card — which always opens ABOVE the marker — clears the top edge,
 *  but no more than the viewport actually needs. A tall (desktop) map already
 *  has ample room above a centred marker, so this returns 0 there and the place
 *  simply centres; only a short (mobile) map, where a centred card would be
 *  clipped, gets a downward nudge. Replaces a flat 28%-of-height shove that read
 *  as a jarring downward jump on a big screen. */
function cardSeatOffsetY(map: MlMap): number {
  const CARD = 260; // ≈ max card height: photo + name + context + actions + tip.
  const h = map.getContainer().clientHeight;
  return Math.max(0, Math.round(CARD - h / 2));
}

function openPlacePopup(
  map: MlMap,
  lngLat: maplibregl.LngLatLike,
  info: { name: string; sub: string; place: PlaceRef; hasPage: boolean },
  showImage = false,
): void {
  const el = document.createElement("div");
  el.className = "map-popup";
  // Online-only preview image (cities & monuments): a little Wikipedia photo of
  // what the place is, loaded lazily at the top of the card once it opens.
  if (showImage) {
    const fig = document.createElement("div");
    fig.className = "map-popup-photo";
    el.appendChild(fig);
    void loadPopupThumb(info.name, fig);
  }
  const actions = document.createElement("div");
  actions.className = "map-popup-actions";
  // anchor:"bottom" pins the card's bottom tip to the marker, so it ALWAYS opens
  // ABOVE the place (never below). The tap / list-click eases the marker toward
  // centre first, so there's room above for it on screen.
  const popup = new maplibregl.Popup({
    closeButton: false,
    offset: 12,
    maxWidth: "260px",
    anchor: "bottom",
  })
    .setLngLat(lngLat)
    .setDOMContent(el);

  // While a popup is open, dim the floating map controls (the mode bar sat on top
  // of popups near the top edge and clipped them). Restored on close.
  const box = map.getContainer().parentElement;
  box?.classList.add("popup-open");
  popup.on("close", () => box?.classList.remove("popup-open"));

  // The WHOLE popup body is the "been there" toggle — tap the marker, then tap
  // the card: two taps and you've been there (no tiny button to aim for). The
  // popup STAYS OPEN so the state flip is visible and reversible. The ⚑ wish
  // and ✍️ story buttons swap with the visited state: you wish for places you
  // haven't seen, you journal about places you have.
  let visited = findByPlace(useVisits.getState().visits, info.place)?.status === "visited";
  let wished = findByPlace(useVisits.getState().visits, info.place)?.status === "wishlist";
  const body = document.createElement("button");
  body.type = "button";
  body.className = "map-popup-main";
  const name = document.createElement("strong");
  name.textContent = info.name;
  body.appendChild(name);
  if (info.sub) {
    const sub = document.createElement("span");
    sub.textContent = info.sub;
    body.appendChild(sub);
  }
  const state = document.createElement("em");
  body.appendChild(state);
  el.appendChild(body);

  const wish = document.createElement("button");
  wish.type = "button";
  const story = document.createElement("button");
  story.type = "button";
  story.className = "mini-btn";
  story.textContent = "✍️ Story";
  story.title = "Write a journal story about today here";
  story.onclick = () => {
    popup.remove();
    useUi.getState().openJournalDraft(info.place);
  };
  const paint = () => {
    el.classList.toggle("popup-visited", visited);
    state.textContent = visited ? "✓ Visited · tap to undo" : "Tap to mark visited";
    body.title = visited ? `Remove ${info.name} from visited` : `Mark ${info.name} visited`;
    wish.className = "mini-btn" + (wished ? " mini-on" : "");
    // Advertise reversibility, exactly like the visited state's "tap to undo",
    // so removing a want-list city on the map is discoverable — not a dead end.
    wish.textContent = wished ? "⚑ Wishlisted · tap to remove" : "⚑ Want to go";
    wish.title = wished
      ? `Remove ${info.name} from wishlist`
      : `Add ${info.name} to wishlist`;
    wish.style.display = visited ? "none" : ""; // you've been — nothing to wish
    story.style.display = visited ? "" : "none"; // journal what you've seen
  };
  paint();
  body.onclick = () => {
    void useVisits.getState().toggleVisit(info.place);
    visited = !visited;
    if (visited) wished = false;
    paint();
  };
  wish.onclick = () => {
    if (visited) return;
    void useVisits.getState().toggleWish(info.place);
    wished = !wished;
    paint();
  };
  actions.appendChild(wish);
  actions.appendChild(story);

  // Escape dismisses the popup (keyboard parity with clicking the map).
  const onEsc = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") popup.remove();
  };
  window.addEventListener("keydown", onEsc);
  popup.on("close", () => window.removeEventListener("keydown", onEsc));

  if (info.hasPage) {
    const page = document.createElement("button");
    page.type = "button";
    page.className = "mini-btn";
    page.textContent = "Details";
    page.onclick = () => {
      popup.remove();
      useUi.getState().openCity(info.place.id);
    };
    actions.appendChild(page);
  }
  el.appendChild(actions);
  popup.addTo(map);
}

export interface MapFocus {
  lon: number;
  lat: number;
  key: number;
  /** When set, open the place preview popup (above the marker) once the fly
   *  settles — the list uses this so tapping a not-visited city previews it with
   *  its photo, exactly like tapping its dot on the map. */
  popup?: { name: string; sub: string; place: PlaceRef; hasPage: boolean; showImage: boolean };
}

export interface MapFit {
  bounds: [[number, number], [number, number]];
  key: number;
  /** Snap without animating — the first frame opens on your places. */
  instant?: boolean;
}

export type Basemap = "simple" | "osm" | "detail";
type MapMode = "all" | "cities" | "monuments" | "airports" | "stations";

const MODE_LAYERS: Record<Exclude<MapMode, "all">, string[]> = {
  cities: ["cities-visited", "cities-inview", "cities-all", "cities-wishlist"],
  monuments: ["poi-monuments"],
  airports: ["airports"],
  stations: ["stations"],
};

// Theme colours for the offline overview base (kept out of the render body).
// Land and sea must read as clearly DIFFERENT — a near-white land on a near-white
// sea looked blank. This matches the published-reader route map: a soft-blue sea,
// a warm land, and a defined coastline, so the offline base looks like a map.
function themeColors(dark: boolean) {
  return {
    ocean: dark ? "#0f1d2a" : "#d9e6f1",
    land: dark ? "#20271d" : "#eef1e5",
    landLine: dark ? "#3a462f" : "#b7c1a8",
    river: dark ? "#38506b" : "#8fb4d6",
  };
}

/** Overlay layers added on top of whichever base style is in use. */
function overlayLayers(basemap: Basemap, dark: boolean): StyleSpecification["layers"] {
  const richBase = basemap !== "simple";
  const { land, landLine, ocean, river } = themeColors(dark);
  // Physical water, drawn ONLY on the offline overview (rich bases have their
  // own): lakes as ocean-coloured fills over the land, rivers as thin lines.
  const water: StyleSpecification["layers"] = richBase
    ? []
    : [
        { id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": ocean } },
        {
          id: "rivers",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": river, "line-width": 0.8, "line-opacity": 0.9 },
        },
      ];
  return [
    // Country fill — the land silhouette on "simple", and a transparent hit-test
    // surface over rich bases. NOT coloured by visited-ness (no country highlight).
    {
      id: "countries-base",
      type: "fill",
      source: "countries",
      paint: richBase
        ? { "fill-color": "#000000", "fill-opacity": 0 }
        : { "fill-color": land, "fill-outline-color": landLine },
    },
    // Optional coverage tint: the countries you've visited, shaded green. Off by
    // default; the "My countries" toggle turns it on. The filter (which numeric
    // ISO codes to shade) is set from your visits at runtime.
    {
      id: "countries-visited-fill",
      type: "fill",
      source: "countries",
      filter: ["in", ["get", "numeric"], ["literal", []]] as FilterSpecification,
      layout: { visibility: "none" },
      paint: {
        "fill-color": dark ? "#1f7a4d" : "#34d399",
        "fill-opacity": dark ? 0.34 : 0.28,
      },
    },
    // A faint outline that's ALWAYS drawn, so the map is never a featureless
    // rectangle even if rich-base tiles fail to load (offline / blocked).
    {
      id: "countries-outline",
      type: "line",
      source: "countries",
      paint: {
        "line-color": richBase ? (dark ? "#4a5364" : "#9aa6b8") : landLine,
        "line-width": 0.7,
        "line-opacity": richBase ? 0.6 : 0.9,
      },
    },
    // Water on the offline base, above the land silhouette and its outline.
    ...water,
    {
      id: "trip-arcs",
      type: "line",
      source: "trip-arcs",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "mode"],
          "flight", "#2563eb",
          "train", "#16a34a",
          "bus", "#d97706",
          "ferry", "#0891b2",
          "car", "#7c3aed",
          "#64748b",
        ],
        "line-width": 1.8,
        "line-opacity": 0.75,
      },
    },
    // The whole gazetteer as a faint dot field (~135k points, loaded once) — you
    // can SEE every city/town in the world, at any zoom.
    {
      id: "cities-all",
      type: "circle",
      source: "cities-all",
      layout: { visibility: "none" }, // off by default; a small map toggle reveals it
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 4, 1.2, 8, 2.6],
        "circle-color": "#93a0b4",
        "circle-opacity": 0.35,
      },
    },
    // Every airport as a plain ✈ marker (one shared image), so you can SEE and
    // tap airports on the map — not only the ones you've logged. Hidden by
    // default; applyMode reveals it in Airports mode (and All at closer zoom).
    {
      id: "airports-all",
      type: "symbol",
      source: "airports-all",
      layout: {
        visibility: "none",
        "icon-image": "airport-all-dot",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 7, 0.85, 11, 1],
        "icon-padding": 0,
        "icon-allow-overlap": true,
      },
    },
    // Every station as a plain 🚉 marker (one shared image), so you can SEE and
    // tap stations on the map — not only the ones you've logged. Hidden by
    // default; applyMode reveals it in Stations mode (and All at closer zoom).
    {
      id: "stations-all",
      type: "symbol",
      source: "stations-all",
      layout: {
        visibility: "none",
        "icon-image": "station-all-dot",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 7, 0.85, 11, 1],
        "icon-padding": 0,
        "icon-allow-overlap": true,
      },
    },
    {
      id: "cities-inview",
      type: "circle",
      source: "cities-inview",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 8, 5.5],
        "circle-color": "#ffffff",
        "circle-stroke-color": "#7b8698",
        "circle-stroke-width": 1.4,
        "circle-opacity": 0.9,
      },
    },
    {
      // Want-list cities use the SAME marker system as visited (an amber-dot "want
      // to go" placeholder instead of the flag), so they're the same size,
      // collision-managed (overlapping markers auto-thin at low zoom) and
      // region-optimisable — never the old oversized always-on blob, but still
      // visually distinct so visiting "unlocks" the country flag.
      id: "cities-wishlist",
      type: "symbol",
      source: "wishlist",
      layout: {
        "icon-image": [
          "concat",
          "pill-",
          ["get", "cc"],
          "-",
          ["to-string", ["get", "fav"]],
          "-",
          ["to-string", ["get", "wish"]],
        ],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.9, 5, 1.1, 10, 1.35],
        "icon-padding": 1,
        "icon-allow-overlap": true,
        "symbol-sort-key": ["get", "sortKey"],
      },
    },
    // Monuments (UNESCO World Heritage): per-kind badges (🏛 cultural, 🌲 natural,
    // 🏞️ mixed), filled once seen. Kept smaller than city flags and scaled down at
    // low zoom so they no longer blanket the map in "All" mode.
    {
      id: "poi-monuments",
      type: "symbol",
      source: "monuments",
      layout: {
        "icon-image": ["concat", "mon-", ["get", "cat"], "-", ["to-string", ["get", "seen"]]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 7, 0.78, 11, 1],
        "icon-padding": 0,
        "icon-allow-overlap": true,
      },
    },
    {
      id: "cities-visited",
      type: "symbol",
      source: "cities",
      layout: {
        "icon-image": ["concat", "pill-", ["get", "cc"], "-", ["to-string", ["get", "fav"]], "-", ["to-string", ["get", "wish"]]],
        // Grow with zoom so markers stay obvious on big screens & close views.
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.9, 5, 1.1, 10, 1.35],
        "icon-padding": 1,
        // Your flags are ALWAYS drawn (overlap allowed) — never hidden by collision
        // or by browse monuments/airports — because seeing everywhere you've been
        // is the whole point. Density is managed by "Show one city per area"
        // (region-optimize), not by dropping flags. symbol-sort-key = -(population)
        // keeps the biggest city on top where they stack; favourites are pinned.
        // (Runtime-flipped by "Show every place at once": OFF re-enables thinning.)
        "icon-allow-overlap": true,
        "symbol-sort-key": ["get", "sortKey"],
      },
    },
    {
      id: "airports",
      type: "symbol",
      source: "airports",
      layout: {
        "icon-image": [
          "concat",
          "air-",
          ["get", "iata"],
          "-",
          ["to-string", ["get", "wish"]],
          "-",
          ["to-string", ["get", "fav"]],
        ],
        "icon-size": 1,
        "icon-padding": 1,
        "icon-allow-overlap": true,
      },
    },
    {
      id: "stations",
      type: "symbol",
      source: "stations",
      layout: {
        "icon-image": [
          "concat",
          "sta-",
          ["to-string", ["get", "wish"]],
          "-",
          ["to-string", ["get", "fav"]],
        ],
        "icon-size": 1,
        "icon-padding": 1,
        "icon-allow-overlap": true,
      },
    },
  ];
}

export function MapView({
  onBounds,
  focus,
  fit,
  cityFilter = [],
  minPop = 0,
  tripArcs,
  basemap = "simple",
  dark = false,
  globe = false,
  reducedMotion = false,
  mode = "all",
  showTowns = false,
  showCountries = false,
  maxMarkers = 250,
  optimizeMarkers = false,
  showAllMarkers = false,
  reduceMapWork = false,
  dateFilter = { mode: "all" },
  folder = "",
  onBaseUnavailable,
  onAddHere,
}: {
  /** Which marker categories are shown (a "mode" switcher over the map). */
  mode?: MapMode;
  /** Show the full-gazetteer dot field (every town on earth). Default off. */
  showTowns?: boolean;
  /** Shade the countries you've visited (coverage tint). Default off. */
  showCountries?: boolean;
  /** Cap on airport/monument markers drawn in the current view (anti-blanket). */
  maxMarkers?: number;
  /** "Optimize the map": collapse visited cities to one representative (the most
   *  populous) per area, keeping every custom point and favourite. Off = show all. */
  optimizeMarkers?: boolean;
  /** "Show every place at once": drop the collision de-cluttering on YOUR markers,
   *  so a zoomed-out map shows all your visited flags + want-list dots together. */
  showAllMarkers?: boolean;
  /** "Update markers only when the map stops" (slower phones): skip the live
   *  in-view recompute during a pan; the dots refresh once, on moveend. */
  reduceMapWork?: boolean;
  /** Date filter for YOUR places: any date, undated-only, or a precise [from,to]
   *  range (a year chip is just a whole-year range). Narrows the visited/wishlist
   *  /airport markers, the visited-country shading and the browsable-POI "seen"
   *  state to that window. */
  dateFilter?: MapDate;
  /** Folder filter for YOUR places: "" (all) or a folder name — narrows the
   *  personal markers and country shading to visits filed under that folder,
   *  and hides the browsable reference dots (they belong to no folder). */
  folder?: string;
  onBounds?: (b: Bounds) => void;
  focus?: MapFocus | null;
  fit?: MapFit | null;
  /** The in-view city dots follow the list's MULTI-SELECT status filter (any mix
   *  of visited / want-list / not-visited; empty = show all). The map recomputes
   *  the dot set straight off the live camera on every move, so it needs the
   *  filter here rather than a pre-filtered list. */
  cityFilter?: readonly FilterStatus[];
  /** Only draw in-view browse cities with at least this many people (0 = off).
   *  Shares the value with the list so map dots and the list stay in lock-step. */
  minPop?: number;
  tripArcs?: FeatureCollection<LineString> | null;
  basemap?: Basemap;
  dark?: boolean;
  globe?: boolean;
  /** Honour the user's reduced-motion preference for fly/fit camera moves. */
  reducedMotion?: boolean;
  /** Called once when the online (OSM) base can't load its tiles, so the caller
   *  can fall back to the always-available offline base. */
  onBaseUnavailable?: () => void;
  /** Right-click / long-press a blank spot on the map → add your own place there
   *  (the caller opens the add form seeded with these coordinates). */
  onAddHere?: (c: { lon: number; lat: number }) => void;
}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const gazGen = useGazetteerGeneration();
  // The map does NOT subscribe to `visits` for rendering — it repaints the
  // visited flags imperatively from a store subscription (see the map-init
  // effect), so a mark-visited paints the flag the instant the store changes,
  // synchronously, WITHOUT waiting for MapScreen's React re-render to commit.
  // That is what makes tapping a place feel instant on a phone.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const visitsRef = useRef(useVisits.getState().visits);
  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;
  const cityFilterRef = useRef(cityFilter);
  cityFilterRef.current = cityFilter;
  const minPopRef = useRef(minPop);
  minPopRef.current = minPop;
  const tripArcsRef = useRef(tripArcs);
  tripArcsRef.current = tripArcs;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onBaseUnavailableRef = useRef(onBaseUnavailable);
  onBaseUnavailableRef.current = onBaseUnavailable;
  const onAddHereRef = useRef(onAddHere);
  onAddHereRef.current = onAddHere;
  // True while a programmatic camera move is in flight — its moveend must NOT
  // refresh the cities list (the list only follows the user's own map moves).
  const suppressBoundsRef = useRef(false);
  const showTownsRef = useRef(showTowns);
  showTownsRef.current = showTowns;
  const showCountriesRef = useRef(showCountries);
  showCountriesRef.current = showCountries;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const maxMarkersRef = useRef(maxMarkers);
  maxMarkersRef.current = maxMarkers;
  const optimizeMarkersRef = useRef(optimizeMarkers);
  optimizeMarkersRef.current = optimizeMarkers;
  const showAllRef = useRef(showAllMarkers);
  showAllRef.current = showAllMarkers;
  const reduceMapWorkRef = useRef(reduceMapWork);
  reduceMapWorkRef.current = reduceMapWork;
  // The active date + folder filter for YOUR places. Read from refs so the
  // imperative painters use the latest value without re-subscribing.
  const dateRef = useRef(dateFilter);
  dateRef.current = dateFilter;
  const folderRef = useRef(folder);
  folderRef.current = folder;
  // One place decides whether a visit passes the current date AND folder filter —
  // used by every painter that draws YOUR records (flags, wishes, country tint,
  // the "seen" state of browsable monuments/airports).
  const visitMatches = (v: Visit): boolean =>
    mapDateMatches(v.date, dateRef.current) &&
    (!folderRef.current || v.folder === folderRef.current);
  const [failed, setFailed] = useState(false);
  const [dataState, setDataState] = useState<"loading" | "ready" | "error">("loading");

  function emitBounds(map: MlMap) {
    const b = map.getBounds();
    onBoundsRef.current?.({
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
      zoom: map.getZoom(),
    });
  }

  // Which gazetteer generation the cities-all dot field was built at; -1 =
  // never. Building it means allocating one Point per city (~135k once the
  // full gazetteer lands) and serializing the collection to MapLibre's worker
  // — far too expensive to pay while the layer is hidden.
  const dotsGenRef = useRef(-1);
  function applyAllCityDots(map: MlMap) {
    // The Towns toggle is off by default: don't build the dot field until it
    // can actually be seen (first toggle-on), and never rebuild one that is
    // already current. A field built at an older generation is refreshed
    // lazily by the next toggle-on rather than while hidden.
    const gen = gazetteerGeneration();
    if (!showTownsRef.current || dotsGenRef.current === gen) return;
    const src = map.getSource("cities-all") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: ref.allCities().map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: {},
      })),
    });
    dotsGenRef.current = gen;
  }

  // Airports & monuments are drawn like cities: only what's in the current view,
  // capped to a maximum so a dense area never blankets the map. Ones you've
  // marked are kept first, so the cap never hides your own places.
  function inViewport(b: maplibregl.LngLatBounds, lat: number, lon: number): boolean {
    if (lat < b.getSouth() || lat > b.getNorth()) return false;
    const w = b.getWest();
    const e = b.getEast();
    return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
  }

  // Whether each capped POI source was last set to EMPTY — a branch that is
  // hidden (wrong mode, or below its "all"-mode zoom gate) must not re-post an
  // empty collection to the worker on every camera stop.
  const monEmptyRef = useRef(false);
  const airEmptyRef = useRef(false);
  const staEmptyRef = useRef(false);

  function applyViewportPoi(map: MlMap) {
    const b = map.getBounds();
    const cap = Math.max(1, maxMarkersRef.current);
    const m = modeRef.current;
    const z = map.getZoom();

    // Monuments: in Monuments mode always, in All mode past applyMode's zoom
    // gate — below it the layer renders nothing, so skip the whole rebuild.
    const monSrc = map.getSource("monuments") as GeoJSONSource | undefined;
    if (monSrc) {
      if (m === "monuments" || (m === "all" && z >= 4.5)) {
        const seen = new Set(
          visitsRef.current
            .filter(
              (v) =>
                v.status !== "wishlist" &&
                v.place.kind === "heritage" &&
                visitMatches(v),
            )
            .map((v) => v.place.id),
        );
        // Seen-first via a single stable partition (no full sort), so the cap
        // never hides a place you've marked.
        const all = ref.allHeritage();
        const seenFirst: typeof all = [];
        const rest: typeof all = [];
        for (const h of all) {
          if ((h.lat === 0 && h.lon === 0) || !inViewport(b, h.lat, h.lon)) continue;
          (seen.has(h.id) ? seenFirst : rest).push(h);
        }
        const inView = seenFirst.concat(rest);
        monSrc.setData({
          type: "FeatureCollection",
          features: inView.slice(0, cap).map((h) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [h.lon, h.lat] },
            properties: {
              id: h.id,
              name: h.name,
              cc: h.countryIso2,
              cat: h.category ?? "cultural",
              seen: seen.has(h.id) ? 1 : 0,
            },
          })),
        });
        monEmptyRef.current = false;
      } else if (!monEmptyRef.current) {
        monSrc.setData(EMPTY_FC);
        monEmptyRef.current = true;
      }
    }

    // Browsable airports: in Airports mode always, in All mode past the zoom-gate.
    const airSrc = map.getSource("airports-all") as GeoJSONSource | undefined;
    if (airSrc) {
      if (m === "airports" || (m === "all" && z >= 5)) {
        const seen = new Set(
          visitsRef.current
            .filter(
              (v) =>
                v.status !== "wishlist" &&
                v.place.kind === "airport" &&
                visitMatches(v),
            )
            .map((v) => v.place.id),
        );
        const all = ref.allAirports();
        const seenFirst: typeof all = [];
        const rest: typeof all = [];
        for (const a of all) {
          if (!inViewport(b, a.lat, a.lon)) continue;
          (seen.has(a.id) ? seenFirst : rest).push(a);
        }
        const inView = seenFirst.concat(rest);
        airSrc.setData({
          type: "FeatureCollection",
          features: inView.slice(0, cap).map((a) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [a.lon, a.lat] },
            properties: { id: a.id, iata: a.id, name: a.name, cc: a.countryIso2 },
          })),
        });
        airEmptyRef.current = false;
      } else if (!airEmptyRef.current) {
        airSrc.setData(EMPTY_FC);
        airEmptyRef.current = true;
      }
    }

    // Browsable stations: in Stations mode always, in All mode past the zoom-gate.
    const staSrc = map.getSource("stations-all") as GeoJSONSource | undefined;
    if (staSrc) {
      if (m === "stations" || (m === "all" && z >= 5)) {
        const seen = new Set(
          visitsRef.current
            .filter(
              (v) =>
                v.status !== "wishlist" &&
                v.place.kind === "station" &&
                visitMatches(v),
            )
            .map((v) => v.place.id),
        );
        const all = ref.allStations();
        const seenFirst: typeof all = [];
        const rest: typeof all = [];
        for (const s of all) {
          if (!inViewport(b, s.lat, s.lon)) continue;
          (seen.has(s.id) ? seenFirst : rest).push(s);
        }
        const inView = seenFirst.concat(rest);
        staSrc.setData({
          type: "FeatureCollection",
          features: inView.slice(0, cap).map((s) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            properties: { id: s.id, name: s.name, cc: s.countryIso2 },
          })),
        });
        staEmptyRef.current = false;
      } else if (!staEmptyRef.current) {
        staSrc.setData(EMPTY_FC);
        staEmptyRef.current = true;
      }
    }
  }

  // Change-keys for the expensive layers: rebuilding the viewport POI pipeline
  // (a scan over every airport + monument) and the country fill on EVERY visit
  // change made a simple city remove feel sluggish — they now refresh only
  // when the state they actually draw has changed.
  // Sentinel start values: the FIRST applyVisited must always draw both.
  const lastPoiKey = useRef("<init>");
  const lastCountryKey = useRef("<init>");
  // Same guard for the three personal marker sources: their builders read only
  // kind/id/status/favorite, so a note, photo, caption or date edit must not
  // re-tile (worker message + re-index + repaint) three GeoJSON sources — the
  // map stays mounted for the app's life and would pay that even while hidden.
  // Reset to the sentinel when the full gazetteer lands (gazGen effect below)
  // so markers whose cities only resolve in the full set get re-drawn.
  const lastCitiesKey = useRef("<init>");
  const lastWishKey = useRef("<init>");
  const lastAirKey = useRef("<init>");
  const lastStaKey = useRef("<init>");
  function applyVisited(map: MlMap) {
    // The date filter narrows YOUR places to the selected period BEFORE building
    // any source, so the same one selection drives the markers, the country
    // shading and (via the keys below) which of them are worth re-tiling. The
    // reference dot fields (cities-all etc.) never see this — only your records.
    const vis = visitsRef.current.filter((v) => visitMatches(v));
    const markerKey = (v: Visit) =>
      `${v.place.kind}:${v.place.id}:${v.status}:${v.favorite ? 1 : 0}`;
    // "Show one city per area" is ZOOM-AWARE: coarse (one flag per country) when
    // zoomed out, finer (per subdivision) closer in, every flag once you're close.
    // The granularity is folded into the key so a zoom that changes the bucket
    // rebuilds the source; toggling the setting does too. `undefined` = setting
    // off (show all); a null granularity = on but zoomed in enough to show all.
    const gran = optimizeMarkersRef.current ? optimizeGranularity(map.getZoom()) : undefined;
    const optTag = optimizeMarkersRef.current ? `opt:${gran ?? "all"}|` : "all|";
    const citiesKey =
      optTag +
      vis
        .filter(
          (v) => v.status !== "wishlist" && (v.place.kind === "city" || v.place.kind === "custom"),
        )
        .map(markerKey)
        .sort()
        .join("|");
    if (citiesKey !== lastCitiesKey.current) {
      lastCitiesKey.current = citiesKey;
      const base = visitedCityPoints(vis, ref);
      const fc = gran ? optimizeVisitedPoints(base, gran) : base;
      (map.getSource("cities") as GeoJSONSource | undefined)?.setData(fc);
      // Warm the flag images up front — a later zoom-out must not have to fetch
      // any visited flag's image before it can paint (the "load in late" bug).
      ensurePillImages(map, fc);
    }
    const wishKey =
      optTag +
      vis
        .filter((v) => v.status === "wishlist" && v.place.kind === "city")
        .map(markerKey)
        .sort()
        .join("|");
    if (wishKey !== lastWishKey.current) {
      lastWishKey.current = wishKey;
      // Want-list cities get the SAME zoom-aware region optimisation as visited.
      const wbase = wishlistCityPoints(vis, ref);
      const wfc = gran ? optimizeVisitedPoints(wbase, gran) : wbase;
      (map.getSource("wishlist") as GeoJSONSource | undefined)?.setData(wfc);
      ensurePillImages(map, wfc);
    }
    const airKey = vis
      .filter((v) => v.place.kind === "airport")
      .map(markerKey)
      .sort()
      .join("|");
    if (airKey !== lastAirKey.current) {
      lastAirKey.current = airKey;
      const fc = airportPoints(vis, ref);
      (map.getSource("airports") as GeoJSONSource | undefined)?.setData(fc);
      ensureAirImages(map, fc);
    }
    const staKey = vis
      .filter((v) => v.place.kind === "station")
      .map(markerKey)
      .sort()
      .join("|");
    if (staKey !== lastStaKey.current) {
      lastStaKey.current = staKey;
      const fc = stationPoints(vis, ref);
      (map.getSource("stations") as GeoJSONSource | undefined)?.setData(fc);
      ensureStationImages(map, fc);
    }
    // Monuments (and browsable airports/stations) are viewport-capped and depend
    // on visits only through their heritage/airport/station "seen" state —
    // period-filtered too, so applyViewportPoi (which reads yearRef) rebuilds
    // when it changes.
    const poiKey = vis
      .filter(
        (v) =>
          v.place.kind === "heritage" || v.place.kind === "airport" || v.place.kind === "station",
      )
      .map((v) => `${v.place.kind}:${v.place.id}:${v.status}`)
      .sort()
      .join("|");
    if (poiKey !== lastPoiKey.current) {
      lastPoiKey.current = poiKey;
      applyViewportPoi(map);
    }
    const countryKey = [...visitedCountryIds(vis)].sort().join(",");
    if (countryKey !== lastCountryKey.current) {
      lastCountryKey.current = countryKey;
      applyCountryFill(map);
    }
  }

  // Shade the countries you've visited: set the fill layer's filter to their
  // numeric ISO codes (which join to the geometry). Airports and neutral "ZZ"
  // points don't count a country, matching the stats and passport. Honours the
  // active period so shading only marks countries with a qualifying visit.
  //
  // Setting this filter re-buckets the detailed Natural Earth 50m country
  // polygons on the tiler — a ~0.5s main-thread long task on a phone. The tint
  // is HIDDEN by default (the "My countries" toggle), so skip the re-filter while
  // it isn't shown: marking a city visited must not pay to recolour an invisible
  // layer. The toggle-on effect passes `force` to paint it when it becomes visible.
  function applyCountryFill(map: MlMap, force = false) {
    if (!map.getLayer("countries-visited-fill")) return;
    if (!force && !showCountriesRef.current) return;
    const vis = visitsRef.current.filter((v) => visitMatches(v));
    const nums: string[] = [];
    for (const iso2 of visitedCountryIds(vis)) {
      const num = ref.countryByIso2(iso2)?.numeric;
      if (num) nums.push(num);
    }
    map.setFilter("countries-visited-fill", [
      "in",
      ["get", "numeric"],
      ["literal", nums],
    ] as FilterSpecification);
  }

  function applyMode(map: MlMap, m: MapMode) {
    for (const [cat, ids] of Object.entries(MODE_LAYERS)) {
      const on = m === "all" || m === cat;
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      }
    }
    // In "All" mode monuments only appear from country-level zoom — at world
    // zoom they blanketed whole continents. Monuments mode shows them always.
    if (map.getLayer("poi-monuments")) {
      map.setLayerZoomRange("poi-monuments", m === "monuments" ? 0 : 4.5, 24);
    }
    // Browsable airports: always in Airports mode; in All mode only once you've
    // zoomed into a region, so ~7,000 planes don't blanket the world view.
    if (map.getLayer("airports-all")) {
      const on = m === "airports" || m === "all";
      map.setLayoutProperty("airports-all", "visibility", on ? "visible" : "none");
      map.setLayerZoomRange("airports-all", m === "airports" ? 0 : 5, 24);
    }
    // Browsable stations follow the same rule as airports: always in Stations
    // mode; in All mode only once zoomed into a region.
    if (map.getLayer("stations-all")) {
      const on = m === "stations" || m === "all";
      map.setLayoutProperty("stations-all", "visibility", on ? "visible" : "none");
      map.setLayerZoomRange("stations-all", m === "stations" ? 0 : 5, 24);
    }
    // The full-gazetteer dot field is a power view — hidden unless toggled on,
    // and never shown in the monuments/airports modes.
    if (map.getLayer("cities-all")) {
      const on = showTownsRef.current && (m === "all" || m === "cities");
      map.setLayoutProperty("cities-all", "visibility", on ? "visible" : "none");
    }
  }

  // "Show every place at once": drop the collision de-cluttering on YOUR personal
  // markers so a zoomed-out map shows every visited flag + want-list dot together,
  // instead of thinning overlapping ones. Off = the readable collision-managed
  // default. Runtime-toggled, so it flips live without rebuilding the style.
  function applyMarkerOverlap(map: MlMap) {
    const all = showAllRef.current;
    for (const id of ["cities-visited", "cities-wishlist"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "icon-allow-overlap", all);
    }
  }

  // The status filter prunes YOUR personal city markers so the MAP matches the
  // LIST: the flags/dots you see are exactly the statuses you asked for. Composed
  // with the mode gate — city markers exist only in All/Cities modes — and always
  // re-applied after applyMode (which blanket-reveals both layers). MULTI-SELECT,
  // via statusShows (empty or all three = show all):
  //   visited flags show when the selection includes "visited" (or is empty).
  //   want-list dots show when it includes "wishlist" (or is empty).
  //   focused only on "unvisited" → neither shows (just the browse-discovery
  //   dots remain), so "Not visited" really hides the cities you've been to.
  function applyPersonalMarkerFilter(map: MlMap) {
    const modeAllowsCities = modeRef.current === "all" || modeRef.current === "cities";
    const statuses = cityFilterRef.current;
    const showVisited = modeAllowsCities && statusShows(statuses, "visited");
    const showWish = modeAllowsCities && statusShows(statuses, "wishlist");
    // The population filter drops YOUR sub-threshold city flags too, so the map
    // stays in lock-step with the list. Custom pins carry the population you typed
    // (0 if none), so a 0-people custom place is filtered like any small city.
    const minPop = minPopRef.current;
    const popFilter = (
      minPop > 0 ? [">=", ["get", "pop"], minPop] : null
    ) as maplibregl.FilterSpecification | null;
    if (map.getLayer("cities-visited")) {
      map.setLayoutProperty("cities-visited", "visibility", showVisited ? "visible" : "none");
      map.setFilter("cities-visited", popFilter);
    }
    if (map.getLayer("cities-wishlist")) {
      map.setLayoutProperty("cities-wishlist", "visibility", showWish ? "visible" : "none");
      map.setFilter("cities-wishlist", popFilter);
    }
  }

  // The in-view city dots, recomputed straight off the LIVE camera. Driven by
  // the map's own move/moveend (and the filter/period/gazetteer effects) rather
  // than a React `viewCities` prop, so on a zoom-OUT the dots repaint promptly
  // and completely on the FIRST try instead of trailing a bounds→snapshot→prop
  // round-trip. Same population-cap + filter as the list, via a shared pure
  // helper, so the dots and the list stay in lock-step.
  function applyInViewCities(map: MlMap) {
    const src = map.getSource("cities-inview") as GeoJSONSource | undefined;
    // Filtering to a folder hides the browsable reference dots — those are cities
    // you could visit, not the ones in your folder, so they'd only be noise.
    if (folderRef.current) {
      src?.setData(EMPTY_FC);
      return;
    }
    const b = map.getBounds();
    const bounds: Bounds = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    const statuses = cityFilterRef.current;
    // Every city with a personal record (visited OR want-list) in the active
    // period is drawn as its own always-on marker, so exclude it from the browse
    // dots: the cap then spends its whole budget on cities you haven't marked and
    // never wipes them out to re-draw ones you've already been to.
    const personalIds = new Set(
      visitsRef.current
        .filter((v) => v.place.kind === "city" && visitMatches(v))
        .map((v) => v.place.id),
    );
    const cities = markerCitiesInView(
      ref.allCities(),
      bounds,
      maxMarkersRef.current,
      statuses,
      personalIds,
      minPopRef.current,
    );
    (map.getSource("cities-inview") as GeoJSONSource | undefined)?.setData(inViewPoints(cities));
  }

  function applyTripArcs(map: MlMap) {
    (map.getSource("trip-arcs") as GeoJSONSource | undefined)?.setData(tripArcsRef.current ?? EMPTY_FC);
  }

  function applyTheme(map: MlMap, isDark: boolean) {
    const { ocean, land, landLine } = themeColors(isDark);
    if (map.getLayer("background")) map.setPaintProperty("background", "background-color", ocean);
    if (map.getLayer("osm-bg")) map.setPaintProperty("osm-bg", "background-color", ocean);
    // Raster tiles can't be recoloured, but they CAN be dimmed & desaturated so
    // the online map stops glowing daylight-white inside the dark UI.
    if (map.getLayer("osm")) {
      map.setPaintProperty("osm", "raster-saturation", isDark ? -0.55 : 0);
      map.setPaintProperty("osm", "raster-brightness-max", isDark ? 0.6 : 1);
      map.setPaintProperty("osm", "raster-contrast", isDark ? 0.1 : 0);
    }
    if (basemap === "simple" && map.getLayer("countries-base")) {
      map.setPaintProperty("countries-base", "fill-color", land);
      map.setPaintProperty("countries-base", "fill-outline-color", landLine);
    }
    if (map.getLayer("countries-visited-fill")) {
      map.setPaintProperty("countries-visited-fill", "fill-color", isDark ? "#1f7a4d" : "#34d399");
      map.setPaintProperty("countries-visited-fill", "fill-opacity", isDark ? 0.34 : 0.28);
    }
  }

  // Load (or retry) the country geometry into the already-running map.
  function loadGeometry(map: MlMap, force = false) {
    setDataState("loading");
    void getCountries(force).then((fc) => {
      if (!mapRef.current || map !== mapRef.current) return;
      if (fc) {
        (map.getSource("countries") as GeoJSONSource | undefined)?.setData(fc);
        setDataState("ready");
      } else {
        setDataState("error");
      }
    });
  }

  // Lakes & rivers for the OFFLINE overview only — the rich online bases draw
  // their own water, so this never runs (and never fetches) for them. Both go
  // through the module-memoised getters, so a basemap toggle back to the offline
  // base re-reads them from the resolved promise instead of re-fetching/parsing.
  function loadPhysicalWater(map: MlMap) {
    if (basemap !== "simple") return;
    for (const [get, id] of [
      [getLakes, "lakes"],
      [getRivers, "rivers"],
    ] as const) {
      void get().then((fc) => {
        if (fc && mapRef.current === map) {
          (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
        }
      });
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: MlMap | null = null;
    // Torn down in cleanup (below): the online self-heal listener for the OSM base.
    let removeOsmHeal: (() => void) | null = null;
    ensurePmtilesProtocol();
    // Prime the country-geometry fetch NOW (idempotent, memoised) so its
    // download + parse overlaps style resolution and WebGL init, instead of only
    // starting at the map "load" event — the offline base is this land shape, so
    // an earlier fetch means a filled map sooner.
    void getCountries();

    (async () => {
      const pack =
        basemap === "osm" ? "osm-raster" : basemap === "detail" ? "world-detail" : "world-overview";
      const { style: baseStyle, attribution } = await bundledMapSource.resolveStyle(pack);
      if (cancelled || !containerRef.current) return;

      // Build the COMPLETE style up front — base + overlay sources + overlay
      // layers + projection — so the map is never a blank canvas waiting on an
      // async setStyle. Overlay sources start empty and are filled on load.
      const fullStyle: StyleSpecification = {
        ...baseStyle,
        projection: { type: globe ? "globe" : "mercator" },
        sources: {
          ...baseStyle.sources,
          // tolerance 0: never simplify the country polygons — per-zoom
          // simplification of the huge Arctic multipolygons produces degenerate
          // triangles that render as ghostly land-coloured streaks over the ocean.
          countries: { type: "geojson", data: EMPTY_FC, attribution, tolerance: 0 },
          lakes: { type: "geojson", data: EMPTY_FC },
          rivers: { type: "geojson", data: EMPTY_FC },
          "cities-all": { type: "geojson", data: EMPTY_FC },
          "airports-all": { type: "geojson", data: EMPTY_FC },
          "stations-all": { type: "geojson", data: EMPTY_FC },
          "trip-arcs": { type: "geojson", data: EMPTY_FC },
          "cities-inview": { type: "geojson", data: EMPTY_FC },
          wishlist: { type: "geojson", data: EMPTY_FC },
          monuments: { type: "geojson", data: EMPTY_FC },
          cities: { type: "geojson", data: EMPTY_FC },
          airports: { type: "geojson", data: EMPTY_FC },
          stations: { type: "geojson", data: EMPTY_FC },
        },
        layers: [...baseStyle.layers, ...overlayLayers(basemap, dark)],
      };

      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          // Attribution goes bottom-LEFT (added below), not the default bottom-right
          // where it sat under the Filter/Layers pills and got covered by them.
          attributionControl: false,
          center: lastCamera?.center ?? [6, 32],
          zoom: lastCamera?.zoom ?? 1.1,
          style: fullStyle,
          // No cross-zoom collision fade: flags/dots pop in and out instantly as
          // you zoom instead of ghosting through a 300 ms opacity fade, which read
          // as flicker on the personal markers.
          fadeDuration: 0,
          // Default cache is viewport-derived (~60 tiles on a phone) → panning
          // back re-flashes blanks as evicted tiles refetch. Hold more so a
          // pan-away/pan-back repaints instantly (memory cost is modest).
          maxTileCacheSize: 512,
        });
      } catch {
        setFailed(true);
        // No map will report a view, so hand the list the whole world: the
        // fallback below promises the cities list still works.
        onBoundsRef.current?.({ west: -180, south: -90, east: 180, north: 90 });
        return;
      }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // "Locate me": a device-sensor button (no network, no telemetry) that asks
      // for geolocation permission on tap and recentres the map on you, showing a
      // live position dot. Local-only — it never leaves the device, so it fits the
      // privacy model, and it degrades gracefully if permission is denied.
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
          showAccuracyCircle: true,
          // Stop at city scale — the default flies all the way to street level,
          // which is more zoom than you want just to see where you are.
          fitBoundsOptions: { maxZoom: 11 },
        }),
        "top-right",
      );
      // OSM/ODbL + Natural Earth credit, bottom-LEFT so it clears the Filter and
      // Layers pills in the bottom-right (they were literally covering the ⓘ).
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

      // Marker images, generated lazily on demand.
      map.on("styleimagemissing", (e) => {
        if (!map || map.hasImage(e.id)) return;
        if (e.id.startsWith("pill-")) {
          const [, cc, fav, wish] = e.id.split("-");
          map.addImage(e.id, makeCityPill(cc ?? "", fav === "1", wish === "1"), { pixelRatio: 2 });
        } else if (e.id.startsWith("mon-")) {
          const [, cat, seen] = e.id.split("-");
          map.addImage(e.id, makeMonumentPin(cat ?? "cultural", seen === "1"), { pixelRatio: 2 });
        } else if (e.id === "airport-all-dot") {
          map.addImage(e.id, makeAirportDot(), { pixelRatio: 2 });
        } else if (e.id.startsWith("air-")) {
          const [, iata, wish, fav] = e.id.split("-");
          map.addImage(e.id, makeAirportPin(iata ?? "", wish === "1", fav === "1"), {
            pixelRatio: 2,
          });
        } else if (e.id === "station-all-dot") {
          map.addImage(e.id, makeStationDot(), { pixelRatio: 2 });
        } else if (e.id.startsWith("sta-")) {
          const [, wish, fav] = e.id.split("-");
          map.addImage(e.id, makeStationPin(wish === "1", fav === "1"), { pixelRatio: 2 });
        }
      });

      map.on("load", () => {
        if (cancelled || !map) return;
        loadedRef.current = true;
        // MapLibre ignores its first resize observation, so a panel that changed
        // size while the map booted would keep the boot-time canvas without this.
        const canvas = map.getCanvas();
        const box = map.getContainer();
        if (canvas.clientWidth !== box.clientWidth || canvas.clientHeight !== box.clientHeight)
          map.resize();
        applyTheme(map, dark);
        applyVisited(map);
        if (map.getLayer("countries-visited-fill")) {
          map.setLayoutProperty(
            "countries-visited-fill",
            "visibility",
            showCountriesRef.current ? "visible" : "none",
          );
        }
        applyInViewCities(map);
        applyTripArcs(map);
        loadGeometry(map);
        loadPhysicalWater(map);
        applyMode(map, mode);
        applyPersonalMarkerFilter(map);
        applyMarkerOverlap(map); // honour "show every place at once" from the start
        // The full-gazetteer dot field: built only if the Towns toggle is
        // already on (applyAllCityDots self-gates — it's off by default, so
        // most sessions never pay for it), and even then at idle — YOUR flags
        // and wishlist markers paint first, the town dots can wait a beat.
        const idle: (cb: () => void) => void =
          typeof requestIdleCallback === "function"
            ? (cb) => requestIdleCallback(cb, { timeout: 1500 })
            : (cb) => void setTimeout(cb, 300);
        idle(() => {
          if (!cancelled && map && loadedRef.current) applyAllCityDots(map);
        });
        emitBounds(map);
      });

      // The in-view LIST is React state, so re-partitioning it on every 150 ms pan
      // tick re-renders the whole map screen twice per tick — the felt mobile lag.
      // The live MAP dots stay live (imperative, in the `move` handler below); the
      // list re-partitions on a short TRAILING debounce — when the pan pauses or
      // ends — so a drag/fling no longer drives React state per tick.
      let boundsDebounce: ReturnType<typeof setTimeout> | undefined;
      const cancelBoundsDebounce = () => {
        if (boundsDebounce) {
          clearTimeout(boundsDebounce);
          boundsDebounce = undefined;
        }
      };
      const scheduleBoundsEmit = () => {
        cancelBoundsDebounce();
        boundsDebounce = setTimeout(() => {
          boundsDebounce = undefined;
          if (map && loadedRef.current && !suppressBoundsRef.current) emitBounds(map);
        }, 180);
      };

      map.on("moveend", () => {
        if (!map) return;
        lastCamera = { center: map.getCenter(), zoom: map.getZoom() };
        if (!loadedRef.current) return;
        // The in-view POI cap AND the in-view city dots follow every camera move
        // (even programmatic flies) — recomputed here off the final camera so a
        // zoom-out paints every newly-revealed marker at once, on the first try,
        // without waiting on a React render.
        applyViewportPoi(map);
        applyInViewCities(map);
        // Zoom-aware "one city per area": rebuild your flags when the zoom crosses
        // a granularity bucket (key-guarded, so a same-bucket pan is a no-op).
        if (optimizeMarkersRef.current) applyVisited(map);
        const wasProgrammatic = suppressBoundsRef.current;
        if (wasProgrammatic) {
          suppressBoundsRef.current = false; // programmatic fly — keep the list still
        } else {
          cancelBoundsDebounce(); // this final, exact frame supersedes any pending emit
          emitBounds(map);
        }
        // Warm the ring of tiles JUST OUTSIDE the view so the next pan reveals
        // ready tiles (online OSM base only). Only for real gestures — a
        // programmatic fly already point-prefetches its destination — and only
        // once the visible tiles are in, at idle, so the ring never competes
        // with the tiles actually on screen.
        if (basemap === "osm" && !wasProgrammatic) {
          const warm = () => {
            if (!map || !map.areTilesLoaded()) return;
            const b = map.getBounds();
            prefetchAroundBounds(
              { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
              map.getZoom(),
            );
          };
          if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 2000 });
          else setTimeout(warm, 400);
        }
      });
      // The list AND the in-view dots follow the map LIVE while panning/zooming
      // (throttled — the in-view set is capped, so each refresh is cheap); the
      // moveend above still lands the final, exact frame.
      let lastLiveBounds = 0;
      map.on("move", () => {
        if (!map || !loadedRef.current || suppressBoundsRef.current) return;
        // Low-power mode: don't recompute the in-view set every pan frame — the
        // moveend handler refreshes the dots + list once the map settles. This is
        // the single biggest per-frame cost on a slow phone.
        if (reduceMapWorkRef.current) return;
        const now = performance.now();
        if (now - lastLiveBounds < 150) return;
        lastLiveBounds = now;
        applyInViewCities(map); // live map dots stay live (imperative, cheap)
        scheduleBoundsEmit(); // the React list re-partitions when the pan settles
      });
      // Any real user gesture re-enables list refreshes immediately.
      for (const ev of ["dragstart", "wheel", "dblclick"] as const) {
        map.on(ev, () => {
          suppressBoundsRef.current = false;
        });
      }

      // Online (OSM) base resilience. Two failure modes to handle WITHOUT nuking
      // the map: (a) a few transient tile errors on a flaky link must NOT
      // permanently downgrade to the bland offline base; (b) a tile that errors
      // while it's on screen leaves a grey hole MapLibre never re-requests on its
      // own. So: only fall back on *consecutive* errors with no success in
      // between (reset on any good tile), and re-issue the tiles when connection
      // returns or shortly after an error, backfilling the holes from cache.
      if (basemap === "osm") {
        let osmErrors = 0;
        let fellBack = false;
        let healTimer: ReturnType<typeof setTimeout> | undefined;
        const reloadOsm = () => {
          const src = map?.getSource("osm") as maplibregl.RasterTileSource | undefined;
          // setTiles re-requests only the tiles it lacks; loaded / SW-cached ones
          // serve from cache, so this is a cheap way to fill on-screen holes.
          src?.setTiles([OSM_TILE_TEMPLATE]);
        };
        const healSoon = () => {
          if (healTimer) return;
          healTimer = setTimeout(() => {
            healTimer = undefined;
            if (!cancelled && map && loadedRef.current) reloadOsm();
          }, 4000);
        };
        const onOnline = () => {
          osmErrors = 0;
          fellBack = false;
          if (!cancelled && map && loadedRef.current) reloadOsm();
        };
        window.addEventListener("online", onOnline);
        removeOsmHeal = () => {
          window.removeEventListener("online", onOnline);
          if (healTimer) clearTimeout(healTimer);
        };
        // Any successful OSM tile clears the strike count — only a genuine run of
        // failures (offline / blocked) should ever trip the fallback.
        map.on("data", (e) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ev = e as any;
          if (ev?.sourceId === "osm" && ev?.tile) osmErrors = 0;
        });
        map.on("error", (e) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((e as any)?.sourceId !== "osm") return;
          osmErrors++;
          // Genuinely offline, or a sustained run of failures → fall back once.
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          if (!fellBack && (offline || osmErrors >= 6)) {
            fellBack = true;
            onBaseUnavailableRef.current?.();
          } else if (!fellBack) {
            healSoon(); // transient — try to backfill the on-screen holes
          }
        });
      }

      // Right-click (desktop) or long-press (touch) a blank spot → offer to add
      // your own place there. A tiny popup confirms first, so an accidental
      // press does nothing; the button only lifts the coordinate to the caller,
      // which opens the add form (the map never authors a place itself).
      const openAddHerePopup = (lngLat: maplibregl.LngLat) => {
        if (!map || !onAddHereRef.current) return;
        const el = document.createElement("div");
        el.className = "map-popup map-addhere";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mini-btn";
        btn.textContent = "＋ Add a place here";
        el.appendChild(btn);
        const pop = new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "220px" })
          .setLngLat(lngLat)
          .setDOMContent(el)
          .addTo(map);
        btn.onclick = () => {
          onAddHereRef.current?.({ lon: lngLat.lng, lat: lngLat.lat });
          pop.remove();
        };
      };
      map.on("contextmenu", (e) => {
        if (!loadedRef.current) return;
        openAddHerePopup(e.lngLat);
      });
      // Touch long-press: a single stationary finger held ~550ms with no drag.
      let pressTimer: ReturnType<typeof setTimeout> | undefined;
      const clearPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = undefined;
        }
      };
      map.on("touchstart", (e) => {
        if (e.points.length !== 1) return clearPress();
        const at = e.lngLat;
        clearPress();
        pressTimer = setTimeout(() => {
          if (!cancelled && map && loadedRef.current) openAddHerePopup(at);
        }, 550);
      });
      map.on("touchend", clearPress);
      map.on("touchmove", clearPress);
      map.on("dragstart", clearPress);

      // Tap any place marker → ONE popup (a single dispatcher across all
      // tappable layers — per-layer handlers would fire together when a city
      // and a monument overlap under the tap). Cities outrank monuments;
      // among cities the most populous wins.
      const tappable = [
        "cities-visited",
        "cities-inview",
        "cities-wishlist",
        "poi-monuments",
        "airports-all",
        "stations-all",
      ];
      map.on("click", (e) => {
        if (!map || !loadedRef.current) return;
        const m = map; // narrow once — closures below can't re-null it
        const layers = tappable.filter((l) => m.getLayer(l));
        if (!layers.length) return;
        // A fingertip, not a pixel: query a padded box around the tap so the
        // small markers (the white city dots especially) are easy to hit.
        const coarse =
          typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
        const pad = coarse ? 20 : 8;
        const feats = m.queryRenderedFeatures(
          [
            [e.point.x - pad, e.point.y - pad],
            [e.point.x + pad, e.point.y + pad],
          ],
          { layers },
        );
        if (!feats.length) return;
        // Nearest marker to the finger wins; among near-ties (the fingertip
        // blur) cities outrank airports outrank monuments, and among cities
        // the most populous wins.
        const score = (f: maplibregl.MapGeoJSONFeature) =>
          f.layer.id === "poi-monuments"
            ? -1
            : f.layer.id === "airports-all" || f.layer.id === "stations-all"
              ? -0.5
              : Number(f.properties?.pop ?? 0);
        const dist = (f: maplibregl.MapGeoJSONFeature) => {
          if (f.geometry.type !== "Point") return 0;
          const [lon, lat] = f.geometry.coordinates as [number, number];
          const pt = m.project([lon, lat]);
          return Math.hypot(pt.x - e.point.x, pt.y - e.point.y);
        };
        const withD = feats.map((f) => ({ f, d: dist(f) }));
        const dMin = Math.min(...withD.map((x) => x.d));
        const near = withD.filter((x) => x.d <= dMin + 8).map((x) => x.f);
        const f = near.reduce((best, cur) => (score(cur) > score(best) ? cur : best));
        // Anchor everything on the MARKER, not the (possibly offset) tap point.
        const anchor =
          f.geometry.type === "Point"
            ? new maplibregl.LngLat(
                (f.geometry.coordinates as [number, number])[0],
                (f.geometry.coordinates as [number, number])[1],
              )
            : e.lngLat;
        const p = f.properties ?? {};
        const isMonument = f.layer.id === "poi-monuments";
        const isAirport = f.layer.id === "airports-all";
        const isStation = f.layer.id === "stations-all";
        const isCustom = Number(p.custom) === 1;
        const kind = isMonument
          ? "heritage"
          : isAirport
            ? "airport"
            : isStation
              ? "station"
              : isCustom
                ? "custom"
                : "city";
        const region = p.region ? String(p.region) : "";
        const popN = Number(p.pop);
        const iata = String(p.iata ?? "");
        const country = ref.countryByIso2(String(p.cc ?? ""))?.name ?? String(p.cc ?? "");
        const sub = isMonument
          ? `Site · ${country}`
          : isAirport
            ? `✈ ${iata} airport · ${country}`
            : isStation
              ? `🚉 Station · ${country}`
              : [country, region].filter(Boolean).join(" - ") +
                (popN > 0 ? ` · ${formatInt(popN)} people` : "");
        // Airports are stored with the code in the name (matching the list/search),
        // so toggling from the map records the same place. Stations store the bare
        // name (no code), so it passes through unchanged.
        const displayName = isAirport && iata ? `${String(p.name ?? "")} (${iata})` : String(p.name ?? "");
        openPlacePopup(map, anchor, {
          name: displayName,
          sub,
          place: {
            kind,
            id: String(p.id ?? ""),
            name: displayName,
            countryId: String(p.cc ?? ""),
          } as PlaceRef,
          hasPage: kind === "city" || kind === "heritage" || kind === "airport" || kind === "station",
        },
        // A little preview photo for cities & monuments, but only when the online
        // basemap is active (offline / Offline mode uses "simple" — no network).
        basemap !== "simple" && (kind === "city" || kind === "heritage"));
        suppressBoundsRef.current = true;
        const tapZoom = Math.max(map.getZoom(), 6.5);
        if (basemap === "osm") prefetchAroundPoint(anchor.lng, anchor.lat, tapZoom);
        map.easeTo({
          center: anchor,
          zoom: tapZoom,
          // Seat the marker only as low as the viewport needs so the card (which
          // always opens above it) isn't clipped — 0 on a tall desktop map (just
          // centre the place), a downward nudge only on a short phone map.
          offset: [0, cardSeatOffsetY(map)],
          duration: reducedRef.current ? 0 : 550,
        });
      });
      map.on("mousemove", (e) => {
        if (!map || !loadedRef.current) return;
        const m = map;
        const layers = tappable.filter((l) => m.getLayer(l));
        const hit = layers.length ? m.queryRenderedFeatures(e.point, { layers }).length > 0 : false;
        m.getCanvas().style.cursor = hit ? "pointer" : "";
      });
    })();

    // Repaint the visited flags straight off the store — synchronously, the
    // moment a visit is added/removed — so the flag lands without waiting for
    // any React render. applyVisited is fully key-guarded, so an unrelated
    // change (a note, a trip) is a cheap no-op.
    const unsub = useVisits.subscribe((state) => {
      visitsRef.current = state.visits;
      const m = mapRef.current;
      if (m && loadedRef.current) applyVisited(m);
    });

    return () => {
      cancelled = true;
      loadedRef.current = false;
      // A pending bounds-emit debounce (declared in the map-init scope) self-guards
      // on loadedRef.current, now false, so it fires once harmlessly — nothing to
      // clear here.
      unsub();
      removeOsmHeal?.();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The background full-gazetteer upgrade landed after the map was built:
  // rebuild the city dot field (only if the Towns toggle has it visible), and
  // re-resolve visited/wishlist markers whose cities only exist in the full
  // set (e.g. restored visits to small towns).
  useEffect(() => {
    if (gazGen === 0) return;
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyAllCityDots(map);
    // The marker keys can't see a gazetteer swap (same visits, new cities) —
    // reset them so applyVisited re-resolves markers against the full set.
    lastCitiesKey.current = "<init>";
    lastWishKey.current = "<init>";
    lastAirKey.current = "<init>";
    applyVisited(map);
    applyInViewCities(map); // the full set changes which cities fall in view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazGen]);

  // The list filter (all / hide-visited / visited) and the population threshold
  // both narrow the in-view dots too.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) {
      applyInViewCities(map);
      applyPersonalMarkerFilter(map); // show/hide your flags vs ⚑ wishes to match
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityFilter, minPop]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) applyTripArcs(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripArcs]);

  // A new date period changes which of YOUR places qualify. The change-keys are
  // derived from the (now period-filtered) visits, but reset them to the
  // sentinel so every personal source is guaranteed to rebuild, then repaint the
  // markers, the country shading and the viewport-capped POI for the new period.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    lastCitiesKey.current = "<init>";
    lastWishKey.current = "<init>";
    lastAirKey.current = "<init>";
    lastPoiKey.current = "<init>";
    lastCountryKey.current = "<init>";
    applyVisited(map);
    applyViewportPoi(map);
    applyInViewCities(map); // the period/folder re-partitions visited vs unvisited dots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, folder]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) applyTheme(map, dark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyMode(map, mode);
    applyPersonalMarkerFilter(map); // applyMode blanket-reveals cities — re-prune
    applyAllCityDots(map); // build the towns dot field on toggle-on (no-op otherwise)
    applyViewportPoi(map); // repopulate/clear the capped POI for the new mode/cap
    applyInViewCities(map); // a new marker cap changes how many dots the view holds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showTowns, maxMarkers]);

  // Toggling "show one city per area" rebuilds the visited-city source: the
  // optimize flag is part of applyVisited's cities key, so this just re-runs it
  // (only the cities branch actually re-tiles; the others keep their keys).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyVisited(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimizeMarkers]);

  // "Show every place at once" flips the collision de-cluttering on your markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyMarkerOverlap(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAllMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer("countries-visited-fill")) return;
    map.setLayoutProperty(
      "countries-visited-fill",
      "visibility",
      showCountries ? "visible" : "none",
    );
    // Paint the tint the moment it's turned on — applyCountryFill is skipped
    // while hidden, so the filter may be stale from visits added in the meantime.
    if (showCountries) {
      lastCountryKey.current = "<init>";
      applyCountryFill(map, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCountries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    // MapLibre morphs globe↔flat on its own. A clean setProjection avoids the
    // canvas-snapshot overlay we used before, which could leave stale, torn
    // frames on some GPUs (it needed preserveDrawingBuffer, now removed).
    map.setProjection({ type: globe ? "globe" : "mercator" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globe]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    suppressBoundsRef.current = true; // programmatic — the list must not move
    // A list tap should clearly ZOOM to the city (was a barely-perceptible 4.5
    // floor); city scale, never past the current zoom.
    const targetZoom = Math.max(map.getZoom(), 6.5);
    // Fetch the destination's tiles DURING the flight — arriving somewhere far
    // used to mean watching its tiles pop in one by one.
    if (basemap === "osm") prefetchAroundPoint(focus.lon, focus.lat, targetZoom);
    // easeTo, not flyTo: fly's zoom-out-then-in arc reads as a jarring
    // "dezoom/rezoom" when hopping between nearby places (Lyon → its airport).
    const dur = reducedRef.current ? 0 : 650;
    map.easeTo({
      center: [focus.lon, focus.lat],
      zoom: targetZoom,
      // When a preview card will open above the marker, seat it low enough to
      // clear the top edge but no further — 0 on a tall desktop map (matches the
      // marker-tap behaviour), a downward nudge only where the card wouldn't fit.
      offset: focus.popup ? [0, cardSeatOffsetY(map)] : [0, 0],
      duration: dur,
    });
    // Open the card IMMEDIATELY (anchored to the place's coordinates) and let the
    // map ease beneath it — the popup stays pinned to the marker and rides along
    // with the move. Tapping a list row shows the card at once, exactly like
    // tapping the dot, instead of waiting for the camera to finish settling.
    const pop = focus.popup;
    if (pop && loadedRef.current) openPlacePopup(map, [focus.lon, focus.lat], pop, pop.showImage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit) return;
    suppressBoundsRef.current = true; // programmatic — the list must not move
    const instant = fit.instant || reducedRef.current;
    map.fitBounds(fit.bounds, {
      padding: 48,
      maxZoom: 6,
      duration: instant ? 0 : 700,
      animate: !instant,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key]);

  if (failed) {
    return (
      <div className="map-fallback">
        <p className="muted">
          The map couldn’t start (WebGL may be unavailable here). Your visits, the cities list, and
          statistics still work.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-label={t("map.canvasAria")}
      />
      {dataState !== "ready" && (
        <div className="map-status" role="status">
          {dataState === "loading" ? (
            <span className="muted small">{t("map.loading")}</span>
          ) : (
            <span className="small">
              {t("map.dataFailed")}{" "}
              <button
                type="button"
                className="link"
                onClick={() => mapRef.current && loadGeometry(mapRef.current, true)}
              >
                {t("common.retry")}
              </button>
            </span>
          )}
        </div>
      )}
    </>
  );
}

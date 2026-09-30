import { create } from "zustand";
import { DEFAULT_SCOPE, type CountryScope } from "../reference/scope";
import { detectLocale, applyLangAttr, isLocale, type Locale } from "../i18n/core";
import { setFormatLocale } from "../format/format";
import {
  loadStationSource,
  saveStationSource,
  stationSourceById,
  type StationSourceId,
} from "../reference/stationSources";
import { setStationData } from "../reference/referenceData";
import type { Station } from "../reference/types";

// Lasting, cross-screen preferences (persisted to localStorage): the "what
// counts as a country" scope (honoured by stats, the map's counter strip and the
// country checklist), and whether place guides fetch their overview automatically
// when online.
const SCOPE_KEY = "postcards-country-scope";
const AUTO_GUIDES_KEY = "postcards-auto-guides";
const ONLINE_MAP_KEY = "postcards-online-map";
const MAX_MARKERS_KEY = "postcards-max-markers";
const OPTIMIZE_MARKERS_KEY = "postcards-optimize-markers";
const SHOW_ALL_MARKERS_KEY = "postcards-show-all-markers";
const REDUCE_MAP_WORK_KEY = "postcards-reduce-map-work";
const THEME_KEY = "postcards-theme";
const LOCALE_KEY = "postcards-locale";
const AUTO_SYNC_KEY = "postcards-auto-sync";
const OFFLINE_MODE_KEY = "postcards-offline-mode";

// Explicit colour theme. "system" follows the device (prefers-color-scheme);
// "light"/"dark" force a palette. The choice is applied by toggling a data-theme
// attribute on <html> (see applyThemeAttr + styles.css); the same key is read by
// a tiny inline script in index.html to avoid a flash of the wrong palette.
export type ThemeMode = "system" | "light" | "dark";

// How many airport / monument markers to draw at most in the current view, so a
// dense area doesn't blanket the map. Clamped to a sane range.
// `Infinity` = "Unlimited" (no cap). The cap thins only NON-visited markers now
// (visited + favourites are always kept), so a modest default stays readable
// without hiding your own places.
export const MARKER_CAP_CHOICES = [25, 50, 100, 200, 400, Infinity] as const;
// Default 100 everywhere: the mobile perf work (debounced list, cheaper viewport
// scan) made 100 smooth on a phone, and the cap no longer touches your visited
// markers — so a fuller map is safe. Settings offers more (up to Unlimited).
function defaultMaxMarkers(): number {
  return 100;
}

// localStorage is unavailable in private mode / restricted contexts; reads fall
// back to null and writes are silently swallowed (settings just don't persist).
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: not persisted */
  }
}

function loadMaxMarkers(): number {
  const n = Number(readLocal(MAX_MARKERS_KEY));
  return (MARKER_CAP_CHOICES as readonly number[]).includes(n) ? n : defaultMaxMarkers();
}

// "Show one city per area" — collapse visited cities to the most-populous one per
// area (country + subdivision), keeping every custom point and favourite. OFF by
// default (show every visited city); a deliberate opt-in for travellers whose
// dense maps lag. Only a stored "1" turns it on.
function loadOptimizeMarkers(): boolean {
  return readLocal(OPTIMIZE_MARKERS_KEY) === "1";
}
// "Show every place at once": your visited flags + want-list dots are NEVER
// hidden by the map's collision de-cluttering (nor by browse monuments/airports)
// — the whole point of the app is seeing everywhere you've been. ON by default;
// turn it OFF (stored "0") to let dense clusters thin themselves at low zoom.
function loadShowAllMarkers(): boolean {
  return readLocal(SHOW_ALL_MARKERS_KEY) !== "0";
}
// "Update markers only when the map stops": on a slower phone the browse (not-
// visited) city dots recomputing live on every pan frame is the felt lag. Turning
// this on drops the live recompute and only refreshes them once the map settles
// (moveend), so panning stays smooth. Opt-in; a stored "1" turns it on.
function loadReduceMapWork(): boolean {
  return readLocal(REDUCE_MAP_WORK_KEY) === "1";
}

function loadScope(): CountryScope {
  const v = readLocal(SCOPE_KEY);
  return v === "un" || v === "all" ? v : DEFAULT_SCOPE;
}

function loadTheme(): ThemeMode {
  const v = readLocal(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

// UI language. A saved choice wins; otherwise follow the device language when it
// is one Postcards ships (fr/ko), else English (see detectLocale).
function loadLocale(): Locale {
  const v = readLocal(LOCALE_KEY);
  return isLocale(v) ? v : detectLocale();
}

// Mirror the theme's applyThemeAttr: reflect the language onto <html lang> for
// assistive tech, and thread it into the Intl formatters (numbers/dates/percent).
export function applyLocale(locale: Locale): void {
  applyLangAttr(locale);
  setFormatLocale(locale);
}

// Drive the palette by toggling <html data-theme>. "system" removes the
// attribute (CSS then follows prefers-color-scheme); "light"/"dark" force it.
// Guarded so it's safe under SSR / non-DOM test environments.
export function applyThemeAttr(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

// Default OFF (Constitution: data leaves the device only on explicit action).
// Opening one of your own places must not silently phone Wikimedia and reveal
// which place you're viewing; the overview loads on the existing "Load overview"
// tap. Turn this on to have it load automatically when online. Only "1" enables.
function loadAutoGuides(): boolean {
  return readLocal(AUTO_GUIDES_KEY) === "1";
}

// Default OFF (Constitution: data leaves the device only on explicit action).
// On first run the map is the bundled offline vector basemap — zero outbound
// requests. Streaming detailed tiles from OpenStreetMap (which discloses your IP
// and the area you're looking at) waits for a deliberate opt-in: the one-tap
// "Show detailed map" consent on the map, or this toggle in Settings. Only "1"
// enables, so a fresh install never reaches the network for a tile.
function loadOnlineMap(): boolean {
  return readLocal(ONLINE_MAP_KEY) === "1";
}

// Device sync (spec 013): auto-sync is OFF by default. It stays off until the user
// flips it on — that one opt-in IS the explicit consent for the app to reach the
// configured git remote in the background (Constitution: data leaves the device
// only on explicit user action). Only a stored "1" enables it.
function loadAutoSync(): boolean {
  return readLocal(AUTO_SYNC_KEY) === "1";
}

// The master "self-contained" switch. When on, Postcards makes NO optional
// outbound request whatever the individual toggles say: the map stays on the
// bundled offline basemap, place guides never auto-fetch, and the first-run
// "Show detailed map" offer is withheld. It's a hard override enforced at every
// egress site (see effectiveBasemap, the guides hook, the consent banner) — the
// one guarantee a privacy-first user can set and forget. Default OFF so the
// existing opt-in flows are unchanged; only a stored "1" turns it on.
function loadOfflineMode(): boolean {
  return readLocal(OFFLINE_MODE_KEY) === "1";
}

interface SettingsState {
  countryScope: CountryScope;
  setCountryScope: (scope: CountryScope) => void;
  autoLoadGuides: boolean;
  setAutoLoadGuides: (value: boolean) => void;
  onlineMap: boolean;
  setOnlineMap: (value: boolean) => void;
  autoSync: boolean;
  setAutoSync: (value: boolean) => void;
  offlineMode: boolean;
  setOfflineMode: (value: boolean) => void;
  maxMarkers: number;
  setMaxMarkers: (value: number) => void;
  optimizeMarkers: boolean;
  setOptimizeMarkers: (value: boolean) => void;
  showAllMarkers: boolean;
  setShowAllMarkers: (value: boolean) => void;
  reduceMapWork: boolean;
  setReduceMapWork: (value: boolean) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Which railway-station dataset is loaded (Settings → "Railway stations"). */
  stationSource: StationSourceId;
  setStationSource: (id: StationSourceId) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  countryScope: loadScope(),
  setCountryScope: (countryScope) => {
    writeLocal(SCOPE_KEY, countryScope);
    set({ countryScope });
  },
  autoLoadGuides: loadAutoGuides(),
  setAutoLoadGuides: (autoLoadGuides) => {
    writeLocal(AUTO_GUIDES_KEY, autoLoadGuides ? "1" : "0");
    set({ autoLoadGuides });
  },
  onlineMap: loadOnlineMap(),
  setOnlineMap: (onlineMap) => {
    writeLocal(ONLINE_MAP_KEY, onlineMap ? "1" : "0");
    set({ onlineMap });
  },
  autoSync: loadAutoSync(),
  setAutoSync: (autoSync) => {
    writeLocal(AUTO_SYNC_KEY, autoSync ? "1" : "0");
    set({ autoSync });
  },
  offlineMode: loadOfflineMode(),
  setOfflineMode: (offlineMode) => {
    writeLocal(OFFLINE_MODE_KEY, offlineMode ? "1" : "0");
    set({ offlineMode });
  },
  maxMarkers: loadMaxMarkers(),
  setMaxMarkers: (maxMarkers) => {
    writeLocal(MAX_MARKERS_KEY, String(maxMarkers));
    set({ maxMarkers });
  },
  optimizeMarkers: loadOptimizeMarkers(),
  setOptimizeMarkers: (optimizeMarkers) => {
    writeLocal(OPTIMIZE_MARKERS_KEY, optimizeMarkers ? "1" : "0");
    set({ optimizeMarkers });
  },
  showAllMarkers: loadShowAllMarkers(),
  setShowAllMarkers: (showAllMarkers) => {
    writeLocal(SHOW_ALL_MARKERS_KEY, showAllMarkers ? "1" : "0");
    set({ showAllMarkers });
  },
  reduceMapWork: loadReduceMapWork(),
  setReduceMapWork: (reduceMapWork) => {
    writeLocal(REDUCE_MAP_WORK_KEY, reduceMapWork ? "1" : "0");
    set({ reduceMapWork });
  },
  theme: loadTheme(),
  setTheme: (theme) => {
    writeLocal(THEME_KEY, theme);
    applyThemeAttr(theme);
    set({ theme });
  },
  locale: loadLocale(),
  setLocale: (locale) => {
    writeLocal(LOCALE_KEY, locale);
    applyLocale(locale);
    set({ locale });
  },
  stationSource: loadStationSource(),
  setStationSource: (stationSource) => {
    saveStationSource(stationSource);
    set({ stationSource });
    // Apply live: fetch the chosen dataset (or clear for "None") and refresh the
    // map/search/stats via setStationData — no reload needed.
    const def = stationSourceById(stationSource);
    if (!def.url) {
      setStationData([]);
      return;
    }
    void fetch(def.url)
      .then((r) => (r.ok ? r.json() : { stations: [] }))
      .then((json: { stations?: Station[] }) => setStationData(json?.stations ?? []))
      .catch(() => {
        /* offline / fetch failed: keep whatever set is currently loaded */
      });
  },
}));

// Apply the saved theme once at module load, so the palette matches the stored
// choice even on the app's very first render (the index.html inline script
// already handles the pre-paint case for explicit light/dark).
applyThemeAttr(loadTheme());

// Likewise apply the saved (or device-detected) language on load, so <html lang>
// and the Intl formatters match the chosen locale from the very first render.
applyLocale(loadLocale());

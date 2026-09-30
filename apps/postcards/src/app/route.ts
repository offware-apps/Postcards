import type { Tab } from "../lib/store/useUi";

// The screen in the address bar, so a reload lands where you were and a link
// opens that screen: `#/places`, `#/map/city/2988507`, `#/stats/country/FR`.
// Hash-based because static hosts (GitHub Pages, the native wrap) serve only
// the one index.html. The home screen (the map, no page) is the bare address,
// and so is any fragment that names no screen. The trip composer is an
// unsaved form, so it stays out.

export interface Route {
  tab: Tab;
  cityPageId: string | null;
  countryPageId: string | null;
}

const TABS: readonly Tab[] = ["map", "places", "trips", "journal", "stats", "settings"];

export const HOME: Route = { tab: "map", cityPageId: null, countryPageId: null };

/** The hash naming a screen; "" for home. */
export function routeHash(r: Route): string {
  if (r.tab === "map" && !r.cityPageId && !r.countryPageId) return "";
  const page = r.cityPageId
    ? `/city/${encodeURIComponent(r.cityPageId)}`
    : r.countryPageId
      ? `/country/${r.countryPageId}`
      : "";
  return `#/${r.tab}${page}`;
}

/** The route a hash names, or null for an empty or unknown one. */
export function parseRoute(hash: string): Route | null {
  const [tab, kind, id, ...rest] = hash.replace(/^#\/?/, "").split("/");
  if (!TABS.includes(tab as Tab) || rest.length) return null;
  const route: Route = { tab: tab as Tab, cityPageId: null, countryPageId: null };
  if (kind === undefined) return route;
  if (kind === "city" && id) {
    try {
      return { ...route, cityPageId: decodeURIComponent(id) };
    } catch {
      return null;
    }
  }
  if (kind === "country" && id && /^[A-Z]{2}$/.test(id)) return { ...route, countryPageId: id };
  return null;
}

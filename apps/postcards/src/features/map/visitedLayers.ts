import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { PlaceRef, TravelMode, Trip, Visit } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { coordsOf } from "../travel/distance";

function isVisited(v: Visit): boolean {
  return v.status !== "wishlist";
}

// Collision priority (lower symbol-sort-key wins when the map de-clutters
// overlapping flags). Cities rank by -population so the biggest is kept; this
// bias drops favourites and your own custom pins BELOW every browse city so they
// are never the one thinned out — your marks always stay on the map.
const PINNED = 1_000_000_000;

/**
 * Point features for visited cities. Each carries what the flag marker needs
 * (country code, favourite flag, collision sort key) plus the details shown in
 * the tap popup (exact population and region name) — the population is
 * deliberately NOT rendered on the marker, only revealed on tap.
 */
export function visitedCityPoints(visits: Visit[], ref: ReferenceData): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const v of visits) {
    if (!isVisited(v)) continue;
    // User-authored custom points carry their own coordinates on the record.
    if (v.place.kind === "custom") {
      if (v.place.lat == null || v.place.lon == null) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.place.lon, v.place.lat] },
        properties: {
          id: v.place.id,
          name: v.place.name,
          cc: v.place.countryId,
          // The population the user typed for this pin (0 if none) — so the map's
          // population filter treats a 0-people custom place as 0, like the list.
          pop: v.place.population ?? 0,
          region: "",
          custom: 1,
          fav: v.favorite ? 1 : 0,
          wish: 0,
          sortKey: -PINNED, // your own place — always kept
        },
      });
      continue;
    }
    if (v.place.kind !== "city") continue;
    const city = ref.cityById(v.place.id);
    if (!city) continue;
    const region = city.subdivisionId ? ref.subdivisionById(city.subdivisionId)?.name ?? "" : "";
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [city.lon, city.lat] },
      properties: {
        id: city.id,
        name: city.name,
        cc: city.countryIso2,
        pop: city.population ?? 0,
        region,
        custom: 0,
        fav: v.favorite ? 1 : 0,
        wish: 0,
        // Favourites are pinned below every non-favourite; within each group the
        // most-populous city is kept when flags collide.
        sortKey: (v.favorite ? -PINNED : 0) - (city.population ?? 0),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * "Optimize the map" reduction for the visited-city markers (Settings → Map →
 * "Show one city per area"). A traveller with hundreds of visited cities makes a
 * dense country an unreadable, laggy pile of flags; this keeps just one
 * representative per area so the map stays fast and legible, without deleting any
 * data — turning the toggle off restores every flag.
 *
 * Rules, in order:
 * - **Custom points and favourites are always kept** — they are explicit personal
 *   marks; collapsing one away would hide a place the user deliberately flagged
 *   (matches the marker-cap rule "your own places are never hidden").
 * - Among the remaining real cities, keep only the **most-populous** one in each
 *   area. `granularity` sets how big an "area" is, so the map can be ZOOM-AWARE:
 *   `"country"` (one flag per country) when zoomed out, `"area"` (country +
 *   subdivision) when closer. Zoom in further and the caller skips this entirely
 *   to show every flag — "the more you zoom, the more of your cities appear."
 *
 * Pure over the FeatureCollection built by {@link visitedCityPoints}, so it reads
 * only the `cc` / `region` / `pop` / `custom` / `fav` properties set there.
 */
export function optimizeVisitedPoints(
  fc: FeatureCollection<Point>,
  granularity: "country" | "area" = "area",
): FeatureCollection<Point> {
  const kept: Feature<Point>[] = [];
  // area key -> index into `kept` of the current biggest city representing it.
  const repForArea = new Map<string, number>();
  const popOf = (f: Feature<Point>): number => {
    const p = f.properties?.pop;
    return typeof p === "number" ? p : 0;
  };
  for (const f of fc.features) {
    const p = f.properties ?? {};
    if (p.custom === 1 || p.fav === 1) {
      kept.push(f); // always shown — never collapsed into an area
      continue;
    }
    const area =
      granularity === "country" ? `${p.cc ?? ""}` : `${p.cc ?? ""}::${p.region ?? ""}`;
    const at = repForArea.get(area);
    if (at === undefined) {
      repForArea.set(area, kept.length);
      kept.push(f);
    } else if (popOf(f) > popOf(kept[at]!)) {
      kept[at] = f; // a bigger city takes over as this area's representative
    }
  }
  return { type: "FeatureCollection", features: kept };
}

/**
 * Point features for wish-to-go cities. Identical property shape to
 * {@link visitedCityPoints} (`wish: 1` is the only difference) so want-list
 * cities render as the SAME compact flag pill as visited — just a "want to go"
 * treatment — and flow through the exact same region optimisation
 * ({@link optimizeVisitedPoints}) and flag-collision de-cluttering. Favourites
 * are pinned and carry their star, matching visited.
 */
export function wishlistCityPoints(visits: Visit[], ref: ReferenceData): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const v of visits) {
    if (v.status !== "wishlist" || v.place.kind !== "city") continue;
    const city = ref.cityById(v.place.id);
    if (!city) continue;
    const region = city.subdivisionId ? ref.subdivisionById(city.subdivisionId)?.name ?? "" : "";
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [city.lon, city.lat] },
      properties: {
        id: city.id,
        name: city.name,
        cc: city.countryIso2,
        pop: city.population ?? 0,
        region,
        custom: 0,
        fav: v.favorite ? 1 : 0,
        wish: 1,
        sortKey: (v.favorite ? -PINNED : 0) - (city.population ?? 0),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function toXYZ(lon: number, lat: number): [number, number, number] {
  const la = lat * D2R;
  const lo = lon * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/**
 * Points along the great circle between two lon/lat, densified so the route
 * curves correctly in the map projection (a straight LineString would render as
 * a projection-straight chord, not the real path). Longitudes are unwrapped so
 * a route crossing the antimeridian doesn't streak across the map.
 */
function greatCircle(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  n = 48,
): [number, number][] {
  const A = toXYZ(a.lon, a.lat);
  const B = toXYZ(b.lon, b.lat);
  const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [[a.lon, a.lat], [b.lon, b.lat]];
  const sin = Math.sin(omega);
  const pts: [number, number][] = [];
  let prev: number | null = null;
  let off = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * omega) / sin;
    const s2 = Math.sin(t * omega) / sin;
    const x = A[0] * s1 + B[0] * s2;
    const y = A[1] * s1 + B[1] * s2;
    const z = A[2] * s1 + B[2] * s2;
    const lat = Math.asin(Math.max(-1, Math.min(1, z))) * R2D;
    let lon = Math.atan2(y, x) * R2D;
    if (prev !== null) {
      while (lon + off - prev > 180) off -= 360;
      while (lon + off - prev < -180) off += 360;
    }
    lon += off;
    pts.push([lon, lat]);
    prev = lon;
  }
  return pts;
}

/**
 * Great-circle arcs for logged trips, tagged with the travel mode so the map can
 * colour them. A MULTI-STOP trip (spec 019) draws one arc per consecutive leg, so
 * the line traces the actual route (Paris → Tokyo → Osaka), not a single endpoint
 * shortcut; a single-leg trip draws its one `from → to` arc. Any leg touching a
 * coordinate-less stop (e.g. a whole country) is skipped — nothing invented.
 */
export function tripArcs(trips: Trip[], ref: ReferenceData): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (const t of trips) {
    const chain = t.stops && t.stops.length >= 2 ? t.stops : [t.from, t.to];
    features.push(...stopsArcs(chain, ref, t.mode, t.legModes).features);
  }
  return { type: "FeatureCollection", features };
}

/**
 * Great-circle arcs for an ORDERED chain of stops (spec 019) — one arc per
 * consecutive resolvable leg, each tagged with ITS transport so the map can colour
 * a mixed-mode journey correctly (leg i uses `legModes[i]`, else the trip default
 * `mode`). Powers the live route drawn while reconstructing a journey. A leg
 * touching a coordinate-less stop is skipped — nothing invented (FR-013); fewer
 * than two stops → an empty collection. Takes raw stops, NOT a Trip.
 */
export function stopsArcs(
  stops: PlaceRef[],
  ref: ReferenceData,
  mode: TravelMode,
  legModes?: TravelMode[],
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = coordsOf(stops[i]!, ref);
    const to = coordsOf(stops[i + 1]!, ref);
    if (!from || !to) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: greatCircle(from, to) },
      properties: { mode: legModes?.[i] ?? mode },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Point features for logged airports, carrying the IATA code label, a favorite
 * flag, and whether it's a wish (want to fly through) vs visited — the marker
 * canvas colors itself accordingly. Kept separate from city pills so a plane
 * marker never looks like a city.
 */
export function airportPoints(visits: Visit[], ref: ReferenceData): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const v of visits) {
    if (v.place.kind !== "airport") continue;
    const airport = ref.airportById(v.place.id);
    if (!airport) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
      properties: {
        iata: airport.id,
        wish: v.status === "wishlist" ? 1 : 0,
        fav: v.favorite ? 1 : 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Point features for logged railway stations. A station has no short code (unlike
 * an airport's IATA), so its pin is an emoji chip tinted by been/wish/fav — the
 * name is revealed on tap via the browsable `stations-all` layer beneath it, which
 * carries the id/name/country. Kept separate from airports so a 🚉 never reads as
 * a plane.
 */
export function stationPoints(visits: Visit[], ref: ReferenceData): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const v of visits) {
    if (v.place.kind !== "station") continue;
    const station = ref.stationById(v.place.id);
    if (!station) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [station.lon, station.lat] },
      properties: {
        wish: v.status === "wishlist" ? 1 : 0,
        fav: v.favorite ? 1 : 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

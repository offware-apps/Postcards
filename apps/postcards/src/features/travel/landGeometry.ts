import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import { unwrapAntimeridian } from "../map/antimeridian";

// Bundled, offline land geometry for the route map, the coverage map and the
// passport poster — the SAME public Natural Earth asset the main map uses (public
// domain, SW-precached), fetched as a plain URL so it comes from cache with zero
// extra network. Parsed at most once per session; a failed load clears its slot
// so a later attempt can retry.
// Kept independent of MapView so the route map can't perturb the production map.

const LAND_URL = `${import.meta.env.BASE_URL}basemap/countries-50m.json`;

let landPromise: Promise<FeatureCollection | null> | null = null;

export function getLand(): Promise<FeatureCollection | null> {
  if (!landPromise) {
    landPromise = (async () => {
      try {
        const res = await fetch(LAND_URL);
        if (!res.ok) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const topo: any = await res.json();
        return unwrapAntimeridian(
          feature(topo, topo.objects.countries) as unknown as FeatureCollection<Polygon | MultiPolygon>,
        );
      } catch {
        return null;
      }
    })().then((fc) => {
      if (!fc) landPromise = null; // allow a retry after an offline first-run miss
      return fc;
    });
  }
  return landPromise;
}

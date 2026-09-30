import type { FeatureCollection, Point } from "geojson";
import type { PlaceRef } from "../../lib/schema/models";
import { placeKey } from "../../lib/schema/helpers";
import type { MyPlace } from "./myPlaces";

// The tap-to-add pins for the composer's real map: ONE point per place you've
// been (the pool), each carrying its stable key, its kind (city vs airport vs …
// for colouring) and its 1-based position in the current route (`seq`, 0 when
// it isn't a stop yet — drives the "already added" ring). Pure & testable; the
// map layer reads only these props, so it never needs a PlaceRef.

export function pickPointsFC(pool: MyPlace[], stops: PlaceRef[]): FeatureCollection<Point> {
  const seqByKey = new Map<string, number>();
  stops.forEach((s, i) => {
    const k = placeKey(s);
    // First occurrence wins the label (a round trip revisits a stop; show its
    // first number rather than overwriting with the later one).
    if (!seqByKey.has(k)) seqByKey.set(k, i + 1);
  });
  return {
    type: "FeatureCollection",
    features: pool.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        key: p.key,
        kind: p.place.kind,
        seq: seqByKey.get(p.key) ?? 0,
        added: seqByKey.has(p.key),
        name: p.name,
        // Population (0 for non-cities) so a tap can snap to the most populous
        // pin in an overlapping cluster.
        pop: p.population,
      },
    })),
  };
}

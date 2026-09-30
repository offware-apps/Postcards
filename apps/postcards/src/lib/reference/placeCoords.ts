import { getReferenceData } from "./referenceData";
import type { PlaceRef } from "../schema/models";

/**
 * Stamp lat/lon onto a reference place (city / airport / heritage) from the
 * loaded gazetteer, so the record can be placed on a map WITHOUT the gazetteer
 * later. This matters because the bundled gazetteer is only the top-10k cities:
 * a published site (self-contained, no gazetteer) or a device that never
 * downloaded the full set can't resolve a smaller place by id — so its pin
 * silently vanished from the exported map. Stamping the coordinate at creation
 * time, when the place was just picked from the in-memory gazetteer, keeps the
 * record self-locating (and the portable file self-contained — Constitution).
 *
 * A no-op when coords are already present (custom places carry their own), the
 * kind has no single coordinate (countries), or the place can't be resolved.
 * Never overwrites an existing coordinate.
 */
export function stampPlaceCoords(place: PlaceRef): PlaceRef {
  if (typeof place.lat === "number" && typeof place.lon === "number") return place;
  const ref = getReferenceData();
  let c: { lat: number; lon: number } | null = null;
  if (place.kind === "city") {
    const x = ref.cityById(place.id);
    if (x) c = { lat: x.lat, lon: x.lon };
  } else if (place.kind === "airport") {
    const x = ref.airportById(place.id);
    if (x) c = { lat: x.lat, lon: x.lon };
  } else if (place.kind === "station") {
    const x = ref.stationById(place.id);
    if (x) c = { lat: x.lat, lon: x.lon };
  } else if (place.kind === "heritage") {
    const x = ref.heritageById(place.id);
    // Some heritage sites carry no coordinate in the source (stored as 0,0).
    if (x && (x.lat !== 0 || x.lon !== 0)) c = { lat: x.lat, lon: x.lon };
  }
  return c ? { ...place, lat: c.lat, lon: c.lon } : place;
}

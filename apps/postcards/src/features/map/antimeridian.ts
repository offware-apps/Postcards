import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

// world-atlas stores rings in spherical coordinates: a ring crossing the
// antimeridian jumps from +180 to -180 between two vertices, and Antarctica's
// coast wraps the whole globe around the pole. MapLibre draws them on a plane,
// so that jump becomes an edge spanning the whole map and a visited Russia or
// Fiji paints a horizontal band across it. Each ring is therefore unwrapped
// into continuous longitudes and closed through the pole when it circles one —
// once, when the geometry loads. The rings are not cut at ±180: MapLibre wraps
// a shape running past the edge into the next world copy itself, where a cut
// would be drawn as a border line down the 180th meridian.

type Ring = Position[];

/** Continuous longitudes: every jump of more than 180° is taken the short way. */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let off = 0;
  let prev: number | null = null;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      while (lon! + off - prev > 180) off -= 360;
      while (lon! + off - prev < -180) off += 360;
    }
    prev = lon! + off;
    out.push([prev, lat!]);
  }
  return out;
}

function area(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return s / 2;
}

/** A ring around a pole ends 360° from where it started: close it along the
 *  pole's latitude so it encloses the cap instead of a sliver. */
function closePole(ring: Ring): Ring {
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (Math.abs(last[0]! - first[0]!) <= 180) return ring;
  const poleLat = ring.reduce((s, p) => s + p[1]!, 0) < 0 ? -90 : 90;
  return [...ring, [last[0]!, poleLat], [first[0]!, poleLat], [first[0]!, first[1]!]];
}

const minLon = (ring: Ring) => ring.reduce((m, p) => Math.min(m, p[0]!), Infinity);

/** Shift `ring` by whole turns so its westernmost point lies in [west, west + 360). */
function shiftInto(ring: Ring, west: number): Ring {
  const turns = Math.floor((minLon(ring) - west) / 360);
  return turns === 0 ? ring : ring.map(([x, y]) => [x! - turns * 360, y!]);
}

/** Unwrap a polygon's rings, its holes kept in the same world copy as its
 *  outline. A ring with no area on the plane goes: Antarctica's outline is a
 *  circle just off the south pole, with its coast as the hole around it. */
function unwrapPolygon(rings: Ring[]): Ring[] {
  const kept = rings.map(unwrap).filter((r) => Math.abs(area(r)) > 1e-6);
  if (!kept.length) return rings;
  const outer = shiftInto(closePole(kept[0]!), -180);
  const west = minLon(outer);
  return [outer, ...kept.slice(1).map((r) => shiftInto(closePole(r), west))];
}

/** Country outlines safe to draw on a plane: no edge jumps across ±180°. */
export function unwrapAntimeridian<T extends FeatureCollection<Polygon | MultiPolygon>>(fc: T): T {
  for (const f of fc.features) {
    const g = f.geometry;
    if (g.type === "Polygon") g.coordinates = unwrapPolygon(g.coordinates);
    else g.coordinates = g.coordinates.map(unwrapPolygon);
  }
  return fc;
}

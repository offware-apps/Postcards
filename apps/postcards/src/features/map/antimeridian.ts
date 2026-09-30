import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

// world-atlas stores rings in spherical coordinates: a ring crossing the
// antimeridian jumps from +180 to -180 between two vertices, and Antarctica's
// coast wraps the whole globe around the pole. MapLibre draws them on a plane,
// so that jump becomes an edge spanning the whole map and a visited Russia or
// Fiji paints a horizontal band across it. Each ring is therefore unwrapped
// into continuous longitudes, closed through the pole when it circles one, and
// cut into the [-180, 180] world it belongs to — once, when the geometry loads.

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
  // A ring around a pole ends 360° from where it started: close it along the
  // pole's latitude so it encloses the cap instead of a sliver.
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (Math.abs(last[0]! - first[0]!) > 180) {
    const poleLat = out.reduce((s, p) => s + p[1]!, 0) < 0 ? -90 : 90;
    out.push([last[0]!, poleLat], [first[0]!, poleLat], [first[0]!, first[1]!]);
  }
  return out;
}

/** Sutherland-Hodgman against one vertical line; `keepLeft` keeps x <= x0. */
function clipX(ring: Ring, x0: number, keepLeft: boolean): Ring {
  const inside = (p: Position) => (keepLeft ? p[0]! <= x0 : p[0]! >= x0);
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (x0 - a[0]!) / (b[0]! - a[0]!);
      out.push([x0, a[1]! + t * (b[1]! - a[1]!)]);
    }
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

/** The part of `ring` inside the world copy starting at `west`, shifted into
 *  [-180, 180] and closed; null when nothing with an area is left. */
function ringInWorld(ring: Ring, west: number): Ring | null {
  const clipped = clipX(clipX(ring, west, false), west + 360, true);
  if (clipped.length < 3 || Math.abs(area(clipped)) < 1e-9) return null;
  const shift = -180 - west;
  const out = clipped.map(([x, y]) => [x! + shift, y!]);
  out.push([...out[0]!]);
  return out;
}

/** Split a polygon's rings at the antimeridian; untouched when it does not cross. */
function splitPolygon(rings: Ring[]): Ring[][] {
  const unwrapped = rings.map(unwrap);
  let min = Infinity;
  let max = -Infinity;
  for (const r of unwrapped)
    for (const [x] of r) {
      if (x! < min) min = x!;
      if (x! > max) max = x!;
    }
  if (min >= -180 && max <= 180 && unwrapped.every((r, i) => r.length === rings[i]!.length))
    return [rings];
  const parts: Ring[][] = [];
  for (let west = Math.floor((min + 180) / 360) * 360 - 180; west < max; west += 360) {
    const kept = unwrapped.map((r) => ringInWorld(r, west)).filter((r): r is Ring => r !== null);
    if (kept.length) parts.push(kept);
  }
  return parts;
}

/** Country outlines safe to draw on a plane: no ring crosses ±180°. */
export function splitAntimeridian<T extends FeatureCollection<Polygon | MultiPolygon>>(fc: T): T {
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const split = polys.flatMap(splitPolygon);
    if (split.length === polys.length && split.every((p, i) => p === polys[i])) continue;
    f.geometry = { type: "MultiPolygon", coordinates: split };
  }
  return fc;
}

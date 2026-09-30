import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { feature } from "topojson-client";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { unwrapAntimeridian } from "../../src/features/map/antimeridian";

const here = dirname(fileURLToPath(import.meta.url));
const GEOMETRY = join(here, "..", "..", "public", "basemap", "countries-50m.json");

function countries(): FeatureCollection<Polygon | MultiPolygon> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo: any = JSON.parse(readFileSync(GEOMETRY, "utf8"));
  return feature(topo, topo.objects.countries) as unknown as FeatureCollection<Polygon | MultiPolygon>;
}

function rings(g: Polygon | MultiPolygon): Position[][] {
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
}

/** Planar area (deg²), the measure MapLibre fills. */
function area(g: Polygon | MultiPolygon): number {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let total = 0;
  for (const p of polys)
    p.forEach((r, i) => {
      let s = 0;
      for (let k = 0; k < r.length - 1; k++) s += r[k]![0]! * r[k + 1]![1]! - r[k + 1]![0]! * r[k]![1]!;
      total += (i === 0 ? 1 : -1) * Math.abs(s / 2);
    });
  return total;
}

const atPole = (p: Position) => Math.abs(p[1]!) === 90;
const onMeridian = (p: Position) => Math.abs(p[0]!) % 360 === 180;

/** Widest east-west edge, leaving out the one along a pole (off the map). */
function widestEdge(rs: Position[][]): number {
  let w = 0;
  for (const r of rs)
    for (let k = 1; k < r.length; k++) {
      if (atPole(r[k]!) && atPole(r[k - 1]!)) continue;
      w = Math.max(w, Math.abs(r[k]![0]! - r[k - 1]![0]!));
    }
  return w;
}

/** Edges running down the 180th meridian that do not reach a pole: a cut there
 *  is drawn as a border line through Chukotka, Fiji and Antarctica. */
function seams(rs: Position[][]): number {
  let n = 0;
  for (const r of rs)
    for (let k = 1; k < r.length; k++) {
      const a = r[k - 1]!;
      const b = r[k]!;
      if (onMeridian(a) && onMeridian(b) && !atPole(a) && !atPole(b)) n++;
    }
  return n;
}

describe("map: country shapes across the antimeridian", () => {
  const fc = unwrapAntimeridian(countries());
  const byName = (n: string) => fc.features.find((f) => f.properties?.name === n)!;

  it("leaves no edge spanning the map, so no country paints a band", () => {
    for (const f of fc.features) expect(widestEdge(rings(f.geometry)), f.properties?.name).toBeLessThan(180);
  });

  it("cuts no country at 180°, so no border line runs down the meridian", () => {
    // Natural Earth itself splits two Fiji islands at 180°; nothing is added to that.
    const raw = countries();
    fc.features.forEach((f, i) =>
      expect(seams(rings(f.geometry)), f.properties?.name).toBe(seams(rings(raw.features[i]!.geometry))),
    );
  });

  it("keeps Chukotka joined to Russia past 180° instead of a map-wide slab", () => {
    const russia = rings(byName("Russia").geometry);
    expect(Math.max(...russia.flat().map((p) => p[0]!))).toBeGreaterThan(185);
    expect(area(byName("Russia").geometry)).toBeLessThan(3500);
    expect(area(byName("Russia").geometry)).toBeGreaterThan(2500);
    // Every outline starts in the [-180, 180) world MapLibre wraps from.
    for (const f of fc.features)
      for (const r of rings(f.geometry)) expect(Math.min(...r.map((p) => p[0]!))).toBeGreaterThanOrEqual(-180);
  });

  it("closes Antarctica through the pole", () => {
    const ys = rings(byName("Antarctica").geometry).flat().map((p) => p[1]!);
    expect(Math.min(...ys)).toBe(-90);
    expect(area(byName("Antarctica").geometry)).toBeGreaterThan(360 * 15);
  });

  it("leaves a country that does not cross untouched", () => {
    const before = countries().features.find((f) => f.properties?.name === "France")!;
    expect(byName("France").geometry).toEqual(before.geometry);
  });
});

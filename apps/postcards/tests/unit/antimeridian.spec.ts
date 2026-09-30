import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { feature } from "topojson-client";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { splitAntimeridian } from "../../src/features/map/antimeridian";

const here = dirname(fileURLToPath(import.meta.url));

function countries(): FeatureCollection<Polygon | MultiPolygon> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo: any = JSON.parse(
    readFileSync(join(here, "..", "..", "public", "basemap", "countries-50m.json"), "utf8"),
  );
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

/** Widest east-west edge, leaving out the one along a pole (off the map). */
function widestEdge(g: Polygon | MultiPolygon): number {
  let w = 0;
  for (const r of rings(g))
    for (let k = 1; k < r.length; k++) {
      if (Math.abs(r[k]![1]!) === 90 && Math.abs(r[k - 1]![1]!) === 90) continue;
      w = Math.max(w, Math.abs(r[k]![0]! - r[k - 1]![0]!));
    }
  return w;
}

describe("map: country shapes across the antimeridian", () => {
  const fc = splitAntimeridian(countries());
  const byName = (n: string) => fc.features.find((f) => f.properties?.name === n)!;

  it("leaves no edge spanning the map, so no country paints a band", () => {
    for (const f of fc.features) {
      expect(widestEdge(f.geometry), f.properties?.name).toBeLessThan(180);
      for (const r of rings(f.geometry)) for (const [x] of r) expect(Math.abs(x!)).toBeLessThanOrEqual(180);
    }
  });

  it("keeps Russia's and Fiji's land on both sides of 180°", () => {
    for (const name of ["Russia", "Fiji"]) {
      const xs = rings(byName(name).geometry).flat().map((p) => p[0]!);
      expect(Math.min(...xs), name).toBeLessThan(-179);
      expect(Math.max(...xs), name).toBeGreaterThan(179);
    }
    // Chukotka and Wrangel east of 180° stay a sliver, not a map-wide slab.
    expect(area(byName("Russia").geometry)).toBeLessThan(3500);
    expect(area(byName("Russia").geometry)).toBeGreaterThan(2500);
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

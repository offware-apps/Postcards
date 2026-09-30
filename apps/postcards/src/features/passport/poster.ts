// Render "your world" as a PNG poster: an equirectangular world map with every
// visited country coloured by continent and stamped with its flag. Everything is
// drawn on-device from the bundled Natural Earth geometry — no network, no server.

import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { ReferenceData } from "../../lib/reference/types";
import { CONTINENT_COLORS } from "../../lib/reference/continents";
import { countryFlag } from "../../lib/format/format";
import { getLand } from "../travel/landGeometry";

const W = 2000;
const H = 1150;
const MAP_H = 1000; // map area; the rest is the caption band

function project([lon, lat]: Position): [number, number] {
  return [((lon + 180) / 360) * W, ((90 - lat) / 180) * MAP_H];
}

function drawRing(ctx: CanvasRenderingContext2D, ring: Position[], lonShift = 0): void {
  ring.forEach((pt, i) => {
    const [x, y] = project([pt[0]! + lonShift, pt[1]!]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Draw one ring, duplicated ±360° when it runs past the map edge (the rings
 *  arrive unwrapped), so an antimeridian-crossing shape appears on both sides. */
function drawWrappedRing(ctx: CanvasRenderingContext2D, ring: Position[]): void {
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon] of ring as [number, number][]) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  drawRing(ctx, ring);
  if (maxLon > 180) drawRing(ctx, ring, -360);
  if (minLon < -180) drawRing(ctx, ring, 360);
}

/** Largest-polygon bbox centre (on unwrapped longitudes) — the flag stamp spot. */
function flagAnchor(geom: Polygon | MultiPolygon): [number, number] {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let best: [number, number] | null = null;
  let bestArea = -1;
  for (const p of polys) {
    const ring = p[0]!;
    let minX = Infinity, maxX = -Infinity, minY = 90, maxY = -90;
    for (const [x, y] of ring as [number, number][]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) {
      bestArea = area;
      // Bring the centre back into [-180, 180) — the unwrapped bbox may sit
      // beyond the edge for shapes straddling the antimeridian.
      const cx = ((((minX + maxX) / 2 + 180) % 360) + 360) % 360 - 180;
      best = [cx, (minY + maxY) / 2];
    }
  }
  return project(best!);
}

interface PosterStats {
  countries: number;
  cities: number;
}

/** Build the poster and return it as a PNG blob. `opts.anchors` supplies a
 *  stamp position (lon, lat) for visited countries the basemap has no polygon
 *  for (Kosovo, small territories) — every counted flag then actually shows. */
export async function renderPoster(
  visitedIso2: Set<string>,
  ref: ReferenceData,
  stats: PosterStats,
  opts?: { anchors?: Map<string, [number, number]> },
): Promise<Blob> {
  const fc = (await getLand()) as FeatureCollection<Polygon | MultiPolygon> | null;
  if (!fc) throw new Error("map geometry unavailable");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Ocean + caption band.
  ctx.fillStyle = "#eaf0f6";
  ctx.fillRect(0, 0, W, MAP_H);
  ctx.fillStyle = "#17181c";
  ctx.fillRect(0, MAP_H, W, H - MAP_H);

  // Land, visited countries coloured by continent.
  const stamps: { x: number; y: number; flag: string }[] = [];
  const stamped = new Set<string>();
  for (const f of fc.features) {
    const numeric = String(f.id ?? "");
    const country = ref.countryByNumeric(numeric);
    const visited = !!country && visitedIso2.has(country.iso2);
    ctx.beginPath();
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const ring of p) drawWrappedRing(ctx, ring);
    ctx.fillStyle = visited
      ? CONTINENT_COLORS[country!.continent] ?? "#8fb4dd"
      : "#f4f6f9";
    ctx.fill("evenodd");
    ctx.strokeStyle = "#d6dce4";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (visited && country) {
      const [x, y] = flagAnchor(f.geometry);
      stamps.push({ x, y, flag: countryFlag(country.iso2) });
      stamped.add(country.iso2);
    }
  }

  // Visited countries with no polygon in the basemap (or an unjoinable id, like
  // Kosovo's -99): stamp them at the caller-provided anchor so the flag count
  // in the caption matches the flags on the map.
  for (const iso2 of visitedIso2) {
    if (stamped.has(iso2)) continue;
    const anchor = opts?.anchors?.get(iso2);
    if (!anchor) continue;
    const [x, y] = project(anchor);
    stamps.push({ x, y, flag: countryFlag(iso2) });
  }

  // Flag stamps on top (after all fills so nothing covers them).
  ctx.font = '36px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const s of stamps) ctx.fillText(s.flag, s.x, s.y);

  // Caption.
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = '600 52px "Space Grotesk Variable", "Inter Variable", system-ui, sans-serif';
  ctx.fillText("My world — Postcards", 48, MAP_H + 72);
  ctx.font = '400 34px "Inter Variable", system-ui, sans-serif';
  ctx.fillStyle = "#a2a6b2";
  ctx.fillText(
    `${stats.countries} countries · ${stats.cities} cities`,
    48,
    MAP_H + 122,
  );
  ctx.textAlign = "right";
  ctx.font = '400 26px "Inter Variable", system-ui, sans-serif';
  ctx.fillText("Boundaries © Natural Earth", W - 48, H - 36);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
}

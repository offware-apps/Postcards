import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection, Position } from "geojson";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useVisits } from "../../lib/store/useVisits";
import { useUi } from "../../lib/store/useUi";
import { useGazetteerGeneration } from "../../lib/reference/useGazetteer";
import { getLand } from "../travel/landGeometry";
import { useT } from "../../lib/i18n";

// A STATIC (non-interactive) per-country coverage map, shown under a country card
// in Stats in place of the long "regions/monuments to explore" text lists. It
// paints the country silhouette (bundled offline Natural Earth geometry), tints
// the regions you HAVEN'T been as soft "missing" blobs, and dots the cities you
// have — so coverage reads at a glance. Pure SVG, computed lazily when the card
// opens; the full, interactive lists still live on the country's own page.

const W = 320;
const H = 190;
const PAD = 10;
const MAX_DOTS = 400;

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

export function CountryCoverageMap({ iso2, name }: { iso2: string; name: string }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const gazGen = useGazetteerGeneration(); // city set grows when the full gazetteer lands
  const [land, setLand] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    let alive = true;
    void getLand().then((fc) => {
      if (alive) setLand(fc);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Visited city points + per-region centroids/spread, and which regions are unvisited.
  const model = useMemo(() => {
    const cities = ref.citiesOf(iso2);
    const visitedCityIds = new Set(
      visits
        .filter((v) => v.status === "visited" && v.place.kind === "city" && v.place.countryId === iso2)
        .map((v) => v.place.id),
    );
    type Reg = { sx: number; sy: number; sxx: number; syy: number; n: number; visited: boolean };
    const regions = new Map<string, Reg>();
    const visitedPoints: { lon: number; lat: number }[] = [];
    for (const c of cities) {
      const isVisited = visitedCityIds.has(c.id);
      if (isVisited && visitedPoints.length < MAX_DOTS) visitedPoints.push({ lon: c.lon, lat: c.lat });
      const sub = c.subdivisionId;
      if (!sub) continue;
      let g = regions.get(sub);
      if (!g) {
        g = { sx: 0, sy: 0, sxx: 0, syy: 0, n: 0, visited: false };
        regions.set(sub, g);
      }
      g.n++;
      g.sx += c.lon;
      g.sy += c.lat;
      g.sxx += c.lon * c.lon;
      g.syy += c.lat * c.lat;
      if (isVisited) g.visited = true;
    }
    const missing = [...regions.values()]
      .filter((g) => !g.visited)
      .map((g) => {
        const lon = g.sx / g.n;
        const lat = g.sy / g.n;
        // Rough spread (deg) across the region's cities, to size the blob.
        const spread = Math.sqrt(Math.max(0, g.sxx / g.n - lon * lon) + Math.max(0, g.syy / g.n - lat * lat));
        return { lon, lat, spread };
      });
    const regionsTotal = ref.countryByIso2(iso2)?.subdivisionCount ?? regions.size;
    const regionsVisited = [...regions.values()].filter((g) => g.visited).length;
    return { visitedPoints, missing, regionsTotal, regionsVisited };
  }, [iso2, visits, ref, gazGen]);

  // The country's polygon rings, matched from the bundled geometry by numeric code.
  const rings = useMemo<Position[][]>(() => {
    if (!land) return [];
    const numeric = ref.countryByIso2(iso2)?.numeric;
    // The bundled TopoJSON carries the numeric country code as the feature `id`.
    const feat = land.features.find(
      (f) => String(f.id ?? f.properties?.numeric ?? "") === String(numeric),
    );
    const geom = feat?.geometry;
    const out: Position[][] = [];
    if (geom?.type === "Polygon") out.push(...(geom.coordinates as Position[][]));
    else if (geom?.type === "MultiPolygon") for (const p of geom.coordinates as Position[][][]) out.push(...p);
    return out;
  }, [land, iso2, ref]);

  const layout = useMemo(() => {
    // Frame to the MAINLAND — the ring with the most points — so a country with
    // far-flung overseas territories (France, the US…) doesn't zoom out to the
    // whole globe. Everything else still draws, clipped by the viewBox.
    let mainRing: Position[] | null = null;
    for (const r of rings) if (r.length > (mainRing?.length ?? 0)) mainRing = r;
    const frameLons: number[] = [];
    const frameLats: number[] = [];
    if (mainRing)
      for (const p of mainRing) {
        frameLons.push(p[0]!);
        frameLats.push(p[1]!);
      }
    else {
      for (const p of model.visitedPoints) {
        frameLons.push(p.lon);
        frameLats.push(p.lat);
      }
      for (const m of model.missing) {
        frameLons.push(m.lon);
        frameLats.push(m.lat);
      }
    }
    if (!frameLons.length) return null;
    // Unwrap across the antimeridian: when the frame spans > 180° of raw longitude
    // the land wraps the date line (Russia, Fiji…), so shift western lons by +360
    // and project EVERYTHING (rings, dots, blobs) in that continuous space — else
    // the silhouette collapses to a distorted, off-centre sliver.
    const unwrap = Math.max(...frameLons) - Math.min(...frameLons) > 180;
    const wrapLon = (lon: number) => (unwrap && lon < 0 ? lon + 360 : lon);

    const xs = frameLons.map((lon) => (wrapLon(lon) * Math.PI) / 180);
    const ys = frameLats.map(mercY);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    const spanX = maxX - minX || 0.1;
    const spanY = maxY - minY || 0.1;
    minX -= spanX * 0.08;
    maxX += spanX * 0.08;
    minY -= spanY * 0.12;
    maxY += spanY * 0.12;
    const scale = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const sx = (lon: number) => W / 2 + ((wrapLon(lon) * Math.PI) / 180 - midX) * scale;
    const sy = (lat: number) => H / 2 - (mercY(lat) - midY) * scale;
    const degToPx = (scale * Math.PI) / 180; // ~px per degree at this scale

    const landPath = rings
      .map((r) => r.map((p, i) => (i ? "L" : "M") + sx(p[0]!).toFixed(1) + " " + sy(p[1]!).toFixed(1)).join("") + "Z")
      .join("");
    const blobs = model.missing.map((m) => ({
      x: sx(m.lon),
      y: sy(m.lat),
      r: Math.max(6, Math.min(W / 4, (m.spread || 0.4) * degToPx)),
    }));
    const dots = model.visitedPoints.map((p) => ({ x: sx(p.lon), y: sy(p.lat) }));
    return { landPath, blobs, dots };
  }, [rings, model]);

  if (!layout) return null;

  // Tapping the map opens the country's full page — its cities, regions and sites,
  // all interactive. The whole figure is the target; the SVG is decorative (its
  // coverage is described on the button), so AT hears one clear action.
  const aria = t("stats.country.mapOpenAria", {
    name,
    visited: model.regionsVisited,
    total: model.regionsTotal,
  });

  return (
    <button
      type="button"
      className="country-cov-map"
      onClick={() => useUi.getState().openCountry(iso2)}
      aria-label={aria}
      title={t("stats.country.openPage")}
    >
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden preserveAspectRatio="xMidYMid meet">
        {layout.landPath && <path className="ccov-land" d={layout.landPath} />}
        {/* Painted "still to explore" regions. */}
        {layout.blobs.map((b, i) => (
          <circle key={`m${i}`} className="ccov-missing" cx={b.x} cy={b.y} r={b.r} />
        ))}
        {/* Cities you've been. */}
        {layout.dots.map((d, i) => (
          <circle key={`v${i}`} className="ccov-visited" cx={d.x} cy={d.y} r={2.6} />
        ))}
      </svg>
      <span className="country-cov-legend" aria-hidden>
        <span>
          <span className="ccov-key ccov-key-visited" /> {t("stats.country.mapVisited")}
        </span>
        <span>
          <span className="ccov-key ccov-key-missing" /> {t("stats.country.mapMissing")}
        </span>
        <span className="ccov-open">{t("stats.country.openPage")} ↗</span>
      </span>
    </button>
  );
}

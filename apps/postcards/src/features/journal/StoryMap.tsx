import { useMemo } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useUi } from "../../lib/store/useUi";
import { placeKey } from "../../lib/schema/helpers";
import { countryFlag } from "../../lib/format/format";
import { LAND_OUTLINE } from "../../lib/publish/landOutline";
import type { Story, PlaceRef } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { useT } from "../../lib/i18n";
import { placesOf } from "./postcardModel";

// A self-contained SVG map — the same embedded public-domain land silhouette the
// published reader draws (offline, nothing fetched), fit to YOUR story places via
// a Web-Mercator projection. No MapLibre/tiles: it's a lightweight overview.
const W = 760;
const H = 440;
const PAD = 40;
const MIN_SPAN = 0.35; // guarantee regional context around a single/clustered pin

function mercY(lat: number): number {
  const la = Math.max(-85, Math.min(85, lat));
  return Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360));
}

/** Coordinates for a story's place (nothing invented — countries have no point). */
function coordOf(ref: ReferenceData, p: PlaceRef): { lon: number; lat: number } | null {
  if (p.kind === "city") {
    const c = ref.cityById(p.id);
    return c ? { lon: c.lon, lat: c.lat } : null;
  }
  if (p.kind === "heritage") {
    const h = ref.heritageById(p.id);
    return h && (h.lat !== 0 || h.lon !== 0) ? { lon: h.lon, lat: h.lat } : null;
  }
  if (p.kind === "airport") {
    const a = ref.airportById(p.id);
    return a ? { lon: a.lon, lat: a.lat } : null;
  }
  if (p.kind === "station") {
    const s = ref.stationById(p.id);
    return s ? { lon: s.lon, lat: s.lat } : null;
  }
  if (p.kind === "custom") {
    return p.lat != null && p.lon != null ? { lon: p.lon, lat: p.lat } : null;
  }
  return null;
}

/**
 * "Map of stories": a pin per place you've written about (sized by how many
 * entries), tap one to open that place. The SVG pins are decorative for assistive
 * tech; the legend list below is the keyboard/AT path to the same places.
 */
export function StoryMap({ stories }: { stories: Story[] }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);

  const points = useMemo(() => {
    const m = new Map<
      string,
      { key: string; name: string; countryId: string; id: string; lon: number; lat: number; count: number }
    >();
    // A postcard can span several places (and a place-less one plots nowhere): count
    // an entry once per place it's about.
    for (const s of stories) {
      for (const place of placesOf(s)) {
        const c = coordOf(ref, place);
        if (!c) continue;
        const k = placeKey(place);
        const g = m.get(k);
        if (g) g.count++;
        else
          m.set(k, {
            key: k,
            name: place.name,
            countryId: place.countryId,
            id: place.id,
            lon: c.lon,
            lat: c.lat,
            count: 1,
          });
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [stories, ref]);

  const layout = useMemo(() => {
    if (points.length === 0) return null;
    const X = points.map((p) => (p.lon * Math.PI) / 180);
    const Y = points.map((p) => mercY(p.lat));
    let minX = Math.min(...X);
    let maxX = Math.max(...X);
    let minY = Math.min(...Y);
    let maxY = Math.max(...Y);
    if (maxX - minX < MIN_SPAN) {
      const c = (minX + maxX) / 2;
      minX = c - MIN_SPAN / 2;
      maxX = c + MIN_SPAN / 2;
    }
    if (maxY - minY < MIN_SPAN) {
      const c = (minY + maxY) / 2;
      minY = c - MIN_SPAN / 2;
      maxY = c + MIN_SPAN / 2;
    }
    let spanX = maxX - minX;
    let spanY = maxY - minY;
    minX -= spanX * 0.16;
    maxX += spanX * 0.16;
    minY -= spanY * 0.2;
    maxY += spanY * 0.2;
    spanX = maxX - minX;
    spanY = maxY - minY;
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const sx = (x: number) => W / 2 + (x - midX) * scale;
    const sy = (y: number) => H / 2 - (y - midY) * scale;

    // Project each ring in CONTINUOUS unwrapped longitude (accumulate the shortest
    // step between consecutive points) so an antimeridian-crossing ring never jumps
    // — no streak, no fill wedge. Each ring is drawn at −360/0/+360 offsets and only
    // the copy touching the viewport is kept, so land on the far side of the date
    // line still shows; off-screen geometry is clipped by the SVG viewport.
    let land = "";
    for (const ring of LAND_OUTLINE) {
      for (const off of [-360, 0, 360]) {
        let seg = "";
        let any = false;
        let unwrapped = 0;
        let prevRaw: number | null = null;
        for (let i = 0; i < ring.length; i++) {
          const llon = ring[i]![0];
          const llat = ring[i]![1];
          if (prevRaw === null) {
            unwrapped = llon + off;
          } else {
            let d = llon - prevRaw;
            if (d > 180) d -= 360;
            else if (d < -180) d += 360;
            unwrapped += d;
          }
          prevRaw = llon;
          const Lx = sx((unwrapped * Math.PI) / 180);
          const Ly = sy(mercY(llat));
          seg += (i === 0 ? "M" : "L") + Lx.toFixed(1) + " " + Ly.toFixed(1);
          if (Lx > -60 && Lx < W + 60 && Ly > -60 && Ly < H + 60) any = true;
        }
        if (any) land += seg + "Z";
      }
    }
    const dots = points.map((p) => ({ ...p, x: sx((p.lon * Math.PI) / 180), y: sy(mercY(p.lat)) }));
    return { land, dots };
  }, [points]);

  if (!layout) {
    return (
      <p className="muted empty">
        <span className="empty-emoji" aria-hidden>
          🗺️
        </span>
        {t("journal.mapEmpty")}
      </p>
    );
  }

  const open = (id: string) => useUi.getState().openCity(id);

  return (
    <div className="journal-storymap">
      <svg className="storymap-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("journal.mapAria")}>
        {layout.land && <path className="storymap-land" d={layout.land} />}
        {layout.dots.map((p) => (
          <g key={p.key} className="storymap-pin" aria-hidden onClick={() => open(p.id)}>
            <circle cx={p.x} cy={p.y} r={p.count > 1 ? 9 : 7} className="storymap-pin-dot" />
            {p.count > 1 && (
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="storymap-pin-count">
                {p.count}
              </text>
            )}
          </g>
        ))}
      </svg>
      {/* The accessible, keyboard-navigable path to the same places (the SVG pins
          are aria-hidden), doubling as a labelled legend the pins don't have room for. */}
      <ul className="storymap-legend">
        {layout.dots.map((p) => (
          <li key={p.key}>
            <button type="button" className="link" onClick={() => open(p.id)}>
              {countryFlag(p.countryId)} {p.name}{" "}
              <span className="muted small">· {p.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useSettings } from "../../lib/store/useSettings";
import { usePrefersReducedMotion } from "../../lib/hooks/usePrefersReducedMotion";
import { stopsArcs } from "../map/visitedLayers";
import { fitBounds } from "../map/mapFit";
import { useT } from "../../lib/i18n";
import type { PlaceRef, TravelMode } from "../../lib/schema/models";
import { placeFlag, type MyPlace } from "./myPlaces";
import { getLand } from "./landGeometry";
import { pickPointsFC } from "./pickPoints";

// The composer's REAL picker map: a dedicated, offline MapLibre instance (bundled
// Natural Earth land via the MapSource seam — no tiles, no network, no geolocation
// prompt) showing ONLY your pool of visited places as tappable pins. Tapping lays
// down stops in order and draws the live great-circle route. It is fully decoupled
// from the app's main MapView, so it can never perturb the production map.
//
// The map is a POINTER enhancement, not the only path: a companion list of the same
// places (real <button>s with flags) sits beneath the canvas as the keyboard/AT
// route, and an aria-live region announces every add.

function resolveDark(theme: "system" | "light" | "dark"): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function RouteMap({
  pool,
  stops,
  mode,
  addedKeys,
  onPick,
}: {
  pool: MyPlace[];
  stops: PlaceRef[];
  mode: TravelMode;
  addedKeys: Set<string>;
  onPick: (place: PlaceRef) => void;
}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const reducedMotion = usePrefersReducedMotion();
  const dark = resolveDark(useSettings((s) => s.theme));
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const [live, setLive] = useState("");

  // Latest values the imperative map handlers read, without re-binding listeners.
  const poolByKey = useMemo(() => new Map(pool.map((p) => [p.key, p.place])), [pool]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const poolByKeyRef = useRef(poolByKey);
  poolByKeyRef.current = poolByKey;

  const pins = useMemo(() => pickPointsFC(pool, stops), [pool, stops]);
  const arcs = useMemo(() => stopsArcs(stops, ref, mode), [stops, ref, mode]);
  // The load handler seeds the layers: stops picked from the list before the
  // canvas loaded must be drawn from the start, not from the mount-time route.
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const arcsRef = useRef(arcs);
  arcsRef.current = arcs;
  const poolRef = useRef(pool);
  poolRef.current = pool;

  // Create the map once. Offline base style (no sources → no tiles); land, arcs
  // and pins are added on load. Torn down on unmount (map.remove()).
  useEffect(() => {
    if (!boxRef.current) return;
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        { id: "bg", type: "background", paint: { "background-color": dark ? "#0b1220" : "#d9e6f1" } },
      ],
    };
    const map = new maplibregl.Map({
      container: boxRef.current,
      style,
      center: [6, 20],
      zoom: 0.8,
      attributionControl: false,
      // Reduced-motion users get instant camera moves throughout.
      ...(reducedMotion ? { fadeDuration: 0 } : {}),
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Natural Earth (public domain)",
      }),
      "bottom-right",
    );

    map.on("load", () => {
      void getLand().then((land) => {
        // Guard on IDENTITY, not just truthiness: a fast Map→List→Map toggle can
        // remove this map and create a new one while the (shared, cached) land
        // promise is in flight — touching the removed map would throw.
        if (mapRef.current !== map || !land) return;
        if (map.getSource("land")) return;
        map.addSource("land", { type: "geojson", data: land });
        map.addLayer({
          id: "land",
          type: "fill",
          source: "land",
          paint: {
            "fill-color": dark ? "#1b2433" : "#eef2f4",
            "fill-outline-color": dark ? "#324056" : "#c7d2dd",
          },
        });
        map.moveLayer("land"); // keep land beneath arcs + pins
        if (map.getLayer("arcs")) map.moveLayer("arcs");
        if (map.getLayer("pins")) map.moveLayer("pins");
      });

      map.addSource("arcs", { type: "geojson", data: arcsRef.current });
      map.addLayer({
        id: "arcs",
        type: "line",
        source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#6366f1", "line-width": 2.5, "line-opacity": 0.9 },
      });
      map.addSource("pins", { type: "geojson", data: pinsRef.current });
      map.addLayer({
        id: "pins",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": ["case", ["get", "added"], 7, 5],
          "circle-color": ["match", ["get", "kind"], "airport", "#0369a1", "#be185d"],
          "circle-stroke-width": ["case", ["get", "added"], 3, 1.5],
          "circle-stroke-color": ["case", ["get", "added"], "#22c55e", "#ffffff"],
        },
      });
      readyRef.current = true;

      const b = fitBounds(poolRef.current.map((p) => ({ lon: p.lon, lat: p.lat })));
      if (b) map.fitBounds(b, { padding: 44, maxZoom: 6, animate: !reducedMotion });
    });

    const pick = (pt: maplibregl.Point) => {
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [pt.x - 9, pt.y - 9],
        [pt.x + 9, pt.y + 9],
      ];
      const feats = map.queryRenderedFeatures(box, { layers: ["pins"] });
      if (!feats.length) return;
      // Nearest pin to the tap, by projected pixel distance (dense pools overlap).
      let best = feats[0]!;
      let bestD = Infinity;
      for (const f of feats) {
        if (f.geometry.type !== "Point") continue;
        const p = map.project(f.geometry.coordinates as [number, number]);
        const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      const key = best.properties?.key;
      const place = key != null ? poolByKeyRef.current.get(String(key)) : undefined;
      if (place) onPickRef.current(place);
    };
    map.on("click", (e) => pick(e.point));
    map.on("mouseenter", "pins", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "pins", () => (map.getCanvas().style.cursor = ""));

    // MapLibre reads container size once at construction; the picker mounts behind
    // a segmented toggle and the mobile keyboard resizes it — observe and resize().
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(boxRef.current);

    return () => {
      ro.disconnect();
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push route changes to the live layers (pins gain their "added" ring + seq, the
  // arc grows) without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("pins") as maplibregl.GeoJSONSource | undefined)?.setData(pins);
    (map.getSource("arcs") as maplibregl.GeoJSONSource | undefined)?.setData(arcs);
  }, [pins, arcs]);

  // Announce the newest stop for non-visual users (mirrors the arc + node cue).
  useEffect(() => {
    if (!stops.length) {
      setLive("");
      return;
    }
    const last = stops[stops.length - 1]!;
    setLive(t("trip.compose.addedLive", { name: last.name, index: stops.length }));
  }, [stops, t]);

  return (
    <div className="route-map">
      <div ref={boxRef} className="route-map-canvas" role="application" aria-label={t("trip.compose.mapCanvasAria")} />
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      {/* Keyboard / screen-reader path: the same pool as real buttons. */}
      <ul className="myplaces-list route-map-list">
        {pool.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              className="myplaces-pick"
              aria-label={t("trip.compose.pickAria", { name: p.name })}
              onClick={() => onPick(p.place)}
            >
              <span className="flag" aria-hidden>
                {placeFlag(p.place)}
              </span>
              <span className="myplaces-name">{p.name}</span>
              {addedKeys.has(p.key) && (
                <span className="myplaces-added" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

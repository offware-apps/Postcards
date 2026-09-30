import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useSettings } from "../../lib/store/useSettings";
import { usePrefersReducedMotion } from "../../lib/hooks/usePrefersReducedMotion";
import { stopsArcs } from "../map/visitedLayers";
import { fitBounds } from "../map/mapFit";
import { useT, type MessageKey } from "../../lib/i18n";
import type { PlaceRef, TravelMode } from "../../lib/schema/models";
import { placeFlag, type MyPlace } from "./myPlaces";
import { getLand } from "./landGeometry";
import { pickPointsFC } from "./pickPoints";

// The composer's REAL picker map: a dedicated, offline MapLibre instance (bundled
// Natural Earth land via the MapSource seam — no tiles, no network, no geolocation
// prompt) showing your pool of visited places as tappable pins. Tapping a pin does
// NOT add it straight away: with many overlapping places a blind add lands on a
// near-random neighbour, so a tap instead snaps to the MOST POPULOUS pin in the
// cluster and opens a little confirm box ABOVE it — you then press Add. A pill
// above the canvas filters the pins to just cities or just airports, so a city and
// its airport stop fighting for the same spot. It is fully decoupled from the app's
// main MapView, so it can never perturb the production map.
//
// The map is a POINTER enhancement, not the only path: a companion list of the same
// places (real <button>s with flags) sits beneath the canvas as the keyboard/AT
// route, and an aria-live region announces every add.

type KindFilter = "all" | "city" | "airport";
const FILTERS: { key: KindFilter; label: MessageKey }[] = [
  { key: "all", label: "trip.compose.filterAll" },
  { key: "city", label: "trip.compose.filterCities" },
  { key: "airport", label: "trip.compose.filterAirports" },
];

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
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const readyRef = useRef(false);
  const [live, setLive] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  // Only the pins matching the filter (all / cities / airports). Drives both the
  // map layer AND the companion list, so the two never disagree.
  const shownPool = useMemo(
    () => (kind === "all" ? pool : pool.filter((p) => p.place.kind === kind)),
    [pool, kind],
  );

  // Latest values the imperative map handlers read, without re-binding listeners.
  const poolByKey = useMemo(() => new Map(pool.map((p) => [p.key, p.place])), [pool]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const poolByKeyRef = useRef(poolByKey);
  poolByKeyRef.current = poolByKey;
  const tRef = useRef(t);
  tRef.current = t;

  const pins = useMemo(() => pickPointsFC(shownPool, stops), [shownPool, stops]);
  const arcs = useMemo(() => stopsArcs(stops, ref, mode), [stops, ref, mode]);

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

      map.addSource("arcs", { type: "geojson", data: arcs });
      map.addLayer({
        id: "arcs",
        type: "line",
        source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#6366f1", "line-width": 2.5, "line-opacity": 0.9 },
      });
      map.addSource("pins", { type: "geojson", data: pins });
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

      const b = fitBounds(pool.map((p) => ({ lon: p.lon, lat: p.lat })));
      if (b) map.fitBounds(b, { padding: 44, maxZoom: 6, animate: !reducedMotion });
    });

    // A tap doesn't add — it snaps to the most populous pin in the tapped cluster
    // and opens a confirm box above it. This is what stops a dense pool from adding
    // a near-random neighbour when you meant the big city.
    const pick = (pt: maplibregl.Point) => {
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [pt.x - 12, pt.y - 12],
        [pt.x + 12, pt.y + 12],
      ];
      const feats = map.queryRenderedFeatures(box, { layers: ["pins"] });
      if (!feats.length) {
        popupRef.current?.remove();
        return;
      }
      // Most populous wins; ties (and non-cities, pop 0) break to the nearest pin.
      let best = feats[0]!;
      let bestPop = -1;
      let bestD = Infinity;
      for (const f of feats) {
        if (f.geometry.type !== "Point") continue;
        const pop = Number(f.properties?.pop ?? 0);
        const p = map.project(f.geometry.coordinates as [number, number]);
        const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
        if (pop > bestPop || (pop === bestPop && d < bestD)) {
          bestPop = pop;
          bestD = d;
          best = f;
        }
      }
      if (best.geometry.type !== "Point") return;
      const key = best.properties?.key;
      const place = key != null ? poolByKeyRef.current.get(String(key)) : undefined;
      if (!place) return;
      openConfirm(place, best.geometry.coordinates as [number, number]);
    };

    // The "little box above the point": a MapLibre popup with the place's flag +
    // name and one Add button. Built imperatively (it lives outside React) but reads
    // the latest onPick/t via refs. Reused across taps so only one is ever open.
    const openConfirm = (place: PlaceRef, coords: [number, number]) => {
      const node = document.createElement("div");
      node.className = "route-popup";
      const label = document.createElement("span");
      label.className = "route-popup-name";
      label.textContent = `${placeFlag(place)} ${place.name}`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "route-popup-add";
      add.textContent = tRef.current("trip.compose.confirmAdd");
      add.addEventListener("click", () => {
        onPickRef.current(place);
        popupRef.current?.remove();
      });
      node.append(label, add);
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: false,
          offset: 14,
          className: "route-popup-wrap",
        });
      }
      popupRef.current.setLngLat(coords).setDOMContent(node).addTo(map);
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
      popupRef.current?.remove();
      popupRef.current = null;
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

  // Changing the filter can hide the pin a confirm box points at — dismiss it.
  const switchKind = (k: KindFilter) => {
    setKind(k);
    popupRef.current?.remove();
  };

  return (
    <div className="route-map">
      <div className="route-map-filter segmented" role="group" aria-label={t("trip.compose.filterAria")}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={kind === f.key}
            className={kind === f.key ? "seg-on" : ""}
            onClick={() => switchKind(f.key)}
          >
            {t(f.label)}
          </button>
        ))}
      </div>
      <div ref={boxRef} className="route-map-canvas" role="application" aria-label={t("trip.compose.mapCanvasAria")} />
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      {/* Keyboard / screen-reader path: the same (filtered) pool as real buttons. */}
      <ul className="myplaces-list route-map-list">
        {shownPool.map((p) => (
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

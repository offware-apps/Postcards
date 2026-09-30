import { useDeferredValue, useMemo, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { searchPlaces } from "../visits/search";
import { RouteMap } from "./RouteMap";
import { useT } from "../../lib/i18n";
import type { PlaceRef, TravelMode } from "../../lib/schema/models";
import { placeFlag, type MyPlace } from "./myPlaces";

// Pick trip stops fast. Two ways:
//  • List — the places you've BEEN (visited + past trips) as instant taps, AND a
//    search that reaches ANY airport or city in the gazetteer (airports are central
//    to reconstructing flights, and most people never log them as visits).
//  • Map — the app's REAL MapLibre map (offline, bundled land) of your places; tap a
//    pin to add it in sequence and watch the route draw (see RouteMap).
// Flags everywhere for instant recognition (spec 019).

export function MyPlacesPicker({
  places,
  addedKeys,
  onPick,
  stops,
  travelMode,
}: {
  places: MyPlace[];
  addedKeys: Set<string>;
  onPick: (place: PlaceRef) => void;
  /** The route so far — drives the live arc + the "added" pin rings on the map. */
  stops: PlaceRef[];
  travelMode: TravelMode;
}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const [mode, setMode] = useState<"list" | "map">("list");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);

  // With a query, search the whole gazetteer for cities + transport hubs (any
  // airport or station is a reachable trip stop); with no query, the instant list
  // is the places you've been.
  const searchRows = useMemo(() => {
    const s = dq.trim();
    if (!s) return null;
    return searchPlaces(ref, s, 12)
      .filter(
        (r) =>
          r.place.kind === "airport" || r.place.kind === "city" || r.place.kind === "station",
      )
      .map((r) => ({ place: r.place, detail: r.detail }));
  }, [ref, dq]);

  return (
    <div className="myplaces-picker">
      <div className="segmented" role="group" aria-label={t("trip.compose.pickModeAria")}>
        <button
          type="button"
          aria-pressed={mode === "list"}
          className={mode === "list" ? "seg-on" : ""}
          onClick={() => setMode("list")}
        >
          ☰ {t("trip.compose.pickList")}
        </button>
        <button
          type="button"
          aria-pressed={mode === "map"}
          className={mode === "map" ? "seg-on" : ""}
          onClick={() => setMode("map")}
        >
          🗺 {t("trip.compose.pickMap")}
        </button>
      </div>

      {mode === "list" ? (
        <>
          <input
            type="search"
            className="search-input"
            value={q}
            placeholder={t("trip.compose.searchPlaceholder")}
            aria-label={t("trip.compose.searchPlaceholder")}
            onChange={(e) => setQ(e.target.value)}
          />
          {searchRows ? (
            searchRows.length === 0 ? (
              <p className="muted small">{t("trip.compose.noMatch")}</p>
            ) : (
              <ul className="myplaces-list">
                {searchRows.map((r) => (
                  <li key={`${r.place.kind}:${r.place.id}`}>
                    <button
                      type="button"
                      className="myplaces-pick"
                      aria-label={t("trip.compose.pickAria", { name: r.place.name })}
                      onClick={() => onPick(r.place)}
                    >
                      <span className="flag" aria-hidden>
                        {placeFlag(r.place)}
                      </span>
                      <span className="myplaces-name">{r.place.name}</span>
                      <span className="muted small myplaces-detail">{r.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : places.length === 0 ? (
            <p className="muted small">{t("trip.compose.searchPrompt")}</p>
          ) : (
            <ul className="myplaces-list">
              {places.map((p) => (
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
          )}
        </>
      ) : places.length === 0 ? (
        <p className="muted empty">{t("trip.compose.noPlaces")}</p>
      ) : (
        <RouteMap pool={places} stops={stops} mode={travelMode} addedKeys={addedKeys} onPick={onPick} />
      )}
    </div>
  );
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { searchPlaces } from "./search";
import { useGazetteerGeneration } from "../../lib/reference/useGazetteer";
import { useVisits, findByPlace, visitIndex } from "../../lib/store/useVisits";
import { useUi } from "../../lib/store/useUi";
import { useToast } from "../../lib/store/useToast";
import { placeKey } from "../../lib/schema/helpers";
import type { PlaceRef } from "../../lib/schema/models";
import { useT } from "../../lib/i18n";
import { countryFlag } from "../../lib/format/format";
import { SearchIcon } from "../../ui/icons";

/**
 * Global place search. Picking a result NAVIGATES — it flies the map to a
 * city/airport/monument or opens a country's page — and never logs anything by
 * itself (an accidental Enter used to silently mark the top match visited).
 * Marking visited is the explicit "Add" chip on the row, or Shift+Enter.
 * Fully keyboard-operable: arrows move the active option, Escape clears.
 */
export function PlaceSearch({
  onFocusCity,
}: {
  onFocusCity?: (c: { lon: number; lat: number; place: PlaceRef }) => void;
}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const toggleVisit = useVisits((s) => s.toggleVisit);
  const restoreVisit = useVisits((s) => s.restoreVisit);
  const showToast = useToast((s) => s.show);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusNonce = useUi((s) => s.searchFocusNonce);

  // On a phone the top-bar field is narrow (it shares the row with the brand and
  // the action icons), so the full "Search a city or country…" placeholder gets
  // clipped mid-word. Use a short placeholder there — it stays fully readable,
  // and the leading magnifier plus the accessible name still convey what it searches.
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 899.98px)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(max-width: 899.98px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Focus when the "/" shortcut asks (nonce > 0 avoids grabbing focus on mount).
  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  // Defer the scan off the keystroke render: the input paints at native speed
  // and the search fan-out runs in an interruptible follow-up render (dropped
  // if the next keystroke lands first). notFound keys on the deferred query so
  // the add-place form doesn't flash while results lag a beat behind.
  const dq = useDeferredValue(q);
  // Airports, heritage sites and stations land a moment after first paint: search again then.
  const gazGen = useGazetteerGeneration();
  const results = useMemo(() => searchPlaces(ref, dq), [ref, dq, gazGen]);
  const notFound = dq.trim().length >= 2 && results.length === 0;

  // Keep the active option visible as arrows move it.
  useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`#search-opt-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  /** Show the place: fly the map to it, or open the country's page. */
  function pick(place: PlaceRef) {
    if (place.kind === "country") {
      useUi.getState().openCountry(place.countryId);
    } else if (place.kind === "city") {
      const c = ref.cityById(place.id);
      if (c) onFocusCity?.({ lon: c.lon, lat: c.lat, place });
    } else if (place.kind === "airport") {
      const a = ref.airportById(place.id);
      if (a) onFocusCity?.({ lon: a.lon, lat: a.lat, place });
    } else if (place.kind === "heritage") {
      const h = ref.heritageById(place.id);
      if (h && (h.lat !== 0 || h.lon !== 0)) onFocusCity?.({ lon: h.lon, lat: h.lat, place });
      else useUi.getState().openCity(place.id);
    }
    setQ("");
    setActive(-1);
    inputRef.current?.focus();
  }

  /** The explicit "log it" action (chip / Shift+Enter). Countries are never
   *  logged directly — you visit a country by visiting a place inside it. */
  function toggle(place: PlaceRef) {
    if (place.kind === "country") return;
    // Only this place's record changes — snapshot it alone; undo restores one
    // record instead of rewriting the whole visits table.
    const prev = findByPlace(useVisits.getState().visits, place);
    void toggleVisit(place);
    // Adds are silent (the chip flips to ✓ in place); only a removal — which
    // can drop photos/notes — gets a toast, and only so it can be undone.
    if (prev?.status === "visited")
      showToast(t("places.row.removedToast", { name: place.name }), () => restoreVisit(prev));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Clearing a query spends this Escape; on an empty field it still
      // reaches the app, which closes a page or steps back.
      if (q) e.stopPropagation();
      setQ("");
      setActive(-1);
      return;
    }
    if (e.key === "Enter") {
      // The deferred results can lag a keystroke behind a fast typist — for
      // the ACTION, fall back to a synchronous scan so Enter never lands on a
      // stale list or silently does nothing.
      const list = q === dq ? results : searchPlaces(ref, q);
      const r = list[active >= 0 && active < list.length ? active : 0];
      // Return commits the top match (flies there) AND leaves the search bar —
      // blur it so the keyboard drops and you're back on the map/list. Shift+Enter
      // marks it visited and keeps focus, for rapid add-add-add.
      if (r) {
        if (e.shiftKey) {
          toggle(r.place);
        } else {
          pick(r.place);
          inputRef.current?.blur();
        }
      } else {
        inputRef.current?.blur(); // nothing to pick → still exit the field
      }
      e.preventDefault();
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      setActive((a) => (a + 1) % results.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
      e.preventDefault();
    }
  }

  return (
    <div className="search">
      {/* A leading magnifier makes the field unmistakably a search even when the top-bar
          squeezes the placeholder to "Search a…" on a phone. It's a pointer
          affordance that focuses the field on tap; the input already carries the
          accessible name, so this is aria-hidden + non-focusable (no duplicate
          "Search a city…" for AT, and keyboard users just tab to the input). */}
      <button
        type="button"
        className="search-icon"
        aria-hidden="true"
        tabIndex={-1}
        title={t("search.aria")}
        onClick={() => inputRef.current?.focus()}
      >
        <SearchIcon />
      </button>
      <input
        ref={inputRef}
        type="search"
        className={"search-input" + (q ? " has-clear" : "")}
        placeholder={narrow ? t("search.placeholderShort") : t("search.placeholder")}
        title={t("search.aria")}
        aria-label={t("search.aria")}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `search-opt-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {q && (
        <button
          type="button"
          className="search-clear"
          aria-label={t("search.clear")}
          title={t("search.clear")}
          onClick={() => {
            setQ("");
            setActive(-1);
            inputRef.current?.focus();
          }}
        >
          ✕
        </button>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {notFound
          ? t("search.noMatches", { q: dq.trim() })
          : results.length > 0
            ? t.plural("search.results", results.length)
            : ""}
      </p>
      {results.length > 0 && (
        <ul
          ref={listRef}
          className="results results-split"
          id="search-results"
          role="listbox"
          aria-label={t("search.resultsAria")}
        >
          {results.map((r, i) => {
            const visited = visitIndex(visits).get(placeKey(r.place))?.status === "visited";
            const addLabel = visited
              ? t("states.removeFromVisited", { name: r.place.name })
              : t("places.row.markVisitedAria", { name: r.place.name });
            return (
              <li
                key={`${r.place.kind}:${r.place.id}`}
                id={`search-opt-${i}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={"result-open" + (i === active ? " opt-active" : "")}
                  title={
                    r.place.kind === "country"
                      ? t("stats.country.open", { name: r.place.name })
                      : t("stats.records.showOnMap", { name: r.place.name })
                  }
                  onClick={() => pick(r.place)}
                >
                  <span className="result-flag" aria-hidden>
                    {r.place.countryId ? countryFlag(r.place.countryId) : ""}
                  </span>
                  <span className="result-main">
                    <span className="result-name">{r.place.name}</span>
                    <span className="result-detail">{r.detail}</span>
                  </span>
                </button>
                {/* Logging is ITS OWN button — showing a place never logs it.
                    Countries have none: they're visited via places inside. */}
                {r.place.kind !== "country" && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={"chip result-add" + (visited ? " chip-on" : "")}
                    title={addLabel}
                    aria-label={addLabel}
                    onClick={() => toggle(r.place)}
                  >
                    {visited ? `✓ ${t("places.country.visitedChip")}` : `＋ ${t("search.addChip")}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* No "add your own place" here: a custom place is added by tapping its spot
          on the map (long-press / "Add a place here"), which is where coordinates
          come from. Search just says, plainly, when nothing matched. */}
      {notFound && (
        <div className="search-empty">
          <p>{t("search.noMatches", { q: dq.trim() })}</p>
        </div>
      )}
    </div>
  );
}

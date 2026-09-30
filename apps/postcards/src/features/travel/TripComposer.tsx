import { useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useTrips } from "../../lib/store/useTrips";
import { useVisits } from "../../lib/store/useVisits";
import { placeKey } from "../../lib/schema/helpers";
import { useT, useLocale } from "../../lib/i18n";
import type { PlaceRef, TravelMode } from "../../lib/schema/models";
import { MyPlacesPicker } from "./MyPlacesPicker";
import { myPlaces, placeFlag } from "./myPlaces";
import { appendStop, moveStopTo, removeStopAt, setLegMode, type StopChain } from "./tripStops";
import { tripPathKm } from "./distance";
import { MODE_ORDER, MODE_GLYPH } from "./modes";
import { parseTripDate } from "./tripDate";
import { monthName } from "./period";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/**
 * Full-page composer for a MULTI-STOP journey (spec 019). Built to be fast: tap the
 * places you've BEEN (a list or a map, with flags) to build an ordered chain, see
 * the running great-circle distance, and save — the date is optional and can be
 * added later. Retrospective, not a planner; a pure summary (visits untouched).
 */
export function TripComposer({ tripId, onClose }: { tripId: string | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const ref = useMemo(() => getReferenceData(), []);
  const trips = useTrips((s) => s.trips);
  const visits = useVisits((s) => s.visits);
  const addTrip = useTrips((s) => s.addTrip);
  const updateTrip = useTrips((s) => s.updateTrip);
  const existing = useMemo(
    () => (tripId ? trips.find((x) => x.tripId === tripId) : undefined),
    [tripId, trips],
  );

  // The pool of places you've been — visited records + places already used in trips.
  const pool = useMemo(() => myPlaces(visits, trips, ref), [visits, trips, ref]);

  const initialStops = (): PlaceRef[] => {
    if (existing?.stops && existing.stops.length >= 2) return existing.stops;
    if (existing) return [existing.from, existing.to];
    return [];
  };
  const [stops, setStops] = useState<PlaceRef[]>(initialStops);
  // Per-leg transport (spec 019): one mode per leg, seeded from the trip's saved
  // modes (or its single `mode`), so a journey can mix transports and a run of one
  // mode reads as a sub-trip. Kept the right length as stops change.
  const [legModes, setLegModes] = useState<TravelMode[]>(() => {
    const s0 = initialStops();
    const need = Math.max(0, s0.length - 1);
    const base = (existing?.legModes ?? []).slice(0, need);
    while (base.length < need) base.push(existing?.mode ?? "flight");
    return base;
  });
  const applyChain = (c: StopChain) => {
    setStops(c.stops);
    setLegModes(c.legModes);
  };
  // New legs continue the last leg's transport (so tapping stops in a row keeps
  // one mode until you change it — that's what makes a sub-trip).
  const nextFill = (): TravelMode => legModes[legModes.length - 1] ?? existing?.mode ?? "flight";
  const [name, setName] = useState(existing?.name ?? "");
  const seededDate = parseTripDate(existing?.date ?? null);
  const [year, setYear] = useState(seededDate ? String(seededDate.year) : "");
  const [month, setMonth] = useState(
    seededDate?.month != null ? String(seededDate.month).padStart(2, "0") : "",
  );

  const addedKeys = useMemo(() => new Set(stops.map((s) => placeKey(s))), [stops]);
  // Rows keyed by place and which repeat of it this is (a round trip lists a place
  // twice), so a move re-orders the rows instead of remounting them.
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return stops.map((s) => {
      const k = placeKey(s);
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      return `${k}:${n}`;
    });
  }, [stops]);
  // A moved row's arrow keeps keyboard focus: moving the row in the DOM can drop
  // it, and at either end the pressed arrow turns disabled, so hand it to the other.
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfterMove = useRef<{ index: number; dir: "up" | "down" } | null>(null);
  useEffect(() => {
    const want = focusAfterMove.current;
    if (!want) return;
    focusAfterMove.current = null;
    const row = listRef.current?.children[want.index];
    const [up, down] = row?.querySelectorAll<HTMLButtonElement>(".trip-stop-actions button") ?? [];
    const [pressed, other] = want.dir === "up" ? [up, down] : [down, up];
    (pressed && !pressed.disabled ? pressed : other)?.focus();
  }, [stops]);
  const move = (from: number, to: number) => {
    focusAfterMove.current = { index: to, dir: to < from ? "up" : "down" };
    applyChain(moveStopTo({ stops, legModes }, from, to, nextFill()));
  };
  const { km, unresolvedLegs } = useMemo(() => tripPathKm(stops, ref), [stops, ref]);
  const canSave = stops.length >= 2;

  function composeDate(): string | null {
    const y = year.trim();
    if (!/^\d{4}$/.test(y)) return null;
    if (!month) return y;
    // The composer picks a year and a month only: a trip saved with a full day
    // keeps it while that year and month are left as they were.
    const kept = existing?.date;
    if (kept && kept.length === 10 && kept.startsWith(`${y}-${month}-`)) return kept;
    return `${y}-${month}`;
  }

  async function save() {
    if (!canSave) return;
    const from = stops[0]!;
    const to = stops[stops.length - 1]!;
    const date = composeDate();
    // The primary mode is the first leg's; per-leg modes are saved only when a leg
    // actually differs (a uniform trip stays a plain single-mode trip).
    const mode = legModes[0] ?? existing?.mode ?? "flight";
    const mixed = legModes.some((m) => m !== mode);
    const legModesToSave = mixed ? legModes : undefined;
    if (tripId && existing) {
      await updateTrip(tripId, { from, to, stops, mode, legModes: legModesToSave, date, name: name.trim() });
    } else {
      await addTrip({ from, to, stops, mode, legModes: legModesToSave, date, name: name.trim() || null });
    }
    onClose();
  }

  return (
    <section
      className="screen trip-composer"
      aria-label={t(tripId ? "trip.compose.editTitle" : "trip.compose.newTitle")}
    >
      <div className="trip-composer-head">
        <button
          type="button"
          className="link back-link"
          onClick={onClose}
          aria-label={t("trip.compose.back")}
        >
          ← {t("trip.compose.back")}
        </button>
        <h2>{t(tripId ? "trip.compose.editTitle" : "trip.compose.newTitle")}</h2>
      </div>

      {/* Your trip — the ordered chain being built, with the running distance. */}
      <div className="trip-chain-head">
        <h3 className="trip-section-head">{t("trip.compose.stopsHeading")}</h3>
        {stops.length >= 2 && (
          <span className="trip-distance-km" role="status">
            {t("trip.compose.km", { km: Math.round(km).toLocaleString(locale) })}
          </span>
        )}
      </div>
      {stops.length === 0 ? (
        <p className="muted small">{t("trip.compose.emptyStops")}</p>
      ) : (
        <ol className="trip-stops" ref={listRef}>
          {stops.map((s, i) => (
            <li key={rowKeys[i]} className="trip-stop-row">
              <div className="trip-stop-main">
                <span className="trip-stop-index" aria-hidden>
                  {i + 1}
                </span>
                <span className="flag" aria-hidden>
                  {placeFlag(s)}
                </span>
                <span className="trip-stop-name" title={s.name}>
                  {s.name}
                </span>
                <span className="trip-stop-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === 0}
                    aria-label={t("trip.compose.moveUp", { name: s.name })}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === stops.length - 1}
                    aria-label={t("trip.compose.moveDown", { name: s.name })}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("trip.compose.removeStop", { name: s.name })}
                    onClick={() => applyChain(removeStopAt({ stops, legModes }, i, nextFill()))}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {/* The transport for the leg from THIS stop to the next — change it
                  where a segment differs and a run of one mode reads as a sub-trip. */}
              {i < stops.length - 1 && (
                <div className="trip-leg">
                  <span className="trip-leg-line" aria-hidden />
                  <label className="trip-leg-mode">
                    <span className="sr-only">
                      {t("trip.compose.legModeAria", { from: s.name, to: stops[i + 1]!.name })}
                    </span>
                    <select
                      className="select"
                      value={legModes[i] ?? "flight"}
                      onChange={(e) =>
                        applyChain(setLegMode({ stops, legModes }, i, e.target.value as TravelMode))
                      }
                    >
                      {MODE_ORDER.map((m) => (
                        <option key={m} value={m}>
                          {MODE_GLYPH[m]} {t(`travel.mode.${m}` as const)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {unresolvedLegs > 0 && <p className="muted small">{t("trip.compose.unmeasured")}</p>}

      {/* Pick from the places you've been — the fast, primary interaction. */}
      <h3 className="trip-section-head">{t("trip.compose.pickHeading")}</h3>
      <p className="muted small">{t("trip.compose.tapHint")}</p>
      <MyPlacesPicker
        places={pool}
        addedKeys={addedKeys}
        onPick={(place) => applyChain(appendStop({ stops, legModes }, place, nextFill()))}
        stops={stops}
        travelMode={legModes[0] ?? "flight"}
      />

      {/* Optional details — name now, date whenever. */}
      <label className="field">
        <span className="field-label">{t("trip.compose.nameLabel")}</span>
        <input
          className="search-input"
          type="text"
          maxLength={80}
          value={name}
          placeholder={t("trip.compose.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <details className="trip-date-details" open={!!year}>
        <summary>{t("trip.compose.addDate")}</summary>
        <fieldset className="field trip-when">
          <legend className="field-label">{t("trip.compose.whenLabel")}</legend>
          <input
            className="search-input trip-year"
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            value={year}
            placeholder={t("trip.compose.yearPlaceholder")}
            aria-label={t("trip.compose.yearPlaceholder")}
            onChange={(e) => setYear(e.target.value)}
          />
          <select
            className="select"
            value={month}
            aria-label={t("trip.compose.monthLabel")}
            disabled={!/^\d{4}$/.test(year.trim())}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">{t("trip.compose.monthAny")}</option>
            {MONTHS.map((mm) => (
              <option key={mm} value={mm}>
                {monthName(mm, locale)}
              </option>
            ))}
          </select>
        </fieldset>
      </details>

      <div className="trip-composer-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn" disabled={!canSave} onClick={() => void save()}>
          {t("trip.compose.save")}
        </button>
      </div>
      {!canSave && <p className="muted small">{t("trip.compose.needTwo")}</p>}
    </section>
  );
}

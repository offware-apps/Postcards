import { useMemo, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useTrips } from "../../lib/store/useTrips";
import { useVisits } from "../../lib/store/useVisits";
import { useStories } from "../../lib/store/useStories";
import { useUi } from "../../lib/store/useUi";
import { placeKey } from "../../lib/schema/helpers";
import { formatDate } from "../../lib/format/format";
import { useT, useLocale } from "../../lib/i18n";
import type { PlaceRef, TravelMode } from "../../lib/schema/models";
import { MyPlacesPicker } from "./MyPlacesPicker";
import { primaryPlace } from "../journal/postcardModel";
import { myPlaces, placeFlag } from "./myPlaces";
import { appendStop, moveStopTo, removeStopAt, setLegMode, setStopDate, type StopChain } from "./tripStops";
import { tripPathKm } from "./distance";
import { MODE_ORDER, MODE_GLYPH } from "./modes";
import { formatTripDate } from "./tripDate";

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
  // Postcards a user linked to THIS trip (spec 020) — shown read-only, tap to open.
  const stories = useStories((s) => s.stories);
  const linkedPostcards = useMemo(
    () => (tripId ? stories.filter((s) => s.tripId === tripId) : []),
    [tripId, stories],
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
  // Per-STOP dates (spec 021), aligned to `stops` — the day you were at each
  // waypoint. Seeded from the trip's saved per-stop dates, or (for an older trip
  // that only had one overall date) onto its first stop, so editing keeps it.
  const isFullDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const [stopDates, setStopDates] = useState<(string | null)[]>(() => {
    const s0 = initialStops();
    if (existing?.stopDates && existing.stopDates.length) {
      const out = existing.stopDates.slice(0, s0.length);
      while (out.length < s0.length) out.push(null);
      return out;
    }
    const seed = existing?.date && isFullDay(existing.date) ? existing.date : null;
    return s0.map((_, i) => (i === 0 ? seed : null));
  });
  const applyChain = (c: StopChain) => {
    setStops(c.stops);
    setLegModes(c.legModes);
    setStopDates(c.stopDates ?? []);
  };
  // The live chain the row handlers mutate (stops + per-leg modes + per-stop dates).
  const chain: StopChain = { stops, legModes, stopDates };
  // New legs continue the last leg's transport (so tapping stops in a row keeps
  // one mode until you change it — that's what makes a sub-trip).
  const nextFill = (): TravelMode => legModes[legModes.length - 1] ?? existing?.mode ?? "flight";
  const [name, setName] = useState(existing?.name ?? "");
  // A coarse legacy date (year or year-month, which a native day-picker can't
  // render) is preserved at trip level as a small clearable chip so nothing is lost.
  const [legacyDate, setLegacyDate] = useState(
    existing?.date && !isFullDay(existing.date) ? existing.date : "",
  );

  const addedKeys = useMemo(() => new Set(stops.map((s) => placeKey(s))), [stops]);
  const { km, unresolvedLegs } = useMemo(() => tripPathKm(stops, ref), [stops, ref]);
  const canSave = stops.length >= 2;

  async function save() {
    if (!canSave) return;
    const from = stops[0]!;
    const to = stops[stops.length - 1]!;
    // Per-stop dates are saved only when at least one is set; the trip's own `date`
    // is the START (first dated stop) so the log/year-filter keep working, falling
    // back to a preserved coarse legacy date so an old trip's date isn't lost.
    const stopDatesToSave = stopDates.some((d) => d) ? stopDates : undefined;
    const dateToSave = (stopDates.find((d) => d) ?? null) || (legacyDate.trim() || null);
    // The primary mode is the first leg's; per-leg modes are saved only when a leg
    // actually differs (a uniform trip stays a plain single-mode trip).
    const mode = legModes[0] ?? existing?.mode ?? "flight";
    const mixed = legModes.some((m) => m !== mode);
    const legModesToSave = mixed ? legModes : undefined;
    if (tripId && existing) {
      await updateTrip(tripId, { from, to, stops, mode, legModes: legModesToSave, stopDates: stopDatesToSave, date: dateToSave, name: name.trim() });
    } else {
      await addTrip({ from, to, stops, mode, legModes: legModesToSave, stopDates: stopDatesToSave, date: dateToSave, name: name.trim() || null });
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
        <ol className="trip-stops">
          {stops.map((s, i) => (
            <li key={`${s.kind}:${s.id}:${i}`} className="trip-stop-row">
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
                    onClick={() => applyChain(moveStopTo(chain, i, i - 1, nextFill()))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === stops.length - 1}
                    aria-label={t("trip.compose.moveDown", { name: s.name })}
                    onClick={() => applyChain(moveStopTo(chain, i, i + 1, nextFill()))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("trip.compose.removeStop", { name: s.name })}
                    onClick={() => applyChain(removeStopAt(chain, i, nextFill()))}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {/* Optional date you were at THIS stop (spec 021). The first/last
                  dated stops are the journey's start and end. */}
              <label className="trip-stop-date">
                <span className="trip-stop-date-label muted small">
                  {t("trip.compose.stopDateLabel")}
                </span>
                <input
                  className="search-input"
                  type="date"
                  max="9999-12-31"
                  value={isFullDay(stopDates[i] ?? "") ? (stopDates[i] as string) : ""}
                  aria-label={t("trip.compose.stopDateAria", { name: s.name })}
                  onChange={(e) => applyChain(setStopDate(chain, i, e.target.value || null))}
                />
              </label>
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
                        applyChain(setLegMode(chain, i, e.target.value as TravelMode))
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
        onPick={(place) => applyChain(appendStop(chain, place, nextFill()))}
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

      {/* Per-stop dates live on each stop above; the trip's overall date is their
          start. A coarse legacy date (a whole year/month a day-picker can't show)
          from an older trip is preserved here as a clearable chip. */}
      {legacyDate && (
        <div className="field trip-date-field">
          <span className="field-label">{t("trip.compose.dateLabel")}</span>
          <span className="filter-chip trip-date-legacy">
            <span className="filter-chip-label">{formatTripDate(legacyDate, locale)}</span>
            <button
              type="button"
              className="filter-chip-x"
              aria-label={t("trip.compose.clearDate")}
              onClick={() => setLegacyDate("")}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {linkedPostcards.length > 0 && (
        <div className="trip-postcards">
          <h3 className="trip-section-head">{t("trip.compose.postcardsHeading")}</h3>
          <ul className="myplaces-list">
            {linkedPostcards.map((s) => (
              <li key={s.storyId}>
                <button
                  type="button"
                  className="myplaces-pick"
                  onClick={() => useUi.getState().openStoryComposer(s.storyId)}
                >
                  <span className="myplaces-name">
                    {s.title || primaryPlace(s)?.name || t("journal.untitledEntry")}
                  </span>
                  <span className="muted small myplaces-detail">{formatDate(s.date)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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

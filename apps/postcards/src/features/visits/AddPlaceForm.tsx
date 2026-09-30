import { useEffect, useMemo, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { countryAtPoint } from "../../lib/reference/countryAtPoint";
import { useVisits } from "../../lib/store/useVisits";
import { useUi } from "../../lib/store/useUi";
import { sanitizeText } from "../../lib/schema/sanitize";
import { parseCoordsInput } from "./coordsInput";
import { useT } from "../../lib/i18n";

/**
 * Create a place the datasets don't know (a hamlet, a viewpoint, grandma's
 * village). This is YOUR data, not reference data — it lives only in your file,
 * clearly marked "your own place" (Constitution I: the app never invents
 * reference facts; users may record their own).
 *
 * You never have to type coordinates: the common path opens this form from a map
 * long-press (the point is already pinned), and "Use my location" fills it from
 * the device. Manual latitude/longitude entry is tucked into a disclosure for the
 * rare power-user case, and it guards against a reversed lon,lat paste.
 */
export function AddPlaceForm({
  initialName,
  initialCoords,
  initialCountry,
  onDone,
}: {
  initialName: string;
  /** Prefill the coordinates (e.g. from a map long-press) so nothing is typed. */
  initialCoords?: { lat: number; lon: number };
  /** Prefill the country select. */
  initialCountry?: string;
  onDone: () => void;
}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const addVisit = useVisits((s) => s.addVisit);
  const [name, setName] = useState(initialName);
  const [cc, setCc] = useState(initialCountry ?? "");
  // Once you pick a country by hand we stop auto-filling it; until then a valid
  // coordinate (typed, dropped on the map, or from your location) resolves the
  // country for you — the point of "add a place" is naming the spot, not hunting
  // for its country.
  const [ccTouched, setCcTouched] = useState(!!initialCountry);
  const [coords, setCoords] = useState(
    initialCoords ? `${initialCoords.lat.toFixed(5)}, ${initialCoords.lon.toFixed(5)}` : "",
  );
  // Manual lat/lon entry is collapsed by default when the point is already pinned
  // (map long-press) — only opened up-front when nothing was supplied.
  const [manualOpen, setManualOpen] = useState(!initialCoords);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  // Optional: how many people live here. Your own place has no reference population,
  // so without this it counts as 0 and the population filter hides it — type a real
  // number and it's treated like any city of that size.
  const [population, setPopulation] = useState("");
  const parsedPop = useMemo(() => {
    const s = population.trim();
    if (s === "") return null;
    const n = Math.floor(Number(s));
    return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? n : null;
  }, [population]);

  // Parse "lat, lon" and quietly correct an unambiguously reversed lon,lat paste
  // (a latitude can't exceed ±90). Ambiguous both-valid pairs stay as typed; the
  // country line below lets the user spot a genuine mix-up.
  const parsed = useMemo(() => parseCoordsInput(coords), [coords]);

  // The country of the nearest gazetteer city to the entered point (offline).
  const autoCc = useMemo(
    () => (parsed ? countryAtPoint(ref.allCities(), parsed.lat, parsed.lon) : null),
    [parsed, ref],
  );
  useEffect(() => {
    if (autoCc && !ccTouched) setCc(autoCc);
  }, [autoCc, ccTouched]);

  // Fill the point from the device — requested only on this explicit tap, used
  // once, never stored beyond the place's own coordinates. Degrades silently.
  function useMyLocation() {
    setGeoMsg(null);
    if (!navigator.geolocation) {
      setGeoMsg(t("addPlace.geoUnavailable"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setCoords(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
        setCcTouched(false); // let the country re-resolve from the new point
      },
      () => {
        setLocating(false);
        setGeoMsg(t("addPlace.geoUnavailable"));
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const countryLabel =
    cc === "ZZ" ? t("addPlace.noCountry") : (ref.countries.find((c) => c.iso2 === cc)?.name ?? "");

  // Sanitize like the portable-file schema will — a name that collapses to
  // empty (e.g. "===") must not be savable, or the export wouldn't restore.
  const cleanName = sanitizeText(name, 200);
  const canSave = cleanName.length > 0 && !!cc && (coords.trim() === "" || !!parsed);

  async function save() {
    const id = `custom-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
    await addVisit({
      place: {
        kind: "custom",
        id,
        name: cleanName,
        countryId: cc,
        // Store coordinates by name only — never the parser's `swapped` flag.
        ...(parsed ? { lat: parsed.lat, lon: parsed.lon } : {}),
        ...(parsedPop != null ? { population: parsedPop } : {}),
      },
    });
    if (parsed) useUi.getState().flyTo(parsed.lon, parsed.lat);
    onDone();
  }

  // Keyboard-first: Enter anywhere saves (once the form is valid), Escape cancels.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && canSave) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.stopPropagation(); // cancel the form only — don't also navigate back
      onDone();
    }
  }

  return (
    <div className="add-place" onKeyDown={onKeyDown}>
      <p className="muted small">
        {t("addPlace.descPre")}
        <em>{t("addPlace.descEm")}</em>
        {t("addPlace.descPost")}
      </p>
      <div className="add-place-row">
        <input
          className="search-input"
          type="text"
          value={name}
          maxLength={200}
          placeholder={t("addPlace.namePlaceholder")}
          title={t("addPlace.namePlaceholder")}
          aria-label={t("addPlace.namePlaceholder")}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="select"
          value={cc}
          title={t("addPlace.country")}
          aria-label={t("addPlace.country")}
          onChange={(e) => {
            setCcTouched(true);
            setCc(e.target.value);
          }}
        >
          <option value="">{t("addPlace.countryOption")}</option>
          <option value="ZZ">🌊 {t("addPlace.noCountry")}</option>
          {ref.countries.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Where is it? — you don't have to type numbers. The point comes from the
          map long-press or your location; manual entry is a fallback. */}
      {parsed ? (
        <p className="pin-summary" aria-label={t("addPlace.pinnedAria")}>
          📍 {parsed.lat.toFixed(4)}°, {parsed.lon.toFixed(4)}°
          {countryLabel ? ` · ${countryLabel}` : ""}
        </p>
      ) : (
        <p className="muted small">{t("addPlace.locationHint")}</p>
      )}
      {parsed?.swapped && (
        <p className="muted small">
          {t("addPlace.swapNote", { lat: parsed.lat.toFixed(4), lon: parsed.lon.toFixed(4) })}
        </p>
      )}

      <div className="add-place-row">
        <button
          className="btn-ghost"
          type="button"
          title={t("addPlace.useLocation")}
          onClick={useMyLocation}
          disabled={locating}
          aria-busy={locating}
        >
          {locating ? t("addPlace.locating") : t("addPlace.useLocation")}
        </button>
        <button
          className="btn"
          type="button"
          title={t("addPlace.addButton")}
          disabled={!canSave}
          onClick={() => void save()}
        >
          {t("addPlace.addButton")}
        </button>
      </div>
      {geoMsg && (
        <p className="muted small" role="status">
          {geoMsg}
        </p>
      )}

      <details
        className="add-place-manual"
        open={manualOpen}
        onToggle={(e) => setManualOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary title={t("addPlace.manualToggle")}>{t("addPlace.manualToggle")}</summary>
        <div className="add-place-row">
          <input
            className="search-input"
            type="text"
            value={coords}
            placeholder={t("addPlace.coordsPlaceholder")}
            title={t("addPlace.coordsAria")}
            aria-label={t("addPlace.coordsAria")}
            onChange={(e) => setCoords(e.target.value)}
          />
        </div>
        <div className="add-place-row">
          <input
            className="search-input"
            type="number"
            inputMode="numeric"
            min={0}
            value={population}
            placeholder={t("addPlace.populationPlaceholder")}
            title={t("addPlace.populationAria")}
            aria-label={t("addPlace.populationAria")}
            onChange={(e) => setPopulation(e.target.value)}
          />
        </div>
        {coords.trim() !== "" && !parsed && (
          <p className="muted small">{t("addPlace.coordsHint")}</p>
        )}
        {population.trim() !== "" && parsedPop == null && (
          <p className="muted small">{t("addPlace.populationHint")}</p>
        )}
      </details>
    </div>
  );
}

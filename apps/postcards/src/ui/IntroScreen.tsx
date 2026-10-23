import { useEffect, useMemo, useRef, useState } from "react";
import { Globe } from "./Globe";
import { useSettings } from "../lib/store/useSettings";
import { useToast } from "../lib/store/useToast";
import { downloadFullCities, fullCitiesEnabled } from "../lib/reference/referenceData";
import { useT } from "../lib/i18n";
import { useFocusHandoff } from "../lib/hooks/useFocusHandoff";

/** An on/off toggle switch — the one control the intro rows use, so every option
 *  reads the same way: flip it to activate, flip it back to deactivate. */
function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={"intro-switch" + (disabled ? " is-disabled" : "")}>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={disabled}
        aria-label={label}
        title={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="intro-switch-track" aria-hidden>
        <span className="intro-switch-thumb" />
      </span>
    </label>
  );
}

/** The welcome page has been closed once (App writes this when it closes). */
const INTRO_KEY = "postcards-intro-seen";
function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) != null;
  } catch {
    return true;
  }
}

/**
 * First-run welcome — a full page (not a modal) with a live spinning earth,
 * one line about what Postcards is, and a switch per optional feature so a
 * newcomer can flip on what they want on the spot. Skippable; shown once.
 *
 * On a first run, "Detailed map" and "Full city list" start switched on, but
 * nothing reaches the network until the newcomer taps Start with them still on:
 * that tap, with both switches in view, is the opt-in (Constitution: data leaves
 * the device only on explicit user action). Skip applies neither. Opened again
 * later, the switches show and change the current settings directly.
 */
export function IntroScreen({ onClose }: { onClose: () => void }) {
  const t = useT();
  const onlineMap = useSettings((s) => s.onlineMap);
  const offlineMode = useSettings((s) => s.offlineMode);
  const setOnlineMap = useSettings((s) => s.setOnlineMap);
  const setOfflineMode = useSettings((s) => s.setOfflineMode);
  const optimizeMarkers = useSettings((s) => s.optimizeMarkers);
  const setOptimizeMarkers = useSettings((s) => s.setOptimizeMarkers);
  const reduceMapWork = useSettings((s) => s.reduceMapWork);
  const setReduceMapWork = useSettings((s) => s.setReduceMapWork);
  const showToast = useToast((s) => s.show);
  const startRef = useRef<HTMLButtonElement>(null);
  // First run: the two network features wait for Start (see above).
  const [firstRun] = useState(() => !introSeen());
  const [wantMap, setWantMap] = useState(true);
  const [wantCities, setWantCities] = useState(true);

  // Detect a phone / slower device (touch + small screen, or touch + few CPU
  // cores) so we can recommend the smooth-map settings up front. A laptop/desktop
  // doesn't need them, so the banner simply doesn't appear there.
  const isPhone = useMemo(() => {
    if (typeof matchMedia === "undefined") return false;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const small = matchMedia("(max-width: 640px)").matches;
    const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
    return (coarse && small) || (coarse && fewCores);
  }, []);
  // The recommendation is "applied" once both smooth-map settings are on.
  const smoothMapOn = reduceMapWork && optimizeMarkers;
  // Applying hides the recommendation with its button, so focus moves to the next row.
  const modeRef = useRef<HTMLDivElement>(null);
  useFocusHandoff(isPhone && !smoothMapOn, null, modeRef);
  function applyPhoneRecommended() {
    setReduceMapWork(true);
    setOptimizeMarkers(true);
    showToast(t("intro.recommend.toast"));
  }

  const [cities, setCities] = useState<"idle" | "busy" | "done">(
    fullCitiesEnabled() ? "done" : "idle",
  );

  // The app passes an inline onClose, so any re-render behind the intro hands a
  // new one; reading it through a ref keeps the focus effect to the first mount.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // Focus the Start button for keyboard users WITHOUT scrolling it into view —
    // it's the last child of a tall, centred overlay, so a default focus scrolls
    // the hero (globe + title + first rows) off the top on a phone.
    startRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function getCities() {
    setCities("busy");
    const ok = await downloadFullCities();
    setCities(ok ? "done" : "idle");
    showToast(ok ? t("settings.cities.toast.done") : t("settings.cities.toast.failed"));
  }

  // Offline mode makes no optional request, so nothing waits for Start there:
  // flipping the city list on downloads it at once, as it always has.
  const deferred = firstRun && !offlineMode;
  const mapOn = deferred ? wantMap : onlineMap;
  const citiesOn = cities !== "idle" || (deferred && wantCities);
  function toggleMap(on: boolean) {
    if (deferred) setWantMap(on);
    else setOnlineMap(on);
  }
  function toggleCities(on: boolean) {
    if (deferred) setWantCities(on);
    else if (on) void getCities();
  }
  function start() {
    if (deferred) {
      setOnlineMap(wantMap);
      if (wantCities && cities === "idle") void getCities();
    }
    onClose();
  }

  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <button className="intro-skip" type="button" title={t("intro.skip")} onClick={onClose}>
        {t("intro.skip")}
      </button>

      <div className="intro-hero">
        <Globe size={200} />
      </div>

      <h1 id="intro-title" className="intro-title">
        {t("intro.title")}
      </h1>
      <p className="intro-lede">{t("intro.lede")}</p>

      <ul className="intro-list">
        {/* Device-aware recommendation: on a phone, offer the smooth-map settings
            in one tap. Hidden on a laptop/desktop and once they're already on. */}
        {isPhone && !smoothMapOn && (
          <li className="intro-row intro-recommend">
            <div className="intro-row-text">
              <span className="intro-row-title">📱 {t("intro.recommend.title")}</span>
              <span className="intro-row-desc">{t("intro.recommend.desc")}</span>
            </div>
            <button
              type="button"
              className="intro-seg-btn is-on intro-recommend-apply"
              title={t("intro.recommend.apply")}
              onClick={applyPhoneRecommended}
            >
              {t("intro.recommend.apply")}
            </button>
          </li>
        )}

        {/* The single most important choice, made explicit up front: is Postcards
            allowed online (richer) or fully self-contained (nothing leaves the
            device)? Everything below adapts to the mode picked here. */}
        <li className="intro-row intro-mode-row">
          <div className="intro-row-text">
            <span className="intro-row-title">
              {offlineMode ? "📴" : "🌐"} {t("intro.mode.title")}
            </span>
            <span className="intro-row-desc">
              {offlineMode ? t("intro.mode.offlineDesc") : t("intro.mode.onlineDesc")}
            </span>
          </div>
          <div ref={modeRef} className="intro-seg" role="group" aria-label={t("intro.mode.title")}>
            <button
              type="button"
              className={"intro-seg-btn" + (!offlineMode ? " is-on" : "")}
              aria-pressed={!offlineMode}
              title={t("intro.mode.onlineDesc")}
              onClick={() => setOfflineMode(false)}
            >
              {t("intro.mode.online")}
            </button>
            <button
              type="button"
              className={"intro-seg-btn" + (offlineMode ? " is-on" : "")}
              aria-pressed={offlineMode}
              title={t("intro.mode.offlineDesc")}
              onClick={() => setOfflineMode(true)}
            >
              {t("intro.mode.offline")}
            </button>
          </div>
        </li>

        {!offlineMode && (
          <li className="intro-row">
            <div className="intro-row-text">
              <span className="intro-row-title">🛰️ {t("intro.map.title")}</span>
              <span className="intro-row-desc">{t("intro.map.desc")}</span>
            </div>
            <Switch on={mapOn} onChange={toggleMap} label={t("intro.map.title")} />
          </li>
        )}

        {/* Fast map — flip on to keep the map smooth once you've marked lots of
            places; the full controls live in Settings → Optimisation. */}
        <li className="intro-row">
          <div className="intro-row-text">
            <span className="intro-row-title">⚡ {t("intro.optimize.title")}</span>
            <span className="intro-row-desc">{t("intro.optimize.desc")}</span>
          </div>
          <Switch
            on={optimizeMarkers}
            onChange={setOptimizeMarkers}
            label={t("intro.optimize.title")}
          />
        </li>

        {/* Offline city search — on, it downloads the full gazetteer (~17 MB), on a
            first run once Start is tapped; once saved it stays on. */}
        <li className="intro-row">
          <div className="intro-row-text">
            <span className="intro-row-title">🏙️ {t("intro.cities.title")}</span>
            <span className="intro-row-desc">{t("intro.cities.desc")}</span>
          </div>
          <Switch
            on={citiesOn}
            disabled={cities !== "idle"}
            onChange={toggleCities}
            label={t("intro.cities.title")}
          />
        </li>
      </ul>

      <p className="intro-more">{t("intro.more")}</p>

      <button
        ref={startRef}
        className="intro-start"
        type="button"
        title={t("intro.start")}
        onClick={start}
      >
        {t("intro.start")}
      </button>
    </div>
  );
}

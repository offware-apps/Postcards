import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useModalKeys } from "../../lib/hooks/useModalKeys";
import { useToast } from "../../lib/store/useToast";
import { useSettings, MARKER_CAP_CHOICES } from "../../lib/store/useSettings";
import { saveAreaOffline } from "../map/offlineTiles";
import { OFFLINE_REGIONS, REGION_MAX_TILES, estimateRegion, type OfflineRegion } from "./regions";
import { ScopeToggle } from "../../ui/ScopeToggle";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { LanguageToggle } from "../../ui/LanguageToggle";
import { Backup } from "../backup/Backup";
import { SyncSection } from "./SyncSection";
import { DataPacksSection } from "./DataPacksSection";
import { Attribution } from "../../ui/Attribution";
import { formatInt } from "../../lib/format/format";
import { downloadFullCities, fullCitiesEnabled } from "../../lib/reference/referenceData";
import { STATION_SOURCES } from "../../lib/reference/stationSources";
import { useT } from "../../lib/i18n";

// Publish mode is loaded on demand (it pulls in the site renderer + crypto).
const PublishScreen = lazy(() =>
  import("../publish/PublishScreen").then((m) => ({ default: m.PublishScreen })),
);

/**
 * Settings: what counts as a country, offline map packs (with honest tile counts
 * and size estimates — you see how big a region is BEFORE downloading), and your
 * data (export/import, front and centre).
 */
export function SettingsScreen() {
  const t = useT();
  const showToast = useToast((s) => s.show);
  const autoLoadGuides = useSettings((s) => s.autoLoadGuides);
  const setAutoLoadGuides = useSettings((s) => s.setAutoLoadGuides);
  const onlineMap = useSettings((s) => s.onlineMap);
  const setOnlineMap = useSettings((s) => s.setOnlineMap);
  const offlineMode = useSettings((s) => s.offlineMode);
  const setOfflineMode = useSettings((s) => s.setOfflineMode);
  const maxMarkers = useSettings((s) => s.maxMarkers);
  const setMaxMarkers = useSettings((s) => s.setMaxMarkers);
  const optimizeMarkers = useSettings((s) => s.optimizeMarkers);
  const setOptimizeMarkers = useSettings((s) => s.setOptimizeMarkers);
  const showAllMarkers = useSettings((s) => s.showAllMarkers);
  const setShowAllMarkers = useSettings((s) => s.setShowAllMarkers);
  const reduceMapWork = useSettings((s) => s.reduceMapWork);
  const setReduceMapWork = useSettings((s) => s.setReduceMapWork);
  const stationSource = useSettings((s) => s.stationSource);
  const setStationSource = useSettings((s) => s.setStationSource);
  const [progress, setProgress] = useState<Record<string, number | undefined>>({});
  // Downloads are cancelable, and each region remembers when it was last saved
  // (so the button honestly reads "Re-download" instead of pretending it's new).
  const controllers = useRef<Record<string, AbortController | undefined>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string | undefined>>(() => {
    const out: Record<string, string | undefined> = {};
    for (const r of OFFLINE_REGIONS) {
      try {
        out[r.id] = localStorage.getItem(`postcards-region-saved:${r.id}`) ?? undefined;
      } catch {
        /* private mode */
      }
    }
    return out;
  });
  const estimates = useMemo(
    () => Object.fromEntries(OFFLINE_REGIONS.map((r) => [r.id, estimateRegion(r)])),
    [],
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  // The full world city list (~17 MB) is a one-tap download, not bundled.
  const [citiesDl, setCitiesDl] = useState<"idle" | "busy" | "done">(
    fullCitiesEnabled() ? "done" : "idle",
  );
  const resetRef = useRef<HTMLDivElement>(null);
  useModalKeys(resetRef, () => setConfirmReset(false), { enabled: confirmReset });

  async function onDownloadCities() {
    setCitiesDl("busy");
    const ok = await downloadFullCities();
    setCitiesDl(ok ? "done" : "idle");
    showToast(ok ? t("settings.cities.toast.done") : t("settings.cities.toast.failed"));
  }

  // Deletes ONLY map caches and map view preferences. Your places, journal and
  // backups are untouched (they live in IndexedDB, not the tile cache).
  async function resetMaps() {
    for (const r of OFFLINE_REGIONS) controllers.current[r.id]?.abort();
    try {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("osm-tiles")).map((n) => caches.delete(n)),
      );
    } catch {
      /* cache API unavailable: nothing stored anyway */
    }
    try {
      for (const r of OFFLINE_REGIONS) localStorage.removeItem(`postcards-region-saved:${r.id}`);
      for (const k of ["postcards-basemap", "postcards-globe", "postcards-towns", "postcards-countries", "postcards-map-mode", "postcards-city-filter", "postcards-hint-offline"])
        localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
    setSavedAt({});
    setConfirmReset(false);
    showToast(t("settings.offline.toast.reset"));
  }

  async function download(r: OfflineRegion) {
    if (progress[r.id] != null) return;
    const ctl = new AbortController();
    controllers.current[r.id] = ctl;
    setProgress((p) => ({ ...p, [r.id]: 0 }));
    try {
      const res = await saveAreaOffline(r.bounds, r.baseZoom, {
        levels: r.levels,
        maxTiles: REGION_MAX_TILES,
        signal: ctl.signal,
        onProgress: (p) => setProgress((s) => ({ ...s, [r.id]: p.total ? p.done / p.total : 1 })),
      });
      if (ctl.signal.aborted) {
        showToast(t("settings.offline.toast.cancelled", { region: r.name }));
      } else {
        const now = new Date().toISOString().slice(0, 10);
        try {
          localStorage.setItem(`postcards-region-saved:${r.id}`, now);
        } catch {
          /* private mode */
        }
        setSavedAt((sv) => ({ ...sv, [r.id]: now }));
        showToast(
          res.failed === 0
            ? t("settings.offline.toast.saved", { region: r.name, count: formatInt(res.saved) })
            : t("settings.offline.toast.savedPartial", {
                region: r.name,
                saved: formatInt(res.saved),
                failed: formatInt(res.failed),
              }),
        );
      }
    } catch {
      showToast(t("settings.offline.toast.failed", { region: r.name }));
    } finally {
      controllers.current[r.id] = undefined;
      setProgress((p) => ({ ...p, [r.id]: undefined }));
    }
  }

  return (
    <section aria-label={t("settings.title")}>
      <div className="section-head">
        <h2>{t("settings.title")}</h2>
      </div>

      {/* Appearance — two self-evident pickers, no prose. */}
      <section className="settings-section">
        <h3>{t("settings.appearance.title")}</h3>
        <ThemeToggle />
        <LanguageToggle />
      </section>

      {/* Offline mode — the master "self-contained" switch. One flip guarantees
          zero optional egress across the whole app (map, guides, everything). */}
      <section className="settings-section">
        <h3>🔒 {t("settings.offlineMode.title")}</h3>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={offlineMode}
            onChange={(e) => setOfflineMode(e.target.checked)}
          />
          <span>{t("settings.offlineMode.toggle")}</span>
        </label>
        <p className="muted small">{t("settings.offlineMode.desc")}</p>
      </section>

      {/* Online features — EVERYTHING that reaches the internet, in one place, so a
          user always knows exactly what can leave the device. All of it is governed
          by Offline mode above: flip that on and these are disabled. */}
      <section className="settings-section">
        <h3>🌐 {t("settings.online.title")}</h3>
        <p className="muted small">{t("settings.online.desc")}</p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={onlineMap && !offlineMode}
            disabled={offlineMode}
            onChange={(e) => setOnlineMap(e.target.checked)}
          />
          <span>{t("settings.detailedMap.toggle")}</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={autoLoadGuides && !offlineMode}
            disabled={offlineMode}
            onChange={(e) => setAutoLoadGuides(e.target.checked)}
          />
          <span>{t("settings.guides.toggle")}</span>
        </label>
        {offlineMode && <p className="muted small">{t("settings.online.offlineNote")}</p>}
      </section>

      {/* Places — what counts as a country. */}
      <section className="settings-section">
        <h3>{t("settings.places.title")}</h3>
        <div className="picker-label">
          <span>{t("settings.scope.title")}</span>
          <ScopeToggle />
        </div>
        <p className="muted small">{t("settings.scope.desc")}</p>

        {/* Which railway-station dataset to load — you choose the data you carry.
            The recommended one is bundled; picking it (or another) applies live. */}
        <label className="picker-label setting-picker" htmlFor="station-source">
          {t("settings.stations.title")}
          <select
            id="station-source"
            className="select"
            value={stationSource}
            onChange={(e) => setStationSource(e.target.value as (typeof STATION_SOURCES)[number]["id"])}
          >
            {STATION_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`settings.stations.source.${s.id}` as const)}
                {s.recommended ? ` · ${t("settings.stations.recommended")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">{t(`settings.stations.desc.${stationSource}` as const)}</p>
      </section>

      {/* Optimisation — the map-performance controls, grouped so a user whose
          map lags or piles up has one place to fix it: collapse crowded regions
          to one flag, and cap how many browse markers draw at once. */}
      <section className="settings-section">
        <h3>{t("settings.optimize.title")}</h3>
        <p className="muted small">{t("settings.optimize.intro")}</p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={optimizeMarkers}
            onChange={(e) => setOptimizeMarkers(e.target.checked)}
          />
          <span>{t("settings.map.optimize")}</span>
        </label>
        <p className="muted small">{t("settings.map.optimizeDesc")}</p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={showAllMarkers}
            onChange={(e) => setShowAllMarkers(e.target.checked)}
          />
          <span>{t("settings.map.showAll")}</span>
        </label>
        <p className="muted small">{t("settings.map.showAllDesc")}</p>
        <label className="picker-label setting-picker" htmlFor="max-markers">
          {t("settings.detailedMap.maxMarkers")}
          <select
            id="max-markers"
            className="select"
            value={maxMarkers}
            onChange={(e) => setMaxMarkers(Number(e.target.value))}
          >
            {MARKER_CAP_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === Infinity ? t("settings.detailedMap.unlimited") : n}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">{t("settings.optimize.markersDesc")}</p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={reduceMapWork}
            onChange={(e) => setReduceMapWork(e.target.checked)}
          />
          <span>{t("settings.map.reduceWork")}</span>
        </label>
        <p className="muted small">{t("settings.map.reduceWorkDesc")}</p>
      </section>

      {/* Map — offline packs (the online basemap toggle lives under Online
          features above). Tucked into a disclosure so the page isn't dominated
          by the region list. */}
      <section className="settings-section">
        <h3>{t("settings.map.title")}</h3>
        <details className="settings-details">
          <summary>{t("settings.map.advanced")}</summary>
          <p className="muted small">{t("settings.offline.desc")}</p>
          {offlineMode && <p className="muted small">{t("settings.offline.offlineNote")}</p>}
          <ul className="region-list">
            {OFFLINE_REGIONS.map((r) => {
              const est = estimates[r.id]!;
              const p = progress[r.id];
              return (
                <li key={r.id} className="region-row">
                  <span className="region-emoji" aria-hidden>
                    {r.emoji}
                  </span>
                  <span className="region-name">
                    {r.name}
                    <span className="muted small">
                      {" "}
                      {t("settings.offline.tileMeta", { tiles: formatInt(est.tiles), mb: est.mb })}
                      {est.capped ? t("settings.offline.cappedSuffix") : ""}
                      {savedAt[r.id]
                        ? t("settings.offline.savedSuffix", { date: savedAt[r.id]! })
                        : ""}
                    </span>
                  </span>
                  {p == null ? (
                    <button
                      className="mini-btn"
                      type="button"
                      disabled={offlineMode}
                      onClick={() => void download(r)}
                    >
                      {savedAt[r.id]
                        ? `⟳ ${t("settings.offline.redownload")}`
                        : `⬇ ${t("settings.offline.download")}`}
                    </button>
                  ) : (
                    <>
                      <span className="region-progress" role="status">
                        {Math.round(p * 100)}%
                      </span>
                      <button
                        className="link-danger"
                        type="button"
                        onClick={() => controllers.current[r.id]?.abort()}
                      >
                        {t("common.cancel")}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted small">{t("settings.offline.sizeNote")}</p>

          {/* The full world city list — bundled app keeps only the top 10k; the
              long tail (small towns & villages) is a one-tap ~17 MB download,
              cached offline like a tile pack. */}
          <div className="region-row cities-pack">
            <span className="region-emoji" aria-hidden>
              🏙️
            </span>
            <span className="region-name">
              {t("settings.cities.title")}
              <span className="muted small"> {t("settings.cities.meta")}</span>
            </span>
            {citiesDl === "done" ? (
              <span className="muted small" role="status">
                ✓ {t("settings.cities.downloaded")}
              </span>
            ) : (
              <button
                className="mini-btn"
                type="button"
                disabled={offlineMode || citiesDl === "busy"}
                onClick={() => void onDownloadCities()}
              >
                {citiesDl === "busy"
                  ? t("settings.cities.downloading")
                  : `⬇ ${t("settings.cities.download")}`}
              </button>
            )}
          </div>

          <button className="link-danger" type="button" onClick={() => setConfirmReset(true)}>
            {t("settings.offline.reset")}
          </button>
        </details>
        {confirmReset && (
          <div className="modal-backdrop" onClick={() => setConfirmReset(false)}>
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={t("settings.offline.resetAria")}
              ref={resetRef}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{t("settings.offline.resetTitle")}</h2>
              <p className="muted">{t("settings.offline.resetBody")}</p>
              <div className="trip-form-actions">
                <button className="btn" type="button" autoFocus onClick={() => void resetMaps()}>
                  {t("settings.offline.resetConfirm")}
                </button>
                <button className="btn-ghost" type="button" onClick={() => setConfirmReset(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Community data packs */}
      <DataPacksSection />

      {/* Publish & sync */}
      <section className="settings-section">
        <h3>{t("settings.publish.title")}</h3>
        <p className="muted small">{t("settings.publish.desc")}</p>
        <button className="btn" type="button" onClick={() => setPublishOpen(true)}>
          🌍 {t("settings.publish.button")}
        </button>
      </section>

      <SyncSection />

      {/* Your data */}
      <section className="settings-section">
        <Backup />
        <p className="muted small">{t("settings.data.cloudNote")}</p>
      </section>

      <Attribution />

      {publishOpen && (
        <Suspense fallback={null}>
          <PublishScreen onClose={() => setPublishOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}

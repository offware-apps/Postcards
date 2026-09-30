import { useEffect, useRef, useState } from "react";
import { useDataPacks } from "../../lib/packs/store";
import { useToast } from "../../lib/store/useToast";
import { useSettings } from "../../lib/store/useSettings";
import { useT } from "../../lib/i18n";

/**
 * Community data packs — install an openly-licensed set of places (POIs, metro
 * stations, huts…) by pasting a GitHub link or importing a file. A pack is inert
 * REFERENCE data: parsed, validated and sanitized, never executed, and it always
 * carries its licence/provenance. Its places become searchable + mappable +
 * markable-visited; removing a pack never touches your journal.
 */
export function DataPacksSection() {
  const t = useT();
  const showToast = useToast((s) => s.show);
  const packs = useDataPacks((s) => s.packs);
  const loaded = useDataPacks((s) => s.loaded);
  const load = useDataPacks((s) => s.load);
  const addFromUrl = useDataPacks((s) => s.addFromUrl);
  const addFromText = useDataPacks((s) => s.addFromText);
  const remove = useDataPacks((s) => s.remove);
  // Offline mode blocks fetching a pack from a URL (that's a network request);
  // importing a pack FILE stays available — it's read straight off the device.
  const offlineMode = useSettings((s) => s.offlineMode);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Ensure the list is populated even if Settings is the first screen touched.
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  async function onAddUrl() {
    if (!url.trim() || busy) return;
    setBusy(true);
    const r = await addFromUrl(url.trim());
    setBusy(false);
    if (r.ok) {
      setUrl("");
      showToast(t("settings.packs.toast.added", { name: r.name ?? "", count: r.count ?? 0 }));
    } else {
      showToast(r.error ?? t("settings.packs.toast.failed"));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    let text = "";
    try {
      text = await file.text();
    } catch {
      setBusy(false);
      showToast(t("settings.packs.toast.failed"));
      return;
    }
    const r = await addFromText(text, null);
    setBusy(false);
    if (r.ok) showToast(t("settings.packs.toast.added", { name: r.name ?? "", count: r.count ?? 0 }));
    else showToast(r.error ?? t("settings.packs.toast.failed"));
  }

  return (
    <section className="settings-section">
      <h3>{t("settings.packs.title")}</h3>
      <p className="muted small">{t("settings.packs.desc")}</p>

      <label className="picker-label" htmlFor="pack-url">
        <span>{t("settings.packs.urlLabel")}</span>
        <input
          id="pack-url"
          className="select"
          title={t("settings.packs.urlLabel")}
          type="url"
          inputMode="url"
          placeholder="https://github.com/…/pack.json"
          value={url}
          disabled={offlineMode}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {offlineMode && <p className="muted small">{t("settings.packs.offlineNote")}</p>}
      <div className="publish-actions">
        <button
          className="btn"
          type="button"
          title={t("settings.packs.add")}
          disabled={busy || offlineMode || !url.trim()}
          onClick={() => void onAddUrl()}
        >
          {busy ? t("settings.packs.adding") : t("settings.packs.add")}
        </button>
        <button
          className="btn-ghost"
          type="button"
          title={t("settings.packs.importFile")}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {t("settings.packs.importFile")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onFile(e)}
        />
      </div>

      {packs.length > 0 && (
        <ul className="region-list packs-list">
          {packs.map((p) => (
            <li key={p.id} className="region-row">
              <span className="region-name">
                {p.pack.name}
                <span className="muted small">
                  {" "}
                  {t("settings.packs.meta", {
                    count: p.pack.places.length,
                    license: p.pack.license,
                  })}
                  {p.pack.attribution ? ` · ${p.pack.attribution}` : ""}
                </span>
              </span>
              <button
                className="link-danger"
                type="button"
                aria-label={t("settings.packs.removeAria", { name: p.pack.name })}
                title={t("settings.packs.removeAria", { name: p.pack.name })}
                onClick={() => {
                  void remove(p.id);
                  showToast(t("settings.packs.toast.removed", { name: p.pack.name }));
                }}
              >
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

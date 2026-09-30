import { useEffect, useRef } from "react";
import {
  useFilters,
  POP_CHOICES,
  type FilterStatus,
  type SortOrder,
} from "../lib/store/useFilters";
import { rangeExactYear, yearRange } from "../features/travel/period";
import { useT } from "../lib/i18n";

/**
 * The ONE Filter panel (spec 016). A focus-trapped dialog that hosts every slicing
 * dimension so no screen sprinkles filter buttons in its header. Reads and writes
 * the shared `useFilters` store, so the map and Places update together. Escape /
 * scrim close it; focus returns to the trigger; applied filters persist.
 */
export function FilterPanel({
  open,
  onClose,
  folders,
  years,
  showStatus = true,
  showGrowth = false,
  continents = [],
}: {
  open: boolean;
  onClose: () => void;
  /** Folder / trip names in use, for the folder picker ("" = all). */
  folders: string[];
  /** Years present in the user's data + whether any record is undated. */
  years: { list: string[]; undated: boolean };
  /** Places owns status via its tabs, so it hides the panel's Status section. */
  showStatus?: boolean;
  /** Show the growth dimensions (favourites-only / has-photo / has-note / continent).
   *  These act on saved records, so only the record-based screens (Places) opt in. */
  showGrowth?: boolean;
  /** Continents present in the user's data, for the continent picker ("" = all). */
  continents?: string[];
}) {
  const t = useT();
  const f = useFilters();
  const panelRef = useRef<HTMLDivElement>(null);
  // Hosts pass an inline onClose, so a filter tap hands a new one; reading it through
  // a ref keeps the focus effect from re-running (and re-focusing the panel) on it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus the panel on open; restore focus to the opener on close; Escape closes;
  // Tab is trapped inside the panel (contracts/panel-a11y.md).
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = panelRef.current;
    node?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const activeYear =
    f.date.mode === "all" ? "all" : f.date.mode === "undated" ? "none" : rangeExactYear(f.date);
  const rangeFrom = f.date.mode === "range" ? f.date.from : "";
  const rangeTo = f.date.mode === "range" ? f.date.to : "";
  const setRange = (from: string, to: string) =>
    f.set({ date: from || to ? { mode: "range", from, to } : { mode: "all" } });

  const STATUS: FilterStatus[] = ["visited", "wishlist", "unvisited"];
  const SORTS: SortOrder[] = ["pop", "az"];

  return (
    <div className="filter-scrim" onClick={onClose}>
      <div
        className="filter-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("filter.title")}
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="filter-panel-head">
          <h2>{t("filter.title")}</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("filter.done")}
          </button>
        </div>

        {/* Scope — apply the filter to the map + lists, or narrow the lists only
            while the map keeps every place. A meta-choice, so it's up top. */}
        <div className="filter-section">
          <span className="filter-section-title">{t("filter.scope.title")}</span>
          <div className="segmented wrap" role="group" aria-label={t("filter.scope.title")}>
            <button
              type="button"
              aria-pressed={!f.listOnly}
              className={!f.listOnly ? "seg-on" : ""}
              onClick={() => f.set({ listOnly: false })}
            >
              {t("filter.scope.both")}
            </button>
            <button
              type="button"
              aria-pressed={f.listOnly}
              className={f.listOnly ? "seg-on" : ""}
              onClick={() => f.set({ listOnly: true })}
            >
              {t("filter.scope.listOnly")}
            </button>
          </div>
        </div>

        {/* Place-kind mode (cities / monuments / airports) is NOT here: it's a
            first-class map control (its own prominent pill), because those are
            different datasets, not just another way to slice one list. */}

        {/* Status — MULTI-SELECT: tap any combination of visited / want-list /
            not-visited (toggle buttons, aria-pressed). None selected = show all
            (the default), so you see everything and narrow to any mix fast. */}
        {showStatus && (
          <div className="filter-section">
            <span className="filter-section-title">{t("filter.status.title")}</span>
            <div className="segmented wrap" role="group" aria-label={t("filter.status.title")}>
              {STATUS.map((s) => {
                const on = f.status.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    className={on ? "seg-on" : ""}
                    onClick={() =>
                      f.set({
                        status: on ? f.status.filter((x) => x !== s) : [...f.status, s],
                      })
                    }
                  >
                    {t(`filter.status.${s}` as const)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* People (population) */}
        <div className="filter-section">
          <span className="filter-section-title">👥 {t("filter.people.title")}</span>
          <div className="segmented wrap" role="group" aria-label={t("filter.people.title")}>
            {POP_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={f.minPop === n}
                className={f.minPop === n ? "seg-on" : ""}
                onClick={() => f.set({ minPop: n })}
              >
                {n === 0 ? t("filter.people.any") : n === 10_000 ? "10k+" : n === 100_000 ? "100k+" : "1M+"}
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        {(years.list.length > 0 || years.undated) && (
          <div className="filter-section">
            <span className="filter-section-title">{t("filter.date.title")}</span>
            <div className="segmented wrap" role="group" aria-label={t("filter.date.title")}>
              {["all", ...years.list, ...(years.undated ? ["none"] : [])].map((y) => (
                <button
                  key={y}
                  type="button"
                  aria-pressed={activeYear === y}
                  className={activeYear === y ? "seg-on" : ""}
                  onClick={() =>
                    f.set({
                      date:
                        y === "all"
                          ? { mode: "all" }
                          : y === "none"
                            ? { mode: "undated" }
                            : { mode: "range", ...yearRange(y) },
                    })
                  }
                >
                  {y === "all" ? t("filter.date.any") : y === "none" ? t("filter.date.undated") : y}
                </button>
              ))}
            </div>
            <div className="filter-range">
              <label className="picker-label">
                <span className="small">{t("filter.date.from")}</span>
                <input
                  type="date"
                  className="select"
                  value={rangeFrom}
                  onChange={(e) => setRange(e.target.value, rangeTo)}
                />
              </label>
              <label className="picker-label">
                <span className="small">{t("filter.date.to")}</span>
                <input
                  type="date"
                  className="select"
                  value={rangeTo}
                  onChange={(e) => setRange(rangeFrom, e.target.value)}
                />
              </label>
            </div>
          </div>
        )}

        {/* Folder / trip */}
        {folders.length > 0 && (
          <div className="filter-section">
            <label className="picker-label" htmlFor="filter-folder">
              <span className="filter-section-title">{t("filter.folder.title")}</span>
              <select
                id="filter-folder"
                className="select"
                value={f.folder}
                onChange={(e) => f.set({ folder: e.target.value })}
              >
                <option value="">{t("filter.folder.all")}</option>
                {folders.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Sort */}
        <div className="filter-section">
          <span className="filter-section-title">{t("filter.sort.title")}</span>
          <div className="segmented wrap" role="group" aria-label={t("filter.sort.title")}>
            {SORTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={f.sort === s}
                className={f.sort === s ? "seg-on" : ""}
                onClick={() => f.set({ sort: s })}
              >
                {s === "pop" ? t("filter.sort.pop") : t("filter.sort.az")}
              </button>
            ))}
          </div>
        </div>

        {/* More (growth dimensions) — record-based screens only */}
        {showGrowth && (
          <div className="filter-section">
            <span className="filter-section-title">{t("filter.more.title")}</span>
            <div className="segmented wrap" role="group" aria-label={t("filter.more.title")}>
              <button
                type="button"
                aria-pressed={f.favoritesOnly}
                className={f.favoritesOnly ? "seg-on" : ""}
                onClick={() => f.set({ favoritesOnly: !f.favoritesOnly })}
              >
                ♥ {t("filter.favoritesOnly")}
              </button>
              <button
                type="button"
                aria-pressed={f.hasPhoto}
                className={f.hasPhoto ? "seg-on" : ""}
                onClick={() => f.set({ hasPhoto: !f.hasPhoto })}
              >
                📷 {t("filter.hasPhoto")}
              </button>
              <button
                type="button"
                aria-pressed={f.hasNote}
                className={f.hasNote ? "seg-on" : ""}
                onClick={() => f.set({ hasNote: !f.hasNote })}
              >
                📝 {t("filter.hasNote")}
              </button>
            </div>
            {continents.length > 0 && (
              <label className="picker-label filter-continent" htmlFor="filter-continent">
                <span className="filter-section-title">{t("filter.continent.title")}</span>
                <select
                  id="filter-continent"
                  className="select"
                  value={f.continent}
                  onChange={(e) => f.set({ continent: e.target.value })}
                >
                  <option value="">{t("filter.continent.all")}</option>
                  {continents.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <div className="filter-panel-foot">
          <button type="button" className="link" onClick={() => f.clearAll()}>
            {t("filter.clearAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

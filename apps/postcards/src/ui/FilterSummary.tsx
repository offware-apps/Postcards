import { useFilters, currentFilters, type FilterState } from "../lib/store/useFilters";
import { activeChips } from "../features/filter/applyFilters";
import { getReferenceData } from "../lib/reference/referenceData";
import { useT } from "../lib/i18n";

/**
 * The compact active-filter summary (spec 016 US2). One removable chip per
 * non-default dimension, plus a Clear all. Reads the shared `useFilters` store
 * so it always mirrors what the panel and the lists are doing; renders nothing
 * when no filter is active. Each chip's ✕ resets exactly its own dimension.
 *
 * `exclude` drops chips a given screen doesn't act on (Places owns status via its
 * tabs and has no map mode, so it excludes those), keeping the summary honest.
 */
export function FilterSummary({ exclude = [] }: { exclude?: (keyof FilterState)[] }) {
  const t = useT();
  const f = useFilters();
  const state = currentFilters(f);
  const chips = activeChips(state, t, getReferenceData()).filter((c) => !exclude.includes(c.field));
  if (chips.length === 0) return null;
  return (
    <div className="filter-summary" role="group" aria-label={t("filter.summaryAria")}>
      {chips.map((chip) => (
        <span key={String(chip.field)} className="filter-chip">
          <span className="filter-chip-label">{chip.label}</span>
          <button
            type="button"
            className="filter-chip-x"
            aria-label={t("filter.removeAria", { label: chip.label })}
            title={t("filter.removeAria", { label: chip.label })}
            onClick={() => f.clearField(chip.field)}
          >
            ✕
          </button>
        </span>
      ))}
      <button
        type="button"
        className="link filter-summary-clear"
        title={t("filter.clearAll")}
        onClick={() => f.clearAll()}
      >
        {t("filter.clearAll")}
      </button>
    </div>
  );
}

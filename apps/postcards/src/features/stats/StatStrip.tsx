import { useMemo } from "react";
import { useVisits } from "../../lib/store/useVisits";
import { useSettings } from "../../lib/store/useSettings";
import { useUi, type PlacesView } from "../../lib/store/useUi";
import { useFilters } from "../../lib/store/useFilters";
import { getReferenceData } from "../../lib/reference/referenceData";
import { computeCoverage } from "./computeStats";
import { formatInt, formatPercent, formatPercentFloor } from "../../lib/format/format";
import { useT } from "../../lib/i18n";

/** Compact counter strip. Every counter is a shortcut: tap it to open the
 *  matching Places view (been → visited, want → wishlist, fav → favourites…). */
export function StatStrip() {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const scope = useSettings((s) => s.countryScope);
  const openPlaces = useUi((s) => s.openPlaces);

  const stats = useMemo(() => {
    const cov = computeCoverage(visits, ref, scope);
    let want = 0;
    let fav = 0;
    for (const v of visits) {
      if (v.status === "wishlist") want++;
      if (v.favorite) fav++;
    }
    return { cov, want, fav };
  }, [visits, ref, scope]);

  function Counter({
    num,
    den,
    pct,
    label,
    cls,
    view,
  }: {
    num: number;
    den?: number;
    /** Optional share (0..1) shown next to the fraction — e.g. "3/50 · 6%". */
    pct?: number;
    label: string;
    cls?: string;
    view: PlacesView;
  }) {
    // A tiny-but-nonzero coverage rounds to "0%", which reads as "none visited"
    // even after you've been somewhere. Floor it to "<1%" (same as the hero).
    const pctLabel = pct != null ? formatPercentFloor(pct) : null;
    const aria =
      pct != null
        ? t("statStrip.visitedAria", {
            num: formatInt(num),
            den: formatInt(den ?? num),
            label,
            pct: pctLabel ?? formatPercent(pct),
          })
        : t("statStrip.openAria", { label });
    return (
      <button
        type="button"
        className="ss-item"
        onClick={() => {
          // World-level shortcut — drop the WHOLE country drill-down a stats card
          // may have set (country AND minPop), so the list matches this counter's
          // number instead of staying gated at the last tier you opened.
          useFilters.getState().set({ country: "", minPop: 0 });
          openPlaces(view);
        }}
        title={t("statStrip.openAria", { label })}
        aria-label={aria}
      >
        <span className={"ss-num" + (cls ? ` ${cls}` : "")}>
          {formatInt(num)}
          {den != null && <span className="ss-den">/{formatInt(den)}</span>}
          {pctLabel != null && <span className="ss-pct">{pctLabel}</span>}
        </span>
        <span className="ss-label">{label}</span>
      </button>
    );
  }

  return (
    <div className="stat-strip" aria-label={t("statStrip.totalsAria")}>
      <Counter
        num={stats.cov.countriesVisited}
        den={stats.cov.worldCountryCount}
        pct={stats.cov.worldPct}
        label={t("statStrip.countries")}
        view="countries"
      />
      <span className="ss-sep" aria-hidden />
      <Counter num={stats.cov.citiesVisited} label={t("statStrip.been")} cls="ss-been" view="visited" />
      {stats.cov.stationsVisited > 0 && (
        <Counter num={stats.cov.stationsVisited} label={t("statStrip.stations")} cls="ss-sta" view="stations" />
      )}
      {stats.cov.airportsVisited > 0 && (
        <Counter num={stats.cov.airportsVisited} label={t("statStrip.airports")} cls="ss-air" view="airports" />
      )}
      <Counter num={stats.want} label={t("statStrip.want")} cls="ss-want" view="wishlist" />
      <Counter num={stats.fav} label={t("statStrip.fav")} cls="ss-fav" view="favorites" />
    </div>
  );
}

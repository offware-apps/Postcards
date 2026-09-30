import { useEffect, useMemo, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import type { Country } from "../../lib/reference/types";
import { useVisits } from "../../lib/store/useVisits";
import { useUi } from "../../lib/store/useUi";
import { useSettings } from "../../lib/store/useSettings";
import { useToast } from "../../lib/store/useToast";
import { computeCoverage, visitedCountryIds } from "../stats/computeStats";
import { coordsOf } from "../travel/distance";
import { inScope } from "../../lib/reference/scope";
import { countryFlag, formatInt } from "../../lib/format/format";
import { ScopeToggle } from "../../ui/ScopeToggle";
import { renderPoster } from "./poster";
import { ListPager } from "../../ui/ListPager";
import { useT } from "../../lib/i18n";

/** One flag in the passport grid — a button that opens its country's page. */
function FlagCard({ c, locked }: { c: Country; locked?: boolean }) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        className={"flag-card" + (locked ? " flag-locked" : "")}
        title={t("stats.country.open", { name: c.name })}
        onClick={() => useUi.getState().openCountry(c.iso2)}
      >
        <span className="flag-big" aria-hidden>
          {countryFlag(c.iso2)}
        </span>
        <span className="flag-name" title={c.name}>
          {c.name}
        </span>
      </button>
    </li>
  );
}

/**
 * Your passport: the flags you've collected (one per visited country — a city
 * visit collects its country's flag), and a downloadable PNG poster of your
 * world. All rendered on-device. `embedded` renders it as a view inside the
 * Places screen (smaller heading under the Places one).
 */
export function PassportScreen({ embedded }: { embedded?: boolean } = {}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const scope = useSettings((s) => s.countryScope);
  const showToast = useToast((s) => s.show);
  const [showMissing, setShowMissing] = useState(false);
  const [rendering, setRendering] = useState(false);
  // The rendered poster is SHOWN first (a preview overlay); downloading is a
  // button inside it — not a silent file drop.
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  function closePoster() {
    setPosterUrl(null);
  }
  // The object URL is revoked here — on close, on replace AND on unmount
  // (closing by switching tabs must not leak the rendered PNG).
  useEffect(() => {
    if (!posterUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPosterUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      URL.revokeObjectURL(posterUrl);
    };
  }, [posterUrl]);

  const visitedIds = useMemo(() => visitedCountryIds(visits), [visits]);
  const { collectedCount, missing, continents } = useMemo(() => {
    const all = ref.countries.filter((c) => inScope(c.sovereignty, scope));
    const collectedCount = all.filter((c) => visitedIds.has(c.iso2)).length;
    const missing = all.filter((c) => !visitedIds.has(c.iso2));
    // Collected flags grouped by continent, each with its own progress, so the
    // passport reads like pages of a real one.
    const byCont = new Map<string, { done: typeof all; total: number }>();
    for (const c of all) {
      const key = c.continent || "Elsewhere";
      if (!byCont.has(key)) byCont.set(key, { done: [], total: 0 });
      const g = byCont.get(key)!;
      g.total += 1;
      if (visitedIds.has(c.iso2)) g.done.push(c);
    }
    const continents = [...byCont.entries()]
      .filter(([, g]) => g.done.length > 0)
      .map(([name, g]) => ({ name, done: g.done, total: g.total }))
      .sort((a, b) => b.done.length - a.done.length || a.name.localeCompare(b.name));
    return { collectedCount, missing, continents };
  }, [ref, visitedIds, scope]);
  const [shownMissing, setShownMissing] = useState(60);

  // Where to stamp a visited country whose geometry the basemap lacks (Kosovo,
  // Tuvalu, overseas territories…): the coordinates of a place you visited there.
  // Nothing is invented — the anchor comes from the gazetteer/your own record.
  const fallbackAnchors = useMemo(() => {
    const anchors = new Map<string, [number, number]>();
    for (const v of visits) {
      if (v.status === "wishlist" || anchors.has(v.place.countryId)) continue;
      const c = coordsOf(v.place, ref);
      if (c) anchors.set(v.place.countryId, [c.lon, c.lat]);
    }
    return anchors;
  }, [visits, ref]);

  async function exportPoster() {
    setRendering(true);
    try {
      const cov = computeCoverage(visits, ref, scope);
      // Stamp only in-scope countries, so the flags match the caption count
      // and the flag grid (both already scope-filtered).
      const stampIds = new Set(
        [...visitedIds].filter((iso2) => {
          const c = ref.countryByIso2(iso2);
          return !!c && inScope(c.sovereignty, scope);
        }),
      );
      const blob = await renderPoster(stampIds, ref, {
        countries: cov.countriesVisited,
        cities: cov.citiesVisited,
      }, { anchors: fallbackAnchors });
      setPosterUrl(URL.createObjectURL(blob));
    } catch {
      showToast(t("passport.toast.posterErr"));
    } finally {
      setRendering(false);
    }
  }

  return (
    <section aria-label={t("passport.title")}>
      <div className="section-head">
        {/* Embedded inside Places, the Places header carries the title. */}
        {!embedded && <h2>{t("passport.title")}</h2>}
        <ScopeToggle />
      </div>

      <div className="passport-head">
        <p className="muted">
          <strong className="flags-count">{formatInt(collectedCount)}</strong>{" "}
          {t("passport.ofFlags", { total: formatInt(collectedCount + missing.length) })}
        </p>
        <button className="btn" type="button" disabled={rendering} onClick={() => void exportPoster()}>
          {rendering ? t("passport.rendering") : `🖼 ${t("passport.worldPoster")}`}
        </button>
      </div>

      {collectedCount === 0 ? (
        <p className="muted empty">
          <span className="empty-emoji" aria-hidden>
            🛂
          </span>
          {t("passport.empty")}
        </p>
      ) : (
        continents.map((cont) => (
          <section key={cont.name} className="passport-continent">
            <h3>
              {cont.name}{" "}
              <span className="muted small">
                {t("passport.continentProgress", { done: cont.done.length, total: cont.total })}
              </span>
            </h3>
            <ul className="flag-grid">
              {cont.done.map((c) => (
                <FlagCard key={c.iso2} c={c} />
              ))}
            </ul>
          </section>
        ))
      )}

      <button
        className="link"
        type="button"
        aria-expanded={showMissing}
        onClick={() => setShowMissing((s) => !s)}
      >
        {showMissing
          ? t("passport.hideToCollect", { count: formatInt(missing.length) })
          : t("passport.showToCollect", { count: formatInt(missing.length) })}
      </button>
      {posterUrl && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={t("passport.posterAria")} onClick={closePoster}>
          <img className="lightbox-img" src={posterUrl} alt={t("passport.posterAlt")} />
          <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
            <a className="mini-btn" href={posterUrl} download="postcards-world.png">
              ⬇ {t("passport.downloadPng")}
            </a>
            <button className="btn-ghost" type="button" autoFocus onClick={closePoster}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}

      {showMissing && (
        <>
        <ul className="flag-grid">
          {missing.slice(0, shownMissing).map((c) => (
            <FlagCard key={c.iso2} c={c} locked />
          ))}
        </ul>
        {missing.length > shownMissing && (
          <ListPager
            shown={shownMissing}
            total={missing.length}
            step={60}
            onMore={() => setShownMissing((n) => n + 60)}
          />
        )}
        </>
      )}
    </section>
  );
}

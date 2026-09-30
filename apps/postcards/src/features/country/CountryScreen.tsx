import { useMemo, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useGazetteerGeneration } from "../../lib/reference/useGazetteer";
import { useVisits } from "../../lib/store/useVisits";
import { useUi } from "../../lib/store/useUi";
import { computeCountryCoverage, countryDetail } from "../stats/computeStats";
import { countryFlag, formatInt, formatPercent } from "../../lib/format/format";
import { StateToggles } from "../visits/StateToggles";
import { GuideSection } from "../guides/GuideButton";
import { CityLine } from "../../ui/CityLine";
import { ListPager } from "../../ui/ListPager";
import { useT } from "../../lib/i18n";

const PAGE = 50;

/**
 * The per-country page (opened from a Passport flag, a stats card, or the
 * countries checklist): what the country is made of — its cities, regions and
 * sites — and how much of it you've seen.
 */
export function CountryScreen({ iso2, onBack }: { iso2: string; onBack: () => void }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  // The full-gazetteer upgrade grows this country's city list + denominators.
  const gazGen = useGazetteerGeneration();
  const visits = useVisits((s) => s.visits);
  const flyTo = useUi((s) => s.flyTo);
  const [shown, setShown] = useState(PAGE);
  const [shownSites, setShownSites] = useState(PAGE);

  const country = ref.countryByIso2(iso2);
  /* eslint-disable react-hooks/exhaustive-deps */
  const cities = useMemo(() => ref.citiesOf(iso2), [ref, iso2, gazGen]); // population-desc
  const sites = useMemo(() => ref.heritageOf(iso2), [ref, iso2]);
  const languages = ref.languagesOf(iso2);
  const cov = useMemo(() => computeCountryCoverage(visits, ref, iso2), [visits, ref, iso2, gazGen]);
  const detail = useMemo(() => countryDetail(visits, ref, iso2), [visits, ref, iso2, gazGen]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!country) {
    return (
      <div className="screen city-page">
        <button className="mini-btn back-btn" type="button" title={t("city.back")} onClick={onBack}>
          ← {t("city.back")}
        </button>
        <p className="notice">{t("country.unknownCode", { iso2 })}</p>
      </div>
    );
  }

  function showOnMap() {
    if (!cities.length) return;
    const lat = cities.reduce((s, c) => s + c.lat, 0) / cities.length;
    const lon = cities.reduce((s, c) => s + c.lon, 0) / cities.length;
    flyTo(lon, lat);
  }

  const place = { kind: "country" as const, id: iso2, name: country.name, countryId: iso2 };

  return (
    <div className="screen city-page">
      <button className="mini-btn back-btn" type="button" title={t("city.back")} onClick={onBack}>
        ← {t("city.back")}
      </button>

      <header className="city-hero">
        <span className="city-hero-flag" aria-hidden>
          {countryFlag(iso2)}
        </span>
        <div>
          <h2>{country.name}</h2>
          <p className="muted">
            {country.continent}
            {languages.length > 0 && ` · ${languages.map((l) => l.name).join(", ")}`}
          </p>
        </div>
        <StateToggles place={place} />
      </header>

      <div className="city-facts">
        <span className="fact">
          <strong>{formatInt(country.cityCount)}</strong> {t("country.fact.citiesTowns")}
        </span>
        <span className="fact">
          <strong>{formatInt(country.subdivisionCount)}</strong> {t("country.fact.regions")}
        </span>
        {sites.length > 0 && (
          <span className="fact">
            <strong>{formatInt(sites.length)}</strong> {t("country.fact.sitesLandmarks")}
          </span>
        )}
        {cities.length > 0 && (
          <button
            className="mini-btn"
            type="button"
            title={t("city.showOnMap")}
            onClick={showOnMap}
          >
            {t("city.showOnMap")}
          </button>
        )}
      </div>

      <section className="city-section">
        <h3>{t("country.section.coverage")}</h3>
        <div className="city-facts">
          <span className="fact">
            <strong>{formatPercent(cov.cityPct)}</strong>{" "}
            {t("country.ofCities", { visited: cov.citiesVisited, total: cov.citiesTotal })}
          </span>
          <span className="fact">
            <strong>{formatPercent(cov.regionPct)}</strong>{" "}
            {t("country.ofRegions", { visited: cov.regionsVisited, total: cov.regionsTotal })}
          </span>
          {cov.heritageTotal > 0 && (
            <span className="fact">
              <strong>{formatPercent(cov.heritagePct)}</strong>{" "}
              {t("country.ofSites", { visited: cov.heritageVisited, total: cov.heritageTotal })}
            </span>
          )}
        </div>
        {detail.regionsRemainingNames.length > 0 && (
          <p className="muted small">
            {t("country.regionsToVisit")} {detail.regionsRemainingNames.slice(0, 12).join(", ")}
            {detail.regionsRemainingNames.length > 12
              ? ` ${t("common.moreCount", { count: detail.regionsRemainingNames.length - 12 })}`
              : ""}
          </p>
        )}
      </section>

      <GuideSection place={place} />

      {sites.length > 0 && (
        <section className="city-section">
          <h3>{t("stats.country.metricSites")}</h3>
          <ul className="city-list">
            {sites.slice(0, shownSites).map((h) => (
              <li key={h.id} className="city-row compact">
                <button
                  className="city-focus"
                  type="button"
                  title={t("places.row.openAria", { name: h.name })}
                  onClick={() => useUi.getState().openCity(h.id)}
                >
                  <CityLine flag="🏛️" name={h.name} multiline />
                </button>
                <StateToggles
                  place={{ kind: "heritage", id: h.id, name: h.name, countryId: h.countryIso2 }}
                />
              </li>
            ))}
          </ul>
          {sites.length > shownSites && (
            <ListPager
              shown={shownSites}
              total={sites.length}
              step={Math.min(PAGE, sites.length - shownSites)}
              onMore={() => setShownSites((n) => n + PAGE)}
            />
          )}
        </section>
      )}

      <section className="city-section">
        <h3>{t("country.section.citiesTowns")}</h3>
        <ul className="city-list">
          {cities.slice(0, shown).map((c) => {
            const region = c.subdivisionId ? ref.subdivisionById(c.subdivisionId)?.name : null;
            return (
              <li key={c.id} className="city-row compact">
                <button
                  className="city-focus"
                  type="button"
                  title={t("places.row.openAria", { name: c.name })}
                  onClick={() => useUi.getState().openCity(c.id)}
                >
                  <CityLine
                    flag={countryFlag(iso2)}
                    name={c.name}
                    sub={
                      <>
                        {region ? `· ${region}` : ""}
                        {c.population != null
                          ? ` · ${t("map.cityPeople", { count: formatInt(c.population) })}`
                          : ""}
                      </>
                    }
                  />
                </button>
                <StateToggles
                  place={{ kind: "city", id: c.id, name: c.name, countryId: iso2 }}
                />
              </li>
            );
          })}
        </ul>
        {cities.length > shown && (
          <ListPager
            shown={shown}
            total={cities.length}
            step={Math.min(PAGE, cities.length - shown)}
            onMore={() => setShown((n) => n + PAGE)}
            label={t("map.pagerMostPopulous", { shown, total: formatInt(cities.length) })}
          />
        )}
      </section>
    </div>
  );
}

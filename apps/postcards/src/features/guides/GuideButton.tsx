import { useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useSettings } from "../../lib/store/useSettings";
import { useUi } from "../../lib/store/useUi";
import {
  guidesFor,
  fetchSummary,
  fetchFullText,
  searchUrl,
  type WikivoyageSummary,
  type WikiFullText,
} from "../../lib/wikivoyage";
import type { PlaceRef } from "../../lib/schema/models";
import { useOnlineStatus } from "../../lib/hooks/useOnlineStatus";
import { useT, type MessageKey } from "../../lib/i18n";
import { readGuide, saveGuide } from "./guideCache";

// Stable, language-independent group keys (translated at render via guide.group.*);
// the grouping logic never touches display text.
const KIND_GROUP: Record<string, "explore" | "understand" | "phrasebook"> = {
  place: "explore",
  country: "explore",
  understand: "understand",
  phrasebook: "phrasebook",
};
const GROUP_ORDER = ["explore", "understand", "phrasebook"] as const;

/** Whether the device is offline right now (guides are online-only, opt-in). */
const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

/** Resolve the names a place's guides are built from (common country name —
 *  the real Wikivoyage article title, e.g. "Russia", not "Russian Federation"). */
function guideNames(place: PlaceRef): GuideNames | null {
  const ref = getReferenceData();
  const country = ref.countryByIso2(place.countryId);
  if (!country) return null;
  const countryName = ref.articleNameOf(country.iso2);
  const cityName =
    place.kind === "city" ? ref.cityById(place.id)?.name ?? place.name : undefined;
  // Monuments get THEIR article as the overview (photo of the site, not the
  // country's — whose Wikipedia lead image is usually its flag). Link-building
  // still uses cityName only: Wikivoyage has city guides, rarely monument ones.
  const monumentName =
    place.kind === "heritage" ? ref.heritageById(place.id)?.name ?? place.name : undefined;
  const focusName = cityName ?? monumentName;
  return {
    countryIso2: country.iso2,
    countryName,
    cityName,
    summaryTitle: focusName ?? countryName,
    searchQuery: focusName ? `${focusName} ${countryName}` : countryName,
  };
}

/**
 * A "📖 Guide" affordance for a place, shown in list rows. Rather than a cramped
 * modal (bad on phones), it opens the place's own detail page, which carries the
 * full guides inline (see GuideSection) alongside its photos and journal links.
 */
export function GuideButton({ place, className }: { place: PlaceRef; className?: string }) {
  const t = useT();
  const names = useMemo(() => guideNames(place), [place]);
  if (!names) return null;

  const open = () => {
    const ui = useUi.getState();
    // City/heritage/custom places have a city page; everything else (country,
    // airport) opens the country page — both render the guides inline.
    if (place.kind === "city" || place.kind === "heritage" || place.kind === "custom") {
      ui.openCity(place.id);
    } else {
      ui.openCountry(place.countryId);
    }
  };

  return (
    <button
      type="button"
      className={className ?? "mini-btn"}
      onClick={open}
      aria-label={t("guide.openWithGuides", { name: place.name })}
      title={t("guide.openWithGuides", { name: place.name })}
    >
      📖 <span className="row-btn-label">{t("guide.label")}</span>
    </button>
  );
}

/** The same guides as the modal, rendered as an in-page section (city and
 *  country pages get their guides right on the page, not behind a button). */
export function GuideSection({ place }: { place: PlaceRef }) {
  const t = useT();
  const names = useMemo(() => guideNames(place), [place]);
  if (!names) return null;
  return (
    <section className="city-section guide-section">
      <h3>{t("guide.sectionTitle")}</h3>
      {/* Keyed by place: the page stays mounted when it moves to another place, and
          GuideContent seeds its saved overview and guide from storage on mount. */}
      <GuideContent
        key={`${names.countryIso2}:${names.summaryTitle}`}
        placeName={place.name}
        names={names}
      />
    </section>
  );
}

interface GuideNames {
  countryIso2: string;
  countryName: string;
  cityName: string | undefined;
  summaryTitle: string;
  searchQuery: string;
}

/** Shared body: a single tidy overview card (photo + short extract, loaded when
 *  online) plus the grouped guide links. */
function GuideContent({ placeName, names }: { placeName: string; names: GuideNames }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  // Offline mode is the master override: no overview ever auto-fetches, and the
  // manual "Load overview" button is withheld too (external guide LINKS stay —
  // tapping one is the user deliberately leaving the app). Only saved overviews
  // show. So autoLoad collapses to false whenever Offline mode is on.
  const offlineMode = useSettings((s) => s.offlineMode);
  const autoLoad = useSettings((s) => s.autoLoadGuides && !s.offlineMode);
  const online = useOnlineStatus();
  const { countryIso2, countryName, cityName, summaryTitle, searchQuery } = names;
  // Built lazily here — rows with a closed modal do no guide work at all.
  const links = useMemo(
    () =>
      guidesFor({
        cityName,
        countryName,
        countryIso2,
        languages: ref.languagesOf(countryIso2),
      }),
    [ref, cityName, countryName, countryIso2],
  );
  // Overviews are SAVED on-device once loaded, so they reopen offline. The key
  // carries the country too — "Paris, TX" must never show the saved overview of
  // Paris, France as its own (same title, different place).
  const key = (proj: string) => `postcards-guide:${proj}:${countryIso2}:${summaryTitle}`;
  const readSaved = (proj: string): WikivoyageSummary | null => {
    try {
      const raw = localStorage.getItem(key(proj));
      return raw ? (JSON.parse(raw) as WikivoyageSummary) : null;
    } catch {
      return null;
    }
  };
  const [summary, setSummary] = useState<WikivoyageSummary | null>(() => readSaved("wikivoyage"));
  const [wpSummary, setWpSummary] = useState<WikivoyageSummary | null>(() => readSaved("wikipedia"));
  const [state, setState] = useState<"idle" | "loading" | "empty">("idle");

  // The WHOLE guide, readable in the app (the summary is just the lead and was
  // often visibly cut off, pushing people to the website). Saved on-device too,
  // in IndexedDB (guideCache), so it arrives a moment after the card opens.
  const fullKey = (proj: string) => `postcards-guidefull:${proj}:${countryIso2}:${summaryTitle}`;
  const [full, setFull] = useState<WikiFullText | null>(null);
  const [fullRestored, setFullRestored] = useState(false);
  const [fullState, setFullState] = useState<"idle" | "loading" | "empty">("idle");
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const proj of ["wikivoyage", "wikipedia"] as const) {
        const saved = await readGuide<WikiFullText>(fullKey(proj));
        if (saved) {
          if (live) setFull((f) => f ?? saved);
          break;
        }
      }
      if (live) setFullRestored(true);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFullGuide() {
    if (offlineMode) return; // self-contained: never reach Wikimedia
    setFullState("loading");
    const wv = await fetchFullText(summaryTitle);
    const got = wv ?? (await fetchFullText(summaryTitle, { project: "wikipedia" }));
    setFull(got);
    if (got) void saveGuide(fullKey(wv ? "wikivoyage" : "wikipedia"), got);
    setFullState(got ? "idle" : "empty");
  }

  async function loadOverview() {
    if (offlineMode) return; // self-contained: never reach Wikimedia
    setState("loading");
    const [wv, wp] = await Promise.all([
      fetchSummary(summaryTitle),
      fetchSummary(summaryTitle, { project: "wikipedia" }),
    ]);
    setSummary(wv);
    setWpSummary(wp);
    for (const [proj, val] of [["wikivoyage", wv], ["wikipedia", wp]] as const) {
      if (val) {
        try {
          localStorage.setItem(key(proj), JSON.stringify(val));
        } catch {
          /* private mode / full: shown but not saved */
        }
      }
    }
    setState(wv || wp ? "idle" : "empty");
  }

  // Auto-load once, when allowed and online, if nothing is saved yet. Opening a
  // place is the explicit action; the Settings toggle can require a manual tap.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || summary || wpSummary || !autoLoad) return;
    if (isOffline()) return;
    tried.current = true;
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: links.filter((l) => KIND_GROUP[l.kind] === g),
  })).filter((g) => g.items.length);

  // Prefer the Wikivoyage travel blurb, fall back to Wikipedia; the photo comes
  // from Wikipedia. One clean card, not two stacked walls of text.
  const overview = summary ?? wpSummary;
  const overviewSource = summary ? "Wikivoyage" : "Wikipedia";
  const photo = wpSummary?.thumb;

  // Once the full guide is loaded, its complete lead replaces the summary
  // extract (the REST summary truncates it); the citation follows the source.
  const fullLead = full?.sections.find((s) => !s.heading)?.text;
  const cardText =
    fullLead && fullLead.length > (overview?.extract.length ?? 0) ? fullLead : overview?.extract;
  const cardUrl = cardText === fullLead && full ? full.url : overview?.url;
  const cardSource =
    cardText === fullLead && full
      ? full.attribution.startsWith("Wikipedia")
        ? "Wikipedia"
        : "Wikivoyage"
      : overviewSource;
  const fullSections = full?.sections.filter((s) => s.heading) ?? [];

  return (
    <div className="guide-body">
      <p className="muted small guide-source">{t("guide.sourceNote")}</p>

      <div className="guide-overviews">
        {!overview && state === "loading" && (
          <p className="muted small guide-loading" role="status" aria-live="polite">
            {t("guide.loadingOverview")}
          </p>
        )}
        {!overview && state === "idle" && !autoLoad && !offlineMode && (
          <button type="button" className="btn-ghost guide-overview-btn" onClick={loadOverview}>
            ↧ {t("guide.loadOverview")}
          </button>
        )}
        {!overview && offlineMode && (
          <p className="muted small">{t("guide.offlineOff")}</p>
        )}
        {/* Auto-load is on but the overview never loaded because the device is
            offline — the effect bailed and left this area blank. Say so, with a
            Retry for when the connection is back. Gated on !navigator.onLine so a
            normal ONLINE auto-load (state flips to "loading") never flashes it. */}
        {!overview &&
          state === "idle" &&
          autoLoad &&
          !offlineMode &&
          typeof navigator !== "undefined" &&
          !navigator.onLine && (
            <p className="muted small">
              {t("guide.offlineWait")}{" "}
              <button type="button" className="mini-btn" onClick={loadOverview}>
                {t("guide.retry")}
              </button>
            </p>
          )}
        {!overview && state === "empty" && (
          <p className="muted small">
            {isOffline()
              ? t("guide.emptyOffline")
              : t("guide.emptyOnline")}{" "}
            <button type="button" className="mini-btn" onClick={loadOverview}>
              {t("guide.retry")}
            </button>
          </p>
        )}
        {(overview || full) && cardText && (
          <figure className="guide-card">
            {/* The photo is a remote Wikimedia URL (only the text is saved on
                device), so rendering it fetches from the network — withheld under
                Offline mode AND when the device is simply offline, where it would
                otherwise render as a broken-image icon over the saved text. */}
            {photo && !offlineMode && online && (
              <img
                className="guide-photo"
                src={photo}
                alt={t("guide.photoAlt", { place: placeName })}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}
            <blockquote className="guide-extract">
              {cardText.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </blockquote>
            <figcaption className="muted small guide-cite">
              <a href={cardUrl} target="_blank" rel="noopener noreferrer">
                {t("guide.readMore", { source: cardSource })}
              </a>{" "}
              · CC BY-SA · {t("guide.savedOffline")}
            </figcaption>
          </figure>
        )}

        {/* The whole guide, readable right here — no trip to the website. */}
        {(overview || full) && !full && fullRestored && fullState === "idle" && !offlineMode && (
          <button type="button" className="btn-ghost guide-overview-btn" onClick={() => void loadFullGuide()}>
            📖 {t("guide.readWhole")}
          </button>
        )}
        {fullState === "loading" && (
          <p className="muted small guide-loading" role="status" aria-live="polite">
            {t("guide.loadingFull")}
          </p>
        )}
        {fullState === "empty" && (
          <p className="muted small">
            {isOffline()
              ? t("guide.fullOffline")
              : t("guide.fullEmpty")}{" "}
            <button type="button" className="mini-btn" onClick={() => void loadFullGuide()}>
              {t("guide.retry")}
            </button>
          </p>
        )}
        {fullSections.length > 0 && (
          <div className="guide-full">
            {fullSections.map((s) => (
              <details key={s.heading} className="guide-full-section">
                <summary>{s.heading}</summary>
                {s.text.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </details>
            ))}
            {full && (
              <p className="muted small guide-cite">
                {t("guide.fullGuideLabel")} ·{" "}
                <a href={full.url} target="_blank" rel="noopener noreferrer">
                  {full.attribution}
                </a>{" "}
                · {t("guide.savedOffline")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="guide-groups-col">
        {grouped.map(({ group, items }) => (
          <div key={group} className="guide-group">
            {/* h4: these group titles nest UNDER the section's "Guides" h3, so a
                screen-reader heading outline stays correct (WCAG 1.3.1). */}
            <h4>{t(`guide.group.${group}` as MessageKey)}</h4>
            <ul className="guide-links">
              {items.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">
                    <span className="guide-link-label">
                      {t(`guide.link.${l.kind}.label` as MessageKey, { name: l.name })}
                    </span>
                    <span className="guide-link-hint muted small">
                      {t(`guide.link.${l.kind}.hint` as MessageKey)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Honest fallback: a search link always works, even when an exact article
          title doesn't match (name variants) or the overview fetch fails. */}
      <p className="muted small guide-search">
        <a href={searchUrl(searchQuery)} target="_blank" rel="noopener noreferrer">
          {t("guide.searchFor", { query: searchQuery })}
        </a>
      </p>
    </div>
  );
}

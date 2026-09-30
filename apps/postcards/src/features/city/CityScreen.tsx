import { useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useVisits, findByPlace } from "../../lib/store/useVisits";
import { useStories } from "../../lib/store/useStories";
import { useUi } from "../../lib/store/useUi";
import { placeKey } from "../../lib/schema/helpers";
import { placesOf } from "../journal/postcardModel";
import { countryFlag, formatDate, formatInt, formatKm } from "../../lib/format/format";
import { haversineKm } from "../travel/distance";
import { articleUrl, searchUrl } from "../../lib/wikivoyage";
import { StateToggles } from "../visits/StateToggles";
import { PhotoGallery } from "../visits/PhotoGallery";
import { GuideSection } from "../guides/GuideButton";
import { CityLine } from "../../ui/CityLine";
import { useT } from "../../lib/i18n";

/** Wikipedia article URL for a title (link only — nothing is fetched). */
function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

/** Wikipedia full-text SEARCH URL — the honest fallback for a place we hold no
 *  reference article for (a user's own custom place), so we never link to a
 *  direct article that would 404 and imply facts we don't have. */
function wikipediaSearchUrl(query: string): string {
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
}

/** When did you go, and what do you remember? (FR-002 — both optional.)
 *  The note saves on blur so IndexedDB isn't rewritten per keystroke. */
function VisitDetails({ visitId, date, note }: { visitId: string; date: string | null; note: string | null }) {
  const setDetails = useVisits((s) => s.setDetails);
  const t = useT();
  const [draft, setDraft] = useState(note ?? "");
  // A different visit (or an import) swapped in under the same mount.
  const lastVisit = useRef(visitId);
  if (lastVisit.current !== visitId) {
    lastVisit.current = visitId;
    setDraft(note ?? "");
  }
  return (
    <div className="visit-details">
      <label className="visit-field">
        <span className="muted small">{t("city.visitDate")}</span>
        <input
          type="date"
          className="select"
          value={date ?? ""}
          onChange={(e) => void setDetails(visitId, { date: e.target.value || null })}
        />
      </label>
      <label className="visit-field visit-note">
        <span className="muted small">{t("city.note")}</span>
        {/* A real memory is multi-sentence — a textarea (not a one-line input) so
            you can see what you wrote on a phone; newlines round-trip through the
            portable JSON. */}
        <textarea
          className="select journal-textarea"
          rows={3}
          placeholder={t("city.notePlaceholder")}
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void setDetails(visitId, { note: draft })}
        />
      </label>
    </div>
  );
}

/**
 * The per-city page: everything the app knows about one place — reference facts,
 * your own records (visit, photos, note), nearby monuments & airports, and
 * outbound links (Wikivoyage, Wikipedia, OpenStreetMap). For places the datasets
 * don't know, it says so honestly and points to the add-your-own flow.
 */
export function CityScreen({ cityId, onBack }: { cityId: string; onBack: () => void }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const stories = useStories((s) => s.stories);
  const selectPlace = useUi((s) => s.selectPlace);
  const openJournalDraft = useUi((s) => s.openJournalDraft);

  // The page serves cities, World Heritage monuments, airports, railway stations,
  // and your own custom places (ids don't collide: cities are numeric/slug,
  // airports IATA, stations Wikidata QIDs).
  const city = ref.cityById(cityId);
  const monument = !city ? ref.heritageById(cityId) : undefined;
  const airport = !city && !monument ? ref.airportById(cityId) : undefined;
  const station = !city && !monument && !airport ? ref.stationById(cityId) : undefined;
  const airportName = airport ? `${airport.name} (${airport.id})` : undefined;
  const visit = city
    ? findByPlace(visits, { kind: "city", id: city.id })
    : monument
      ? findByPlace(visits, { kind: "heritage", id: monument.id })
      : airport
        ? findByPlace(visits, { kind: "airport", id: airport.id })
        : station
          ? findByPlace(visits, { kind: "station", id: station.id })
          : findByPlace(visits, { kind: "custom", id: cityId });
  const liveCustom =
    !city && !monument && !airport && !station && visit?.place.kind === "custom"
      ? visit.place
      : null;
  // A custom place exists ONLY as its visit's embedded PlaceRef — remember it so
  // unchecking "Been there" on this very page doesn't collapse the header to
  // "Unknown place" and strand the user (the toggles must stay to re-add it).
  const lastCustom = useRef<{ id: string; place: NonNullable<typeof liveCustom> } | null>(null);
  if (liveCustom) lastCustom.current = { id: cityId, place: liveCustom };
  const customPlace =
    liveCustom ?? (lastCustom.current?.id === cityId ? lastCustom.current.place : null);

  const name =
    city?.name ??
    monument?.name ??
    airportName ??
    station?.name ??
    customPlace?.name ??
    t("city.unknownPlace");
  const cc =
    city?.countryIso2 ??
    monument?.countryIso2 ??
    airport?.countryIso2 ??
    station?.countryIso2 ??
    customPlace?.countryId ??
    "";
  const country = ref.countryByIso2(cc);
  const region = city?.subdivisionId ? ref.subdivisionById(city.subdivisionId)?.name : null;
  const lat = city?.lat ?? (monument && (monument.lat !== 0 || monument.lon !== 0) ? monument.lat : null) ?? airport?.lat ?? station?.lat ?? customPlace?.lat ?? null;
  const lon = city?.lon ?? (monument && (monument.lat !== 0 || monument.lon !== 0) ? monument.lon : null) ?? airport?.lon ?? station?.lon ?? customPlace?.lon ?? null;
  const place = city
    ? { kind: "city" as const, id: city.id, name: city.name, countryId: city.countryIso2 }
    : monument
      ? { kind: "heritage" as const, id: monument.id, name: monument.name, countryId: monument.countryIso2 }
      : airport
        ? { kind: "airport" as const, id: airport.id, name: airportName!, countryId: airport.countryIso2 }
        : station
          ? { kind: "station" as const, id: station.id, name: station.name, countryId: station.countryIso2 }
          : customPlace;

  // Outbound reference links use titles from the SOURCE record, not the display
  // `name` (which carries the airport's "(IATA)" suffix). Wikivoyage has CITY
  // guides, not airport pages, so an airport links to its home city. A custom
  // (user-invented) place has no reference article, so we point at SEARCH — never
  // a direct article that would 404 and imply facts we don't hold.
  const isCustom = !city && !monument && !airport && !station;
  const wpTitle = city?.name ?? monument?.name ?? airport?.name ?? station?.name ?? name;
  const wvTitle =
    city?.name ?? monument?.name ?? (airport ? airport.city || airport.name : station?.name ?? name);
  const wikipediaHref = isCustom ? wikipediaSearchUrl(name) : wikipediaUrl(wpTitle);
  const wikivoyageHref = isCustom ? searchUrl(name) : articleUrl(wvTitle);

  // This place's journal stories (already newest-first in the store). A postcard can
  // span several places (spec 020), so match if ANY of its places is this one.
  const placeStories = useMemo(
    () => (place ? stories.filter((s) => placesOf(s).some((p) => placeKey(p) === placeKey(place))) : []),
    [stories, place],
  );

  // Nearby points of interest, by great-circle distance (nothing invented).
  // "Nearby" means easily travelable from here (≤ 30 km), not the same region.
  const nearby = useMemo(() => {
    if (lat == null || lon == null) return { monuments: [], airports: [] };
    const from = { lat, lon };
    const monuments = ref
      .allHeritage()
      // Never list the page's own monument as its "nearby" site at 0.0 km.
      .filter((h) => (h.lat !== 0 || h.lon !== 0) && h.id !== cityId)
      .map((h) => ({ ...h, km: haversineKm(from, h) }))
      .filter((h) => h.km <= 30)
      .sort((a, b) => a.km - b.km)
      .slice(0, 6);
    const airports = ref
      .allAirports()
      // Never list the page's own airport as its "nearest airport" at 0.0 km.
      .filter((a) => a.id !== cityId)
      .map((a) => ({ ...a, km: haversineKm(from, a) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
    return { monuments, airports };
  }, [ref, lat, lon, cityId]);

  return (
    <div className="screen city-page">
      <button className="mini-btn back-btn" type="button" onClick={onBack}>
        ← {t("city.back")}
      </button>

      <header className="city-hero">
        <span className="city-hero-flag" aria-hidden>
          {countryFlag(cc)}
        </span>
        <div>
          <h2>{name}</h2>
          <p className="muted">
            {country?.name ?? cc}
            {region ? ` - ${region}` : ""}
            {monument ? ` · ${t("city.tag.heritage")}` : ""}
            {airport ? ` · ${t("city.tag.airport")}` : ""}
            {customPlace ? ` · ${t("city.tag.ownPlace")}` : ""}
          </p>
        </div>
        {place && <StateToggles place={place} />}
      </header>

      <div className="city-facts">
        {city?.population != null && (
          <span className="fact">
            <strong>{formatInt(city.population)}</strong> {t("city.fact.people")}
          </span>
        )}
        {airport?.city && (
          <span className="fact">
            {t("city.fact.airportCity")} <strong>{airport.city}</strong>
          </span>
        )}
        {lat != null && lon != null && (
          <>
            <span className="fact">
              <strong>
                {lat.toFixed(3)}, {lon.toFixed(3)}
              </strong>{" "}
              {t("city.fact.latLon")}
            </span>
            <button
              className="mini-btn"
              type="button"
              onClick={() => {
                // "Show on map" opens the place's marker card (been-there /
                // Details), not just a silent re-centre — same as tapping its dot.
                if (place) selectPlace(lon, lat, place);
              }}
            >
              {t("city.showOnMap")}
            </button>
          </>
        )}
        {visit?.date && (
          <span className="fact">
            {t("city.fact.visited")} <strong>{formatDate(visit.date)}</strong>
          </span>
        )}
      </div>

      {/* Honest about missing reference data (Constitution: aggregator, never
          invents): passenger throughput isn't in any vendored dataset yet. */}
      {airport && <p className="muted small">{t("city.airportTrafficNote")}</p>}

      {!city && !monument && !airport && !customPlace && (
        <p className="notice">
          {t("city.notInData")}{" "}
          <button
            className="mini-btn"
            type="button"
            onClick={() => {
              useUi.getState().setTab("map");
              useUi.getState().focusSearch();
            }}
          >
            {t("city.searchOnMap")}
          </button>
        </p>
      )}

      {visit && (
        <section className="city-section">
          <h3>{t("city.section.postcard")}</h3>
          <div className="city-gallery-row">
            <PhotoGallery visitId={visit.visitId} photos={visit.photos ?? []} placeName={name} />
          </div>
          {visit.status === "visited" && (
            <VisitDetails visitId={visit.visitId} date={visit.date} note={visit.note} />
          )}
        </section>
      )}

      {place && (placeStories.length > 0 || visit?.status === "visited") && (
        <section className="city-section">
          <h3>{t("journal.title")}</h3>
          {placeStories.length > 0 && (
            <ul className="city-list">
              {placeStories.map((s) => (
                <li key={s.storyId} className="city-row compact">
                  <div className="city-focus" style={{ cursor: "default" }}>
                    <CityLine flag="✍️" name={s.title} sub={<>· {formatDate(s.date)}</>} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            className="mini-btn"
            type="button"
            style={placeStories.length ? { marginTop: 6 } : undefined}
            onClick={() => openJournalDraft(place)}
          >
            ＋ {t("city.addStory")}
          </button>
        </section>
      )}

      {place && <GuideSection place={place} />}

      {place && (
        <section className="city-section">
          <h3>{t("city.section.learn")}</h3>
          <div className="city-links">
            <a
              className="mini-btn"
              href={wikipediaHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Wikipedia
            </a>
            <a
              className="mini-btn"
              href={wikivoyageHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Wikivoyage
            </a>
            {lat != null && lon != null && (
              <a
                className="mini-btn"
                href={`https://www.openstreetmap.org/#map=12/${lat}/${lon}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenStreetMap
              </a>
            )}
          </div>
          <p className="muted small">
            {t("city.linksNote")}
          </p>
        </section>
      )}

      {nearby.monuments.length > 0 && (
        <section className="city-section">
          <h3>{t("city.section.heritageNearby")}</h3>
          <ul className="city-list">
            {nearby.monuments.map((h) => (
              <li key={h.id} className="city-row compact">
                <button
                  className="city-focus"
                  type="button"
                  onClick={() => useUi.getState().openCity(h.id)}
                  aria-label={t("places.row.openAria", { name: h.name })}
                >
                  <CityLine flag="🏛️" name={h.name} sub={<>· {t("city.away", { km: formatKm(h.km) })}</>} multiline />
                </button>
                <StateToggles
                  place={{ kind: "heritage", id: h.id, name: h.name, countryId: h.countryIso2 }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {nearby.airports.length > 0 && (
        <section className="city-section">
          <h3>{t("city.section.airportsNearby")}</h3>
          <ul className="city-list">
            {nearby.airports.map((a) => (
              <li key={a.id} className="city-row compact">
                <button
                  className="city-focus"
                  type="button"
                  onClick={() => useUi.getState().openCity(a.id)}
                  aria-label={t("places.row.openAria", { name: `${a.name} (${a.id})` })}
                >
                  <CityLine
                    flag="✈️"
                    name={`${a.name} (${a.id})`}
                    sub={<>· {t("city.away", { km: formatKm(a.km) })}</>}
                    multiline
                  />
                </button>
                <StateToggles
                  place={{ kind: "airport", id: a.id, name: `${a.name} (${a.id})`, countryId: a.countryIso2 }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

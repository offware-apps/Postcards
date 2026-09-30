import { useEffect, useMemo, useRef, useState } from "react";
import { useStories } from "../../lib/store/useStories";
import { useVisits } from "../../lib/store/useVisits";
import { useTrips } from "../../lib/store/useTrips";
import { useUi } from "../../lib/store/useUi";
import { placeKey, MAX_PHOTOS_PER_STORY, MAX_TAGS_PER_STORY } from "../../lib/schema/helpers";
import { sanitizeText } from "../../lib/schema/sanitize";
import type { Photo, PlaceRef } from "../../lib/schema/models";
import { fileToPostcard } from "../../lib/image/downscale";
import { countryFlag, formatKm } from "../../lib/format/format";
import { haversineKm } from "../travel/distance";
import { getReferenceData } from "../../lib/reference/referenceData";
import type { City } from "../../lib/reference/types";
import { distinctFolders } from "./folders";
import { useT } from "../../lib/i18n";

// Nearest gazetteer cities to a position — a cheap bounding-box prefilter keeps
// haversine off most of the ~135k entries; the box widens once for sparse areas.
// Used ONLY on an explicit compose action; the position is never stored.
const NEARBY_COUNT = 6;
function nearestCities(here: { lat: number; lon: number }, cities: City[]): { city: City; km: number }[] {
  let candidates: City[] = [];
  for (const box of [1.5, 5]) {
    candidates = cities.filter((c) => Math.abs(c.lat - here.lat) <= box && Math.abs(c.lon - here.lon) <= box);
    if (candidates.length >= NEARBY_COUNT) break;
  }
  return candidates
    .map((city) => ({ city, km: haversineKm(here, city) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_COUNT);
}

// The focused, full-screen POSTCARD composer (spec 020) — a page layer peer of the
// city/country/trip pages, opened via useUi.openStoryComposer. Built for speed: it
// opens dated today with the cursor already in the content box; a postcard needs
// only a DATE + CONTENT (text and/or a photo) — place is OPTIONAL. Everything else
// (place, folder, photos) lives under "add details". Save with Ctrl/Cmd+Enter;
// "save & start another" (Ctrl/Cmd+Shift+Enter) keeps you on the page for a rapid
// journalling loop. Escape/Back close it via the app's central page-layer handling.

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const DRAFT_KEY = "postcards-journal-draft";
type Draft = { storyId: string | null; place: PlaceRef | null; date: string; title: string; text: string; folder: string };

// Quick preset tags the composer offers (mood / weather). They're just tag VALUES —
// the model stores plain strings, so presets and free tags are the same shape.
const MOOD_TAGS = ["🙂 happy", "😌 calm", "🤩 wowed", "😴 tired", "☹️ sad"];
const WEATHER_TAGS = ["☀️ sunny", "⛅ cloudy", "🌧️ rainy", "❄️ snowy", "🥵 hot"];

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function StoryComposer({ storyId, onClose }: { storyId: string | null; onClose: () => void }) {
  const t = useT();
  const stories = useStories((s) => s.stories);
  const addStory = useStories((s) => s.addStory);
  const updateStory = useStories((s) => s.updateStory);
  const visits = useVisits((s) => s.visits);

  const existing = useMemo(
    () => (storyId ? stories.find((s) => s.storyId === storyId) : undefined),
    [storyId, stories],
  );

  // Seed from the story being edited, else from a crash-saved draft for THIS context
  // (a new postcard, or the same story), else empty/today.
  const seed = useMemo<Draft>(() => {
    if (existing) {
      return {
        storyId,
        place: existing.place ?? null,
        date: existing.date,
        title: existing.title,
        text: existing.text,
        folder: existing.folder ?? "",
      };
    }
    // A place handed in by "write about this place" (from a city page) wins over a
    // stale draft; otherwise restore an in-progress draft, else start blank/today.
    const prefill = useUi.getState().storyDraftPlace;
    const d = readDraft();
    if (prefill) return { storyId, place: prefill, date: todayISO(), title: "", text: "", folder: "" };
    if (d && d.storyId === storyId) return d;
    return { storyId, place: null, date: todayISO(), title: "", text: "", folder: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, existing]);

  const [place, setPlace] = useState<PlaceRef | null>(seed.place);
  const [date, setDate] = useState(seed.date);
  const [title, setTitle] = useState(seed.title);
  const [text, setText] = useState(seed.text);
  const [folder, setFolder] = useState(seed.folder);
  const [photos, setPhotos] = useState<Photo[]>(existing?.photos ?? []);
  // Optional context (US2): personal tags + a link to one reconstructed trip.
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [tripId, setTripId] = useState<string>(existing?.tripId ?? "");
  const trips = useTrips((s) => s.trips);
  // US3: additional places (a travel day spanning several) + an end date (a range).
  const [extraPlaces, setExtraPlaces] = useState<PlaceRef[]>(existing?.extraPlaces ?? []);
  const [endDate, setEndDate] = useState<string>(existing?.endDate ?? "");
  // US4: places NEAR YOU, auto-suggested on open (opt-in, permission-gated). The
  // device position is used only to rank these and is never stored or transmitted.
  const [nearby, setNearby] = useState<{ city: City; km: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // The places you can attach — the ones you've been. A place already on the story
  // that's no longer visited is kept as an option so the select never shows a phantom.
  const visitedPlaces = useMemo(
    () =>
      visits
        .filter((v) => v.status === "visited")
        .map((v) => v.place)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visits],
  );
  const placeOptions = useMemo(
    () =>
      place && !visitedPlaces.some((p) => placeKey(p) === placeKey(place))
        ? [place, ...visitedPlaces]
        : visitedPlaces,
    [visitedPlaces, place],
  );
  const folderSuggs = useMemo(() => distinctFolders(stories), [stories]);

  // Open with the cursor in the content box (fast capture, P1) for a NEW postcard.
  useEffect(() => {
    if (!existing) textRef.current?.focus();
  }, [existing]);

  // Auto-attempt a location fix on open for a NEW postcard with no place yet, and
  // suggest nearby places (US4). Opt-in and permission-gated: denied / offline /
  // slow all degrade silently (place stays optional). Coordinates rank places
  // on-device only — never stored on the postcard, never transmitted. Editing an
  // existing postcard, or one that already has a place, never triggers this.
  useEffect(() => {
    if (existing || place || typeof navigator === "undefined" || !navigator.geolocation) return;
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!alive) return;
        const found = nearestCities(
          { lat: pos.coords.latitude, lon: pos.coords.longitude },
          getReferenceData().allCities(),
        );
        if (found.length) setNearby(found);
      },
      () => {
        /* denied / unavailable: stay silent, place remains optional */
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A postcard needs SOMETHING to say — a title, some text, or a photo. Place is optional.
  const hasContent = !!(sanitizeText(title, 200) || sanitizeText(text, 8000) || photos.length);
  const canSave = !!date && hasContent;

  // Crash-safe draft: mirror the (photo-less) text fields so leaving and returning
  // never loses typed content. Transient device state only; cleared on save.
  const dirty =
    !existing &&
    (place !== null || title !== "" || text !== "" || folder !== "" || photos.length > 0 || date !== todayISO());
  useEffect(() => {
    if (existing) return; // editing reads from the store, not the draft cache
    try {
      if (dirty) {
        const draft: Draft = { storyId, place, date, title, text, folder };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      }
    } catch {
      /* private mode: not persisted */
    }
  }, [existing, dirty, storyId, place, date, title, text, folder]);

  function clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  function resetToNew(): void {
    setPlace(null);
    setDate(todayISO());
    setTitle("");
    setText("");
    setFolder("");
    setPhotos([]);
    setTags([]);
    setTagInput("");
    setTripId("");
    setExtraPlaces([]);
    setEndDate("");
    clearDraft();
    textRef.current?.focus();
  }

  async function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const room = MAX_PHOTOS_PER_STORY - photos.length;
      const added: Photo[] = [];
      for (const file of files.slice(0, room)) {
        added.push({ src: await fileToPostcard(file), caption: null });
      }
      setPhotos((prev) => [...prev, ...added]);
    } finally {
      setBusy(false);
    }
  }

  function addTag(raw: string): void {
    const tag = raw.trim();
    if (!tag) return;
    setTags((prev) => (prev.includes(tag) || prev.length >= MAX_TAGS_PER_STORY ? prev : [...prev, tag]));
    setTagInput("");
  }
  function removeTag(tag: string): void {
    setTags((prev) => prev.filter((x) => x !== tag));
  }

  async function save(keepOpen: boolean): Promise<void> {
    if (!canSave) return;
    const tripLink = tripId || undefined;
    const end = endDate && endDate > date ? endDate : undefined;
    const extras = extraPlaces.length ? extraPlaces : undefined;
    if (storyId && existing) {
      // `place: undefined` with the key present tells the store to CLEAR a removed place.
      await updateStory(storyId, {
        place: place ?? undefined,
        extraPlaces: extras ?? [],
        date,
        endDate: end,
        title,
        text,
        folder,
        photos,
        tags,
        tripId: tripLink,
      });
    } else {
      await addStory({ place, extraPlaces: extras, date, endDate: end, title, text, folder, photos, tags, tripId: tripLink });
    }
    clearDraft();
    if (keepOpen && !storyId) resetToNew();
    else onClose();
  }

  // Keyboard: Ctrl/Cmd+Enter = save & close; Ctrl/Cmd+Shift+Enter = save & start another.
  function onKeyDown(e: React.KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSave) void save(e.shiftKey && !storyId);
    }
  }

  return (
    <section
      className="screen story-composer"
      aria-label={t(storyId ? "journal.composer.editTitle" : "journal.composer.newTitle")}
      onKeyDown={onKeyDown}
    >
      <div className="trip-composer-head">
        <button type="button" className="link back-link" onClick={onClose} aria-label={t("journal.composer.back")}>
          ← {t("journal.composer.back")}
        </button>
        <h2>{t(storyId ? "journal.composer.editTitle" : "journal.composer.newTitle")}</h2>
      </div>

      {/* Date + content — the only things a postcard needs. */}
      <div className="story-compose-main">
        <label className="picker-label story-date-field" htmlFor="story-date">
          {t("journal.date")}
          <input
            id="story-date"
            className="select"
            type="date"
            required
            max="9999-12-31"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="picker-label" htmlFor="story-title">
          {t("journal.titleField")}
          <input
            id="story-title"
            className="select"
            type="text"
            maxLength={200}
            placeholder={t("journal.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="picker-label" htmlFor="story-text">
          <span className="sr-only">{t("journal.story")}</span>
          <textarea
            id="story-text"
            ref={textRef}
            className="select journal-textarea"
            rows={8}
            maxLength={8000}
            placeholder={t("journal.storyPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>

      {/* Everything else is optional — tucked away, present but out of the way. */}
      <details className="story-details">
        <summary>{t("journal.composer.addDetails")}</summary>
        {nearby && nearby.length > 0 && !place && (
          <div className="story-nearby" role="group" aria-label={t("journal.composer.nearYou")}>
            <span className="muted small">📍 {t("journal.composer.nearYou")}</span>
            <div className="story-nearby-list">
              {nearby.map(({ city, km }) => (
                <button
                  key={city.id}
                  type="button"
                  className="mini-btn"
                  onClick={() => {
                    // Only attaches a place — nothing is marked visited, no coords stored.
                    setPlace({ kind: "city", id: city.id, name: city.name, countryId: city.countryIso2 });
                    setNearby(null);
                  }}
                >
                  {countryFlag(city.countryIso2)} {city.name} · {formatKm(km)}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="picker-label" htmlFor="story-place">
          {t("journal.place")}
          <select
            id="story-place"
            className="select"
            value={place ? placeKey(place) : ""}
            onChange={(e) => setPlace(placeOptions.find((p) => placeKey(p) === e.target.value) ?? null)}
          >
            <option value="">{t("journal.composer.noPlace")}</option>
            {placeOptions.map((p) => (
              <option key={placeKey(p)} value={placeKey(p)}>
                {countryFlag(p.countryId)} {p.name}
              </option>
            ))}
          </select>
        </label>

        {/* US3: more places (a travel day spanning several) + an optional end date. */}
        {extraPlaces.length > 0 && (
          <ul className="story-tag-list" aria-label={t("journal.composer.morePlaces")}>
            {extraPlaces.map((p) => (
              <li key={placeKey(p)} className="story-tag">
                {countryFlag(p.countryId)} {p.name}
                <button
                  type="button"
                  className="story-tag-x"
                  aria-label={t("journal.composer.removePlace", { name: p.name })}
                  onClick={() => setExtraPlaces((prev) => prev.filter((q) => placeKey(q) !== placeKey(p)))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {placeOptions.length > 0 && (
          <label className="picker-label" htmlFor="story-extra-place">
            {t("journal.composer.morePlaces")}
            <select
              id="story-extra-place"
              className="select"
              value=""
              onChange={(e) => {
                const p = placeOptions.find((x) => placeKey(x) === e.target.value);
                if (p) setExtraPlaces((prev) => (prev.some((q) => placeKey(q) === placeKey(p)) ? prev : [...prev, p]));
              }}
            >
              <option value="">{t("journal.composer.addPlace")}</option>
              {placeOptions
                .filter(
                  (p) =>
                    (!place || placeKey(p) !== placeKey(place)) &&
                    !extraPlaces.some((q) => placeKey(q) === placeKey(p)),
                )
                .map((p) => (
                  <option key={placeKey(p)} value={placeKey(p)}>
                    {countryFlag(p.countryId)} {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="picker-label story-date-field" htmlFor="story-enddate">
          {t("journal.composer.endDate")}
          <input
            id="story-enddate"
            className="select"
            type="date"
            min={date}
            max="9999-12-31"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>

        <label className="picker-label" htmlFor="story-folder">
          {t("journal.folder")}
          <input
            id="story-folder"
            className="select"
            type="text"
            maxLength={80}
            list="story-folder-suggestions"
            placeholder={t("journal.folderPlaceholder")}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        {folderSuggs.length > 0 && (
          <datalist id="story-folder-suggestions">
            {folderSuggs.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        )}

        {/* Tags: type-and-Enter chips, plus mood/weather quick presets. */}
        <div className="picker-label">
          {t("journal.composer.tags")}
          {tags.length > 0 && (
            <ul className="story-tag-list" aria-label={t("journal.composer.tags")}>
              {tags.map((tag) => (
                <li key={tag} className="story-tag">
                  {tag}
                  <button
                    type="button"
                    className="story-tag-x"
                    aria-label={t("journal.composer.removeTag", { tag })}
                    onClick={() => removeTag(tag)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            className="select"
            type="text"
            maxLength={40}
            list="story-tag-suggestions"
            placeholder={t("journal.composer.tagPlaceholder")}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
          />
          <datalist id="story-tag-suggestions">
            {[...MOOD_TAGS, ...WEATHER_TAGS].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="story-tag-presets">
            {[...MOOD_TAGS, ...WEATHER_TAGS].map((m) => (
              <button key={m} type="button" className="mini-btn" onClick={() => addTag(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Link this postcard to one reconstructed trip. */}
        {trips.length > 0 && (
          <label className="picker-label" htmlFor="story-trip">
            {t("journal.composer.trip")}
            <select id="story-trip" className="select" value={tripId} onChange={(e) => setTripId(e.target.value)}>
              <option value="">{t("journal.composer.noTrip")}</option>
              {trips.map((tr) => (
                <option key={tr.tripId} value={tr.tripId}>
                  {tr.name || `${tr.from.name} → ${tr.to.name}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPickPhotos}
          aria-hidden
          tabIndex={-1}
        />
        {photos.length > 0 && (
          <ul className="journal-photo-edit-list">
            {photos.map((p, i) => (
              <li key={i} className="journal-photo-edit">
                <img src={p.src} alt="" loading="lazy" decoding="async" />
                <input
                  className="caption-input"
                  type="text"
                  maxLength={300}
                  placeholder={t("journal.captionPlaceholder")}
                  aria-label={t("journal.captionAria", { n: i + 1 })}
                  value={p.caption ?? ""}
                  onChange={(e) =>
                    setPhotos((prev) => prev.map((q, j) => (j === i ? { ...q, caption: e.target.value || null } : q)))
                  }
                />
                <button
                  className="link-danger"
                  type="button"
                  aria-label={t("journal.removePhotoAria", { n: i + 1 })}
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                >
                  {t("common.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <button
            className="mini-btn"
            type="button"
            disabled={busy || photos.length >= MAX_PHOTOS_PER_STORY}
            title={photos.length >= MAX_PHOTOS_PER_STORY ? t("journal.storyFullTitle", { max: MAX_PHOTOS_PER_STORY }) : undefined}
            onClick={() => photoInput.current?.click()}
          >
            {busy ? "…" : `📷 ${t("journal.addPhotos")}`}
          </button>
        </div>
      </details>

      <div className="trip-composer-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        {!storyId && (
          <button type="button" className="btn-ghost" disabled={!canSave} onClick={() => void save(true)}>
            {t("journal.composer.saveAndNew")}
          </button>
        )}
        <button type="button" className="btn" disabled={!canSave} onClick={() => void save(false)}>
          {t(storyId ? "journal.saveChanges" : "journal.composer.save")}
        </button>
      </div>
      {!hasContent && <p className="muted small">{t("journal.composer.needsContent")}</p>}
    </section>
  );
}

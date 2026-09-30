import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { StoryMap } from "./StoryMap";
import type { City } from "../../lib/reference/types";
import { useStories } from "../../lib/store/useStories";
import { useTrips } from "../../lib/store/useTrips";
import { useVisits } from "../../lib/store/useVisits";
import { useToast } from "../../lib/store/useToast";
import { useUi } from "../../lib/store/useUi";
import { registerEscape } from "../../lib/store/escapeStack";
import { useModalKeys } from "../../lib/hooks/useModalKeys";
import { fileToPostcard } from "../../lib/image/downscale";
import { countryFlag, formatDate, formatKm } from "../../lib/format/format";
import { haversineKm } from "../travel/distance";
import { distinctYearsDesc } from "../travel/period";
import { MAX_PHOTOS_PER_STORY, placeKey } from "../../lib/schema/helpers";
import type { Photo, PlaceRef, Story } from "../../lib/schema/models";
import { sanitizeText } from "../../lib/schema/sanitize";
import { journalToMarkdown, JOURNAL_EXPORT_FILENAME } from "./exportJournalMd";
import { download } from "../../lib/download";
import { useT, useLocale, type MessageKey } from "../../lib/i18n";
import { folderSuggestions, distinctFolders, matchesFolder } from "./folders";
import { ListPager } from "../../ui/ListPager";
import {
  addMonths,
  hexToRgba,
  monthMatrix,
  storyDayIndex,
  ymOf,
  FIRST_DAY_OF_WEEK,
  type StoryDayCell,
} from "./calendar";
import { CONTINENT_ORDER, CONTINENT_FALLBACK, continentColor } from "../../lib/reference/continents";

// Publish mode pulls in the site renderer + encryption + connector; load it
// only when the user opens it, so the Journal's own path stays lean.
const PublishScreen = lazy(() =>
  import("../publish/PublishScreen").then((m) => ({ default: m.PublishScreen })),
);

/** A local YYYY-MM-DD, `offset` days from today (0 = today, -1 = yesterday). */
function dayISO(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
/** Today as a local YYYY-MM-DD (the composer's default story date). */
function today(): string {
  return dayISO(0);
}

/**
 * Near a day boundary, which day is a "daily story" about? Late evening it could
 * be today or the day just starting; small hours it's usually yesterday. Returns
 * the two candidate days to choose between, or null when the day is unambiguous.
 */
function boundaryDays(): { iso: string; hint: "today" | "newDay" | "yesterday" }[] | null {
  const h = new Date().getHours();
  if (h >= 21) {
    return [
      { iso: dayISO(0), hint: "today" },
      { iso: dayISO(1), hint: "newDay" },
    ];
  }
  if (h < 5) {
    return [
      { iso: dayISO(-1), hint: "yesterday" },
      { iso: dayISO(0), hint: "today" },
    ];
  }
  return null;
}

/** The city page serves these kinds — a story's place name links there. */
const CITY_PAGE_KINDS: PlaceRef["kind"][] = ["city", "heritage", "custom"];

/** Fold case and strip accents so "medellin" finds "Medellín" (search compare). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** The feed pages like the other long lists in the app. */
const FEED_PAGE = 20;

/**
 * Composer draft cache: quitting the page must never lose writing, so the
 * text fields are mirrored to localStorage while the composer is open. Photos
 * are deliberately excluded — they are heavy data URLs that would blow the
 * localStorage quota; an edit's photos are rehydrated from the store instead.
 */
const DRAFT_KEY = "postcards-journal-draft";

interface ComposerDraft {
  editingId: string | null;
  place: PlaceRef | null;
  date: string;
  title: string;
  text: string;
  folder: string;
}

const PLACE_KINDS: PlaceRef["kind"][] = ["country", "city", "airport", "heritage", "custom"];

/** A malformed, unreadable (private mode) or empty cached draft counts as no draft. */
function loadDraft(): ComposerDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ComposerDraft> | null;
    if (typeof d !== "object" || d === null) return null;
    if (typeof d.date !== "string" || typeof d.title !== "string" || typeof d.text !== "string")
      return null;
    const p = d.place as PlaceRef | null | undefined;
    const place =
      p &&
      typeof p === "object" &&
      PLACE_KINDS.includes(p.kind) &&
      typeof p.id === "string" &&
      typeof p.name === "string" &&
      typeof p.countryId === "string"
        ? p
        : null;
    const editingId = typeof d.editingId === "string" ? d.editingId : null;
    const folder = typeof d.folder === "string" ? d.folder : "";
    // A blank draft would just pop an empty composer open — not worth restoring.
    if (!d.title.trim() && !d.text.trim() && !place && !editingId) return null;
    return { editingId, place, date: d.date, title: d.title, text: d.text, folder };
  } catch {
    return null;
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode */
  }
}

/** How many cities "Near me" suggests. */
const NEARBY_COUNT = 8;

/**
 * Nearest gazetteer cities to a position. The full gazetteer holds ~135k
 * entries, so a cheap bounding-box prefilter keeps haversine off most of them;
 * the box widens once for sparse areas.
 */
function nearestCities(
  here: { lat: number; lon: number },
  cities: City[],
): { city: City; km: number }[] {
  let candidates: City[] = [];
  for (const box of [1.5, 5]) {
    candidates = cities.filter(
      (c) => Math.abs(c.lat - here.lat) <= box && Math.abs(c.lon - here.lon) <= box,
    );
    if (candidates.length >= NEARBY_COUNT) break;
  }
  return candidates
    .map((city) => ({ city, km: haversineKm(here, city) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_COUNT);
}

/**
 * A story's photo strip in the feed: small thumbnails that open a read-only
 * lightbox to browse (photos are edited in the composer). Same viewer contract
 * as PhotoGallery: Escape closes, arrows page, focus returns to the thumbnail.
 */
function StoryPhotos({ photos, title }: { photos: Photo[]; title: string }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const count = photos.length;
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const current = photos[safeIndex];

  // Modal focus contract: focus into the dialog on open, restore to the
  // thumbnail on close (Constitution: keyboard-first, WCAG 2.4.3).
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Escape closes; arrows page; Tab is trapped within the dialog.
  useModalKeys(dialogRef, () => setOpen(false), {
    enabled: open,
    onKey: (e) => {
      if (e.key === "ArrowLeft" && count > 1) {
        setIndex((i) => (i - 1 + count) % count);
        return true;
      }
      if (e.key === "ArrowRight" && count > 1) {
        setIndex((i) => (i + 1) % count);
        return true;
      }
    },
  });

  if (count === 0) return null;
  return (
    <>
      <div className="journal-photos">
        {photos.map((p, i) => (
          <button
            key={i}
            type="button"
            className="journal-thumb"
            aria-label={t("journal.viewPhotoAria", { n: i + 1, count, title })}
            onClick={(e) => {
              triggerRef.current = e.currentTarget;
              setIndex(i);
              setOpen(true);
            }}
          >
            <img src={p.src} alt={p.caption ?? ""} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>

      {open && current && (
        <div
          className="lightbox"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("journal.photosAria", { title })}
          onClick={() => setOpen(false)}
        >
          <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
            {count > 1 && (
              <button
                type="button"
                className="lightbox-nav prev"
                aria-label={t("journal.prevPhoto")}
                onClick={() => setIndex((i) => (i - 1 + count) % count)}
              >
                ‹
              </button>
            )}
            <img
              className="lightbox-img"
              src={current.src}
              alt={current.caption ?? t("journal.photoAlt", { title })}
            />
            {count > 1 && (
              <button
                type="button"
                className="lightbox-nav next"
                aria-label={t("journal.nextPhoto")}
                onClick={() => setIndex((i) => (i + 1) % count)}
              >
                ›
              </button>
            )}
          </div>

          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-meta">
              <span className="journal-lightbox-caption">{current.caption ?? ""}</span>
              {count > 1 && (
                <span className="lightbox-count" aria-hidden>
                  {safeIndex + 1} / {count}
                </span>
              )}
            </div>
            <div className="lightbox-actions">
              <button
                ref={closeRef}
                type="button"
                className="btn-ghost"
                onClick={() => setOpen(false)}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A read-only month calendar of the journal. Each day with ≥1 entry is tinted by
 * its dominant place's continent colour, alpha-scaled by the entry count; the day
 * number and a count badge carry the same information without relying on colour
 * (WCAG 2.1 AA). Days are buttons: one with entries filters the feed to that day,
 * an empty one opens the composer pre-dated to it (handled by the parent).
 */
function JournalCalendar({
  ym,
  dayIndex,
  onPrev,
  onNext,
  onPick,
}: {
  ym: string;
  dayIndex: Map<string, StoryDayCell>;
  onPrev: () => void;
  onNext: () => void;
  onPick: (cell: StoryDayCell | undefined, iso: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const weeks = useMemo(() => monthMatrix(ym), [ym]);
  const [y, m] = ym.split("-").map(Number);
  const caption = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(y!, m! - 1, 1),
  );
  // Localized weekday abbreviations, ordered from FIRST_DAY_OF_WEEK (2023-01-01 is a Sunday).
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(Date.UTC(2023, 0, 1 + ((FIRST_DAY_OF_WEEK + i) % 7)))),
    );
  }, [locale]);
  // Legend: only the continents actually present this month (canonical order),
  // plus a neutral "Elsewhere" bucket when a day's country has no continent.
  const legend = useMemo(() => {
    const present = new Set<string>();
    let hasOther = false;
    for (const week of weeks)
      for (const day of week) {
        if (!day.inMonth) continue;
        const cell = dayIndex.get(day.iso);
        if (!cell) continue;
        if (cell.continent && (CONTINENT_ORDER as readonly string[]).includes(cell.continent))
          present.add(cell.continent);
        else hasOther = true;
      }
    const items: { label: string; color: string }[] = CONTINENT_ORDER.filter((c) =>
      present.has(c),
    ).map((c) => ({ label: c, color: continentColor(c) }));
    if (hasOther) items.push({ label: t("journal.cal.legendOther"), color: CONTINENT_FALLBACK });
    return items;
  }, [weeks, dayIndex, t]);

  return (
    <div className="journal-cal">
      <div className="journal-cal-head">
        <button
          className="mini-btn"
          type="button"
          aria-label={t("journal.cal.prevMonth")}
          onClick={onPrev}
        >
          ‹
        </button>
        <span className="journal-cal-title" aria-live="polite">
          {caption}
        </span>
        <button
          className="mini-btn"
          type="button"
          aria-label={t("journal.cal.nextMonth")}
          onClick={onNext}
        >
          ›
        </button>
      </div>
      <table className="journal-cal-grid" aria-label={t("journal.cal.gridAria")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {weekdays.map((w, i) => (
              <th key={i} scope="col" abbr={w}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day) =>
                !day.inMonth ? (
                  <td key={day.iso} className="journal-cal-pad" aria-hidden />
                ) : (
                  (() => {
                    const cell = dayIndex.get(day.iso);
                    const count = cell?.count ?? 0;
                    const style = cell
                      ? { backgroundColor: hexToRgba(cell.color, cell.intensity) }
                      : undefined;
                    const label = count
                      ? t.plural("journal.cal.dayEntriesAria", count, { date: formatDate(day.iso) })
                      : t("journal.cal.dayEmptyAria", { date: formatDate(day.iso) });
                    return (
                      <td key={day.iso} className="journal-cal-cell">
                        <button
                          type="button"
                          className={"journal-cal-day" + (count ? " has-entries" : "")}
                          style={style}
                          aria-label={label}
                          onClick={() => onPick(cell, day.iso)}
                        >
                          <span className="journal-cal-num" aria-hidden>
                            {day.dayOfMonth}
                          </span>
                          {count > 1 && (
                            <span className="journal-cal-badge" aria-hidden>
                              {count}
                            </span>
                          )}
                          {count === 1 && <span className="journal-cal-dot" aria-hidden />}
                        </button>
                      </td>
                    );
                  })()
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {legend.length > 0 && (
        <ul className="journal-cal-legend" aria-label={t("journal.cal.legendAria")}>
          {legend.map((it) => (
            <li key={it.label} className="journal-cal-legend-item">
              <span
                className="journal-cal-swatch"
                style={{ backgroundColor: it.color }}
                aria-hidden
              />
              {it.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Journal — a mini travel blog of the places you've been. Stories are personal
 * data only (title, text, photos), stored on-device and carried in the same
 * portable file as everything else. The feed is newest-first; the composer
 * writes about a place from YOUR visited list.
 */
export function JournalScreen() {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const stories = useStories((s) => s.stories);
  const addStory = useStories((s) => s.addStory);
  const updateStory = useStories((s) => s.updateStory);
  const removeStory = useStories((s) => s.removeStory);
  const restoreStory = useStories((s) => s.restoreStory);
  const storiesLoaded = useStories((s) => s.loaded);
  const visits = useVisits((s) => s.visits);
  const trips = useTrips((s) => s.trips);
  const showToast = useToast((s) => s.show);
  const draftRequest = useUi((s) => s.journalDraftRequest);

  // Publish mode (shareable travel-blog site) — opened from the toolbar.
  const [publishOpen, setPublishOpen] = useState(false);

  // Closed by default: the page shows your memories, not an empty form. Open the
  // composer from the toolbar buttons up top, or by long-pressing the page. (A
  // recovered draft still reopens it on mount — see the draft-restore effect.)
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceRef | null>(null);
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  // A restored editing draft carries no photos (they aren't cached); this holds
  // the story id whose photos still need rehydrating from the store.
  const hydratePhotosFor = useRef<string | null>(null);
  const [nearby, setNearby] = useState<{ city: City; km: number }[] | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [feedShown, setFeedShown] = useState(FEED_PAGE);
  const [dayChoice, setDayChoice] = useState(false);
  // Feed filters: by destination / country / folder, and by year (the "blog" views).
  const [filterSel, setFilterSel] = useState("all");
  const [yearSel, setYearSel] = useState("all");
  // Free-text search over a story's city/place name (and its country), accent- and
  // case-insensitive. Refines BOTH the feed and the calendar so the two agree.
  const [query, setQuery] = useState("");
  // Feed vs month-calendar view, the calendar's visible month ("YYYY-MM"), and an
  // optional single-day filter set by tapping a calendar day.
  const [view, setView] = useState<"feed" | "calendar" | "byplace" | "timeline" | "map">("feed");
  const [calMonth, setCalMonth] = useState<string>(() => ymOf(today()));
  const [daySel, setDaySel] = useState<string | null>(null);

  // Places you can write about: your visited list, sorted by name. A prefilled
  // or edited place that's no longer visited is kept as an extra option so the
  // select never shows a phantom value.
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

  // Blog views: filter stories by country, by destination, and by year.
  const storyCountries = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stories) {
      const iso2 = s.place.countryId;
      if (iso2 && iso2 !== "ZZ" && !m.has(iso2)) m.set(iso2, ref.countryByIso2(iso2)?.name ?? iso2);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [stories, ref]);
  const storyPlaces = useMemo(() => {
    const m = new Map<string, PlaceRef>();
    for (const s of stories) if (!m.has(placeKey(s.place))) m.set(placeKey(s.place), s.place);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [stories]);
  const storyYears = useMemo(() => distinctYearsDesc(stories), [stories]);
  const storyFolders = useMemo(() => distinctFolders(stories), [stories]);

  // Self-heal a filter that points at something that no longer exists — e.g. you
  // filtered to a folder/country/year, then deleted its last story. Without this
  // the feed shows an empty "no match" state while the dropdown snaps back to
  // "All", reading as a broken empty screen.
  useEffect(() => {
    if (filterSel === "all") return;
    const kind = filterSel.slice(0, 2);
    const val = filterSel.slice(2);
    const stillThere =
      (kind === "c:" && storyCountries.some(([iso2]) => iso2 === val)) ||
      (kind === "p:" && storyPlaces.some((p) => placeKey(p) === val)) ||
      (kind === "f:" && storyFolders.includes(val));
    if (!stillThere) {
      setFilterSel("all");
      setDaySel(null);
      setFeedShown(FEED_PAGE);
    }
  }, [filterSel, storyCountries, storyPlaces, storyFolders]);
  useEffect(() => {
    if (yearSel !== "all" && yearSel !== "none" && !storyYears.includes(yearSel)) {
      setYearSel("all");
      setFeedShown(FEED_PAGE);
    }
  }, [yearSel, storyYears]);

  // The place/country/folder part of the feed filter, shared by BOTH the feed and
  // the calendar so the calendar respects the current place filter. Year and the
  // single-day filter are layered on top separately (so you can filter place AND time).
  const matchesPlaceFilter = useMemo(
    () => (s: Story) => {
      if (filterSel.startsWith("c:")) return s.place.countryId === filterSel.slice(2);
      if (filterSel.startsWith("p:")) return placeKey(s.place) === filterSel.slice(2);
      if (filterSel.startsWith("f:")) return matchesFolder(s, filterSel.slice(2));
      return true;
    },
    [filterSel],
  );
  const placeFiltered = useMemo(
    () => stories.filter(matchesPlaceFilter),
    [stories, matchesPlaceFilter],
  );
  // Layer the text search on top of the place filter: match the words the user
  // actually wrote — the entry's title and body — plus its place, folder and
  // country (accent-insensitive). Empty query is a no-op passthrough.
  const searched = useMemo(() => {
    const needle = norm(query.trim());
    if (!needle) return placeFiltered;
    return placeFiltered.filter((s) => {
      if (norm(s.place.name).includes(needle)) return true;
      if (norm(s.title).includes(needle)) return true;
      if (norm(s.text).includes(needle)) return true;
      if (norm(s.folder ?? "").includes(needle)) return true;
      const cn = s.place.countryId ? ref.countryByIso2(s.place.countryId)?.name : null;
      return cn ? norm(cn).includes(needle) : false;
    });
  }, [placeFiltered, query, ref]);
  const filtered = useMemo(() => {
    return searched.filter((s) => {
      // A tapped calendar day pins the feed to that exact day (supersedes the year).
      if (daySel) return s.date === daySel;
      if (yearSel === "none" && s.date) return false;
      if (yearSel !== "all" && yearSel !== "none" && s.date?.slice(0, 4) !== yearSel) return false;
      return true;
    });
  }, [searched, yearSel, daySel]);

  // "By place" view: the filtered stories grouped by their place, so you see each
  // place you've written about and, inside, its entries over time. Groups are
  // ordered by most-recent entry; within a group the stories stay newest-first
  // (the store order `filtered` preserves).
  const byPlaceGroups = useMemo(() => {
    const m = new Map<string, { place: PlaceRef; stories: Story[] }>();
    for (const s of filtered) {
      const k = placeKey(s.place);
      const g = m.get(k);
      if (g) g.stories.push(s);
      else m.set(k, { place: s.place, stories: [s] });
    }
    return [...m.values()].sort(
      (a, b) =>
        (b.stories[0]?.date ?? "").localeCompare(a.stories[0]?.date ?? "") ||
        a.place.name.localeCompare(b.place.name),
    );
  }, [filtered]);

  // "Timeline" view: the filtered stories grouped by year (newest first; undated
  // last), so you scroll your travels in time order.
  const byYearGroups = useMemo(() => {
    const m = new Map<string, Story[]>();
    for (const s of filtered) {
      const y = s.date?.slice(0, 4) || "—";
      const g = m.get(y);
      if (g) g.push(s);
      else m.set(y, [s]);
    }
    return [...m.entries()].sort((a, b) =>
      a[0] === "—" ? 1 : b[0] === "—" ? -1 : b[0].localeCompare(a[0]),
    );
  }, [filtered]);

  // Per-day colour/count for the calendar — derived from the place- AND search-
  // filtered stories (month navigation handles time). Colour is keyed to the day's
  // dominant place's continent via the shared reference lookup.
  const dayIndex = useMemo(
    () => storyDayIndex(searched, (iso2) => ref.continentOf(iso2)),
    [searched, ref],
  );

  // Folders to propose while composing: existing folders + this story's place,
  // country, and any matching trip name (all pre-sanitized, deduped).
  const folderSuggs = useMemo(
    () =>
      folderSuggestions(stories, {
        place,
        countryName: place ? (ref.countryByIso2(place.countryId)?.name ?? null) : null,
        date,
        trips,
      }),
    [stories, place, date, trips, ref],
  );

  // Closes the composer without touching the draft cache: Escape/Cancel must
  // not lose writing — the draft comes back on the next visit. Keystrokes
  // still inside the debounce window are flushed first, same guarantee.
  function resetForm() {
    flushDraft();
    setComposerOpen(false);
    setEditingId(null);
    setPlace(null);
    setDate(today());
    setTitle("");
    setText("");
    setFolder("");
    setPhotos([]);
    setNearby(null);
    setGeoMsg(null);
    setDayChoice(false);
  }

  // The composer sits BELOW the feed/calendar now (your memories come first), so
  // opening it from a top button has to bring it into view.
  function scrollToComposer() {
    requestAnimationFrame(() =>
      document
        .querySelector(".journal-composer")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  function openComposer(prefill?: PlaceRef, dateStr?: string) {
    setEditingId(null);
    setPlace(prefill ?? null);
    setDate(dateStr ?? today());
    setTitle("");
    setText("");
    setFolder("");
    setPhotos([]);
    setNearby(null);
    setGeoMsg(null);
    setDayChoice(false);
    setComposerOpen(true);
    scrollToComposer();
  }

  // Long-press anywhere on the page (that isn't a control) to start a new entry —
  // a fast path to the composer now that it no longer sits open by default. A
  // press that moves (a scroll/drag) or lands on a button/link/field is ignored.
  const pressTimer = useRef<number | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  function cancelPress() {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function onPagePointerDown(e: React.PointerEvent) {
    if (composerOpen) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, [role='dialog']"))
      return;
    pressAt.current = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      openComposer();
    }, 500);
  }
  function onPagePointerMove(e: React.PointerEvent) {
    const s = pressAt.current;
    if (s && (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10)) cancelPress();
  }
  // Never leave a timer dangling if the screen unmounts mid-press.
  useEffect(() => cancelPress, []);

  /** Anything typed that a reset would lose. */
  const dirty = !!(title.trim() || text.trim() || photos.length);

  // "Daily story": jump straight into today's entry. Near midnight, ask which day
  // it's for first (a late night could be logging the day that just ended).
  // Writing in progress is never wiped — the tap then only sets the date.
  function startDailyStory() {
    const days = boundaryDays();
    if (days) {
      setDayChoice(true);
      return;
    }
    if (composerOpen && dirty) {
      setDate(today());
      scrollToComposer();
    } else openComposer(undefined, today());
  }

  /** A day picked near midnight: same rule — keep the writing, set the date. */
  function pickDay(iso: string) {
    if (composerOpen && dirty) {
      setDate(iso);
      setDayChoice(false);
      // The composer is below the feed/calendar — bring it into view so tapping a
      // day visibly does something (before, it silently just set the date).
      scrollToComposer();
    } else {
      openComposer(undefined, iso);
    }
  }

  /**
   * A calendar day was activated. A day WITH entries pins the feed to that day
   * (and switches to the feed so the entries are visible); an EMPTY day opens the
   * composer pre-dated to it (reusing the composer + draft cache via pickDay).
   */
  function pickCalendarDay(cell: StoryDayCell | undefined, iso: string) {
    if (cell) {
      setDaySel(iso);
      setFeedShown(FEED_PAGE);
      setView("feed");
    } else {
      pickDay(iso);
    }
  }

  function startEdit(s: Story) {
    setEditingId(s.storyId);
    setPlace(s.place);
    setDate(s.date);
    setTitle(s.title);
    setText(s.text);
    setFolder(s.folder ?? "");
    setPhotos(s.photos ?? []);
    setNearby(null);
    setGeoMsg(null);
    setDayChoice(false); // entering edit dismisses a lingering near-midnight prompt
    setComposerOpen(true);
    scrollToComposer();
  }

  // Restore a cached draft on mount, so quitting the page mid-writing picks up
  // where it left off. A pending "+ Story" prefill from a city page wins.
  useEffect(() => {
    if (useUi.getState().journalDraftRequest) return;
    const draft = loadDraft();
    if (!draft) return;
    setEditingId(draft.editingId);
    setPlace(draft.place);
    setDate(draft.date || today());
    setTitle(draft.title);
    setText(draft.text);
    setFolder(draft.folder);
    if (draft.editingId) hydratePhotosFor.current = draft.editingId;
    setComposerOpen(true);
    // Tell the user their in-progress writing was recovered — otherwise, with a
    // feed already filling the screen, the refilled composer below goes unnoticed.
    showToast(t("journal.toast.draftRecovered"));
    scrollToComposer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rehydrate a restored edit's photos once stories are loaded — saving with
  // the cache's empty photo list would silently wipe the story's gallery. A
  // story deleted since the draft was cached keeps the writing as a new story.
  useEffect(() => {
    const id = hydratePhotosFor.current;
    if (!id || !storiesLoaded) return;
    hydratePhotosFor.current = null;
    const s = useStories.getState().stories.find((x) => x.storyId === id);
    if (s) setPhotos(s.photos ?? []);
    else setEditingId(null);
  }, [storiesLoaded]);

  // Latest draft not yet written to localStorage (see the mirror effect below).
  const pendingDraft = useRef<ComposerDraft | null>(null);

  /** Write the pending draft now — the debounce timer's callback, also called
   *  on every path that could otherwise lose the last keystrokes. */
  function flushDraft() {
    const draft = pendingDraft.current;
    if (!draft) return;
    pendingDraft.current = null;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* private mode: not cached */
    }
  }

  // Mirror the draft to localStorage while the composer is open. A blank
  // composer is skipped so opening "New story" doesn't clobber a kept draft
  // before any writing happens. The write is debounced: a synchronous
  // storage write on every keystroke stalls typing on slow devices, and the
  // flush paths below make sure quitting mid-burst still keeps everything.
  //
  // An edit still matching its story holds no writing: it is not mirrored, and a
  // draft cached for it (an older build mirrored every Edit) is dropped, so an
  // untouched Edit never reopens as a recovered draft or saves stale text back.
  useEffect(() => {
    if (!composerOpen) return;
    if (!title.trim() && !text.trim() && !place && !editingId) return;
    const s = editingId ? stories.find((x) => x.storyId === editingId) : undefined;
    if (
      s &&
      place &&
      placeKey(place) === placeKey(s.place) &&
      date === s.date &&
      title === s.title &&
      text === s.text &&
      folder === (s.folder ?? "")
    ) {
      pendingDraft.current = null;
      if (loadDraft()?.editingId === editingId) clearDraft();
      return;
    }
    pendingDraft.current = { editingId, place, date, title, text, folder };
    const timer = setTimeout(flushDraft, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, editingId, place, date, title, text, folder, stories]);

  // Flush the pending draft whenever the writing could otherwise be lost:
  // app backgrounded or closed (visibilitychange/pagehide), or this screen
  // unmounting on a tab switch. flushDraft only touches refs, so the mount
  // -time closure stays correct.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushDraft);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushDraft);
      flushDraft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geolocation runs ONLY on this tap (privacy: the position is requested on an
  // explicit action, used once to rank suggestions, and never stored). Picking
  // a suggestion just fills the Place field; nothing is logged as visited.
  function findNearby() {
    setGeoMsg(null);
    setNearby(null);
    if (!navigator.geolocation) {
      setGeoMsg(t("journal.geo.unavailableDevice"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const found = nearestCities(
          { lat: pos.coords.latitude, lon: pos.coords.longitude },
          ref.allCities(),
        );
        if (found.length) setNearby(found);
        else setGeoMsg(t("journal.geo.noCities"));
      },
      () => {
        setLocating(false);
        setGeoMsg(t("journal.geo.unavailable"));
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // A "+ Story" tap on a city page opens the composer prefilled with that place.
  // The request is cleared once consumed so revisiting the tab doesn't re-open it.
  useEffect(() => {
    if (!draftRequest) return;
    openComposer(draftRequest.place);
    useUi.setState({ journalDraftRequest: null });
  }, [draftRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the calendar's visible month in step with the year filter: choosing a
  // specific year jumps the calendar into it (keeping the month number), so place
  // and time stay consistent between the feed and the calendar.
  useEffect(() => {
    if (yearSel !== "all" && yearSel !== "none" && calMonth.slice(0, 4) !== yearSel) {
      setCalMonth(`${yearSel}-${calMonth.slice(5, 7)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearSel]);

  // Escape closes the composer (keyboard-first) — but only when there's
  // something to close: the always-open blank form must not swallow the
  // Escape/Back that navigates away from the Journal.
  useEffect(() => {
    if (!composerOpen || !(dirty || editingId)) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") resetForm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, dirty, editingId]);

  // Escape/Back steps out of a drilled-in view (map/timeline/by-place/calendar)
  // back to the feed, then clears a picked day — before leaving the Journal. A
  // dirty composer is caught by the handler above (App skips interceptors while
  // it's open), so this only runs on the plain list.
  useEffect(() => {
    return registerEscape(() => {
      if (view !== "feed") {
        setView("feed");
        return true;
      }
      if (daySel) {
        setDaySel(null);
        return true;
      }
      return false;
    });
  }, [view, daySel]);

  async function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // let the user re-pick the same file later
    if (!picked.length) return;
    const room = MAX_PHOTOS_PER_STORY - photos.length;
    if (room <= 0) {
      showToast(t("journal.toast.storyFull", { max: MAX_PHOTOS_PER_STORY }));
      return;
    }
    const files = picked.slice(0, room);
    setBusy(true);
    try {
      const added: Photo[] = [];
      for (const file of files) {
        added.push({ src: await fileToPostcard(file), caption: null });
      }
      setPhotos((prev) => [...prev, ...added]);
      if (picked.length > room) showToast(t("journal.toast.addedRoom", { count: room }));
    } catch {
      showToast(t("journal.toast.readImgErr"));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Store the SANITIZED text (same transform the portable-file schema applies),
    // so what's saved round-trips: a title like "===" collapses to empty and must
    // not be storable — it would export as "" and the backup would refuse to restore.
    const cleanTitle = sanitizeText(title, 200);
    const cleanText = sanitizeText(text, 8000);
    // Allow an image-only entry: a place + date and at least one of title/text/photo.
    if (!place || !date || !(cleanTitle || cleanText || photos.length)) return;
    // Blank captions become null (never stored as empty strings).
    const cleanPhotos = photos.map((p) => ({
      ...p,
      caption: p.caption?.trim() ? p.caption.trim() : null,
    }));
    // Sanitize the folder label to inert text (same rule as title/text) before it
    // is stored; an empty result clears the folder (the store drops the key).
    const cleanFolder = sanitizeText(folder, 80);
    const fields = {
      place,
      date,
      title: cleanTitle,
      text: cleanText,
      folder: cleanFolder,
      photos: cleanPhotos,
    };
    // A titleless (image-only) entry uses its place as the toast label.
    const label = cleanTitle || place.name;
    // Undo puts back the one story it changed, as a fresh write, so it also
    // holds once a sync has pushed the change it undoes.
    if (editingId) {
      const before = useStories.getState().stories.find((x) => x.storyId === editingId);
      await updateStory(editingId, fields);
      showToast(
        t("journal.toast.updated", { title: label }),
        before && (() => restoreStory(before)),
      );
    } else {
      const added = await addStory(fields);
      showToast(t("journal.toast.added", { title: label }), () => removeStory(added.storyId));
    }
    resetForm();
    // The writing is stored; the crash-recovery cache has done its job.
    clearDraft();
  }

  function removeWithUndo(s: Story) {
    void removeStory(s.storyId);
    showToast(t("journal.toast.removed", { title: s.title || s.place.name }), () => restoreStory(s));
  }

  async function exportMd() {
    try {
      await download(JOURNAL_EXPORT_FILENAME, journalToMarkdown(stories, ref), "text/markdown");
    } catch {
      showToast(t("journal.toast.exportErr"));
    }
  }

  return (
    <section
      aria-label={t("journal.title")}
      onPointerDown={onPagePointerDown}
      onPointerMove={onPagePointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
    >
      <div className="section-head">
        <h2>{t("journal.title")}</h2>
      </div>

      <div className="btn-row journal-toolbar">
        <button className="btn" type="button" onClick={startDailyStory}>
          📔 {t("journal.todayStory")}
        </button>
        {!composerOpen && (
          <button className="btn-ghost" type="button" onClick={() => openComposer()}>
            ＋ {t("journal.newStory")}
          </button>
        )}
        {stories.length > 0 && (
          <button className="btn-ghost" type="button" onClick={() => void exportMd()}>
            {t("journal.exportMd")}
          </button>
        )}
        {(stories.length > 0 || trips.length > 0) && (
          <button className="btn-ghost" type="button" onClick={() => setPublishOpen(true)}>
            🌍 {t("journal.publishSite")}
          </button>
        )}
      </div>

      {!composerOpen && stories.length > 0 && (
        <p className="muted small journal-press-hint">{t("journal.pressHint")}</p>
      )}

      {publishOpen && (
        <Suspense fallback={null}>
          <PublishScreen onClose={() => setPublishOpen(false)} />
        </Suspense>
      )}
      {dayChoice && (
        <div className="day-choice" role="group" aria-label={t("journal.dayChoiceAria")}>
          <span className="muted small">{t("journal.whichDay")}</span>
          {boundaryDays()?.map(({ iso, hint }) => (
            <button key={iso} className="mini-btn" type="button" onClick={() => pickDay(iso)}>
              {formatDate(iso)} · {t(`journal.day.${hint}` as MessageKey)}
            </button>
          ))}
          <button className="link" type="button" onClick={() => setDayChoice(false)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {stories.length > 0 && <p className="muted small">{t("journal.exportNote")}</p>}

      {stories.length === 0 ? (
        <p className="muted empty">
          <span className="empty-emoji" aria-hidden>
            ✍️
          </span>
          {t("journal.empty")}
        </p>
      ) : (
        <>
          {/* Feed vs month-calendar view. Both honour the place filter above. */}
          <div className="journal-viewtabs btn-row" role="group" aria-label={t("journal.viewAria")}>
            <button
              type="button"
              className={"mini-btn" + (view === "feed" ? " mini-on" : "")}
              aria-pressed={view === "feed"}
              onClick={() => setView("feed")}
            >
              {t("journal.viewFeed")}
            </button>
            <button
              type="button"
              className={"mini-btn" + (view === "byplace" ? " mini-on" : "")}
              aria-pressed={view === "byplace"}
              onClick={() => setView("byplace")}
            >
              📍 {t("journal.viewByPlace")}
            </button>
            <button
              type="button"
              className={"mini-btn" + (view === "timeline" ? " mini-on" : "")}
              aria-pressed={view === "timeline"}
              onClick={() => setView("timeline")}
            >
              🕰️ {t("journal.viewTimeline")}
            </button>
            <button
              type="button"
              className={"mini-btn" + (view === "map" ? " mini-on" : "")}
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              🗺️ {t("journal.viewMap")}
            </button>
            <button
              type="button"
              className={"mini-btn" + (view === "calendar" ? " mini-on" : "")}
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
            >
              🗓️ {t("journal.viewCalendar")}
            </button>
          </div>

          {stories.length > 1 && (
            <div className="journal-search-row">
              <span className="journal-search-ico" aria-hidden>
                🔍
              </span>
              <label className="sr-only" htmlFor="journal-search">
                {t("journal.searchLabel")}
              </label>
              <input
                id="journal-search"
                className="select journal-search-input"
                type="search"
                value={query}
                placeholder={t("journal.searchPlaceholder")}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDaySel(null);
                  setFeedShown(FEED_PAGE);
                }}
              />
              {query && (
                <button
                  className="link journal-search-clear"
                  type="button"
                  aria-label={t("journal.searchClear")}
                  onClick={() => {
                    setQuery("");
                    setFeedShown(FEED_PAGE);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
          {stories.length > 1 && (
            <div className="journal-filters">
              <label className="picker-label">
                {t("journal.show")}
                <select
                  className="select"
                  value={filterSel}
                  onChange={(e) => {
                    setFilterSel(e.target.value);
                    setDaySel(null);
                    setFeedShown(FEED_PAGE);
                  }}
                >
                  <option value="all">{t("journal.allDestinations")}</option>
                  {storyCountries.length > 0 && (
                    <optgroup label={t("journal.byCountry")}>
                      {storyCountries.map(([iso2, name]) => (
                        <option key={iso2} value={`c:${iso2}`}>
                          {countryFlag(iso2)} {name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {storyPlaces.length > 1 && (
                    <optgroup label={t("journal.byDestination")}>
                      {storyPlaces.map((p) => (
                        <option key={placeKey(p)} value={`p:${placeKey(p)}`}>
                          {countryFlag(p.countryId)} {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {storyFolders.length > 0 && (
                    <optgroup label={t("journal.byFolder")}>
                      {storyFolders.map((f) => (
                        <option key={f} value={`f:${f}`}>
                          🗂️ {f}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              {storyYears.length > 0 && (
                <label className="picker-label">
                  {t("journal.when")}
                  <select
                    className="select"
                    value={yearSel}
                    onChange={(e) => {
                      setYearSel(e.target.value);
                      setDaySel(null);
                      setFeedShown(FEED_PAGE);
                    }}
                  >
                    <option value="all">{t("journal.anyYear")}</option>
                    {storyYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                    <option value="none">{t("journal.noDate")}</option>
                  </select>
                </label>
              )}
            </div>
          )}
          {/* A calendar day tap pins the feed to that day; a clearable chip shows it. */}
          {daySel && view === "feed" && (
            <div className="journal-dayfilter">
              <span className="mini-btn mini-on">
                📅 {t("journal.daySelected", { date: formatDate(daySel) })}
              </span>
              <button
                className="link"
                type="button"
                aria-label={t("journal.clearDayAria")}
                onClick={() => {
                  setDaySel(null);
                  setFeedShown(FEED_PAGE);
                }}
              >
                ✕
              </button>
            </div>
          )}

          {view === "calendar" ? (
            <JournalCalendar
              ym={calMonth}
              dayIndex={dayIndex}
              onPrev={() => setCalMonth((mth) => addMonths(mth, -1))}
              onNext={() => setCalMonth((mth) => addMonths(mth, 1))}
              onPick={pickCalendarDay}
            />
          ) : filtered.length === 0 ? (
            <p className="muted empty">
              {t("journal.noMatch")}{" "}
              <button
                className="link"
                type="button"
                onClick={() => {
                  setFilterSel("all");
                  setYearSel("all");
                  setDaySel(null);
                  setQuery("");
                }}
              >
                {t("journal.clearFilters")}
              </button>
            </p>
          ) : view === "byplace" ? (
            <div className="journal-byplace">
              {byPlaceGroups.map(({ place, stories: ps }) => {
                const yrs = ps
                  .map((s) => s.date?.slice(0, 4))
                  .filter((y): y is string => !!y);
                const span = yrs.length
                  ? yrs[0] === yrs[yrs.length - 1]
                    ? yrs[0]
                    : `${yrs[yrs.length - 1]}–${yrs[0]}`
                  : "";
                return (
                  <details
                    key={placeKey(place)}
                    className="journal-place-group"
                    open={byPlaceGroups.length <= 4}
                  >
                    <summary className="journal-place-summary">
                      <span className="journal-place-name">
                        {countryFlag(place.countryId)} {place.name}
                      </span>
                      <span className="muted small journal-place-meta">
                        {ps.length} {t.plural("noun.story", ps.length)}
                        {span ? ` · ${span}` : ""}
                      </span>
                    </summary>
                    <ul className="journal-place-entries">
                      {ps.map((s) => (
                        <li key={s.storyId}>
                          <button
                            className="link journal-place-entry"
                            type="button"
                            onClick={() => startEdit(s)}
                            aria-label={t("journal.editAria", {
                              title: s.title || s.place.name,
                            })}
                          >
                            <time className="journal-date">{formatDate(s.date)}</time>
                            <span className="journal-place-entry-title">
                              {s.title ||
                                (s.text ? s.text.split("\n")[0] : "") ||
                                t("journal.untitledEntry")}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          ) : view === "timeline" ? (
            <div className="journal-timeline">
              {byYearGroups.map(([year, ps]) => (
                <section key={year} className="journal-year-group">
                  <h3 className="journal-year-head">
                    {year === "—" ? t("journal.noDate") : year}
                    <span className="muted small">
                      {ps.length} {t.plural("noun.story", ps.length)}
                    </span>
                  </h3>
                  <ul className="journal-place-entries">
                    {ps.map((s) => (
                      <li key={s.storyId}>
                        <button
                          className="link journal-place-entry"
                          type="button"
                          onClick={() => startEdit(s)}
                          aria-label={t("journal.editAria", { title: s.title || s.place.name })}
                        >
                          <time className="journal-date">{formatDate(s.date)}</time>
                          <span className="journal-place-entry-title">
                            {countryFlag(s.place.countryId)} {s.place.name}
                            {s.title ? ` — ${s.title}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : view === "map" ? (
            <StoryMap stories={filtered} />
          ) : (
          <>
          <div className="journal-feed">
            {filtered.slice(0, feedShown).map((s) => (
              <article key={s.storyId} className="journal-card">
                <header className="journal-card-head">
                  <time className="journal-date">{formatDate(s.date)}</time>
                  <span aria-hidden>·</span>
                  {CITY_PAGE_KINDS.includes(s.place.kind) ? (
                    <button
                      className="link journal-place"
                      type="button"
                      onClick={() => useUi.getState().openCity(s.place.id)}
                    >
                      {countryFlag(s.place.countryId)} {s.place.name}
                    </button>
                  ) : (
                    <span className="journal-place">
                      {countryFlag(s.place.countryId)} {s.place.name}
                    </span>
                  )}
                  {s.folder && (
                    <>
                      <span aria-hidden>·</span>
                      <button
                        className="link journal-folder-tag"
                        type="button"
                        aria-label={t("journal.byFolder") + ": " + s.folder}
                        onClick={() => {
                          setFilterSel(`f:${s.folder}`);
                          setDaySel(null);
                          setView("feed");
                          setFeedShown(FEED_PAGE);
                        }}
                      >
                        🗂️ {s.folder}
                      </button>
                    </>
                  )}
                </header>
                {s.title && <h3 className="journal-title">{s.title}</h3>}
                {s.text && <p className="journal-text">{s.text}</p>}
                <StoryPhotos photos={s.photos ?? []} title={s.title || s.place.name} />
                <footer className="journal-actions">
                  <button
                    className="link"
                    type="button"
                    onClick={() => startEdit(s)}
                    aria-label={t("journal.editAria", { title: s.title || s.place.name })}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    className="link-danger"
                    type="button"
                    onClick={() => removeWithUndo(s)}
                    aria-label={t("journal.removeAria", { title: s.title || s.place.name })}
                  >
                    {t("common.remove")}
                  </button>
                </footer>
              </article>
            ))}
          </div>
          {filtered.length > feedShown && (
            <ListPager
              shown={feedShown}
              total={filtered.length}
              step={Math.min(FEED_PAGE, filtered.length - feedShown)}
              onMore={() => setFeedShown((n) => n + FEED_PAGE)}
            />
          )}
          </>
          )}
        </>
      )}

      {composerOpen && (
        <form
          className={"trip-form journal-composer" + (dirty || editingId ? " journal-composer-busy" : "")}
          onSubmit={onSubmit}
        >
          {editingId && <p className="editing-note">{t("journal.editingNote")}</p>}
          <div className="trip-form-row">
            <label className="picker-label" htmlFor="story-place">
              {t("journal.place")}
              <select
                id="story-place"
                className="select"
                value={place ? placeKey(place) : ""}
                onChange={(e) => {
                  setPlace(placeOptions.find((p) => placeKey(p) === e.target.value) ?? null);
                  setNearby(null);
                }}
              >
                <option value="" disabled>
                  {visitedPlaces.length ? t("journal.pickPlace") : t("journal.noVisited")}
                </option>
                {placeOptions.map((p) => (
                  <option key={placeKey(p)} value={placeKey(p)}>
                    {countryFlag(p.countryId)} {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="picker-label" htmlFor="story-date">
              {t("journal.date")}
              <input
                id="story-date"
                className="select"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <div>
            <button className="mini-btn" type="button" disabled={locating} onClick={findNearby}>
              📍 {locating ? t("journal.locating") : t("journal.nearMe")}
            </button>{" "}
            <span className="muted small" role="status">
              {geoMsg}
            </span>
          </div>
          {nearby && (
            <div className="btn-row" role="group" aria-label={t("journal.nearYouAria")}>
              {nearby.map(({ city, km }) => (
                <button
                  key={city.id}
                  className="mini-btn"
                  type="button"
                  aria-label={t("journal.writeAboutAria", { city: city.name, km: formatKm(km) })}
                  onClick={() => {
                    // Only fills the Place field — nothing gets marked as visited.
                    setPlace({
                      kind: "city",
                      id: city.id,
                      name: city.name,
                      countryId: city.countryIso2,
                    });
                    setNearby(null);
                    setGeoMsg(null);
                  }}
                >
                  {countryFlag(city.countryIso2)} {city.name} · {formatKm(km)}
                </button>
              ))}
            </div>
          )}
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
            {t("journal.story")}
            <textarea
              id="story-text"
              className="select journal-textarea"
              rows={6}
              maxLength={8000}
              placeholder={t("journal.storyPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="picker-label" htmlFor="story-folder">
            {t("journal.folder")}
            <input
              id="story-folder"
              className="select"
              type="text"
              maxLength={80}
              list="journal-folder-suggestions"
              placeholder={t("journal.folderPlaceholder")}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
          </label>
          {/* Proposed folders (existing + this story's place/country/trip), a native
              accessible combobox: type a new folder or pick a suggestion, empty = none. */}
          {folderSuggs.length > 0 && (
            <datalist id="journal-folder-suggestions">
              {folderSuggs.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
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
                      setPhotos((prev) =>
                        prev.map((q, j) =>
                          j === i ? { ...q, caption: e.target.value || null } : q,
                        ),
                      )
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
              title={
                photos.length >= MAX_PHOTOS_PER_STORY
                  ? t("journal.storyFullTitle", { max: MAX_PHOTOS_PER_STORY })
                  : undefined
              }
              onClick={() => photoInput.current?.click()}
            >
              {busy ? "…" : `📷 ${t("journal.addPhotos")}`}
            </button>
          </div>

          <div className="trip-form-actions">
            <button
              className="btn"
              type="submit"
              // A story needs a place + date and SOMETHING to say — a title, some
              // text, or at least one photo (an image-only entry is allowed).
              disabled={
                !place ||
                !date ||
                !(sanitizeText(title, 200) || sanitizeText(text, 8000) || photos.length)
              }
            >
              {editingId ? t("journal.saveChanges") : t("journal.saveStory")}
            </button>
            <button className="btn-ghost" type="button" onClick={resetForm}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

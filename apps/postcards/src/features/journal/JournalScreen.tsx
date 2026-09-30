import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { StoryMap } from "./StoryMap";
import { useStories } from "../../lib/store/useStories";
import { useTrips } from "../../lib/store/useTrips";
import { useToast } from "../../lib/store/useToast";
import { useUi } from "../../lib/store/useUi";
import { registerEscape } from "../../lib/store/escapeStack";
import { useModalKeys } from "../../lib/hooks/useModalKeys";
import { countryFlag, formatDate } from "../../lib/format/format";
import { distinctYearsDesc } from "../travel/period";
import { placeKey } from "../../lib/schema/helpers";
import type { Photo, PlaceRef, Story } from "../../lib/schema/models";
import { journalToMarkdown, JOURNAL_EXPORT_FILENAME } from "./exportJournalMd";
import { download } from "../../lib/download";
import { useT, useLocale } from "../../lib/i18n";
import { distinctFolders, matchesFolder } from "./folders";
import { placesOf, primaryPlace, isUnplaced, dateSpan } from "./postcardModel";
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
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
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
  const removeStory = useStories((s) => s.removeStory);
  const setAll = useStories((s) => s.setAll);
  const trips = useTrips((s) => s.trips);
  const showToast = useToast((s) => s.show);

  // Publish mode (shareable travel-blog site) — opened from the toolbar.
  const [publishOpen, setPublishOpen] = useState(false);

  // Writing happens on the focused composer PAGE now (spec 020), opened via
  // useUi.openStoryComposer — not an inline form here. This screen is purely the
  // reader (feed / by place / timeline / map / calendar) plus its filters.
  const [feedShown, setFeedShown] = useState(FEED_PAGE);
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

  // Blog views: filter stories by country, by destination, and by year. Multi-place
  // postcards contribute EACH of their places; a place-less postcard contributes none.
  const storyCountries = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stories)
      for (const p of placesOf(s)) {
        const iso2 = p.countryId;
        if (iso2 && iso2 !== "ZZ" && !m.has(iso2)) m.set(iso2, ref.countryByIso2(iso2)?.name ?? iso2);
      }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [stories, ref]);
  const storyPlaces = useMemo(() => {
    const m = new Map<string, PlaceRef>();
    for (const s of stories) for (const p of placesOf(s)) if (!m.has(placeKey(p))) m.set(placeKey(p), p);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [stories]);
  const storyYears = useMemo(() => distinctYearsDesc(stories), [stories]);
  const storyFolders = useMemo(() => distinctFolders(stories), [stories]);
  const storyTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of stories) for (const tag of s.tags ?? []) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [stories]);

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
      (kind === "f:" && storyFolders.includes(val)) ||
      (kind === "t:" && storyTags.includes(val));
    if (!stillThere) {
      setFilterSel("all");
      setDaySel(null);
      setFeedShown(FEED_PAGE);
    }
  }, [filterSel, storyCountries, storyPlaces, storyFolders, storyTags]);
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
      // Match if ANY of the postcard's places satisfies the country/destination filter.
      if (filterSel.startsWith("c:")) return placesOf(s).some((p) => p.countryId === filterSel.slice(2));
      if (filterSel.startsWith("p:")) return placesOf(s).some((p) => placeKey(p) === filterSel.slice(2));
      if (filterSel.startsWith("f:")) return matchesFolder(s, filterSel.slice(2));
      if (filterSel.startsWith("t:")) return (s.tags ?? []).includes(filterSel.slice(2));
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
      if (norm(s.title).includes(needle)) return true;
      if (norm(s.text).includes(needle)) return true;
      if (norm(s.folder ?? "").includes(needle)) return true;
      if (s.tags?.some((tag) => norm(tag).includes(needle))) return true;
      // Any place's name or country matches (place-less postcards simply skip this).
      return placesOf(s).some((p) => {
        if (norm(p.name).includes(needle)) return true;
        const cn = p.countryId ? ref.countryByIso2(p.countryId)?.name : null;
        return cn ? norm(cn).includes(needle) : false;
      });
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
    const m = new Map<string, { place: PlaceRef | null; stories: Story[] }>();
    const UNPLACED = "__unplaced__";
    for (const s of filtered) {
      // A multi-place postcard appears under EACH of its places; a place-less one
      // lands in a single "Unplaced" bucket so it's never lost from this view.
      const keys = isUnplaced(s) ? [UNPLACED] : placesOf(s).map((p) => placeKey(p));
      for (const k of keys) {
        const g = m.get(k);
        if (g) g.stories.push(s);
        else m.set(k, { place: k === UNPLACED ? null : (placesOf(s).find((p) => placeKey(p) === k) ?? null), stories: [s] });
      }
    }
    return [...m.values()].sort(
      (a, b) =>
        (b.stories[0]?.date ?? "").localeCompare(a.stories[0]?.date ?? "") ||
        (a.place?.name ?? "").localeCompare(b.place?.name ?? ""),
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

  /** Open the focused composer PAGE (spec 020) for a new postcard or to edit one. */
  const openComposer = (storyId: string) => useUi.getState().openStoryComposer(storyId);
  /** A postcard's short label: its title, else its primary place, else "Untitled".
   *  Place is optional now (spec 020), so this never dereferences a missing place. */
  const entryLabel = (s: Story) => s.title || primaryPlace(s)?.name || t("journal.untitledEntry");

  /**
   * A calendar day was activated. A day WITH entries pins the feed to that day
   * (and switches to the feed so the entries are visible); an EMPTY day opens the
   * composer for a new postcard.
   */
  function pickCalendarDay(cell: StoryDayCell | undefined, iso: string) {
    if (cell) {
      setDaySel(iso);
      setFeedShown(FEED_PAGE);
      setView("feed");
    } else {
      openComposer("new");
    }
  }

  // Keep the calendar's visible month in step with the year filter: choosing a
  // specific year jumps the calendar into it (keeping the month number), so place
  // and time stay consistent between the feed and the calendar.
  useEffect(() => {
    if (yearSel !== "all" && yearSel !== "none" && calMonth.slice(0, 4) !== yearSel) {
      setCalMonth(`${yearSel}-${calMonth.slice(5, 7)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearSel]);

  // Escape/Back steps out of a drilled-in view (map/timeline/by-place/calendar)
  // back to the feed, then clears a picked day — before leaving the Journal.
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

  function removeWithUndo(s: Story) {
    const prev = useStories.getState().stories;
    void removeStory(s.storyId);
    const label = s.title || primaryPlace(s)?.name || t("journal.untitledEntry");
    showToast(t("journal.toast.removed", { title: label }), () => setAll(prev));
  }

  function exportMd() {
    try {
      download(JOURNAL_EXPORT_FILENAME, journalToMarkdown(stories, ref), "text/markdown");
    } catch {
      showToast(t("journal.toast.exportErr"));
    }
  }

  return (
    <section aria-label={t("journal.title")}>
      <div className="section-head">
        <h2>{t("journal.title")}</h2>
      </div>

      <div className="btn-row journal-toolbar">
        {/* The primary "write" control — opens the focused composer page (spec 020).
            `W` and a Journal-nav long-press reach the same action. */}
        <button className="btn" type="button" onClick={() => openComposer("new")}>
          ✍️ {t("journal.newStory")}
        </button>
        {stories.length > 0 && (
          <button className="btn-ghost" type="button" onClick={exportMd}>
            {t("journal.exportMd")}
          </button>
        )}
        {(stories.length > 0 || trips.length > 0) && (
          <button className="btn-ghost" type="button" onClick={() => setPublishOpen(true)}>
            🌍 {t("journal.publishSite")}
          </button>
        )}
      </div>

      {publishOpen && (
        <Suspense fallback={null}>
          <PublishScreen onClose={() => setPublishOpen(false)} />
        </Suspense>
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
                  {storyTags.length > 0 && (
                    <optgroup label={t("journal.byTag")}>
                      {storyTags.map((tag) => (
                        <option key={tag} value={`t:${tag}`}>
                          {tag}
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
                    key={place ? placeKey(place) : "unplaced"}
                    className="journal-place-group"
                    open={byPlaceGroups.length <= 4}
                  >
                    <summary className="journal-place-summary">
                      <span className="journal-place-name">
                        {place ? `${countryFlag(place.countryId)} ${place.name}` : t("journal.unplaced")}
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
                            onClick={() => openComposer(s.storyId)}
                            aria-label={t("journal.editAria", { title: entryLabel(s) })}
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
                          onClick={() => openComposer(s.storyId)}
                          aria-label={t("journal.editAria", { title: entryLabel(s) })}
                        >
                          <time className="journal-date">{formatDate(s.date)}</time>
                          <span className="journal-place-entry-title">
                            {primaryPlace(s) ? `${countryFlag(primaryPlace(s)!.countryId)} ${primaryPlace(s)!.name}` : t("journal.unplaced")}
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
            {filtered.slice(0, feedShown).map((s) => {
              const span = dateSpan(s);
              const prim = primaryPlace(s);
              return (
              <article key={s.storyId} className="journal-card">
                <header className="journal-card-head">
                  <time className="journal-date">
                    {span.end ? `${formatDate(span.start)} – ${formatDate(span.end)}` : formatDate(span.start)}
                  </time>
                  {prim && <span aria-hidden>·</span>}
                  {prim && CITY_PAGE_KINDS.includes(prim.kind) ? (
                    <button
                      className="link journal-place"
                      type="button"
                      onClick={() => useUi.getState().openCity(prim.id)}
                    >
                      {countryFlag(prim.countryId)} {prim.name}
                    </button>
                  ) : prim ? (
                    <span className="journal-place">
                      {countryFlag(prim.countryId)} {prim.name}
                    </span>
                  ) : null}
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
                {s.tags && s.tags.length > 0 && (
                  <ul className="journal-card-tags" aria-label={t("journal.composer.tags")}>
                    {s.tags.map((tag) => (
                      <li key={tag}>
                        <button
                          type="button"
                          className="journal-tag-chip"
                          onClick={() => {
                            setFilterSel(`t:${tag}`);
                            setDaySel(null);
                            setView("feed");
                            setFeedShown(FEED_PAGE);
                          }}
                        >
                          {tag}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <StoryPhotos photos={s.photos ?? []} title={entryLabel(s)} />
                <footer className="journal-actions">
                  <button
                    className="link"
                    type="button"
                    onClick={() => openComposer(s.storyId)}
                    aria-label={t("journal.editAria", { title: entryLabel(s) })}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    className="link-danger"
                    type="button"
                    onClick={() => removeWithUndo(s)}
                    aria-label={t("journal.removeAria", { title: entryLabel(s) })}
                  >
                    {t("common.remove")}
                  </button>
                </footer>
              </article>
              );
            })}
          </div>
          {filtered.length > feedShown && (
            <div className="list-pager">
              <span className="muted small">
                {t("journal.showingCount", { shown: feedShown, total: filtered.length })}
              </span>
              <button
                className="mini-btn"
                type="button"
                onClick={() => setFeedShown((n) => n + FEED_PAGE)}
              >
                {t("journal.showMore", { count: Math.min(FEED_PAGE, filtered.length - feedShown) })}
              </button>
            </div>
          )}
          </>
          )}
        </>
      )}

    </section>
  );
}

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useVisits } from "../../lib/store/useVisits";
import { useToast } from "../../lib/store/useToast";
import { useUi, type PlacesView } from "../../lib/store/useUi";
import { registerEscape } from "../../lib/store/escapeStack";
import { useSettings } from "../../lib/store/useSettings";
import { countryFlag } from "../../lib/format/format";
import { heritageGlyph } from "../../lib/reference/heritageGlyph";
import type { Visit } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { inScope } from "../../lib/reference/scope";
import { CityLine } from "../../ui/CityLine";
import { ScopeToggle } from "../../ui/ScopeToggle";
import { PhotoGallery } from "./PhotoGallery";
import { StateToggles } from "./StateToggles";
import { PassportScreen } from "../passport/PassportScreen";
import { ExperiencesScreen } from "../experiences/ExperiencesScreen";
import { PhotoWall } from "./PhotoWall";
import { ListPager } from "../../ui/ListPager";
import { MoreButton } from "../../ui/MoreButton";
import { browseList, type BrowseRow } from "./browseList";
import {
  useFilters,
  currentFilters,
  type FilterStatus,
  type FilterMode,
} from "../../lib/store/useFilters";
import { placeMatches, sortPlaces, activeChips } from "../filter/applyFilters";
import { FilterPanel } from "../../ui/FilterPanel";
import { FilterSummary } from "../../ui/FilterSummary";
import { useT, type TFunction } from "../../lib/i18n";

// The Places screen is ONE unified explore-&-track surface (spec 018): two
// independent single-select axes drive it — a KIND (what you're looking at) and a
// STATUS/scope (which of them) — plus a separate COLLECTIONS cluster (Moments /
// Photos / Passport) for the cross-cutting views that are not a place kind. No
// concept lives in two controls: each place kind appears only on the kind axis.
type Kind = "all" | "cities" | "monuments" | "airports" | "stations" | "countries";
type Status = "all" | "visited" | "wishlist" | "favorites" | "notVisited";
type Collection = "moments" | "photos" | "passport";

const KINDS: readonly Kind[] = ["all", "cities", "monuments", "stations", "airports", "countries"];
const STATUSES: readonly Status[] = ["all", "visited", "wishlist", "favorites", "notVisited"];

// The three axis/collection selections persist, so returning to Places lands where
// you were (the screen unmounts on every tab switch). Defaults show the personal
// records (kind=all, status=all) — a brand-new user still gets a full world to
// browse the moment they pick a kind.
const KIND_KEY = "postcards-places-kind";
const STATUS_KEY = "postcards-places-status";
const COLLECTION_KEY = "postcards-places-collection";
function loadKind(): Kind {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return (KINDS as readonly string[]).includes(v ?? "") ? (v as Kind) : "all";
  } catch {
    return "all";
  }
}
function loadStatus(): Status {
  try {
    const v = localStorage.getItem(STATUS_KEY);
    return (STATUSES as readonly string[]).includes(v ?? "") ? (v as Status) : "all";
  } catch {
    return "all";
  }
}
function loadCollection(): Collection | null {
  try {
    const v = localStorage.getItem(COLLECTION_KEY);
    return v === "moments" || v === "photos" || v === "passport" ? v : null;
  } catch {
    return null;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: not persisted */
  }
}

// A view request from elsewhere (the map's counter strip, the "f"/"x" shortcuts)
// still speaks the old PlacesView vocabulary — map each onto the new axes so the
// callers keep working unchanged.
function mapRequest(view: PlacesView): { kind?: Kind; status?: Status; collection: Collection | null } {
  switch (view) {
    case "visited":
      return { kind: "all", status: "visited", collection: null };
    case "favorites":
      return { kind: "all", status: "favorites", collection: null };
    case "wishlist":
      return { kind: "all", status: "wishlist", collection: null };
    case "countries":
      return { kind: "countries", status: "all", collection: null };
    case "cities":
      return { kind: "cities", status: "all", collection: null };
    case "monuments":
      return { kind: "monuments", status: "all", collection: null };
    case "airports":
      // The airports you've actually been through (the count these tiles show),
      // not the whole world of airports.
      return { kind: "airports", status: "visited", collection: null };
    case "stations":
      // The stations you've actually passed through, not the whole world of them.
      return { kind: "stations", status: "visited", collection: null };
    case "moments":
      return { collection: "moments" };
    case "passport":
      return { collection: "passport" };
  }
}

/** Map coordinate to fly to (if known) and the secondary "· type · place" label for a visit. */
function placeMeta(
  ref: ReferenceData,
  v: Visit,
  t: TFunction,
): { coord: { lon: number; lat: number } | null; sub: string } {
  const country = ref.countryByIso2(v.place.countryId)?.name ?? v.place.countryId;
  if (v.place.kind === "city") {
    const c = ref.cityById(v.place.id);
    return { coord: c ? { lon: c.lon, lat: c.lat } : null, sub: country };
  }
  if (v.place.kind === "airport") {
    const a = ref.airportById(v.place.id);
    return { coord: a ? { lon: a.lon, lat: a.lat } : null, sub: `${t("places.meta.airport")} · ${country}` };
  }
  if (v.place.kind === "station") {
    const s = ref.stationById(v.place.id);
    return { coord: s ? { lon: s.lon, lat: s.lat } : null, sub: `${t("places.meta.station")} · ${country}` };
  }
  if (v.place.kind === "heritage") {
    const h = ref.heritageById(v.place.id);
    const coord = h && (h.lat !== 0 || h.lon !== 0) ? { lon: h.lon, lat: h.lat } : null;
    return { coord, sub: `${t("places.meta.monument")} · ${country}` };
  }
  return {
    coord: null,
    sub: v.place.kind === "custom" ? t("places.meta.yourPlace") : t("places.meta.country"),
  };
}

/** The per-row "more" popover: edit the visit's date, folder and note in one
 *  place, so the row itself stays a clean single column (flag + name). Opens
 *  inline below the row; the folder box suggests folders already in use. */
function RowMenu({
  v,
  onClose,
  triggerRef,
  hideDate = false,
}: {
  v: Visit;
  onClose: () => void;
  /** This row's own ⋯ button — excluded from the outside-click close so its own
   *  onClick (which toggles the menu) isn't fought by the close handler. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** Hide the date field (want-list rows: a want-to-go place has no visit date,
   *  and a target date would drift toward trip-planning). */
  hideDate?: boolean;
}) {
  const t = useT();
  const setDetails = useVisits((s) => s.setDetails);
  const removeVisit = useVisits((s) => s.removeVisit);
  const restoreVisit = useVisits((s) => s.restoreVisit);
  const showToast = useToast((s) => s.show);
  const menuRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(v.date ?? "");
  const [folder, setFolder] = useState(v.folder ?? "");
  const [note, setNote] = useState(v.note ?? "");
  // Close on Escape and on a click/tap outside the menu (its own ⋯ trigger is
  // excluded — its onClick toggles it). Opening another row's ⋯ counts as an
  // outside click here, so this menu closes: only one row menu stays open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose, triggerRef]);
  // Folders already in use, for the datalist — a snapshot when the menu opens.
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const x of useVisits.getState().visits) if (x.folder) set.add(x.folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, []);
  const listId = `visit-folders-${v.visitId}`;
  function save() {
    void setDetails(v.visitId, {
      date: date || null,
      folder: folder.trim() || null,
      note: note.trim() || null,
    });
    onClose();
  }
  return (
    <div
      className="row-menu"
      ref={menuRef}
      role="group"
      aria-label={t("places.rowMenu.aria", { name: v.place.name })}
    >
      {!hideDate && (
        <label className="picker-label">
          <span>{t("places.rowMenu.date")}</span>
          <input
            type="date"
            className="select"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      )}
      <label className="picker-label">
        <span>{t("places.rowMenu.folder")}</span>
        <input
          className="select"
          list={listId}
          value={folder}
          maxLength={80}
          onChange={(e) => setFolder(e.target.value)}
        />
        <datalist id={listId}>
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <label className="picker-label row-menu-note">
        <span>{t("places.rowMenu.note")}</span>
        <textarea
          className="select"
          rows={3}
          value={note}
          maxLength={2000}
          placeholder={t("places.rowMenu.notePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="row-menu-actions">
        <button className="btn" type="button" onClick={save}>
          {t("common.save")}
        </button>
        <button className="btn-ghost" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        {/* Remove lives here now (not inline) so the row itself stays uncluttered
            and the place name keeps its width. Undoable via the toast. */}
        <button
          className="link-danger row-menu-remove"
          type="button"
          aria-label={t("places.row.removeAria", { name: v.place.name })}
          onClick={() => {
            void removeVisit(v.visitId);
            showToast(t("places.row.removedToast", { name: v.place.name }), () =>
              restoreVisit(v),
            );
            onClose();
          }}
        >
          {t("common.remove")}
        </button>
      </div>
    </div>
  );
}

/** One visited or wishlist row — visited adds details, photos and the favorite star.
 *  Memoized: store updates replace only the changed visit object, so after a
 *  toggle the other (up to 100) rows — photo thumbnails included — skip re-render. */
const VisitRow = memo(function VisitRow({ v, wishlist }: { v: Visit; wishlist?: boolean }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const toggleVisit = useVisits((s) => s.toggleVisit);
  const toggleFavorite = useVisits((s) => s.toggleFavorite);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const { sub } = placeMeta(ref, v, t);
  // A visited monument/airport must NOT read as a city: show its own glyph, not
  // the country flag (cities keep the flag).
  const rowGlyph =
    v.place.kind === "heritage"
      ? heritageGlyph(ref.heritageById(v.place.id)?.category)
      : v.place.kind === "airport"
        ? "✈️"
        : v.place.kind === "station"
          ? "🚉"
          : countryFlag(v.place.countryId);

  return (
    <li className={"city-row compact" + (menuOpen ? " menu-open" : "")}>
      <button
        className="city-focus"
        type="button"
        onClick={() =>
          v.place.kind === "country"
            ? useUi.getState().openCountry(v.place.countryId)
            : useUi.getState().openCity(v.place.id)
        }
        aria-label={t("places.row.openAria", { name: v.place.name })}
      >
        <CityLine
          flag={rowGlyph}
          name={v.place.name}
          // Heritage/airport names are long ("Historic Sanctuary of Machu Picchu")
          // — let them wrap instead of clipping; cities keep the dense one-liner.
          multiline={v.place.kind === "heritage" || v.place.kind === "airport"}
          sub={
            // One clean column: just the region, plus a folder chip when set. The
            // date and note now live in the row's "⋯" menu, not inline.
            <>
              · {sub}
              {v.folder ? <span className="folder-chip">📁 {v.folder}</span> : null}
            </>
          }
        />
      </button>
      {!wishlist && (
        <PhotoGallery visitId={v.visitId} photos={v.photos ?? []} placeName={v.place.name} />
      )}
      {!wishlist && (
        <button
          className={"star-btn" + (v.favorite ? " star-on" : "")}
          type="button"
          aria-pressed={!!v.favorite}
          aria-label={
            v.favorite
              ? t("places.row.unfavoriteAria", { name: v.place.name })
              : t("places.row.favoriteAria", { name: v.place.name })
          }
          onClick={() => void toggleFavorite(v.place)}
        >
          {v.favorite ? "♥" : "♡"}
        </button>
      )}
      {wishlist && (
        <button
          className="mini-btn"
          type="button"
          aria-label={t("places.row.markVisitedAria", { name: v.place.name })}
          onClick={() => void toggleVisit(v.place)}
        >
          ✓ {t("places.row.beenThere")}
        </button>
      )}
      {/* Both visited AND want-list rows get the ⋯ menu (date/folder/note + Remove),
          so a want-to-go place can carry a note ("go in cherry-blossom season") and
          a folder, and both row families share the same trailing controls. */}
      <button
        ref={moreBtnRef}
        className="mini-btn row-more"
        type="button"
        aria-expanded={menuOpen}
        aria-label={t("places.row.moreAria", { name: v.place.name })}
        onClick={() => setMenuOpen((o) => !o)}
      >
        ⋯
      </button>
      {menuOpen && (
        <RowMenu
          v={v}
          triggerRef={moreBtnRef}
          hideDate={wishlist}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </li>
  );
});

/** One reference-browse row (spec 018 US2): the whole world of a kind, each row
 *  status-marked from the user's records and toggleable in place. */
const BrowseRowItem = memo(function BrowseRowItem({ r }: { r: BrowseRow }) {
  const t = useT();
  const glyph =
    r.kind === "city"
      ? countryFlag(r.countryIso2)
      : r.kind === "airport"
        ? "✈️"
        : r.kind === "station"
          ? "🚉"
          : heritageGlyph(r.category);
  // Only a real dataset category becomes a tag — never an invented one (FR-008).
  const cat =
    r.kind === "heritage" &&
    (r.category === "cultural" || r.category === "natural" || r.category === "mixed")
      ? r.category
      : null;
  return (
    <li className="city-row compact">
      <button
        className="city-focus"
        type="button"
        onClick={() => useUi.getState().openCity(r.id)}
        aria-label={t("places.row.openAria", { name: r.name })}
      >
        <CityLine
          flag={glyph}
          name={r.name}
          multiline={r.kind !== "city"}
          sub={
            <>
              · {r.sub}
              {cat ? (
                <span className="folder-chip">{t(`filter.category.${cat}` as const)}</span>
              ) : null}
            </>
          }
        />
      </button>
      <StateToggles place={r.place} />
    </li>
  );
});

/** The "nothing matches" line — with a one-tap Clear when a name search caused it,
 *  so a search for a place you haven't logged isn't a dead end (the native ✕ on a
 *  type=search box is unreliable on Android/Capacitor). */
function NoMatch({ q, onClear }: { q: string; onClear: () => void }) {
  const t = useT();
  return (
    <p className="muted empty">
      {t("places.noMatch")}{" "}
      {q && (
        <button className="link" type="button" onClick={onClear}>
          {t("search.clear")}
        </button>
      )}
    </p>
  );
}

/** Browse and track every place kind — one kind axis × one status axis, plus the
 *  cross-cutting Moments / Photos / Passport collections. */
export function PlacesScreen() {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);

  const scope = useSettings((s) => s.countryScope);
  const filters = useFilters();
  const [kind, setKind] = useState<Kind>(loadKind);
  const [status, setStatus] = useState<Status>(loadStatus);
  const [collection, setCollection] = useState<Collection | null>(loadCollection);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [shown, setShown] = useState(100);
  const [groupBy, setGroupBy] = useState<"none" | "country" | "year">("none");
  // Defer the query that drives the heavy lists (browse over the gazetteer + the
  // personal-list filter) off the keystroke: the input stays instant (bound to raw
  // `filter`), while the expensive recompute + re-render of up to 100 rows runs in
  // an interruptible follow-up pass — matching the map's search, so the Places list
  // no longer lags behind typing.
  const deferredFilter = useDeferredValue(filter);
  const q = deferredFilter.trim().toLowerCase();

  // The kind axis IS the app's shared map "mode" (FR-012): selecting a place kind
  // keeps the map and Places in lock-step. Countries is a Places-only kind (the
  // map has no country mode), so it leaves the mode untouched.
  useEffect(() => {
    if (kind === "countries") return;
    const target: FilterMode = kind; // "all" | "cities" | "monuments" | "airports" | "stations"
    if (useFilters.getState().mode !== target) useFilters.getState().set({ mode: target });
  }, [kind]);

  const selectKind = useCallback((k: Kind) => {
    setKind(k);
    save(KIND_KEY, k);
    setCollection(null);
    save(COLLECTION_KEY, "");
    setFilter("");
    setShown(100);
  }, []);
  const selectStatus = useCallback((s: Status) => {
    setStatus(s);
    save(STATUS_KEY, s);
    setCollection(null);
    save(COLLECTION_KEY, "");
    setShown(100);
  }, []);
  const selectCollection = useCallback((c: Collection) => {
    setCollection(c);
    save(COLLECTION_KEY, c);
    setFilter("");
    setShown(100);
  }, []);

  // Another screen (the map's counter strip, the passport/moments shortcuts) asked
  // for a specific view — translate it onto the two axes / a collection.
  const request = useUi((s) => s.placesViewRequest);
  useEffect(() => {
    if (!request) return;
    const m = mapRequest(request.view);
    if (m.kind !== undefined) {
      setKind(m.kind);
      save(KIND_KEY, m.kind);
    }
    if (m.status !== undefined) {
      setStatus(m.status);
      save(STATUS_KEY, m.status);
    }
    setCollection(m.collection);
    save(COLLECTION_KEY, m.collection ?? "");
    setFilter("");
    setShown(100);
    // Consume the request — a plain Places-tab tap later should land on the
    // last-used selection, not replay this one forever.
    useUi.setState({ placesViewRequest: null });
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape/Back steps out of a collection (Moments/Photos/Passport are little
  // screens of their own) back to the browse, before leaving the tab.
  useEffect(() => {
    return registerEscape(() => {
      if (collection) {
        setCollection(null);
        save(COLLECTION_KEY, "");
        setFilter("");
        setShown(100);
        return true;
      }
      return false;
    });
  }, [collection]);

  const heritageAvailable = useMemo(() => ref.allHeritage().length > 0, [ref]);

  // ── Personal records (kind = All): the user's own saved places, all kinds mixed,
  // narrowed by the status axis. ────────────────────────────────────────────────
  const visitedRaw = useMemo(() => visits.filter((v) => v.status === "visited"), [visits]);
  // Display order is favourites-first + A–Z, but FROZEN for the visit: toggling ★
  // must not make a row jump out from under your finger. The order is re-derived
  // only when the SET of visited places changes (you add/remove one) or the screen
  // remounts — "don't move it until you leave the page or update it".
  const membershipKey = useMemo(
    () => [...visitedRaw.map((v) => v.visitId)].sort().join(","),
    [visitedRaw],
  );
  const orderIndex = useMemo(() => {
    const sorted = [...visitedRaw].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.place.name.localeCompare(b.place.name),
    );
    return new Map(sorted.map((v, i) => [v.visitId, i]));
    // Intentionally keyed on membership only — a ★ toggle keeps the frozen order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipKey]);
  const visited = useMemo(
    () =>
      [...visitedRaw].sort(
        (a, b) => (orderIndex.get(a.visitId) ?? 1e9) - (orderIndex.get(b.visitId) ?? 1e9),
      ),
    [visitedRaw, orderIndex],
  );
  const favorites = useMemo(() => visited.filter((v) => v.favorite), [visited]);
  const wishlist = useMemo(
    () =>
      visits
        .filter((v) => v.status === "wishlist")
        .sort((a, b) => a.place.name.localeCompare(b.place.name)),
    [visits],
  );

  // Places owns status via the status axis; every OTHER dimension (date / folder /
  // population / sort / growth) comes from the ONE shared filter store, so the map
  // and Places never disagree (spec 016 US3). The name box is separate.
  const listState = useMemo(
    () => ({ ...currentFilters(filters), status: [] as FilterStatus[] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.date,
      filters.folder,
      filters.minPop,
      filters.sort,
      filters.mode,
      filters.favoritesOnly,
      filters.hasPhoto,
      filters.hasNote,
      filters.continent,
      filters.country,
    ],
  );
  const filterVisits = useCallback(
    (list: Visit[]) => {
      const byName = !q ? list : list.filter((v) => v.place.name.toLowerCase().includes(q));
      const narrowed = byName.filter((v) => placeMatches(v, ref, listState));
      const sorted = sortPlaces(narrowed, ref, listState);
      // Keep favourites floated to the top (Places' standing promise) — a stable
      // pass, so the chosen sort still orders within the favourites and the rest.
      return [...sorted].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    },
    [q, ref, listState],
  );
  // The base personal list for the chosen status: All = everything you've saved
  // (visited + want-list), the rest are the matching slice. Not-visited has no
  // personal records — it's the cue to pick a kind and browse the world.
  const personalBase = useMemo<Visit[]>(() => {
    switch (status) {
      case "visited":
        return visited;
      case "wishlist":
        return wishlist;
      case "favorites":
        return favorites;
      case "all":
        return [...visited, ...wishlist];
      default:
        return [];
    }
  }, [status, visited, wishlist, favorites]);
  const personalShown = useMemo(() => filterVisits(personalBase), [filterVisits, personalBase]);

  // "Many ways to see the data": the kind=All list can also be GROUPED — into
  // expandable country sections (passport-style) or under the year you went. The
  // same filter/sort feeds it, so the groups always agree with the flat list.
  const personalGroups = useMemo(() => {
    if (groupBy === "none") return null;
    const m = new Map<string, { key: string; label: string; flag: string; visits: Visit[] }>();
    for (const v of personalShown) {
      const key =
        groupBy === "country" ? v.place.countryId || "ZZ" : v.date?.slice(0, 4) || "—";
      const g = m.get(key);
      if (g) g.visits.push(v);
      else {
        const label =
          groupBy === "country"
            ? (ref.countryByIso2(key)?.name ?? key)
            : key === "—"
              ? t("filter.date.undated")
              : key;
        m.set(key, { key, label, flag: groupBy === "country" ? countryFlag(key) : "", visits: [v] });
      }
    }
    const arr = [...m.values()];
    if (groupBy === "country")
      arr.sort((a, b) => b.visits.length - a.visits.length || a.label.localeCompare(b.label));
    else arr.sort((a, b) => (a.key === "—" ? 1 : b.key === "—" ? -1 : b.key.localeCompare(a.key)));
    return arr;
  }, [groupBy, personalShown, ref, t]);

  // ── World browse (kind = Cities / Monuments / Airports / Stations): the whole
  // gazetteer of the chosen kind, status-overlaid, via the tested pure engine. ────
  // Paged: build only the `shown` rows we render, plus a `hasMore` probe — so a
  // visit toggle or filter change never materialises thousands of rows (that was the
  // list lag), and "load more" can page uncapped through the whole set.
  const browse = useMemo(() => {
    if (kind !== "cities" && kind !== "monuments" && kind !== "airports" && kind !== "stations")
      return { rows: [] as BrowseRow[], hasMore: false };
    return browseList(kind, status, currentFilters(filters), ref, visits, deferredFilter.trim(), shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status, filters.continent, filters.minPop, filters.category, filters.country, ref, visits, deferredFilter, shown]);
  const browseRows = browse.rows;

  // The years your visits span, newest first, for the date filter chips.
  const years = useMemo(() => {
    const ys = new Set<string>();
    let undated = false;
    for (const v of visits) {
      if (v.status === "wishlist") continue;
      if (v.date) ys.add(v.date.slice(0, 4));
      else undated = true;
    }
    return { list: [...ys].sort().reverse(), undated };
  }, [visits]);

  // Folders in use, for the shared panel's folder picker.
  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) if (v.folder) set.add(v.folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [visits]);

  // Continents your places sit in, for the growth "continent" picker.
  const continentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) {
      const c = ref.continentOf(v.place.countryId);
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [visits, ref]);

  // The active dimensions Places actually acts on (status + map mode are excluded —
  // status is the axis, mode is map-only). Drives the Filter button's badge.
  const placesFilterChips = useMemo(
    () => activeChips(currentFilters(filters), t, ref).filter((c) => c.field !== "status" && c.field !== "mode"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.date,
      filters.folder,
      filters.minPop,
      filters.sort,
      filters.favoritesOnly,
      filters.hasPhoto,
      filters.hasNote,
      filters.continent,
      filters.country,
      ref,
      t,
    ],
  );
  const placesFilterActive = placesFilterChips.length > 0;

  // ── Countries (kind = Countries): the whole-world checklist, all shown at once. ─
  // A country counts as visited if EITHER an explicit country record exists OR a
  // (non-airport) place inside it is visited — coverage is derived. Wishlist /
  // favorite country records give the status axis something to narrow on too.
  const countryStatus = useMemo(() => {
    const sub = new Map<string, number>();
    const explicit = new Set<string>();
    const wish = new Set<string>();
    const fav = new Set<string>();
    for (const v of visits) {
      if (v.place.kind === "country") {
        if (v.status === "wishlist") wish.add(v.place.countryId);
        else explicit.add(v.place.countryId);
        if (v.favorite) fav.add(v.place.countryId);
      } else if (v.status !== "wishlist" && v.place.kind !== "airport" && v.place.countryId !== "ZZ") {
        sub.set(v.place.countryId, (sub.get(v.place.countryId) ?? 0) + 1);
      }
    }
    return { sub, explicit, wish, fav };
  }, [visits]);
  const isCountryVisited = useCallback(
    (iso2: string) => (countryStatus.sub.get(iso2) ?? 0) > 0 || countryStatus.explicit.has(iso2),
    [countryStatus],
  );
  const countryRows = useMemo(() => {
    const all = ref.countries.filter((c) => inScope(c.sovereignty, scope));
    let list = !q ? [...all] : all.filter((c) => c.name.toLowerCase().includes(q));
    // The status axis narrows the checklist too.
    if (status === "visited") list = list.filter((c) => isCountryVisited(c.iso2));
    else if (status === "notVisited") list = list.filter((c) => !isCountryVisited(c.iso2));
    else if (status === "wishlist") list = list.filter((c) => countryStatus.wish.has(c.iso2));
    else if (status === "favorites") list = list.filter((c) => countryStatus.fav.has(c.iso2));
    // Your countries first; the rest stay alphabetical below them.
    const seen = (c: (typeof list)[number]) => (isCountryVisited(c.iso2) ? 0 : 1);
    return list.sort((a, b) => seen(a) - seen(b) || a.name.localeCompare(b.name));
  }, [ref, q, scope, status, countryStatus, isCountryVisited]);

  const kindLabel = (k: Kind): string =>
    k === "countries" ? t("places.tab.countries") : t(`filter.mode.${k}` as const);

  const clearSearch = () => {
    setFilter("");
    setShown(100);
  };

  // The single header title names the current view. Collections show their own
  // name here; the browse shares the "Places" section title.
  const title =
    collection === "moments"
      ? t("moments.title")
      : collection === "passport"
        ? t("passport.title")
        : collection === "photos"
          ? t("places.collection.photos")
          : t("places.title");

  const isBrowseKind =
    kind === "cities" || kind === "monuments" || kind === "airports" || kind === "stations";
  // The search box (and its filter row) belong to the browse; countries has its
  // own inline search, collections have none, and an empty personal list / the
  // "pick a kind" hint have nothing to filter.
  const showSearch =
    !collection &&
    kind !== "countries" &&
    !(kind === "all" && (status === "notVisited" || personalBase.length === 0));
  const searchPlaceholder =
    kind === "monuments"
      ? t("places.filter.monumentsPlaceholder")
      : kind === "all"
        ? t("places.filter.placesPlaceholder")
        : t("places.browse.searchPlaceholder");
  const searchAria =
    kind === "monuments"
      ? t("places.filter.monumentsAria")
      : kind === "all"
        ? t("places.filter.placesAria")
        : t("places.browse.searchAria");
  const personalEmptyKey =
    status === "wishlist"
      ? "places.wishlist.empty"
      : status === "favorites"
        ? "places.favorites.empty"
        : "places.visited.empty";
  const personalEmptyEmoji = status === "wishlist" ? "⚑" : status === "favorites" ? "♥" : "🧳";

  return (
    <section aria-label={t("places.aria")}>
      <div className="section-head">
        <h2>{title}</h2>
        {/* Moments / Photos / Passport: cross-cutting collections, not a place kind
            — a separate (unfilled) cluster so they don't blend into the axes. */}
        <div
          className="segmented wrap places-collections"
          role="group"
          aria-label={t("places.collectionsAria")}
        >
          {(["moments", "photos", "passport"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={collection === c}
              className={collection === c ? "seg-on" : ""}
              onClick={() => selectCollection(c)}
            >
              <span aria-hidden>{c === "moments" ? "✨" : c === "photos" ? "📷" : "🛂"}</span>{" "}
              {t(`places.collection.${c}` as const)}
            </button>
          ))}
        </div>
      </div>

      {/* The two independent axes. Each place kind appears in exactly ONE control
          (the kind axis) — no kind duplicated in a status/collection row (US1). */}
      <div className="places-axes">
        <div className="places-axis">
          <span className="places-axis-label muted small" aria-hidden>
            {t("places.kindLabel")}
          </span>
          <div className="segmented wrap" role="group" aria-label={t("places.kindAria")}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={!collection && kind === k}
                className={!collection && kind === k ? "seg-on" : ""}
                onClick={() => selectKind(k)}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
        </div>
        <div className="places-axis">
          <span className="places-axis-label muted small" aria-hidden>
            {t("places.statusLabel")}
          </span>
          <div className="segmented wrap" role="group" aria-label={t("places.statusAria")}>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={!collection && status === s}
                className={!collection && status === s ? "seg-on" : ""}
                onClick={() => selectStatus(s)}
              >
                {t(`places.status.${s}` as const)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showSearch && (
        <div className="search">
          <input
            type="search"
            className="search-input places-filter has-clear"
            placeholder={searchPlaceholder}
            aria-label={searchAria}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              type="button"
              className="search-clear"
              aria-label={t("search.clear")}
              title={t("search.clear")}
              onClick={clearSearch}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* The ONE Filter (spec 016 US3): the same panel the map uses, minus status
          (the status axis owns it) and mode (map-only). Shown for the browse and
          the personal list — not countries (its own controls) or a collection. */}
      {!collection && kind !== "countries" && (
        <div className="places-filter-row">
          <button
            type="button"
            className={"chip filter-open-chip" + (placesFilterActive ? " chip-on" : "")}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-label={
              placesFilterActive
                ? `${t("filter.open")} · ${t("filter.activeAria", { count: placesFilterChips.length })}`
                : t("filter.open")
            }
            onClick={() => setFilterOpen(true)}
          >
            ⚙ {t("filter.open")}
            {placesFilterActive ? ` · ${placesFilterChips.length}` : ""}
          </button>
          {/* Group-by lives on the SAME line as Filter (kind=All only) so the two
              controls read as one toolbar, not two stacked rows. */}
          {kind === "all" && personalShown.length > 0 && (
            <div className="places-groupby btn-row" role="group" aria-label={t("places.groupBy")}>
              {(["none", "country", "year"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={"mini-btn" + (groupBy === g ? " mini-on" : "")}
                  aria-pressed={groupBy === g}
                  onClick={() => setGroupBy(g)}
                >
                  {t(`places.groupBy.${g}` as const)}
                </button>
              ))}
            </div>
          )}
          {/* Category tag filter (cultural / natural / mixed), read from the dataset
              — only for the Monuments kind. */}
          {kind === "monuments" && (
            <div
              className="segmented wrap places-kind"
              role="group"
              aria-label={t("filter.category.aria")}
            >
              {(["", "cultural", "natural", "mixed"] as const).map((cat) => (
                <button
                  key={cat || "all"}
                  type="button"
                  aria-pressed={filters.category === cat}
                  className={filters.category === cat ? "seg-on" : ""}
                  onClick={() => filters.set({ category: cat })}
                >
                  {t(`filter.category.${cat || "all"}` as const)}
                </button>
              ))}
            </div>
          )}
          <FilterSummary exclude={["status", "mode"]} />
        </div>
      )}

      {/* ── kind = All: your saved places, all kinds mixed, by status ── */}
      {!collection && kind === "all" && (
        <>
          {status === "notVisited" ? (
            <p className="muted empty">
              <span className="empty-emoji" aria-hidden>
                🧭
              </span>
              {t("places.all.notVisitedHint")}{" "}
              <button className="link" type="button" onClick={() => selectKind("cities")}>
                {t("places.all.discoverBtn")}
              </button>
            </p>
          ) : personalBase.length === 0 ? (
            <p className="muted empty">
              <span className="empty-emoji" aria-hidden>
                {personalEmptyEmoji}
              </span>
              {t(personalEmptyKey)}
            </p>
          ) : personalShown.length === 0 ? (
            <NoMatch q={q} onClear={clearSearch} />
          ) : personalGroups ? (
            <div className="places-groups">
              {personalGroups.map((grp) => (
                <details
                  key={grp.key}
                  className="journal-place-group"
                  open={personalGroups.length <= 6}
                >
                  <summary className="journal-place-summary">
                    <span className="journal-place-name">
                      {grp.flag ? `${grp.flag} ` : ""}
                      {grp.label}
                    </span>
                    <span className="muted small journal-place-meta">
                      {grp.visits.length} {t.plural("noun.place", grp.visits.length)}
                    </span>
                  </summary>
                  <ul className="city-list">
                    {grp.visits.map((v) => (
                      <VisitRow key={v.visitId} v={v} wishlist={v.status === "wishlist"} />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <>
              <ul className="city-list">
                {personalShown.slice(0, shown).map((v) => (
                  <VisitRow key={v.visitId} v={v} wishlist={v.status === "wishlist"} />
                ))}
              </ul>
              {personalShown.length > shown && (
                <ListPager
                  shown={shown}
                  total={personalShown.length}
                  step={100}
                  onMore={() => setShown((n) => n + 100)}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ── kind = Cities / Monuments / Airports: browse the whole world ── */}
      {!collection && isBrowseKind && (
        <>
          {kind === "monuments" && !heritageAvailable ? (
            <p className="muted empty">
              <span className="empty-emoji" aria-hidden>
                🏛️
              </span>
              {t("places.monuments.emptyBuildPre")}
              <code>scripts/build-heritage-full.mjs</code>
              {t("places.monuments.emptyBuildPost")}
            </p>
          ) : browseRows.length === 0 ? (
            q ? (
              <NoMatch q={q} onClear={clearSearch} />
            ) : (
              <p className="muted empty">
                {t("places.browse.emptyStatus")}{" "}
                {status !== "all" && (
                  <button className="link" type="button" onClick={() => selectStatus("all")}>
                    {t("places.browse.widen")}
                  </button>
                )}
              </p>
            )
          ) : (
            <>
              <ul className="city-list">
                {browseRows.map((r) => (
                  <BrowseRowItem key={`${r.kind}:${r.id}`} r={r} />
                ))}
              </ul>
              {browse.hasMore && (
                <div className="list-pager">
                  <MoreButton onMore={() => setShown((n) => n + 100)}>
                    {t("journal.showMore", { count: 100 })}
                  </MoreButton>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── kind = Countries: the whole-world checklist, all shown at once ── */}
      {!collection && kind === "countries" && (
        <>
          <div className="countries-head">
            <ScopeToggle />
            <span className="muted small">
              {t("places.countries.count", { count: countryRows.length })}
            </span>
          </div>
          <p className="muted small" style={{ margin: "0 0 6px" }}>
            {t("places.countries.desc")}
          </p>
          <div className="search">
            <input
              type="search"
              className="search-input has-clear"
              placeholder={t("places.countries.filterPlaceholder")}
              aria-label={t("places.countries.filterAria")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                type="button"
                className="search-clear"
                aria-label={t("search.clear")}
                title={t("search.clear")}
                onClick={clearSearch}
              >
                ✕
              </button>
            )}
          </div>
          {countryRows.length === 0 && <NoMatch q={q} onClear={clearSearch} />}
          <ul className="city-list" style={{ marginTop: 8 }}>
            {/* Only ~250 countries — show them ALL at once (no pager); the name
                search narrows live and visited countries sort first. */}
            {countryRows.map((c) => {
              const subCount = countryStatus.sub.get(c.iso2) ?? 0;
              const isVisited = isCountryVisited(c.iso2);
              const place = { kind: "country" as const, id: c.iso2, name: c.name, countryId: c.iso2 };
              return (
                <li key={c.iso2} className="city-row compact dense">
                  <button
                    className="city-focus"
                    type="button"
                    title={t("places.row.openAria", { name: c.name })}
                    onClick={() => useUi.getState().openCountry(c.iso2)}
                  >
                    <CityLine
                      flag={countryFlag(c.iso2)}
                      name={c.name}
                      sub={
                        isVisited && subCount > 0 ? (
                          <>· {t.plural("places.country.via", subCount)}</>
                        ) : undefined
                      }
                    />
                  </button>
                  {isVisited && subCount > 0 && (
                    // Visited through its cities/monuments — already counted; the
                    // chip says so, and ⚑ Want-to-go is suppressed (you've been).
                    <span
                      className="chip chip-on"
                      aria-label={t("places.country.visitedAria", { name: c.name })}
                    >
                      ✓ {t("places.country.visitedChip")}
                    </span>
                  )}
                  <StateToggles place={place} derivedVisited={isVisited && subCount > 0} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {collection === "moments" && <ExperiencesScreen embedded />}

      {collection === "photos" && <PhotoWall />}

      {collection === "passport" && <PassportScreen embedded />}

      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        folders={folderOptions}
        years={years}
        showStatus={false}
        showGrowth
        continents={continentOptions}
      />
    </section>
  );
}

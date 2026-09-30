import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type JSX } from "react";
import { useUi, type Tab } from "../lib/store/useUi";
import { runEscapeInterceptors } from "../lib/store/escapeStack";
import { StatsView } from "../features/stats/StatsView";
import { PlacesScreen } from "../features/visits/PlacesScreen";
import { TravelScreen } from "../features/travel/TravelScreen";
import { TripComposer } from "../features/travel/TripComposer";
import { StoryComposer } from "../features/journal/StoryComposer";
import { JournalScreen } from "../features/journal/JournalScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { CityScreen } from "../features/city/CityScreen";
import { CountryScreen } from "../features/country/CountryScreen";
import { PlaceSearch } from "../features/visits/PlaceSearch";
import { ShortcutsHelp } from "../ui/ShortcutsHelp";
import { AboutModal } from "../ui/AboutModal";
import { IntroScreen } from "../ui/IntroScreen";
import { Toast } from "../ui/Toast";
import { UpdateBanner } from "../ui/UpdateBanner";
import { LoadBoundary } from "../ui/LoadFailure";
import { handoffRequested } from "../lib/moved/moved";
import { followOtherTabs, loadPortable } from "../lib/store/portable";
import { ConnectionStatus } from "../ui/ConnectionStatus";
import { MapIcon, ChartIcon, ListIcon, RouteIcon, BookIcon, GearIcon, InfoIcon } from "../ui/icons";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useInstallPrompt } from "../lib/hooks/useInstallPrompt";
import { useAutoSync } from "../lib/hooks/useAutoSync";
import { useT, type MessageKey } from "../lib/i18n";

// Code-split MapLibre so it loads only when the map is shown.
const MapScreen = lazy(() =>
  import("../features/map/MapScreen").then((m) => ({ default: m.MapScreen })),
);
// The new address's half of a move (lib/moved), needed only on a handoff load.
const HandoffReceiver = lazy(() => import("../features/moved/HandoffReceiver"));

// Five sections, all visible — no overflow menu. Passport and Moments are views
// inside Places now (they're collections of places, not destinations of their own).
const TABS: { id: Tab; label: MessageKey; keys: string[]; Icon: () => JSX.Element }[] = [
  { id: "map", label: "nav.map", keys: ["1", "m"], Icon: MapIcon },
  { id: "places", label: "nav.places", keys: ["2", "p"], Icon: ListIcon },
  { id: "trips", label: "nav.trips", keys: ["3", "t"], Icon: RouteIcon },
  { id: "journal", label: "nav.journal", keys: ["4", "j"], Icon: BookIcon },
  { id: "stats", label: "nav.stats", keys: ["5", "s"], Icon: ChartIcon },
];

// An open modal/lightbox/popup/dirty-composer consumes Escape and the Back
// gesture; these selectors detect one so an unobstructed press navigates. A popup
// left open on the map counts only while the map shows: the map stays mounted,
// hidden, behind the other tabs.
const DIALOG_LAYER_SELECTOR =
  ".modal-backdrop, .lightbox, .maplibregl-popup:not(.map-keep-hidden *), .journal-composer-busy";

// First run: show the "How it works" intro once so a newcomer learns what the
// app is and what's optionally downloadable, before touching anything. Stored,
// so it never reappears; the top-bar button still opens it anytime.
const INTRO_KEY = "postcards-intro-seen";
function introUnseen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) == null;
  } catch {
    return false; // private mode: don't nag on every load
  }
}

export function App() {
  const t = useT();
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const cityPageId = useUi((s) => s.cityPageId);
  const countryPageId = useUi((s) => s.countryPageId);
  const tripEditId = useUi((s) => s.tripEditId);
  const storyEditId = useUi((s) => s.storyEditId);
  const [showHelp, setShowHelp] = useState(false);
  const { canInstall, install } = useInstallPrompt();
  const [showAbout, setShowAbout] = useState(false);
  // First-run welcome page (separate from the top-bar "How it works" modal).
  const [showIntro, setShowIntro] = useState(introUnseen);
  const closeIntro = () => {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode: not persisted */
    }
    setShowIntro(false);
  };
  const mainRef = useRef<HTMLElement>(null);
  // Once the map has rendered it never unmounts again (see <main> below);
  // the tab already re-renders on change, so a ref is enough to remember it.
  const mapShown = useRef(false);
  if (tab === "map") mapShown.current = true;
  // Journal-nav long-press → "write today" (spec 020). A short tap opens the feed;
  // a press-and-hold opens the composer. `W` is the keyboard-accessible equivalent.
  const navPressTimer = useRef<number | null>(null);
  const navPressStart = useRef<{ x: number; y: number } | null>(null);
  const navPressFired = useRef(false);
  const cancelNavPress = () => {
    if (navPressTimer.current != null) {
      clearTimeout(navPressTimer.current);
      navPressTimer.current = null;
    }
  };
  const mapVisible = tab === "map" && !cityPageId && !countryPageId && !tripEditId && !storyEditId;
  const firstRender = useRef(true);

  // Scroll memory. <main> is the single scroll container reused across tabs and
  // detail pages, so its scrollTop leaks between views: open a city while scrolled
  // down a list and the city opened mid-page; go back and the list had lost its
  // place. Remember each view's scroll and restore it on return, so "back" lands
  // you exactly where you were. A CITY page is the exception — it always opens at
  // the TOP (you drilled into a new thing), so its scroll is never saved. A country
  // page IS a long list you open cities from, so it's remembered like a tab.
  const forceTop = !!cityPageId || !!tripEditId || !!storyEditId;
  const viewKey = cityPageId
    ? `city:${cityPageId}`
    : countryPageId
      ? `country:${countryPageId}`
      : tripEditId
        ? `trip:${tripEditId}`
        : storyEditId
          ? `story:${storyEditId}`
          : `tab:${tab}`;
  const scrollTops = useRef<Map<string, number>>(new Map());
  const viewKeyRef = useRef(viewKey);
  const onMainScroll = () => {
    const el = mainRef.current;
    // City pages always reopen at the top, so there's nothing to remember for them.
    if (el && !viewKeyRef.current.startsWith("city:"))
      scrollTops.current.set(viewKeyRef.current, el.scrollTop);
  };
  // Runs before paint: point the scroll-memory at the new view, then place the
  // scroll — top for a freshly-opened city, the remembered offset otherwise.
  useLayoutEffect(() => {
    viewKeyRef.current = viewKey;
    const el = mainRef.current;
    if (!el) return;
    el.scrollTop = forceTop ? 0 : (scrollTops.current.get(viewKey) ?? 0);
  }, [viewKey, forceTop]);

  useEffect(() => {
    loadPortable();
    return followOtherTabs();
  }, []);

  // Opt-in background device sync (spec 013). No-op unless the user turned it on.
  useAutoSync();

  // Move focus to the content region on tab change and when a city/country
  // detail page opens or closes — both swap out <main> (skip initial mount).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // preventScroll: the layout effect above already placed the scroll; a plain
    // focus() would yank it back to pull <main> into view and undo the restore.
    mainRef.current?.focus({ preventScroll: true });
  }, [tab, cityPageId, countryPageId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // A modal/lightbox/open composer on screen consumes Escape (its own
        // handler closes it) — only an unobstructed Escape navigates back.
        // A DIRTY composer counts as an open layer; the always-open blank
        // Journal form must not swallow the Escape that navigates away.
        const dialogOpen = !!document.querySelector(DIALOG_LAYER_SELECTOR);
        setShowHelp(false);
        setShowAbout(false);
        if (!dialogOpen) {
          // On a city/country page, Escape leaves the page layer (never back
          // through other pages you viewed); otherwise let the active screen
          // step out of a LOCAL sub-view first (Journal's map/timeline, a Places
          // collection), and only walk tab history if it didn't handle it.
          const ui = useUi.getState();
          if (ui.cityPageId || ui.countryPageId || ui.tripEditId || ui.storyEditId) ui.closePages();
          else if (!runEscapeInterceptors()) ui.goBack();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      // While any modal/lightbox/map-popup/dirty-composer layer is open, single-
      // key shortcuts are inert (Escape above still closes the layer) — a shortcut
      // must never navigate the tab behind an open dialog or pull focus out of it.
      if (document.querySelector(DIALOG_LAYER_SELECTOR)) return;

      if (e.key === "/") {
        // Focus the always-present top-bar search WITHOUT changing tabs or
        // closing an open city/country page — picking a result navigates itself.
        useUi.getState().focusSearch();
        e.preventDefault();
        return;
      }
      if (e.key === "?") {
        setShowHelp(true);
        e.preventDefault();
        return;
      }
      // Passport & Moments moved into Places — their old shortcuts still work.
      if (e.key.toLowerCase() === "f") {
        useUi.getState().openPlaces("passport");
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === "x") {
        useUi.getState().openPlaces("moments");
        e.preventDefault();
        return;
      }
      // "Write today" — open the postcard composer dated today, cursor in content
      // (spec 020, P1). The keyboard-accessible equivalent of the Journal-nav
      // long-press. Inherits the input-field / dialog-inert guards above.
      if (e.key.toLowerCase() === "w") {
        useUi.getState().openStoryComposer("new");
        e.preventDefault();
        return;
      }
      const match = TABS.find((x) => x.keys.includes(e.key.toLowerCase()));
      if (match) {
        useUi.getState().setTab(match.id);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The phone Back gesture used to quit the whole app. Trap it: Back retraces
  // YOUR actual steps — close an open dialog, then return to the previous screen
  // you were on (tab or page, via the app's own history), one step per press.
  // Back NEVER quits the app: at the home screen (map, empty history) it just
  // re-arms and stays put — like a native app, where you leave with the home/tab
  // gesture, not by backing out into a blank page.
  useEffect(() => {
    const arm = () => history.pushState({ pc: true }, "");
    arm();
    function onPop() {
      const ui = useUi.getState();
      const dialogOpen = !!document.querySelector(DIALOG_LAYER_SELECTOR);
      if (dialogOpen) {
        // Let the open layer close via its own Escape handler.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        arm();
        return;
      }
      // Step out of a local sub-view first (mirrors Escape), then the LAST
      // screen: pop the app's own navigation history.
      if (runEscapeInterceptors()) {
        arm();
        return;
      }
      if (ui.goBack()) {
        arm();
        return;
      }
      // A detail page is still open with no history behind it (e.g. deep-linked or
      // opened from search): close it in place — Back must never fall through and
      // quit the app while you're looking at a city/country page.
      if (ui.cityPageId || ui.countryPageId || ui.tripEditId || ui.storyEditId) {
        ui.closePages();
        arm();
        return;
      }
      // At the home screen (map) with nothing left in history: DON'T let Back quit
      // the app — re-arm so the map is the terminal home for the Back gesture
      // (matches a native app; use the tab/home gesture to actually leave). Fixes
      // "map → places → country → back back … quit the application".
      arm();
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentTab = TABS.find((x) => x.id === tab);
  // Settings isn't in TABS (it's the top-bar gear), so fall back to its label —
  // otherwise the live region announces a bare " section" with no name.
  const currentLabel = currentTab ? t(currentTab.label) : tab === "settings" ? t("topbar.settings") : "";

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t("app.skipToContent")}
      </a>

      <header className="topbar">
            <h1 className="brand-wrap">
              <button
                type="button"
                className="brand"
                title={t("topbar.goToMap")}
                onClick={() => setTab("map")}
              >
                Postcards
              </button>
            </h1>
            {/* Global search in the bar itself — no screen spends a row on it.
                Picking a city flies the map there (flyTo also switches the tab). */}
            <div className="topbar-search">
              <PlaceSearch
                onFocusCity={(c) => useUi.getState().selectPlace(c.lon, c.lat, c.place)}
              />
            </div>
            <span className="topbar-actions">
              <ConnectionStatus />
              {canInstall && (
                <button
                  type="button"
                  className="topbar-about topbar-install"
                  aria-label={t("topbar.installAria")}
                  title={t("topbar.installAria")}
                  onClick={() => void install()}
                >
                  ⬇ <span aria-hidden>{t("topbar.install")}</span>
                </button>
              )}
              <a
                className="topbar-about topbar-star"
                href="https://github.com/offware-apps/Postcards"
                target="_blank"
                rel="noopener noreferrer"
                title={t("topbar.githubStar")}
                aria-label={t("topbar.githubStar")}
              >
                <span className="star-glyph" aria-hidden>
                  ⭐
                </span>
                <span>{t("topbar.github")}</span>
              </a>
              <button
                type="button"
                className="topbar-about"
                aria-haspopup="dialog"
                aria-label={t("topbar.howItWorks")}
                title={t("topbar.howItWorks")}
                onClick={() => setShowAbout(true)}
              >
                <InfoIcon />
                <span aria-hidden>{t("topbar.howItWorks")}</span>
              </button>
              <button
                type="button"
                className={"topbar-about topbar-gear" + (tab === "settings" ? " on" : "")}
                aria-label={t("topbar.settings")}
                title={t("topbar.settings")}
                onClick={() => setTab("settings")}
              >
                <GearIcon />
              </button>
            </span>
          </header>

      <p className="sr-only" role="status" aria-live="polite">
        {t("nav.sectionStatus", { section: currentLabel })}
      </p>

      <nav className="bottom-nav" aria-label={t("nav.sectionsAria")}>
        {TABS.map(({ id, label, Icon }) => {
          const isJournal = id === "journal";
          const longPress = isJournal
            ? {
                onPointerDown: (e: ReactPointerEvent) => {
                  navPressStart.current = { x: e.clientX, y: e.clientY };
                  navPressFired.current = false;
                  cancelNavPress();
                  navPressTimer.current = window.setTimeout(() => {
                    navPressTimer.current = null;
                    navPressFired.current = true;
                    useUi.getState().openStoryComposer("new");
                  }, 500);
                },
                onPointerMove: (e: ReactPointerEvent) => {
                  const s = navPressStart.current;
                  if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelNavPress();
                },
                onPointerUp: cancelNavPress,
                onPointerCancel: cancelNavPress,
                onPointerLeave: cancelNavPress,
              }
            : {};
          return (
            <button
              key={id}
              type="button"
              className={"nav-item" + (tab === id ? " active" : "")}
              aria-current={tab === id ? "page" : undefined}
              aria-label={t(label)}
              title={t(label)}
              onClick={() => {
                // A long-press that already opened the composer must not also switch tabs.
                if (isJournal && navPressFired.current) {
                  navPressFired.current = false;
                  return;
                }
                setTab(id);
              }}
              {...longPress}
            >
              <Icon />
              <span aria-hidden>{t(label)}</span>
            </button>
          );
        })}
      </nav>

      <main
            ref={mainRef}
            id="main"
            tabIndex={-1}
            onScroll={onMainScroll}
            className={"content" + (mapVisible ? " flush" : "")}
          >
            {/* The map stays MOUNTED (hidden, not unmounted) once it has been
                shown: unmounting tore down MapLibre and every tab switch back
                reloaded the whole map. Hidden it keeps its camera and tiles. */}
            {(mapShown.current || tab === "map") && (
              <div className={"map-keep" + (mapVisible ? "" : " map-keep-hidden")}>
                <LoadBoundary>
                  <Suspense fallback={<p className="muted empty">{t("map.loading")}</p>}>
                    <MapScreen active={mapVisible} />
                  </Suspense>
                </LoadBoundary>
              </div>
            )}
            {cityPageId ? (
              <CityScreen cityId={cityPageId} onBack={() => useUi.getState().closeCity()} />
            ) : countryPageId ? (
              <CountryScreen iso2={countryPageId} onBack={() => useUi.getState().closeCity()} />
            ) : tripEditId ? (
              <TripComposer
                tripId={tripEditId === "new" ? null : tripEditId}
                onClose={() => useUi.getState().closeTripComposer()}
              />
            ) : storyEditId ? (
              <StoryComposer
                storyId={storyEditId === "new" ? null : storyEditId}
                onClose={() => useUi.getState().closeStoryComposer()}
              />
            ) : (
              <>
                {tab === "stats" && (
                  <div className="screen">
                    <StatsView />
                  </div>
                )}
                {tab === "places" && (
                  <div className="screen">
                    <PlacesScreen />
                  </div>
                )}
                {tab === "trips" && (
                  <div className="screen">
                    <TravelScreen />
                  </div>
                )}
                {tab === "journal" && (
                  <div className="screen">
                    <JournalScreen />
                  </div>
                )}
                {tab === "settings" && (
                  <div className="screen">
                    <SettingsScreen />
                  </div>
                )}
              </>
            )}
      </main>

      <Toast />
      <UpdateBanner />
      {handoffRequested && (
        <LoadBoundary>
          <Suspense fallback={null}>
            <HandoffReceiver />
          </Suspense>
        </LoadBoundary>
      )}

      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showIntro && <IntroScreen onClose={closeIntro} />}
    </div>
  );
}

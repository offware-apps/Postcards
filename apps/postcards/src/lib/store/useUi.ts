import { create } from "zustand";
import type { PlaceRef } from "../schema/models";

export type Tab = "map" | "stats" | "places" | "trips" | "journal" | "settings";
// Passport and Moments live INSIDE Places now (fewer top-level buttons) — they
// are views of the same screen, reachable via openPlaces.
export type PlacesView =
  | "visited"
  | "favorites"
  | "wishlist"
  | "countries"
  | "cities"
  | "monuments"
  | "airports"
  | "stations"
  | "moments"
  | "passport";

/** One navigation snapshot — what Escape/Back returns to. */
interface NavState {
  tab: Tab;
  cityPageId: string | null;
  countryPageId: string | null;
  /** Open trip composer page ("new" | tripId | null) — a peer page layer (spec 019). */
  tripEditId: string | null;
  /** Open postcard composer page ("new" | storyId | null) — a peer page layer (spec 020). */
  storyEditId: string | null;
}

// Small cross-cutting UI store:
// - tab lives here so any screen can navigate (e.g. a Places row jumping to the map)
// - searchFocusNonce lets the "/" shortcut focus the lazily-mounted search input
// - mapFocus lets other tabs ask the map to fly somewhere
// - cityPageId / countryPageId open detail pages over the current tab
// - placesViewRequest lets the stat strip open Places pre-filtered
// - journalDraftRequest lets a city page open the Journal composer prefilled
// - history powers Escape/Back: every navigation pushes the previous snapshot,
//   goBack() pops it (so the top-bar tab follows where you return to)
interface UiState {
  tab: Tab;
  setTab: (tab: Tab) => void;
  searchFocusNonce: number;
  focusSearch: () => void;
  mapFocus: { lon: number; lat: number; nonce: number } | null;
  flyTo: (lon: number, lat: number) => void;
  /** A place picked anywhere OFF the map (search, a list, a chip): fly the map to
   *  it AND open its preview card, exactly like tapping its marker. Carries the
   *  full place so the map can build the card (name, kind, page) without having
   *  to re-resolve it from an id alone. */
  selectedPlace: { place: PlaceRef; lon: number; lat: number; nonce: number } | null;
  selectPlace: (lon: number, lat: number, place: PlaceRef) => void;
  /** GeoNames id (or heritage/custom id) of the open detail page (null = closed). */
  cityPageId: string | null;
  openCity: (id: string) => void;
  closeCity: () => void;
  /** ISO2 of the open country page (null = closed). */
  countryPageId: string | null;
  openCountry: (iso2: string) => void;
  /** The trip composer page layer: "new" for a fresh trip, a tripId to edit, or null. */
  tripEditId: string | null;
  openTripComposer: (id: string) => void;
  closeTripComposer: () => void;
  /** The postcard composer page layer: "new" for a fresh postcard, a storyId to edit, or null. */
  storyEditId: string | null;
  openStoryComposer: (id: string) => void;
  closeStoryComposer: () => void;
  placesViewRequest: { view: PlacesView; nonce: number } | null;
  openPlaces: (view: PlacesView) => void;
  /** A place to pre-attach when the postcard composer opens for a NEW postcard
   *  (e.g. "write about this place" from a city page); null for a blank postcard.
   *  Transient — read once by the composer on open. */
  storyDraftPlace: PlaceRef | null;
  journalDraftRequest: { place: PlaceRef; nonce: number } | null;
  openJournalDraft: (place: PlaceRef) => void;
  history: NavState[];
  /** Return to the previous screen. True if there was somewhere to go back to. */
  goBack: () => boolean;
  /** Close every open city/country page at once (Escape semantics). */
  closePages: () => void;
  // Travel-log time filter — shared so the map's trip arcs honour the same
  // period as the Trips list. "all" | 4-digit year, and "all" | "01".."12".
  tripYear: string;
  tripMonth: string;
  setTripPeriod: (year: string, month: string) => void;
}

const HISTORY_CAP = 24;

export const useUi = create<UiState>((set, get) => {
  /** Snapshot the current screen onto the history stack (deduped, capped). */
  function pushHistory(): NavState[] {
    const { tab, cityPageId, countryPageId, tripEditId, storyEditId, history } = get();
    const snap: NavState = { tab, cityPageId, countryPageId, tripEditId, storyEditId };
    const last = history[history.length - 1];
    if (
      last &&
      last.tab === snap.tab &&
      last.cityPageId === snap.cityPageId &&
      last.countryPageId === snap.countryPageId &&
      last.tripEditId === snap.tripEditId &&
      last.storyEditId === snap.storyEditId
    ) {
      return history;
    }
    return [...history.slice(-(HISTORY_CAP - 1)), snap];
  }

  return {
    tab: "map",
    setTab: (tab) =>
      set({ history: pushHistory(), tab, cityPageId: null, countryPageId: null, tripEditId: null, storyEditId: null }),
    searchFocusNonce: 0,
    focusSearch: () => set({ searchFocusNonce: get().searchFocusNonce + 1 }),
    mapFocus: null,
    flyTo: (lon, lat) =>
      set({
        history: pushHistory(),
        tab: "map",
        cityPageId: null,
        countryPageId: null,
        tripEditId: null,
        storyEditId: null,
        mapFocus: { lon, lat, nonce: (get().mapFocus?.nonce ?? 0) + 1 },
      }),
    selectedPlace: null,
    selectPlace: (lon, lat, place) =>
      // No mapFocus here: the fly comes WITH the card (via the map's
      // selectedPlace effect → focus.popup), so the place isn't eased twice.
      set({
        history: pushHistory(),
        tab: "map",
        cityPageId: null,
        countryPageId: null,
        tripEditId: null,
        storyEditId: null,
        selectedPlace: { place, lon, lat, nonce: (get().selectedPlace?.nonce ?? 0) + 1 },
      }),
    cityPageId: null,
    openCity: (id) =>
      set({ history: pushHistory(), cityPageId: id, countryPageId: null, tripEditId: null, storyEditId: null }),
    closeCity: () => {
      // Prefer real back-navigation; fall back to just closing the page.
      if (!get().goBack()) set({ cityPageId: null, countryPageId: null, tripEditId: null, storyEditId: null });
    },
    countryPageId: null,
    openCountry: (iso2) =>
      set({ history: pushHistory(), countryPageId: iso2, cityPageId: null, tripEditId: null, storyEditId: null }),
    tripEditId: null,
    openTripComposer: (id) =>
      set({ history: pushHistory(), tripEditId: id, cityPageId: null, countryPageId: null, storyEditId: null }),
    closeTripComposer: () => {
      // Prefer real back-navigation; fall back to just closing the composer page.
      if (!get().goBack()) set({ tripEditId: null, cityPageId: null, countryPageId: null, storyEditId: null });
    },
    storyEditId: null,
    storyDraftPlace: null,
    openStoryComposer: (id) =>
      set({
        history: pushHistory(),
        storyEditId: id,
        storyDraftPlace: null,
        cityPageId: null,
        countryPageId: null,
        tripEditId: null,
      }),
    closeStoryComposer: () => {
      // Prefer real back-navigation; fall back to just closing the composer page.
      if (!get().goBack()) set({ storyEditId: null, cityPageId: null, countryPageId: null, tripEditId: null });
    },
    placesViewRequest: null,
    openPlaces: (view) =>
      set({
        history: pushHistory(),
        tab: "places",
        cityPageId: null,
        countryPageId: null,
        tripEditId: null,
        storyEditId: null,
        placesViewRequest: { view, nonce: (get().placesViewRequest?.nonce ?? 0) + 1 },
      }),
    journalDraftRequest: null,
    // "Write about this place" (from a city page) now opens the focused postcard
    // composer (spec 020) with that place pre-attached — no longer the inline form.
    openJournalDraft: (place) =>
      set({
        history: pushHistory(),
        storyEditId: "new",
        storyDraftPlace: place,
        cityPageId: null,
        countryPageId: null,
        tripEditId: null,
      }),
    history: [],
    goBack: () => {
      const h = get().history;
      const last = h[h.length - 1];
      if (!last) return false;
      set({ ...last, history: h.slice(0, -1) });
      return true;
    },
    // Escape from a city/country page leaves the PAGE LAYER entirely — it must
    // never walk back through other pages you viewed earlier (open Istanbul,
    // then Budapest: Escape goes to the map, not to Istanbul). The ← Back
    // button keeps the full history via goBack.
    closePages: () => {
      const h = [...get().history];
      while (
        h.length &&
        (h[h.length - 1]!.cityPageId ||
          h[h.length - 1]!.countryPageId ||
          h[h.length - 1]!.tripEditId ||
          h[h.length - 1]!.storyEditId)
      )
        h.pop();
      const target = h.pop();
      const cleared = { cityPageId: null, countryPageId: null, tripEditId: null, storyEditId: null };
      if (target) set({ ...target, ...cleared, history: h });
      else set({ ...cleared, history: h });
    },
    tripYear: "all",
    tripMonth: "all",
    setTripPeriod: (tripYear, tripMonth) => set({ tripYear, tripMonth }),
  };
});

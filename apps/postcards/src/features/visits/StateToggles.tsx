import { useVisits, findByPlace, visitIndex } from "../../lib/store/useVisits";
import { useToast } from "../../lib/store/useToast";
import { placeKey } from "../../lib/schema/helpers";
import type { PlaceRef } from "../../lib/schema/models";
import { useT } from "../../lib/i18n";

/**
 * Inline states: Been (✓) always; Want (⚑) only until you've been (a wishlist
 * for a place you've visited is meaningless); Favorite (♥) only once you've
 * been (or while it's already set, so it can be unset). Rows show at most two
 * buttons — one tap each, no menus.
 */
export function StateToggles({
  place,
  derivedVisited = false,
}: {
  place: PlaceRef;
  /** A country counted visited via a city inside it (coverage is derived). Such a
   *  country must NOT still offer ⚑ Want-to-go — you've effectively been. */
  derivedVisited?: boolean;
}) {
  const t = useT();
  // Subscribe to this place's record only — record identities are stable across
  // unrelated updates, so untouched rows don't re-render on every store change.
  // O(1) via the shared index: with hundreds of rows mounted, per-row linear
  // scans on every store change added up to real jank on a phone.
  const key = placeKey(place);
  const rec = useVisits((s) => visitIndex(s.visits).get(key));
  const toggleVisit = useVisits((s) => s.toggleVisit);
  const toggleWish = useVisits((s) => s.toggleWish);
  const toggleFavorite = useVisits((s) => s.toggleFavorite);
  const addVisit = useVisits((s) => s.addVisit);
  const restoreVisit = useVisits((s) => s.restoreVisit);
  const show = useToast((s) => s.show);

  const been = rec?.status === "visited";
  const want = rec?.status === "wishlist";
  const fav = !!rec?.favorite;

  function onBeen() {
    // Only this place's record changes — snapshot it alone, so undo puts one
    // record back instead of rewriting the whole visits table.
    const prev = findByPlace(useVisits.getState().visits, place);
    void toggleVisit(place);
    // Silent on add; a removal (which can delete photos/notes) gets an undoable toast.
    if (prev?.status === "visited")
      show(t("places.row.removedToast", { name: place.name }), () => restoreVisit(prev));
  }
  function onWant() {
    // Mirror onBeen: removing a want-list place (which can drop a note/★) gets an
    // undoable toast, so an accidental tap — on the map list or anywhere this
    // shared control renders — is recoverable, not a silent loss.
    const prev = findByPlace(useVisits.getState().visits, place);
    void toggleWish(place);
    if (prev?.status === "wishlist")
      show(t("places.row.removedToast", { name: place.name }), () => restoreVisit(prev));
  }
  async function onFav() {
    if (!findByPlace(useVisits.getState().visits, place)) {
      await addVisit({ place, status: "wishlist" });
    }
    await toggleFavorite(place);
  }

  // A country is never "visited" by itself — you visit a country by visiting a
  // place inside it (coverage is derived; see the constitution). Countries keep
  // ⚑ Want-to-go, and ✓ only to UNDO a legacy direct record.
  const countryCheck = place.kind === "country";

  const showBeen = !countryCheck || been;
  const showWant = !been && !derivedVisited;
  const showFav = been || fav;
  // A country counted visited via a city inside it (derivedVisited, no explicit
  // record) suppresses all three buttons — don't render an empty, labelled group
  // (a dead screen-reader stop + a gap next to its "✓ Visited" chip).
  if (!showBeen && !showWant && !showFav) return null;
  const beenLabel = been
    ? t("states.removeFromVisited", { name: place.name })
    : t("places.row.markVisitedAria", { name: place.name });

  return (
    <div className="states" role="group" aria-label={t("states.statusAria", { name: place.name })}>
      {showBeen && (
        <button
          className={"state been" + (been ? " on" : "")}
          type="button"
          aria-pressed={been}
          aria-label={beenLabel}
          title={beenLabel}
          onClick={onBeen}
        >
          ✓
        </button>
      )}
      {showWant && (
        <button
          className={"state want" + (want ? " on" : "")}
          type="button"
          aria-pressed={want}
          aria-label={
            want
              ? t("states.removeFromWishlist", { name: place.name })
              : t("states.addToWishlist", { name: place.name })
          }
          title={want ? t("states.onWishlist") : t("states.wantToGo")}
          onClick={onWant}
        >
          ⚑
        </button>
      )}
      {showFav && (
        <button
          className={"state fav" + (fav ? " on" : "")}
          type="button"
          aria-pressed={fav}
          aria-label={
            fav
              ? t("places.row.unfavoriteAria", { name: place.name })
              : t("places.row.favoriteAria", { name: place.name })
          }
          title={fav ? t("states.favoriteTitle") : t("states.markFavoriteTitle")}
          onClick={onFav}
        >
          ♥
        </button>
      )}
    </div>
  );
}

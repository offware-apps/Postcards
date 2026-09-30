import type { PlaceRef, Story } from "../../lib/schema/models";

// Pure helpers that hide a postcard's now-optional / multi-valued shape from the
// read side. A postcard (journal Story, spec 020) may have no place, a primary
// place, or a primary + ordered extras, and its date may be a single day or a
// start→end range. Every view that used to assume one required place / one day
// goes through these, so a place-less or multi-place or ranged postcard renders
// without special-casing at each call site. No I/O; fully testable.

/** Every place a postcard is about, in order: the primary then any extras. Empty
 *  for a place-less postcard. */
export function placesOf(story: Pick<Story, "place" | "extraPlaces">): PlaceRef[] {
  const out: PlaceRef[] = [];
  if (story.place) out.push(story.place);
  if (story.extraPlaces) out.push(...story.extraPlaces);
  return out;
}

/** The postcard's representative place (primary, else the first extra, else null). */
export function primaryPlace(story: Pick<Story, "place" | "extraPlaces">): PlaceRef | null {
  return story.place ?? story.extraPlaces?.[0] ?? null;
}

/** True when a postcard has no place at all (an "Unplaced" entry). */
export function isUnplaced(story: Pick<Story, "place" | "extraPlaces">): boolean {
  return !story.place && !(story.extraPlaces && story.extraPlaces.length > 0);
}

/** The postcard's day or span. `end` is null unless a valid later end date is set,
 *  so a single-day postcard reads exactly as before (`{ start, end: null }`). */
export function dateSpan(story: Pick<Story, "date" | "endDate">): { start: string; end: string | null } {
  const end = story.endDate && story.endDate > story.date ? story.endDate : null;
  return { start: story.date, end };
}

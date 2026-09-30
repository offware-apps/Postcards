// Assemble a PUBLISHED journey — the ordered "book" a reader pages through.
//
// The route is TRIPS-driven (from→to legs with a transport mode, per the design):
// consecutive legs stitch into an ordered list of places, and each place picks up
// the journal story and photos you attached to it. When there are no trips in the
// selection we fall back to journal stories in date order, so a story-only journal
// still publishes. Pure & deterministic — unit-tested, no I/O, no DOM.

import type { PlaceRef, Story, TravelMode, Trip, Visit } from "../schema/models";
import { placeKey } from "../schema/helpers";
import { haversineKm } from "../../features/travel/distance";
import { tripDateSpan } from "../../features/travel/tripDate";
import { tripChain } from "../../features/travel/tripStops";

export interface JourneyStep {
  place: PlaceRef;
  lat: number;
  lon: number;
  /** The day this step is about (from the trip leg or the story), or null. */
  date: string | null;
  /** Transport used to ARRIVE here from the previous step (null for the first,
   *  or when two consecutive legs don't connect). */
  arriveBy: TravelMode | null;
  story?: { title: string; text: string; date: string };
  photos: { src: string; caption: string | null }[];
}

export interface PublishedJourney {
  title: string;
  subtitle?: string;
  dateRange: { start: string | null; end: string | null };
  steps: JourneyStep[];
  totals: { countries: number; places: number; distanceKm: number };
}

export interface JourneySelection {
  title: string;
  subtitle?: string;
  /** Restrict to these trips (by tripId). Omit to use all trips in range. */
  tripIds?: string[];
  /** Inclusive YYYY-MM-DD bounds applied to trips and stories. */
  dateFrom?: string;
  dateTo?: string;
}

export interface JourneyInput {
  visits: Visit[];
  trips: Trip[];
  stories: Story[];
  /** Resolve coordinates for a reference place (custom places carry their own). */
  resolveCoords: (place: PlaceRef) => { lat: number; lon: number } | null;
}

function coordsOf(
  place: PlaceRef,
  resolve: JourneyInput["resolveCoords"],
): { lat: number; lon: number } | null {
  if (typeof place.lat === "number" && typeof place.lon === "number") {
    return { lat: place.lat, lon: place.lon };
  }
  return resolve(place);
}

/** Whether a date lies in [from, to]. A month- or year-dated trip is in range
 *  when the range covers its whole span; an undated record only when unbounded. */
function inRange(date: string | null, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const span = tripDateSpan(date);
  if (!span) return false;
  if (from && span.first < from) return false;
  if (to && span.last > to) return false;
  return true;
}

/** Build the ordered, self-contained journey for the reader. */
export function buildJourney(input: JourneyInput, sel: JourneySelection): PublishedJourney {
  const { visits, trips, stories, resolveCoords } = input;

  // Index stories and visit-photos by place, so each step can pick up its own.
  const storyByPlace = new Map<string, Story>();
  for (const s of stories) {
    if (!inRange(s.date, sel.dateFrom, sel.dateTo)) continue;
    const k = placeKey(s.place);
    // Keep the earliest story for a place as its step story (feed order is newest
    // first; the book reads oldest→newest).
    const cur = storyByPlace.get(k);
    if (!cur || s.date < cur.date) storyByPlace.set(k, s);
  }
  const photosByPlace = new Map<string, { src: string; caption: string | null }[]>();
  const addPhotos = (place: PlaceRef, photos?: { src: string; caption: string | null }[]) => {
    if (!photos?.length) return;
    const k = placeKey(place);
    const list = photosByPlace.get(k) ?? [];
    for (const p of photos) if (!list.some((q) => q.src === p.src)) list.push(p);
    photosByPlace.set(k, list);
  };
  for (const v of visits) addPhotos(v.place, v.photos ?? []);
  for (const s of stories) addPhotos(s.place, s.photos ?? []);

  // Ordered legs from the selected trips (date first, then a stable original order).
  const wanted = sel.tripIds ? new Set(sel.tripIds) : null;
  const legs = trips
    .filter((t) => (wanted ? wanted.has(t.tripId) : true))
    .filter((t) => inRange(t.date, sel.dateFrom, sel.dateTo))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const steps: JourneyStep[] = [];
  const makeStep = (place: PlaceRef, date: string | null, arriveBy: TravelMode | null): void => {
    const c = coordsOf(place, resolveCoords);
    if (!c) return; // can't place it on the map — skip (reader is map-led)
    const story = storyByPlace.get(placeKey(place));
    steps.push({
      place,
      lat: c.lat,
      lon: c.lon,
      date: story?.date ?? date,
      arriveBy,
      story: story ? { title: story.title, text: story.text, date: story.date } : undefined,
      photos: photosByPlace.get(placeKey(place)) ?? [],
    });
  };

  if (legs.length > 0) {
    for (const t of legs) {
      // Every stop of a multi-stop trip, each arrived at by its own leg's mode.
      const chain = tripChain(t);
      const last = steps[steps.length - 1];
      if (!last || placeKey(last.place) !== placeKey(chain[0]!)) makeStep(chain[0]!, t.date, null);
      for (let i = 1; i < chain.length; i++) makeStep(chain[i]!, t.date, t.legModes?.[i - 1] ?? t.mode);
    }
  } else {
    // No trips selected — publish the stories in date order as the steps.
    const ordered = stories
      .filter((s) => inRange(s.date, sel.dateFrom, sel.dateTo))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (ordered.length > 0) {
      for (const s of ordered) makeStep(s.place, s.date, null);
    } else {
      // No trips AND no stories — plot the places you've been so the map isn't
      // empty (and a visits-only user can still publish "everywhere I've been").
      // Wishlist places are excluded — this is where you HAVE been.
      const been = visits
        .filter((v) => v.status === "visited")
        .filter((v) => inRange(v.date ?? null, sel.dateFrom, sel.dateTo))
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      for (const v of been) makeStep(v.place, v.date ?? null, null);
    }
  }

  // Totals: distinct countries, place count, and the great-circle length of the route.
  const countries = new Set<string>();
  for (const s of steps) if (s.place.countryId && s.place.countryId !== "ZZ") countries.add(s.place.countryId);
  let distanceKm = 0;
  for (let i = 1; i < steps.length; i++) {
    distanceKm += haversineKm(
      { lat: steps[i - 1]!.lat, lon: steps[i - 1]!.lon },
      { lat: steps[i]!.lat, lon: steps[i]!.lon },
    );
  }
  const dates = steps.map((s) => s.date).filter((d): d is string => !!d).sort();

  return {
    title: sel.title,
    subtitle: sel.subtitle,
    dateRange: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null },
    steps,
    totals: { countries: countries.size, places: steps.length, distanceKm: Math.round(distanceKm) },
  };
}

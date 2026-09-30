import { placeKey } from "../../lib/schema/helpers";
import type { PlaceRef, Story, Trip } from "../../lib/schema/models";
import { tripChain } from "../travel/tripStops";

/**
 * Journal folders — a small, inert grouping label on a story (mirrors a Trip's
 * `name`). These helpers are PURE (no store / no reference-data reads) so the
 * composer's suggestions and the feed's "By folder" filter can be unit-tested in
 * isolation. All strings here are already sanitized upstream (schema transforms
 * on `folder`, `place.name`, and `trip.name`), so nothing new is authored.
 */

/** Distinct folder labels in use across the given stories, sorted for a stable list. */
export function distinctFolders(stories: Pick<Story, "folder">[]): string[] {
  const seen = new Set<string>();
  for (const s of stories) {
    const f = s.folder?.trim();
    if (f) seen.add(f);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Whether a story belongs to `folder` (the feed's "By folder" scope). A story
 *  with no folder never matches a named folder. */
export function matchesFolder(story: Pick<Story, "folder">, folder: string): boolean {
  return (story.folder ?? "") === folder;
}

/** Does this trip belong to the story's context (same place/country, or same year)? */
function tripInContext(trip: Trip, place: PlaceRef | null | undefined, date: string | undefined): boolean {
  if (place) {
    const k = placeKey(place);
    for (const stop of tripChain(trip)) {
      if (placeKey(stop) === k || stop.countryId === place.countryId) return true;
    }
  }
  if (date && trip.date && trip.date.slice(0, 4) === date.slice(0, 4)) return true;
  return false;
}

export interface FolderContext {
  /** The place the story is about (its name and country seed proposals). */
  place?: PlaceRef | null;
  /** The place's country display name (resolved from reference data by the caller). */
  countryName?: string | null;
  /** The story's date (used to match trips in the same year). */
  date?: string;
  /** Known trips, so a trip name that matches this story's place/date is proposed. */
  trips?: Trip[];
}

/**
 * Folders to PROPOSE while writing a story, in priority order and deduped
 * (case-insensitively, keeping the first spelling seen):
 *   1. folders already used across stories — the most reusable, offered first;
 *   2. the selected place's own name, then its country name;
 *   3. any trip name whose trip touches this story's place/country or year.
 * Empty/blank candidates are skipped. The result is a plain string list the UI
 * can render as datalist options or suggestion chips.
 */
export function folderSuggestions(
  stories: Pick<Story, "folder">[],
  ctx: FolderContext = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const v = raw?.trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  // 1. Existing folders — reuse beats inventing a near-duplicate.
  for (const f of distinctFolders(stories)) add(f);
  // 2. Contextual proposals from the place being written about.
  add(ctx.place?.name);
  add(ctx.countryName);
  // 3. Trip names that overlap this story's place/country or year.
  if ((ctx.place || ctx.date) && ctx.trips?.length) {
    for (const trip of ctx.trips) {
      if (trip.name?.trim() && tripInContext(trip, ctx.place ?? null, ctx.date)) add(trip.name);
    }
  }
  return out;
}

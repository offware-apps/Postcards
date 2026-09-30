import { create } from "zustand";
import { backfillUpdatedAt, stampNow } from "../schema/helpers";
import type { Photo, PlaceRef, Story } from "../schema/models";
import * as db from "../db/storiesDb";
import * as visitsDb from "../db/visitsDb";
import { stampPlaceCoords } from "../reference/placeCoords";
import { uuid } from "./uuid";

/** Now, as the ISO stamp written to `updatedAt` on every mutating path (spec 013). */

/** Journal order: newest story date first (ties broken by newest addedAt). */
export function sortStories(stories: Story[]): Story[] {
  return [...stories].sort(
    (a, b) => b.date.localeCompare(a.date) || b.addedAt.localeCompare(a.addedAt),
  );
}

interface StoriesState {
  stories: Story[];
  loaded: boolean;
  load: () => Promise<void>;
  addStory: (input: {
    /** Optional primary place (v13): a postcard can be place-less. */
    place?: PlaceRef | null;
    /** Additional ordered places beyond the primary. */
    extraPlaces?: PlaceRef[];
    date: string;
    /** Optional range end day (> date). */
    endDate?: string;
    title: string;
    text: string;
    photos?: Photo[];
    /** Optional folder label (e.g. "Japan 2024"); omitted when empty. */
    folder?: string | null;
    /** Personal mood/weather/free tags; omitted when empty. */
    tags?: string[];
    /** Optional link to a reconstructed trip; omitted when empty. */
    tripId?: string;
  }) => Promise<Story>;
  updateStory: (
    storyId: string,
    changes: Partial<
      Pick<
        Story,
        "place" | "extraPlaces" | "date" | "endDate" | "title" | "text" | "photos" | "folder" | "tags" | "tripId"
      >
    >,
  ) => Promise<void>;
  removeStory: (storyId: string) => Promise<void>;
  setAll: (stories: Story[]) => Promise<void>;
}

export const useStories = create<StoriesState>((set, get) => ({
  stories: [],
  loaded: false,
  async load() {
    // Backfill `updatedAt` from `addedAt` for stories made before sync existed.
    const stories = sortStories((await db.getAllStories()).map(backfillUpdatedAt));
    set({ stories, loaded: true });
  },
  async addStory({ place = null, extraPlaces, date, endDate, title, text, photos = [], folder = null, tags, tripId }) {
    const at = new Date().toISOString();
    // Stamp coordinates from the in-memory gazetteer so a published journey can
    // plot each place without it (the site is self-contained; the bundle is only
    // the top-10k cities). See stampPlaceCoords. A place-less postcard skips this.
    const stampedPlace = place ? stampPlaceCoords(place) : undefined;
    const stampedExtras = extraPlaces?.length ? extraPlaces.map(stampPlaceCoords) : undefined;
    const cleanTags = tags?.map((t) => t.trim()).filter(Boolean);
    const story: Story = {
      storyId: uuid(),
      // Every optional key is carried ONLY when set — never persist an empty/undefined
      // key (mirrors the schema's optional fields and how a trip's `name` is stored),
      // so older-shaped records and exports stay lean and byte-identical.
      ...(stampedPlace ? { place: stampedPlace } : {}),
      ...(stampedExtras ? { extraPlaces: stampedExtras } : {}),
      date,
      ...(endDate && endDate > date ? { endDate } : {}),
      title,
      text,
      ...(folder && folder.trim() ? { folder: folder.trim() } : {}),
      ...(photos.length ? { photos } : {}),
      ...(cleanTags && cleanTags.length ? { tags: cleanTags } : {}),
      ...(tripId ? { tripId } : {}),
      addedAt: at,
      updatedAt: at,
    };
    set({ stories: sortStories([...get().stories, story]) });
    await db.putStory(story);
    return story;
  },
  async updateStory(storyId, changes) {
    const existing = get().stories.find((s) => s.storyId === storyId);
    if (!existing) return;
    // Stamp coordinates on any place that changed (primary and/or extras).
    if (changes.place) changes = { ...changes, place: stampPlaceCoords(changes.place) };
    if (changes.extraPlaces)
      changes = { ...changes, extraPlaces: changes.extraPlaces.map(stampPlaceCoords) };
    const updated: Story = { ...existing, ...changes, updatedAt: stampNow() };
    // Drop any optional key that was cleared, so we never persist an empty value
    // (the schema forbids empty folder/tags and never injects an unset key).
    if ("place" in changes && !changes.place) delete updated.place;
    if (!updated.extraPlaces?.length) delete updated.extraPlaces;
    if ("folder" in changes) {
      const f = changes.folder?.trim();
      if (f) updated.folder = f;
      else delete updated.folder;
    }
    if (!updated.photos?.length) delete updated.photos;
    if (!updated.tags?.length) delete updated.tags;
    if (!(updated.endDate && updated.endDate > updated.date)) delete updated.endDate;
    if (!updated.tripId) delete updated.tripId;
    set({ stories: sortStories(get().stories.map((s) => (s.storyId === storyId ? updated : s))) });
    await db.putStory(updated);
  },
  async removeStory(storyId) {
    set({ stories: get().stories.filter((s) => s.storyId !== storyId) });
    await db.deleteStory(storyId);
    // Tombstone the deletion so it propagates on sync (spec 013, FR-009).
    await visitsDb.putTombstone("story", storyId, stampNow());
  },
  async setAll(stories) {
    // Bulk load: backfill `updatedAt` without stamping "now" (keep real ages).
    const sorted = sortStories(stories.map(backfillUpdatedAt));
    set({ stories: sorted });
    await db.replaceAllStories(sorted);
  },
}));

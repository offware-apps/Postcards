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
    place: PlaceRef;
    date: string;
    title: string;
    text: string;
    photos?: Photo[];
    /** Optional folder label (e.g. "Japan 2024"); omitted when empty. */
    folder?: string | null;
  }) => Promise<Story>;
  updateStory: (
    storyId: string,
    changes: Partial<Pick<Story, "place" | "date" | "title" | "text" | "photos" | "folder">>,
  ) => Promise<void>;
  removeStory: (storyId: string) => Promise<void>;
  /** Put ONE story back (the undo of a delete or an edit): upsert by storyId. */
  restoreStory: (story: Story) => Promise<void>;
}

export const useStories = create<StoriesState>((set, get) => ({
  stories: [],
  loaded: false,
  async load() {
    // Backfill `updatedAt` from `addedAt` for stories made before sync existed.
    const stories = sortStories(
      (await visitsDb.loadOrEmpty(db.getAllStories)).map(backfillUpdatedAt),
    );
    set({ stories, loaded: true });
  },
  async addStory({ place, date, title, text, photos = [], folder = null }) {
    const at = new Date().toISOString();
    // Stamp coordinates from the in-memory gazetteer so a published journey can
    // plot this place without it (the site is self-contained; the bundle is only
    // the top-10k cities). See stampPlaceCoords.
    place = stampPlaceCoords(place);
    const story: Story = {
      storyId: uuid(),
      place,
      date,
      title,
      text,
      // Only carry `folder` when set — never persist an empty/undefined key (mirrors
      // the schema's optional field and how a trip's `name` is stored).
      ...(folder && folder.trim() ? { folder: folder.trim() } : {}),
      // Only carry `photos` when there is at least one — keeps records and exports lean.
      ...(photos.length ? { photos } : {}),
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
    // If the place was changed, stamp its coordinates too (see stampPlaceCoords).
    if (changes.place) changes = { ...changes, place: stampPlaceCoords(changes.place) };
    const updated: Story = { ...existing, ...changes, updatedAt: stampNow() };
    // Normalize an edited folder label: trim it, and drop the key entirely when
    // cleared so we never persist an empty `folder` (the schema forbids it).
    if ("folder" in changes) {
      const f = changes.folder?.trim();
      if (f) updated.folder = f;
      else delete updated.folder;
    }
    if (!updated.photos?.length) delete updated.photos;
    set({ stories: sortStories(get().stories.map((s) => (s.storyId === storyId ? updated : s))) });
    await db.putStory(updated);
  },
  async removeStory(storyId) {
    set({ stories: get().stories.filter((s) => s.storyId !== storyId) });
    await db.deleteStory(storyId);
    // Tombstone the deletion so it propagates on sync (spec 013, FR-009).
    await visitsDb.putTombstone("story", storyId, stampNow());
  },
  async restoreStory(story) {
    // Bump `updatedAt` so the restored story wins on the next merge, over its own
    // tombstone or over the undone edit a sync already pushed, and clear that
    // tombstone so the restore is clean (mirrors useVisits.restoreVisit).
    const restored: Story = { ...story, updatedAt: stampNow() };
    const rest = get().stories.filter((s) => s.storyId !== restored.storyId);
    set({ stories: sortStories([...rest, restored]) });
    await db.putStory(restored);
    await visitsDb.deleteTombstone("story", restored.storyId);
  },
}));

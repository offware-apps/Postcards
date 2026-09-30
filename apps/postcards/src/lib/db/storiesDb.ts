import type { Story } from "../schema/models";
import { getDb, hasIndexedDB } from "./visitsDb";

// Journal working store — shares the "postcards" IndexedDB opened by visitsDb
// (v3 adds the "stories" object store). Local-first, no backend.
const STORE = "stories";

export async function getAllStories(): Promise<Story[]> {
  if (!hasIndexedDB()) return [];
  return (await getDb()).getAll(STORE) as Promise<Story[]>;
}

export async function putStory(story: Story): Promise<void> {
  if (!hasIndexedDB()) return;
  await (await getDb()).put(STORE, story);
}

export async function deleteStory(storyId: string): Promise<void> {
  if (!hasIndexedDB()) return;
  await (await getDb()).delete(STORE, storyId);
}

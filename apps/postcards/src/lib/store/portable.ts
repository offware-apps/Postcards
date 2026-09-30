import { getAllVisits, hasIndexedDB, onOtherTabWrite, readSettled } from "../db/visitsDb";
import { getAllTrips } from "../db/tripsDb";
import { getAllStories } from "../db/storiesDb";
import { backfillUpdatedAt, normalizeVisitPhotos } from "../schema/helpers";
import { markApplyingSync } from "../sync/applyMark";
import { useVisits } from "./useVisits";
import { useTrips } from "./useTrips";
import { sortStories, useStories } from "./useStories";

// The three stores the portable file carries, loaded and awaited together.

export function loadPortable(): void {
  void useVisits.getState().load();
  void useTrips.getState().load();
  void useStories.getState().load();
}

export function usePortableLoaded(): boolean {
  const visits = useVisits((s) => s.loaded);
  const trips = useTrips((s) => s.loaded);
  const stories = useStories((s) => s.loaded);
  return visits && trips && stories;
}

/** Replace the three stores with what the database holds now. */
async function reloadPortable(): Promise<void> {
  const stores = [useVisits, useTrips, useStories];
  // Before the startup read settles, that read is the one to wait for.
  if (!hasIndexedDB() || !stores.every((s) => s.getState().loaded)) return;
  await readSettled(
    () => Promise.all([getAllVisits(), getAllTrips(), getAllStories()]),
    ([visits, trips, stories]) =>
      // Another tab's write, not an edit here: auto-sync must not push it again.
      markApplyingSync(() => {
        useVisits.setState({ visits: visits.map(normalizeVisitPhotos).map(backfillUpdatedAt) });
        useTrips.setState({ trips: trips.map(backfillUpdatedAt) });
        useStories.setState({ stories: sortStories(stories.map(backfillUpdatedAt)) });
      }),
  );
}

/**
 * Keep the stores in step with the other open tabs: after each write one of them
 * makes, re-read the database. Writes arriving during a re-read take one more.
 * Returns the unsubscribe.
 */
export function followOtherTabs(): () => void {
  let reading = false;
  let again = false;
  const reload = (): void => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    void reloadPortable()
      .catch(() => {})
      .finally(() => {
        reading = false;
        if (again) {
          again = false;
          reload();
        }
      });
  };
  return onOtherTabWrite(reload);
}

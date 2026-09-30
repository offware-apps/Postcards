import { replaceAllPortable } from "../../lib/db/visitsDb";
import { backfillUpdatedAt } from "../../lib/schema/helpers";
import type { TFunction } from "../../lib/i18n";
import { useVisits } from "../../lib/store/useVisits";
import { useTrips } from "../../lib/store/useTrips";
import { sortStories, useStories } from "../../lib/store/useStories";

export type RestoreOutcome =
  | { ok: true; places: number; trips: number; stories: number }
  | { ok: false; reason: "invalid"; error: string }
  | { ok: false; reason: "cancelled" | "save" };

/** Each count as a phrase in the active language: "1 place", "2 trips". */
export function countPhrases(
  t: TFunction,
  c: { places: number; trips: number; stories: number },
): { places: string; trips: string; stories: string } {
  return {
    places: t.plural("count.place", c.places),
    trips: t.plural("count.trip", c.trips),
    stories: t.plural("count.story", c.stories),
  };
}

/**
 * Full restore from a Postcards JSON file — this REPLACES all of your data, so it
 * asks first when there is any (the one destructive path). Shared by the Backup
 * restore and the move from an old address (lib/moved); each maps the outcome to
 * its own UI.
 */
export async function restoreFromJson(text: string, t: TFunction): Promise<RestoreOutcome> {
  // Loaded on use: the codec pulls in the Zod schemas (~65 KB min), which
  // nothing on the startup path needs — keep them out of the boot chunk.
  const { importFile } = await import("./importJson");
  const result = importFile(text);
  if (!result.ok) return { ok: false, reason: "invalid", error: result.error };

  const cur = {
    places: useVisits.getState().visits.length,
    trips: useTrips.getState().trips.length,
    stories: useStories.getState().stories.length,
  };
  if (cur.places + cur.trips + cur.stories > 0) {
    const now = countPhrases(t, cur);
    const next = countPhrases(t, {
      places: result.visits.length,
      trips: result.trips.length,
      stories: result.stories.length,
    });
    const ok = window.confirm(
      t("backup.confirm.replace", {
        curPlaces: now.places,
        curTrips: now.trips,
        curStories: now.stories,
        newPlaces: next.places,
        newTrips: next.trips,
        newStories: next.stories,
      }),
    );
    if (!ok) return { ok: false, reason: "cancelled" };
  }

  try {
    // Persist all stores in one transaction, then reflect in memory — so the
    // device is never left with places from the new file and trips or stories
    // from the old.
    await replaceAllPortable(result.visits, result.trips, result.stories);
  } catch {
    return { ok: false, reason: "save" };
  }
  // Backfill `updatedAt` from `addedAt` for records that predate the field, so a
  // freshly restored session can immediately take part in device sync (spec 013).
  useVisits.setState({ visits: result.visits.map(backfillUpdatedAt) });
  useTrips.setState({ trips: result.trips.map(backfillUpdatedAt) });
  useStories.setState({ stories: sortStories(result.stories.map(backfillUpdatedAt)) });
  return {
    ok: true,
    places: result.visits.length,
    trips: result.trips.length,
    stories: result.stories.length,
  };
}

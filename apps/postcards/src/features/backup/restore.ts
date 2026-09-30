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

/**
 * Full restore from a Postcards JSON file — this REPLACES all of your data, so it
 * asks first when there is any (the one destructive path). Shared by the Backup
 * restore and the move from an old address (lib/moved); each maps the outcome to
 * its own UI. `askWhenEmpty` also asks on an empty device, for a file the visitor
 * did not pick themselves.
 */
export async function restoreFromJson(
  text: string,
  t: TFunction,
  askWhenEmpty?: (incoming: { places: number; trips: number; stories: number }) => string,
): Promise<RestoreOutcome> {
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
  const incoming = {
    places: result.visits.length,
    trips: result.trips.length,
    stories: result.stories.length,
  };
  if (cur.places + cur.trips + cur.stories > 0) {
    const ok = window.confirm(
      t("backup.confirm.replace", {
        curPlaces: cur.places,
        curTrips: cur.trips,
        curStories: cur.stories,
        newPlaces: incoming.places,
        newTrips: incoming.trips,
        newStories: incoming.stories,
      }),
    );
    if (!ok) return { ok: false, reason: "cancelled" };
  } else if (askWhenEmpty && !window.confirm(askWhenEmpty(incoming))) {
    return { ok: false, reason: "cancelled" };
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
  return { ok: true, ...incoming };
}

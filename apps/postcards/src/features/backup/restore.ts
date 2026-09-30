import { getAllTombstones, replaceAllPortable } from "../../lib/db/visitsDb";
import { backfillUpdatedAt, stampNow } from "../../lib/schema/helpers";
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
    const ok = window.confirm(
      t("backup.confirm.replace", {
        curPlaces: cur.places,
        curTrips: cur.trips,
        curStories: cur.stories,
        newPlaces: result.visits.length,
        newTrips: result.trips.length,
        newStories: result.stories.length,
      }),
    );
    if (!ok) return { ok: false, reason: "cancelled" };
  }

  // Backfill `updatedAt` from `addedAt` for records that predate the field, so a
  // freshly restored session can immediately take part in device sync (spec 013).
  let visits = result.visits.map(backfillUpdatedAt);
  let trips = result.trips.map(backfillUpdatedAt);
  let stories = result.stories.map(backfillUpdatedAt);
  try {
    // A record this device deleted since the backup comes back as an explicit
    // re-add, like an undo: stamped now so it wins over its tombstone on the next
    // sync (the remote holds the same deletion), and the tombstone dropped.
    const tombstones = await getAllTombstones();
    const deleted = new Set(tombstones.map((d) => d.key));
    const revive = <R extends { updatedAt?: string }>(kind: string, id: string, r: R): R =>
      deleted.has(`${kind}:${id}`) ? { ...r, updatedAt: stampNow() } : r;
    visits = visits.map((v) => revive("visit", v.visitId, v));
    trips = trips.map((tr) => revive("trip", tr.tripId, tr));
    stories = stories.map((s) => revive("story", s.storyId, s));
    const restored = new Set([
      ...visits.map((v) => `visit:${v.visitId}`),
      ...trips.map((tr) => `trip:${tr.tripId}`),
      ...stories.map((s) => `story:${s.storyId}`),
    ]);
    // Persist all stores and the tombstones in one transaction, then reflect in
    // memory — so the device is never left with places from the new file and
    // trips or stories from the old.
    await replaceAllPortable(
      visits,
      trips,
      stories,
      tombstones.filter((d) => !restored.has(d.key)),
    );
  } catch {
    return { ok: false, reason: "save" };
  }
  useVisits.setState({ visits });
  useTrips.setState({ trips });
  useStories.setState({ stories: sortStories(stories) });
  return {
    ok: true,
    places: result.visits.length,
    trips: result.trips.length,
    stories: result.stories.length,
  };
}

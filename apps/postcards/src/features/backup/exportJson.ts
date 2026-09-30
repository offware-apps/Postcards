import {
  FORMAT,
  PostcardsFileSchema,
  SCHEMA_VERSION,
  type PostcardsFile,
  type Photo,
  type ReferenceSource,
  type Story,
  type SyncTombstone,
  type Trip,
  type Visit,
} from "../../lib/schema/models";
import { getReferenceData } from "../../lib/reference/referenceData";
import { isDecodableDataUrl } from "../../lib/image/photoBlobs";

/** Keep only the photos that decode, and drop an empty `photos` array so a
 *  photo-less record stays lean in the file. A photo that does not decode can sit
 *  on a device (a story restored before imports refused one); leaving it out keeps
 *  every backup and sync push valid and restorable. */
function decodablePhotos<T extends { photos?: Photo[] }>(rec: T): T | Omit<T, "photos"> {
  const { photos, ...rest } = rec;
  const kept = photos?.filter((p) => isDecodableDataUrl(p.src));
  return kept && kept.length ? { ...rest, photos: kept } : rest;
}

/** Build the canonical portable file object from the current visits + trips + stories.
 *  `tombstones` is written only for device sync; a plain backup passes none, so the
 *  exported file stays free of an empty `tombstones` key. */
export function buildFile(
  visits: Visit[],
  trips: Trip[] = [],
  stories: Story[] = [],
  now = new Date(),
  tombstones: SyncTombstone[] = [],
): PostcardsFile {
  const referenceSources: ReferenceSource[] = getReferenceData().provenance.map((p) => ({
    dataset: p.dataset,
    license: p.license,
    version: p.version,
    url: p.url,
  }));
  const file: PostcardsFile = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    // Keep decodable photos only, and drop empty `photos` arrays (see above).
    visits: visits.map(decodablePhotos),
    trips,
    stories: stories.map(decodablePhotos),
    ...(tombstones.length ? { tombstones } : {}),
    referenceSources,
  };
  // Validate our own output before handing it to the user.
  return PostcardsFileSchema.parse(file);
}

/** Serialize to pretty, human-readable JSON (the canonical portable format). */
export function serializeFile(
  visits: Visit[],
  trips: Trip[] = [],
  stories: Story[] = [],
  now = new Date(),
  tombstones: SyncTombstone[] = [],
): string {
  return JSON.stringify(buildFile(visits, trips, stories, now, tombstones), null, 2);
}

export const EXPORT_FILENAME = "places.postcards.json";

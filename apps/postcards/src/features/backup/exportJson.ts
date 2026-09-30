import {
  FORMAT,
  PostcardsFileSchema,
  SCHEMA_VERSION,
  type PostcardsFile,
  type ReferenceSource,
  type Story,
  type SyncTombstone,
  type Trip,
  type Visit,
} from "../../lib/schema/models";
import { getReferenceData } from "../../lib/reference/referenceData";
import { MAX_TAG_LEN } from "../../lib/schema/helpers";
import { sanitizeText } from "../../lib/schema/sanitize";

/** Drop an empty `photos` array so a photo-less record stays lean in the file. */
function dropEmptyPhotos<T extends { photos?: unknown[] }>(rec: T): T | Omit<T, "photos"> {
  const { photos, ...rest } = rec;
  return photos && photos.length ? { ...rest, photos } : rest;
}

/** Drop a stored tag that sanitizes to nothing ("-", a lone bidi mark): the schema
 *  rejects it, which would block every backup and sync of a device holding one. */
function dropBlankTags(story: Story): Story {
  if (!story.tags) return story;
  const { tags, ...rest } = story;
  const kept = tags.filter((t) => sanitizeText(t, MAX_TAG_LEN));
  return kept.length ? { ...rest, tags: kept } : rest;
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
    // Drop empty `photos` arrays so a photo-less export stays lean and readable.
    visits: visits.map(dropEmptyPhotos),
    trips,
    stories: stories.map((s) => dropEmptyPhotos(dropBlankTags(s))),
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

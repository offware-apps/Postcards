import type { Story, Trip, Visit } from "../../lib/schema/models";
import { zipStore, unzipStore, type ZipEntry } from "../../lib/backup/zip";
import { bytesToDataUrl, decodeDataUrl } from "../../lib/image/photoBlobs";
import { buildFile } from "./exportJson";

// The "Save everything" archive: one .zip holding a compact JSON manifest plus
// every photo as a real, openable image FILE (photos/0001.jpg …). The manifest
// is the canonical portable file with each photo's inline data URL swapped for a
// "zip:photos/…" reference, so the JSON stays small and readable while the images
// live as browsable files. Import reverses it: re-inline the referenced bytes
// into data URLs, then hand the reconstructed standard JSON to the normal
// validator (Constitution VI: still parsed, never executed).

export const ARCHIVE_FILENAME = "postcards-backup.zip";
export const MANIFEST_NAME = "backup.postcards.json";

// Extensions must cover EVERY mime the photo schema admits (png|jpe?g|webp|gif|
// avif — note both image/jpeg AND image/jpg pass its regex), so a written file
// always maps back to a schema-valid image mime on read. An unknown image mime
// falls back to its subtype so it still round-trips rather than becoming ".bin".
const EXT_OF: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const MIME_OF: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const extForMime = (mime: string): string =>
  EXT_OF[mime] ?? (mime.replace(/^image\//, "").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin");
const mimeForExt = (ext: string): string => MIME_OF[ext] ?? `image/${ext}`;

type PhotoLike = { src: string; caption: string | null };

/** Build the complete "everything" archive as ZIP bytes. */
export function buildArchive(
  visits: Visit[],
  trips: Trip[] = [],
  stories: Story[] = [],
  now = new Date(),
): Uint8Array {
  const file = buildFile(visits, trips, stories, now); // validated, data-URL photos
  const photoEntries: ZipEntry[] = [];
  let n = 0;
  const stash = (photos?: PhotoLike[]) =>
    photos?.map((p) => {
      const { bytes, mime } = decodeDataUrl(p.src);
      const name = `photos/${String(++n).padStart(4, "0")}.${extForMime(mime)}`;
      photoEntries.push({ name, data: bytes });
      return { src: `zip:${name}`, caption: p.caption ?? null };
    });
  const manifest = {
    ...file,
    visits: file.visits.map((v) => (v.photos && v.photos.length ? { ...v, photos: stash(v.photos) } : v)),
    stories: file.stories.map((s) => (s.photos && s.photos.length ? { ...s, photos: stash(s.photos) } : s)),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  return zipStore([{ name: MANIFEST_NAME, data: json }, ...photoEntries]);
}

/**
 * Turn an archive's bytes back into a standard Postcards JSON string, re-inlining
 * each "zip:photos/…" reference from its stored image file. The result is fed to
 * the normal `importFile` validator. Throws if there's no manifest inside.
 */
export function archiveToJson(bytes: Uint8Array): string {
  const entries = unzipStore(bytes);
  const manifest =
    entries.find((e) => e.name === MANIFEST_NAME) ?? entries.find((e) => e.name.endsWith(".json"));
  if (!manifest) throw new Error("no backup manifest in archive");
  const fileMap = new Map(entries.map((e) => [e.name, e.data] as const));
  const obj = JSON.parse(new TextDecoder().decode(manifest.data)) as Record<string, unknown>;
  const reinline = (photos: unknown): PhotoLike[] =>
    (Array.isArray(photos) ? photos : [])
      .map((p): PhotoLike | null => {
        const ph = p as PhotoLike;
        if (typeof ph.src === "string" && ph.src.startsWith("zip:")) {
          const name = ph.src.slice(4);
          const data = fileMap.get(name);
          if (!data) return null; // referenced image missing — drop rather than break restore
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          return { src: bytesToDataUrl(data, mimeForExt(ext)), caption: ph.caption ?? null };
        }
        return ph;
      })
      .filter((p): p is PhotoLike => p !== null);
  const withPhotos = (rec: unknown) => {
    const r = rec as { photos?: unknown };
    return r.photos ? { ...r, photos: reinline(r.photos) } : r;
  };
  if (Array.isArray(obj.visits)) obj.visits = obj.visits.map(withPhotos);
  if (Array.isArray(obj.stories)) {
    obj.stories = (obj.stories as unknown[])
      .map(withPhotos)
      // A story may be image-only (no title/text). If its images went missing from
      // the archive, re-inlining empties it — which the schema rejects, aborting the
      // WHOLE restore. Drop such a now-empty story instead so the rest still loads.
      .filter((rec) => {
        const s = rec as { title?: unknown; text?: unknown; photos?: unknown[] };
        const hasText = typeof s.title === "string" && s.title.trim().length > 0;
        const hasBody = typeof s.text === "string" && s.text.trim().length > 0;
        const hasPhotos = Array.isArray(s.photos) && s.photos.length > 0;
        return hasText || hasBody || hasPhotos;
      });
  }
  return JSON.stringify(obj);
}

import { describe, it, expect } from "vitest";
import {
  blobToDataUrl,
  dataUrlToBlob,
  dehydrateVisit,
  hydrateVisit,
  referencedPhotoIds,
  type PhotoBlobKV,
  type StoredVisit,
} from "../../src/lib/image/photoBlobs";
import type { Visit } from "../../src/lib/schema/models";

// A canonical inline image data URL, exactly the shape a downscaled postcard or an
// imported gallery photo carries.
const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DATA_URL_2 =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==";

/** An in-memory implementation of the blob port so the split logic is testable
 *  without a real IndexedDB (the vitest env has none). */
function memKv(): PhotoBlobKV & { store: Map<string, Blob>; puts: number } {
  const store = new Map<string, Blob>();
  const kv = {
    store,
    puts: 0,
    async get(id: string) {
      return store.get(id);
    },
    async has(id: string) {
      return store.has(id);
    },
    async put(id: string, blob: Blob) {
      kv.puts++;
      store.set(id, blob);
    },
  };
  return kv;
}

function visit(over: Partial<Visit> = {}): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
    date: "2019-08-12",
    note: null,
    status: "visited",
    favorite: false,
    addedAt: new Date().toISOString(),
    ...over,
  };
}

describe("data URL <-> Blob codec", () => {
  it("round-trips a base64 image data URL byte-for-byte", async () => {
    const blob = dataUrlToBlob(DATA_URL);
    expect(blob.type).toBe("image/png");
    expect(await blobToDataUrl(blob)).toBe(DATA_URL);
  });

  it("preserves the MIME type across the round-trip", async () => {
    expect(await blobToDataUrl(dataUrlToBlob(DATA_URL_2))).toBe(DATA_URL_2);
  });
});

describe("dehydrate/hydrate round-trip (blobs off the record)", () => {
  it("moves photos to blobs, leaving only {id, caption} refs on the record", async () => {
    const kv = memKv();
    const v = visit({ photos: [{ src: DATA_URL, caption: "the Louvre" }] });
    const stored = await dehydrateVisit(v, kv);

    // The stored record carries a ref, NOT the multi-KB inline image.
    expect(stored.photos).toHaveLength(1);
    expect(stored.photos![0]!.caption).toBe("the Louvre");
    expect(typeof stored.photos![0]!.id).toBe("string");
    expect((stored.photos![0] as { src?: string }).src).toBeUndefined();
    // The blob now lives in the photos store.
    expect(kv.store.size).toBe(1);
    expect(kv.store.has(stored.photos![0]!.id)).toBe(true);
  });

  it("rehydrates a stored record back to the exact in-memory Visit", async () => {
    const kv = memKv();
    const original = visit({
      photos: [
        { src: DATA_URL, caption: "the monument" },
        { src: DATA_URL_2, caption: null },
      ],
    });
    const stored = await dehydrateVisit(original, kv);
    const { visit: back, needsMigrate } = await hydrateVisit(stored, kv);

    expect(needsMigrate).toBe(false);
    expect(back.photos).toEqual([
      { src: DATA_URL, caption: "the monument" },
      { src: DATA_URL_2, caption: null },
    ]);
    // Non-photo fields are untouched.
    expect(back.visitId).toBe(original.visitId);
    expect(back.place).toEqual(original.place);
    expect(back.date).toBe(original.date);
  });

  it("keeps a photo-less visit clean (no photos key, no blobs)", async () => {
    const kv = memKv();
    const stored = await dehydrateVisit(visit(), kv);
    expect("photos" in stored).toBe(false);
    expect(kv.store.size).toBe(0);
    const { visit: back } = await hydrateVisit(stored, kv);
    expect("photos" in back).toBe(false);
  });
});

describe("hot path: re-persisting an unchanged photo writes no new blob", () => {
  it("dehydrating the same photo objects twice reuses the stored blob", async () => {
    const kv = memKv();
    const photos = [{ src: DATA_URL, caption: null }];
    const v = visit({ photos });

    await dehydrateVisit(v, kv);
    const putsAfterFirst = kv.puts;

    // Simulate a favorite toggle: a new visit object, but the SAME photo objects.
    const toggled = { ...v, favorite: true, photos };
    const stored = await dehydrateVisit(toggled, kv);

    // No extra blob write — the toggle only rewrote the tiny ref record.
    expect(kv.puts).toBe(putsAfterFirst);
    expect(kv.store.size).toBe(1);
    expect(stored.photos![0]!.id).toBeTruthy();
  });

  it("stores the blob again when it was deleted under a photo still in memory", async () => {
    const kv = memKv();
    const v = visit({ photos: [{ src: DATA_URL, caption: null }] });
    const first = await dehydrateVisit(v, kv);
    kv.store.clear(); // the visit was deleted; an undo still holds its photo objects
    const again = await dehydrateVisit(v, kv);
    expect(again.photos![0]!.id).toBe(first.photos![0]!.id);
    expect(kv.store.has(first.photos![0]!.id)).toBe(true);
  });
});

describe("migration of pre-split records", () => {
  it("migrates an inline gallery record and flags it for re-persist", async () => {
    const kv = memKv();
    // Old on-disk shape (before v5): photos carried the inline src, no blob store.
    const inline = {
      ...visit(),
      photos: [{ src: DATA_URL, caption: "old" }],
    } as unknown as StoredVisit;

    const { visit: back, needsMigrate } = await hydrateVisit(inline, kv);
    expect(needsMigrate).toBe(true);
    expect(back.photos).toEqual([{ src: DATA_URL, caption: "old" }]);

    // Re-persisting the migrated visit moves the bytes into the blob store.
    const stored = await dehydrateVisit(back, kv);
    expect((stored.photos![0] as { src?: string }).src).toBeUndefined();
    expect(kv.store.size).toBe(1);

    // A second load now reads the blob-backed shape, no migration needed.
    const second = await hydrateVisit(stored, kv);
    expect(second.needsMigrate).toBe(false);
    expect(second.visit.photos).toEqual([{ src: DATA_URL, caption: "old" }]);
  });

  it("folds a legacy single `photo` field into the gallery", async () => {
    const kv = memKv();
    const legacy = { ...visit(), photo: DATA_URL } as unknown as StoredVisit;
    const { visit: back, needsMigrate } = await hydrateVisit(legacy, kv);
    expect(needsMigrate).toBe(true);
    expect((back as { photo?: string }).photo).toBeUndefined();
    expect(back.photos).toEqual([{ src: DATA_URL, caption: null }]);
  });

  it("keeps the same image stored twice under two captions", async () => {
    const kv = memKv();
    const stored = await dehydrateVisit(
      visit({
        photos: [
          { src: DATA_URL, caption: "front" },
          { src: DATA_URL, caption: "back" },
        ],
      }),
      kv,
    );
    const { visit: back } = await hydrateVisit(stored, kv);
    expect(back.photos).toEqual([
      { src: DATA_URL, caption: "front" },
      { src: DATA_URL, caption: "back" },
    ]);
  });

  it("keeps a gallery photo's caption when the legacy `photo` is the same image", async () => {
    const kv = memKv();
    const legacy = {
      ...visit(),
      photo: DATA_URL,
      photos: [{ src: DATA_URL, caption: "the Louvre" }],
    } as unknown as StoredVisit;
    const { visit: back } = await hydrateVisit(legacy, kv);
    expect(back.photos).toEqual([{ src: DATA_URL, caption: "the Louvre" }]);
  });
});

describe("resilience", () => {
  it("drops a ref whose blob is missing rather than surfacing a broken image", async () => {
    const kv = memKv();
    const stored: StoredVisit = { ...visit(), photos: [{ id: "gone", caption: "x" }] };
    const { visit: back } = await hydrateVisit(stored, kv);
    expect(back.photos ?? []).toEqual([]);
  });

  it("referencedPhotoIds lists the blob ids a record depends on", async () => {
    const kv = memKv();
    const stored = await dehydrateVisit(visit({ photos: [{ src: DATA_URL, caption: null }] }), kv);
    expect(referencedPhotoIds(stored)).toEqual([stored.photos![0]!.id]);
    expect(referencedPhotoIds(visit() as unknown as StoredVisit)).toEqual([]);
  });
});

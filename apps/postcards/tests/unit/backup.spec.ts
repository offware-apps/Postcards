import { describe, it, expect } from "vitest";
import { serializeFile } from "../../src/features/backup/exportJson";
import { importFile } from "../../src/features/backup/importJson";
import { normalizeVisitPhotos, type Visit } from "../../src/lib/schema/models";

function visit(): Visit {
  return {
    visitId: crypto.randomUUID(),
    place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
    date: "2019-08-12",
    note: "first trip",
    status: "visited" as const,
    favorite: false,
    addedAt: new Date().toISOString(),
  };
}

describe("backup round-trip (SC-003)", () => {
  it("export -> import restores identical visits", () => {
    const original = [visit()];
    const text = serializeFile(original);
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visits).toEqual(original);
  });
});

describe("postcard photos", () => {
  const dataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("accepts a legacy inline photo and migrates it into the gallery on import", () => {
    const original = [{ ...visit(), photo: dataUrl }];
    const text = serializeFile(original);
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Legacy single `photo` is migrated to `photos[0]` (import normalizes to v3).
      expect(result.visits[0]!.photo).toBeUndefined();
      expect(result.visits[0]!.photos).toEqual([{ src: dataUrl, caption: null }]);
    }
  });

  it("rejects a photo that is an external URL (privacy: photos must be inline)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [{ ...visit(), photo: "https://evil.example/track.png" }],
    });
    expect(importFile(text)).toMatchObject({ ok: false });
  });

  it("migrates a legacy single `photo` into the `photos` gallery", () => {
    const legacy: Visit = { ...visit(), photo: dataUrl };
    const migrated = normalizeVisitPhotos(legacy);
    expect(migrated.photo).toBeUndefined();
    expect(migrated.photos).toEqual([{ src: dataUrl, caption: null }]);
  });

  it("round-trips a multi-photo gallery with captions", () => {
    const original: Visit[] = [
      { ...visit(), photos: [{ src: dataUrl, caption: "the monument" }, { src: dataUrl, caption: null }] },
    ];
    const result = importFile(serializeFile(original));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.visits[0]!.photos).toHaveLength(2);
      expect(result.visits[0]!.photos![0]!.caption).toBe("the monument");
    }
  });

  it("rejects a gallery photo whose src is an external URL", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      visits: [{ ...visit(), photos: [{ src: "https://evil.example/track.png" }] }],
    });
    expect(importFile(text)).toMatchObject({ ok: false });
  });
});

describe("import security (SC-008, Constitution VI)", () => {
  it("rejects malformed JSON", () => {
    expect(importFile("{not json")).toMatchObject({ ok: false });
  });

  it("rejects a file without the format marker", () => {
    expect(importFile(JSON.stringify({ visits: [] }))).toMatchObject({ ok: false });
  });

  it("rejects valid-JSON non-objects gracefully (null, string, array)", () => {
    // Regression: `JSON.parse("null")` parses fine, and reading `.format` off it
    // used to throw an uncaught TypeError instead of returning { ok: false }.
    expect(importFile("null")).toMatchObject({ ok: false });
    expect(importFile('"postcards"')).toMatchObject({ ok: false });
    expect(importFile("[]")).toMatchObject({ ok: false });
  });

  it("rejects a place name that sanitizes to empty (invisible characters only)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [
        {
          visitId: crypto.randomUUID(),
          place: { kind: "city", id: "x", name: "\u200b\u202e", countryId: "FR" },
          date: null,
          note: null,
          status: "visited" as const,
          favorite: false,
          addedAt: new Date().toISOString(),
        },
      ],
    });
    // A lone U+200B + U+202E passes min(1) on the raw input but sanitizes to "" — accepting it
    // would poison the store with a file that can never round-trip.
    expect(importFile(text)).toMatchObject({ ok: false });
  });

  it("rejects a newer schema version", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 99,
      exportedAt: new Date().toISOString(),
      visits: [],
    });
    expect(importFile(text)).toMatchObject({ ok: false });
  });

  it("rejects unknown keys (strict)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [],
      malicious: { __proto__: { polluted: true } },
    });
    expect(importFile(text)).toMatchObject({ ok: false });
  });

  it("rejects unknown keys inside a nested place object (strict)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [
        {
          visitId: crypto.randomUUID(),
          place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR", evil: 1 },
          date: null,
          note: null,
          status: "visited" as const,
          favorite: false,
          addedAt: new Date().toISOString(),
        },
      ],
    });
    expect(importFile(text)).toMatchObject({ ok: false });
  });

  it("merges duplicate places on import (FR-015)", () => {
    const mk = (note: string) => ({
      visitId: crypto.randomUUID(),
      place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
      date: null,
      note,
      status: "visited" as const,
      favorite: false,
      addedAt: new Date().toISOString(),
    });
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [mk("first"), mk("second")],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.visits).toHaveLength(1);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("keeps one visit per visitId, as the keyed store does (last wins)", () => {
    const mk = (id: string, name: string) => ({
      visitId: "same",
      place: { kind: "city", id, name, countryId: "FR" },
      date: null,
      note: null,
      status: "visited" as const,
      favorite: false,
      addedAt: new Date().toISOString(),
    });
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [mk("paris-fr", "Paris"), mk("lyon-fr", "Lyon")],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.visits.map((v) => v.place.name)).toEqual(["Lyon"]);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("accepts a legacy Place'Been file (format: placebeen) for backward compatibility", () => {
    const text = JSON.stringify({
      format: "placebeen", // pre-rename marker
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [{ ...visit(), visitId: "legacy-1" }],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visits).toHaveLength(1);
  });

  it("accepts a non-UUID, hand-written visit id (portable/AI-friendly file)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [{ ...visit(), visitId: "00000000-0000-0000-0000-000000000001" }],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visits[0]!.visitId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("keeps formula-like content in notes as inert text", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      visits: [
        {
          visitId: crypto.randomUUID(),
          place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
          date: null,
          note: "=IMPORTXML(evil)",
          status: "visited" as const,
          favorite: false,
          addedAt: new Date().toISOString(),
        },
      ],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visits[0]!.note).toBe("=IMPORTXML(evil)");
  });
});

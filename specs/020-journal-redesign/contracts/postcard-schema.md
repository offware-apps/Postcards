# Contract: Postcard schema & portable-file compatibility

The portable JSON file is the public interface for external tools/agents (Principle VIII).
This contract fixes what changes and guarantees backward compatibility.

## Versioned change

- `SCHEMA_VERSION`: **12 → 13**.
- A file's `version` ≤ current still validates; `version` > current is rejected with the
  "made by a newer version" message (existing `importJson` guard). The bump exists so an
  older app rejects a v13 file gracefully rather than choking on unknown `.strict()` keys.

## Postcard (`Story`) object — additive/relaxing only

```jsonc
{
  "storyId": "…",                 // unchanged, required
  "place": { … PlaceRef … },      // NOW OPTIONAL (was required)
  "extraPlaces": [ { … PlaceRef … } ], // NEW, optional, ordered, max 23 (24 places total)
  "date": "2026-07-23",           // unchanged, required (start day)
  "endDate": "2026-07-27",        // NEW, optional/nullable; > date ⇒ range, else single-day
  "title": "…",                   // unchanged, optional
  "text": "…",                    // unchanged, optional
  "tags": ["☀️ sunny", "with Léa"],// NEW, optional, sanitized strings, max 24 × ≤40 chars
  "tripId": "…",                  // NEW, optional; reference to a Trip.tripId
  "folder": "…",                  // unchanged, optional
  "photos": [ { "src": "data:image/…", "caption": "…" } ], // unchanged
  "addedAt": "…", "updatedAt": "…"
}
```

## Guarantees

1. **Backward read**: any pre-v13 file (place always present, no new fields) validates and
   loads unchanged. No existing entry loses its place, date, title, text, folder, or photos.
2. **Forward round-trip**: a postcard using any new shape (place-less, multi-place, ranged,
   tagged, trip-linked) survives `export → import` and `zip archive → restore` byte-faithful
   (modulo photo re-inlining), verified by tests (SC-007, SC-011).
3. **Content rule preserved**: a postcard must still have title OR text OR ≥1 photo;
   place/tags/trip do not satisfy it. The zip-restore emptiness re-check still applies.
4. **Inert**: all new fields are parsed and sanitized, never executed; unknown keys rejected
   by `.strict()`; a dangling `tripId` never throws (resolved to "no trip").
5. **Aggregator**: no new field introduces reference data; a blank place mints nothing; tags
   are personal strings, not world facts.
6. **JSON Schema**: `portable-file.schema.json` is regenerated (`pnpm schema`) and its drift
   test updated, so external consumers see the new author-facing shape.

## Test obligations (unit)

- Place-less postcard: parses, round-trips, and is rejected only when it also has no content.
- Multi-place / ranged / tagged / trip-linked postcard: parse + export/import round-trip.
- Old-version file (v ≤ 12): still validates; new-shape fields simply absent.
- Newer-version file (v = 14): rejected with the update message.
- Sanitization: tag strings and place-less entries pass the security-focused import tests.

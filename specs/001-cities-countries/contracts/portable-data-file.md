# Contract: Portable Data File (`.postcards.json`)

The single portable file is the app's primary external contract: the unit of backup, restore, and
cross-device/website transfer, and the surface other tools/AI read. It MUST be human-readable JSON,
strictly inert (parsed, never executed), and validated against this schema on every import.

- **Media**: UTF-8 JSON. Suggested extension `.postcards.json`.
- **Versioning**: integer `schemaVersion` (starts at `1`). Newer-than-supported ⇒ refuse with a
  clear message; older ⇒ migrate forward, preserving data.
- **Source of truth**: this JSON Schema is *generated from the app's Zod models* and published so
  external tools can validate independently.

## JSON Schema (Draft 2020-12, informative copy)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://postcards/schema/postcards-file-v1.json",
  "title": "PostcardsFile",
  "type": "object",
  "additionalProperties": false,
  "required": ["format", "schemaVersion", "exportedAt", "visits"],
  "properties": {
    "format": { "const": "postcards" },
    "schemaVersion": { "type": "integer", "minimum": 1 },
    "exportedAt": { "type": "string", "format": "date-time" },
    "visits": { "type": "array", "items": { "$ref": "#/$defs/visit" } },
    "referenceSources": {
      "type": "array",
      "items": { "$ref": "#/$defs/referenceSource" }
    }
  },
  "$defs": {
    "placeRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "id", "name", "countryId"],
      "properties": {
        "kind": { "enum": ["country", "city"] },
        "id": { "type": "string", "minLength": 1, "maxLength": 64 },
        "name": { "type": "string", "minLength": 1, "maxLength": 200 },
        "countryId": { "type": "string", "pattern": "^[A-Z]{2}$" }
      }
    },
    "visit": {
      "type": "object",
      "additionalProperties": false,
      "required": ["visitId", "place", "addedAt"],
      "properties": {
        "visitId": { "type": "string", "format": "uuid" },
        "place": { "$ref": "#/$defs/placeRef" },
        "status": { "enum": ["visited", "wishlist"], "default": "visited" },
        "favorite": { "type": "boolean", "default": false },
        "date": { "type": ["string", "null"], "format": "date" },
        "note": { "type": ["string", "null"], "maxLength": 2000 },
        "addedAt": { "type": "string", "format": "date-time" }
      }
    },
    "referenceSource": {
      "type": "object",
      "additionalProperties": false,
      "required": ["dataset", "license", "version"],
      "properties": {
        "dataset": { "type": "string", "maxLength": 100 },
        "license": { "type": "string", "maxLength": 100 },
        "version": { "type": "string", "maxLength": 50 },
        "url": { "type": "string", "maxLength": 300 }
      }
    }
  }
}
```

## Example

```json
{
  "format": "postcards",
  "schemaVersion": 1,
  "exportedAt": "2026-07-01T12:00:00Z",
  "visits": [
    {
      "visitId": "5b3f2c9a-1e4d-4b0a-9c2e-0f7a1d2b3c4e",
      "place": { "kind": "country", "id": "FR", "name": "France", "countryId": "FR" },
      "date": "2019-08-12",
      "note": "first trip",
      "addedAt": "2026-07-01T11:59:00Z"
    },
    {
      "visitId": "9a1c7d20-6b8e-4a11-9f3c-2d5e6f708192",
      "place": { "kind": "city", "id": "2988507", "name": "Paris", "countryId": "FR" },
      "date": null,
      "note": null,
      "addedAt": "2026-07-01T11:59:30Z"
    }
  ],
  "referenceSources": [
    { "dataset": "naturalearth-admin0", "license": "Public Domain", "version": "5.1.1",
      "url": "https://www.naturalearthdata.com" },
    { "dataset": "geonames", "license": "CC-BY-4.0", "version": "2026-06",
      "url": "https://www.geonames.org" }
  ]
}
```

## Import rules (security-critical — Constitution VI)

1. Reject if not valid JSON or missing `format: "postcards"`.
2. Validate against the schema; reject on unknown keys or type errors.
3. Refuse a `schemaVersion` newer than supported; migrate older versions forward.
4. Treat every string as inert text: enforce length caps; strip control characters; never
   evaluate. A leading `= + - @` is kept as typed; the CSV export, which a spreadsheet opens,
   neutralizes it there with a leading `'`.
5. No field may trigger code execution, dynamic import, or a network fetch.
6. On any rejection, surface a clear, non-technical reason; never partially import silently.

## Markdown export (share format)

A human-readable, non-authoritative summary for sharing (not re-importable). MUST contain no
executable content. Suggested shape: a title, summary stats, and a table of visited places
(name, country, date). Details in `quickstart.md`.

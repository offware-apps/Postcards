# Contract: station dataset + place-type integration

## Dataset file — `public/reference/railways.json`

```jsonc
{
  "_source": {
    "dataset": "Wikidata railway stations (instance of Q55488)",
    "url": "https://query.wikidata.org/",
    "license": "CC0-1.0",
    "retrieved": "YYYY-MM-DD",
    "note": "Mainline stations; metro/tram excluded. (Dev fixture until `pnpm railways` runs.)"
  },
  "stations": [
    { "id": "Q…", "name": "…", "countryIso2": "FR", "subdivisionId": null, "lat": 0, "lon": 0 }
  ]
}
```

- Produced by `scripts/build-railways.mjs` (`pnpm railways`) where Wikidata is reachable.
- The app maps the `stations` array through the reference seam; `_source` records provenance.
- **Absent file** ⇒ `allStations()` is empty and every other place type is unaffected (FR-017).

## Portable-file compatibility

- `PlaceRef.kind` gains `"station"` (additive). `SCHEMA_VERSION` 13 → 14; JSON Schema regenerated.
- Older files (no station refs) validate and load unchanged; a `version > current` file is rejected
  with the existing "made by a newer version" guard.
- A station personal record `{kind:"station", id, name, countryId}` round-trips losslessly through
  export/import and the zip archive; it stays inert (parsed, never executed).
- A station ref whose id is absent from the bundled dataset still loads from its stored name/country.

## Guarantees

1. **Aggregator**: every station fact and per-country total is traceable to the dataset `_source`;
   the app authors none. The dev fixture is explicitly labeled as such.
2. **Offline**: search, mark, map, stats, journal, trip — all work with zero network (SC-001/008).
3. **Airport parity**: a station is searchable, markable, mappable, openable, and pickable exactly
   like an airport (visually distinct marker + glyph 🚉); no code semantics (QID, not IATA).
4. **Coverage rule**: a station contributes a per-country stations figure (heritage pattern) and a
   global KPI (airport pattern) but does NOT mark the country visited (airport transit rule).

## Test obligations

- **Unit**: reference load/index of the fixture; `stationById` (raw id, no upper-case);
  `searchStations` name match; `stationsOf` per-country; schema accepts a `station` kind + round-trip;
  older-version file still validates.
- **e2e**: offline search + mark a station (zero egress); Stations browse in Places; a station marker
  on the map; a station as a trip stop with a train leg; per-country stations coverage increments;
  a11y gate on the new surfaces; missing en/fr/ko station string fails the build.

# Phase 1 Data Model: Railway stations

## Reference entity: `Station` (new)

`src/lib/reference/types.ts` — matches `scripts/build-railways.mjs` output (NOT `Airport`).

```ts
export interface Station {
  id: string;          // Wikidata QID, e.g. "Q1234" — opaque, never upper-cased
  name: string;        // station name (reference data, own language)
  countryIso2: string; // ISO 3166-1 alpha-2
  subdivisionId: string | null; // admin-1 region id, or null (country-level coverage in v1)
  lat: number;
  lon: number;
}
```

### `ReferenceData` additions
- `allStations(): Station[]`
- `stationById(id: string): Station | undefined` — raw-id lookup (no upper-case)
- `searchStations(query: string, limit?: number): Station[]` — name-only prefix/contains (model on `searchHeritage`)
- `stationsOf(countryIso2: string): Station[]` — for per-country coverage (airports have no analog)

### Bundled file
`public/reference/railways.json` — `{ "_source": {…provenance…}, "stations": Station[] }`.
A **dev fixture** stands in until `pnpm railways` produces the authoritative Wikidata CC0 file.
Absent file ⇒ `allStations()` empty, everything else unaffected (FR-017).

## Personal model change: `PlaceRef.kind`

`src/lib/schema/models.ts` — enum gains `"station"`:

```ts
kind: z.enum(["country", "city", "airport", "heritage", "custom", "station"])
```

- **Additive**: older files (no station refs) validate unchanged; `SCHEMA_VERSION` 13 → 14
  (`src/lib/schema/helpers.ts`) with a v14 note; JSON Schema artifact regenerated (6 enum sites).
- `placeKey` (`${kind}:${id}`) is kind-agnostic — works unchanged.
- A visited/postcard/trip-stop `PlaceRef` for a station is `{ kind: "station", id, name, countryId }`
  (name is just the station name — no code suffix, unlike airports' `"Name (IATA)"`).
- **Self-contained**: `stampPlaceCoords` stamps a station's lat/lon onto the record at creation,
  so a station in an export self-locates even if the dataset later changes.

## Derived: per-country station coverage

`src/features/stats/computeStats.ts`:
- `Coverage.stationsVisited: number` — global count of distinct visited station ids (airport KPI pattern).
- `CountryCoverage` gains `stationTotal` / `stationVisited` — dataset total via `stationsOf(iso2)`,
  visited via the intersection with the user's visited station ids (heritage pattern).
- A station is **excluded** from `visitedCountryIds`/city bands/records (airport rule: transit ≠ visiting).
- Countries with no dataset stations show no station figure (no zero-of-zero noise).

## Coordinate resolvers (station branch added)
`travel/distance.ts`, `travel/myPlaces.ts`, `lib/reference/placeCoords.ts`,
`journal/StoryMap.tsx`, `backup/exportCsv.ts` — each resolves a `station` PlaceRef's coords via
`ref.stationById(id)`, so a station is a valid trip stop / map point / export row.

## Validation & migration
- New enum value is additive; no migration needed. Older files load unchanged.
- Import validates + sanitizes a station PlaceRef exactly like every other kind (inert).
- Export/import round-trips a station record losslessly (SC-006).

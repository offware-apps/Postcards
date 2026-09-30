# Quickstart: validating railway stations

Run from `apps/postcards/`. A **dev fixture** `public/reference/railways.json` stands in until
`pnpm railways` produces the real Wikidata CC0 dataset.

## Gate

```bash
pnpm typecheck          # tsc + en/fr/ko MessageKey parity
pnpm test               # vitest: reference/search/stats + schema round-trip (fixture)
pnpm schema             # regenerate portable-file.schema.json (station kind in 6 enums)
pnpm test:e2e           # Playwright + axe: offline search+mark, browse, map, trip, coverage
pnpm railways           # (where Wikidata is reachable) produce the real railways.json
```

## Scenario 1 — Find + mark a station offline (US1, SC-001)

1. Disable the network. Search a fixture station's name.
2. Expect: it appears with its country; mark it visited; it joins your visited places.
3. Confirm a network monitor records **zero** outbound requests.

## Scenario 2 — Map + Places browse (US2, SC-002/003)

1. Open the map → the station shows a marker **visually distinct** from cities/airports (🚉).
2. Places → **Stations** category lists stations with visited / want / not-been filtering.

## Scenario 3 — Per-country coverage (US3, SC-004)

1. Mark a station in a country → that country's stats show a **stations visited / total** figure,
   incremented. A country with no dataset stations shows no station figure. Visiting a station does
   **not** mark the country visited.

## Scenario 4 — Journal + trips (US4, SC-005)

1. Attach a station to a postcard via the place picker.
2. Add two stations as trip stops → a station→station leg is drawn + measured; set its transport to
   **train**.

## Scenario 5 — Portability & degradation (SC-006/007)

1. Export → re-import: a station record round-trips losslessly; a pre-feature backup loads unchanged.
2. Remove `railways.json` → no stations, **no errors**, every other place type works.

## Scenario 6 — Real data

1. On a networked machine, `pnpm railways` overwrites the fixture with the authoritative Wikidata
   CC0 dataset; real stations then appear everywhere with no code change.

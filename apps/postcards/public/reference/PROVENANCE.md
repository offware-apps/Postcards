# Reference data provenance

Every file in this directory is **aggregated from named, openly-licensed external
datasets** (Constitution I: the app authors no world facts). The canonical,
machine-readable provenance list ships inside the app at
`src/lib/reference/data/provenance.json` and is displayed in Settings; this file
mirrors it for people browsing the repository.

| File | Dataset | License | Version / retrieved |
|------|---------|---------|---------------------|
| `cities.json` | GeoNames city gazetteer (population ≥ 15,000, via all-the-cities) — <https://www.geonames.org> | CC BY 4.0 | all-the-cities 3.1.0 |
| `cities-all.json` | GeoNames full world gazetteer (via all-the-cities) — <https://www.geonames.org> | CC BY 4.0 | all-the-cities 3.1.0 |
| `subdivisions.json` | First-level regions: each city's GeoNames admin-1 code (<https://download.geonames.org/export/dump/cities500.zip>) and each code's GeoNames name (<https://download.geonames.org/export/dump/admin1CodesASCII.txt>), both retrieved 2026-09-30; France's 13 regions by their French names; a code GeoNames does not name keeps one from dr5hn countries-states-cities — <https://github.com/dr5hn/countries-states-cities-database> | CC BY 4.0 (GeoNames) / ODbL (dr5hn) | all-the-cities 3.1.0 + GeoNames 2026-09-30 + country-state-city |
| `airports.json` | OpenFlights (IATA-coded, aggregated from OurAirports) — <https://openflights.org/data.html> | ODbL 1.0 / OurAirports public domain | airport-data 1.0.1 |
| `heritage.json` | UNESCO World Heritage List — all 1,248 sites incl. 47th session (2025) — <https://whc.unesco.org/en/list/> | CC BY-SA 3.0 IGO — © UNESCO World Heritage Centre | 2025 list, retrieved 2026-07-11 |
| `landmarks.json` | Famous landmarks seed (full set via Wikidata build script) — <https://www.wikidata.org> | CC0 (facts) | seed |
| `languages.json` | Per-country spoken languages (via world-countries) — <https://github.com/mledoze/countries> | ODbL 1.0 | 5.1.0 |
| `article-names.json` | Common country names (Wikivoyage/Wikipedia article titles, via world-countries) — <https://github.com/mledoze/countries> | ODbL 1.0 | 5.1.0 |
| `experiences.json` | Postcards "Moments" — app-authored name/hint/emoji only; anchor coordinates aggregated from Wikidata (<https://www.wikidata.org>) / GeoNames (<https://www.geonames.org>); experience concepts attributed to UNESCO World Heritage (<https://whc.unesco.org/en/list/>), UNESCO Intangible Cultural Heritage (<https://ich.unesco.org/en/lists>) & Wikivoyage travel topics (<https://en.wikivoyage.org>). Per-item `sources` cite the specific record. | Mixed — name/hint/emoji CC0; Wikidata CC0; GeoNames CC BY 4.0; UNESCO CC BY-SA 3.0 IGO; Wikivoyage CC BY-SA 3.0 | V1 |

Country codes, continents and UN-member/territory status come from
`i18n-iso-countries` (MIT; ISO 3166-1 codes are public facts) and
`world-countries` (ODbL 1.0). The offline outline basemap lives in
`../basemap/` with its own `PROVENANCE.md` (world-atlas / Natural Earth,
public domain).

Personal data (visits, trips, stories, photos) is **never** stored here — it
lives in IndexedDB and the user's own portable export file only.

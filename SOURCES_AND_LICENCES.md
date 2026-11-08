# Sources and licences

Status: 8 November 2026. This file lists every external source that Sonnenpfad Stuttgart uses or ships, with the required credit. The application code is MIT-licensed ([LICENSE](LICENSE)); that licence does not cover the data, fonts, icons or services below.

## Data shipped in this repository

The prepared data in `dist/city/` (including `dist/city/routing/`, a read-only export of the server routing graph), `dist/data/`, `dist/dem/` and `services/profile-api-v1/*.json`, as well as the server routing graph itself, are derived from the [Fußgängeratlas Stuttgart](https://github.com/Reza-Bakhshi7/fussgaengeratlas-stuttgart) (Mohammadreza Bakhshi, data status 15 September 2026). Its [SOURCES_AND_RIGHTS.md](https://github.com/Reza-Bakhshi7/fussgaengeratlas-stuttgart/blob/main/SOURCES_AND_RIGHTS.md) holds the full evidence. All atlas sources and their credits:

| Source | Used for | Licence | Required credit |
| --- | --- | --- | --- |
| OpenStreetMap contributors, extract via [Geofabrik](https://download.geofabrik.de/europe/germany/baden-wuerttemberg.html) | walking network, routing graph, surface, buildings, trees, POIs (crossings, elevators, ramps, escalators, stairs, barriers, kerbs, benches, shelters) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © OpenStreetMap contributors, [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) |
| LGL Baden-Württemberg, [DGM1 and nDOM1](https://www.lgl-bw.de/Produkte/Open-Data/) | path elevations, slope, display terrain (`dist/dem/`), building and tree heights | [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0) | Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0 |
| Landeshauptstadt Stuttgart, Amt für Umweltschutz, [Lärmkartierung Stuttgart (INSPIRE)](https://opendata.stuttgart.de/de/dataset/laermkartierung) | noise theme | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Datenquelle: Landeshauptstadt Stuttgart, Amt für Umweltschutz – Lärmkartierung Stuttgart. The values are not legally binding. |
| LUBW, [Klimaatlas BW](https://www.klimaatlas-bw.de/download), landesweite Klimaanalyse, wind field 1,000 m | wind theme | [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0) | Datengrundlage: Klimaatlas BW der LUBW (www.klimaatlas-bw.de), Datenlizenz Deutschland – Namensnennung – Version 2.0, 2026 |
| BKG, [Verwaltungsgebiete 1:25 000 (VG25)](https://gdz.bkg.bund.de/index.php/default/verwaltungsgebiete-1-25-000-stand-31-12-vg25.html) | Stuttgart boundary and city mask | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | © [BKG](https://www.bkg.bund.de) (2026) CC BY 4.0, Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf |
| MobiData BW / NVBW, [Barrierefreiheit an Bahnhöfen und Haltestellen (BFRK)](https://mobidata-bw.de/dataset/daten-barrierefreiheit) | accessibility details of station elevators, ramps, escalators and stairs | [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0) | Datenquelle: MobiData BW / NVBW – Barrierefreiheit an Bahnhöfen (SPNV) und Bushaltestellen (ÖPNV), dl-de/by-2-0 |

Modification notice for all sources above: data were selected for Stuttgart, cleaned, segmented, joined to the walking network and processed into derived attributes (slope, shade, UTCI, combined noise level, relative wind exposure, accessibility classes) by the atlas and by this application. Shade, UTCI and wind are model results of this project, not official data.

Database licence: as a derived database of OpenStreetMap, the shipped data are made available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The credits and modification notices of the other sources continue to apply.

## Services used at runtime

| Service | Purpose | Terms and credit |
| --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org/) | vector base map, 3D buildings, map fonts | OpenFreeMap, © [OpenMapTiles](https://www.openmaptiles.org/), data © OpenStreetMap contributors (ODbL) |
| [OpenStreetMap tile server](https://operations.osmfoundation.org/policies/tiles/) | optional raster base map | © OpenStreetMap contributors; OSMF tile usage policy |
| [OpenTopoMap](https://opentopomap.org/about) | optional topographic base map | map style © OpenTopoMap ([CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)), data © OpenStreetMap contributors, SRTM |
| LGL Baden-Württemberg, digital orthophotos DOP20 (WMTS) | optional aerial image | LGL-BW (2026), dl-de/by-2-0, www.lgl-bw.de |
| [Photon](https://photon.komoot.io/) by komoot | address and place search | search data © OpenStreetMap contributors (ODbL) |
| [Open-Meteo](https://open-meteo.com/) | hourly weather | data under CC BY 4.0, credit Open-Meteo.com |
| [MET Norway](https://api.met.no/) | weather fallback | data under CC BY 4.0, credit MET Norway |
| [Google Fonts](https://fonts.google.com/) | DM Sans and Manrope (loaded, not shipped) | SIL Open Font License 1.1 |
| Sonnenpfad server (Oracle Cloud, own) | route calculation | own service, see [README](README.md#privacy-and-attribution) |

## Software and icons shipped in this repository

| Component | Licence | File |
| --- | --- | --- |
| MapLibre GL JS 6.12.0 | BSD-3-Clause | `dist/vendor/LICENSE-maplibre.txt` |
| three.js 0.169.0 | MIT | `dist/vendor/LICENSE-three.txt` |
| Google Material Symbols Rounded (`dist/icons/shade-material.svg`) | Apache License 2.0 | `dist/icons/LICENSE-material-symbols.txt` |
| POI symbols (`dist/icons/poi/`, `dist/poi-icons.json`), newly drawn for the atlas | CC0 1.0 | `dist/icons/poi/README.md` |
| Interface icons in `dist/icons/` (all except `shade-material.svg`), made by the author with ChatGPT | MIT with the code | — |

Python and Node packages used for building and the server are installed from their registries and keep their own licences (`package-lock.json`, `requirements-etl.txt`).

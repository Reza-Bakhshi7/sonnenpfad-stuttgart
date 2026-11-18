# Analysis in explore mode (for planners)

Open **Map layers (◫) → Analysis** in explore mode.

## Data

- Network: thesis working network (`Netz_Arbeitsbestand_Stadtbezirke`, Stuttgart Pedestrian Atlas), 63,012 sections,
  4,305 km, cut at the borders of the 23 districts. Export: `scripts/export_planner_data.py` → `dist/city/planner/`.
- Gradient: magnitude regardless of direction; non-stair values above 30 % are terrain-model errors and count as
  "no value" (328 sections).
- "No value" always means *not recorded*; it is never treated as "no". Every filter decides separately whether
  sections without a value are included.
- Coordinates are simplified to 0.5 m and given in EPSG:4326 (WGS 84).

## Filters

- Area: all of Stuttgart or any set of districts.
- Numbers (gradient, summer/winter shade, UTCI summer/winter, noise, wind exposure, path width, section length):
  greater than, less than, equal to, between.
- Categories (way type, stairs, surface quality, surface material, smoothness, wheelchair, lighting, handrail,
  tactile paving, ramp, access, bridge, tunnel): "only these" or "all except these", multiple choice.
- All filters apply together (AND). OR is not offered yet: in the planner interviews it should first become clear
  which questions need it; a later "filter group" would add it without making the simple case harder.
- The result shows the number of sections, their length and their share of the network in the selected area;
  the map shows exactly these sections (`check_planner_navigation.mjs` compares map filter and counts on all sections).
- The analysis is part of the link (`bezirke=…&filter=…`), so a shared link reproduces it.

## Export

CSV (UTF-8 with BOM, comma, one row per filtered section: segment id, atlas id, district, name, every attribute,
geometry as WKT, `crs` = EPSG:4326) and GeoJSON (RFC 7946, opens directly in QGIS; metadata in `sonnenpfad`).
Data under ODbL 1.0 (© OpenStreetMap contributors). GeoPackage is not offered: it would need a ~1 MB SQLite/WebAssembly
library and a looser Content-Security-Policy, while GeoJSON already loads in every GIS.

## Sub-districts (Stadtteile)

The city's open dataset "Kleinräumige Gliederung" (CC BY 4.0) contains 457 Stadtviertel covering the whole city
(they form 152 Stadtteile by their first three digits), but names for only 69 Stadtteile. `--subdistricts` cuts the
network at Stadtteil borders once a complete, named layer is available.

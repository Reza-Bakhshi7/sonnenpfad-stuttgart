# Sonnenpfad Stuttgart — Prototype 0.14.3

A sun/shade-aware pedestrian routing prototype developed by Mohammadreza Bakhshi and built from the [Stuttgart Pedestrian Atlas](https://github.com/Reza-Bakhshi7/fussgaengeratlas-stuttgart). German and English, desktop and mobile. Standard Direct routes use the Sonnenpfad HTTPS API backed by PostGIS/pgRouting on the Oracle server. Shade, Sun, custom and mobility profiles currently retain the browser engine. No paid routing API key is required.

Autor und Inhaber von Sonnenpfad Stuttgart und Fußgängeratlas Stuttgart ist Mohammadreza Bakhshi. Die Entwicklung erfolgte mit punktueller Unterstützung aus dem MobiData-BW-Team während seiner Tätigkeit als Werkstudent.

Production: <https://sonnenpfad-stuttgart.de/> (Cloudflare alias: <https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev/>)

Project rules are documented in [GOVERNANCE.md](GOVERNANCE.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [release process](docs/release-process.md). The current architecture and eight-step roadmap are in `docs/`.

## Run and deploy

Run `npm ci`, `npm run build`, and then serve `dist/` over HTTP (for example `python -m http.server 8080 --directory dist`). ES module workers do not run from `file://` URLs. Cloudflare Workers Static Assets uses `wrangler.jsonc`; `npm run deploy` performs a manual deployment. Cloudflare Builds should use `npm run build` as its build command and `npx wrangler deploy` as its deploy command.

Prepared application data is split into size-bounded static chunks so the browser can load it reliably and Cloudflare can cache it efficiently. Visual tiles and 3D shadow-obstacle tiles are separate, allowing 2D to avoid building and tree payloads. The routing and shadow worker remains embedded as a Blob. The original GeoPackage is a local, read-only pipeline input and is not committed.

## Included

- Full-municipality Stuttgart network, building footprints/heights and trees when the versioned city assets are published; robust pilot fallback otherwise.
- Direct, shade-preferring and sun-preferring Dijkstra routes with separate uphill/downhill treatment.
- Mobility presets for manual wheelchair, power wheelchair, cane/walker, blind or low-vision pedestrians and pushchairs. Known barriers are hard exclusions, unknown attributes remain routable but visible, and custom controls expose width, gradient, surface, stair, escalator and wheelchair restrictions. The exact assumptions are documented in [Step 5 routing profiles](docs/step5-routing-profiles.md).
- Photon-backed Stuttgart place/address search with explicit map picking and confirmed mobile endpoints.
- Changing date/time updates solar geometry, the 3D shadow display and route weighting. The solar compass responds immediately while the time slider is dragged; automatic time animation is intentionally disabled.
- Hourly Open-Meteo weather for a fixed Stuttgart reference point: condition, temperature, cloud cover, direct radiation, 10 m wind, forecast-valid time and retrieval time. Direct radiation transparently scales the optional sun/shade preference; details and limitations are documented in [Step 6 live weather](docs/step6-live-weather.md).
- A worker rasterizes shadow polygons for 3D rendering. The 2D map never requests or draws map-wide shadow rasters. A sun/shade route still computes exact shade values for a narrow route corridor, independently of the current 2D/3D view.
- An unrestricted, tree- and shadow-free 2D basemap and a locally generated 3D terrain surface with bounded visible-tile loading, hillshade, building extrusion and rounded height-aware tree crowns.
- Exactly one active atlas line theme for slope, surface, summer/winter shade, summer/winter UTCI, noise or relative wind exposure, each with a bilingual legend and explanation. Slope is the default; eligible segments receive at most one centred uphill arrow, while segments shorter than 24 m and colliding arrows are omitted.
- Ten switchable citywide accessibility and comfort POI categories: signal crossings, elevators, ramps, escalators, stairs, barriers/gates, lowered and raised kerbs, benches and shelters. Signal crossings keep one layer toggle but use the atlas's four accessibility colours and expose sound, vibration, tactile, wheelchair and kerb attributes in their detail popup.
- Display tiles are separated from heavier building/tree shadow tiles. 2D downloads only paths, themes and POIs; 3D loads the second payload lazily. Nearby buildings and rounded tree crowns receive progressively richer budgets, identical views are not rebuilt, and one exact shadow refresh runs only after the camera has settled.
- Elevation profile with absolute route heights, ascent and descent.
- DE/EN interface and explicit out-of-area feedback.

## Data pipeline

```bash
.venv-etl/bin/python scripts/run_etl.py /path/to/Fussgaengeratlas_Stuttgart.gpkg --scope city
npm run build
```

Requires Python with shapely, pyproj, NumPy, SciPy and Pillow. Input is read-only; it is not stored in the repository. The preparation step creates local `build_data/{meta,network,obstacles}.json`; `chunk_data.py` converts them into cacheable browser assets. `npm run build` embeds only the Web Worker and reconstructs the vendored MapLibre bundle. Bounds: 9.162–9.198 E, 48.765–48.790 N. Obstacle buffers extend beyond the routing area.

The script converts EPSG:25832 to WGS84, then to local equirectangular metres around Stuttgart for browser processing. Only geometric/data fields needed by the prototype are exported. It excludes explicit foot prohibitions and private/no access without explicit pedestrian permission, motorways, trunk roads, construction/proposed roads and indoor=yes.

`python scripts/generate_terrain.py` reconstructs static Mapbox Terrain-RGB tiles at zooms 12–14 from the DEM-derived elevation values at network endpoints. It uses 8-neighbour inverse-distance interpolation followed by light smoothing. Run it before `python scripts/bundle_app.py`; the generated tiles are written to `dist/dem/` and need no external terrain API.

For the browser routing profiles, every existing line vertex is a routing node. Exact coincident vertices connect; geometry-only intersections are not noded. No arbitrary network edges are inserted across gaps. Segment endpoint elevation and slope are inherited; elevation is interpolated along subedges. Source `atlas_id` is preserved per subedge.

## Scientific limitations

This is not a validated heat-risk, accessibility or navigation service.

- The displayed 3D surface is an interpolation of elevations sampled along the walking network, not the original continuous DEM and not a survey model. Visual terrain exaggeration is 1×. It should not be used to infer precise ground heights away from sampled streets.
- Geometric clear-sky shadows still assume flat ground, simplified vertical building prisms and spherical opaque tree crowns. Building heights include source estimates. Clouds do not alter geometry; hourly direct radiation only scales raster opacity and the optional routing preference. Terrain occlusion, reflected radiation and thermal inertia are not modelled.
- Tree heights fall back to 8 m when absent; radius falls back to 2 m (minimum 1 m). April–October is the simplified leaf-on season; winter shade includes only trees explicitly classified evergreen. This is not phenology.
- At solar elevations ≤2°, shade geometry is disabled; the UI suppresses percentage and uses direct weighting. Night is not represented as a sun/shade choice.
- The selected instant applies to the whole route. Time-dependent arrival along a route is not modelled. Finite obstacle buffers can underestimate long shadows near the pilot edge.
- Network centre lines can differ from actual sidewalks. Existing coincident vertices can still contain topology issues, especially at multi-level structures. Live access, closures and entrance availability are not verified.
- Points search nearby network components within 30 m and use the closest component reachable from both endpoints. Dashed access lines make the short snap explicit and are excluded from route length; larger gaps are rejected instead of being bridged by an invented straight line.
- Walking time assumes 75 m/min plus 1 minute per 10 m of ascent. Elevation/slope inherit the atlas's uncertainties.
- Shade/sun preference uses `length * (1 + 1.6 * undesired_exposure * solar_weight)`, where `solar_weight = clamp(direct_radiation / 500 W/m², 0, 1)` when a matching forecast hour exists and 1 otherwise. Mobility and safety rules are not weakened. This is a prototype heuristic, not a heat-risk model.
- Live values are an hourly model forecast for one central-Stuttgart point, not station measurements or street-canyon conditions. No SOLWEIG or turn-by-turn guidance is included. The displayed UTCI line themes remain atlas snapshot indicators, not live measurements or individual heat-risk advice.

## Oracle Direct routing

The standard Direct profile uses the audited Atlas network, matched against the local OSM reference from 2026-08-30T20:21:06Z, with 216,937 currently routable pieces. Connectivity follows OSM node identifiers, preserving distinct levels and excluding unresolved matches. The API snaps to the nearest walkable edge within 50 m and splits it for partial start/end routes. The response includes oriented original Atlas attributes; heights are interpolated along source segments, not new DEM measurements. The browser evaluates geometric shade along this actual route using the selected date/time. Unknown elevations and shadow payload failures remain unknown. Other profiles have not yet migrated to the server.

## Verification

`node scripts/check_engine.mjs` checks solar direction/elevation, a known shadow geometry, route continuity, varied sun/shade route choices, edge snapping, automatic fallback from isolated fragments, the elevation profile and out-of-area rejection. Recorded results are in `scripts/verification.json`. Static source/asset checks were also run. Browser rendering and device-specific WebGL performance have not yet been verified in this environment. Optional WebMCP state read-back is feature-detected; supported-browser registration validation was unavailable.

Pull requests and pushes to `main` run `npm test` in GitHub Actions. Operational smoke tests and rollback instructions are documented in [`docs/operations-runbook.md`](docs/operations-runbook.md).

## Privacy and attribution

Standard Direct routes transmit selected start and destination coordinates to the Sonnenpfad server at https://138.2.184.1 over HTTPS. Those coordinates may originate from clicked map points, selected addresses or a device location explicitly requested by the user. Shade, Sun, custom and mobility routes currently run locally in the browser. Location is requested only after a click. Shared URLs contain selected coordinates. External basemap providers receive tile requests (and associated IP/request metadata); Google Fonts is currently used with system-font fallback. Open-Meteo receives a fixed Stuttgart coordinate, never route endpoints or device location. No analytics, accounts or advertising.

Base map: OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors. Weather: Open-Meteo, data under CC BY 4.0. MapLibre GL JS 5.6.2 is vendored under its BSD-3-Clause licence, see `dist/vendor/LICENSE-maplibre.txt`. Atlas-derived data retains its original source obligations; the code licence does not relicense geodata. The input package's full source documentation remains authoritative.

## Next useful increments

1. Inspect the pilot visually and validate a few known route/shadow cases in the field.
2. Replace the interpolated display terrain with an authoritative raster DEM when redistribution and hosting terms are confirmed; audit sidewalk alignment and topology.
3. Validate weather-aware route choices against representative clear and overcast days; decide whether animated spatial cloud rendering adds enough value for its performance cost.
4. Add a user detour budget and expand coverage after performance measurements.


# Changelog

## Unreleased — server-only routing (preview)

- Stage 2 routes every profile and option on the Oracle server (in-memory engine, equal to the reviewed pgRouting engine, 0.3–0.7 s per route) and includes 2,118 atlas ways (217 km) that were missing from the server graph, e.g. Augustenstraße.
- Sun/shade routing and route shade shares on the server with the browser's shadow model (identical values on a real tile).
- Preview hosts route only on the server, without browser fallback; production switches only after Stage 2 declares production readiness (docs/server-routing-release.md).
- Stage 2 queues up to two concurrent routes, Nginx allows the production origins on /profile-v2/.

## 0.14.3 — 3 November 2026

- The About dialog shows the release version without the "VORSCHAU" label that shipped with 0.14.2.

- Browser routing no longer uses ways that the audited server graph blocks in both directions (21,670 of 248,725 edges: e.g. access=private, foot=no, foot=use_sidepath, motorroads, gates). The block list is exported read-only from `routing.walk_edges` (`scripts/export_access_blocks.py`, `scripts/access_blocks.mjs`) and applies to every profile without relaxation; 193 ambiguous edges stay open.
- Known remaining difference: atlas ways without a confident OSM match (about 217 km) are missing from the server graph, so server routes can be longer than browser routes.

## 0.14.2 — 3 November 2026

- Use Bordstein/Bordsteine throughout the German interface.
- Keep route results concise; remove snap diagnostics, profile exaggeration text and weather-weight labels.
- Route notices for mobility profiles name every unknown suitability share (surface, gradient, wheelchair suitability) in percent; unknown sections are never shown as suitable.
- Fix: a bench or shelter at 0 m no longer receives the maximum walking-aid/pushchair penalty.
- The vision profile states that crossings without equipment data are not penalised; the walking-aid description names the escalators it avoids.
- Restrict Explore selection to Atlas paths and POIs; buildings and trees are display-only.
- Show = before walking time and simplify bilingual About text.
- Identify Mohammadreza Bakhshi as author and owner; keep the MobiData BW acknowledgement in the repository.
- Preview only: preview hosts with `?profileApi=v2` send balanced Standard, Wheelchair and Power wheelchair routes to the Stage-2 profile API, with a labelled browser fallback. Production hosts never call it; Standard Direct routes keep the API 0.2 path.


## 0.14.1 — mobile review corrections (preview)

- Replace implicit endpoint changes with a one-shot centre-and-confirm mobile picker and locked markers.
- Combine weather, route sheet and replay/profile into a single mobile dock, with explicit route editing.
- Fix metric collisions and replay wrapping; use compact h:mm values and SVG controls.
- Restore a padded readable linear relief profile with axes; isolate one selected building footprint.
- Use the complete existing local terrain pyramid in 3D, with native grounding and subtle hillshade.

## 0.14.0 — App 09 preview, 2026-10-27

- Decode signed slope directions correctly: descending bytes are -1, not 255.
- Retain compressed LGL aerial tiles with bounded memory/disk caches and preserve loading parents during zoom.
- Remove implicit touch long-press endpoint placement; keep explicit pickers and desktop double-click.
- Enlarge mobile controls and scrollable sheets while preserving the labelled layer selection.
- Add replay pause/stop and ×1/×2/×4, a heading arrow and synchronized profile cursor/readout.
- Use linear metric profile scales with explicit vertical exaggeration and preserve missing-height gaps.
- Format long walking times in hours and minutes, translate documented POI enums, and highlight selected features.
- Link the public Atlas repository in About and documentation.
- Preview only: main, Oracle services and routing contracts are unchanged.

## 0.13.1 — custom-domain deployment repair, 2026-10-27

- Document sonnenpfad-stuttgart.de as the production domain.
- Supply a guarded Oracle Nginx CORS repair for the exact custom-domain origin, with backup, configuration validation and rollback.
- Keep the existing direct HTTPS API contract and staged profile API separate; no insecure TLS or wildcard CORS workaround.
- Make the historical weather-cache regression fixture use its fixed test clock consistently.

## 0.13.0 — terrain, direct shadow frames and metric audit, 2026-10-15

- Restore static coarse terrain in 3D; place tree trunks at immutable sampled ground heights.
- Use one compact right-hand icon dock and remove the duplicate Explore sidebar.
- Transfer shadow bitmaps directly with latest-frame backpressure, retaining visible contrast under clouds.
- Fix same-edge weighted-route shortcuts and zero-length one-way endpoint connections.
- Do not invent missing elevations or report complete travel times from partial heights; label time as estimated.
- Add restrictive public-asset headers, credential-signature checks and reproducible independent metric audit.


## 0.12.0 — preview, 2026-10-14

- Separate lean Routing from click-only Explore, with on-demand theme, POI and detail data.
- Render Direct server responses immediately; skip shadow loading for Balanced routing.
- Replace display DEM and custom building geometry with flat native vector buildings; retain Atlas calculation inputs.
- Use warm beige buildings, lighter optional shadows and opaque coloured sphere crowns with corrected scene handedness.
- Generate minimal tree files and revisioned detail shards at build time; retain nearby trees during progressive loads.
- Make repeated view switches and trip replay independent of optional data/elevation requests.
- Add a centrally cached weather endpoint with Open-Meteo/MET Norway fallback and retained client cache.
- Add style validation and regression coverage for modes, stale responses, physical tree bounds, replay, cache and weather.


All notable product changes are documented here. The project follows semantic versioning while it remains an experimental prototype.

## [Unreleased]

- Correct instanced trunk lengths to use crown height relative to the ground, preventing hundreds-of-metres vertical spikes. Test the transformed cylinder bounds.

- Fix the ESM startup guard: an imported MapLibre namespace no longer requires a window global. Only actual GPUInitializationError failures show the WebGL notice; module/configuration errors no longer misidentify the device.

- Move city buildings, spherical tree crowns/trunks and the 3D route into one cached Three.js scene using local metre coordinates. Crowns remain 30% smaller and slightly translucent, with a shared smooth sphere mesh and depth writes.
- Read object and route heights directly from immutable Terrain-RGB assets. Failed tile loads retain existing geometry and retry; the renderer's temporary elevation value 0 is never used for object placement.
- Upgrade self-hosted MapLibre to 6.12.0 with matching ESM modules, worker and stylesheet. Pin Three.js 0.169.0; lazy-load it on first 3D entry. Vendor chunks are checked against SHA-256 at build time.
- Keep terrain alive across 2D/3D switches, freeze automatic grounding during transitions, preserve the map centre and remove redundant camera writers. Replay uses an animated introduction and explicit sampled elevations at 12 m intervals.
- Build building geometry in short batches and reuse spatial GPU batches and cached tree instances. Preserve building courtyards and extend walls correctly on sloping terrain.
- Place the time/weather toolbar closer to the lower edge with a measured 10 px gap above collapsible map credits.
- Exploration mode separates map gestures from route endpoint picking; explicit endpoint tools retain routing. Elevation-chart hover/keyboard markers follow the corresponding route position.
- Current Stuttgart time on entry; translated, consistently sourced basemap names; compact custom settings and weather details; small single-column map controls; destination confirmation toast removed.
- Stair tread styling only on the slope theme. Camera-clipped city boundary uses stable asset-derived heights, not transient rendered DEM queries.
- Browser graph loading deferred until needed. Pending tile fetches deduplicated and concurrency bounded.
- Shared directed profile costs and API 0.3 request/capability contract prepared; API 0.2 remains standard Direct only. Server installation and real-browser WebGL acceptance remain outstanding.


## [0.10.0] - 2026-10-13

- Standard Direct walking routes use the Oracle-hosted PostGIS/pgRouting API 0.2 over HTTPS, with audited OSM node topology and pedestrian access rules.
- Directed route-piece metadata preserves partial-segment heights and original Atlas attributes. Missing heights suppress the elevation profile instead of inventing values.
- The geometric shadow model evaluates the returned route for the selected time. Shade, Sun, custom and mobility routes still use the browser engine.
- Superseded server requests are cancelled and stale responses cannot replace a newer route. Service failures are shown without silently falling back to the old graph.
- Privacy text explains that standard Direct route endpoint coordinates are transmitted to the Sonnenpfad server. Added adapter, worker and UI cancellation checks.
- Rollback baseline: commit 3bb1004761d2c6fad82a40c794d2f21d351e4e3b; revert PR #10 to restore browser-only routing through Cloudflare Builds.


- 2D tree polygons removed completely; tree crowns are now a 3D-only layer, eliminating a major GeoJSON/rendering cost during ordinary map use.
- Slope arrows limited to one centred marker per eligible atlas segment, omitted below 24 m, collision-aware, thinner and longer.
- Selected routes changed to a high-contrast red line at twice the previous width with a wider white halo.
- Faster interaction pipeline with 384 px simplified shadow previews and a delayed exact 1,024 px refresh after movement stops.
- Atlas-faithful four-class signal-crossing display: good, partial, no documented support and unknown/incomplete, using the original green/yellow/red/grey colours.
- Signal-crossing detail popups for audible and vibration signals, tactile paving, wheelchair suitability, kerb form and button operation; the layer selector remains a single crossing toggle.
- City data contract version 5 with compact crossing-accessibility attributes and verified class totals (702 / 1,216 / 251 / 2,092).
- Step 5 profile engine with hard exclusions for known stairs, escalators, poor surfaces, explicit wheelchair prohibitions, narrow ways and profile-specific gradient limits.
- Dedicated blocked-profile feedback instead of misclassifying restricted routes as outside the network.
- Profile-aware travel-time assumptions and route diagnostics for maximum gradient, attribute coverage, known minimum width, surface quality, stairs and escalators.
- Advisory 12 m route-corridor reporting for barriers and raised/lowered kerbs; unlinked point POIs are not misused as hard graph restrictions.
- Custom hard restrictions for poor surfaces, `wheelchair=no`, minimum width and maximum known gradient, including share-link persistence.
- Step 5 synthetic regression suite and real 248,725-edge city audit.
- Step 4 preview: mutually exclusive line themes for slope, surface, summer/winter shade, summer/winter UTCI, noise and relative wind exposure.
- Ten independently switchable accessibility and comfort POI categories with 13,179 citywide features.
- Dynamic bilingual legends and shareable theme/POI state.
- Mandatory slope-by-default thematic display with thicker lines, signed uphill arrows and hover explanations.
- Compact time animation with 1×, 4× and 12× playback.
- Continuous `requestAnimationFrame` time playback with immediate solar-compass updates while dragging or playing.
- Fast 384 px simplified shadow previews during interaction; pausing performs the exact 1,024 px route-aware calculation.
- Silent background shade refreshes: moving the map no longer changes the route button or route status.
- Font-independent, embedded grey uphill-arrow icons for reliable slope-direction rendering.
- Balanced 3D level of detail with reduced tile, building and rounded-tree budgets, duplicate-view suppression and no duplicate delayed reload after mode switching.
- Bounded 1,024 px final shadow rasters for faster interactive updates.
- Full-Stuttgart data pipeline and coverage with visual-data contract version 5.
- Live weather and public-transport adapters.
- Extended accessibility and restriction profiles.

## [0.7.0] - 2026-09-18

### Added

- Cloudflare Workers Static Assets deployment from the private GitHub repository.
- Chunked, cacheable atlas data and locally hosted terrain tiles.
- Direct, shade and sun routing with slope and stair preferences.
- Automatic network snapping and visible access lines.
- Elevation profile with ascent and descent.
- 3D terrain, buildings and height-aware tree crowns.
- German and English interface.
- Automated engine verification in GitHub Actions.

### Changed

- Clear device-specific message when WebGL is unavailable instead of reporting a data-loading failure.

### Known limitations

- Coverage is limited to the Stuttgart-Mitte pilot.
- Weather, cloud attenuation, UTCI and public-transport positions are not live in 0.7.0.
- The display terrain is interpolated from network elevation samples.


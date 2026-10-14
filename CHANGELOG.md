# Changelog

All notable product changes are documented here. The project follows semantic versioning while it remains an experimental prototype.

## [Unreleased]

- Exploration mode separates map gestures from route endpoint picking; explicit endpoint tools retain routing.
- New 3D route playback and elevation-chart hover/keyboard position marker.
- Current Stuttgart time on entry; translated, consistently sourced basemap names; compact custom settings and weather details; measured attribution clearance.
- Stair tread styling only on the slope theme. 3D viewport coverage replaces arbitrary tile/building caps, with a bounded minimum 3D zoom.
- Shared smooth sphere meshes replace stacked canopy slices. Camera-clipped screen boundary masks terrain/imagery outside Stuttgart, with a centre-visibility guard.
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

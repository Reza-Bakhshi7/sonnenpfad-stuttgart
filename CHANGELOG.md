# Changelog

All notable product changes are documented here. The project follows semantic versioning while it remains an experimental prototype.

## [Unreleased]

- Step 4 preview: mutually exclusive line themes for slope, surface, summer/winter shade, summer/winter UTCI, noise and relative wind exposure.
- Ten independently switchable accessibility and comfort POI categories with 13,179 citywide features.
- Dynamic bilingual legends and shareable theme/POI state.
- Mandatory slope-by-default thematic display with thicker lines, signed uphill arrows and hover explanations.
- Compact time animation with 1×, 4× and 12× playback.
- Continuous `requestAnimationFrame` time playback with immediate solar-compass updates while dragging or playing.
- Fast 512 px shadow previews during interaction; pausing performs the exact 1,024 px route-aware calculation.
- Silent background shade refreshes: moving the map no longer changes the route button or route status.
- Font-independent, embedded grey uphill-arrow icons for reliable slope-direction rendering.
- Balanced 3D level of detail with reduced tile, building and rounded-tree budgets, duplicate-view suppression and no duplicate delayed reload after mode switching.
- Bounded 1,024 px final shadow rasters for faster interactive updates.
- Full-Stuttgart data pipeline and coverage with visual-data contract version 4.
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

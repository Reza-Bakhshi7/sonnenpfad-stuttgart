# Changelog

All notable product changes are documented here. The project follows semantic versioning while it remains an experimental prototype.

## [Unreleased]

- Full-Stuttgart data pipeline and coverage.
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


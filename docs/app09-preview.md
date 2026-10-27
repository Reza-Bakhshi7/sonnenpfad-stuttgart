# App 09 — 0.14.0 preview

The public Atlas is at https://github.com/Reza-Bakhshi7/fussgaengeratlas-stuttgart . The App repository remains private.

## Corrections

The display asset builder read signed direction bytes through unsigned Buffer indexing. A stored -1 became 255, so descending geometries were not reversed. It now uses readInt8. The original QGIS arrow_angle convention agrees with uphill direction: checked original ascending and descending geometries and heights; no blanket reversal or changes to routing slopes.

Aerial imagery keeps its official WMTS endpoint and GoogleMapsCompatible matrices 0–20, as advertised by GetCapabilities on 27 October 2026. A separate compressed-image cache survives GPU tile eviction: 128 mobile / 256 desktop entries, at most 24 MiB total in memory (12 MiB raw + 12 MiB resolved), optional bounded CacheStorage with seven-day freshness. CacheStorage failures fall back to network. Failed fetches do not poison cache. GPU caches are capped at 96 mobile / 192 desktop tiles per source. Ancestor requests are retained while zooming. A real Stuttgart sample on zooms 17 and 18 returned a solid-white 256×256 JPEG (HTTP 200, 1,651 bytes), while zooms 14, 16 and 19 showed imagery. Tiny white responses are decoded and checked and evicted from the raw cache; the loader crops the geographically correct parent quadrant, up to six levels. Derived tiles have a short memory lifetime and are never written to persistent cache; original responses retain the ordinary bounded cache. This is a cache, not an offline-map guarantee.

Touch holds and double taps no longer place endpoints; use the existing explicit A/B pickers. Two-finger gestures remain owned by MapLibre. Desktop double-click remains available. Mobile route sheet, theme controls, popup content and touch target sizes are improved without replacing the labelled layer UI.

Replay runs at the previous base preview speed of 18 m/s (not walking speed), with continuous ×1/×2/×4 changes, pause/resume and stop. A blue heading arrow follows the route. The profile cursor and distance/elevation readout follow it. Mouse hover, touch drag and keyboard arrows/Home/End control the same profile cursor outside replay.

The profile is linear in metres, with a default 2× vertical exaggeration. Routes exceeding the available relief reduce that factor to fit and display the actual factor. A 5% grade has the same display tangent across route lengths while that scale fits. This is a labelled profile display, not an assertion that screen angles are real terrain angles. Missing heights stay gaps; original elevation and route cost values are not modified.

Selection is maintained in its own GeoJSON source so a clicked displayed segment remains highlighted while details load. Full path coordinates are recovered from the cached path shard, rather than keeping a tile-clipped rendered fragment. Closing the popup, changing language/mode or selecting another feature clears/replaces it. Documented categorical material/access/surface/direction values are translated; proper names and free text remain source text.

## Verification

- Full existing npm test suite plus App 09 regressions.
- All regenerated signed display flags checked against original direction bytes, including 120,088 negative-direction records (records include tile duplication).
- Original QGIS/GeoPackage ascending and descending arrow examples agree with uphill convention.
- Metric scale invariance, missing-height gaps, hour formatting, cache bounds/deduplication/retry and independent buffers tested.
- Actual touch handlers, replay pause/x2/x4/cancel and selection popup replacement/close executed in isolated UI fixtures.
- Mobile menu inspected at 390 px viewport width. Actual downloaded white/real JPEGs and cropped-parent encoding passed an in-browser image regression without WebGL. The cloud browser lacks WebGL, so real 2D/3D rendering, touch rotation and image continuity on a device remain unverified.

No Oracle installation, production service switch or migration to the staged profile API is included. Do not merge/deploy main until the user approves the preview.

## Preview routing isolation

The new preview Origin receives no Access-Control-Allow-Origin from the legacy Oracle API (diagnostic route returned HTTP 200). Therefore the exact App 09 alias and Cloudflare version preview hosts use the existing browser engine, visibly labelled in route results and About. Both production hostnames keep the existing Oracle path. This enables UI/profile/replay review without a VM/CORS change; preview routes are not evidence of Oracle parity. No insecure request or TLS change is included. A local diagnostic required curl --insecure because the assistant network's certificate did not cover the IP; that diagnostic is not a browser TLS verification.

## 0.14.1 mobile review corrections

- A centre-and-confirm mobile pick transaction replaces map tap placement. It consumes the active picker once; arbitrary taps and double clicks do not replace established endpoints. Markers are not draggable. Desktop users use explicit A/B pickers.
- A single fixed mobile dock combines a compact expandable weather strip, a scrollable route sheet, a route summary and visible replay/profile controls. A separate edit action reveals route fields. The sheet handle supports click and vertical drag; scrolling content is not treated as a map gesture.
- Preview buttons are one row of SVG pause/play, stop and ×1/×2/×4; no duplicate full-width stop button. Long duration metrics use h:mm with an explicit h:min label and independent metric columns.
- Profile axes remain linear, using relief plus padding rather than the overly flat fixed 2× scale. Distance and elevation labels are visible; vertical exaggeration is stated. Missing heights stay gaps.
- Building MultiPolygons are narrowed to one containing/nearest footprint before selection rendering. Explore uses the normal pointer; Ctrl camera gestures use a hand.
- Native terrain uses the complete existing local zoom pyramid 12–14, 1× heights, subtle hillshade and a 55° entry pitch. No new DGM1 provenance is claimed.

Validation includes a repeated confirmation/route-lock regression, real selection geometry, metric formatting, native terrain source/style contracts, source heightfield checks, and mobile layout fixtures at 320/390 px. Layout fixtures are excluded from deployment. No full real-device or WebGL rendering pass is claimed in this environment.

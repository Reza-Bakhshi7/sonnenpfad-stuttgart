# Fast 3D display, version 0.12

The display and calculation datasets have different jobs. The 3D view is a flat
map with streamed OpenFreeMap/OpenStreetMap buildings and Atlas tree crowns.
There is no `setTerrain`, DEM decoding, camera grounding or per-building geometry
construction in the display path. Atlas elevations, routing arrays and original
shadow obstacles remain unchanged. Visible building heights are approximate
OpenMapTiles display heights; they never replace Atlas calculation heights.

## Rendering

MapLibre 6.12 renders native `fill-extrusion` buildings from the basemap's existing
vector source. Beige colour, low light contrast and no vertical gradient keep
walls readable. `hide_3d` outlines are excluded to avoid overlapping building
parts. Buildings remain visible from zoom 13, independently of Atlas theme tiles
and tree detail thresholds. Zooming out no longer removes all city geometry at
14.45. OSM source gaps are still possible; this is not a guarantee of measured
building completeness.

Three.js 0.169 renders only sphere crowns and trunks. North-positive local metre
coordinates and one Y reflection in the model matrix preserve Three's handedness
and Float32 precision. Opaque front-facing spheres write depth; transparent
instanced crowns cannot be sorted reliably per tree and caused the hollow,
angle-dependent surfaces in the user recording. Nearby tile arrival merges into
a persistent cache. No transient terrain value can put an object underground.
The shared WebGL renderer resets state before and after each draw.

There are at most 4,000 nearby tree instances and a bounded retained cache. The
sphere mesh has 24 by 16 segments. Crowns have a deterministic green palette.
Tree display files contain only position, crown radius, height and evergreen flag.
They are built from the authoritative checkout by `build-display-assets.mjs`;
original obstacles are not edited. The checked local dataset drops from 16.33 MB
of shadow obstacles to 0.91 MB of display trees (94% fewer uncompressed bytes).
This is a data-volume measurement, not a frame-rate or network-time benchmark.

## Camera and city boundary

A 2D/3D transaction owns only a 450 ms camera animation. It does not await Three,
tree files or a DEM. The centre is retained, and interleaving transactions are
blocked. Returning to 2D hides native extrusions and crowns without destroying the
map. The route uses MapLibre's ordinary line source in both views.

Trip preview follows the computed route at 18 m/s with eased entry and bearings.
It uses visual elevation zero. The elevation chart continues to show actual
Atlas heights and to move a marker on pointer hover. User gestures, Escape,
visibility changes and explicit stop cancel the one camera owner.

A native city mask and camera-clipped SVG boundary mask keep outside areas grey.
The SVG uses flat ground and requires no elevation fetch; behind-camera vertices
are clipped before constructing the screen polygon.

## Verification

Tests exercise actual geometry/materials, transformed trunk bounds, local frame
precision, 24 repeated switches with a permanently stalled optional data request,
preview completion/cancellation, camera clipping, display request isolation and
click-only cards. The local style and building filters pass the matching MapLibre
style validator. Cloudflare packaging is checked with Wrangler dry-run.

The managed environment has no supported browser-control plugin. Live WebGL
pixels and desktop/mobile interactions still need a browser smoke test; automated
checks do not substitute for that visual acceptance step. This remains a preview.

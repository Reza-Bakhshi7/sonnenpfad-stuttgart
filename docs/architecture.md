# Architecture — version 0.12

## Two application modes

Routing starts with a quiet basemap, endpoint selection and route controls. It
loads no Atlas paths, POIs, object attributes, DEM or shadow geometry merely to
open or pan the map. Standard Direct requests the existing audited Oracle API and
adapts its response immediately, including its oriented elevation/profile data.
It no longer downloads shadow tiles or queues a shadow job before displaying the
answer. Direct does not report an invented shade percentage.

Other mobility profiles retain the established browser routing engine until the
server profile contract is actually installed. Balanced profiles load the binary
graph on first calculation but do not run unnecessary shadow work. Shade/Sun load
the original Atlas obstacles for their calculation corridor. Their accessibility
rules, partial-edge handling and relaxation warnings remain unchanged.

Explore retains camera/route state while exposing the Atlas themes and optional
POIs. There is one selected theme, and only that theme's values are requested.
Details are fetched from a tile shard after a click, on desktop or touch devices.
Pointer movement never opens cards or fetches attributes. Leaving Explore closes
cards, hides data layers, stops optional shadow work and discards stale display
responses. No routing action is triggered by ordinary exploration clicks.

## Data and display

`build-display-assets.mjs` creates independent immutable data families during the
build: path geometry and flags, one value array per theme, minimal POI points,
minimal 3D tree points, and full detail shards. A revision digest controls browser
cache invalidation. Request deduplication and a bounded LRU retain recent files.
The original city manifest, graph, elevation assets and shadow obstacles are not
modified by this build step.

The base style is local application code rather than a blocking external style
JSON request. OpenFreeMap serves the vector tiles and glyphs. Native extruded OSM
buildings share that source in both modes and all basemaps. Three loads on first
3D display and draws only cached opaque tree instances. Visible ground is flat;
DEM is excluded from the display bundle. Actual elevation remains in the routing
metadata and chart. Building display estimates do not alter calculation heights.

Atlas-wide modelled shadows are an explicit Explore checkbox in 3D. This loads
original obstacle tiles on demand into a separate worker, without loading a graph
or changing routing weights. The raster has lighter opacity (maximum 0.24) and
updates after the camera settles. Route shadow analysis stays in its own worker.

The city boundary has an opaque native mask and a camera-clipped screen mask in
3D. Outside Stuttgart remains grey. Camera transitions and trip replay have a
single owner and never query elevation or await optional display data.

## Weather and hosting

Cloudflare serves HTML, JavaScript and immutable data as static assets. Only
`/api/weather` runs the weather Worker. This endpoint centrally caches a fixed
Stuttgart forecast, returns valid cached data immediately during refresh, and
uses Open-Meteo with independent MET Norway fallback. It does not receive route
endpoints or device location. The client retains valid cached values while
refreshing, retries after failures and refreshes on reconnect/return to the app.
Sources, retrieval time and stale state stay explicit. Missing provider radiation
is not fabricated; MET sun influence uses a labelled cloud-cover estimate.

## Oracle role and next installation

Oracle/PostGIS remains the home of the audited routing graph, Atlas attributes,
elevation metadata and server routing calculations. Keep static application code
and small display assets at the CDN. Moving raw JSON to Oracle would not remove
browser parsing/drawing costs. Install the prepared profile/shadow contract there
before moving the remaining browser profiles off devices. See
`step8-profile-server-migration.md` for the explicit installation and acceptance
requirements. No SSH, database migration or production merge was performed for
this preview.

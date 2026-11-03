# Architecture — version 0.16

## Two application modes

Routing starts with a quiet basemap, endpoint selection and route controls. It
loads no Atlas paths, POIs, object attributes, DEM or shadow geometry merely to
open or pan the map. Every profile is calculated on the Sonnenpfad server
(Stage 2, `services/profile-api-v1`), including shade and sun weighting; the
browser only draws the answer, its orange profile violations and the elevation
profile. The browser routing engine stays bundled as a fallback for a page load
during which the server was unreachable at start-up.

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
3D display and draws only cached opaque tree instances. Native raster-dem terrain
uses the existing local zoom pyramid 12–14 at 1× height, with a restrained
hillshade. Tree bases sample the same immutable zoom-14 surface. Atlas route
elevation remains in the routing metadata and chart. Building display estimates do not alter calculation heights.

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

## Oracle role

Oracle/PostGIS holds the audited routing graph, Atlas attributes and elevation
metadata. Stage 2 loads them read-only into memory at start and answers all route
requests; see `server-routing-release.md` for limits, updates and rollback. Static
application code and display assets stay at the CDN.

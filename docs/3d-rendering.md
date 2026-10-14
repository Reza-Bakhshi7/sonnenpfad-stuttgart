# 3D rendering architecture

The 0.11 preview replaces the former direct WebGL sphere renderer with a single Three.js custom layer for Atlas buildings, spherical tree crowns/trunks and the 3D route. MapLibre continues to draw basemaps, terrain, themes, POIs and the existing modelled shadow raster. Shadow metrics still use the documented flat-ground model; this change does not introduce terrain-aware shadow calculations.

## Coordinates and heights

All scene vertices use local metres around the Atlas origin. The Mercator origin and scale are composed with MapLibre's camera matrix in double precision before GPU upload. This avoids metre-sized Float32 quantisation of global Mercator positions.

`terrain-heightfield.mjs` decodes the same self-hosted zoom-14 Terrain-RGB PNGs used by MapLibre. Heights are bilinearly interpolated, use the same 1.3 exaggeration and are cached independently of MapLibre's visible tile cache. Missing/failed tiles reject the request; they do not return sea-level elevation or overwrite existing object positions. Failed object loads retry with bounded exponential delays while 3D is visible. Requests are deduplicated with at most six active PNG loads and 96 decoded tiles cached.

Spheres share a 24 by 16 mesh through instancing. Both radius and height retain the Atlas 0.7 scale; crown radius is constrained to fit the height. Slight crown translucency uses depth writes. Building roofs preserve courtyard holes and remain above the highest sampled footprint; foundations extend to the lowest sample. Building geometry is prepared in short main-thread batches, merged by spatial bucket and reused. Loaded objects are retained around the current centre (trees 2.6 km, buildings 3.2 km); the nearest 5,000 crowns share two instanced draws including trunks.

## Camera lifecycle

Terrain is initialized on first 3D entry and retained after returning to a top-down 2D view. A guarded mode transaction invalidates stale viewport responses, disables automatic centre grounding during the camera animation, then restores normal gestures. Normal gestures use MapLibre 6.12.0's corrected terrain handling. No mode switch destroys/reloads the terrain.

Replay prepares DEM samples at at most 12 m spacing, disables automatic grounding, owns one animation-frame loop, animates camera entry and follows the route at 18 m/s with eased bearings. Every camera update supplies centre elevation explicitly. Completion, cancellation and user gestures release that camera owner and restore ordinary grounding. The route profile continues to use original Atlas/API elevations; these rendering samples do not change routing costs or profile metrics.

The city boundary overlay also prepares immutable DEM heights once and clips in camera space. It falls back to MapLibre's native city mask if its projected centre is inconsistent.

## Distribution and validation

MapLibre 6.12.0 is shipped as matched ESM main/shared/worker modules with its stylesheet. Three.js 0.169.0 loads only on first 3D entry. Source chunks are self-hosted, version-pinned and verified by SHA-256 during the build. No external CDN or new server endpoint is required.

Regression checks cover missing height tiles/retries, stable known object heights without `queryTerrainElevation`, centimetre precision, building courtyard roof area, 24 mode transitions with one terrain initialization, camera entry/replay completion/cancellation, boundary clipping and existing routing/profile behavior.

Automated geometry and controller checks do not establish GPU pixel correctness. Browser-control infrastructure is unavailable in this environment. Acceptance still requires the deployed preview on actual devices: repeated 2D/3D changes, camera rotation/panning/zoom, exploration, profile hover and route playback. No SSH or Oracle configuration change is involved.

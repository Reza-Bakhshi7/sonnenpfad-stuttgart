# Server profile preparation and remaining installation

Current production API 0.2 supports shortest only. No SSH was used for this change.
The audited server graph remains authoritative for standard Direct. Other profiles
continue to use the existing browser graph until server implementation is installed.

`scripts/server-profile-contract.mjs` prepares versioned requests for Direct, Shade,
Sun, standard, wheelchair, power wheelchair, walking aid, vision, stroller and custom.
It reuses `resolvedOptions`, `relaxationTiers`, `edgeAllowed` and the extracted
`edgeCostMultiplier` from the existing routing engine. Directed pgRouting costs use
the same rules: `-1` excludes an edge; reverse cost respects the original direction.
Unknown attributes retain the existing uncertainty penalties. Missing shadow
fractions are rejected rather than treated as zero shade.

Before enabling this adapter on Ubuntu:

1. Expose `/capabilities` with `profile_contract_version: 1`,
   `topology: audited-osm-nodes`, `segment_metadata_version: 1`, supported
   `preferences`, `mobility_profiles`, and `shadow_model: geometric-time-aware`
   for Shade/Sun. The frontend capability predicate is implemented but not connected
   to API 0.2. Capability advertisement alone is not a migration or acceptance test.
2. Add a versioned POST route endpoint accepting `buildProfileRequest` output.
   Enforce access, barriers, layers and OSM direction before optional profile costs.
   Enrich audited pieces with Atlas attributes, crossing guidance and comfort POIs.
   Preserve partial start/end piece costs and oriented elevation metadata.
3. For Shade/Sun, compute geometric exposure per directed piece for the supplied time,
   date and leaf state; apply solarWeight. Do not substitute snapshot theme values for
   actual modelled shadows. Cache time buckets and bound route-search work.
4. Apply the shared relaxation tiers, report every relaxed criterion and unknown
   attribute coverage. Compare every mobility profile on known stairs, slopes,
   inaccessible links and disconnected networks before enabling the frontend gate.
5. Return the existing segment contract plus requested profile, effective options,
   relaxed criteria and distance-weighted assessment. Update `adaptServerRoute`
   to read these fields when the server implementation exists.

## Performance changes prepared in the browser

The old graph is downloaded/decoded only on the first browser routing or route-shade
job. It is not needed for map exploration or standard server Direct. Visible tile
fetches deduplicate pending requests, with six parallel tile tasks. 3D loads its full
viewport tile selection instead of nine tiles and retains buildings in the selected tiles instead of keeping the first
1,800–4,500 arbitrary buildings. Geometry stays stable during camera movement
inside the same tile/zoom-band selection. 3D has a
14.5 minimum zoom to keep the building view bounded. Sphere crowns share a smooth triangulated
WebGL2 mesh and one instanced draw; trunks retain compact extrusion geometry.

Route preview uses the already computed route at 18 m/s, with eased bearings and
manual stop. It throttles tile refreshes and suppresses shadow recalculation during
playback. It is a visual preview, not live navigation.

Longer term, prepare clipped building vector tiles/meshes and DEM tiles offline,
then serve them through a CDN. Moving raw JSON to the Oracle VM would not remove
browser parsing or drawing costs. No new subscription or storage service is required
by this change.

## Verification limits

Automated checks cover graph loading, profile costs, map-pick mode and route-point
interpolation. Actual desktop/mobile WebGL rendering, sphere depth and terrain-boundary
projection must still be verified in a real browser. Local historical asset copies
do not match all current repository data counts; full data checks must use CI's
current checkout. This change is a review/preview candidate until those checks pass.

## Correction after the 14 October user recordings

The user recording shows a completely grey map in 3D, exploration and route
playback while the same data is visible in 2D. The new SVG city mask projected
behind-camera boundary vertices before clipping, which could invert the polygon.
`boundary-projection.mjs` clips against camera/near/viewport planes before the
perspective divide. A central-city consistency guard hides an inconsistent overlay
and retains the native GPU-clipped city mask. A regression fixture includes boundary
vertices behind a tilted camera and requires the city centre to remain visible.

Camera-facing analytic crowns were replaced with a shared smooth sphere mesh,
with verified outward-facing triangles. Tile keys are sorted and geometry is
refreshed only when tile selection, mode or zoom band changes. Buildings are opaque
(no unnecessary translucent offscreen composition). Route playback retains its
throttled tile loading.

Map credits now sit in a separate measured DOM slot above the viewport edge.
The toolbar uses one grid and its measured height places native zoom/compass
controls below it. Mobile map height uses the remaining flex space instead of a
100%-height child underneath its header.

ShadeKA was identified from the previously shared public URL http://92.5.24.223/.
Inspection of its publicly served bundle `/assets/index-DzZfkXso.js` confirms a
MapLibre custom 3D layer with Three.js, sphere tree geometry, a directional shadow
light and nearby-building/tree HTTP requests (radius parameter). This is an
observation of the published client, not proof of the server dataset's provenance.
No ShadeKA application code or data was copied into Sonnenpfad.
